// src/modules/inventory/displayMeta.js
// ─────────────────────────────────────────────────────────────────────────────
// بيانات العرض (labels / colors / icons) لوحدة المخزون — مفاتيحها من enums.
// الوحدة مستقلة: تعرّف قوائمها الخاصة (صفوف/مواد) دون الاعتماد على وحدات أخرى.
// ─────────────────────────────────────────────────────────────────────────────

import { TxnType, StockLevel, TxnDirection, TXN_DIRECTION } from './constants';

// ── بيانات عرض أنواع الحركات ──────────────────────────────────────────────
export const TXN_TYPE_META = {
  [TxnType.INITIAL_STOCK]:       { label: 'رصيد افتتاحي',  icon: '📥', color: '#3b82f6' },
  [TxnType.PRINTING]:            { label: 'طباعة',         icon: '🖨️', color: '#10b981' },
  [TxnType.PURCHASE]:            { label: 'شراء',          icon: '🛒', color: '#10b981' },
  [TxnType.SALE]:                { label: 'بيع',           icon: '💰', color: '#f59e0b' },
  [TxnType.FREE_DISTRIBUTION]:   { label: 'توزيع مجاني',   icon: '🎁', color: '#ec4899' },
  [TxnType.RESERVATION]:         { label: 'حجز',           icon: '🔖', color: '#8b5cf6' },
  [TxnType.RESERVATION_RELEASE]: { label: 'فك الحجز',      icon: '🔓', color: '#6366f1' },
  [TxnType.STUDENT_DELIVERY]:    { label: 'تسليم لطالب',   icon: '🎓', color: '#06b6d4' },
  [TxnType.RETURN]:              { label: 'مرتجع',         icon: '↩️', color: '#14b8a6' },
  [TxnType.DAMAGED]:             { label: 'تالف',          icon: '⚠️', color: '#ef4444' },
  [TxnType.LOST]:                { label: 'مفقود',         icon: '❓', color: '#dc2626' },
  [TxnType.ADJUSTMENT]:          { label: 'تسوية',         icon: '⚖️', color: '#64748b' },
};

// ── بيانات عرض مستوى المخزون ──────────────────────────────────────────────
export const STOCK_LEVEL_META = {
  [StockLevel.OK]:  { label: 'متوفر',   icon: '✅', color: '#10b981' },
  [StockLevel.LOW]: { label: 'منخفض',   icon: '⚠️', color: '#f59e0b' },
  [StockLevel.OUT]: { label: 'نافد',    icon: '🚫', color: '#ef4444' },
};

// إشارة الحركة للعرض (+/−) حسب اتجاهها
export function txnSign(type) {
  const dir = TXN_DIRECTION[type];
  if (dir === TxnDirection.IN) return '+';
  if (dir === TxnDirection.OUT) return '−';
  return '';
}

// لون الإشارة
export function txnSignColor(type) {
  const dir = TXN_DIRECTION[type];
  if (dir === TxnDirection.IN) return '#10b981';
  if (dir === TxnDirection.OUT) return '#ef4444';
  return 'var(--text3)';
}

// ── قوائم مستقلة (لا تعتمد على وحدات أخرى) ────────────────────────────────
export const INV_GRADES = [
  'الصف الأول الإعدادي', 'الصف الثاني الإعدادي', 'الصف الثالث الإعدادي',
  'الصف الأول الثانوي', 'الصف الثاني الثانوي', 'الصف الثالث الثانوي',
];

export const INV_SUBJECTS = [
  'رياضيات', 'فيزياء', 'كيمياء', 'أحياء', 'لغة عربية',
  'لغة إنجليزية', 'أخرى',
];

// تنسيق التاريخ (بسيط ومستقل)
export function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ar-EG', { dateStyle: 'medium' });
  } catch {
    return d;
  }
}
