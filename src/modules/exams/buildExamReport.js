// src/modules/exams/buildExamReport.js
// ─────────────────────────────────────────────────────────────────────────────
// تقرير درجات الامتحانات — بخيارين:
//   1) بالطالب: طالب واحد في كل امتحاناته.
//   2) بالمجموعة + امتحان معيّن: كل طلاب المجموعة في امتحان محدد، مرتّبين.
// يستخدم النظام الموحّد للطباعة (printStyles).
// ─────────────────────────────────────────────────────────────────────────────

import {
  PALETTE, esc, fmtDateShort,
  basePrintCSS, reportHeaderHTML, reportFooterHTML,
  kpiHTML, sectionTitleHTML, badgeHTML, toolbarHTML,
} from '../../utils/printStyles';

function pct(score, total) {
  if (total == null || score == null) return null;
  return Math.round((score / total) * 100);
}
function letter(p) {
  if (p == null) return '—';
  if (p >= 90) return 'A+';
  if (p >= 80) return 'A';
  if (p >= 70) return 'B';
  if (p >= 60) return 'C';
  if (p >= 50) return 'D';
  return 'F';
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

// ═══════════════════════════════════════════════════════════════════════════
// 1) تقرير بالطالب — كل امتحاناته
// ═══════════════════════════════════════════════════════════════════════════
export function openStudentExamReport({ student, group, exams, grades, profile }) {
  if (!student) return;

  // امتحانات مجموعة الطالب التي له فيها درجة
  const studentExams = exams
    .filter(e => e.groupId === student.groupId)
    .map(e => {
      const g = grades.find(gr => gr.examId === e.id && gr.studentId === student.id);
      const absent = g?.absent || false;
      const score  = absent ? null : (g?.score ?? null);
      const p = absent ? null : pct(score, e.total);
      return { exam: e, score, absent, pct: p, hasGrade: !!g };
    })
    .filter(r => r.hasGrade)
    .sort((a, b) => new Date(a.exam.date) - new Date(b.exam.date));

  const graded = studentExams.filter(r => !r.absent && r.pct != null);
  const avg = graded.length ? Math.round(graded.reduce((s, r) => s + r.pct, 0) / graded.length) : null;
  const passed = graded.filter(r => r.score >= r.exam.pass).length;
  const best = graded.length ? Math.max(...graded.map(r => r.pct)) : null;

  const rows = studentExams.map(r => `
    <tr>
      <td>${esc(r.exam.name)}</td>
      <td>${esc(r.exam.subject || '—')}</td>
      <td>${fmtDateShort(r.exam.date)}</td>
      <td class="num">${r.absent ? '—' : `${r.score}/${r.exam.total}`}</td>
      <td class="num">${r.pct != null ? `<span style="color:${pctColor(r.pct)};font-weight:700">${r.pct}%</span>` : '—'}</td>
      <td class="num">${letter(r.pct)}</td>
      <td class="num">${r.absent ? badgeHTML('غائب', PALETTE.textFaint) : (r.score >= r.exam.pass ? badgeHTML('ناجح', PALETTE.green) : badgeHTML('راسب', PALETTE.red))}</td>
    </tr>`).join('');

  const bodyHTML = `
    ${reportHeaderHTML(profile)}
    <div class="report-title">تقرير درجات الطالب — ${esc(student.name)}</div>

    <div class="kpi-row">
      ${kpiHTML('عدد الامتحانات', studentExams.length, PALETTE.primary)}
      ${kpiHTML('المتوسط', avg != null ? avg + '%' : '—', pctColor(avg), `تقدير ${letter(avg)}`)}
      ${kpiHTML('ناجح في', `${passed}/${graded.length}`, PALETTE.green)}
      ${kpiHTML('أعلى درجة', best != null ? best + '%' : '—', PALETTE.blue)}
    </div>

    <div class="section avoid-break">
      ${sectionTitleHTML('📝', `${esc(student.code || '')} · ${esc(group?.name || '')}`, studentExams.length)}
      <table class="report-table">
        <thead><tr>
          <th>الامتحان</th><th>المادة</th><th>التاريخ</th>
          <th class="num">الدرجة</th><th class="num">النسبة</th><th class="num">التقدير</th><th class="num">الحالة</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8">لا توجد درجات مسجّلة</td></tr>'}</tbody>
      </table>
    </div>

    ${reportFooterHTML(profile)}
  `;

  openWin(wrapHTML({ title: `درجات ${student.name}`, bodyHTML }));
}

// ═══════════════════════════════════════════════════════════════════════════
// 2) تقرير بالمجموعة + امتحان معيّن — كل الطلاب مرتّبين
// ═══════════════════════════════════════════════════════════════════════════
export function openGroupExamReport({ group, exam, students, grades, profile }) {
  if (!group || !exam) return;

  const groupStudents = students.filter(s => s.groupId === group.id && s.status === 'active');

  // لكل طالب درجته في هذا الامتحان
  const rows = groupStudents.map(s => {
    const g = grades.find(gr => gr.examId === exam.id && gr.studentId === s.id);
    const absent = g?.absent || false;
    const score  = absent ? null : (g?.score ?? null);
    const p = absent ? null : pct(score, exam.total);
    return { student: s, score, absent, pct: p, hasGrade: !!g };
  }).sort((a, b) => {
    // ترتيب تنازلي بالدرجة؛ الغائب/غير المصحح في الآخر
    if (a.pct == null && b.pct == null) return 0;
    if (a.pct == null) return 1;
    if (b.pct == null) return -1;
    return b.pct - a.pct;
  });

  const graded = rows.filter(r => !r.absent && r.pct != null);
  const avg = graded.length ? Math.round(graded.reduce((s, r) => s + r.pct, 0) / graded.length) : null;
  const passed = graded.filter(r => r.score >= exam.pass).length;
  const highest = graded.length ? Math.max(...graded.map(r => r.score)) : null;
  const lowest  = graded.length ? Math.min(...graded.map(r => r.score)) : null;
  const absentCount = rows.filter(r => r.absent).length;

  const tableRows = rows.map((r, i) => {
    const rank = (!r.absent && r.pct != null) ? `${i + 1}` : '—';
    return `
    <tr>
      <td class="num" style="font-weight:700;color:${PALETTE.primaryDark}">${rank}</td>
      <td>${esc(r.student.name)}</td>
      <td>${esc(r.student.code)}</td>
      <td class="num">${r.absent ? '—' : (r.score != null ? `${r.score}/${exam.total}` : 'لم يُصحّح')}</td>
      <td class="num">${r.pct != null ? `<span style="color:${pctColor(r.pct)};font-weight:700">${r.pct}%</span>` : '—'}</td>
      <td class="num">${letter(r.pct)}</td>
      <td class="num">${r.absent ? badgeHTML('غائب', PALETTE.textFaint) : (r.pct == null ? badgeHTML('—', PALETTE.textFaint) : (r.score >= exam.pass ? badgeHTML('ناجح', PALETTE.green) : badgeHTML('راسب', PALETTE.red)))}</td>
    </tr>`;
  }).join('');

  const bodyHTML = `
    ${reportHeaderHTML(profile)}
    <div class="report-title">${esc(exam.name)} — ${esc(group.name)}</div>

    <div style="text-align:center;color:${PALETTE.textSoft};font-size:12px;margin-bottom:16px">
      ${esc(exam.subject || '')} · ${fmtDateShort(exam.date)} · الدرجة من ${esc(String(exam.total))} · النجاح من ${esc(String(exam.pass))}
    </div>

    <div class="kpi-row">
      ${kpiHTML('متوسط الفصل', avg != null ? avg + '%' : '—', pctColor(avg))}
      ${kpiHTML('ناجح', `${passed}/${graded.length}`, PALETTE.green, graded.length ? `${Math.round(passed / graded.length * 100)}%` : '')}
      ${kpiHTML('أعلى / أدنى', highest != null ? `${highest} / ${lowest}` : '—', PALETTE.blue)}
      ${kpiHTML('غائبون', absentCount, PALETTE.amber)}
    </div>

    <div class="section avoid-break">
      ${sectionTitleHTML('🏆', 'ترتيب الطلاب', groupStudents.length)}
      <table class="report-table">
        <thead><tr>
          <th class="num">الترتيب</th><th>الطالب</th><th>الكود</th>
          <th class="num">الدرجة</th><th class="num">النسبة</th><th class="num">التقدير</th><th class="num">الحالة</th>
        </tr></thead>
        <tbody>${tableRows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8">لا يوجد طلاب</td></tr>'}</tbody>
      </table>
    </div>

    ${reportFooterHTML(profile)}
  `;

  openWin(wrapHTML({ title: `${exam.name} — ${group.name}`, bodyHTML }));
}
