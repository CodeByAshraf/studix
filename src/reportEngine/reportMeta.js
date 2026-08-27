// src/reportEngine/reportMeta.js
// ═══════════════════════════════════════════════════════════════════════════
// ميتاداتا التقرير + كائن الإعدادات (config).
// كل تقرير يعرّف ميتاداتا موحّدة وإعدادات تسمح بنسخ مختلفة لاحقاً.
// ═══════════════════════════════════════════════════════════════════════════

let counter = 0;

// توليد رقم تقرير مقروء: RPT-YYYYMMDD-XXXX
function genReportNumber(prefix = 'RPT') {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  counter = (counter + 1) % 10000;
  const seq = String(Date.now() % 10000).padStart(4, '0');
  return `${prefix}-${ymd}-${seq}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// بناء ميتاداتا التقرير — يدمج بيانات السنتر مع بيانات التقرير
// ─────────────────────────────────────────────────────────────────────────────
export function buildReportMeta({
  title,
  reportNumber = null,
  generatedBy = 'النظام',
  profile = {},
  orientation = 'portrait',
  pageSize = 'A4',
  numberPrefix = 'RPT',
} = {}) {
  return {
    title,
    reportNumber: reportNumber || genReportNumber(numberPrefix),
    generatedAt: new Date().toISOString(),
    generatedBy,
    centerName: profile.name || '',
    teacherName: profile.teacherName || '',
    subject: profile.subject || '',
    academicYear: profile.academicYear || '',
    orientation,
    pageSize,
    // خيارات تصدير مستقبلية
    exportOptions: {
      print: true,
      downloadPdf: true,
      emailAttachment: false, // مستقبلاً
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// إعدادات التقرير الافتراضية — تسمح بنسخ مختلفة (كامل/مختصر/مالي...)
// ─────────────────────────────────────────────────────────────────────────────
// showHealthScore is a distinct flag from showEvaluation (added for the configurable
// Student Report settings feature — see src/modules/settings/ReportSettingsSection.jsx):
// buildStudentReport.js previously gated BOTH the "درجة الصحة الأكاديمية" (Health Score)
// section AND the "الملخص التنفيذي الذكي" (AI Summary) section behind the single
// showEvaluation flag, making them impossible to toggle independently even though they are
// presented as two separate settings. showHealthScore now gates only the Health Score
// section; showEvaluation continues to gate only the AI Summary section (its original,
// narrower meaning). Both default to true, so default behavior is unchanged.
export const DEFAULT_REPORT_CONFIG = Object.freeze({
  showSnapshot:      true,
  showHealthScore:   true,
  showProfile:       true,
  showFinancials:    true,
  showAttendance:    true,
  showExams:         true,
  showPayments:      true,
  showCommunication: true,
  showAcademicTimeline: true,
  showBooklets:      true,
  showCharts:        true,
  showEvaluation:    true,
  showSignature:     true,
});

// دمج إعدادات مخصّصة مع الافتراضية
export function buildReportConfig(overrides = {}) {
  return { ...DEFAULT_REPORT_CONFIG, ...overrides };
}
