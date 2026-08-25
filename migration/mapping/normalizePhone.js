// migration/mapping/normalizePhone.js
// ═══════════════════════════════════════════════════════════════════════════
// تطبيع رقم الهاتف المصري — نفس منطق studentWhatsappService في التطبيق.
// يُستخدم لبناء parents وربطهم (matching deterministic بالرقم المطبّع).
// رقم غير صالح → null (لا نبني parent وهمي).
// ═══════════════════════════════════════════════════════════════════════════

export function normalizePhone(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('00')) p = p.slice(2);
  // رقم مصري محلي 01xxxxxxxxx → 201xxxxxxxxx
  if (/^01[0-9]{9}$/.test(p)) return '20' + p.slice(1);
  // رقم مصري دولي بالفعل 201xxxxxxxxx (12 رقماً)
  if (/^201[0-9]{9}$/.test(p)) return p;
  // أي صيغة أخرى غير مدعومة → مرفوضة (لا parent وهمي)
  return null;
}
