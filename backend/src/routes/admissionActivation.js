// backend/src/routes/admissionActivation.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3B-13B (Stage ii) — نقطة نهاية ذرّية واحدة لتفعيل سجل قبول: "حضور أول حصة".
// تُنشئ الطالب الحقيقي، تحدّث سجل القبول (stage=active + student_id)، وتُسجّل حدثي
// النشاط النظامي (firstLesson/activated) — كل ذلك في معاملة واحدة (runInTransaction).
//
// الحاجة: Stage (i) كان ينسّق نفس هذه الكتابات عبر 4 طلبات HTTP منفصلة تماماً (POST
// /api/students، ثم PUT /api/admissions/:id، ثم POST /api/admissionSystemLog مرّتين) —
// بلا أي ذرّية بينها. سباق بين تفعيلين متزامنين لنفس سجل القبول كان قادراً على إنشاء
// طالبين مختلفين، والفائز الأخير في تحديث admission.student_id يجعل الطالب الآخر يتيماً
// بلا أي سجل قبول يشير إليه أبداً. نفس معمارية attendanceSessions.js/examGrades.js/
// materialDistribution.js بالضبط — مسار مخصّص منفصل عن الـ CRUD العام لأن هذا عملية
// منطقية واحدة تمسّ جدولين (students + admissions + admission_system_log)، لا سجلاً واحداً.
//
// القرارات المعتمَدة (تقرير تفتيش/قرار Phase 3B-13B Stage ii):
//   - نجاح متطابق القوة (idempotent) عند إعادة التفعيل لسجل مفعَّل بالفعل بطالب مرتبط —
//     يحمي من النقر المزدوج وإعادة المحاولة بعد انقطاع شبكة معاً، بلا إنشاء طالب ثانٍ.
//   - كود الطالب (students.code) يُحسَب من جهة الخادم داخل المعاملة نفسها (بيانات حديثة
//     فعلياً)، لا من عدّاد محلي قديم محتمل — يمنع تعارض UNIQUE عند تفعيلين متزامنين.
//   - أي حالة غير متسقة (student_id موجود لكن stage ليست active، أو العكس) تُرفَض صراحةً
//     بدل إكمال انتقال ضمني قد يُخفي تناقض بيانات حقيقياً موجوداً مسبقاً.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import crypto from 'crypto';
import { runInTransaction } from '../lib/transaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// students.parent_id هو BigInt — JSON.stringify يرمي استثناء عليه مباشرة (لم يكن هذا
// ملموساً هنا من قبل لأن parent_id كان دائماً null قبل Issue 3). نفس نمط serializeBigInt
// المكرَّر عمداً في crud.js/admissionPayments.js بالضبط (لا util مشترك في هذا المشروع).
function serializeBigInt(input) {
  if (typeof input === 'bigint') return input.toString();
  if (Array.isArray(input)) return input.map(serializeBigInt);
  if (input !== null && typeof input === 'object' && typeof input.toJSON !== 'function') {
    const out = {};
    for (const [k, v] of Object.entries(input)) out[k] = serializeBigInt(v);
    return out;
  }
  return input;
}

// نفس صيغة generateCode('TC', seq) الحالية في src/utils/helpers.js (الفرونت-إند) — لا
// نغيّر الصيغة، فقط نحسبها هنا من جهة الخادم داخل المعاملة (tx) — نفس مبدأ computeNextSeq
// في materialDistribution.js بالضبط. يحلّ خطر تعارض students.code (UNIQUE) الموجود مسبقاً
// في createStudent() المحلي (existingStudents.length + 1 — عدّاد محلي قد يكون قديماً).
async function computeNextStudentCode(tx) {
  const year = new Date().getFullYear();
  const rows = await tx.students.findMany({ select: { code: true } });
  let max = 0;
  const re = /-(\d+)$/;
  for (const { code } of rows) {
    const m = re.exec(code || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `TC-${year}-${String(max + 1).padStart(4, '0')}`;
}

// gender/enrollDate/code/id/createdAt/updatedAt غير مُدرَجة عمداً: gender لا عمود له
// إطلاقاً في students (نفس الاستبعاد الصامت الحالي عبر الـ CRUD العام)، والباقي مُدار
// من هذا المسار أو من القاعدة (enroll_date/created_at/updated_at لها @default).
//
// parentId (اختياري — Product Completion Phase 1, Issue 3): يُحلَّل من جهة العميل
// (find-or-create على parents بالهاتف المطبَّع) ويُمرَّر هنا جاهزاً كمعرّف parents.id
// حقيقي. نفس نمط تحويل BigInt المستخدَم بالفعل لـ materialId في admissionPayments.js.
function validateStudentInput(student) {
  if (!student || typeof student !== 'object') throw badRequest('بيانات الطالب مطلوبة.');
  if (typeof student.name !== 'string' || !student.name.trim()) throw badRequest('اسم الطالب مطلوب.');
  if (typeof student.groupId !== 'string' || !student.groupId.trim()) throw badRequest('المجموعة مطلوبة.');

  let parentIdBig = null;
  if (student.parentId !== null && student.parentId !== undefined && student.parentId !== '') {
    try { parentIdBig = BigInt(student.parentId); }
    catch { throw badRequest('معرّف ولي الأمر غير صحيح.'); }
  }

  return {
    name:         student.name.trim(),
    phone:        student.phone || null,
    parent_id:    parentIdBig,
    parent_phone: student.parentPhone || null,
    grade:        student.grade || null,
    group_id:     student.groupId,
    school:       student.school || null,
    notes:        student.notes || null,
    status:       student.status || 'active',
  };
}

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth.
export async function activateAdmission({ admissionId, student: studentInput }, { userId = null } = {}) {
  if (typeof admissionId !== 'string' || !admissionId.trim()) throw badRequest('admissionId مطلوب.');
  const studentData = validateStudentInput(studentInput);

  const result = await runInTransaction(async (tx) => {
    // القراءة الحاسمة داخل المعاملة (tx)، لا العميل الخام قبلها — هذا بالضبط ما يمنع
    // سباق التفعيل المزدوج (تقرير التفتيش/القرار، البند 10).
    const admission = await tx.admissions.findUnique({ where: { id: admissionId } });
    if (!admission) throw badRequest('سجل القبول غير موجود.');

    // بالفعل مفعَّل بطالب مرتبط — نجاح idempotent بلا إنشاء طالب ثانٍ ولا سجلّي نشاط جديدين.
    if (admission.stage === 'active' && admission.student_id) {
      const existingStudent = await tx.students.findUnique({ where: { id: admission.student_id } });
      if (existingStudent) {
        return { admission, student: existingStudent, systemLogEntries: [] };
      }
      throw badRequest('سجل القبول مفعَّل بالفعل لكن الطالب المرتبط غير موجود — يتطلّب مراجعة يدوية.');
    }

    // حالة غير متسقة أخرى: student_id موجود لكن stage ليست active — رفض صريح.
    if (admission.student_id) {
      throw badRequest('سجل القبول مرتبط بطالب لكن في حالة غير متوقّعة — يتطلّب مراجعة يدوية.');
    }

    const code = await computeNextStudentCode(tx);
    const student = await tx.students.create({
      data: { id: crypto.randomUUID(), code, ...studentData },
    });

    // حارس ذرّي ضد سباق تفعيل مزدوج: القراءة أعلاه (admission، بداية الدالة) وحدها غير
    // كافية — قراءة عادية لا تأخذ قفلاً، فطلبان متزامنان قد يريا كلاهما student_id=null
    // قبل أن يكتب أيّ منهما شيئاً (اكتُشف هذا فعلياً في نفس هذا النمط بالضبط في
    // reverseTreasuryTxn وcancelAdmissionWithRefund). الإصلاح: شرط student_id:null
    // يُنقَل إلى الـ WHERE في UPDATE نفسه بدل أن يبقى فحصاً تطبيقياً منفصلاً عن الكتابة
    // — Postgres يُسرِّي (serializes) عبر قفل الصف الذي يفرضه UPDATE نفسه: الطلب الثاني
    // يُحجَب خلف معاملة الأول حتى تُثبَّت (commit)، ثم يُعاد تقييم WHERE مقابل الحالة
    // المُثبَّتة الفعلية — فيُطابِق صفراً من الصفوف إن كان student_id قد أصبح غير null
    // بالفعل، فيُرفَض بدل أن يُكمِل الكتابة فوق student_id الفائز الأول. الطالب الذي
    // أُنشئ للتو أعلاه (tx.students.create) لم يُثبَّت بعد بالقاعدة — رمي استثناء هنا
    // يُلغي المعاملة التفاعلية بأكملها تلقائياً (Prisma $transaction rollback)، فلا طالب
    // يتيم يصل القاعدة إطلاقاً؛ نفس ضمان عدم-اليُتم المُثبَت فعلياً في reverseTreasuryTxn.
    const { count } = await tx.admissions.updateMany({
      where: { id: admissionId, student_id: null },
      data:  { stage: 'active', student_id: student.id, last_modified_by: userId, last_modified_at: new Date() },
    });
    if (count !== 1) {
      throw badRequest('سجل القبول تم تفعيله للتو من طلب آخر متزامن — تحقّق من حالته الحالية.');
    }
    const updatedAdmission = await tx.admissions.findUnique({ where: { id: admissionId } });

    const firstLessonLog = await tx.admission_system_log.create({
      data: { id: crypto.randomUUID(), admission_id: admissionId, activity_type: 'firstLesson', by_user: userId },
    });
    const activatedLog = await tx.admission_system_log.create({
      data: { id: crypto.randomUUID(), admission_id: admissionId, activity_type: 'activated', by_user: userId, details: student.code },
    });

    return { admission: updatedAdmission, student, systemLogEntries: [firstLessonLog, activatedLog] };
  });

  return {
    admission:        snakeToCamel(result.admission),
    student:          serializeBigInt(snakeToCamel(result.student)),
    systemLogEntries: snakeToCamel(result.systemLogEntries),
  };
}

const router = Router();

// PUT /api/admissions/:id/activate — تفعيل سجل قبول (idempotent). مسار من segmentين
// بعد /api/admissions، فلا يتقاطع أبداً مع PUT /:id للـ CRUD العام (segment واحد فقط)
// — نفس تقنية الاعتراض حسب method+path المستخدَمة لـ exams/homeworks/centerProfile،
// مركَّب قبل الحلقة الديناميكية في server.js.
router.put('/:id/activate', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { student } = req.body || {};
  const data = await activateAdmission({ admissionId: id, student }, { userId: req.user?.id ?? null });
  res.json({ ok: true, data });
}));

export default router;
