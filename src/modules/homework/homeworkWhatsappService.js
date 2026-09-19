// src/modules/homework/homeworkWhatsappService.js
// ─────────────────────────────────────────────────────────────────────────────
// Homework Phase 3B — parent WhatsApp follow-up for a single homework submission row
// (Homework Search, Phase 3A). Reuses the existing, already-proven WhatsApp
// infrastructure — normalizePhone/URL-building/window.open all live in
// openWhatsapp()/buildWhatsappUrl() (studentWhatsappService.js) and are re-exported here
// verbatim, exactly like absenceWhatsappService.js does for Attendance. The only genuinely
// new code is the contact-phone convention and the homework-specific message text.
// ─────────────────────────────────────────────────────────────────────────────
import { formatDate } from '../../utils/helpers';

export { openWhatsapp, buildWhatsappUrl, copyMessage } from '../student-report/studentWhatsappService';

// نفس اصطلاح جهة الاتصال المُستخدَم بالفعل في absenceWhatsappService.js's
// getAbsenceContactPhone — هاتف ولي الأمر أولاً، وإلا هاتف الطالب نفسه.
export function getHomeworkContactPhone(student) {
  return student?.parentPhone || student?.phone || '';
}

// Phase 3B clarification: واتساب الواجبات يخدم حالتين فقط — "لم يُسلَّم" (status:'missing'،
// بلا أي علاقة بالدرجة) و"مُصحَّح/له درجة حقيقية" (score!=null، بصرف النظر عن submitted/late
// — واجب متأخر لكن له درجة حقيقية يقع في حالة "الدرجة" هذه بالضبط). "مُسلَّم لكن غير مُصحَّح"
// و"متأخر لكن غير مُصحَّح" لا يُعرَض لهما إجراء واتساب إطلاقاً — هذه الدالة هي المصدر الوحيد
// لهذا القرار (تستهلكها HomeworkSearch.jsx لإظهار/إخفاء زر 📲 لكل صف).
export function shouldShowHomeworkWhatsapp({ status, score } = {}) {
  return status === 'missing' || score != null;
}

// يبني رسالة متابعة واجب من صف بحث الواجبات (Phase 3A) مباشرة — لا بيانات مُخترَعة:
// لا تُعرَض درجة إطلاقاً ما لم يُوجَد sub.score فعلياً (status:'submitted'/'late' وscore!=null).
export function buildHomeworkMessage({ studentName, homeworkTitle, subject, homeworkDate, status, score, totalScore } = {}) {
  const formattedDate = homeworkDate
    ? formatDate(homeworkDate, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  const lines = [
    'السلام عليكم ورحمة الله وبركاته 🌷',
    '',
    `نود إطلاعكم على حالة الواجب الخاص بـ ${studentName || ''}:`,
    '',
    `📘 الواجب: ${homeworkTitle || ''}`,
  ];
  if (subject) lines.push(`📚 المادة: ${subject}`);
  if (formattedDate) lines.push(`📅 التاريخ: ${formattedDate}`);
  lines.push('');

  const scoreLine = score != null ? `🎯 الدرجة: ${score}/${totalScore ?? '—'}` : '📝 لم يتم تصحيح الواجب بعد.';

  if (status === 'missing') {
    lines.push('❗ لم يتم تسليم الواجب حتى الآن.');
  } else if (status === 'late') {
    lines.push('⏱ تم تسليم الواجب متأخراً.');
    lines.push(scoreLine);
  } else {
    lines.push('✅ تم تسليم الواجب.');
    lines.push(scoreLine);
  }

  lines.push('');
  lines.push('مع خالص التحيات 🌹');

  return lines.join('\n');
}
