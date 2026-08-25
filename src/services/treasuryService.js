// src/services/treasuryService.js
import { validate, hasErrors, sanitizeFormData, treasurySchema } from '../utils/validation';

// ── Category definitions ─────────────────────────────────────
export const INCOME_CATEGORIES = {
  subscriptions: { label: 'اشتراكات الطلاب',   icon: '🎓', color: '#10b981' },
  materials:     { label: 'بيع المذكرات',       icon: '📚', color: '#3b82f6' },
  exams:         { label: 'رسوم الامتحانات',    icon: '📝', color: '#8b5cf6' },
  revisions:     { label: 'مراجعات خاصة',       icon: '📖', color: '#14b8a6' },
  other:         { label: 'دفعات أخرى',         icon: '💵', color: '#64748b' },
  other_income:  { label: 'إيرادات أخرى',      icon: '💰', color: '#06b6d4' },
};

export const EXPENSE_CATEGORIES = {
  salaries:      { label: 'رواتب المدرسين',     icon: '👤', color: '#f59e0b' },
  rent:          { label: 'إيجار المكان',       icon: '🏢', color: '#ef4444' },
  utilities:     { label: 'الفواتير (كهرباء)', icon: '⚡', color: '#f97316' },
  supplies:      { label: 'أدوات ومستلزمات',   icon: '🛒', color: '#84cc16' },
  maintenance:   { label: 'صيانة',             icon: '🔧', color: '#94a3b8' },
  marketing:     { label: 'تسويق وإعلان',      icon: '📢', color: '#ec4899' },
  refund:        { label: 'استرداد للطلاب',     icon: '↩️', color: '#ef4444' },
  other_expense: { label: 'مصروفات أخرى',      icon: '📋', color: '#94a3b8' },
};

export const ALL_CATEGORIES = { ...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES };

export const PAYMENT_METHODS = {
  cash:     { label: 'كاش',         icon: '💵' },
  transfer: { label: 'تحويل بنكي',  icon: '🏦' },
  check:    { label: 'شيك',         icon: '📄' },
};

// ── Balance calculation ──────────────────────────────────────
export function computeRunningBalance(txns, openingBalance = 0) {
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  let balance  = openingBalance;
  return sorted.map(tx => {
    if (tx.type === 'income')  balance += tx.amount;
    else                       balance -= tx.amount;
    return { ...tx, balance };
  });
}

export function getCurrentBalance(txns, openingBalance = 0) {
  return txns.reduce((bal, tx) =>
    tx.type === 'income' ? bal + tx.amount : bal - tx.amount,
    openingBalance
  );
}

// ── Period summary ───────────────────────────────────────────
export function getPeriodStats(txns, from, to) {
  let filtered = txns;
  if (from) filtered = filtered.filter(t => t.date >= from);
  if (to)   filtered = filtered.filter(t => t.date <= to);

  const totalIncome  = filtered.filter(t => t.type==='income') .reduce((s,t) => s+t.amount, 0);
  const totalExpense = filtered.filter(t => t.type==='expense').reduce((s,t) => s+t.amount, 0);
  return {
    count:        filtered.length,
    totalIncome,
    totalExpense,
    netProfit:    totalIncome - totalExpense,
    txns:         filtered,
  };
}

// ── Income breakdown by category ────────────────────────────
export function getIncomeByCategory(txns) {
  return Object.entries(INCOME_CATEGORIES).map(([key, meta]) => ({
    key, ...meta,
    total: txns.filter(t => t.type==='income' && t.category===key).reduce((s,t) => s+t.amount, 0),
    count: txns.filter(t => t.type==='income' && t.category===key).length,
  })).filter(x => x.count > 0);
}

// ── Expense breakdown by category ───────────────────────────
export function getExpenseByCategory(txns) {
  return Object.entries(EXPENSE_CATEGORIES).map(([key, meta]) => ({
    key, ...meta,
    total: txns.filter(t => t.type==='expense' && t.category===key).reduce((s,t) => s+t.amount, 0),
    count: txns.filter(t => t.type==='expense' && t.category===key).length,
  })).filter(x => x.count > 0);
}

// ── Monthly summary ──────────────────────────────────────────
export function getMonthlyStats(txns, year) {
  return Array.from({ length: 12 }, (_, i) => {
    const m     = String(i + 1).padStart(2, '0');
    const pfx   = `${year}-${m}`;
    const month = txns.filter(t => t.date.startsWith(pfx));
    return {
      month:   i + 1,
      income:  month.filter(t=>t.type==='income') .reduce((s,t)=>s+t.amount,0),
      expense: month.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0),
    };
  });
}

// ── Validate ─────────────────────────────────────────────────
export function validateTxn(data, type) {
  const errors = {};
  if (!data.date)                             errors.date        = 'التاريخ مطلوب';
  if (!data.category)                         errors.category    = 'نوع العملية مطلوب';
  if (!data.amount || Number(data.amount)<=0) errors.amount      = 'المبلغ يجب أن يكون أكبر من صفر';
  if (!data.description?.trim())              errors.description = 'وصف العملية مطلوب';
  return errors;
}

// ── Build txn from payment (auto-sync) ──────────────────────
export function txnFromPayment(payment, studentName, groupName) {
  return {
    id:          `tx_pay_${payment.id}`,
    date:        payment.date,
    type:        'income',
    category:    'subscriptions',
    description: `اشتراك ${studentName} — ${groupName}`,
    amount:      payment.amount,
    method:      payment.method || 'cash',
    refType:     'payment',
    refId:       payment.id,
    party:       studentName,
    notes:       payment.notes || '',
    balance:     0, // recalculated
  };
}

// ── Build txn from material distribution ─────────────────────
export function txnFromMatDist(mat, amount, date) {
  return {
    id:          `tx_mat_${mat.id}_${date}`,
    date,
    type:        'income',
    category:    'materials',
    description: `مذكرة: ${mat.name}`,
    amount,
    method:      'cash',
    refType:     'material',
    refId:       mat.id,
    party:       '',
    notes:       '',
    balance:     0,
  };
}
