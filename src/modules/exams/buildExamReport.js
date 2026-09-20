// src/modules/exams/buildExamReport.js
// ─────────────────────────────────────────────────────────────────────────────
// تقرير درجات الامتحانات — بخيارين:
//   1) بالطالب: طالب واحد في كل امتحاناته (بحسب صفه).
//   2) بامتحان معيّن: كل الطلاب المؤهَّلين لهذا الامتحان، مرتّبين.
// يستخدم النظام الموحّد للطباعة (printStyles).
//
// Exams Phase 2: الأهلية أصبحت عبر getExamEligibleStudents(exam, students) المشتركة
// (examService.js) — active && student.grade===exam.grade — لا المجموعة إطلاقاً.
// `group` يبقى مُمرَّراً في كلتا الدالتين فقط لعرضه كوسم تاريخي/مرجعي في رأس التقرير
// (قد يكون غائباً تماماً للامتحانات الجديدة)، مستقلاً تماماً عن حساب الأهلية.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PALETTE, esc, fmtDateShort,
  basePrintCSS, reportHeaderHTML, reportFooterHTML,
  kpiHTML, sectionTitleHTML, badgeHTML, toolbarHTML,
} from '../../utils/printStyles';
import { getExamEligibleStudents } from '../../services/examService';

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
  <style>
    /* Cairo — محلي بالكامل (بلا إنترنت). نفس الملفات الثلاثة المُجمَّعة فعلاً تحت
       public/fonts/cairo/ (انظر src/styles/styles.css) — نافذة الطباعة هذه مفتوحة
       بـ window.open('', ...) من نفس الأصل (origin) للتطبيق، فتحلّ روابط الجذر
       النسبية /fonts/... بشكل صحيح تماماً كأي مسار ثابت آخر يخدمه express.static. */
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:400; font-display:swap; src:url(/fonts/cairo/cairo-arabic.woff2) format('woff2'); unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:400; font-display:swap; src:url(/fonts/cairo/cairo-latin-ext.woff2) format('woff2'); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:400; font-display:swap; src:url(/fonts/cairo/cairo-latin.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:500; font-display:swap; src:url(/fonts/cairo/cairo-arabic.woff2) format('woff2'); unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:500; font-display:swap; src:url(/fonts/cairo/cairo-latin-ext.woff2) format('woff2'); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:500; font-display:swap; src:url(/fonts/cairo/cairo-latin.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:600; font-display:swap; src:url(/fonts/cairo/cairo-arabic.woff2) format('woff2'); unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:600; font-display:swap; src:url(/fonts/cairo/cairo-latin-ext.woff2) format('woff2'); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:600; font-display:swap; src:url(/fonts/cairo/cairo-latin.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:700; font-display:swap; src:url(/fonts/cairo/cairo-arabic.woff2) format('woff2'); unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:700; font-display:swap; src:url(/fonts/cairo/cairo-latin-ext.woff2) format('woff2'); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:700; font-display:swap; src:url(/fonts/cairo/cairo-latin.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:800; font-display:swap; src:url(/fonts/cairo/cairo-arabic.woff2) format('woff2'); unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:800; font-display:swap; src:url(/fonts/cairo/cairo-latin-ext.woff2) format('woff2'); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:800; font-display:swap; src:url(/fonts/cairo/cairo-latin.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:900; font-display:swap; src:url(/fonts/cairo/cairo-arabic.woff2) format('woff2'); unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:900; font-display:swap; src:url(/fonts/cairo/cairo-latin-ext.woff2) format('woff2'); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:900; font-display:swap; src:url(/fonts/cairo/cairo-latin.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  </style>
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

  // Exams Phase 2: امتحانات صف الطالب (student.grade) التي له فيها درجة — لا المجموعة.
  // group يبقى مُمرَّراً فقط لعرضه في رأس التقرير (وسم تاريخي/مرجعي)، مستقلاً تماماً عن
  // هذا الفلتر.
  const studentExams = exams
    .filter(e => e.grade === student.grade)
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
  if (!exam) return;

  // Exams Phase 2: الأهلية عبر getExamEligibleStudents(exam, students) — active &&
  // student.grade===exam.grade — لا المجموعة إطلاقاً. group يبقى مُمرَّراً فقط لعرضه في
  // رأس التقرير (وسم تاريخي/مرجعي)، مستقلاً تماماً عن هذا الفلتر.
  const eligibleStudents = getExamEligibleStudents(exam, students);

  // لكل طالب درجته في هذا الامتحان
  const rows = eligibleStudents.map(s => {
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
    <div class="report-title">${esc(exam.name)}${group?.name ? ` — ${esc(group.name)}` : ''}</div>

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
      ${sectionTitleHTML('🏆', 'ترتيب الطلاب', eligibleStudents.length)}
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

  openWin(wrapHTML({ title: group?.name ? `${exam.name} — ${group.name}` : exam.name, bodyHTML }));
}
