# دليل الترحيل — من useApp() إلى Zustand Selectors

## الهدف
كل مكون يُحوَّل من `useApp()` لـ selectors محددة يحقق:
- re-render فقط عند تغيير البيانات التي يقرأها فعلاً
- أداء أفضل بشكل قابل للقياس
- كود أوضح (كل مكون يُعلن بالضبط ما يحتاجه)

---

## القاعدة الأساسية

```js
// قبل — يُعيد render عند أي تغيير في الـ store
const { students, payments, navigate, currentUser } = useApp();

// بعد — يُعيد render فقط عند تغيير students
const students    = useAppStore(s => s.students);
const payments    = useAppStore(s => s.payments);
const { navigate } = useUI();
const { currentUser } = useAuth();
```

---

## جدول التحويل السريع

| من `useApp()`       | إلى                              | يُعيد render عند          |
|---------------------|----------------------------------|---------------------------|
| `students`          | `useAppStore(s => s.students)`   | تغيير students فقط        |
| `setStudents`       | `useAppStore(s => s.setStudents)`| **لا يُعيد render أبداً** |
| `groups`            | `useAppStore(s => s.groups)`     | تغيير groups فقط          |
| `payments`          | `useAppStore(s => s.payments)`   | تغيير payments فقط        |
| `attendance`        | `useAppStore(s => s.attendance)` | تغيير attendance فقط      |
| `exams`             | `useAppStore(s => s.exams)`      | تغيير exams فقط           |
| `grades`            | `useAppStore(s => s.grades)`     | تغيير grades فقط          |
| `homeworks`         | `useAppStore(s => s.homeworks)`  | تغيير homeworks فقط       |
| `addLog`            | `useAppStore(s => s.addLog)`     | **لا يُعيد render أبداً** |
| `navigate`          | `useUI().navigate`               | تغيير currentPage فقط     |
| `currentPage`       | `useUI().currentPage`            | تغيير currentPage فقط     |
| `theme`             | `useUI().theme`                  | تغيير theme فقط           |
| `currentUser`       | `useAuth().currentUser`          | login/logout فقط           |
| `canAccess`         | `useAuth().canAccess`            | **لا يُعيد render أبداً** |
| `isAdmin`           | `useAuth().isAdmin`              | login/logout فقط           |

---

## مثال عملي — تحويل مكون بسيط

### قبل
```jsx
import { useApp } from '../../context/AppContext';

export default function PaymentForm() {
  const { students, groups, payments, addLog, currentUser } = useApp();
  // ...
}
```

### بعد
```jsx
import { useAppStore } from '../../store/app.store';
import { useAuth }     from '../../store/auth.context';

export default function PaymentForm() {
  const students    = useAppStore(s => s.students);
  const groups      = useAppStore(s => s.groups);
  // payments غير محتاجة هنا؟ احذفها نهائياً
  const addLog      = useAppStore(s => s.addLog);
  const { currentUser } = useAuth();
  // ...
}
```

---

## مثال — مكون يحتاج عدة slices

```jsx
import { useAppStore }        from '../../store/app.store';
import { useShallow }         from 'zustand/react/shallow';

export default function GroupCard({ groupId }) {
  // useShallow: يُعيد render فقط عند تغيير students أو payments أو attendance
  // بدون useShallow: object جديد في كل render = re-render دائم
  const { students, payments, attendance } = useAppStore(
    useShallow(s => ({
      students:   s.students,
      payments:   s.payments,
      attendance: s.attendance,
    }))
  );
  // ...
}
```

---

## مثال — computed value (derived state)

```jsx
// بدلاً من حساب في المكون وتخزين في useMemo:
const activeStudents = useAppStore(s =>
  s.students.filter(s => s.status === 'active')
);
// Zustand يُعيد render فقط عند تغيير النتيجة (shallow compare)
```

---

## ترتيب الأولويات للتحويل

**أعلى أولوية (أكبر فائدة):**
1. `Dashboard.jsx` — يقرأ 6 slices، re-render كثير
2. `StudentReportPage.jsx` — يقرأ 10 slices
3. `ReportsPage.jsx` + sub-components
4. `TreasuryPage.jsx` — بيانات مالية حساسة

**أولوية متوسطة:**
5. `StudentsPage.jsx` / `GroupsPage.jsx`
6. `PaymentsPage.jsx`
7. `AttendancePage.jsx`

**أولوية منخفضة (يعمل بشكل كافٍ):**
8. باقي المكونات الصغيرة

---

## ملاحظة مهمة
المكونات التي لم تُحوَّل بعد تستمر في العمل عبر `useApp()` — لا يوجد breaking change.
