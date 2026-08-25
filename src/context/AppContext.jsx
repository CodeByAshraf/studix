// src/context/AppContext.jsx
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  Compatibility Layer — لا تحذف هذا الملف
//
// هذا الملف أصبح مجرد re-export من store/index.js
// 56 مكون يستورد من '../context/AppContext' — نُبقيه حتى يتم ترحيلهم تدريجياً.
//
// خطة الإزالة:
//   كل مكون يُحدَّث ليستورد من '../store' مباشرةً
//   عند الوصول لصفر مستوردين → يُحذف هذا الملف
// ─────────────────────────────────────────────────────────────────────────────
export { useApp, useAuth, useUI, useData, AuthProvider, UIProvider, DataProvider } from '../store/index.js';

// AppProvider الآن هو wrapper يجمع الـ 3 providers — للتوافق مع أي كود قديم
// يستخدم <AppProvider> مباشرةً (مثل App.jsx القديم)
import { AuthProvider } from '../store/auth.context';
import { UIProvider   } from '../store/ui.context';
import { DataProvider } from '../store/data.context';
import { useAuth      } from '../store/auth.context';

function AuthBridge({ children }) {
  const { canAccess } = useAuth();
  return (
    <UIProvider canAccess={canAccess}>
      <DataProvider>
        {children}
      </DataProvider>
    </UIProvider>
  );
}

export function AppProvider({ children }) {
  return (
    <AuthProvider>
      <AuthBridge>
        {children}
      </AuthBridge>
    </AuthProvider>
  );
}
