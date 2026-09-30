// src/store/data.context.jsx
// البيانات في Zustand (app.store.js) — localStorage يحفظ الحالة المحلية فقط (P2 Fix A).
import { useEffect, createContext } from 'react';
import { useAppStore } from './app.store';
import { storage } from '../hooks/useErrorHandler';

const DataContext = createContext(null);

// P2 Fix A — obsolete browser auto-backup key. Nothing reads it, it duplicated server-owned
// data (students/groups/attendance/exams/grades) and consumed localStorage quota. The writer
// is gone; this removes any copy left by earlier builds so existing installs get the space back.
const LEGACY_AUTOBACKUP_KEY = 'studix_autobackup';

export function DataProvider({ children }) {
  useEffect(() => {
    storage.remove(LEGACY_AUTOBACKUP_KEY);
  }, []);

  return <DataContext.Provider value={null}>{children}</DataContext.Provider>;
}

export function useData() {
  return useAppStore(s => s);
}
