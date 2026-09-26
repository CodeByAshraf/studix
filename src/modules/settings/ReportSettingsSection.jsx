// src/modules/settings/ReportSettingsSection.jsx
// ─────────────────────────────────────────────────────────────
// تحكّم المدير في أقسام تقرير الطالب — أي قسم يظهر، عبر الأسطح الثلاثة معاً: الشاشة الحيّة
// (StudentReportPage)، التقرير الاحترافي (⭐ generateStudentReport)، والطباعة البسيطة
// (🖨 openStudentReportPrint). يستخدم محرّك إعدادات التقرير القائم بالفعل
// (buildReportConfig/DEFAULT_REPORT_CONFIG/REPORT_SECTIONS في src/reportEngine/
// reportMeta.js — مصدر واحد موثوق تستهلكه هذه الشاشة وStudentReportPage.jsx معاً)، ولا
// يخترع نظاماً موازياً — فقط يعرض/يحفظ/يصفّر reportConfig المخزَّن في app.store.js (انظر
// src/store/slices/reportSettings.slice.js لتفاصيل مبدأ التخزين المحلي + ترحيل المفاتيح
// القديمة).
//
// قبل هذه المراجعة، كان showFinancials/showPayments يخصّان "التقرير الاحترافي" فقط —
// تدقيق أثبت أن الشاشة الحيّة والطباعة البسيطة كانتا تعرضان البيانات المالية دائماً بصرف
// النظر عن الإعداد (خلل أصلي). الآن كل الأقسام المُعلَّمة "شاشة+PDF+طباعة" في
// REPORT_SECTIONS تُطبَّق على الأسطح الثلاثة معاً. استثناءان متبقّيان، موثَّقان صراحةً هنا
// لا مخفيّان:
//   - أقسام تحليلية خاصة بالتقرير الاحترافي فقط (الملخّص التنفيذي/درجة الصحة/سجل
//     التواصل/الرسوم البيانية/الملخّص الذكي) — لم تكن موجودة أصلاً في الشاشة الحيّة أو
//     الطباعة البسيطة، تبقى كذلك (قرار صريح خارج نطاق ضبط الرؤية).
//   - قسم الواجبات موجود في الشاشة الحيّة والطباعة البسيطة، غائب كلياً عن التقرير
//     الاحترافي (فجوة تغطية محتوى سابقة على هذه الميزة، لم تُضَف له).
//   - ملخّص واتساب (studentWhatsappService.js) يبقى مستقلاً تماماً كما كان — لا يقرأ
//     reportConfig إطلاقاً.
import { useState } from 'react';
import { useAppStore } from '../../store/app.store';
import { SectionBoundary } from '../../components/ErrorBoundary';
import { ConfirmModal } from '../../components/ui/Modal';
import { useToast } from '../../components/Toast';
import { REPORT_SECTIONS } from '../../reportEngine';

const SCOPE_LABEL = {
  all:           'الشاشة الحيّة + PDF + الطباعة',
  pdf:           'التقرير الاحترافي (PDF) فقط',
  'screen-print':'الشاشة الحيّة + الطباعة (غير موجود بعد في PDF)',
};

const SECTIONS = REPORT_SECTIONS;

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

function SectionRow({ icon, label, description, scope, checked, onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 4px', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 18, flexShrink: 0, width: 24, textAlign: 'center' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>{description}</div>
        <div style={{ fontSize: 10, color: 'var(--text3)', opacity: .75, marginTop: 3 }}>{SCOPE_LABEL[scope] || SCOPE_LABEL.all}</div>
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
            <div className="card-title">📄 أقسام تقرير الطالب</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              اختر الأقسام التي تظهر في تقرير الطالب — يشمل الشاشة الحيّة والتقرير الاحترافي والطباعة البسيطة معاً (باستثناء الأقسام الموضَّحة أدناه). لا يؤثر على ملخّص واتساب.
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
                scope={section.scope}
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
        message="سيتم إعادة كل أقسام تقرير الطالب للوضع الافتراضي (كل الأقسام مفعَّلة). هل تريد المتابعة؟"
        confirmLabel="نعم، أعد الضبط"
      />
    </SectionBoundary>
  );
}


export { SECTIONS as REPORT_SECTIONS };
