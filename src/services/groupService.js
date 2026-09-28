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


// Group membership from active student_group_enrollments rows (GET /api/enrollments) —
// the same source Attendance's roster uses. Returns Map<groupId, Map<studentId, role>>
// ('primary' | 'additional'); a student appears under every group they are actively
// enrolled in. students.groupId alone never makes a student a member here.
export function buildGroupMembership(enrollments = []) {
  const byGroup = new Map();
  for (const e of enrollments) {
    if (!byGroup.has(e.groupId)) byGroup.set(e.groupId, new Map());
    byGroup.get(e.groupId).set(e.studentId, e.role);
  }
  return byGroup;
}

// ── Enrollment attendance days (Fix 2) ───────────────────────────
// A group's meeting days, in the canonical week order, ignoring anything unknown.
export function groupMeetingDays(group) {
  const days = Array.isArray(group?.days) ? group.days : [];
  return ALL_DAYS.filter((d) => days.includes(d));
}

// attend_days → the days shown as selected: NULL means every day the group meets.
export function selectedAttendDays(attendDays, group) {
  const meeting = groupMeetingDays(group);
  return Array.isArray(attendDays) ? meeting.filter((d) => attendDays.includes(d)) : meeting;
}

// Selected days → attend_days to store: every meeting day (or a group with no configured
// days) is NULL ("follows the group"); never an empty array.
export function toAttendDays(selected, group) {
  const meeting = groupMeetingDays(group);
  const picked = meeting.filter((d) => selected.includes(d));
  if (meeting.length === 0 || picked.length === 0 || picked.length === meeting.length) return null;
  return picked;
}

// ── Client-side helpers ────────────────────────────────────────
// C4 Attendance migration Phase 2: the 4th parameter used to be the FULL global attendance
// array, filtered internally by this function (`attendance.filter(a => a.groupId ===
// group.id)`) — called once per group per render (GroupCard/GroupStatistics), an N-times
// re-filter of the same large array. It is now a single pre-aggregated row for THIS group
// (the shape GET /api/attendance/aggregate?groupBy=group returns: { total, present, absent,
// late }), fetched ONCE per page (batched across every group) by the caller. Passing `[]`/
// `undefined` (as existing unit tests that don't exercise attendance still do) safely
// produces the same attendancePct: null as before, since `[].total`/`undefined.total` is
// undefined either way.
// members (optional): this group's Map<studentId, role> from buildGroupMembership — when
// given, membership comes from enrollments (and only role='primary' members count toward
// monthlyExpected); omitted, the legacy students.groupId match is kept for callers not yet
// on enrollment membership.
export function getGroupStats(group, students, payments, attendanceStats = {}, treasuryTxn = [], members) {
  const isMember = members
    ? (s) => members.has(s.id)
    : (s) => s.groupId === group.id;
  const groupStudents = students.filter(s => isMember(s) && s.status === 'active');
  const allStudents   = students.filter(isMember);
  const month = new Date().getMonth() + 1;
  const year  = new Date().getFullYear();
  // BUG-06: كانت تفلتر بالشهر فقط دون السنة — دفعة من نفس رقم الشهر في سنة سابقة كانت
  // تُحسَب ضمن "هذا الشهر" (نفس نمط "MEDIUM-A Finding 1" المُصلَح في كل مكان آخر —
  // ReportsPage.jsx/FinancialAnalytics.jsx/UnpaidStudents.jsx/PaymentsPage.jsx).
  const monthlyPayments = payments.filter(p => p.groupId === group.id && p.month === month && (!p.year || p.year === year || p.date?.startsWith(`${year}`)));
  // BUG-02: كانت تجمع payments.amount الخام — دفعة استُرِدَّت جزئياً/كلياً تبقى محسوبة
  // ضمن "المحصَّل" بكامل مبلغها، فتُضخِّم totalRevenue/collectionRate المُشتقّين منها.
  const collected = monthlyPayments.filter(p => p.status === 'paid').reduce((s,p) => s + (p.amount - getRefundedAmount(p.id, treasuryTxn)), 0);
  // الإيراد المتوقع = مجموع رسوم كل طالب (رسوم الطالب الفردية أو سعر المجموعة احتياطياً)
  // The monthly fee is student-level and is billed/collected in the student's PRIMARY group
  // (payments carry the Primary groupId — paymentService.js), so with enrollment membership
  // only Primary members contribute here: an Additional Group enrollment is membership/
  // schedule only and never adds a second fee. Membership counts above still include them.
  const feePayers = members ? groupStudents.filter(s => members.get(s.id) === 'primary') : groupStudents;
  const expected  = feePayers.reduce((sum, s) => {
    const fee = Number(s.monthlyFee);
    return sum + (fee > 0 ? fee : (Number(group.price) || 0));
  }, 0);
  const attPct = attendanceStats && attendanceStats.total
    ? Math.round(attendanceStats.present / attendanceStats.total * 100)
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
