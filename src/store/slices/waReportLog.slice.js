// src/store/slices/waReportLog.slice.js
// ─────────────────────────────────────────────────────────────────────────────
// سجل تدقيق رسائل واتساب لتقارير الطلاب — مستقل تماماً.
// ليس مركز التواصل، ولا الخط الزمني، ولا CRM ولي الأمر. سجل داخلي فقط.
// ─────────────────────────────────────────────────────────────────────────────

import { INITIAL_WA_REPORT_LOG } from '../../data/initialData';

export const createWaReportLogSlice = (set) => ({
  waReportLog: INITIAL_WA_REPORT_LOG,

  // إضافة قيد تدقيق (عند فتح واتساب)
  addWaReportLog: (entry) =>
    set((s) => ({ waReportLog: [entry, ...s.waReportLog] })),
});
