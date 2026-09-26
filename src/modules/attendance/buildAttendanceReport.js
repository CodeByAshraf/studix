// src/modules/attendance/buildAttendanceReport.js
// ─────────────────────────────────────────────────────────────────────────────
// تقرير الغياب — بخيارين:
//   1) بالمجموعة + حصة معيّنة: حالة كل طلاب المجموعة في حصة محددة (تاريخ).
//   2) بالطالب: كل غيابات/حضور الطالب عبر كل الحصص.
// يستخدم النظام الموحّد للطباعة (printStyles).
// ─────────────────────────────────────────────────────────────────────────────

import {
  PALETTE, esc, fmtDate, fmtDateShort,
  basePrintCSS, reportHeaderHTML, reportFooterHTML,
  kpiHTML, sectionTitleHTML, badgeHTML, toolbarHTML,
} from '../../utils/printStyles';

const STATUS_META = {
  present: { l:'حاضر',   c:PALETTE.green },
  absent:  { l:'غائب',   c:PALETTE.red },
  late:    { l:'متأخر',  c:PALETTE.amber },
};

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
// 1) تقرير بالمجموعة + حصة معيّنة (تاريخ محدد)
// ═══════════════════════════════════════════════════════════════════════════
// Group Closure (Attendance Integration) — eligibleStudentIds (fetched by the caller via
// pgGetEligibleStudentsForSession, attendanceEligibility.js on the server, evaluated
// against THIS report's own historical date — not today's current enrollment) replaces the
// old students.groupId===group.id filter. Unioned with anyone who actually has a recorded
// session for this exact group/date: a real persisted attendance record must never be
// silently dropped just because that student's enrollment state has since changed — this
// function stays a pure/sync renderer, so it never fetches eligibility itself.
export function openGroupSessionReport({ group, date, sessionTime, students, attendance, profile, eligibleStudentIds = [] }) {
  if (!group || !date) return;

  // سجلات هذه الحصة (نفس المجموعة والتاريخ، واختيارياً نفس الوقت)
  const sessionRecs = attendance.filter(r =>
    r.groupId === group.id &&
    r.date === date &&
    (!sessionTime || r.sessionTime === sessionTime)
  );

  const rosterIds = new Set(eligibleStudentIds);
  sessionRecs.forEach(r => rosterIds.add(r.studentId));
  const groupStudents = students.filter(s => rosterIds.has(s.id));

  const rows = groupStudents.map(s => {
    const rec = sessionRecs.find(r => r.studentId === s.id);
    const status = rec?.status || 'absent'; // بلا سجل = غائب
    return { student: s, status };
  });

  const present = rows.filter(r => r.status === 'present').length;
  const absent  = rows.filter(r => r.status === 'absent').length;
  const late    = rows.filter(r => r.status === 'late').length;
  const pct     = rows.length ? Math.round((present + late) / rows.length * 100) : null;

  // نعرض الغائبين والمتأخرين أولاً (الأهم للمتابعة)
  const order = { absent: 0, late: 1, present: 2 };
  const sorted = [...rows].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));

  const tableRows = sorted.map(r => {
    const st = STATUS_META[r.status] || STATUS_META.absent;
    return `
    <tr>
      <td>${esc(r.student.name)}</td>
      <td>${esc(r.student.code)}</td>
      <td>${esc(r.student.phone || '—')}</td>
      <td>${esc(r.student.parentPhone || '—')}</td>
      <td class="num">${badgeHTML(st.l, st.c)}</td>
    </tr>`;
  }).join('');

  const bodyHTML = `
    ${reportHeaderHTML(profile)}
    <div class="report-title">كشف حضور — ${esc(group.name)}</div>

    <div style="text-align:center;color:${PALETTE.textSoft};font-size:12px;margin-bottom:16px">
      ${fmtDate(date)}${sessionTime ? ` · الحصة ${esc(sessionTime)}` : ''}${group.grade ? ` · ${esc(group.grade)}` : ''}
    </div>

    <div class="kpi-row">
      ${kpiHTML('نسبة الحضور', pct != null ? pct + '%' : '—', pct != null && pct >= 80 ? PALETTE.green : pct >= 60 ? PALETTE.amber : PALETTE.red)}
      ${kpiHTML('حاضر', present, PALETTE.green)}
      ${kpiHTML('غائب', absent, PALETTE.red)}
      ${kpiHTML('متأخر', late, PALETTE.amber)}
    </div>

    <div class="section avoid-break">
      ${sectionTitleHTML('📋', 'كشف الطلاب', groupStudents.length)}
      <table class="report-table">
        <thead><tr>
          <th>الطالب</th><th>الكود</th><th>هاتف الطالب</th><th>هاتف ولي الأمر</th><th class="num">الحالة</th>
        </tr></thead>
        <tbody>${tableRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8">لا يوجد طلاب</td></tr>'}</tbody>
      </table>
    </div>

    ${reportFooterHTML(profile)}
  `;

  openWin(wrapHTML({ title: `حضور ${group.name} — ${date}`, bodyHTML }));
}

// ═══════════════════════════════════════════════════════════════════════════
// 2) تقرير بالطالب — كل غياباته/حضوره
// ═══════════════════════════════════════════════════════════════════════════
export function openStudentAttendanceReport({ student, group, attendance, profile }) {
  if (!student) return;

  const recs = attendance
    .filter(r => r.studentId === student.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const total   = recs.length;
  const present = recs.filter(r => r.status === 'present').length;
  const absent  = recs.filter(r => r.status === 'absent').length;
  const late    = recs.filter(r => r.status === 'late').length;
  const pct     = total ? Math.round((present + late) / total * 100) : null;

  const rows = recs.map(r => {
    const st = STATUS_META[r.status] || STATUS_META.absent;
    return `
    <tr>
      <td>${fmtDate(r.date)}</td>
      <td class="num">${r.sessionTime ? esc(r.sessionTime) : '—'}</td>
      <td class="num">${badgeHTML(st.l, st.c)}</td>
    </tr>`;
  }).join('');

  // قائمة أيام الغياب فقط (للمتابعة السريعة)
  const absentDays = recs.filter(r => r.status === 'absent');
  const absentList = absentDays.length
    ? absentDays.map(r => fmtDateShort(r.date)).join(' · ')
    : 'لا يوجد غياب';

  const bodyHTML = `
    ${reportHeaderHTML(profile)}
    <div class="report-title">سجل حضور الطالب — ${esc(student.name)}</div>

    <div style="text-align:center;color:${PALETTE.textSoft};font-size:12px;margin-bottom:16px">
      ${esc(student.code || '')} · ${esc(group?.name || '')}${student.grade ? ` · ${esc(student.grade)}` : ''}
    </div>

    <div class="kpi-row">
      ${kpiHTML('نسبة الحضور', pct != null ? pct + '%' : '—', pct != null && pct >= 80 ? PALETTE.green : pct >= 60 ? PALETTE.amber : PALETTE.red, `${total} حصة`)}
      ${kpiHTML('حاضر', present, PALETTE.green)}
      ${kpiHTML('غائب', absent, PALETTE.red)}
      ${kpiHTML('متأخر', late, PALETTE.amber)}
    </div>

    ${absent > 0 ? `
    <div class="section avoid-break">
      ${sectionTitleHTML('⚠️', 'أيام الغياب', absent)}
      <div style="padding:10px 14px;background:${PALETTE.red}0d;border:1px solid ${PALETTE.red}30;border-radius:8px;font-size:12px;color:${PALETTE.text};line-height:2">
        ${esc(absentList)}
      </div>
    </div>` : ''}

    <div class="section avoid-break">
      ${sectionTitleHTML('📅', 'كل الحصص', total)}
      <table class="report-table">
        <thead><tr><th>التاريخ</th><th class="num">الحصة</th><th class="num">الحالة</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" style="text-align:center;color:#94a3b8">لا يوجد سجل حضور</td></tr>'}</tbody>
      </table>
    </div>

    ${reportFooterHTML(profile)}
  `;

  openWin(wrapHTML({ title: `حضور ${student.name}`, bodyHTML }));
}
