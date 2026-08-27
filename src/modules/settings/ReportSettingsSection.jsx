// src/modules/settings/ReportSettingsSection.jsx
// ─────────────────────────────────────────────────────────────
// تحكّم المدير في أقسام تقرير الطالب الاحترافي (⭐ تقرير احترافي PDF) — أي قسم يظهر عند
// توليده. يستخدم محرّك إعدادات التقرير القائم بالفعل (buildReportConfig/
// DEFAULT_REPORT_CONFIG في src/reportEngine/reportMeta.js)، ولا يخترع نظاماً موازياً —
// فقط يعرض/يحفظ/يصفّر reportConfig المخزَّن في app.store.js (انظر
// src/store/slices/reportSettings.slice.js لتفاصيل مبدأ التخزين المحلي).
//
// لا يخصّ هذا سوى "التقرير الاحترافي" (⭐ زر generateStudentReport) — كشف الطباعة البسيط
// (buildPrintReport.js، زر 🖨) وملخّص واتساب (studentWhatsappService.js) لا يقرآن هذا
// الإعداد إطلاقاً، غير متأثرين به بتاتاً (قرار صريح، خارج نطاق هذه الميزة).
import { useState } from 'react';
import { useAppStore } from '../../store/app.store';
import { SectionBoundary } from '../../components/ErrorBoundary';
import { ConfirmModal } from '../../components/ui/Modal';
import { useToast } from '../../components/Toast';

// كل قسم مُتاح للتحكّم فيه — المفتاح يطابق حرفياً علم (flag) في reportConfig، والعنوان
// يطابق عنوان القسم الفعلي كما يظهر في التقرير (SectionHeader) لسهولة الربط.
const SECTIONS = [
  { key: 'showSnapshot',        icon: '⚡', label: 'الملخّص التنفيذي',        description: 'نظرة سريعة وشاملة على حالة الطالب في صفحة واحدة' },
  { key: 'showHealthScore',     icon: '🎯', label: 'درجة الصحة الأكاديمية',  description: 'تقييم رقمي لأداء الطالب بناءً على الحضور والامتحانات والالتزام المالي' },
  { key: 'showProfile',         icon: '👤', label: 'بيانات الطالب',          description: 'المعلومات الأساسية: الكود، الاسم، ولي الأمر، الصف، المجموعة' },
  { key: 'showFinancials',      icon: '💰', label: 'الملخّص المالي',          description: 'الرسوم الشهرية، المدفوع، المسترد، والرصيد الحالي' },
  { key: 'showAttendance',      icon: '📅', label: 'تحليل الحضور',           description: 'نسبة الحضور، الغياب المتتالي، واتجاه الحضور الشهري' },
  { key: 'showExams',           icon: '📝', label: 'أداء الامتحانات',        description: 'درجات الامتحانات، المتوسط، ومعدل النجاح' },
  { key: 'showPayments',        icon: '🧾', label: 'سجل المدفوعات',          description: 'قائمة زمنية بكل الدفعات والاستردادات' },
  { key: 'showCommunication',   icon: '📞', label: 'سجل التواصل',            description: 'المكالمات والرسائل والزيارات مع ولي الأمر' },
  { key: 'showAcademicTimeline',icon: '📜', label: 'الخط الزمني الأكاديمي',  description: 'أهم الأحداث الأكاديمية والمالية مرتَّبة زمنياً' },
  { key: 'showBooklets',        icon: '📚', label: 'سجل المذكرات',           description: 'المذكرات الدراسية المسلَّمة للطالب' },
  { key: 'showCharts',          icon: '📊', label: 'الرسوم البيانية',        description: 'رسوم بيانية لأداء الامتحانات وتوزيع الحضور' },
  { key: 'showEvaluation',      icon: '🧠', label: 'الملخّص الذكي',           description: 'تقييم عام تلقائي وملاحظات مبنية على البيانات الفعلية' },
];

// مفتاح/زر تبديل (switch) بسيط — لا مكوّن Switch مشترك في src/components/ui بعد، فيُعرَّف
// محلياً هنا بنفس أسلوب Field المحلي في SettingsPage.jsx (مكوّن صغير خاص بملفه).
function ToggleSwitch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative', flexShrink: 0, width: 42, height: 24, borderRadius: 99,
        border: 'none', cursor: 'pointer', padding: 0,
        background: checked ? 'var(--accent)' : 'var(--border)',
        transition: 'background .15s',
      }}
    >
      <span style={{
        position: 'absolute', top: 3, [checked ? 'right' : 'left']: 3,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: 'inset-inline-start .15s, right .15s, left .15s',
      }}/>
    </button>
  );
}

function SectionRow({ icon, label, description, checked, onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 4px', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 18, flexShrink: 0, width: 24, textAlign: 'center' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>{description}</div>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} label={label}/>
    </div>
  );
}

export default function ReportSettingsSection() {
  const reportConfig      = useAppStore(s => s.reportConfig);
  const setReportConfig   = useAppStore(s => s.setReportConfig);
  const resetReportConfig = useAppStore(s => s.resetReportConfig);
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);

  const enabledCount = SECTIONS.filter(s => reportConfig[s.key] !== false).length;

  const handleToggle = (key, value) => {
    setReportConfig({ [key]: value });
  };

  const handleReset = () => {
    resetReportConfig();
    setConfirmReset(false);
    toast.success('تمّت إعادة أقسام التقرير للوضع الافتراضي');
  };

  return (
    <SectionBoundary label="Report Sections Settings">
      <div className="card">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div className="card-title">⭐ أقسام تقرير الطالب الاحترافي</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              اختر الأقسام التي تظهر عند توليد التقرير الاحترافي لأي طالب — لا يؤثر على كشف الطباعة البسيط أو ملخّص واتساب
            </div>
          </div>
          <div style={{
            fontSize: 11.5, fontWeight: 700, color: 'var(--accent)',
            background: 'var(--surface2)', padding: '4px 12px', borderRadius: 99,
            border: '1px solid var(--border)', whiteSpace: 'nowrap',
          }}>
            {enabledCount} من {SECTIONS.length} قسم مفعَّل
          </div>
        </div>
        <div className="card-body">
          <div>
            {SECTIONS.map(section => (
              <SectionRow
                key={section.key}
                icon={section.icon}
                label={section.label}
                description={section.description}
                checked={reportConfig[section.key] !== false}
                onChange={(value) => handleToggle(section.key, value)}
              />
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 14 }}>
            <button onClick={() => setConfirmReset(true)}
              style={{ padding: '9px 18px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Cairo, sans-serif' }}>
              ↺ إعادة الضبط الافتراضي
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={handleReset}
        title="إعادة ضبط أقسام التقرير"
        message="سيتم إعادة كل أقسام تقرير الطالب الاحترافي للوضع الافتراضي (كل الأقسام مفعَّلة). هل تريد المتابعة؟"
        confirmLabel="نعم، أعد الضبط"
      />
    </SectionBoundary>
  );
}


export { SECTIONS as REPORT_SECTIONS };
