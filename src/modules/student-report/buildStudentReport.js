// src/modules/student-report/buildStudentReport.js
// ═══════════════════════════════════════════════════════════════════════════
// تقرير الطالب — المرجع لكل التقارير المستقبلية.
// يُركّب بالكامل من مكوّنات محرّك التقارير — لا HTML خام إلا تجميع المكوّنات.
// 10 أقسام + صفحة snapshot تنفيذية.
// ═══════════════════════════════════════════════════════════════════════════

import {
  THEME, STATUS_COLORS,
  fmtDate, fmtDateShort, fmtMoney, fmtPct,
  ReportHeader, ReportFooter, SectionHeader,
  KPICard, KPIRow, InfoCard, DataTable,
  StatusBadge, ProgressBar, Timeline, SummaryBox, SignatureArea,
  LineChart, BarChart, DonutChart, GaugeChart,
  Grid, Row, Column, Stack, Card, Spacer, PageBreak,
  buildPage, renderReport, buildReportMeta, buildReportConfig,
} from '../../reportEngine';

import {
  gatherStudentData, determineOverallStatus, buildAlerts,
  computeHealthScore, buildAiSummary,
} from './reportData';

// ─────────────────────────────────────────────────────────────────────────────
// نقطة الدخول: يولّد التقرير ويفتح الطباعة
// ─────────────────────────────────────────────────────────────────────────────
export function generateStudentReport(studentId, store, { profile = {}, generatedBy = 'النظام', config = {} } = {}) {
  const data = gatherStudentData(studentId, store);
  if (!data) { alert('لم يتم العثور على بيانات الطالب'); return; }

  const cfg = buildReportConfig(config);
  const meta = buildReportMeta({
    title: `تقرير الطالب — ${data.student.name}`,
    profile, generatedBy, numberPrefix: 'STD',
  });

  const pages = [];

  // ── صفحة ١: الملخّص التنفيذي (Snapshot) — فهم الطالب في أقل من 10 ثوانٍ ──
  if (cfg.showSnapshot) {
    pages.push(
      buildPage({
        profile, meta,
        content: snapshotPage(data),
        pageLabel: 'صفحة 1 — الملخّص التنفيذي',
        generatedBy,
      })
    );
  }

  // ── الصفحات التفصيلية ──
  const sections = [];
  if (cfg.showEvaluation)       sections.push(healthScoreSection(data));
  if (cfg.showProfile)          sections.push(profileSection(data));
  if (cfg.showFinancials)       sections.push(financialSection(data));
  if (cfg.showAttendance)       sections.push(attendanceSection(data));
  if (cfg.showExams)            sections.push(examsSection(data));
  if (cfg.showPayments)         sections.push(paymentsSection(data));
  if (cfg.showCommunication)    sections.push(communicationSection(data));
  if (cfg.showAcademicTimeline) sections.push(academicTimelineSection(data));
  if (cfg.showBooklets)         sections.push(bookletsSection(data));
  if (cfg.showCharts)           sections.push(chartsSection(data));
  if (cfg.showEvaluation)       sections.push(evaluationSection(data));
  if (cfg.showSignature)        sections.push(SignatureArea({ labels: ['المدرّس', 'السكرتارية', 'ولي الأمر'] }));

  pages.push(
    buildPage({ profile, meta, content: sections.join(''), pageLabel: 'صفحة 2 — التفاصيل', generatedBy })
  );

  renderReport({ meta, pages });
}

// درجة الصحة الأكاديمية (gauge + تفصيل العوامل)
function healthScoreSection(data) {
  const hs = computeHealthScore(data);
  const color = hs.score >= 85 ? THEME.green : hs.score >= 70 ? THEME.accent : hs.score >= 50 ? THEME.amber : THEME.red;
  const breakdownBars = hs.breakdown.map((b) =>
    ProgressBar({ value: Math.round((b.score / b.max) * 100), color, label: `${b.label} (${b.score}/${b.max})` })
  ).join('');
  return SectionHeader({ icon: '🎯', title: 'درجة الصحة الأكاديمية' }) +
    Row([
      Column(
        Card(
          `<div style="text-align:center">${GaugeChart({ value: hs.score, max: 100, label: hs.interpretation })}</div>`,
          { canBreak: false }
        ),
        { weight: 1, minWidth: 180 }
      ),
      Column(
        Card(
          `<div style="font-size:9.5pt;font-weight:700;color:${THEME.ink};margin-bottom:8px">تفصيل العوامل</div>` + breakdownBars,
          { canBreak: false }
        ),
        { weight: 1 }
      ),
    ], { align: 'stretch' });
}

// ١. بطاقة ملف الطالب
function profileSection(data) {
  const { student, group } = data;
  return SectionHeader({ icon: '👤', title: 'بيانات الطالب' }) +
    Grid(2, [
      InfoCard({
        title: 'المعلومات الأساسية',
        rows: [
          ['كود الطالب', student.code],
          ['الاسم الكامل', student.name],
          ['ولي الأمر', student.parentName],
          ['الصف', student.grade],
        ],
      }),
      InfoCard({
        title: 'بيانات إضافية',
        rows: [
          ['الهاتف', student.parentPhone || student.phone],
          ['المجموعة', group?.name || '—'],
          ['الحالة', student.status === 'active' ? 'نشط' : student.status],
          ['تاريخ الانضمام', student.joinDate ? fmtDate(student.joinDate) : '—'],
        ],
      }),
    ]);
}

// ٢. الملخّص المالي (KPIs)
function financialSection(data) {
  const { monthlyFee, paidTotal, refundTotal, netPaid } = data;
  const remaining = Math.max(0, monthlyFee - netPaid);
  return SectionHeader({ icon: '💰', title: 'الملخّص المالي' }) +
    KPIRow([
      { label: 'الرسوم الشهرية', value: fmtMoney(monthlyFee), color: THEME.accent, soft: THEME.accentSoft, icon: '📋' },
      { label: 'المدفوع', value: fmtMoney(paidTotal), color: THEME.green, soft: THEME.greenSoft, icon: '✅' },
      { label: 'المسترد', value: fmtMoney(refundTotal), color: THEME.red, soft: THEME.redSoft, icon: '↩️' },
      {
        label: 'الرصيد الحالي', value: fmtMoney(netPaid),
        subtitle: remaining > 0 ? 'يوجد متبقٍّ' : 'مسدّد',
        color: THEME.purple, soft: THEME.purpleSoft, icon: '💵',
      },
    ]);
}

// ٣. تحليل الحضور (KPIs + progress bar + اتجاه + رسم شهري + ملاحظات)
function attendanceSection(data) {
  const { attendance, consecutiveAbsence, attendanceTrend, monthlyAttendance } = data;
  const pct = attendance.pct != null ? attendance.pct : 0;
  const absPct = attendance.total ? Math.round((attendance.absent / attendance.total) * 100) : 0;
  const color = pct >= 90 ? THEME.green : pct >= 75 ? THEME.accent : pct >= 50 ? THEME.amber : THEME.red;

  // ملاحظات تلقائية
  const notes = [];
  if (pct >= 90) notes.push('حضور ممتاز.');
  else if (pct < 60) notes.push('نسبة حضور منخفضة.');
  if (attendanceTrend != null && attendanceTrend <= -15) notes.push('الحضور في تراجع.');
  else if (attendanceTrend != null && attendanceTrend >= 15) notes.push('الحضور في تحسّن.');
  if (consecutiveAbsence >= 3) notes.push(`غياب متتالٍ (${consecutiveAbsence} حصص).`);

  const trendObj = attendanceTrend == null ? null
    : { dir: attendanceTrend > 0 ? 'up' : attendanceTrend < 0 ? 'down' : 'flat', text: `${Math.abs(attendanceTrend)}%` };

  const top = Row([
    Column(
      KPIRow([
        { label: 'إجمالي الحصص', value: attendance.total, color: THEME.accent, soft: THEME.accentSoft },
        { label: 'حضور', value: attendance.present, subtitle: fmtPct(pct), color: THEME.green, soft: THEME.greenSoft, trend: trendObj },
        { label: 'غياب', value: attendance.absent, subtitle: fmtPct(absPct), color: THEME.red, soft: THEME.redSoft },
        { label: 'غياب متتالٍ', value: consecutiveAbsence, color: THEME.amber, soft: THEME.amberSoft },
      ]) + Spacer(10) +
      ProgressBar({ value: pct, color, label: 'نسبة الحضور' }),
      { weight: 2 }
    ),
    Column(
      Card(`<div style="text-align:center">${DonutChart({ value: pct, label: 'الحضور', color })}</div>`, { canBreak: false }),
      { weight: 1, minWidth: 130 }
    ),
  ], { align: 'center' });

  // رسم الحضور الشهري
  const monthlyChart = monthlyAttendance.length >= 2
    ? Spacer(12) + Card(
        `<div style="font-size:9.5pt;font-weight:700;color:${THEME.ink};margin-bottom:8px">اتجاه الحضور الشهري</div>` +
        LineChart({ data: monthlyAttendance.map((m) => ({ label: m.month.slice(5), value: m.pct })), max: 100, color, unit: '%' }),
        { canBreak: false }
      )
    : '';

  const notesBox = notes.length ? Spacer(10) + SummaryBox({ items: notes, color, soft: pct >= 90 ? THEME.greenSoft : THEME.amberSoft }) : '';

  return SectionHeader({ icon: '📅', title: 'تحليل الحضور' }) + top + monthlyChart + notesBox;
}

// ٤. أداء الامتحانات (KPIs + جدول + متوسط)
function examsSection(data) {
  const { exams, examAvg, examHighest, examLowest, examSuccessRate, examTrend } = data;
  const trendObj = examTrend == null ? null
    : { dir: examTrend > 0 ? 'up' : examTrend < 0 ? 'down' : 'flat', text: `${Math.abs(examTrend)}%` };

  const kpis = exams.length ? KPIRow([
    { label: 'المتوسط', value: fmtPct(examAvg), color: THEME.accent, soft: THEME.accentSoft, icon: '📊', trend: trendObj },
    { label: 'الأعلى', value: fmtPct(examHighest), color: THEME.green, soft: THEME.greenSoft, icon: '⬆️' },
    { label: 'الأقل', value: fmtPct(examLowest), color: THEME.red, soft: THEME.redSoft, icon: '⬇️' },
    { label: 'معدل النجاح', value: fmtPct(examSuccessRate), color: THEME.purple, soft: THEME.purpleSoft, icon: '✅' },
  ]) + Spacer(10) : '';

  return SectionHeader({ icon: '📝', title: 'أداء الامتحانات', count: exams.length }) +
    kpis +
    DataTable({
      columns: [
        { key: 'examName', label: 'الامتحان' },
        { key: 'date', label: 'التاريخ', render: (r) => fmtDateShort(r.date) },
        { key: 'total', label: 'العظمى', numeric: true },
        { key: 'score', label: 'الدرجة', numeric: true },
        { key: 'pct', label: 'النسبة', numeric: true, render: (r) => fmtPct(r.pct) },
        { key: 'status', label: 'النتيجة', align: 'center', render: (r) =>
          r.passed
            ? StatusBadge({ label: 'ناجح', color: THEME.green, soft: THEME.greenSoft })
            : StatusBadge({ label: 'راسب', color: THEME.red, soft: THEME.redSoft })
        },
      ],
      rows: exams,
      totals: examAvg != null ? { examName: 'المتوسط', pct: fmtPct(examAvg) } : null,
      options: {
        emptyText: 'لا توجد امتحانات مسجّلة',
        highlightFn: (r) => (!r.passed ? THEME.redSoft : null),
      },
    });
}

// ٥. سجل المدفوعات (خط زمني)
function paymentsSection(data) {
  const { payments } = data;
  const items = payments
    .slice()
    .sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt))
    .map((p) => {
      const isRefund = p.type === 'refund';
      return {
        icon: isRefund ? '↩️' : '💰',
        color: isRefund ? THEME.red : THEME.green,
        title: `${isRefund ? 'استرداد' : 'دفعة'}: ${fmtMoney(Math.abs(p.amount))}`,
        description: p.receiptNo ? `إيصال: ${p.receiptNo}` : '',
        date: fmtDateShort(p.date || p.createdAt),
        employee: p.cashier || p.createdBy || '',
        note: p.notes || '',
      };
    });
  return SectionHeader({ icon: '🧾', title: 'سجل المدفوعات', count: payments.length }) +
    (items.length ? Timeline(items) : DataTable({ columns: [{ key: 'x', label: '' }], rows: [], options: { emptyText: 'لا توجد مدفوعات' } }));
}

// ٦. سجل التواصل (خط زمني)
function communicationSection(data) {
  const { communications } = data;
  const typeIcons = { phoneCall: '📞', whatsapp: '💬', sms: '✉️', email: '📧', parentVisit: '🏠', centerVisit: '🏢' };
  const items = communications.map((c) => ({
    icon: typeIcons[c.type] || '•',
    color: THEME.accent,
    title: c.reason || 'تواصل',
    description: c.notes || '',
    date: fmtDateShort(c.createdAt),
    employee: c.employee || '',
    note: c.followupDate ? `متابعة: ${fmtDateShort(c.followupDate)}` : '',
  }));
  return SectionHeader({ icon: '📞', title: 'سجل التواصل', count: communications.length }) +
    (items.length ? Timeline(items) : DataTable({ columns: [{ key: 'x', label: '' }], rows: [], options: { emptyText: 'لا يوجد تواصل مسجّل' } }));
}

// ٧. الخط الزمني الأكاديمي
function academicTimelineSection(data) {
  const { student, exams, payments } = data;
  const events = [];
  if (student.joinDate) events.push({ icon: '🎓', color: THEME.accent, title: 'الانضمام للسنتر', date: fmtDateShort(student.joinDate) });
  payments.filter((p) => p.type !== 'refund').slice(0, 3).forEach((p) =>
    events.push({ icon: '💰', color: THEME.green, title: 'دفعة', date: fmtDateShort(p.date || p.createdAt) })
  );
  exams.forEach((e) =>
    events.push({ icon: '📝', color: THEME.purple, title: `امتحان: ${e.examName}`, description: `${e.score}/${e.total}`, date: fmtDateShort(e.date) })
  );
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return SectionHeader({ icon: '📜', title: 'الخط الزمني الأكاديمي' }) +
    Timeline(events);
}

// ٨. سجل المذكرات (جدول)
function bookletsSection(data) {
  const { bookletDeliveries } = data;
  return SectionHeader({ icon: '📚', title: 'سجل المذكرات', count: bookletDeliveries.length }) +
    DataTable({
      columns: [
        { key: 'number', label: 'رقم الحركة' },
        { key: 'date', label: 'تاريخ التسليم', render: (r) => fmtDateShort(r.date) },
        { key: 'quantity', label: 'الكمية', numeric: true },
        { key: 'employee', label: 'الموظف' },
      ],
      rows: bookletDeliveries,
      options: { emptyText: 'لا توجد مذكرات مسلّمة' },
    });
}

// ٩. الرسوم البيانية
function chartsSection(data) {
  const { exams, attendance } = data;
  const parts = [];

  if (exams.length > 0) {
    parts.push(
      Column(
        Card(
          `<div style="font-size:9.5pt;font-weight:700;color:${THEME.ink};margin-bottom:8px">اتجاه أداء الامتحانات</div>` +
          LineChart({ data: exams.map((e) => ({ label: e.examName.slice(0, 8), value: e.pct })), max: 100, color: THEME.accent, unit: '%' }),
          { canBreak: false }
        )
      )
    );
  }

  const attData = [
    { label: 'حضور', value: attendance.present, color: THEME.green },
    { label: 'غياب', value: attendance.absent, color: THEME.red },
    { label: 'تأخّر', value: attendance.late, color: THEME.amber },
  ];
  const attMax = Math.max(1, attendance.total);
  parts.push(
    Column(
      Card(
        `<div style="font-size:9.5pt;font-weight:700;color:${THEME.ink};margin-bottom:8px">توزيع الحضور</div>` +
        BarChart({ data: attData, max: attMax, color: THEME.accent }),
        { canBreak: false }
      )
    )
  );

  return SectionHeader({ icon: '📊', title: 'الرسوم البيانية' }) +
    Row(parts, { gap: 12 });
}

// ١٠. الملخّص التنفيذي الذكي (AI Summary) + التقييم
function evaluationSection(data) {
  const aiNotes = buildAiSummary(data);
  const status = determineOverallStatus(data);
  const st = STATUS_COLORS[status];
  return SectionHeader({ icon: '🧠', title: 'الملخّص التنفيذي الذكي' }) +
    SummaryBox({ title: `الحالة العامة: ${st.label}`, items: aiNotes, color: st.color, soft: st.soft });
}

// ═══════════════════════════════════════════════════════════════════════════
// صفحة الملخّص التنفيذي (snapshot) — نظرة سريعة في أقل من دقيقة
// ═══════════════════════════════════════════════════════════════════════════
function snapshotPage(data) {
  const { student, group, attendance, exams, examAvg, netPaid, monthlyFee, communications, bookletDeliveries } = data;
  const status = determineOverallStatus(data);
  const st = STATUS_COLORS[status];
  const alerts = buildAlerts(data);
  const pct = attendance.pct != null ? attendance.pct : 0;
  const attColor = pct >= 90 ? THEME.green : pct >= 75 ? THEME.accent : pct >= 50 ? THEME.amber : THEME.red;
  const lastFive = exams.slice(-5);
  const lastComm = communications[0];

  // شريط الحالة العامة (بارز)
  const statusBanner = `
    <div style="background:${st.soft};border:2px solid ${st.color};border-radius:14px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div>
        <div style="font-size:9pt;color:${THEME.muted}">التقييم العام للطالب</div>
        <div style="font-size:18pt;font-weight:800;color:${st.color}">⭐ ${st.label}</div>
      </div>
      <div style="text-align:left">
        <div style="font-size:11pt;font-weight:800;color:${THEME.ink}">${student.name}</div>
        <div style="font-size:8.5pt;color:${THEME.muted}">${student.code} · ${group?.name || ''}</div>
      </div>
    </div>`;

  return SectionHeader({ icon: '⚡', title: 'الملخّص التنفيذي' }) +
    statusBanner +
    Grid(2, [
      InfoCard({
        title: '👤 معلومات الطالب',
        rows: [
          ['الاسم', student.name],
          ['الصف', student.grade],
          ['المجموعة', group?.name || '—'],
          ['المدرّس', data.student.teacherName || group?.teacherName || '—'],
          ['ولي الأمر', student.parentName],
        ],
      }),
      InfoCard({
        title: '💰 الوضع المالي',
        rows: [
          ['الرسوم', fmtMoney(monthlyFee)],
          ['المدفوع (صافي)', fmtMoney(netPaid)],
          ['المتبقّي', fmtMoney(Math.max(0, monthlyFee - netPaid))],
          ['عدد الامتحانات', exams.length],
          ['عدد المذكرات', bookletDeliveries.length],
        ],
      }),
    ]) + Spacer(12) +
    Row([
      Column(Card(
        `<div style="text-align:center">
          <div style="font-size:9pt;color:${THEME.muted};margin-bottom:6px">📅 نسبة الحضور</div>
          ${DonutChart({ value: pct, label: `${attendance.present}/${attendance.total}`, color: attColor })}
        </div>`, { canBreak: false }
      ), { weight: 1, minWidth: 140 }),
      Column(
        InfoCard({
          title: '📝 آخر الامتحانات',
          rows: lastFive.length
            ? lastFive.map((e) => [e.examName, `${e.score}/${e.total} (${fmtPct(e.pct)})`])
            : [['—', 'لا توجد امتحانات']],
        }) + (examAvg != null ? `<div style="text-align:center;font-size:9pt;color:${THEME.muted};margin-top:6px">المتوسط: <strong style="color:${THEME.accent}">${fmtPct(examAvg)}</strong></div>` : ''),
        { weight: 2 }
      ),
    ], { align: 'stretch' }) + Spacer(12) +
    Grid(2, [
      InfoCard({
        title: '📚 المذكرات المسلّمة',
        rows: bookletDeliveries.length
          ? bookletDeliveries.slice(0, 4).map((b) => [fmtDateShort(b.date), `الكمية: ${b.quantity}`])
          : [['—', 'لا توجد']],
      }),
      InfoCard({
        title: '📞 آخر تواصل ومتابعة',
        rows: lastComm
          ? [
              ['النوع', lastComm.reason || 'تواصل'],
              ['التاريخ', fmtDateShort(lastComm.createdAt)],
              ['الموظف', lastComm.employee || '—'],
              ['متابعة قادمة', lastComm.followupDate ? fmtDateShort(lastComm.followupDate) : '—'],
            ]
          : [['—', 'لا يوجد تواصل']],
      }),
    ]) +
    (alerts.length
      ? Spacer(12) + SummaryBox({ title: '⚠ تنبيهات نشطة', items: alerts, color: THEME.amber, soft: THEME.amberSoft })
      : '');
}
