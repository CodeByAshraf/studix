// src/modules/communication/validators.js
// ═══════════════════════════════════════════════════════════════════════════
// أدوات التحقق لمركز التواصل — تمنع الحالات غير الصحيحة قبل حفظها.
// ═══════════════════════════════════════════════════════════════════════════

import { CommType, CommResult } from './constants';

// تحقق رقم هاتف مصري بسيط (11 رقم يبدأ بـ 01) — أو فارغ مسموح للزيارات
function isValidPhone(phone) {
  if (!phone) return true; // الهاتف اختياري (زيارات)
  return /^01[0-9]{9}$/.test(phone.trim());
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ── تحقق سجل تواصل ────────────────────────────────────────────────────────
export function validateCommunication(data) {
  const errors = {};

  if (!data.type || !Object.values(CommType).includes(data.type)) {
    errors.type = 'نوع التواصل مطلوب';
  }
  if (!data.result || !Object.values(CommResult).includes(data.result)) {
    errors.result = 'نتيجة التواصل مطلوبة';
  }
  if (!data.employee || !data.employee.trim()) {
    errors.employee = 'اسم الموظف مطلوب';
  }
  if (!isValidPhone(data.phone)) {
    errors.phone = 'رقم الهاتف غير صحيح (11 رقم يبدأ بـ 01)';
  }
  // تاريخ متابعة في الماضي مرفوض
  if (data.followupDate && data.followupDate < todayStr()) {
    errors.followupDate = 'تاريخ المتابعة لا يمكن أن يكون في الماضي';
  }

  return errors;
}

// ── تحقق مهمة متابعة ──────────────────────────────────────────────────────
export function validateTask(data) {
  const errors = {};

  if (!data.title || !data.title.trim()) {
    errors.title = 'عنوان المهمة مطلوب';
  }
  if (!data.employee || !data.employee.trim()) {
    errors.employee = 'الموظف المسؤول مطلوب';
  }
  if (!data.dueDate) {
    errors.dueDate = 'تاريخ الاستحقاق مطلوب';
  } else if (data.dueDate < todayStr()) {
    errors.dueDate = 'تاريخ الاستحقاق لا يمكن أن يكون في الماضي';
  }

  return errors;
}

export function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}
