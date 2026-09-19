// src/modules/homework/buildHomeworkReport.js
// ─────────────────────────────────────────────────────────────────────────────
// تقرير درجات الواجب — لواجب محدد (هدفه الآن السنة الدراسية + الصف)، كل الطلاب مرتّبين
// بالدرجة. يستخدم النظام الموحّد للطباعة (printStyles)، بنفس بنية buildExamReport.js's
// openGroupExamReport بالضبط.
//
// Homework 2.0 Phase 2: الأهلية أصبحت عبر getHomeworkEligibleStudents(hw, students)
// المشتركة (homeworkService.js) — active && student.grade===hw.grade — لا Group إطلاقاً.
// نفس الدالة المشتركة أصلَحت أيضاً خلل getHomeworkStats() المعروف سابقاً (كانت تقارن
// student.groupId بـ hw.id) — لم تعد هذه الملاحظة قائمة.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PALETTE, esc, fmtDateShort,
  basePrintCSS, reportHeaderHTML, reportFooterHTML,
  kpiHTML, sectionTitleHTML, badgeHTML, toolbarHTML,
} from '../../utils/printStyles';
import { SUB_STATUS, getHomeworkEligibleStudents } from '../../services/homeworkService';

function pct(score, total) {
  if (total == null || score == null || !total) return null;
  return Math.round((score / total) * 100);
}
function pctColor(p) {
  if (p == null) return PALETTE.textFaint;
  if (p >= 80) return PALETTE.green;
  if (p >= 60) return PALETTE.amber;
  return PALETTE.red;
}

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
 * @param {object} args.hw            الواجب المختار (title, subject, teacher, grade, academicYear, groupId, totalScore, dueDate)
 * @param {object} [args.group]       مجموعة الواجب التاريخية إن وُجدت (لعرض اسمها فقط — hw.grade هو مصدر الأهلية الفعلي الآن)
 * @param {array}  args.students      كل الطلاب
 * @param {array}  args.hwSubmissions كل تسليمات الواجبات (المصدر الوحيد للدرجة/الحالة)
 * @param {object} args.profile       بيانات المركز (centerProfile — الاسم يُعرَض كما هو حرفياً)
 */
export function openHomeworkReportPrint({ hw, group, students, hwSubmissions, profile }) {
  if (!hw) return;

  // Homework 2.0 Phase 2: grade-based eligibility (getHomeworkEligibleStudents) — never
  // Group-based. A student appears once regardless of how many Groups (Primary/Additional)
  // they hold or whether they hold any at all.
  const eligibleStudents = getHomeworkEligibleStudents(hw, students || []);

  const rows = eligibleStudents.map(s => {
    const sub = (hwSubmissions || []).find(x => x.hwId === hw.id && x.studentId === s.id);
    const status = sub?.status || 'missing';
    const score  = sub?.score ?? null;
    const p      = pct(score, hw.totalScore);
    return { student: s, status, score, pct: p };
  }).sort((a, b) => {
    // ترتيب تنازلي بالدرجة؛ من بلا درجة (لم يُصحَّح/لم يُسلَّم) في الآخر — نفس أسلوب
    // buildExamReport.js's openGroupExamReport بالضبط.
    if (a.pct == null && b.pct == null) return 0;
    if (a.pct == null) return 1;
    if (b.pct == null) return -1;
    return b.pct - a.pct;
  });

  const submitted = rows.filter(r => r.status === 'submitted').length;
  const late      = rows.filter(r => r.status === 'late').length;
  const missing   = rows.filter(r => r.status === 'missing').length;
  const scored    = rows.filter(r => r.pct != null);
  const avg       = scored.length ? Math.round(scored.reduce((s, r) => s + r.pct, 0) / scored.length) : null;
  const highest   = scored.length ? Math.max(...scored.map(r => r.score)) : null;
  const lowest    = scored.length ? Math.min(...scored.map(r => r.score)) : null;

  const tableRows = rows.map(r => {
    const st = SUB_STATUS[r.status] || SUB_STATUS.missing;
    return `
    <tr>
      <td>${esc(r.student.name)}</td>
      <td>${esc(r.student.code)}</td>
      <td class="num">${r.score != null ? `${r.score}/${hw.totalScore}` : '—'}</td>
      <td class="num">${r.pct != null ? `<span style="color:${pctColor(r.pct)};font-weight:700">${r.pct}%</span>` : '—'}</td>
      <td class="num">${badgeHTML(st.label, st.color)}</td>
    </tr>`;
  }).join('');

  const bodyHTML = `
    ${reportHeaderHTML(profile)}
    <div class="report-title">${esc(hw.title)}${group ? ` — ${esc(group.name)}` : ''}</div>

    <div style="text-align:center;color:${PALETTE.textSoft};font-size:12px;margin-bottom:16px">
      ${esc(hw.subject || '')} · موعد التسليم ${fmtDateShort(hw.dueDate)} · الدرجة من ${esc(String(hw.totalScore ?? '—'))}
    </div>

    <div class="kpi-row">
      ${kpiHTML('متوسط الدرجات', avg != null ? avg + '%' : '—', pctColor(avg))}
      ${kpiHTML('تم التسليم', `${submitted}/${eligibleStudents.length}`, PALETTE.green, `${late} متأخر`)}
      ${kpiHTML('أعلى / أدنى', highest != null ? `${highest} / ${lowest}` : '—', PALETTE.blue)}
      ${kpiHTML('لم يُسلَّم', missing, PALETTE.red)}
    </div>

    <div class="section avoid-break">
      ${sectionTitleHTML('📝', 'درجات الطلاب', eligibleStudents.length)}
      <table class="report-table">
        <thead><tr>
          <th>الطالب</th><th>الكود</th><th class="num">الدرجة</th><th class="num">النسبة</th><th class="num">الحالة</th>
        </tr></thead>
        <tbody>${tableRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">لا يوجد طلاب</td></tr>'}</tbody>
      </table>
    </div>

    ${reportFooterHTML(profile)}
  `;

  openWin(wrapHTML({ title: `درجات ${hw.title}`, bodyHTML }));
}
