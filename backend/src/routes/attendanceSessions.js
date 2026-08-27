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

const router = Router();

// PUT /api/attendance-sessions/:groupId/:date — استبدال الجلسة بالكامل (idempotent)
router.put('/:groupId/:date', asyncHandler(async (req, res) => {
  const { groupId, date } = req.params;
  const { sessionTime, records } = req.body || {};
  const data = await saveAttendanceSession({ groupId, date, sessionTime, records });
  res.json({ ok: true, data });
}));

export default router;
