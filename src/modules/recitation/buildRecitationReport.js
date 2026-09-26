// src/modules/recitation/buildRecitationReport.js
// Recitation Assessment — professional print views. Reuses the centralized print system
// (src/utils/printStyles.js) exactly as src/modules/attendance/buildAttendanceReport.js
// does — no window/HTML-wrapper boilerplate duplicated here, no new print framework.
//
// All three functions are pure renderers: they take already-loaded data (session, group,
// roster, profile) and never fetch anything themselves. Callers MUST pass the current
// server-reconciled roster/session (never unsaved local draft scores) — see
// RecitationPage.jsx, where `roster`/`session` are only ever updated from actual API
// responses (initial load, save, complete), unlike `localScores` which holds in-progress,
// possibly-unsaved edits.
import {
  PALETTE, esc, fmtDate, openPrintWindow, reportHeaderHTML, reportFooterHTML,
  kpiHTML, sectionTitleHTML, badgeHTML,
} from '../../utils/printStyles';
import { scorePercent } from '../../services/examService';

function sessionTitleBlock(session, group) {
  const groupName = group?.name || session.groupId;
  return `
    <div class="report-title">كشف التسميع — ${esc(groupName)}</div>
    <div style="text-align:center;color:${PALETTE.textSoft};font-size:12px;margin-bottom:16px">
      ${fmtDate(session.date)}${session.sessionTime ? ` · الحصة ${esc(session.sessionTime)}` : ''}
    </div>`;
}

function emptyRowHTML(colspan, message) {
  return `<tr><td colspan="${colspan}" style="text-align:center;color:#94a3b8;padding:20px">${esc(message)}</td></tr>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1) التقرير الكامل — كل الطلاب المؤهَّلين لهذه الجلسة (حاضر/متأخر) بدرجاتهم.
// ═══════════════════════════════════════════════════════════════════════════
export function openRecitationSessionReport({ session, group, roster = [], profile }) {
  const evaluated = roster.filter((r) => r.score !== null && r.score !== undefined);
  const notEvaluatedCount = roster.length - evaluated.length;

  const rows = roster.map((r) => {
    const done = r.score !== null && r.score !== undefined;
    const pct = done && r.maxScore ? scorePercent(r.score, r.maxScore) : null;
    return `
    <tr>
      <td>${esc(r.studentName)}</td>
      <td class="num">${done ? esc(r.score) : '—'}</td>
      <td class="num">${done ? esc(r.maxScore) : '—'}</td>
      <td class="num">${pct !== null ? `${pct}%` : '—'}</td>
      <td>${r.note ? esc(r.note) : '—'}</td>
      <td class="num">${done ? badgeHTML('تم التسميع', PALETTE.green) : badgeHTML('لم يُسمَّع', PALETTE.textFaint)}</td>
    </tr>`;
  }).join('');

  const bodyHTML = `
    ${reportHeaderHTML(profile)}
    ${sessionTitleBlock(session, group)}

    <div class="kpi-row">
      ${kpiHTML('الدرجة من', session.maxScore ?? '—', PALETTE.primary)}
      ${kpiHTML('إجمالي الطلاب', roster.length, PALETTE.blue)}
      ${kpiHTML('تم التسميع', evaluated.length, PALETTE.green)}
      ${kpiHTML('لم يُسمَّع', notEvaluatedCount, PALETTE.amber)}
    </div>

    <div class="section avoid-break">
      ${sectionTitleHTML('📋', 'كشف الطلاب', roster.length)}
      <table class="report-table">
        <thead><tr>
          <th>الطالب</th><th class="num">الدرجة</th><th class="num">من</th><th class="num">النسبة</th><th>ملاحظة</th><th class="num">الحالة</th>
        </tr></thead>
        <tbody>${rows || emptyRowHTML(6, 'لا يوجد طلاب حاضرون/متأخرون في هذه الجلسة')}</tbody>
      </table>
    </div>

    ${reportFooterHTML(profile)}
  `;

  openPrintWindow({ title: `تسميع — ${group?.name || session.groupId} — ${session.date}`, bodyHTML });
}

// ═══════════════════════════════════════════════════════════════════════════
// 2) غير المُقيَّمين فقط — بلا أعمدة درجة/نسبة (لا معنى لها هنا).
// ═══════════════════════════════════════════════════════════════════════════
export function openRecitationNotEvaluatedReport({ session, group, roster = [], profile }) {
  const notEvaluated = roster.filter((r) => r.score === null || r.score === undefined);
  const ATTENDANCE_STATUS_LABEL = { present: 'حاضر', late: 'متأخر' };

  const rows = notEvaluated.map((r) => `
    <tr>
      <td>${esc(r.studentName)}</td>
      <td class="num">${esc(ATTENDANCE_STATUS_LABEL[r.attendanceStatus] || r.attendanceStatus)}</td>
    </tr>`).join('');

  const bodyHTML = `
    ${reportHeaderHTML(profile)}
    ${sessionTitleBlock(session, group)}

    <div class="kpi-row">
      ${kpiHTML('غير مُقيَّم', notEvaluated.length, PALETTE.amber)}
      ${kpiHTML('من إجمالي', roster.length, PALETTE.blue)}
    </div>

    <div class="section avoid-break">
      ${sectionTitleHTML('⏳', 'طلاب لم يُسمَّعوا بعد', notEvaluated.length)}
      <table class="report-table">
        <thead><tr><th>الطالب</th><th class="num">الحالة</th></tr></thead>
        <tbody>${rows || emptyRowHTML(2, 'تم تسميع كل الطلاب — لا يوجد طلاب متبقّون')}</tbody>
      </table>
    </div>

    ${reportFooterHTML(profile)}
  `;

  openPrintWindow({ title: `غير المُقيَّمين — ${group?.name || session.groupId} — ${session.date}`, bodyHTML });
}

// ═══════════════════════════════════════════════════════════════════════════
// 3) الملخص — إحصائيات فقط، بلا جدول طلاب. المتوسط يُحسَب من المُقيَّمين فقط.
// ═══════════════════════════════════════════════════════════════════════════
export function openRecitationSummaryReport({ session, group, roster = [], profile }) {
  const evaluated = roster.filter((r) => r.score !== null && r.score !== undefined);
  const notEvaluatedCount = roster.length - evaluated.length;

  // لا نقسم أبداً على الروستر الكامل — فقط على من لهم درجة فعلية ودرجة كلية صالحة
  // (maxScore قد تكون null نظرياً قبل أي حفظ أول، رغم استحالة وجود صف مُقيَّم بلا max
  // score في الممارسة — الحارس هنا دفاعي بحت).
  const pcts = evaluated
    .filter((r) => r.maxScore)
    .map((r) => scorePercent(r.score, r.maxScore))
    .filter((p) => p !== null);
  const avgPct = pcts.length ? Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length) : null;

  const bodyHTML = `
    ${reportHeaderHTML(profile)}
    ${sessionTitleBlock(session, group)}

    <div class="section avoid-break">
      ${sectionTitleHTML('📊', 'ملخص الجلسة')}
      <div class="kpi-row">
        ${kpiHTML('إجمالي الطلاب', roster.length, PALETTE.blue)}
        ${kpiHTML('تم التسميع', evaluated.length, PALETTE.green)}
        ${kpiHTML('لم يُسمَّع', notEvaluatedCount, PALETTE.amber)}
        ${kpiHTML('متوسط النسبة', avgPct !== null ? `${avgPct}%` : '—', PALETTE.primary)}
      </div>
    </div>

    ${reportFooterHTML(profile)}
  `;

  openPrintWindow({ title: `ملخص التسميع — ${group?.name || session.groupId} — ${session.date}`, bodyHTML });
}
