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
  buildPage, renderReport, buildReportMeta, buildReportConfig, isSectionVisible,
} from '../../reportEngine';

import {
  gatherStudentData, determineOverallStatus, buildAlerts,
  computeHealthScore, buildAiSummary,
} from './reportData';
import { DAYS_AR } from '../../services/groupService';
import { STAGES } from '../admissions/mockData';

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
  // cfg يُمرَّر الآن إلى snapshotPage (انظر تعليقها: يتحكّم في كل بطاقة/بيان داخلها حسب
  // قسمها الخاص، لا في ظهور الصفحة نفسها فقط — تُطفَأ الصفحة كاملة عبر showSnapshot كما
  // كانت بالضبط).
  // Print-quality audit fix — رقم الصفحة كان ثابتاً ("صفحة 1") بافتراض أن الملخّص
  // التنفيذي حاضر دائماً؛ عند إطفاء showSnapshot تختفي هذه الصفحة فعلياً لكن صفحة
  // التفاصيل التالية كانت لا تزال تحمل تسمية "صفحة 2" الثابتة، فيظهر تقرير من صفحة واحدة
  // مُرقَّمة "2" بلا صفحة 1 على الإطلاق. pages.length + 1 هنا يُحسَب من طول المصفوفة
  // الفعلي لحظة كل دفعة (push) — لا حاجة لمعرفة إجمالي الصفحات مسبقاً ولا لإطار تقسيم
  // صفحات جديد؛ نفس بنية pages[] الحالية تكفي.
  if (cfg.showSnapshot) {
    pages.push(
      buildPage({
        profile, meta,
        content: snapshotPage(data, cfg),
        pageLabel: `صفحة ${pages.length + 1} — الملخّص التنفيذي`,
        generatedBy,
      })
    );
  }

  // ── الصفحات التفصيلية ──
  const sections = [];
  if (cfg.showHealthScore)      sections.push(healthScoreSection(data));
  if (cfg.showProfile)          sections.push(profileSection(data));
  if (cfg.showProfile)          sections.push(primaryGroupHistorySection(data)); // نفس علم "بيانات الطالب والمجموعة" — امتداد طبيعي، لا إعداد جديد (Phase 2)
  if (cfg.showProfile)          sections.push(additionalGroupsSection(data)); // نفس علم "بيانات الطالب والمجموعة" — امتداد طبيعي، لا إعداد جديد
  if (cfg.showProfile)          sections.push(admissionSummarySection(data)); // نفس علم — قرار توثيقي، انظر تعليق admissionSummarySection (Phase 2)
  if (cfg.showFinancialSummary) sections.push(financialSection(data));
  if (cfg.showAttendance)       sections.push(attendanceSection(data));
  if (cfg.showExams)            sections.push(examsSection(data));
  if (cfg.showRecitation)       sections.push(recitationSection(data));
  if (cfg.showHomework)         sections.push(homeworkSection(data));
  if (cfg.showPaymentHistory)   sections.push(paymentsSection(data));
  if (cfg.showCommunication)    sections.push(communicationSection(data));
  if (cfg.showAcademicTimeline) sections.push(academicTimelineSection(data, cfg));
  if (cfg.showBooklets)         sections.push(bookletsSection(data));
  if (cfg.showCharts)           sections.push(chartsSection(data, cfg));
  if (cfg.showEvaluation)       sections.push(evaluationSection(data, cfg));
  if (cfg.showSignature)        sections.push(SignatureArea({ labels: ['المدرّس', 'السكرتارية', 'ولي الأمر'] }));

  pages.push(
    buildPage({ profile, meta, content: sections.join(''), pageLabel: `صفحة ${pages.length + 1} — التفاصيل`, generatedBy })
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
  const { student, group, parentName } = data;
  return SectionHeader({ icon: '👤', title: 'بيانات الطالب' }) +
    Grid(2, [
      InfoCard({
        title: 'المعلومات الأساسية',
        rows: [
          ['كود الطالب', student.code],
          ['الاسم الكامل', student.name],
          ['ولي الأمر', parentName || '—'],
          ['الصف', student.grade],
        ],
      }),
      InfoCard({
        title: 'بيانات إضافية',
        rows: [
          ['الهاتف', student.parentPhone || student.phone],
          ['المجموعة', group?.name || '—'],
          ['الحالة', student.status === 'active' ? 'نشط' : student.status],
          ['تاريخ الانضمام', student.enrollDate ? fmtDate(student.enrollDate) : '—'],
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

// ٤ب. التسميع — نفس نموذج examsSection أعلاه بالضبط: KPIRow + DataTable. كل صف recitationRows
// هو جلسة تاريخية مستقلة — لا دمج/تجميع لأكثر من جلسة في صف واحد إطلاقاً.
function recitationSection(data) {
  const { recitationRows, avgRecitationPct, evaluatedRecitationCount } = data;

  const kpis = recitationRows.length ? KPIRow([
    { label: 'إجمالي الجلسات', value: recitationRows.length, color: THEME.cyan, soft: THEME.cyanSoft, icon: '🎤' },
    { label: 'تم تقييمها', value: evaluatedRecitationCount, color: THEME.green, soft: THEME.greenSoft, icon: '✅' },
    { label: 'المتوسط', value: fmtPct(avgRecitationPct), color: THEME.accent, soft: THEME.accentSoft, icon: '📊' },
  ]) + Spacer(10) : '';

  return SectionHeader({ icon: '🎤', title: 'أداء التسميع', count: recitationRows.length }) +
    kpis +
    DataTable({
      columns: [
        { key: 'groupName', label: 'المجموعة' },
        { key: 'date', label: 'التاريخ', render: (r) => fmtDateShort(r.date) },
        { key: 'sessionTime', label: 'الحصة', render: (r) => r.sessionTime || '—' },
        { key: 'score', label: 'الدرجة', numeric: true },
        { key: 'maxScore', label: 'من', numeric: true },
        { key: 'pct', label: 'النسبة', numeric: true, render: (r) => fmtPct(r.pct) },
        { key: 'note', label: 'ملاحظة', render: (r) => r.note || '—' },
      ],
      rows: recitationRows,
      totals: avgRecitationPct != null ? { groupName: 'المتوسط', pct: fmtPct(avgRecitationPct) } : null,
      options: { emptyText: 'لا توجد جلسات تسميع مسجّلة' },
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
// Professional Report audit fix — كان هذا القسم يسرّب أسماء/درجات امتحانات وأحداث دفعات
// دائماً، بصرف النظر عن showExams/showPaymentHistory (مسار تسرّب ثالث لم يظهر إلا عبر
// اختبار على مستوى البيانات لا عنوان القسم — انظر تقرير المراجعة). تاريخ الانضمام يبقى
// ظاهراً دائماً (هوية/تسجيل، مثل بطاقة الطالب نفسها، لا قسم قابل للإخفاء بذاته).
function academicTimelineSection(data, cfg = {}) {
  const { student, exams, payments } = data;
  const events = [];
  if (student.enrollDate) events.push({ icon: '🎓', color: THEME.accent, title: 'الانضمام للسنتر', date: fmtDateShort(student.enrollDate) });
  if (isSectionVisible(cfg, 'showPaymentHistory')) {
    payments.filter((p) => p.type !== 'refund').slice(0, 3).forEach((p) =>
      events.push({ icon: '💰', color: THEME.green, title: 'دفعة', date: fmtDateShort(p.date || p.createdAt) })
    );
  }
  if (isSectionVisible(cfg, 'showExams')) {
    exams.forEach((e) =>
      events.push({ icon: '📝', color: THEME.purple, title: `امتحان: ${e.examName}`, description: `${e.score}/${e.total}`, date: fmtDateShort(e.date) })
    );
  }
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return SectionHeader({ icon: '📜', title: 'الخط الزمني الأكاديمي' }) +
    Timeline(events);
}

// ٨. سجل المذكرات (جدول)
const BOOKLET_PAY_STATUS_LABEL = { paid: 'مدفوع', partial: 'مدفوع جزئياً', unpaid: 'غير مدفوع' };

function bookletsSection(data) {
  const { bookletDeliveries } = data;
  return SectionHeader({ icon: '📚', title: 'سجل المذكرات', count: bookletDeliveries.length }) +
    DataTable({
      columns: [
        { key: 'number', label: 'رقم الحركة' },
        { key: 'date', label: 'تاريخ التسليم', render: (r) => fmtDateShort(r.date) },
        { key: 'quantity', label: 'الكمية', numeric: true },
        { key: 'employee', label: 'الموظف' },
        { key: 'materialName', label: 'المذكرة', render: (r) => r.materialName || '—' },
        { key: 'price', label: 'السعر', numeric: true, render: (r) => fmtMoney(r.price) },
        { key: 'payStatus', label: 'حالة الدفع', render: (r) => BOOKLET_PAY_STATUS_LABEL[r.payStatus] || r.payStatus },
        { key: 'paidAmount', label: 'المدفوع', numeric: true, render: (r) => fmtMoney(r.paidAmount) },
        { key: 'remaining', label: 'المتبقي', numeric: true, render: (r) => fmtMoney(r.remaining) },
      ],
      rows: bookletDeliveries,
      options: { emptyText: 'لا توجد مذكرات مسلّمة' },
    });
}

// ٩. الرسوم البيانية
// Professional Report audit fix — كان القسم يعرض أسماء/نسب امتحانات وتوزيع حضور خامَين
// دائماً، بصرف النظر عن showExams/showAttendance (مسار تسرّب رابع). كل رسم بياني مربوط
// الآن بعلم قسمه؛ لا شيء يُعاد إن لم يبقَ أي رسم ظاهر (بدل قسم فارغ بعنوان بلا محتوى).
function chartsSection(data, cfg = {}) {
  const { exams, attendance } = data;
  const parts = [];

  if (isSectionVisible(cfg, 'showExams') && exams.length > 0) {
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

  if (isSectionVisible(cfg, 'showAttendance')) {
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
  }

  if (!parts.length) return '';
  return SectionHeader({ icon: '📊', title: 'الرسوم البيانية' }) +
    Row(parts, { gap: 12 });
}

// ١٠. الملخّص التنفيذي الذكي (AI Summary) + التقييم
// Professional Report audit fix — cfg يمرَّر إلى buildAiSummary فيحذف كل جملة
// مالية/حضور/امتحانات/تواصل مولَّدة عن قسمها المُطفَأ (ثاني مسارَي التسرّب، انظر
// reportData.js's buildAiSummary). الحالة العامة (determineOverallStatus) تصنيف مشترك مع
// واتساب، غير مُعدَّلة.
function evaluationSection(data, cfg = {}) {
  const aiNotes = buildAiSummary(data, cfg);
  const status = determineOverallStatus(data);
  const st = STATUS_COLORS[status];
  return SectionHeader({ icon: '🧠', title: 'الملخّص التنفيذي الذكي' }) +
    SummaryBox({ title: `الحالة العامة: ${st.label}`, items: aiNotes, color: st.color, soft: st.soft });
}

// الواجبات — Professional Report audit fix (كان القسم غائباً كلياً عن التقرير الاحترافي
// رغم وجوده في الشاشة الحيّة/الطباعة البسيطة). data.hwRows من computeHomeworkRows
// المشتركة (reportData.js) — نفس خوارزمية الأهلية بالحرف (الصف لا المجموعة)، بلا نسخ.
const HW_STATUS_LABEL = { submitted: 'سُلِّم', late: 'متأخر', missing: 'لم يُسلَّم' };
const HW_STATUS_COLOR = { submitted: THEME.green, late: THEME.amber, missing: THEME.red };

function homeworkSection(data) {
  const { hwRows, hwSubmittedCount, hwLateCount, hwMissingCount } = data;

  const kpis = hwRows.length ? KPIRow([
    { label: 'سُلِّم', value: hwSubmittedCount, color: THEME.green, soft: THEME.greenSoft, icon: '✅' },
    { label: 'متأخر', value: hwLateCount, color: THEME.amber, soft: THEME.amberSoft, icon: '⏱' },
    { label: 'لم يُسلَّم', value: hwMissingCount, color: THEME.red, soft: THEME.redSoft, icon: '❌' },
  ]) + Spacer(10) : '';

  return SectionHeader({ icon: '📋', title: 'الواجبات', count: hwRows.length }) +
    kpis +
    DataTable({
      columns: [
        { key: 'title', label: 'الواجب', render: (r) => r.hw.title },
        { key: 'dueDate', label: 'موعد التسليم', render: (r) => fmtDateShort(r.hw.dueDate) },
        { key: 'submittedAt', label: 'تاريخ التسليم', render: (r) => (r.submittedAt ? fmtDateShort(r.submittedAt) : '—') },
        { key: 'status', label: 'الحالة', align: 'center', render: (r) =>
          StatusBadge({ label: HW_STATUS_LABEL[r.status] || r.status, color: HW_STATUS_COLOR[r.status] || THEME.muted, soft: `${HW_STATUS_COLOR[r.status] || THEME.muted}20` })
        },
        { key: 'score', label: 'الدرجة', numeric: true, render: (r) => (r.score != null ? `${r.score}/${r.hw.totalScore ?? '—'}` : '—') },
      ],
      rows: hwRows,
      options: { emptyText: 'لا توجد واجبات مسجّلة لصف الطالب' },
    });
}

// المجموعات الإضافية — Professional Report audit fix (كان التقرير يعرض المجموعة الرئيسية
// فقط). data.additionalEnrollments من gatherStudentData (student_group_enrollments —
// نفس الجدول ونفس تفسير role/status المُستخدَمين بالفعل في StudentProfile.jsx's
// GroupsTab)، يشمل التسجيلات التاريخية/المنتهية لا النشطة فقط، فلا تُفقَد صامتة.
// يتبع نفس علم showProfile (بيانات الطالب والمجموعة) — لا إعداد رؤية جديد مُخترَع، هذا
// امتداد طبيعي لمعنى القسم الحالي.
const ENROLLMENT_STATUS_LABEL = { active: 'نشط', withdrawn: 'منسحب', transferred: 'محوَّل' };

function additionalGroupsSection(data) {
  const { additionalEnrollments } = data;
  if (!additionalEnrollments || !additionalEnrollments.length) return '';

  return SectionHeader({ icon: '👥', title: 'المجموعات الإضافية', count: additionalEnrollments.length }) +
    DataTable({
      columns: [
        { key: 'groupName', label: 'المجموعة', render: (r) => r.group?.name || 'مجموعة غير معروفة' },
        { key: 'teacherName', label: 'المدرّس', render: (r) => r.group?.teacherName || '—' },
        { key: 'startDate', label: 'تاريخ البدء', render: (r) => (r.startDate ? fmtDateShort(r.startDate) : '—') },
        { key: 'endDate', label: 'تاريخ الانتهاء', render: (r) => (r.endDate ? fmtDateShort(r.endDate) : '—') },
        { key: 'status', label: 'الحالة', align: 'center', render: (r) =>
          StatusBadge({
            label: ENROLLMENT_STATUS_LABEL[r.status] || r.status,
            color: r.status === 'active' ? THEME.green : THEME.muted,
            soft: r.status === 'active' ? THEME.greenSoft : `${THEME.muted}20`,
          })
        },
        { key: 'attendDays', label: 'أيام الحضور', render: (r) =>
          Array.isArray(r.attendDays) && r.attendDays.length
            ? r.attendDays.map((d) => DAYS_AR[d] || d).join('، ')
            : '—'
        },
      ],
      rows: additionalEnrollments,
      options: { emptyText: 'لا توجد مجموعات إضافية' },
    });
}

// سجل المجموعة الأساسية — Student Report Phase 2. نفس جدول student_group_enrollments
// (role='primary' بدل 'additional' — data.primaryEnrollments، فلترة منفصلة تماماً في
// reportData.js، لا يُخلَط أبداً مع المجموعات الإضافية). يشمل التسجيل الرئيسي الحالي + كل
// تسجيل رئيسي سابق أُغلِق status='transferred' (setPrimaryGroupTx) — تاريخ التحويلات
// الكامل، لا الحالي فقط.
function primaryGroupHistorySection(data) {
  const { primaryEnrollments } = data;
  if (!primaryEnrollments || !primaryEnrollments.length) return '';

  return SectionHeader({ icon: '🏫', title: 'سجل المجموعة الأساسية', count: primaryEnrollments.length }) +
    DataTable({
      columns: [
        { key: 'groupName', label: 'المجموعة', render: (r) => r.group?.name || 'مجموعة غير معروفة' },
        { key: 'teacherName', label: 'المدرّس', render: (r) => r.group?.teacherName || '—' },
        { key: 'startDate', label: 'تاريخ البدء', render: (r) => (r.startDate ? fmtDateShort(r.startDate) : '—') },
        { key: 'endDate', label: 'تاريخ الانتهاء', render: (r) => (r.endDate ? fmtDateShort(r.endDate) : '—') },
        { key: 'status', label: 'الحالة', align: 'center', render: (r) =>
          StatusBadge({
            label: ENROLLMENT_STATUS_LABEL[r.status] || r.status,
            color: r.status === 'active' ? THEME.green : THEME.muted,
            soft: r.status === 'active' ? THEME.greenSoft : `${THEME.muted}20`,
          })
        },
      ],
      rows: primaryEnrollments,
      options: { emptyText: 'لا يوجد سجل مجموعة أساسية' },
    });
}

// ملخّص القبول — Student Report Phase 2. data.admission من bundle.admissions (FK حقيقي
// admissions.studentId، لا مطابقة بالاسم/الهاتف). نطاق أول مرحلة فقط: موعد الحجز/القبول،
// المرحلة الحالية، المصدر، تاريخ التحويل لطالب إن توفّر — بلا سجل متابعات/مدفوعات قبول/
// سجل نظامي (خارج نطاق هذه المرحلة عمداً). STAGES نفس تفسير المراحل المُستخدَم بالفعل في
// AdmissionsPage.jsx (src/modules/admissions/mockData.js) — لا تسميات جديدة مُخترَعة.
function admissionSummarySection(data) {
  const { admission } = data;
  if (!admission) return '';

  const stageLabel = STAGES[admission.stage]?.label || admission.stage || '—';
  // لا عمود "converted_at" مخصّص في admissions — lastModifiedAt وقت التحويل الفعلي لحظة
  // حدوثه (admissionActivation.js's تفعيل يكتبه صراحة)، لكنه يتحرّك مع أي تعديل لاحق على
  // نفس السجل أيضاً — تقريب مقبول موثَّق هنا صراحة، لا تاريخ تحويل مضمون الدقة للأبد.
  const conversionDate = admission.studentId && admission.lastModifiedAt ? fmtDate(admission.lastModifiedAt) : null;

  return SectionHeader({ icon: '📝', title: 'ملخّص القبول' }) +
    InfoCard({
      title: 'بيانات القبول',
      rows: [
        ['تاريخ الحجز/القبول', admission.reservationDate ? fmtDate(admission.reservationDate) : '—'],
        ['المرحلة الحالية', stageLabel],
        ['المصدر', admission.source || '—'],
        ...(conversionDate ? [['تاريخ التحويل لطالب', conversionDate]] : []),
      ],
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// صفحة الملخّص التنفيذي (snapshot) — نظرة سريعة في أقل من دقيقة
// ═══════════════════════════════════════════════════════════════════════════
// شبكة تتكيّف مع عدد العناصر الظاهرة فعلياً (بعد الفلترة بعلم كل قسم) — بلا هذا تترك
// CSS grid الثابتة (repeat(2,1fr)) خانة فارغة يتيمة حين يُخفى أحد القسمين، بدل إعادة توزيع
// العرض. لا شيء يُعاد إن لم يبقَ أي عنصر ظاهر (بدل بطاقة/شبكة فارغة).
function visibleGrid(items) {
  const visible = items.filter(Boolean);
  return visible.length ? Grid(visible.length, visible) : '';
}

// الملخّص التنفيذي (Snapshot) — Professional Report audit fix: كل بطاقة/بيان هنا مربوط
// الآن بعلم قسمه في reportConfig (cfg، اختياري — {} أو بلا تمرير = الكل ظاهر، نفس معاملة
// isSectionVisible في كل مكان آخر). كان هذا أول مسارَي التسرّب اللذين أثبتهما تدقيق
// المراجعة: الملخّص التنفيذي (showSnapshot) كان يعرض أرقاماً مالية/حضور/امتحانات/مذكرات
// /تواصل خامة دائماً، بصرف النظر عن حالة الأقسام المخصَّصة لها.
function snapshotPage(data, cfg = {}) {
  const { student, group, parentName, attendance, exams, examAvg, netPaid, monthlyFee, communications, bookletDeliveries } = data;
  const status = determineOverallStatus(data);
  const st = STATUS_COLORS[status];
  const alerts = buildAlerts(data, cfg);
  const pct = attendance.pct != null ? attendance.pct : 0;
  const attColor = pct >= 90 ? THEME.green : pct >= 75 ? THEME.accent : pct >= 50 ? THEME.amber : THEME.red;
  const lastFive = exams.slice(-5);
  const lastComm = communications[0];

  const showFinancial = isSectionVisible(cfg, 'showFinancialSummary');
  const showAttendance = isSectionVisible(cfg, 'showAttendance');
  const showExams = isSectionVisible(cfg, 'showExams');
  const showBooklets = isSectionVisible(cfg, 'showBooklets');
  const showCommunication = isSectionVisible(cfg, 'showCommunication');

  // شريط الحالة العامة (بارز) — تصنيف عام (ممتاز/جيد/...) لا رقماً خاماً، فلا يُعتبَر
  // تسرّباً لأي قسم مُطفَأ بذاته (نفس منطق determineOverallStatus المشترك مع واتساب —
  // غير مُعدَّل هنا إطلاقاً).
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

  const financialRows = [
    ...(showFinancial ? [
      ['الرسوم', fmtMoney(monthlyFee)],
      ['المدفوع (صافي)', fmtMoney(netPaid)],
      ['المتبقّي', fmtMoney(Math.max(0, monthlyFee - netPaid))],
    ] : []),
    ...(showExams ? [['عدد الامتحانات', exams.length]] : []),
    ...(showBooklets ? [['عدد المذكرات', bookletDeliveries.length]] : []),
  ];

  const topGrid = visibleGrid([
    InfoCard({
      title: '👤 معلومات الطالب',
      rows: [
        ['الاسم', student.name],
        ['الصف', student.grade],
        ['المجموعة', group?.name || '—'],
        ['المدرّس', data.student.teacherName || group?.teacherName || '—'],
        ['ولي الأمر', parentName || '—'],
      ],
    }),
    financialRows.length ? InfoCard({ title: '💰 الوضع المالي', rows: financialRows }) : null,
  ]);

  const attendanceColumn = showAttendance
    ? Column(Card(
        `<div style="text-align:center">
          <div style="font-size:9pt;color:${THEME.muted};margin-bottom:6px">📅 نسبة الحضور</div>
          ${DonutChart({ value: pct, label: `${attendance.present}/${attendance.total}`, color: attColor })}
        </div>`, { canBreak: false }
      ), { weight: 1, minWidth: 140 })
    : null;
  const examsColumn = showExams
    ? Column(
        InfoCard({
          title: '📝 آخر الامتحانات',
          rows: lastFive.length
            ? lastFive.map((e) => [e.examName, `${e.score}/${e.total} (${fmtPct(e.pct)})`])
            : [['—', 'لا توجد امتحانات']],
        }) + (examAvg != null ? `<div style="text-align:center;font-size:9pt;color:${THEME.muted};margin-top:6px">المتوسط: <strong style="color:${THEME.accent}">${fmtPct(examAvg)}</strong></div>` : ''),
        { weight: 2 }
      )
    : null;
  const attendanceExamsRow = (attendanceColumn || examsColumn)
    ? Spacer(12) + Row([attendanceColumn, examsColumn].filter(Boolean), { align: 'stretch' })
    : '';

  const bottomGrid = visibleGrid([
    showBooklets ? InfoCard({
      title: '📚 المذكرات المسلّمة',
      rows: bookletDeliveries.length
        ? bookletDeliveries.slice(0, 4).map((b) => [fmtDateShort(b.date), `الكمية: ${b.quantity}`])
        : [['—', 'لا توجد']],
    }) : null,
    showCommunication ? InfoCard({
      title: '📞 آخر تواصل ومتابعة',
      rows: lastComm
        ? [
            ['النوع', lastComm.reason || 'تواصل'],
            ['التاريخ', fmtDateShort(lastComm.createdAt)],
            ['الموظف', lastComm.employee || '—'],
            ['متابعة قادمة', lastComm.followupDate ? fmtDateShort(lastComm.followupDate) : '—'],
          ]
        : [['—', 'لا يوجد تواصل']],
    }) : null,
  ]);

  return SectionHeader({ icon: '⚡', title: 'الملخّص التنفيذي' }) +
    statusBanner +
    topGrid +
    attendanceExamsRow +
    (bottomGrid ? Spacer(12) + bottomGrid : '') +
    (alerts.length
      ? Spacer(12) + SummaryBox({ title: '⚠ تنبيهات نشطة', items: alerts, color: THEME.amber, soft: THEME.amberSoft })
      : '');
}
