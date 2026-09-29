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

// P1-2 (QR attendance persistence) — records ONE student's attendance for (groupId, date),
// for the QR check-in flow. It deliberately does NOT reuse saveAttendanceSession's
// "replace the whole session" semantics: a single scan re-sending the full roster would be a
// read-modify-write that could delete another student's row saved concurrently (e.g. two
// scans, or SessionMarking saving at the same time). Same rules, same transaction shape:
//   - the session row is created if missing (INSERT ... ON CONFLICT DO NOTHING, race-free)
//     and then locked FOR UPDATE; a 'completed' session is rejected (409), exactly like
//     saveAttendanceSession;
//   - the student must be eligible for this group/date (attendanceEligibility.js);
//   - an existing row for (student, date, group) is never overwritten — the scan is
//     rejected with code ATTENDANCE_EXISTS (the uq_attendance_student_date_group key is the
//     final guard; concurrent scans of the same student serialize on the session lock).
// Other students' rows are never touched.
export const ATTENDANCE_EXISTS = 'ATTENDANCE_EXISTS';

export async function checkInStudent({ groupId, date, studentId, status, sessionTime }) {
  if (typeof groupId !== 'string' || !groupId.trim()) throw badRequest('groupId مطلوب.');
  if (typeof date !== 'string' || !DATE_RE.test(date)) throw badRequest('date يجب أن يكون بصيغة YYYY-MM-DD.');
  if (typeof studentId !== 'string' || !studentId.trim()) throw badRequest('studentId مطلوب.');
  if (!VALID_STATUSES.has(status)) {
    throw badRequest(`status غير صالح: "${status}". القيم المسموحة: present/absent/late.`);
  }

  const group = await prisma.groups.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!group) throw badRequest('المجموعة غير موجودة.');

  const dateObj = new Date(`${date}T00:00:00.000Z`);
  const finalSessionTime = sessionTime || null;

  const record = await runInTransaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO public.attendance_sessions (id, group_id, date, session_time)
      VALUES (${crypto.randomUUID()}, ${groupId}, ${date}::date, ${finalSessionTime})
      ON CONFLICT (group_id, date) DO NOTHING
    `;
    const lockedRows = await tx.$queryRaw`
      SELECT id, status FROM public.attendance_sessions
      WHERE group_id = ${groupId} AND date = ${date}::date FOR UPDATE
    `;
    const session = lockedRows[0] || null;
    if (!session) throw conflict('تعذّر إنشاء جلسة الحضور — حاول مرة أخرى.');
    if (session.status === 'completed') {
      throw conflict('الجلسة مكتملة — لا يمكن تعديل الحضور بعد اكتمالها.');
    }

    if (!(await isStudentEligibleForGroupDate(studentId, groupId, dateObj, tx))) {
      throw badRequest(`الطالب غير مؤهَّل لحضور هذه المجموعة في هذا التاريخ: ${studentId}`);
    }

    const existing = await tx.attendance.findUnique({
      where: { student_id_date_group_id: { student_id: studentId, date: dateObj, group_id: groupId } },
    });
    if (existing) {
      const err = conflict('تم تسجيل حضور هذا الطالب مسبقاً لهذه المجموعة في هذا التاريخ.');
      err.code = ATTENDANCE_EXISTS;
      throw err;
    }

    return tx.attendance.create({
      data: {
        id: crypto.randomUUID(),
        student_id: studentId,
        group_id: groupId,
        date: dateObj,
        status,
        session_time: finalSessionTime,
      },
    });
  });

  const shaped = snakeToCamel(record);
  return { ...shaped, date: toDateOnly(shaped.date) };
}

const router = Router();

// GET /api/attendance-sessions/:groupId/:date/roster — Group Closure (Attendance
// Integration): the eligible student ids for this group/date (enrollment/date/day based —
// attendanceEligibility.js, reused as-is). This is the roster SessionMarking.jsx and the
// print-report flow build their student list from, replacing a plain students.groupId
// filter with no date/day awareness.
//
// M2 (Attendance roster) — each entry is now { id, name, code }: exactly what the marking UI
// displays, so an 'attendance'-only user (who cannot read the students collection) gets a
// usable roster. Nothing else about the student is returned (no phone, parent, status,
// group or financial data). The eligible set is unchanged (same attendanceEligibility.js
// call). ?active=true additionally keeps only students whose own status is 'active' — the
// filter SessionMarking always applied client-side, now done here because an
// attendance-only user has no status to filter by; without it (the print report), every
// eligible student is returned, exactly as before.
router.get('/:groupId/:date/roster', asyncHandler(async (req, res) => {
  const { groupId, date } = req.params;
  if (!DATE_RE.test(date)) throw badRequest('date يجب أن يكون بصيغة YYYY-MM-DD.');
  const group = await prisma.groups.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!group) throw badRequest('المجموعة غير موجودة.');

  const studentIds = await getEligibleStudentIdsForGroupDate(groupId, date);
  const activeOnly = req.query?.active === 'true';
  const roster = await prisma.students.findMany({
    where: { id: { in: studentIds }, ...(activeOnly ? { status: 'active' } : {}) },
    select: { id: true, name: true, code: true },
  });
  res.json({ ok: true, data: roster });
}));

// PUT /api/attendance-sessions/:groupId/:date — استبدال الجلسة بالكامل (idempotent)
router.put('/:groupId/:date', asyncHandler(async (req, res) => {
  const { groupId, date } = req.params;
  const { sessionTime, records } = req.body || {};
  const data = await saveAttendanceSession({ groupId, date, sessionTime, records });
  res.json({ ok: true, data });
}));

// POST /api/attendance-sessions/:groupId/:date/check-in — P1-2: QR check-in of ONE student
// (see checkInStudent above). A duplicate answers 409 with code ATTENDANCE_EXISTS so the
// client can show "already recorded" rather than a generic failure.
router.post('/:groupId/:date/check-in', asyncHandler(async (req, res) => {
  const { groupId, date } = req.params;
  const { studentId, status, sessionTime } = req.body || {};
  try {
    const data = await checkInStudent({ groupId, date, studentId, status, sessionTime });
    res.status(201).json({ ok: true, data });
  } catch (err) {
    if (err.code === ATTENDANCE_EXISTS) {
      return res.status(409).json({ ok: false, code: ATTENDANCE_EXISTS, error: err.message });
    }
    throw err;
  }
}));

// PUT /api/attendance-sessions/:groupId/:date/complete — قفل جلسة الحضور نهائياً.
router.put('/:groupId/:date/complete', asyncHandler(async (req, res) => {
  const { groupId, date } = req.params;
  const data = await completeAttendanceSession({ groupId, date }, { userId: req.user?.id ?? null });
  res.json({ ok: true, data });
}));

export default router;
