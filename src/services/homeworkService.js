// src/services/homeworkService.js
import { hasErrors, sanitizeFormData } from '../utils/validation';

export const HW_STATUS = {
  active:  { label: 'نشط',    color: '#3b82f6', bg: 'rgba(59,130,246,.1)',  border: 'rgba(59,130,246,.2)'  },
  closed:  { label: 'منتهي',  color: '#10b981', bg: 'rgba(16,185,129,.1)', border: 'rgba(16,185,129,.2)'  },
  draft:   { label: 'مسودة',  color: '#94a3b8', bg: 'rgba(148,163,184,.1)',border: 'rgba(148,163,184,.2)' },
};

export const SUB_STATUS = {
  submitted: { label: 'تم التسليم', color: '#10b981', bg: 'rgba(16,185,129,.1)', border: 'rgba(16,185,129,.2)', icon: '✓' },
  late:      { label: 'متأخر',      color: '#f59e0b', bg: 'rgba(245,158,11,.1)', border: 'rgba(245,158,11,.2)', icon: '⏱' },
  missing:   { label: 'لم يُسلَّم', color: '#ef4444', bg: 'rgba(239,68,68,.1)',  border: 'rgba(239,68,68,.2)',  icon: '✗' },
};

export const SUBJECTS = [
  'رياضيات','فيزياء','كيمياء','أحياء','إنجليزية','عربي',
  'تاريخ','جغرافيا','فلسفة','حاسب','علوم','أخرى',
];

// ── Validation ──────────────────────────────────────────────
// مصدر التحقّق الوحيد لكل من HomeworkForm (عبر useForm) و createHomework/updateHomework —
// كانا يستخدمان قبل ذلك مسارَين منفصلَين غير متطابقين (هذا الملف يدوياً، والآخر عبر
// homeworkSchema العام)؛ تم توحيدهما هنا.
export function validateHomework(data) {
  const errors = {};
  if (!data.title?.trim())       errors.title    = 'عنوان الواجب مطلوب';
  if (!data.subject)             errors.subject  = 'اختر المادة';
  if (!data.groupId)             errors.groupId  = 'اختر المجموعة';
  if (!data.dueDate)             errors.dueDate  = 'موعد التسليم مطلوب';
  if (!data.createdAt)           errors.createdAt= 'تاريخ الإنشاء مطلوب';
  // > 0 صراحةً — يطابق قيد القاعدة chk_hw_score (وليس >= 0 فقط)
  if (data.totalScore !== undefined && Number(data.totalScore) <= 0)
    errors.totalScore = 'الدرجة يجب أن تكون أكبر من صفر';
  if (data.dueDate && data.createdAt && data.dueDate < data.createdAt)
    errors.dueDate = 'موعد التسليم يجب أن يكون بعد تاريخ الإنشاء';
  return errors;
}

// ── Create ──────────────────────────────────────────────────
export function createHomework(data) {
  const errors = validateHomework(data);
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };
  const clean = sanitizeFormData(data, ['title','description']);
  return {
    id:          `hw${Date.now()}`,
    title:       clean.title?.trim(),
    description: clean.description?.trim() || '',
    subject:     clean.subject,
    teacher:     clean.teacher || '',
    groupId:     clean.groupId,
    totalScore:  Number(clean.totalScore) || 10,
    dueDate:     clean.dueDate,
    status:      'active',
    // القيمة التي أدخلها المستخدم فعلياً — لم تكن تُستخدَم سابقاً (كان يُستبدَل دائماً
    // بـ "الآن")، وهذا يكسر الغرض من عمود assigned_date المخصَّص لهذه القيمة بالضبط.
    createdAt:   clean.createdAt,
  };
}

// ── Update ──────────────────────────────────────────────────
export function updateHomework(id, data) {
  const errors = validateHomework(data);
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };
  const clean = sanitizeFormData(data, ['title','description']);
  return {
    id, title: clean.title?.trim(), description: clean.description?.trim() || '',
    subject: clean.subject, teacher: clean.teacher || '', groupId: clean.groupId,
    totalScore: Number(clean.totalScore), dueDate: clean.dueDate, status: clean.status,
    // كان مفقوداً سابقاً — يمنع تعديل تاريخ الإنشاء رغم أن الحقل معروض كقابل للتعديل بالنموذج
    createdAt: clean.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

// ── Stats for a single homework ──────────────────────────────
export function getHomeworkStats(hw, submissions, students) {
  const groupStudents = students.filter(s => s.groupId === hw.id && s.status === 'active');
  const hwSubs = submissions.filter(s => s.hwId === hw.id);

  const submitted = hwSubs.filter(s => s.status === 'submitted').length;
  const late      = hwSubs.filter(s => s.status === 'late').length;
  const missing   = hwSubs.filter(s => s.status === 'missing').length;
  const total     = groupStudents.length;
  const notSubmitted = total - submitted - late;

  const scores    = hwSubs.filter(s => s.score !== null && s.score !== undefined).map(s => s.score);
  const avgScore  = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0) / scores.length * 10) / 10 : null;

  return { total, submitted, late, missing: Math.max(0, notSubmitted), avgScore };
}

// ── Is homework overdue ──────────────────────────────────────
export function isOverdue(hw) {
  return new Date(hw.dueDate) < new Date() && hw.status === 'active';
}

export function daysUntilDue(hw) {
  const diff = new Date(hw.dueDate) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
