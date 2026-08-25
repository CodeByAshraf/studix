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
// 1) تقرير بالمجموعة + حصة معيّنة (تاريخ محدد)
// ═══════════════════════════════════════════════════════════════════════════
export function openGroupSessionReport({ group, date, sessionTime, students, attendance, profile }) {
  if (!group || !date) return;

  // سجلات هذه الحصة (نفس المجموعة والتاريخ، واختيارياً نفس الوقت)
  const sessionRecs = attendance.filter(r =>
    r.groupId === group.id &&
    r.date === date &&
    (!sessionTime || r.sessionTime === sessionTime)
  );

  const groupStudents = students.filter(s => s.groupId === group.id && s.status === 'active');

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
