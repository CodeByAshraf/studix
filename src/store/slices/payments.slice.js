// src/store/slices/payments.slice.js

export const createPaymentsSlice = (set) => ({
  payments: INITIAL_PAYMENTS,

  addPayment: (payment) =>
    set((state) => ({ payments: [payment, ...state.payments] })),

  updatePayment: (id, updates) =>
    set((state) => ({
      payments: state.payments.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    })),

  removePayment: (id) =>
    set((state) => ({ payments: state.payments.filter((p) => p.id !== id) })),

  setPayments: (paymentsOrUpdater) =>
    set((state) => ({
      payments:
        typeof paymentsOrUpdater === 'function'
          ? paymentsOrUpdater(state.payments)
          : paymentsOrUpdater,
    })),
});
import { INITIAL_PAYMENTS } from '../../data/initialData';
