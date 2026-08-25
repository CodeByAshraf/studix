// src/hooks/useActivityLog.js
// ─────────────────────────────────────────────────────────────────────────────
// المرحلة 3: هذا الـ hook أصبح wrapper للـ Zustand store
//
// قبل: كان يحمل useState + localStorage مستقل
// بعد: يُعيد توجيه لـ useAppStore
//
// محفوظ للتوافق مع DataContext القديم الذي كان يستخدمه
// ─────────────────────────────────────────────────────────────────────────────
import { useAppStore } from '../store/app.store';

export default function useActivityLog() {
  const logs   = useAppStore((s) => s.activityLogs);
  const addLog = useAppStore((s) => s.addLog);
  return { logs, addLog };
}
