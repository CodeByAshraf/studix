// src/hooks/usePayments.js
// المرحلة 3: Zustand selectors بدلاً من useApp()
// كل selector مستقل — re-render مضبوط per-slice
import { useCallback }        from 'react';
import { useAppStore }        from '../store/app.store';
import { useAuth }            from '../store/auth.context';
import { useToast }           from '../components/Toast';
import { useErrorHandler }    from './useErrorHandler';
import {
  createPayment, getMonthlyRevenue, getUnpaidStudents,
} from '../services/paymentService';

export default function usePayments() {
  // Granular subscriptions
  const payments    = useAppStore((s) => s.payments);
  const students    = useAppStore((s) => s.students);
  const groups      = useAppStore((s) => s.groups);
  const setPayments = useAppStore((s) => s.setPayments);
  const addLog      = useAppStore((s) => s.addLog);

  const { currentUser } = useAuth();
  const toast           = useToast();
  const { loading, run }= useErrorHandler(toast);

  const addPayment = useCallback(async (formData) => {
    return run(async () => {
      const student = students.find((s) => s.id === formData.studentId);
      const group   = groups.find((g)   => g.id === student?.groupId);
      const payment = createPayment(formData, student, group);
      setPayments((prev) => [payment, ...prev]);
      addLog({
        userName:    currentUser?.id,
        action:      'create',
        module:      'payments',
        description: `دفعة: ${student?.name} — ${payment.amount} ج.م`,
      });
      toast.success('تم تسجيل الدفعة بنجاح ✓');
      return payment;
    }, { errorMsg: 'فشل تسجيل الدفعة' });
  }, [students, groups, setPayments, run, toast, addLog, currentUser]);

  const getRevenue = useCallback(
    (month) => getMonthlyRevenue(payments, month),
    [payments],
  );

  const getUnpaid = useCallback(
    (month) => getUnpaidStudents(students, payments, month),
    [students, payments],
  );

  return { payments, addPayment, getRevenue, getUnpaid, loading };
}
