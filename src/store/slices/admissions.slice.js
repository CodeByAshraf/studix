// src/store/slices/admissions.slice.js
// ─────────────────────────────────────────────────────────────────────────────
// شريحة القبول — Phase 3B-13A.
// admissions/admissionFollowups/admissionSystemLog: مصدر الحقيقة PostgreSQL الآن —
// صفوف بشكل الخادم فقط (bez followups/systemLog/payments مُضمَّنة). لا تعديل محلي إلا
// بعد نجاح الخادم (AdmissionsPage.jsx).
// admissionPayments: Phase 3B-14D — مصدر الحقيقة PostgreSQL الآن (كان
// admissionPaymentsLocal، محلياً بحتاً عمداً قبل هذه المرحلة — انظر تقرير قرار
// Phase 3B-13A للتاريخ، وتقرير Phase 3B-14D لتفاصيل الهجرة). صفوف بشكل الخادم فقط،
// تُزامَن الآن مع PostgreSQL (db.middleware.js's PG_COLLECTIONS) تماماً مثل admissions.
// العرض المركَّب (سجل قبول + متابعاته + سجله النظامي + دفعاته) يُشتَقّ فقط عند القراءة
// (composeAdmission في AdmissionsPage.jsx) — لا يُكتَب أبداً بشكل مركَّب لأي state هنا.
// ─────────────────────────────────────────────────────────────────────────────

import {
  INITIAL_ADMISSIONS,
  INITIAL_ADMISSION_FOLLOWUPS,
  INITIAL_ADMISSION_SYSTEM_LOG,
  INITIAL_ADMISSION_PAYMENTS_LOCAL,
} from '../../data/initialData';

export const createAdmissionsSlice = (set) => ({
  admissions:         INITIAL_ADMISSIONS,
  admissionFollowups: INITIAL_ADMISSION_FOLLOWUPS,
  admissionSystemLog: INITIAL_ADMISSION_SYSTEM_LOG,
  admissionPayments:  INITIAL_ADMISSION_PAYMENTS_LOCAL,

  setAdmissions: (valueOrUpdater) =>
    set((state) => ({
      admissions: typeof valueOrUpdater === 'function' ? valueOrUpdater(state.admissions) : valueOrUpdater,
    })),

  setAdmissionFollowups: (valueOrUpdater) =>
    set((state) => ({
      admissionFollowups: typeof valueOrUpdater === 'function' ? valueOrUpdater(state.admissionFollowups) : valueOrUpdater,
    })),

  setAdmissionSystemLog: (valueOrUpdater) =>
    set((state) => ({
      admissionSystemLog: typeof valueOrUpdater === 'function' ? valueOrUpdater(state.admissionSystemLog) : valueOrUpdater,
    })),

  setAdmissionPayments: (valueOrUpdater) =>
    set((state) => ({
      admissionPayments: typeof valueOrUpdater === 'function' ? valueOrUpdater(state.admissionPayments) : valueOrUpdater,
    })),
});
