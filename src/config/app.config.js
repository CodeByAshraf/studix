// src/config/app.config.js
// ─────────────────────────────────────────────────────────────────────────────
// Central Configuration — كل الـ constants في مكان واحد
//
// لماذا؟
//   قبل: أرقام مثل 5, 1000, 10 مكتوبة مباشرة في الكود
//   بعد: تغيير قيمة واحدة = يطبق في كل مكان
//   مثال: تغيير حد الموافقة من 1000 إلى 2000 = سطر واحد هنا
// ─────────────────────────────────────────────────────────────────────────────

// ── Auth ──────────────────────────────────────────────────────────────────────
export const AUTH_CONFIG = {
  /** عدد محاولات تسجيل الدخول الخاطئة قبل القفل */
  MAX_LOGIN_ATTEMPTS:   5,
  /** مدة القفل بالدقائق */
  LOCKOUT_MINUTES:     15,
  /** مدة القفل بالميلي ثانية */
  get LOCKOUT_MS()     { return this.LOCKOUT_MINUTES * 60 * 1000; },
  /** مفتاح localStorage لمحاولات تسجيل الدخول */
  ATTEMPTS_STORAGE_KEY: 'tc_login_attempts',
  /** مفتاح sessionStorage للـ session */
  SESSION_KEY:          'tc_session',
};

// ── Pagination ────────────────────────────────────────────────────────────────
export const PAGINATION = {
  /** عدد الطلاب في الصفحة الواحدة */
  STUDENTS_PAGE_SIZE:  10,
  /** عدد المعاملات المالية في الصفحة */
  PAYMENTS_PAGE_SIZE:  20,
  /** عدد سجلات النشاط في الصفحة */
  ACTIVITY_LOG_SIZE:  500,
};

// ── Financial ─────────────────────────────────────────────────────────────────
export const FINANCIAL_CONFIG = {
  /** المبلغ الذي يستدعي موافقة المدير للمصروفات (بالجنيه) */
  APPROVAL_THRESHOLD:   1000,
  /** الحد الأقصى المنطقي لأي معاملة (10 مليون) */
  MAX_TRANSACTION:  10_000_000,
  /** عملة النظام */
  CURRENCY:             'ج.م',
  /** رمز العملة للـ API (مستقبلاً) */
  CURRENCY_CODE:        'EGP',
};

// ── Activity Log ──────────────────────────────────────────────────────────────
export const LOG_CONFIG = {
  /** الحد الأقصى لعدد سجلات النشاط المحفوظة */
  MAX_LOGS: 500,
  /** مفتاح localStorage */
  STORAGE_KEY: 'tc_activity_log',
};

// ── Storage Keys ──────────────────────────────────────────────────────────────
export const STORAGE_KEYS = {
  THEME:      'tc_theme',
  AUTOBACKUP: 'tc_autobackup_v2',
};

// ── App Info ──────────────────────────────────────────────────────────────────
export const APP_INFO = {
  NAME:    'Studix',
  TAGLINE: 'Learn. Track. Succeed.',
  VERSION: '2.0.0',
  /** بادئة كود الطالب */
  STUDENT_CODE_PREFIX: 'TC',
};

// ── Validation Rules ──────────────────────────────────────────────────────────
export const VALIDATION = {
  /** الحد الأدنى لطول كلمة المرور */
  PASSWORD_MIN_LENGTH: 6,
  /** الحد الأقصى لطول كلمة المرور */
  PASSWORD_MAX_LENGTH: 128,
  /** الحد الأدنى لطول اسم المجموعة */
  GROUP_NAME_MIN:      3,
  /** نمط رقم الهاتف المصري */
  EGYPT_PHONE_REGEX:   /^01[0-2,5]{1}[0-9]{8}$/,
};

// ── Routes ────────────────────────────────────────────────────────────────────
// مُستورد هنا للمركزية — المصدر الأصلي في constants/routes.js
export { ROUTES } from '../constants/routes.js';
