// src/services/cashboxService.js
// ─────────────────────────────────────────────────────────────
// Cashbox (Treasury) Service — Multi-Cashbox Architecture
// Single source of truth for all financial computations
// ─────────────────────────────────────────────────────────────

// ── Cashbox types ─────────────────────────────────────────────
export const CASHBOX_TYPES = {
  main:   { label:'خزنة رئيسية',   icon:'🏦', color:'#0d9488' },
  branch: { label:'فرع',           icon:'🏪', color:'#3b82f6' },
  safe:   { label:'خزنة احتياطي', icon:'🔐', color:'#f59e0b' },
  bank:   { label:'حساب بنكي',    icon:'🏛', color:'#8b5cf6' },
};

// ── Validate cashbox ──────────────────────────────────────────
export function validateCashbox(data) {
  const errors = {};
  if (!data.name?.trim())            errors.name = 'اسم الخزنة مطلوب';
  if (!data.type)                    errors.type = 'نوع الخزنة مطلوب';
  if (data.openingBalance < 0)       errors.openingBalance = 'الرصيد الافتتاحي لا يمكن أن يكون سالباً';
  return errors;
}

export function createCashbox(data) {
  const errors = validateCashbox(data);
  if (Object.keys(errors).length) throw { type:'VALIDATION', errors };
  return {
    id:             `cb_${Date.now()}`,
    name:           data.name.trim(),
    type:           data.type,
    color:          data.color || CASHBOX_TYPES[data.type]?.color || '#0d9488',
    icon:           data.icon  || CASHBOX_TYPES[data.type]?.icon  || '🏦',
    openingBalance: Number(data.openingBalance) || 0,
    isDefault:      data.isDefault || false,
    active:         true,
    createdAt:      new Date().toISOString().split('T')[0],
    notes:          data.notes?.trim() || '',
  };
}

// ── Balance engine — per cashbox ──────────────────────────────
// Phase 3B-14B (Decision 1 المعتمَد): الحالة تبقى active/cancelled فقط، مطابقةً
// لـ chk_treasury_status حرفياً — لا 'reversed'/'rejected' بعد الآن.
export function getCashboxBalance(cashboxId, txns, openingBalance = 0) {
  const mine = txns.filter(t =>
    t.cashboxId === cashboxId &&
    t.status !== 'cancelled'
  );
  return mine.reduce((bal, tx) => {
    if (tx.type === 'income')   return bal + tx.amount;
    if (tx.type === 'expense')  return bal - tx.amount;
    return bal; // transfer handled separately
  }, openingBalance);
}

export function getRunningBalance(cashboxId, txns, openingBalance = 0) {
  const mine = txns
    .filter(t => t.cashboxId === cashboxId && t.status !== 'cancelled')
    .sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  let balance = openingBalance;
  return mine.map(tx => {
    if (tx.type === 'income')  balance += tx.amount;
    if (tx.type === 'expense') balance -= tx.amount;
    return { ...tx, balance };
  });
}

// ── System overview ───────────────────────────────────────────
export function getSystemOverview(cashboxes, txns) {
  return cashboxes
    .filter(cb => cb.active)
    .map(cb => {
      const balance  = getCashboxBalance(cb.id, txns, cb.openingBalance);
      const income   = txns.filter(t=>t.cashboxId===cb.id&&t.type==='income' &&t.status==='active').reduce((s,t)=>s+t.amount,0);
      const expenses = txns.filter(t=>t.cashboxId===cb.id&&t.type==='expense'&&t.status==='active').reduce((s,t)=>s+t.amount,0);
      return { ...cb, balance, income, expenses, net:income-expenses };
    });
}

export function getTotalBalance(cashboxes, txns) {
  return cashboxes.filter(cb=>cb.active).reduce((sum, cb) => {
    return sum + getCashboxBalance(cb.id, txns, cb.openingBalance);
  }, 0);
}

// ── Validate transaction ──────────────────────────────────────
export function validateTxn(data) {
  const errors = {};
  if (!data.cashboxId)               errors.cashboxId    = 'يجب اختيار خزنة';
  if (!data.date)                    errors.date         = 'التاريخ مطلوب';
  if (!data.category)                errors.category     = 'نوع العملية مطلوب';
  if (!data.description?.trim())     errors.description  = 'وصف العملية مطلوب';
  if (!data.amount || Number(data.amount) <= 0) errors.amount = 'المبلغ يجب أن يكون أكبر من صفر';
  return errors;
}

// ── Validate transfer ─────────────────────────────────────────
export function validateTransfer(data, cashboxes, txns) {
  const errors = {};
  if (!data.fromCashboxId)  errors.fromCashboxId = 'اختر الخزنة المصدر';
  if (!data.toCashboxId)    errors.toCashboxId   = 'اختر الخزنة الوجهة';
  if (data.fromCashboxId === data.toCashboxId) errors.toCashboxId = 'لا يمكن التحويل لنفس الخزنة';
  if (!data.amount || Number(data.amount) <= 0) errors.amount = 'المبلغ يجب أن يكون أكبر من صفر';

  if (data.fromCashboxId && data.amount) {
    const fromCb = cashboxes.find(cb => cb.id === data.fromCashboxId);
    if (fromCb) {
      const balance = getCashboxBalance(data.fromCashboxId, txns, fromCb.openingBalance);
      if (Number(data.amount) > balance) {
        errors.amount = `رصيد الخزنة غير كافٍ (المتاح: ${balance.toLocaleString('ar-EG')} ج.م)`;
      }
    }
  }
  return errors;
}

// ── Build transaction ─────────────────────────────────────────
export function buildCashboxTxn(data, createdBy = 'system') {
  return {
    id:          `tx_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    cashboxId:   data.cashboxId,
    date:        data.date,
    type:        data.type,         // 'income' | 'expense'
    category:    data.category,
    description: (data.description || '').trim(),
    amount:      Number(data.amount),
    method:      data.method || 'cash',
    party:       (data.party || '').trim(),
    notes:       (data.notes || '').trim(),
    refType:     data.refType || null,
    refId:       data.refId   || null,
    // مرجع المصدر للتتبّع (traceability): معرّف سجل القبول الذي أنشأ الحركة
    admissionId: data.admissionId || null,
    sourceModule: data.sourceModule || null,   // الوحدة المصدر (مثل 'admissions')
    sourceDocNo:  data.sourceDocNo  || null,   // رقم المستند المقروء (مثل ADM-000001)
    status:      'active',
    createdBy,
    createdAt:   new Date().toISOString(),
    balance:     0, // computed by getRunningBalance
  };
}

// ── Build transfer (2 transactions, atomic) ───────────────────
export function buildTransfer(data, createdBy = 'system') {
  const transferId = `tr_${Date.now()}`;
  const now = new Date().toISOString();
  const desc = data.description || `تحويل داخلي`;

  const outTxn = {
    id:          `${transferId}_out`,
    cashboxId:   data.fromCashboxId,
    date:        data.date,
    type:        'expense',
    category:    'transfer',
    description: `${desc} → ${data.toName || ''}`,
    amount:      Number(data.amount),
    method:      data.method || 'cash',
    party:       data.toName || '',
    notes:       data.notes || '',
    refType:     'transfer',
    refId:       transferId,
    status:      'active',
    createdBy,
    createdAt:   now,
    balance:     0,
  };

  const inTxn = {
    id:          `${transferId}_in`,
    cashboxId:   data.toCashboxId,
    date:        data.date,
    type:        'income',
    category:    'transfer',
    description: `${desc} ← ${data.fromName || ''}`,
    amount:      Number(data.amount),
    method:      data.method || 'cash',
    party:       data.fromName || '',
    notes:       data.notes || '',
    refType:     'transfer',
    refId:       transferId,
    status:      'active',
    createdBy,
    createdAt:   now,
    balance:     0,
  };

  return { outTxn, inTxn, transferId };
}

// txnFromPayment أُزيلت — قرار Phase 3B-14C الصريح: كانت مستخدَمة حصراً عبر
// treasury.slice.js's addLinkedTxn (المحلي البحت، مُزال الآن أيضاً — تحقّق مؤكَّد عبر
// grep قبل الإزالة). إنشاء الدفعة + حركة الخزنة المرتبطة أصبح عملية ذرّية حقيقية على
// الخادم (backend/src/routes/payments.js's createPayment، نفس خريطة PAY_TYPE_TO_CATEGORY
// منسوخة هناك)، لا بناءً محلياً هنا.

// ── Period stats per cashbox ──────────────────────────────────
export function getCashboxStats(cashboxId, txns, from, to) {
  let filtered = txns.filter(t => t.cashboxId===cashboxId && t.status==='active');
  if (from) filtered = filtered.filter(t => t.date >= from);
  if (to)   filtered = filtered.filter(t => t.date <= to);

  const income  = filtered.filter(t=>t.type==='income') .reduce((s,t)=>s+t.amount,0);
  const expense = filtered.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  return { count:filtered.length, income, expense, net:income-expense, txns:filtered };
}

// ── Category breakdown ────────────────────────────────────────
export function getIncomeByCategory(cashboxId, txns, categories) {
  const filtered = cashboxId
    ? txns.filter(t=>t.cashboxId===cashboxId&&t.type==='income'&&t.status==='active')
    : txns.filter(t=>t.type==='income'&&t.status==='active');

  return Object.entries(categories).map(([key, meta]) => ({
    key, ...meta,
    total: filtered.filter(t=>t.category===key).reduce((s,t)=>s+t.amount,0),
    count: filtered.filter(t=>t.category===key).length,
  })).filter(x=>x.count>0);
}

export function getExpenseByCategory(cashboxId, txns, categories) {
  const filtered = cashboxId
    ? txns.filter(t=>t.cashboxId===cashboxId&&t.type==='expense'&&t.status==='active')
    : txns.filter(t=>t.type==='expense'&&t.status==='active');

  return Object.entries(categories).map(([key, meta]) => ({
    key, ...meta,
    total: filtered.filter(t=>t.category===key).reduce((s,t)=>s+t.amount,0),
    count: filtered.filter(t=>t.category===key).length,
  })).filter(x=>x.count>0);
}
