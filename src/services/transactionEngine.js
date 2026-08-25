// src/services/transactionEngine.js
// ─────────────────────────────────────────────────────────────────────────────
// Transaction Engine — المحرك المالي المركزي
//
// المشاكل التي يحلها:
//   1. حذف مباشر بدون أثر → كل عملية قابلة للعكس (reverse)
//   2. لا تاريخ للتعديلات → كل تغيير مُسجَّل في audit trail
//   3. تناسق payments ↔ treasury مكسور → cascade تلقائي
//   4. لا approval للمصروفات الكبيرة → approval system
//
// المفاهيم الأساسية:
//
//   TXN STATUS:
//     'active'   → عملية نشطة تؤثر على الرصيد
//     'reversed' → عُكست بعملية مقابلة — لا تُحذف، تبقى للأثر
//     'pending'  → تنتظر موافقة (للمصروفات > threshold)
//     'rejected' → رُفضت
//
//   AUDIT TRAIL:
//     كل txn تحمل history[] — مصفوفة من الأحداث
//     { action, by, at, note }
//     لا يُحذف أي شيء — يُعكس فقط
//
//   REVERSAL:
//     عكس txn = إنشاء txn جديدة بنفس القيمة لكن type معكوس
//     مع link بين الاثنين (originalId / reversalOf)
//     الـ txn الأصلية تُصبح status: 'reversed'
//
// ─────────────────────────────────────────────────────────────────────────────

import { validate, hasErrors, treasurySchema } from '../utils/validation';
import { FINANCIAL_CONFIG } from '../config/app.config';
import { sanitizeText } from '../utils/sanitize';

// ── Constants ─────────────────────────────────────────────────────────────────
export const TXN_STATUS = {
  ACTIVE:   'active',
  REVERSED: 'reversed',
  PENDING:  'pending',
  REJECTED: 'rejected',
};

// المصروفات أكبر من هذا المبلغ تحتاج approval من admin
export const APPROVAL_THRESHOLD = FINANCIAL_CONFIG.APPROVAL_THRESHOLD;

// ── Core: buildTxn ────────────────────────────────────────────────────────────
// ينشئ txn موحدة الشكل مع audit trail مدمج
export function buildTxn(data, createdBy = 'system') {
  const needsApproval =
    data.type === 'expense' &&
    Number(data.amount) > APPROVAL_THRESHOLD &&
    !data.skipApproval;

  return {
    id:          data.id || `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    date:        data.date,
    type:        data.type,           // 'income' | 'expense'
    category:    data.category,
    description: sanitizeText(data.description?.trim() || ''),
    amount:      Number(data.amount),
    method:      data.method || 'cash',
    party:       sanitizeText(data.party?.trim() || ''),
    notes:       sanitizeText(data.notes?.trim() || ''),
    refType:     data.refType || null,  // 'payment' | 'material' | 'exam' | null
    refId:       data.refId   || null,
    status:      needsApproval ? TXN_STATUS.PENDING : TXN_STATUS.ACTIVE,
    reversalOf:  data.reversalOf  || null, // id of the txn this reverses
    originalId:  data.originalId  || null, // id of the reversal txn (set on original)
    balance:     0, // calculated by computeRunningBalance
    history: [
      {
        action: needsApproval ? 'created:pending' : 'created',
        by:     createdBy,
        at:     new Date().toISOString(),
        note:   needsApproval
          ? `بانتظار الموافقة — المبلغ (${data.amount} ج.م) يتجاوز الحد المسموح`
          : '',
      },
    ],
  };
}

// ── Validate ──────────────────────────────────────────────────────────────────
export function validateTransaction(data) {
  // استخدام central validation engine
  const errors = validate(treasurySchema, data);

  // amount ceiling منطقي — لا يُعقل إدخال مبلغ بملايين
  if (!errors.amount && Number(data.amount) > FINANCIAL_CONFIG.MAX_TRANSACTION) {
    errors.amount = 'المبلغ كبير جداً — تأكد من الرقم';
  }

  return errors;
}

// ── Create ────────────────────────────────────────────────────────────────────
export function createTransaction(data, currentUserId) {
  const errors = validateTransaction(data);
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };
  return buildTxn(data, currentUserId);
}

// ── Update ────────────────────────────────────────────────────────────────────
// يُرسل التعديل للـ Backend — يُعيد server response فقط (لا fake state)
export function updateTransaction(existingTxn, updates, currentUserId) {
  const errors = validateTransaction({ ...existingTxn, ...updates });
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };

  const changes = [];
  if (updates.amount !== undefined && updates.amount !== existingTxn.amount)
    changes.push(`المبلغ: ${existingTxn.amount} → ${updates.amount}`);
  if (updates.description !== undefined && updates.description !== existingTxn.description)
    changes.push(`الوصف: "${existingTxn.description}" → "${updates.description}"`);
  if (updates.date !== undefined && updates.date !== existingTxn.date)
    changes.push(`التاريخ: ${existingTxn.date} → ${updates.date}`);
  if (updates.category !== undefined && updates.category !== existingTxn.category)
    changes.push(`الفئة: ${existingTxn.category} → ${updates.category}`);

  return {
    ...existingTxn,
    ...updates,
    description: sanitizeText(updates.description?.trim() ?? existingTxn.description),
    notes:       sanitizeText(updates.notes?.trim()       ?? existingTxn.notes),
    party:       sanitizeText(updates.party?.trim()       ?? existingTxn.party),
    amount:      updates.amount !== undefined ? Number(updates.amount) : existingTxn.amount,
    updatedAt:   new Date().toISOString(),
    history: [
      ...existingTxn.history,
      {
        action: 'updated',
        by:     currentUserId,
        at:     new Date().toISOString(),
        note:   changes.length ? changes.join(' | ') : 'تعديل',
      },
    ],
  };
}

// ── Reverse ───────────────────────────────────────────────────────────────────
// عكس عملية = إنشاء عملية مقابلة تُلغي الأثر المالي
// الأصل لا يُحذف — يُصبح status: 'reversed'
// هذا هو الفرق الجوهري عن الحذف المباشر
//
// مثال:
//   txn أصلية:  income 500 ج.م
//   reversal:   expense 500 ج.م (type معكوس)
//   الرصيد الكلي: صفر — كأن العملية لم تحدث
export function reverseTransaction(originalTxn, reason, currentUserId) {
  if (!reason?.trim()) {
    throw { type: 'VALIDATION', errors: { reason: 'سبب العكس مطلوب' } };
  }

  if (originalTxn.status === TXN_STATUS.REVERSED) {
    throw { type: 'LOGIC', message: 'العملية مُعكوسة بالفعل' };
  }

  if (originalTxn.status === TXN_STATUS.PENDING) {
    throw { type: 'LOGIC', message: 'لا يمكن عكس عملية معلقة — ارفضها بدلاً من ذلك' };
  }

  const reversalId = `tx_rev_${originalTxn.id}_${Date.now()}`;

  // عملية العكس: نفس القيمة، type معكوس
  const reversalTxn = {
    id:          reversalId,
    date:        new Date().toISOString().split('T')[0],
    type:        originalTxn.type === 'income' ? 'expense' : 'income',
    category:    originalTxn.category,
    description: `عكس: ${originalTxn.description}`,
    amount:      originalTxn.amount,
    method:      originalTxn.method,
    party:       originalTxn.party,
    notes:       `سبب العكس: ${sanitizeText(reason)}`,
    refType:     'reversal',
    refId:       originalTxn.id,
    reversalOf:  originalTxn.id,
    originalId:  null,
    status:      TXN_STATUS.ACTIVE,
    balance:     0,
    history: [{
      action: 'reversal:created',
      by:     currentUserId,
      at:     new Date().toISOString(),
      note:   `عكس للعملية ${originalTxn.id} — ${sanitizeText(reason)}`,
    }],
  };

  // الأصل يُصبح reversed
  const updatedOriginal = {
    ...originalTxn,
    status:     TXN_STATUS.REVERSED,
    originalId: reversalId,
    history: [
      ...originalTxn.history,
      {
        action: 'reversed',
        by:     currentUserId,
        at:     new Date().toISOString(),
        note:   `عُكست بالعملية ${reversalId} — ${sanitizeText(reason)}`,
      },
    ],
  };

  return { reversalTxn, updatedOriginal };
}

// ── Approve ───────────────────────────────────────────────────────────────────
export function approveTransaction(txn, currentUserId) {
  if (txn.status !== TXN_STATUS.PENDING) {
    throw { type: 'LOGIC', message: 'العملية ليست في انتظار الموافقة' };
  }

  return {
    ...txn,
    status: TXN_STATUS.ACTIVE,
    history: [
      ...txn.history,
      {
        action: 'approved',
        by:     currentUserId,
        at:     new Date().toISOString(),
        note:   'تمت الموافقة',
      },
    ],
  };
}

// ── Reject ────────────────────────────────────────────────────────────────────
export function rejectTransaction(txn, reason, currentUserId) {
  if (txn.status !== TXN_STATUS.PENDING) {
    throw { type: 'LOGIC', message: 'العملية ليست في انتظار الموافقة' };
  }

  return {
    ...txn,
    status: TXN_STATUS.REJECTED,
    history: [
      ...txn.history,
      {
        action: 'rejected',
        by:     currentUserId,
        at:     new Date().toISOString(),
        note:   sanitizeText(reason || 'مرفوض'),
      },
    ],
  };
}

// ── Cascade: Payment → Treasury ───────────────────────────────────────────────
// عند إضافة payment → إنشاء txn تلقائياً في الخزنة
// عند حذف payment → عكس الـ txn المرتبطة (لا حذف)
export function buildTxnFromPayment(payment, studentName, groupName, currentUserId) {
  return buildTxn({
    id:          `tx_pay_${payment.id}`,
    date:        payment.date,
    type:        'income',
    category:    'subscriptions',
    description: `اشتراك ${studentName} — ${groupName}`,
    amount:      payment.amount,
    method:      payment.method || 'cash',
    party:       studentName,
    notes:       payment.notes || '',
    refType:     'payment',
    refId:       payment.id,
    skipApproval: true, // الدفعات لا تحتاج approval
  }, currentUserId);
}

export function buildTxnFromMatDist(material, amount, date, currentUserId) {
  return buildTxn({
    date,
    type:        'income',
    category:    'materials',
    description: `مذكرة: ${material.name}`,
    amount,
    method:      'cash',
    party:       '',
    notes:       '',
    refType:     'material',
    refId:       material.id,
    skipApproval: true,
  }, currentUserId);
}

// ── Find linked txn ───────────────────────────────────────────────────────────
// يجد الـ txn المرتبطة بـ payment أو material عند الحذف
export function findLinkedTxn(txns, refType, refId) {
  return txns.find(
    (t) => t.refType === refType && t.refId === refId && t.status === TXN_STATUS.ACTIVE
  );
}

// ── Filter for display ────────────────────────────────────────────────────────
// الـ UI يعرض فقط active + pending + reversed (للشفافية)
// المرفوضات مخفية بشكل افتراضي
export function filterVisibleTxns(txns, { showReversed = true, showPending = true } = {}) {
  return txns.filter((t) => {
    if (t.status === TXN_STATUS.REJECTED) return false;
    if (t.status === TXN_STATUS.REVERSED && !showReversed) return false;
    if (t.status === TXN_STATUS.PENDING  && !showPending)  return false;
    return true;
  });
}

// ── Balance calculation (المعكوسة لا تدخل الحساب) ────────────────────────────
export function computeEffectiveBalance(txns, openingBalance = 0) {
  // فقط active تؤثر على الرصيد
  const effective = txns.filter((t) => t.status === TXN_STATUS.ACTIVE);
  const sorted    = [...effective].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
  );
  let balance = openingBalance;
  return sorted.map((tx) => {
    balance += tx.type === 'income' ? tx.amount : -tx.amount;
    return { ...tx, balance };
  });
}

// ── Migrate old txns (backward compat) ───────────────────────────────────────
// الـ txns القديمة لا تحتوي على status/history — نضيفها تلقائياً
export function migrateTxn(txn) {
  if (txn.status && txn.history) return txn; // already migrated
  return {
    ...txn,
    status:  TXN_STATUS.ACTIVE,
    history: [{
      action: 'migrated',
      by:     'system',
      at:     new Date().toISOString(),
      note:   'ترحيل تلقائي من النظام القديم',
    }],
    reversalOf: null,
    originalId: null,
  };
}

// ── Migrate all ───────────────────────────────────────────────────────────────
export function migrateAllTxns(txns) {
  return txns.map(migrateTxn);
}
