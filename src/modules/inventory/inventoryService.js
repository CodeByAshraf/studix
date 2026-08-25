// src/modules/inventory/inventoryService.js
// ═══════════════════════════════════════════════════════════════════════════
// خدمة المخزون — بناء الحركات وحساب الكميات منها فقط (transaction-based).
// لا تُخزّن أي كمية يدوياً؛ كل شيء يُحسب من الحركات (SQL-ready).
// ═══════════════════════════════════════════════════════════════════════════

import {
  TxnType, TxnDirection, TXN_DIRECTION, MaterialStatus,
  MATERIAL_CODE_PREFIX, TXN_NUMBER_PREFIX, NUMBER_PAD, StockLevel,
} from './constants';

// ─────────────────────────────────────────────────────────────────────────────
// توليد الأرقام المقروءة
// ─────────────────────────────────────────────────────────────────────────────

function nextSeq(items, field, prefix) {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const it of items) {
    const m = re.exec(it[field] || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(NUMBER_PAD, '0')}`;
}

export function nextMaterialCode(materials = []) {
  return nextSeq(materials, 'code', MATERIAL_CODE_PREFIX);
}

export function nextTxnNumber(txns = []) {
  return nextSeq(txns, 'number', TXN_NUMBER_PREFIX);
}

// ─────────────────────────────────────────────────────────────────────────────
// بناء الكيانات
// ─────────────────────────────────────────────────────────────────────────────

// بناء مادة جديدة (لا تحتوي كمية — الكمية تُحسب من الحركات)
export function buildMaterial(data, existing = []) {
  return {
    id:          `mat_${Date.now()}`,
    code:        data.code?.trim() || nextMaterialCode(existing),
    name:        data.name?.trim() || '',
    subject:     data.subject?.trim() || '',
    grade:       data.grade || '',
    academicYear:data.academicYear?.trim() || '',
    edition:     data.edition?.trim() || '',
    sellingPrice:Number(data.sellingPrice) || 0,
    printingCost:Number(data.printingCost) || 0,
    minStock:    Number(data.minStock) || 0,
    status:      data.status || MaterialStatus.ACTIVE,
    barcode:     data.barcode?.trim() || '',
    notes:       data.notes?.trim() || '',
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
}

// بناء حركة مخزون (لا تُحذف الحركات أبداً)
export function buildInventoryTxn(data, txns = [], createdBy = 'system') {
  return {
    id:          `itx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    number:      nextTxnNumber(txns),
    materialId:  data.materialId,
    type:        data.type,
    quantity:    Number(data.quantity) || 0,
    date:        data.date || new Date().toISOString().split('T')[0],
    employee:    data.employee || createdBy,
    reason:      data.reason?.trim() || '',
    notes:       data.notes?.trim() || '',
    // حقول دفعة الطباعة (اختيارية — تُملأ لحركات الطباعة)
    batchNo:     data.batchNo?.trim() || null,
    printVendor: data.printVendor?.trim() || null,
    unitCost:    data.unitCost != null ? Number(data.unitCost) : null,
    // حقول التسليم (اختيارية — تُملأ لحركات التسليم)
    recipient:   data.recipient?.trim() || null,
    // حقول الجرد الفعلي (اختيارية — تُملأ لتسويات الجرد)
    countedQty:  data.countedQty != null ? Number(data.countedQty) : null,
    systemQty:   data.systemQty != null ? Number(data.systemQty) : null,
    // مراجع اختيارية للتكامل المستقبلي (غير مربوطة الآن)
    refModule:   data.refModule || null,
    refId:       data.refId || null,
    studentId:   data.studentId || null,
    admissionId: data.admissionId || null,
    invoiceId:   data.invoiceId || null,
    paymentId:   data.paymentId || null,
    status:      'active',
    createdAt:   new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// حساب الكميات من الحركات (المصدر الوحيد للأرقام)
// ─────────────────────────────────────────────────────────────────────────────

// حركات مادة معيّنة (النشطة فقط)
function txnsFor(materialId, txns) {
  return txns.filter(t => t.materialId === materialId && t.status !== 'reversed');
}

// إجمالي كمية نوع معيّن
function sumType(materialId, txns, type) {
  return txnsFor(materialId, txns)
    .filter(t => t.type === type)
    .reduce((s, t) => s + (Number(t.quantity) || 0), 0);
}

// المخزون الفعلي = مجموع الوارد − مجموع الصادر (+ التسويات بإشارتها)
export function getCurrentStock(materialId, txns) {
  return txnsFor(materialId, txns).reduce((stock, t) => {
    const dir = TXN_DIRECTION[t.type];
    const qty = Number(t.quantity) || 0;
    if (dir === TxnDirection.IN)  return stock + qty;
    if (dir === TxnDirection.OUT) return stock - qty;
    if (dir === TxnDirection.NEUTRAL) return stock + qty; // adjustment: qty قد تكون سالبة
    return stock; // reserve / release لا يغيّران المخزون الفعلي
  }, 0);
}

// الكمية المحجوزة = مجموع الحجوزات − مجموع فك الحجوزات
export function getReserved(materialId, txns) {
  const reserved = sumType(materialId, txns, TxnType.RESERVATION);
  const released = sumType(materialId, txns, TxnType.RESERVATION_RELEASE);
  // التسليم للطالب يستهلك الحجز أيضاً
  const delivered = sumType(materialId, txns, TxnType.STUDENT_DELIVERY);
  return Math.max(0, reserved - released - delivered);
}

// المتاح = الفعلي − المحجوز
export function getAvailable(materialId, txns) {
  return getCurrentStock(materialId, txns) - getReserved(materialId, txns);
}

// كميات تفصيلية (للوحة المادة)
export function getSold(materialId, txns)      { return sumType(materialId, txns, TxnType.SALE); }
export function getFree(materialId, txns)      { return sumType(materialId, txns, TxnType.FREE_DISTRIBUTION); }
export function getDamaged(materialId, txns)   { return sumType(materialId, txns, TxnType.DAMAGED); }
export function getLost(materialId, txns)      { return sumType(materialId, txns, TxnType.LOST); }
export function getReturned(materialId, txns)  { return sumType(materialId, txns, TxnType.RETURN); }
export function getDelivered(materialId, txns) { return sumType(materialId, txns, TxnType.STUDENT_DELIVERY); }

// ملخص كامل لمادة
export function getMaterialStats(material, txns) {
  const current   = getCurrentStock(material.id, txns);
  const reserved  = getReserved(material.id, txns);
  return {
    current,
    reserved,
    available: current - reserved,
    sold:      getSold(material.id, txns),
    free:      getFree(material.id, txns),
    damaged:   getDamaged(material.id, txns),
    lost:      getLost(material.id, txns),
    returned:  getReturned(material.id, txns),
    delivered: getDelivered(material.id, txns),
    level:     getStockLevel(material, txns),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// مستوى المخزون (تنبيهات)
// ─────────────────────────────────────────────────────────────────────────────
export function getStockLevel(material, txns) {
  const current = getCurrentStock(material.id, txns);
  if (current <= 0) return StockLevel.OUT;
  if (material.minStock > 0 && current <= material.minStock) return StockLevel.LOW;
  return StockLevel.OK;
}

// عدد الحركات لمادة (للتحقق قبل الحذف)
export function txnCountFor(materialId, txns) {
  return txns.filter(t => t.materialId === materialId).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// مؤشرات لوحة متقدمة (تُحسب من كل المواد والحركات)
// ─────────────────────────────────────────────────────────────────────────────
export function getInventoryKpis(materials, txns) {
  let stockValue = 0;      // قيمة المخزون بتكلفة الطباعة
  let retailValue = 0;     // قيمة البيع المتوقعة للمخزون الحالي
  let totalStock = 0;
  let totalSold = 0;
  let totalDamaged = 0;
  let totalReserved = 0;
  let low = 0, out = 0;
  let topSeller = null, topSoldQty = 0;

  for (const m of materials) {
    const cur = getCurrentStock(m.id, txns);
    const sold = getSold(m.id, txns);
    const damaged = getDamaged(m.id, txns);
    const reserved = getReserved(m.id, txns);

    totalStock += cur;
    totalSold += sold;
    totalDamaged += damaged;
    totalReserved += reserved;
    stockValue += cur * (Number(m.printingCost) || 0);
    retailValue += cur * (Number(m.sellingPrice) || 0);

    const lvl = getStockLevel(m, txns);
    if (lvl === StockLevel.LOW) low++;
    if (lvl === StockLevel.OUT) out++;

    if (sold > topSoldQty) { topSoldQty = sold; topSeller = m; }
  }

  // معدل التالف = التالف ÷ (المباع + التالف)
  const damageBase = totalSold + totalDamaged;
  const damageRate = damageBase > 0 ? (totalDamaged / damageBase) * 100 : 0;

  return {
    materialsCount: materials.filter(m => m.status === MaterialStatus.ACTIVE).length,
    totalStock,
    totalSold,
    totalReserved,
    stockValue: Math.round(stockValue),
    retailValue: Math.round(retailValue),
    low, out,
    damageRate: Math.round(damageRate * 10) / 10,
    topSeller: topSeller ? { name: topSeller.name, qty: topSoldQty } : null,
  };
}
// الفرق = المعدود − المحسوب (موجب = زيادة، سالب = عجز).
// ─────────────────────────────────────────────────────────────────────────────
export function buildCountAdjustment(materialId, countedQty, txns, employee = 'system') {
  const systemQty = getCurrentStock(materialId, txns);
  const counted = Number(countedQty) || 0;
  const diff = counted - systemQty;
  if (diff === 0) return null; // لا فرق → لا تسوية
  return buildInventoryTxn({
    materialId,
    type: TxnType.ADJUSTMENT,
    quantity: diff, // موجب أو سالب
    reason: `جرد فعلي — المعدود ${counted} مقابل المحسوب ${systemQty}`,
    countedQty: counted,
    systemQty,
    employee,
  }, txns, employee);
}
