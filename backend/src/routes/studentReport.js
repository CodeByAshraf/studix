// backend/src/routes/studentReport.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 (Scalability Architecture) — نقطة نهاية واحدة تُعيد "حزمة مصغَّرة" من صفوف
// خام (raw rows) مُصفّاة لطالب واحد فقط بدل الاعتماد على student-report/reportData.js
// وهي تُصفِّي مصفوفات Zustand الكاملة (كل الحضور/الدرجات/الواجبات/المدفوعات/التواصل/
// حركات المخزون في المركز بأكمله) محلياً في المتصفح. reportData.js's gatherStudentData
// نفسها لا تتغيّر إطلاقاً — تستهلك هذه الحزمة كـ "store مصغَّر" بنفس الشكل الذي كانت
// تقرأه من useAppStore الكامل، فتُنتج بالضبط نفس الحسابات (health score/evaluation/
// alerts/AI summary/التقرير المطبوع) بلا أي انزياح دلالي — انظر تقرير المراجعة
// المعماري (Phase 2 checklist) للتفاصيل الكاملة لضمان التكافؤ.
//
// كل شرط مطابقة هنا يُطابق حرفياً منطق التصفية الحالي في gatherStudentData —
// لا يُخترَع أي منطق جديد، فقط يُنقَل من فلتر JS على مصفوفة كاملة إلى WHERE مُفهرَس:
//   - attendance/grades/hw_submissions/payments: student_id = مطابقة مباشرة (نفس فلتر
//     .filter(x => x.studentId === studentId) بالضبط).
//   - communications: (phone = parent_phone) OR (student_name = name) — نفس شرط
//     gatherStudentData بالضبط (ملاحظة: لا تُستخدَم student_id هنا إطلاقاً في الكود
//     الحالي رغم وجود العمود — لم نخترع مطابقة جديدة، هذه هي المطابقة الفعلية اليوم).
//   - inventory_txn (تسليم مذكرات): type='studentDelivery' AND (student_id = المعرّف
//     OR recipient يحتوي اسم الطالب) — نفس منطق bookletDeliveries بالضبط، بما فيه
//     الاحتياط القديم بالاسم لحركات ما قبل ربط student_id.
//
// تطبيع القيم الرقمية/التاريخية هنا يُطابق حرفياً COLLECTION_FIXUPS المستخدَمة في
// db.middleware.js لنفس هذه الحقول بالضبط عبر مسار المزامنة العام — بدون هذا، grades.score/
// exams.total/exams.pass تصل كنصوص (Decimal.toJSON) فتُفسِد scorePercent/gradeStatus
// (مقارنة نصية بدل رقمية)، ونفس المشكلة موثَّقة بالفعل في db.middleware.js لهذا السبب
// بالضبط.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';
import { serializeBigInt } from './payments.js';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

function toNum(value) {
  if (value === null || value === undefined) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function normalizeDateOnly(value) {
  if (value === null || value === undefined) return value;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth، بنفس مبدأ
// createPayment/saveMaterialDistribution/confirmMaterialPayment.
export async function getStudentReportData(studentId) {
  if (typeof studentId !== 'string' || !studentId.trim()) {
    throw badRequest('studentId مطلوب.');
  }

  const student = await prisma.students.findUnique({ where: { id: studentId } });
  if (!student) throw badRequest('الطالب غير موجود.');

  const group = student.group_id
    ? await prisma.groups.findUnique({ where: { id: student.group_id } })
    : null;

  // نفس شرط gatherStudentData بالحرف: (student.parentPhone && c.phone===...) ||
  // (student.name && c.studentName===...) — فرع مستحيل (لا قيمة) يُستبعَد تماماً بدل
  // إرسال شرط يطابق NULL/فارغاً بالخطأ.
  const commOr = [];
  if (student.parent_phone) commOr.push({ phone: student.parent_phone });
  if (student.name) commOr.push({ student_name: student.name });

  // MATDIST_RELEVANT_TXN_TYPES (src/services/materialService.js) بالحرف — نفس الأنواع
  // الأربعة التي deriveMatDist تحتاجها لتحديد آخر حالة نشطة فعلياً لكل زوج (مذكرة،طالب)؛
  // الاقتصار على 'studentDelivery' فقط (كما كان قبل هذه المرحلة) كان يُخفي حركات
  // reservation/reservationRelease/return لاحقة، فيظهر تسليم قديم كأنه لا يزال قائماً حتى
  // لو أُلغي أو استُبدل فعلياً. توسيع إضافي بحت: gatherStudentData's bookletDeliveries
  // (المُستهلِك الحالي الوحيد لهذا الحقل) يستبعد صراحة أي صف type !== 'studentDelivery'
  // بنفسها (انظر reportData.js) — فلا يتغيّر سلوكها إطلاقاً بإضافة صفوف لا تقرؤها.
  const MATDIST_RELEVANT_TXN_TYPES = ['studentDelivery', 'reservation', 'reservationRelease', 'return'];

  const [attendance, hwSubmissions, grades, payments, communications, inventoryTxnRaw, homeworks] = await Promise.all([
    prisma.attendance.findMany({ where: { student_id: studentId } }),
    prisma.hw_submissions.findMany({ where: { student_id: studentId } }),
    prisma.grades.findMany({ where: { student_id: studentId } }),
    prisma.payments.findMany({ where: { student_id: studentId } }),
    commOr.length
      ? prisma.communications.findMany({ where: { OR: commOr } })
      : Promise.resolve([]),
    prisma.inventory_txn.findMany({
      where: {
        type: { in: MATDIST_RELEVANT_TXN_TYPES },
        OR: [
          { student_id: studentId },
          ...(student.name ? [{ recipient: { contains: student.name } }] : []),
        ],
      },
    }),
    // Homework 2.0 Phase 2: الهدف الأكاديمي أصبح صف الطالب لا مجموعته — نفس شرط
    // .filter(h=>h.grade===student.grade) الحالي في reportData.js بالحرف (كان
    // h.groupId===student.groupId). الواجبات الكاملة لصف الطالب (بما فيها التي لم تُسلَّم
    // إطلاقاً) — لا تُستخدَم في gatherStudentData's hwRate/hwTotal/hwDone الحالية (مبنيّة
    // من hwSubmissions فقط، بلا تغيير هنا)؛ مطلوبة حصراً لعرض تبويب "الواجبات" التفاعلي
    // صفاً-بصفّ. طالب بلا صف مُسجَّل (grade فارغ) يُعيد [] مباشرة بلا استعلام — لا معنى
    // لمطابقة "صف فارغ" بين طالب وواجب.
    student.grade
      ? prisma.homeworks.findMany({ where: { grade: student.grade } })
      : Promise.resolve([]),
  ]);

  const examIds = [...new Set(grades.map((g) => g.exam_id))];
  const exams = examIds.length
    ? await prisma.exams.findMany({ where: { id: { in: examIds } } })
    : [];

  const paymentIds = payments.map((p) => p.id);
  // نفس getRefundedAmount بالضبط: ref_type='refund' AND status='active' فقط —
  // استردادات ملغاة/معكوسة لا تُحتسَب، بنفس القاعدة الحالية تماماً.
  const treasuryTxn = paymentIds.length
    ? await prisma.treasury_txn.findMany({
        where: { payment_id: { in: paymentIds }, ref_type: 'refund', status: 'active' },
      })
    : [];

  const materialIds = [...new Set(inventoryTxnRaw.map((t) => t.material_id).filter((id) => id !== null))];
  const invMaterials = materialIds.length
    ? await prisma.inv_materials.findMany({ where: { id: { in: materialIds } } })
    : [];

  // تطبيع مطابق حرفياً لِـ COLLECTION_FIXUPS (db.middleware.js) لنفس هذه الحقول بالضبط —
  // لا تطبيع إضافي مُخترَع، فقط ما يحتاجه gatherStudentData/scorePercent/gradeStatus
  // ليعملا بنفس السلوك الحالي (أرقام حقيقية لا نصوص Decimal.toJSON).
  const fixedAttendance = attendance.map((r) => ({ ...r, date: normalizeDateOnly(r.date) }));
  const fixedExams = exams.map((e) => ({ ...e, date: normalizeDateOnly(e.date), total: toNum(e.total), pass: toNum(e.pass) }));
  const fixedGrades = grades.map((g) => ({ ...g, score: g.score === null || g.score === undefined ? null : toNum(g.score) }));
  const fixedPayments = payments.map((p) => ({ ...p, amount: toNum(p.amount), date: normalizeDateOnly(p.date) }));
  // homeworks.dueDate/totalScore وhwSubmissions.score/submittedAt: نفس مشكلة Decimal/تاريخ
  // أعلاه، بنفس تطبيع COLLECTION_FIXUPS.homeworks/hwSubmissions (db.middleware.js) بالحرف.
  // hw_id (يصير hwId بعد snakeToCamel أدناه) يُضاف هنا لأن كل مستهلك للتطبيق (بما فيه
  // buildInteractiveReportData الجديد) يقرأ حصراً حقلاً اسمه "hwId" لا "homeworkId" —
  // نفس إعادة التسمية المُطبَّقة بالفعل على مسار المزامنة العام لهذا السبب بالضبط.
  const fixedHomeworks = homeworks.map((h) => ({ ...h, due_date: normalizeDateOnly(h.due_date), total_score: toNum(h.total_score) }));
  const fixedHwSubmissions = hwSubmissions.map((s) => ({
    ...s,
    hw_id: s.homework_id,
    score: s.score === null || s.score === undefined ? null : toNum(s.score),
    submitted_at: s.submitted_at ? normalizeDateOnly(s.submitted_at) : s.submitted_at,
  }));
  // invMaterials.price/cost/minStock/addedAt: نفس مشكلة Decimal/تاريخ أعلاه، بنفس تطبيع
  // COLLECTION_FIXUPS.invMaterials بالحرف.
  const fixedInvMaterials = invMaterials.map((m) => ({
    ...m, price: toNum(m.price), cost: toNum(m.cost), min_stock: toNum(m.min_stock),
    added_at: m.added_at ? normalizeDateOnly(m.added_at) : m.added_at,
  }));

  const bundle = {
    students: [student],
    groups: group ? [group] : [],
    attendance: fixedAttendance,
    hwSubmissions: fixedHwSubmissions,
    homeworks: fixedHomeworks,
    grades: fixedGrades,
    exams: fixedExams,
    payments: fixedPayments,
    treasuryTxn,
    communications,
    inventoryTxn: inventoryTxnRaw,
    invMaterials: fixedInvMaterials,
  };

  return snakeToCamel(serializeBigInt(bundle));
}

const router = Router();

// GET /api/students/:studentId/report-data — الصلاحية (requireAuth + requirePermission
// ('students')) تُفرَض عند التركيب في server.js، بنفس نمط payments.js/materialDistribution.js
// بالضبط: نفس صلاحية شاشة تقرير الطالب الحالية (pageId="students" في
// src/constants/routes.js's ProtectedRoute) ونفس صلاحية communications collection
// (COLLECTION_PERMISSIONS.communications='students') — لا صلاحية جديدة تُخترَع هنا.
router.get('/:studentId/report-data', asyncHandler(async (req, res) => {
  const data = await getStudentReportData(req.params.studentId);
  res.json({ ok: true, data });
}));

export default router;
