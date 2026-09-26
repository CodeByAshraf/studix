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
//
// Student Report Sections rework (unified visibility across all 3 surfaces — on-screen
// StudentReportPage, ⭐ Professional PDF, 🖨 Simple Print): a bug audit found showFinancials
// /showPayments only ever reached the Professional PDF — the on-screen page and Simple
// Print always rendered financial/payment data regardless of their state. Fixing that
// required two renamed keys (clearer, non-overlapping meaning, per the audit's naming
// review) and one new key:
//   - showFinancials    -> showFinancialSummary (same meaning: fee/paid/refunded/balance)
//   - showPayments      -> showPaymentHistory    (same meaning: chronological payment list)
//   - showHomework (new): homework/submissions — previously always-on everywhere (on-screen
//     tab + Simple Print), never independently toggleable, and never present at all in the
//     Professional PDF (a pre-existing content-parity gap, left as-is — see
//     ReportSettingsSection.jsx's header comment for the full scope decision).
// The two renames are NOT a breaking change for existing users — see
// src/store/slices/reportSettings.slice.js's migrateLegacyKeys(), which maps any
// previously-saved showFinancials/showPayments value onto the new keys on load.
export const DEFAULT_REPORT_CONFIG = Object.freeze({
  showSnapshot:         true,
  showHealthScore:      true,
  showProfile:          true,
  showFinancialSummary: true,
  showAttendance:       true,
  showExams:            true,
  showRecitation:       true,
  showHomework:         true,
  showPaymentHistory:   true,
  showCommunication:    true,
  showAcademicTimeline: true,
  showBooklets:         true,
  showCharts:           true,
  showEvaluation:       true,
  showSignature:        true,
});

// دمج إعدادات مخصّصة مع الافتراضية
export function buildReportConfig(overrides = {}) {
  return { ...DEFAULT_REPORT_CONFIG, ...overrides };
}

// ─────────────────────────────────────────────────────────────────────────────
// وصف كل قسم — مصدر واحد موثوق (single source of truth) يستهلكه:
//   - ReportSettingsSection.jsx (شاشة الإعدادات: تبديل كل قسم)
//   - StudentReportPage.jsx (فلترة التابات + بطاقات نظرة عامة)
// `scope: 'all'` = يظهر (أو يُخفى) في الشاشة الحيّة + التقرير الاحترافي + الطباعة البسيطة
// معاً بنفس المعنى. `scope: 'pdf'` = قسم تحليلي إضافي خاص بالتقرير الاحترافي فقط (لم يكن
// موجوداً أصلاً في الشاشة الحيّة أو الطباعة البسيطة قبل هذه الميزة). `scope: 'screen-print'`
// = عكسياً: قسم كان موجوداً بالفعل في الشاشة الحيّة والطباعة البسيطة (الواجبات) لكن غير
// موجود إطلاقاً في التقرير الاحترافي. كلا الحالتين فجوة تغطية محتوى موجودة مسبقاً، ليست
// ناتجة عن هذه الميزة — توسيعها للسطح الناقص تغيير منتج أكبر من نطاق ضبط الرؤية، خارج هذه
// المهمة عمداً (موثَّق أيضاً في التقرير النهائي).
export const REPORT_SECTIONS = Object.freeze([
  { key: 'showSnapshot',         icon: '⚡', label: 'الملخّص التنفيذي',        description: 'نظرة سريعة وشاملة على حالة الطالب في صفحة واحدة', scope: 'pdf' },
  { key: 'showHealthScore',      icon: '🎯', label: 'درجة الصحة الأكاديمية',  description: 'تقييم رقمي لأداء الطالب بناءً على الحضور والامتحانات والالتزام المالي', scope: 'pdf' },
  { key: 'showProfile',          icon: '👤', label: 'بيانات الطالب والمجموعة', description: 'الكود، ولي الأمر، المدرسة، المجموعة، والمدرّس — بيانات الهوية الأساسية (الاسم) تبقى ظاهرة دائماً لتحديد صاحب التقرير', scope: 'all' },
  { key: 'showFinancialSummary', icon: '💰', label: 'الملخّص المالي',          description: 'الرسوم الشهرية، المدفوع، المسترد، والرصيد الحالي', scope: 'all' },
  { key: 'showAttendance',       icon: '📅', label: 'الحضور',                 description: 'نسبة الحضور، الغياب المتتالي، واتجاه الحضور الشهري', scope: 'all' },
  { key: 'showExams',            icon: '📝', label: 'الامتحانات والدرجات',    description: 'درجات الامتحانات، المتوسط، ومعدل النجاح', scope: 'all' },
  { key: 'showRecitation',       icon: '🎤', label: 'التسميع',                description: 'سجل جلسات التسميع التاريخية، الدرجات، والمتوسط', scope: 'all' },
  { key: 'showHomework',         icon: '📋', label: 'الواجبات',               description: 'سجل تسليم الواجبات ودرجاتها', scope: 'screen-print' },
  { key: 'showPaymentHistory',   icon: '🧾', label: 'سجل المدفوعات',          description: 'قائمة زمنية بكل الدفعات والاستردادات', scope: 'all' },
  { key: 'showBooklets',         icon: '📚', label: 'المذكرات والمواد',       description: 'المذكرات الدراسية المسلَّمة للطالب وحالة دفعها', scope: 'all' },
  { key: 'showCommunication',    icon: '📞', label: 'سجل التواصل',            description: 'المكالمات والرسائل والزيارات مع ولي الأمر', scope: 'pdf' },
  { key: 'showAcademicTimeline', icon: '📜', label: 'الخط الزمني الأكاديمي',  description: 'أهم الأحداث الأكاديمية والمالية مرتَّبة زمنياً', scope: 'all' },
  { key: 'showCharts',           icon: '📊', label: 'الرسوم البيانية',        description: 'رسوم بيانية لأداء الامتحانات وتوزيع الحضور', scope: 'pdf' },
  { key: 'showEvaluation',       icon: '🧠', label: 'الملخّص الذكي',           description: 'تقييم عام تلقائي وملاحظات مبنية على البيانات الفعلية', scope: 'pdf' },
]);

// مرئي إلا لو أُطفئ صراحةً — نفس قاعدة `!== false` المُستخدَمة بالفعل في كل مكان يقرأ
// reportConfig (مفتاح جديد غائب من إعداد قديم محفوظ = true تلقائياً، لا undefined أبداً).
export function isSectionVisible(config, key) {
  return (config?.[key] ?? true) !== false;
}
