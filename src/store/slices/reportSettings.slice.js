// src/store/slices/reportSettings.slice.js
// ─────────────────────────────────────────────────────────────
// إعدادات أقسام التقرير الاحترافي (Professional Student Report) — أي الأقسام تظهر عند
// توليده. نفس نمط centerProfile.slice.js بالضبط (مفتاح localStorage مخصّص + دمج داخل
// studix-v1 عبر partialize في app.store.js).
//
// محلية فقط عمداً (بلا مزامنة خادم/PostgreSQL): center_profile (الجدول الوحيد المُخصَّص
// فعلياً لإعدادات تنظيمية مُدارة من واجهة الإعدادات) لا يملك أي عمود مرن (JSON) لتخزين
// هذه الإعدادات فيه بلا ترحيل جديد — وإضافة عمود/جدول جديد تتطلّب تعديل schema.prisma +
// migration جديدة، خارج نطاق هذه الميزة تماماً (قرار صريح: لا تغييرات على قاعدة البيانات
// إلا لو أثبتت البنية الحالية أنها ضرورية — لم تثبت ذلك هنا). النتيجة: هذا الإعداد محلي
// (لكل متصفّح/جهاز)، تماماً مثل centerProfile محلياً قبل مزامنته بالخادم — نطاق مقبول
// لتطبيق محلي لكل مركز أساساً (نفس النموذج الموثَّق للمشروع بالكامل).
//
// دمج القيم المخزَّنة مع الافتراضية عند القراءة (لا storage.get مباشرة) — يضمن أن أي علم
// (flag) جديد يُضاف مستقبلاً لـ DEFAULT_REPORT_CONFIG يصل تلقائياً بقيمته الافتراضية حتى
// للمستخدمين الذين حفظوا إعداداً قديماً لا يتضمّنه، بدل أن يبقى undefined إلى الأبد.
import { storage } from '../../hooks/useErrorHandler';
import { DEFAULT_REPORT_CONFIG } from '../../reportEngine/reportMeta';

const STORAGE_KEY = 'tc_report_config';

function loadInitialReportConfig() {
  const stored = storage.get(STORAGE_KEY, {});
  return { ...DEFAULT_REPORT_CONFIG, ...stored };
}

export const createReportSettingsSlice = (set) => ({
  reportConfig: loadInitialReportConfig(),

  setReportConfig: (updates) =>
    set((s) => {
      const next = typeof updates === 'function'
        ? updates(s.reportConfig)
        : { ...s.reportConfig, ...updates };
      storage.set(STORAGE_KEY, next);
      return { reportConfig: next };
    }),

  resetReportConfig: () => {
    storage.remove(STORAGE_KEY);
    set({ reportConfig: { ...DEFAULT_REPORT_CONFIG } });
  },
});
