// src/modules/recitation/recitationWhatsappService.js
// ─────────────────────────────────────────────────────────────────────────────
// Recitation WhatsApp — parent notification for a single, already-saved recitation
// result. Same shape as homeworkWhatsappService.js (the closest precedent): reuses the
// existing, already-proven WhatsApp infrastructure — normalizePhone/URL-building/
// window.open all live in openWhatsapp()/buildWhatsappUrl() (studentWhatsappService.js)
// and are re-exported here verbatim, exactly like absenceWhatsappService.js/
// homeworkWhatsappService.js do. The only genuinely new code here is the contact-phone
// convention (identical to both) and the recitation-specific message text.
// ─────────────────────────────────────────────────────────────────────────────
import { formatDate } from '../../utils/helpers';

export { openWhatsapp, buildWhatsappUrl, copyMessage } from '../student-report/studentWhatsappService';

// نفس اصطلاح getAbsenceContactPhone/getHomeworkContactPhone — هاتف ولي الأمر فقط، بلا رجوع
// صامت لهاتف الطالب نفسه؛ بلا هاتف ولي أمر يُعاد '' (زر معطَّل، وopenWhatsapp('') يرفض).
export function getRecitationContactPhone(student) {
  return student?.parentPhone || '';
}

// يبني رسالة نتيجة تسميع من صف روستر التسميع (RecitationPage.jsx's SessionDetailForm)
// مباشرة — لا بيانات مُخترَعة: لا تُعرَض درجة/نسبة إطلاقاً ما لم يوجد score فعلياً (الصف
// نفسه لا يُستدعى منه هذا الزر أصلاً إلا لطالب مُقيَّم — هذا الحارس دفاعي بحت، بنفس مبدأ
// buildHomeworkMessage's "لم يتم تصحيح" حالة الدفاع).
export function buildRecitationMessage({ studentName, groupName, date, score, maxScore, percentage, note } = {}) {
  const formattedDate = date
    ? formatDate(date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : '';
  const hasScore = score !== null && score !== undefined;

  const lines = [
    'السلام عليكم ورحمة الله وبركاته 🌷',
    '',
    `نود إطلاعكم على نتيجة التسميع الخاصة بـ ${studentName || ''}`,
    '',
  ];
  if (groupName) lines.push(`🎤 المجموعة: ${groupName}`);
  if (formattedDate) lines.push(`📅 التاريخ: ${formattedDate}`);
  if (hasScore) {
    const pctSuffix = percentage !== null && percentage !== undefined ? ` — ${percentage}%` : '';
    lines.push(`🎯 الدرجة: ${score}/${maxScore ?? '—'}${pctSuffix}`);
  }
  if (note) lines.push(`📝 ملاحظة: ${note}`);

  lines.push('');
  lines.push('مع خالص التحيات 🌹');

  return lines.join('\n');
}
