// src/store/slices/activity.slice.js
// Activity log — cross-cutting concern, يُستخدم في كل module.
// Phase 3B-15: PostgreSQL هو مصدر الحقيقة الآن (activity_logs). لا localStorage
// إطلاقاً بعد الآن — لا قراءة أولية منه، ولا كتابة إليه عند النجاح أو الفشل. الخادم
// يشتقّ userId/userName من الجلسة دائماً (لا يُرسَلان من هنا كسلطة). فشل الكتابة
// يُرمى للمستدعي (لا يُبتلَع صامتاً هنا) — كل موقع استدعاء مسؤول عن معالجة الفشل
// (toast) بنفسه، لأن الـ slice نفسه لا يملك أي وصول لآلية toast (سياق React منفصل).
import { pgCreateActivityLog } from '../../services/api';
import { LOG_CONFIG } from '../../config/app.config';

const MAX_LOGS = LOG_CONFIG.MAX_LOGS;

export const createActivitySlice = (set) => ({
  activityLogs: [],

  // يُرجع الـ promise كاملاً — لا await هنا، ولا try/catch يُخفي الفشل. المستدعي يقرّر:
  // ينتظره ويعالج الفشل (toast)، أو يتركه fire-and-forget إن لم يكن هناك toast متاح
  // (ErrorBoundary/exportBackup، خارج React tree أو بلا سياق toast).
  addLog: (entry) => {
    return pgCreateActivityLog({
      action:      entry.action   || 'info',
      module:      entry.module   || '—',
      description: entry.description || '',
      entityType:  entry.entityType ?? null,
      entityId:    entry.entityId   ?? null,
    }).then((saved) => {
      set((state) => ({ activityLogs: [saved, ...state.activityLogs].slice(0, MAX_LOGS) }));
      return saved;
    });
  },
});
