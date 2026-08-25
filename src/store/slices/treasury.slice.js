// src/store/slices/treasury.slice.js
// Multi-Cashbox Architecture — V2
import {
  INITIAL_TREASURY_TXN_V2,
  INITIAL_CASHBOXES,
  INITIAL_TREASURY_META,
} from '../../data/initialData';
import { buildCashboxTxn, buildTransfer } from '../../services/cashboxService';

export const createTreasurySlice = (set, get) => ({
  // ── State ────────────────────────────────────────────────────
  cashboxes:    INITIAL_CASHBOXES,
  treasuryTxn:  INITIAL_TREASURY_TXN_V2,
  treasuryMeta: INITIAL_TREASURY_META, // legacy compat

  // ── Cashbox CRUD ─────────────────────────────────────────────
  addCashbox: (cashbox) =>
    set(s => ({ cashboxes: [...s.cashboxes, cashbox] })),

  updateCashbox: (id, updates) =>
    set(s => ({
      cashboxes: s.cashboxes.map(cb => cb.id === id ? { ...cb, ...updates } : cb),
    })),

  removeCashbox: (id) =>
    set(s => ({ cashboxes: s.cashboxes.filter(cb => cb.id !== id) })),

  setDefaultCashbox: (id) =>
    set(s => ({
      cashboxes: s.cashboxes.map(cb => ({ ...cb, isDefault: cb.id === id })),
    })),

  // ── Transaction CRUD ─────────────────────────────────────────
  addTreasuryTxn: (txn) => {
    // Enforce cashboxId — reject if missing
    if (!txn.cashboxId) {
      console.error('[Treasury] Rejected txn: missing cashboxId', txn);
      throw new Error('كل عملية مالية يجب أن تكون مرتبطة بخزنة');
    }
    set(s => ({ treasuryTxn: [...s.treasuryTxn, txn] }));
    return txn;
  },

  updateTreasuryTxn: (id, updates) =>
    set(s => ({
      treasuryTxn: s.treasuryTxn.map(t =>
        t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
      ),
    })),

  reverseTreasuryTxn: (txnId, reason, currentUserId) => {
    const txns = get().treasuryTxn;
    const original = txns.find(t => t.id === txnId);
    if (!original) throw { type:'NOT_FOUND', message:'العملية غير موجودة' };

    const reversalTxn = {
      ...buildCashboxTxn({
        cashboxId:   original.cashboxId,
        date:        new Date().toISOString().split('T')[0],
        type:        original.type === 'income' ? 'expense' : 'income',
        category:    original.category,
        description: `عكس: ${original.description}`,
        amount:      original.amount,
        method:      original.method,
        refType:     'reversal',
        refId:       original.id,
      }, currentUserId),
      reversalOf: original.id,
    };

    const updatedOriginal = {
      ...original,
      status:     'reversed',
      reversalId: reversalTxn.id,
      reversalReason: reason,
      updatedAt:  new Date().toISOString(),
    };

    set(s => ({
      treasuryTxn: [
        ...s.treasuryTxn.map(t => t.id === txnId ? updatedOriginal : t),
        reversalTxn,
      ],
    }));
    return { reversalTxn, updatedOriginal };
  },

  // ── Transfer between cashboxes (atomic) ──────────────────────
  transferBetweenCashboxes: (data, createdBy) => {
    const { cashboxes } = get();
    const fromCb = cashboxes.find(cb => cb.id === data.fromCashboxId);
    const toCb   = cashboxes.find(cb => cb.id === data.toCashboxId);

    const { outTxn, inTxn } = buildTransfer({
      ...data,
      fromName: fromCb?.name,
      toName:   toCb?.name,
    }, createdBy);

    set(s => ({
      treasuryTxn: [...s.treasuryTxn, outTxn, inTxn],
    }));

    return { outTxn, inTxn };
  },

  // ── Legacy compat ─────────────────────────────────────────────
  setTreasuryTxn: (v) => set(s => ({
    treasuryTxn: typeof v === 'function' ? v(s.treasuryTxn) : v,
  })),
  setTreasuryMeta: (v) => set(s => ({
    treasuryMeta: typeof v === 'function' ? v(s.treasuryMeta) : v,
  })),
  updateTreasuryMeta: (updates) => set(s => ({
    treasuryMeta: { ...s.treasuryMeta, ...updates },
  })),
  // approveTreasuryTxn/rejectTreasuryTxn (سير عمل pending/rejected) أُزيلا — قرار Phase
  // 3B-14B الصريح (Decision 1/3 المعتمَدان): لم يُستخدَما في أي واجهة إطلاقاً (تحقّق
  // مؤكَّد عبر grep قبل الإزالة)، ويناقضان chk_treasury_status الفعلي (active/cancelled
  // فقط). لا يُستبدَلان بشيء — لا سير موافقة حياً اليوم.
  //
  // addLinkedTxn/reverseLinkedTxn أُزيلا أيضاً — قرار Phase 3B-14C الصريح: كان
  // PaymentsPage.jsx مستدعيهما الوحيد (تحقّق مؤكَّد عبر grep قبل الإزالة)، واستدعاء
  // reverseLinkedTxn هناك كان أصلاً معطوباً بصمت (تعارض توقيع — تقرير تفتيش 3B-14C،
  // القسم 9) — لا يعتمد عليه شيء حي. حذف الدفعة واسترداد الدفعة أصبحا الآن عمليتين
  // ذرّيتين حقيقيتين على الخادم (backend/src/routes/payments.js)، لا محليتين.
});
