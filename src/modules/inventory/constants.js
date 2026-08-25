// src/modules/inventory/constants.js
// ═══════════════════════════════════════════════════════════════════════════
// ثوابت وحدة مخزون المواد التعليمية (enums) — مصدر واحد لكل قيم الأعمال.
// المخزون transaction-based: الرصيد = مجموع الداخل − مجموع الخارج.
// كل enum يقابل عموداً/جدول lookup لاحقاً (SQL-ready).
// ═══════════════════════════════════════════════════════════════════════════

// ── حالة المادة ──────────────────────────────────────────────────────────
export const MaterialStatus = Object.freeze({
  ACTIVE:   'active',
  INACTIVE: 'inactive',
});

// ── أنواع حركات المخزون ──────────────────────────────────────────────────
export const TxnType = Object.freeze({
  INITIAL_STOCK:       'initialStock',      // رصيد افتتاحي
  PRINTING:            'printing',          // طباعة (إنتاج)
  PURCHASE:            'purchase',          // شراء
  SALE:                'sale',              // بيع
  FREE_DISTRIBUTION:   'freeDistribution',  // توزيع مجاني
  RESERVATION:         'reservation',       // حجز
  RESERVATION_RELEASE: 'reservationRelease',// فك الحجز
  STUDENT_DELIVERY:    'studentDelivery',   // تسليم لطالب
  RETURN:              'return',            // مرتجع (وارد)
  DAMAGED:             'damaged',           // تالف
  LOST:                'lost',              // مفقود
  ADJUSTMENT:          'adjustment',        // تسوية (قد تكون +/−)
});

// ── اتجاه كل حركة على المخزون الفعلي ──────────────────────────────────────
// in  = يزيد المخزون | out = ينقص المخزون
// reserve = يحجز (لا يغيّر المخزون الفعلي، يقلّل المتاح) | release = يفك الحجز
// neutral = لا يؤثر على المخزون الفعلي مباشرة (adjustment يُحسب بإشارة الكمية)
export const TxnDirection = Object.freeze({
  IN:      'in',
  OUT:     'out',
  RESERVE: 'reserve',
  RELEASE: 'release',
  NEUTRAL: 'neutral',
});

// خريطة نوع الحركة → اتجاهها
export const TXN_DIRECTION = Object.freeze({
  [TxnType.INITIAL_STOCK]:       TxnDirection.IN,
  [TxnType.PRINTING]:            TxnDirection.IN,
  [TxnType.PURCHASE]:            TxnDirection.IN,
  [TxnType.RETURN]:              TxnDirection.IN,
  [TxnType.SALE]:                TxnDirection.OUT,
  [TxnType.FREE_DISTRIBUTION]:   TxnDirection.OUT,
  [TxnType.STUDENT_DELIVERY]:    TxnDirection.OUT,
  [TxnType.DAMAGED]:             TxnDirection.OUT,
  [TxnType.LOST]:                TxnDirection.OUT,
  [TxnType.RESERVATION]:         TxnDirection.RESERVE,
  [TxnType.RESERVATION_RELEASE]: TxnDirection.RELEASE,
  [TxnType.ADJUSTMENT]:          TxnDirection.NEUTRAL, // بإشارة الكمية (+/−)
});

// ── بادئات الترقيم المقروء ────────────────────────────────────────────────
export const MATERIAL_CODE_PREFIX = 'MAT';
export const TXN_NUMBER_PREFIX = 'INV';
export const NUMBER_PAD = 6;

// ── مستوى تنبيه المخزون ───────────────────────────────────────────────────
export const StockLevel = Object.freeze({
  OK:       'ok',
  LOW:      'low',
  OUT:      'out',
});
