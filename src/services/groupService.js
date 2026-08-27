// src/services/groupService.js — Backend API version
import { validate, hasErrors, sanitizeFormData, groupSchema, validators } from '../utils/validation';
import { getRefundedAmount } from './paymentService';

export const DAYS_AR = {
  sat:'السبت', sun:'الأحد', mon:'الاثنين', tue:'الثلاثاء',
  wed:'الأربعاء', thu:'الخميس', fri:'الجمعة',
};
export const ALL_DAYS = ['sat','sun','mon','tue','wed','thu','fri'];
export const SUBJECTS = [
  'رياضيات','فيزياء','كيمياء','أحياء','إنجليزية','عربي',
  'تاريخ','جغرافيا','فلسفة','علوم','حاسب','أخرى',
];
export const GRADES = [
  'الصف الأول الإعدادي',
  'الصف الثاني الإعدادي',
  'الصف الثالث الإعدادي',
  'الصف الأول الثانوي',
  'الصف الثاني الثانوي',
  'الصف الثالث الثانوي',
];

export const GROUP_COLORS = [
  '#1a56db','#059669','#7c3aed','#d97706','#0d9488',
  '#be185d','#dc2626','#0284c7','#16a34a','#9333ea',
];

export function validateGroup(data, existing = [], editId = null) {
  const errors = validate(groupSchema, data);
  if (!errors.name && data.name) {
    const dup = existing.find(g => g.name.trim() === data.name.trim() && g.id !== editId);
    if (dup) errors.name = 'اسم المجموعة مستخدم بالفعل';
  }
  return errors;
}

export function createGroup(data, existing = []) {
  const errors = validateGroup(data, existing);
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };
  return {
    id:      `g${Date.now()}`,
    name:    data.name.trim(),
    subject: data.subject,
    grade:   data.grade,
    teacher: data.teacher?.trim() || '',
    teacherId: data.teacherId || null,
    time:    data.time,
    days:    data.days || [],
    price:   Number(data.price),
    max:     Number(data.max),
    color:   data.color || GROUP_COLORS[existing.length % GROUP_COLORS.length],
    notes:   data.notes?.trim() || '',
    createdAt: new Date().toISOString(),
  };
}

export function updateGroup(id, data, existing = []) {
  const errors = validateGroup(data, existing, id);
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };
  return {
    id, name: data.name.trim(), subject: data.subject, grade: data.grade,
    teacher: data.teacher?.trim() || '', teacherId: data.teacherId || null,
    time: data.time, days: data.days || [],
    price: Number(data.price), max: Number(data.max),
    color: data.color, notes: data.notes?.trim() || '',
    updatedAt: new Date().toISOString(),
  };
}


// ── Client-side helpers ────────────────────────────────────────
export function getGroupStats(group, students, payments, attendance, treasuryTxn = []) {
  const groupStudents = students.filter(s => s.groupId === group.id && s.status === 'active');
  const allStudents   = students.filter(s => s.groupId === group.id);
  const month = new Date().getMonth() + 1;
  const monthlyPayments = payments.filter(p => p.groupId === group.id && p.month === month);
  // BUG-02: كانت تجمع payments.amount الخام — دفعة استُرِدَّت جزئياً/كلياً تبقى محسوبة
  // ضمن "المحصَّل" بكامل مبلغها، فتُضخِّم totalRevenue/collectionRate المُشتقّين منها.
  const collected = monthlyPayments.filter(p => p.status === 'paid').reduce((s,p) => s + (p.amount - getRefundedAmount(p.id, treasuryTxn)), 0);
  // الإيراد المتوقع = مجموع رسوم كل طالب (رسوم الطالب الفردية أو سعر المجموعة احتياطياً)
  const expected  = groupStudents.reduce((sum, s) => {
    const fee = Number(s.monthlyFee);
    return sum + (fee > 0 ? fee : (Number(group.price) || 0));
  }, 0);
  const recentAtt = attendance.filter(a => a.groupId === group.id);
  const attPct = recentAtt.length
    ? Math.round(recentAtt.filter(a => a.status === 'present').length / recentAtt.length * 100)
    : null;
  const fillPct = group.max > 0 ? Math.round(groupStudents.length / group.max * 100) : 0;
  const isFull  = groupStudents.length >= group.max;
  return {
    activeCount: groupStudents.length, totalCount: allStudents.length,
    monthlyCollected: collected, monthlyExpected: expected,
    collectionRate: expected > 0 ? Math.round(collected / expected * 100) : 0,
    attendancePct: attPct, isFull,
    // أسماء بديلة/محسوبة تقرؤها شاشات التقارير والبطاقات:
    attPct,                       // = attendancePct
    totalRevenue: collected,      // = monthlyCollected
    fillPct,                      // نسبة الإشغال
    isAlmostFull: !isFull && fillPct >= 80,
  };
}

export function formatDays(days = []) {
  return days.map(d => DAYS_AR[d] || d).join(' - ');
}
