// src/modules/communication/communicationService.js
// ═══════════════════════════════════════════════════════════════════════════
// خدمة مركز التواصل — كل منطق الأعمال هنا (بناء السجلات، المهام، المؤشرات).
// السجلات لا تُحذف أبداً (أرشفة فقط). SQL-ready.
// ═══════════════════════════════════════════════════════════════════════════

import {
  CommStatus, TaskStatus, Priority,
  COMM_NUMBER_PREFIX, COMM_NUMBER_PAD,
} from './constants';

// ─────────────────────────────────────────────────────────────────────────────
// توليد رقم التواصل المقروء: COM-000001
// ─────────────────────────────────────────────────────────────────────────────
export function nextCommNumber(records = []) {
  const re = new RegExp(`^${COMM_NUMBER_PREFIX}-(\\d+)$`);
  let max = 0;
  for (const r of records) {
    const m = re.exec(r.number || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${COMM_NUMBER_PREFIX}-${String(max + 1).padStart(COMM_NUMBER_PAD, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// بناء سجل تواصل جديد
// ─────────────────────────────────────────────────────────────────────────────
export function buildCommunication(data, records = [], createdBy = 'system') {
  const now = new Date().toISOString();
  return {
    id:          `com_${Date.now()}`,
    number:      nextCommNumber(records),
    type:        data.type,
    reason:      data.reason || null,
    result:      data.result,
    employee:    data.employee || createdBy,
    parentName:  data.parentName?.trim() || '',
    studentName: data.studentName?.trim() || '',
    phone:       data.phone?.trim() || '',
    notes:       data.notes?.trim() || '',
    priority:    data.priority || Priority.NORMAL,
    status:      data.status || CommStatus.OPEN,
    // متابعة اختيارية
    followupDate: data.followupDate || null,
    followupTime: data.followupTime || null,
    // مراجع اختيارية للتكامل المستقبلي (غير مربوطة الآن)
    admissionId: data.admissionId || null,
    studentId:   data.studentId || null,
    parentId:    data.parentId || null,
    paymentId:   data.paymentId || null,
    groupId:     data.groupId || null,
    createdAt:   now,
    createdBy,
    updatedAt:   now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// بناء مهمة متابعة (مرتبطة بسجل تواصل)
// ─────────────────────────────────────────────────────────────────────────────
export function buildFollowupTask(data, createdBy = 'system') {
  return {
    id:         `task_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    commId:     data.commId || null,
    title:      data.title?.trim() || '',
    dueDate:    data.dueDate || null,
    dueTime:    data.dueTime || null,
    priority:   data.priority || Priority.NORMAL,
    employee:   data.employee || createdBy,
    status:     TaskStatus.PENDING,
    createdAt:  new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// أدوات التاريخ
// ─────────────────────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function isToday(dateStr) {
  if (!dateStr) return false;
  return dateStr.split('T')[0] === todayStr();
}

function isPast(dateStr) {
  if (!dateStr) return false;
  return dateStr.split('T')[0] < todayStr();
}

// ─────────────────────────────────────────────────────────────────────────────
// تصنيف المهام (لوحة المتابعة)
// ─────────────────────────────────────────────────────────────────────────────
export function classifyTasks(tasks = []) {
  const dueToday = [];
  const overdue = [];
  const upcoming = [];
  const completed = [];

  for (const t of tasks) {
    if (t.status === TaskStatus.COMPLETED) { completed.push(t); continue; }
    if (t.status === TaskStatus.CANCELLED) continue;
    if (isToday(t.dueDate)) dueToday.push(t);
    else if (isPast(t.dueDate)) overdue.push(t);
    else upcoming.push(t);
  }
  return { dueToday, overdue, upcoming, completed };
}

// ─────────────────────────────────────────────────────────────────────────────
// مؤشرات لوحة التحكم
// ─────────────────────────────────────────────────────────────────────────────
export function getCommKpis(records = [], tasks = [], { CommType, CommResult } = {}) {
  const todayRecords = records.filter(r => isToday(r.createdAt));
  const { dueToday, overdue, completed } = classifyTasks(tasks);

  return {
    todayCalls:     CommType ? todayRecords.filter(r => r.type === CommType.PHONE_CALL).length : 0,
    todayWhatsapp:  CommType ? todayRecords.filter(r => r.type === CommType.WHATSAPP).length : 0,
    todayFollowups: dueToday.length,
    overdueFollowups: overdue.length,
    noAnswerCount:  CommResult ? todayRecords.filter(r => r.result === CommResult.NO_ANSWER).length : 0,
    completedTasks: completed.length,
    openTasks:      tasks.filter(t => t.status === TaskStatus.PENDING).length,
    todayTotal:     todayRecords.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// خط زمني لطالب/ولي أمر (الأحدث أولاً)
// ─────────────────────────────────────────────────────────────────────────────
export function getTimeline(records = [], { studentName, phone } = {}) {
  return records
    .filter(r => {
      if (studentName && r.studentName === studentName) return true;
      if (phone && r.phone === phone) return true;
      return false;
    })
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ─────────────────────────────────────────────────────────────────────────────
// بحث في السجلات
// ─────────────────────────────────────────────────────────────────────────────
export function searchCommunications(records = [], query = '') {
  const q = query.trim().toLowerCase();
  if (!q) return records;
  return records.filter(r =>
    [r.studentName, r.parentName, r.phone, r.employee, r.number]
      .filter(Boolean)
      .some(v => v.toLowerCase().includes(q))
  );
}
