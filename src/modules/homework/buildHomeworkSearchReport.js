// src/modules/homework/buildHomeworkSearchReport.js
// ─────────────────────────────────────────────────────────────────────────────
// Homework Phase 3A print — prints exactly the `rows` array it is given (already filtered by
// homeworkSearchService.filterHomeworkSubmissionRows on the search screen). No independent
// filtering logic exists here, so print can never diverge from what is on screen. Reuses the
// same unified print system (printStyles) as buildHomeworkReport.js/buildExamReport.js.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PALETTE, esc, fmtDateShort,
  basePrintCSS, reportHeaderHTML, reportFooterHTML,
  sectionTitleHTML, badgeHTML, toolbarHTML,
} from '../../utils/printStyles';
import { SUB_STATUS } from '../../services/homeworkService';

function wrapHTML({ title, bodyHTML }) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <title>${esc(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>
  <style>${basePrintCSS({ orientation: 'portrait' })}</style>
</head>
<body>
  ${toolbarHTML()}
  <div class="page">${bodyHTML}</div>
  <script>window.focus();</script>
</body>
</html>`;
}

function openWin(html) {
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) { alert('يرجى السماح بالنوافذ المنبثقة لطباعة التقرير.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/**
 * @param {object} args
 * @param {array}  args.rows     الصفوف المفلترة بالضبط كما تُعرَض على شاشة البحث — لا يُعاد فلترتها هنا إطلاقاً
 * @param {object} args.profile  بيانات المركز (centerProfile)
 */
export function openHomeworkSearchReportPrint({ rows, profile }) {
  const list = rows || [];

  const tableRows = list.map((r) => {
    const st = SUB_STATUS[r.status] || SUB_STATUS.missing;
    // لا تُلفَّق أي درجة لواجب لم يُصحَّح — score تأتي حرفياً كما هي (null => "—")
    const scoreLabel = r.score != null ? `${r.score}/${r.totalScore ?? '—'}` : '—';
    return `
    <tr>
      <td>${esc(fmtDateShort(r.homeworkDate))}</td>
      <td>${esc(r.homeworkTitle)}</td>
      <td>${esc(r.studentName)}</td>
      <td>${esc(r.grade || '—')}</td>
      <td class="num">${badgeHTML(st.label, st.color)}</td>
      <td class="num">${scoreLabel}</td>
    </tr>`;
  }).join('');

  const bodyHTML = `
    ${reportHeaderHTML(profile)}
    <div class="report-title">بحث الواجبات</div>

    <div class="section avoid-break">
      ${sectionTitleHTML('🔎', 'نتائج البحث', list.length)}
      <table class="report-table">
        <thead><tr>
          <th>تاريخ الواجب</th><th>عنوان الواجب</th><th>الطالب</th><th>الصف</th><th class="num">الحالة</th><th class="num">الدرجة</th>
        </tr></thead>
        <tbody>${tableRows || `<tr><td colspan="6" style="text-align:center;color:${PALETTE.textFaint}">لا توجد نتائج مطابقة</td></tr>`}</tbody>
      </table>
    </div>

    ${reportFooterHTML(profile)}
  `;

  openWin(wrapHTML({ title: 'بحث الواجبات', bodyHTML }));
}
