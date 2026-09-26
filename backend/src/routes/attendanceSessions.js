// backend/src/routes/attendanceSessions.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3B-4 (prerequisite) — نقطة نهاية ذرّية لحفظ "جلسة حضور" كاملة دفعة واحدة.
// SessionMarking يحفظ حضور مجموعة كاملة (كل الطلاب) كعملية منطقية واحدة — الـ CRUD
// العام (makeCrudRouter) يتعامل مع سجل واحد فقط، فلا يناسب هذا الشكل.
//
// الدلالة: "استبدل جلسة (groupId, date) بالكامل بالسجلات المُرسَلة الآن":
//   - upsert لكل طالب في records (يعتمد على القيد الفريد student_id+date+group_id،
//     فلا يتعارض أبداً مع إعادة حفظ جلسة موجودة — P2002 غير ممكن هنا).
//   - حذف أي سجل قديم لطالب لم يعد ضمن records (تم إلغاء تحديده).
//   - كل ذلك داخل معاملة واحدة (runInTransaction) — إما تنجح كل الخطوات أو لا شيء يتغيّر.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { runInTransaction } from '../lib/transaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';
import { getEligibleStudentIdsForGroupDate, isStudentEligibleForGroupDate } from '../lib/attendanceEligibility.js';

const VALID_STATUSES = new Set(['present', 'absent', 'late']); // يطابق chk_attendance_status بالقاعدة

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// attendance.date هو @db.Date (لا وقت له) لكن Prisma يُعيده كـ JS Date، وJSON.stringify
// يحوّله لطابع زمني كامل (مثال: "2000-01-01T00:00:00.000Z"). كل مكان آخر بالتطبيق
// (SessionMarking, AbsenceFollowup, التقارير) يقارن date كنص "YYYY-MM-DD" مباشرة —
// إعادته كطابع زمني كامل تكسر كل تلك المقارنات بصمت. نُطبّعه هنا صراحة قبل الإرسال.
function toDateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return value;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  err.expose = true;
  return err;
}

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth.
export async function saveAttendanceSession({ groupId, date, sessionTime, records }) {
  if (typeof groupId !== 'string' || !groupId.trim()) throw badRequest('groupId مطلوب.');
  if (typeof date !== 'string' || !DATE_RE.test(date)) throw badRequest('date يجب أن يكون بصيغة YYYY-MM-DD.');
  if (!Array.isArray(records)) throw badRequest('records يجب أن تكون مصفوفة.');

  // dedupe: آخر حالة لكل studentId هي الفائزة (يحمي من إدخال مكرّر بالخطأ من العميل)
  const byStudent = new Map();
  for (const r of records) {
    if (!r || typeof r.studentId !== 'string' || !r.studentId.trim()) {
      throw badRequest('كل سجل يجب أن يحتوي studentId نصياً صالحاً.');
    }
    if (!VALID_STATUSES.has(r.status)) {
      throw badRequest(`status غير صالح: "${r.status}". القيم المسموحة: present/absent/late.`);
    }
    byStudent.set(r.studentId, r.status);
  }

  const group = await prisma.groups.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!group) throw badRequest('المجموعة غير موجودة.');

  const dateObj = new Date(`${date}T00:00:00.000Z`);
  const finalSessionTime = sessionTime || null;

  const result = await runInTransaction(async (tx) => {
    // Recitation Assessment Phase 2, Part A — gives the (group_id, date) attendance
    // session a persisted identity/lock, created/upserted in this SAME transaction so it
    // can never be orphaned relative to the attendance rows it describes (a failure
    // anywhere below rolls back the session upsert too — one transaction, no partial
    // state). FOR UPDATE locks the row (when it already exists) for the rest of this
    // transaction: a concurrent PUT .../complete cannot commit between this read and the
    // attendance writes below — it blocks on the same row until this transaction
    // commits or rolls back, then correctly observes this session's true final state
    // (same reasoning as reverseTreasuryTxn's WHERE-embedded status guard, applied here
    // via an explicit row lock instead, since this function performs several separate
    // writes rather than one single conditional UPDATE).
    // البحث عن الصف عبر Prisma ORM أولاً (نفس النمط المُستخدَم في كل مكان آخر بهذا الملف
    // لمطابقة عمود @db.Date — الاعتماد على Prisma لترميز نوع المعامل بشكل صحيح، بدل
    // مطابقة خام على `date` قد تنزاح بفارق منطقة زمنية بين الجلسة والعمود). القفل نفسه
    // (FOR UPDATE) يُطبَّق بعدها عبر `id` النصّي فقط — لا غموض نوع بيانات فيه إطلاقاً.
    const found = await tx.attendance_sessions.findUnique({
      where: { group_id_date: { group_id: groupId, date: dateObj } },
      select: { id: true },
    });
    let existingSession = null;
    if (found) {
      const lockedRows = await tx.$queryRaw`
        SELECT id, status FROM public.attendance_sessions WHERE id = ${found.id} FOR UPDATE
      `;
      existingSession = lockedRows[0] || null;
    }
    if (existingSession && existingSession.status === 'completed') {
      throw conflict('الجلسة مكتملة — لا يمكن تعديل الحضور بعد اكتمالها.');
    }
    if (existingSession) {
      await tx.attendance_sessions.update({
        where: { id: existingSession.id },
        data: { session_time: finalSessionTime },
      });
    } else {
      await tx.attendance_sessions.create({
        data: { id: crypto.randomUUID(), group_id: groupId, date: dateObj, session_time: finalSessionTime },
      });
    }

    // Group Closure (Attendance Integration) — the client-provided student list is no
    // longer trusted blindly: every studentId must have an active, date/day-eligible
    // enrollment in this exact group on this exact date (attendanceEligibility.js — the
    // single source of truth, reused here rather than duplicated). Checked before any
    // write, inside this same transaction, so an ineligible student rejects the WHOLE
    // session atomically — matches this function's existing all-or-nothing semantics.
    const ineligible = [];
    for (const studentId of byStudent.keys()) {
      if (!(await isStudentEligibleForGroupDate(studentId, groupId, dateObj, tx))) {
        ineligible.push(studentId);
      }
    }
    if (ineligible.length) {
      throw badRequest(`طالب/طلاب غير مؤهَّلين لحضور هذه المجموعة في هذا التاريخ: ${ineligible.join(', ')}`);
    }

    const existing = await tx.attendance.findMany({
      where: { group_id: groupId, date: dateObj },
      select: { id: true, student_id: true },
    });

    const toDeleteIds = existing
      .filter((row) => !byStudent.has(row.student_id))
      .map((row) => row.id);

    if (toDeleteIds.length) {
      await tx.attendance.deleteMany({ where: { id: { in: toDeleteIds } } });
    }

    for (const [studentId, status] of byStudent.entries()) {
      await tx.attendance.upsert({
        where: {
          student_id_date_group_id: { student_id: studentId, date: dateObj, group_id: groupId },
        },
        create: {
          id: crypto.randomUUID(),
          student_id: studentId,
          group_id: groupId,
          date: dateObj,
          status,
          session_time: finalSessionTime,
        },
        update: {
          status,
          session_time: finalSessionTime,
        },
      });
    }

    return tx.attendance.findMany({
      where: { group_id: groupId, date: dateObj },
      orderBy: { created_at: 'asc' },
    });
  });

  return {
    groupId,
    date,
    sessionTime: finalSessionTime,
    records: snakeToCamel(result).map((r) => ({ ...r, date: toDateOnly(r.date) })),
  };
}

// Recitation Assessment Phase 2, Part A — locks an attendance session permanently.
// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth، بنفس مبدأ
// saveAttendanceSession أعلاه.
export async function completeAttendanceSession({ groupId, date }, { userId = null } = {}) {
  if (typeof groupId !== 'string' || !groupId.trim()) throw badRequest('groupId مطلوب.');
  if (typeof date !== 'string' || !DATE_RE.test(date)) throw badRequest('date يجب أن يكون بصيغة YYYY-MM-DD.');
  const dateObj = new Date(`${date}T00:00:00.000Z`);

  const session = await prisma.attendance_sessions.findUnique({
    where: { group_id_date: { group_id: groupId, date: dateObj } },
  });
  if (!session) throw badRequest('لا توجد جلسة حضور محفوظة لهذه المجموعة/التاريخ بعد.');

  // حارس ذرّي ضد سباق إكمال مزدوج — نفس تقنية reverseTreasuryTxn's double-reversal guard
  // بالضبط: شرط status='draft' يُنقَل إلى الـ WHERE في UPDATE نفسه بدل أن يبقى فحصاً
  // تطبيقياً منفصلاً عن الكتابة — Postgres يُسرِّي عبر قفل الصف الذي يفرضه UPDATE نفسه.
  const { count } = await prisma.attendance_sessions.updateMany({
    where: { id: session.id, status: 'draft' },
    data: { status: 'completed', completed_at: new Date(), completed_by: userId },
  });
  if (count !== 1) {
    throw conflict('الجلسة مكتملة بالفعل.');
  }

  const updated = await prisma.attendance_sessions.findUnique({ where: { id: session.id } });
  return { ...snakeToCamel(updated), date: toDateOnly(updated.date) };
}

const router = Router();

// GET /api/attendance-sessions/:groupId/:date/roster — Group Closure (Attendance
// Integration): the eligible student ids for this group/date (enrollment/date/day based —
// attendanceEligibility.js, reused as-is). This is the roster SessionMarking.jsx and the
// print-report flow build their student list from, replacing a plain students.groupId
// filter with no date/day awareness.
router.get('/:groupId/:date/roster', asyncHandler(async (req, res) => {
  const { groupId, date } = req.params;
  if (!DATE_RE.test(date)) throw badRequest('date يجب أن يكون بصيغة YYYY-MM-DD.');
  const group = await prisma.groups.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!group) throw badRequest('المجموعة غير موجودة.');

  const studentIds = await getEligibleStudentIdsForGroupDate(groupId, date);
  res.json({ ok: true, data: studentIds });
}));

// PUT /api/attendance-sessions/:groupId/:date — استبدال الجلسة بالكامل (idempotent)
router.put('/:groupId/:date', asyncHandler(async (req, res) => {
  const { groupId, date } = req.params;
  const { sessionTime, records } = req.body || {};
  const data = await saveAttendanceSession({ groupId, date, sessionTime, records });
  res.json({ ok: true, data });
}));

// PUT /api/attendance-sessions/:groupId/:date/complete — قفل جلسة الحضور نهائياً.
router.put('/:groupId/:date/complete', asyncHandler(async (req, res) => {
  const { groupId, date } = req.params;
  const data = await completeAttendanceSession({ groupId, date }, { userId: req.user?.id ?? null });
  res.json({ ok: true, data });
}));

export default router;
