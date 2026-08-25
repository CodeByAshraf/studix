// src/store/slices/centerProfile.slice.js
// ─────────────────────────────────────────────────────────────
// بيانات الطباعة — تظهر في رأس كل تقرير عند الطباعة
// تُحفظ في localStorage وتبقى بين الجلسات
// ─────────────────────────────────────────────────────────────
import { storage } from '../../hooks/useErrorHandler';

const STORAGE_KEY = 'tc_center_profile';

const DEFAULT_PROFILE = {
  name:     '',   // اسم المركز / المدرس
  slogan:   '',   // السلوجان
  address:  '',   // العنوان
  phone1:   '',   // تليفون 1
  phone2:   '',   // تليفون 2
  logoUrl:  '',   // base64 أو URL للوجو
};

export const createCenterProfileSlice = (set) => ({
  centerProfile: storage.get(STORAGE_KEY, DEFAULT_PROFILE),

  setCenterProfile: (updates) =>
    set((s) => {
      const next = typeof updates === 'function'
        ? updates(s.centerProfile)
        : { ...s.centerProfile, ...updates };
      storage.set(STORAGE_KEY, next);
      return { centerProfile: next };
    }),

  resetCenterProfile: () => {
    storage.remove(STORAGE_KEY);
    set({ centerProfile: { ...DEFAULT_PROFILE } });
  },
});
