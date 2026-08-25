// src/store/data.context.jsx
// LocalStorage version — البيانات تُحفظ في Zustand (persist في localStorage)
import { useEffect, createContext } from 'react';
import { useAppStore } from './app.store';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const saveAutoBackup = useAppStore(s => s.saveAutoBackup);

  // auto-backup مرة واحدة عند mount
  useEffect(() => {
    saveAutoBackup?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <DataContext.Provider value={null}>{children}</DataContext.Provider>;
}

export function useData() {
  return useAppStore(s => s);
}
