// src/data/initialData.js
// بيانات أولية لجميع وحدات النظام

export const INITIAL_GROUPS = [];

export const INITIAL_STUDENTS = [];

export const INITIAL_PAYMENTS = [];

// سجلات القبول — تبدأ فارغة؛ المستخدم يضيف بياناته (تُحفظ تلقائياً)
export const INITIAL_ADMISSIONS = [];
// Phase 3B-13A — متابعات وسجل نظامي لسجلات القبول، جداول ابن علائقية حقيقية على
// PostgreSQL (كل سجل يحمل admissionId). ليست مضمَّنة داخل صفوف admissions بعد الآن.
export const INITIAL_ADMISSION_FOLLOWUPS = [];
export const INITIAL_ADMISSION_SYSTEM_LOG = [];
// دفعات القبول — محلية بحتة عمداً (مسدودة بانتظار هجرة النطاق المالي، انظر تقرير قرار
// Phase 3B-13A). لا تُزامَن مع PostgreSQL إطلاقاً — لا تُضَف لـ PG_COLLECTIONS.
export const INITIAL_ADMISSION_PAYMENTS_LOCAL = [];
export const INITIAL_ATTENDANCE = [
];

export const INITIAL_EXAMS = [
];

export const INITIAL_GRADES = [
];

export const INITIAL_NOTIFICATIONS = [];

export const ROLES = {
  admin:     { label: 'مدير النظام',  permissions: null },       // null = all access
  teacher:   { label: 'مدرس',         permissions: ['dashboard','attendance','exams'] },
  secretary: { label: 'سكرتيرة',      permissions: ['dashboard','students','payments','notifications'] },
};

// ── Homework (Assignments) ──────────────────────────────────
export const INITIAL_HOMEWORKS = [
];

// hw_submission: { id, hwId, studentId, status: 'submitted'|'late'|'missing', submittedAt?, score?, notes? }
export const INITIAL_HW_SUBMISSIONS = [
];

// ── Study Materials (مذكرات) ────────────────────────────────
// مخزون المواد التعليمية (موديول مستقل — يبدأ فارغاً)
// مركز التواصل (موديول مستقل — يبدأ فارغاً)
// سجل تدقيق رسائل واتساب لتقارير الطلاب (مستقل تماماً عن مركز التواصل)
export const INITIAL_WA_REPORT_LOG = [];

export const INITIAL_COMMUNICATIONS = [];
export const INITIAL_COMM_TASKS = [];

export const INITIAL_INV_MATERIALS = [];
export const INITIAL_INVENTORY_TXN = [];
export const INITIAL_INVENTORY_SETTINGS = { defaultMinStock: 10, allowNegativeStock: false, reservationExpiryDays: 7 };

export const INITIAL_MATERIALS = [
];

// mat_distribution: who received which material & payment status
export const INITIAL_MAT_DIST = [
];

// ── Treasury (خزنة) ─────────────────────────────────────────
// txn: { id, date, type:'income'|'expense', category, description, amount, method, refType?, refId?, party?, notes, balance }
export const INITIAL_TREASURY_TXN = [
];

// Opening balance (separate from transactions)
export const INITIAL_TREASURY_META = {
  openingBalance: 0,
  currency: 'ج.م',
};

// ── Teachers ────────────────────────────────────────────────
export const INITIAL_TEACHERS = [
];

// ── Extended roles with full permissions ────────────────────
export const INITIAL_ROLES = {
  admin: {
    id: 'admin', label: 'مدير النظام', color: '#7c3aed', isSystem: true,
    permissions: null, // null = full access
    description: 'صلاحيات كاملة لجميع أجزاء النظام',
  },
  teacher: {
    id: 'teacher', label: 'مدرس', color: '#0d9488', isSystem: false,
    permissions: ['dashboard','students','groups','attendance','exams','homework','materials'],
    description: 'يمكنه تسجيل الحضور وإدارة الامتحانات والواجبات',
  },
  accountant: {
    id: 'accountant', label: 'محاسب', color: '#10b981', isSystem: false,
    permissions: ['dashboard','payments','treasury','reports'],
    description: 'الوصول للخزنة والمدفوعات والتقارير المالية',
  },
  reception: {
    id: 'reception', label: 'موظف استقبال', color: '#3b82f6', isSystem: false,
    permissions: ['dashboard','students','groups','payments','notifications','id-cards'],
    description: 'تسجيل الطلاب والمدفوعات وبطاقات الهوية',
  },
};

// ── Absence Follow-up (متابعة الغياب) ──────────────────────
// Each record links to an attendance record (absent only)
// absenceReason: سبب الغياب من ولي الأمر
// followedBy: اسم السكرتيرة / المتابع
// followedAt: تاريخ ووقت المتابعة
// followStatus: 'pending'|'contacted'|'excused'|'unexcused'
// notes: ملاحظات السكرتيرة
export const INITIAL_ABSENCE_FOLLOWUP = [
];

// ══════════════════════════════════════════════════════════════
// CASHBOXES — Multi-Treasury System
// ══════════════════════════════════════════════════════════════
export const INITIAL_CASHBOXES = [
  {
    id:             'cb_main',
    name:           'الخزنة الرئيسية',
    type:           'main',
    color:          '#0d9488',
    icon:           '🏦',
    openingBalance: 0,
    isDefault:      true,
    active:         true,
    createdAt:      new Date().toISOString().split('T')[0],
    notes:          'الخزنة الافتراضية — تُسجَّل فيها كل المدفوعات تلقائياً',
  },
];

// ── Migrate existing txns → attach cashboxId ───────────────────
// All existing transactions go to the main cashbox
export const INITIAL_TREASURY_TXN_V2 = [
];
