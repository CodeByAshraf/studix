// src/modules/attendance/absenceWhatsappService.js
// ─────────────────────────────────────────────────────────────────────────────
// رسالة واتساب لولي الأمر عن غياب طالب عن حصة واحدة — خاصة بصفحة "متابعة الغياب"
// (AbsenceFollowup.jsx) فقط. رسالة صغيرة مركَّزة من بيانات حضور موجودة بالفعل فقط
// (لا بيانات مالية/امتحانات/واجبات — تلك تخص تقرير الطالب الكامل في student-report،
// ملف منفصل تماماً). openWhatsapp/buildWhatsappUrl مُعاد تصديرهما مباشرة من
// studentWhatsappService.js (المطبَّقة والمُختبَرة بالفعل) — لا تكرار لمنطق تطبيع
// رقم الهاتف هنا.
// ─────────────────────────────────────────────────────────────────────────────
import { formatDate } from '../../utils/helpers';

export { openWhatsapp, buildWhatsappUrl } from '../student-report/studentWhatsappService';

// رسالة واتساب موجَّهة لولي الأمر — هاتف ولي الأمر فقط. لا رجوع صامت لهاتف الطالب نفسه
// (كان سيُرسل رسالة "نود إبلاغكم بتغيب ..." للطالب على أنه ولي الأمر). بلا هاتف ولي أمر
// يُعاد '' فيُعطَّل الزر، وopenWhatsapp('') يرفض برسالة "لا يوجد رقم هاتف لولي الأمر.".
export function getAbsenceContactPhone(student) {
  return student?.parentPhone || '';
}

// اسم المدرّس المسؤول عن حصة/مجموعة الطالب — نفس مصدر البيانات الحقيقي المُستخدَم
// بالفعل في studentWhatsappService.js's buildHeader (student.teacherName ||
// group?.teacherName || profile?.teacherName)، بفارق واحد مقصود: student.teacherName
// أُسقِط هنا لأنه لا عمود مطابق له إطلاقاً في جدول students (تحقّق فعلي حيّ في مخطط
// Prisma) — لم يكن يُنتج أي قيمة حقيقية أصلاً هناك، فلا داعي لتكراره هنا.
// group.teacherName (لا group.teacher — انظر تعليق أدناه) هو الحقل الأساسي، ثم
// centerProfile.teacherName احتياطياً (مركز بمدرّس افتراضي واحد فقط).
//
// ملاحظة مهمة اكتُشفت أثناء هذه المرحلة: GroupForm.jsx/GroupsPage.jsx يقرآن/يكتبان
// حقلاً محلياً اسمه "teacher" (مثال: group.teacher في GroupsPage.jsx سطر 349) — لكن
// db.middleware.js's COLLECTION_FIXUPS لا يملك أي تصحيح اسم لِـ collection "groups"
// إطلاقاً (تحقّق فعلي حيّ)، فالصفوف المُزامَنة من PostgreSQL تصل بحقلها الخام
// "teacherName" (snakeToCamel لِـ teacher_name) فقط — "group.teacher" يبقى undefined
// لأي مجموعة حقيقية مُزامَنة من الخادم. هذا عيب موجود مسبقاً في الكود، خارج نطاق هذه
// المهمة تماماً (لم يُعدَّل هنا) — لكنه السبب المباشر لاستخدام "group.teacherName"
// هنا حصراً، لا "group.teacher"، لأن الأخير لا يحمل قيمة حقيقية عند التشغيل الفعلي.
export function getSessionTeacherName(group, centerProfile) {
  return group?.teacherName || centerProfile?.teacherName || '';
}

// يبني رسالة غياب صغيرة من بيانات متاحة بالفعل فقط (لا اختراع بيانات) — اسم المجموعة
// يُدرَج فقط لو موجود فعلاً، وسطر المدرّس بالكامل (والخاتمة المرتبطة به) يُحذَف لو لم
// يُعرَف اسم مدرّس حقيقي لهذه المجموعة/المركز، بنفس مبدأ studentWhatsappService's
// buildHeader (لا سطر فارغ أو "undefined" لو غابت بيانة).
export function buildAbsenceMessage({ studentName, groupName, teacherName, date } = {}) {
  const formattedDate = formatDate(date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const groupSuffix = groupName ? `، ضمن مجموعة ${groupName}` : '';

  const lines = [
    'السلام عليكم ورحمة الله وبركاته 🌷',
    '',
    // لا كلمة "اليوم" هنا: زر الواتساب هذا نفسه مُتاح أيضاً من قسمَي "متابعات متأخرة"
    // و"سجل المتابعة" في AbsenceFollowup.jsx (onWhatsapp={handleWhatsapp} على الثلاث
    // أقسام)، أي أن attRecord.date قد يكون قبل عدة أيام لا اليوم فعلاً — formattedDate
    // وحده يحمل التاريخ الصحيح دائماً بلا أي ادّعاء زمني خاطئ.
    `نود إبلاغكم بتغيب ${studentName || ''} عن حصة ${formattedDate}${groupSuffix}.`,
    '',
  ];

  if (teacherName) {
    lines.push(`👨‍🏫 المدرس: ${teacherName}`);
    lines.push('');
    lines.push('في حالة وجود عذر، نرجو التواصل مع المدرس.');
  } else {
    lines.push('في حالة وجود عذر، نرجو التواصل مع الإدارة.');
  }

  lines.push('');
  lines.push('مع خالص التحيات 🌹');

  return lines.join('\n');
}
