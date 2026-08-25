// src/modules/inventory/validators.js
// ═══════════════════════════════════════════════════════════════════════════
// أدوات التحقق لوحدة المخزون — تمنع الحالات غير الصحيحة قبل حفظها.
// ═══════════════════════════════════════════════════════════════════════════

import { TxnType, TXN_DIRECTION, TxnDirection } from './constants';
import { getCurrentStock, getAvailable, txnCountFor } from './inventoryService';

// ── تحقق بيانات المادة ────────────────────────────────────────────────────
export function validateMaterial(data, materials = [], editingId = null) {
  const errors = {};

  if (!data.name || !data.name.trim()) errors.name = 'اسم المادة مطلوب';
  if (!data.grade) errors.grade = 'السنة الدراسية مطلوبة';

  // كود فريد (إن أُدخل يدوياً)
  const code = (data.code || '').trim();
  if (code) {
    const dup = materials.some(m => m.code === code && m.id !== editingId);
    if (dup) errors.code = 'كود المادة مستخدم بالفعل';
  }

  if (Number(data.sellingPrice) < 0) errors.sellingPrice = 'السعر لا يمكن أن يكون سالباً';
  if (Number(data.printingCost) < 0) errors.printingCost = 'تكلفة الطباعة لا يمكن أن تكون سالبة';
  if (Number(data.minStock) < 0) errors.minStock = 'الحد الأدنى لا يمكن أن يكون سالباً';

  return errors;
}

// ── تحقق حركة المخزون ─────────────────────────────────────────────────────
// allowNegative: السماح بالمخزون السالب (افتراضي لا)
export function validateTxn(data, txns = [], { allowNegative = false } = {}) {
  const errors = {};

  if (!data.materialId) errors.materialId = 'المادة مطلوبة';
  if (!data.type || !TXN_DIRECTION[data.type]) errors.type = 'نوع الحركة غير صالح';

  const qty = Number(data.quantity);
  const dir = TXN_DIRECTION[data.type];

  // الكمية: التسوية تقبل السالب، الباقي لا
  if (dir === TxnDirection.NEUTRAL) {
    if (!qty || qty === 0) errors.quantity = 'أدخل قيمة التسوية (موجبة أو سالبة)';
  } else if (!qty || qty <= 0) {
    errors.quantity = 'الكمية يجب أن تكون أكبر من صفر';
  }

  // منع المخزون السالب للحركات الصادرة
  if (!errors.quantity && !allowNegative && data.materialId) {
    if (dir === TxnDirection.OUT) {
      const current = getCurrentStock(data.materialId, txns);
      if (qty > current) errors.quantity = `الكمية (${qty}) أكبر من المخزون المتاح (${current})`;
    }
    if (dir === TxnDirection.RESERVE) {
      const available = getAvailable(data.materialId, txns);
      if (qty > available) errors.quantity = `الكمية (${qty}) أكبر من المتاح للحجز (${available})`;
    }
    // التسوية السالبة يجب ألا تُنزل المخزون تحت الصفر
    if (dir === TxnDirection.NEUTRAL && qty < 0) {
      const current = getCurrentStock(data.materialId, txns);
      if (current + qty < 0) errors.quantity = `التسوية تُنزل المخزون تحت الصفر (الحالي ${current})`;
    }
  }

  return errors;
}

// ── التحقق قبل حذف مادة (ممنوع لو لها حركات) ──────────────────────────────
export function canDeleteMaterial(materialId, txns = []) {
  return txnCountFor(materialId, txns) === 0;
}

export function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}
