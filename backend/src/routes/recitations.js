// backend/src/routes/recitations.js
// ─────────────────────────────────────────────────────────────────────────────
// Recitation Assessment — Phase 2, Parts B & C. Dedicated route, own permission
// ('recitation' — see server.js), fully separate from /api/attendance-sessions
// ('attendance' permission). Reuses the existing attendance_sessions row created by
// saveAttendanceSession (attendanceSessions.js) as the ONE shared session identity —
// this file never creates a session header itself, only reads it and, on first save,
// fills in its (until-then-null) max_score/recitation_status fields.
//
// The selected attendance session is authoritative for "who can receive a recitation
// score": the roster here is built directly from this exact session's `attendance` rows
// with status IN ('present','late') — never from attendanceEligibility.js (that answers
// "who generally belongs in this group on this date", not "who actually attended this
// exact session"). An enrollment-eligible-but-absent student must never be scoreable.
//
// Save semantics are deliberately NOT delete-diff (unlike attendanceSessions.js/
// examGrades.js's whole-roster-replace pattern): partial evaluation is an explicit
// product requirement ("12/18 evaluated" must be valid), and there is no existing
// frontend contract yet requiring a full-roster payload (Phase 3 UI not built yet) — a
// delete-diff here would silently destroy a previously-scored student's record the
// moment a later save's payload didn't happen to include them again. Every submitted
// record is upserted by (session_id, student_id); nothing is ever deleted.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { runInTransaction } from '../lib/transaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

// نفس مبدأ attendanceSessions.js's toDateOnly — attendance_sessions.date/recitations.date
// هما @db.Date لكن Prisma يُعيدهما كـ JS Date كامل الطابع الزمني.
function toDateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return value;
}

// نفس مبدأ examGrades.js's toNumberOrNull — score/max_score هما Prisma.Decimal، يُحفَظان
// كما هما عمداً عبر caseMapper.js (يكسر الحساب الحسابي في الفرونت-إند إن تُرِكا كذلك).
function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function serializeSession(session) {
  return {
    ...snakeToCamel(session),
    date: toDateOnly(session.date),
    maxScore: toNumberOrNull(session.max_score ?? session.maxScore),
  };
}

function parseGroupDate(groupId, date) {
  if (typeof groupId !== 'string' || !groupId.trim()) throw badRequest('groupId مطلوب.');
  if (typeof date !== 'string' || !DATE_RE.test(date)) throw badRequest('date يجب أن يكون بصيغة YYYY-MM-DD.');
  return new Date(`${date}T00:00:00.000Z`);
}

// ── 1) قائمة الجلسات المكتملة — لاختيار الجلسة من شاشة Recitation ──────────────────
export async function listCompletedSessions({ limit = 20 } = {}) {
  const take = Number(limit);
  const sessions = await prisma.attendance_sessions.findMany({
    where: { status: 'completed' },
    orderBy: { date: 'desc' },
    take: Number.isFinite(take) && take > 0 ? take : 20,
    include: { groups: { select: { name: true } } },
  });
  if (sessions.length === 0) return [];

  // عدّان مجمَّعان (لا نداء لكل جلسة على حدة — نفس مبدأ الجلب المُجمَّع المُستخدَم في أماكن
  // أخرى بالتطبيق): عدد الحاضرين/المتأخّرين الفعلي لكل (group_id,date)، وعدد recitations
  // الموجودة فعلاً لكل session_id.
  const attendanceCounts = await prisma.attendance.groupBy({
    by: ['group_id', 'date'],
    where: {
      status: { in: ['present', 'late'] },
      OR: sessions.map((s) => ({ group_id: s.group_id, date: s.date })),
    },
    _count: { _all: true },
  });
  const evaluatedCounts = await prisma.recitations.groupBy({
    by: ['session_id'],
    where: { session_id: { in: sessions.map((s) => s.id) } },
    _count: { _all: true },
  });
  const attendeeByKey = new Map(attendanceCounts.map((r) => [`${r.group_id}|${r.date.toISOString()}`, r._count._all]));
  const evaluatedBySession = new Map(evaluatedCounts.map((r) => [r.session_id, r._count._all]));

  return sessions.map((s) => ({
    id: s.id,
    groupId: s.group_id,
    groupName: s.groups?.name ?? null,
    date: toDateOnly(s.date),
    sessionTime: s.session_time,
    recitationStatus: s.recitation_status,
    attendeeCount: attendeeByKey.get(`${s.group_id}|${s.date.toISOString()}`) ?? 0,
    evaluatedCount: evaluatedBySession.get(s.id) ?? 0,
  }));
}

// ── 2) تحميل جلسة recitation واحدة ──────────────────────────────────────────────────
export async function getRecitationSession({ groupId, date }) {
  const dateObj = parseGroupDate(groupId, date);

  const session = await prisma.attendance_sessions.findUnique({
    where: { group_id_date: { group_id: groupId, date: dateObj } },
    include: { groups: { select: { name: true } } },
  });
  if (!session) throw badRequest('لا توجد جلسة حضور محفوظة لهذه المجموعة/التاريخ.');
  if (session.status !== 'completed') {
    throw badRequest('جلسة الحضور لم تُكتمَل بعد — لا يمكن بدء تسميع لها.');
  }

  // الحضور الفعلي لهذه الجلسة بالذات هو المرجع الوحيد — لا attendanceEligibility.js هنا
  // (تلك تُجيب "من ينتمي لهذه المجموعة عموماً"، لا "من حضر هذه الحصة فعلاً"). حاضر/متأخر
  // فقط؛ غائب لا يظهر إطلاقاً كمرشّح تسميع.
  const attendanceRows = await prisma.attendance.findMany({
    where: { group_id: groupId, date: dateObj, status: { in: ['present', 'late'] } },
    // Recitation WhatsApp — phone/parent_phone added to this existing select only (no new
    // query, no global students collection load). Same convention consumed on the frontend
    // as getRecitationContactPhone (recitationWhatsappService.js): parentPhone preferred,
    // phone as fallback.
    include: { students: { select: { id: true, name: true, code: true, phone: true, parent_phone: true } } },
  });

  const existingRecitations = await prisma.recitations.findMany({ where: { session_id: session.id } });
  const recitationByStudent = new Map(existingRecitations.map((r) => [r.student_id, r]));

  const roster = attendanceRows.map((a) => {
    const r = recitationByStudent.get(a.student_id);
    return {
      studentId: a.student_id,
      studentName: a.students?.name ?? null,
      studentCode: a.students?.code ?? null,
      phone: a.students?.phone ?? null,
      parentPhone: a.students?.parent_phone ?? null,
      attendanceStatus: a.status,
      score: r ? toNumberOrNull(r.score) : null,
      maxScore: r ? toNumberOrNull(r.max_score) : null,
      note: r ? r.note : null,
    };
  });

  return {
    session: serializeSession(session),
    group: { id: session.group_id, name: session.groups?.name ?? null },
    roster,
  };
}

// ── 3) حفظ درجات تسميع (upsert فقط — بلا delete-diff، انظر توضيح الملف أعلاه) ──────
export async function saveRecitations({ groupId, date, maxScore, records }, { userId = null } = {}) {
  const dateObj = parseGroupDate(groupId, date);
  if (!Array.isArray(records)) throw badRequest('records يجب أن تكون مصفوفة.');

  const submittedMax = Number(maxScore);
  if (!Number.isFinite(submittedMax) || submittedMax <= 0) throw badRequest('max_score يجب أن يكون رقماً أكبر من صفر.');

  // dedupe: آخر سجل لكل studentId هو الفائز (نفس نمط saveAttendanceSession/saveExamGrades)
  const byStudent = new Map();
  for (const r of records) {
    if (!r || typeof r.studentId !== 'string' || !r.studentId.trim()) {
      throw badRequest('كل سجل يجب أن يحتوي studentId نصياً صالحاً.');
    }
    const score = Number(r.score);
    if (!Number.isFinite(score)) throw badRequest(`score غير صالح للطالب ${r.studentId}.`);
    if (score < 0) throw badRequest(`score لا يمكن أن يكون سالباً (${r.studentId}).`);
    if (score > submittedMax) throw badRequest(`score (${score}) أكبر من الدرجة الكلية (${submittedMax}) — الطالب ${r.studentId}.`);
    byStudent.set(r.studentId, { score, note: r.note ?? null });
  }

  const result = await runInTransaction(async (tx) => {
    // Hardening fix (final Recitation audit) — this read+write sequence previously had no
    // lock, unlike saveAttendanceSession's own equivalent guard (attendanceSessions.js).
    // Two real races existed: (1) a concurrent completeRecitationSession could commit
    // between this read and the writes below, letting a save land after the session was
    // already locked; (2) two concurrent first-time saves (max_score still null) could
    // both read null before either committed, so the second one's write would silently
    // overwrite the first one's "immutable" max_score instead of being rejected — this was
    // reproduced directly (not theoretical) by this file's own 19b test before this fix.
    //
    // Same two-step pattern as attendanceSessions.js's saveAttendanceSession: locate the
    // row via Prisma ORM first (correct @db.Date parameter typing — a raw WHERE date=...
    // comparison risks a timezone-cast mismatch, already hit once during Phase 2), then
    // take the FOR UPDATE row lock via `id` only (no type ambiguity), then re-read the full
    // row through Prisma under that lock — safe and fully/correctly typed (Decimal for
    // max_score) because no concurrent transaction can have written to this row between the
    // lock acquisition and this read; the lock blocks it until we commit or roll back.
    const found = await tx.attendance_sessions.findUnique({
      where: { group_id_date: { group_id: groupId, date: dateObj } },
      select: { id: true },
    });
    if (!found) throw badRequest('لا توجد جلسة حضور محفوظة لهذه المجموعة/التاريخ.');
    await tx.$queryRaw`SELECT id FROM public.attendance_sessions WHERE id = ${found.id} FOR UPDATE`;
    const session = await tx.attendance_sessions.findUnique({ where: { id: found.id } });

    if (session.status !== 'completed') {
      throw badRequest('جلسة الحضور لم تُكتمَل بعد — لا يمكن حفظ تسميع لها.');
    }
    if (session.recitation_status === 'completed') {
      throw conflict('التسميع مكتمل بالفعل لهذه الجلسة — لا يمكن التعديل بعد اكتماله.');
    }

    const currentMax = session.max_score === null ? null : Number(session.max_score);
    if (currentMax !== null && currentMax !== submittedMax) {
      throw badRequest(`الدرجة الكلية لهذه الجلسة مُثبَّتة بالفعل على ${currentMax} — لا يمكن تغييرها إلى ${submittedMax}.`);
    }

    // الجلسة نفسها (المُختارة) هي المرجع الوحيد للأهلية — طالب غائب/غير موجود في سجلات
    // هذه الحصة بالذات (حاضر/متأخر) يُرفَض الحفظ بأكمله (ذرّي)، بنفس مبدأ eligibility
    // checks الأخرى في هذا المشروع.
    const studentIds = [...byStudent.keys()];
    const rosterRows = await tx.attendance.findMany({
      where: { group_id: groupId, date: dateObj, status: { in: ['present', 'late'] }, student_id: { in: studentIds } },
      select: { student_id: true },
    });
    const rosterIds = new Set(rosterRows.map((r) => r.student_id));
    const invalid = studentIds.filter((id) => !rosterIds.has(id));
    if (invalid.length) {
      throw badRequest(`طالب/طلاب غير حاضرين في هذه الجلسة (حاضر/متأخر فقط): ${invalid.join(', ')}`);
    }

    if (currentMax === null) {
      await tx.attendance_sessions.update({
        where: { id: session.id },
        data: {
          max_score: submittedMax,
          recitation_status: session.recitation_status === 'not_started' ? 'in_progress' : session.recitation_status,
        },
      });
    } else if (session.recitation_status === 'not_started') {
      await tx.attendance_sessions.update({ where: { id: session.id }, data: { recitation_status: 'in_progress' } });
    }

    for (const [studentId, { score, note }] of byStudent.entries()) {
      await tx.recitations.upsert({
        where: { session_id_student_id: { session_id: session.id, student_id: studentId } },
        create: {
          id: crypto.randomUUID(),
          session_id: session.id,
          student_id: studentId,
          group_id: groupId,
          date: dateObj,
          score,
          max_score: submittedMax,
          note,
          created_by: userId,
        },
        update: { score, max_score: submittedMax, note },
      });
    }

    const updatedSession = await tx.attendance_sessions.findUnique({ where: { id: session.id } });
    const savedRecords = await tx.recitations.findMany({
      where: { session_id: session.id, student_id: { in: studentIds } },
    });
    return { session: updatedSession, records: savedRecords };
  });

  return {
    session: serializeSession(result.session),
    records: snakeToCamel(result.records).map((r) => ({
      ...r,
      date: toDateOnly(r.date),
      score: toNumberOrNull(r.score),
      maxScore: toNumberOrNull(r.maxScore),
    })),
  };
}

// ── 4) قفل التسميع نهائياً — تغطية جزئية مسموحة صراحةً ──────────────────────────────
export async function completeRecitationSession({ groupId, date }, { userId = null } = {}) {
  const dateObj = parseGroupDate(groupId, date);

  const session = await prisma.attendance_sessions.findUnique({
    where: { group_id_date: { group_id: groupId, date: dateObj } },
  });
  if (!session) throw badRequest('لا توجد جلسة حضور محفوظة لهذه المجموعة/التاريخ.');
  if (session.status !== 'completed') {
    throw badRequest('جلسة الحضور لم تُكتمَل بعد — لا يمكن إكمال تسميعها.');
  }

  // نفس حارس reverseTreasuryTxn/completeAttendanceSession الذرّي بالضبط — شرط
  // recitation_status ضمن الـ WHERE في UPDATE نفسه، لا فحصاً تطبيقياً منفصلاً.
  const { count } = await prisma.attendance_sessions.updateMany({
    where: { id: session.id, recitation_status: { not: 'completed' } },
    data: { recitation_status: 'completed', recitation_completed_at: new Date(), recitation_completed_by: userId },
  });
  if (count !== 1) {
    throw conflict('التسميع مكتمل بالفعل لهذه الجلسة.');
  }

  const updated = await prisma.attendance_sessions.findUnique({ where: { id: session.id } });
  return serializeSession(updated);
}

const router = Router();

// GET /api/recitation-sessions?limit=N — الجلسات المكتملة الأحدث، لاختيارها من الشاشة.
router.get('/', asyncHandler(async (req, res) => {
  const data = await listCompletedSessions({ limit: req.query?.limit });
  res.json({ ok: true, data });
}));

// GET /api/recitation-sessions/:groupId/:date — تحميل جلسة واحدة (roster + أي درجات محفوظة).
router.get('/:groupId/:date', asyncHandler(async (req, res) => {
  const { groupId, date } = req.params;
  const data = await getRecitationSession({ groupId, date });
  res.json({ ok: true, data });
}));

// PUT /api/recitation-sessions/:groupId/:date — حفظ درجات تسميع (upsert جزئي).
router.put('/:groupId/:date', asyncHandler(async (req, res) => {
  const { groupId, date } = req.params;
  const { maxScore, records } = req.body || {};
  const data = await saveRecitations({ groupId, date, maxScore, records }, { userId: req.user?.id ?? null });
  res.json({ ok: true, data });
}));

// PUT /api/recitation-sessions/:groupId/:date/complete — قفل التسميع نهائياً.
router.put('/:groupId/:date/complete', asyncHandler(async (req, res) => {
  const { groupId, date } = req.params;
  const data = await completeRecitationSession({ groupId, date }, { userId: req.user?.id ?? null });
  res.json({ ok: true, data });
}));

export default router;
