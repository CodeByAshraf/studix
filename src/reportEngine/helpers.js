// src/reportEngine/helpers.js
// ═══════════════════════════════════════════════════════════════════════════
// أدوات مساعدة لمحرّك التقارير — تهريب HTML وتنسيق التواريخ والأرقام.
// ═══════════════════════════════════════════════════════════════════════════

// تهريب HTML (يمنع كسر التقرير أو الحقن)
export function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// تاريخ كامل بالعربية
export function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return String(d); }
}

// تاريخ مختصر
export function fmtDateShort(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch { return String(d); }
}

// تاريخ ووقت
export function fmtDateTime(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return String(d); }
}

// مبلغ مالي
export function fmtMoney(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('ar-EG', { maximumFractionDigits: 2 }) + ' ج.م';
}

// نسبة مئوية
export function fmtPct(n) {
  return (Math.round((Number(n) || 0) * 10) / 10) + '%';
}

// الأحرف الأولى (للأفاتار)
export function initials(name) {
  return (name || '').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
}
