// src/store/slices/inventory.slice.js
// ─────────────────────────────────────────────────────────────────────────────
// شريحة مخزون المواد التعليمية — موديول مستقل تماماً.
// يملك: المواد (invMaterials) + حركات المخزون (inventoryTxn) + الإعدادات.
// المخزون transaction-based: لا تُخزّن كمية يدوياً. لا تُحذف الحركات أبداً.
// ─────────────────────────────────────────────────────────────────────────────

import {
  INITIAL_INV_MATERIALS,
  INITIAL_INVENTORY_TXN,
  INITIAL_INVENTORY_SETTINGS,
} from '../../data/initialData';

export const createInventorySlice = (set) => ({
  // ── State ────────────────────────────────────────────────
  invMaterials:      INITIAL_INV_MATERIALS,
  inventoryTxn:      INITIAL_INVENTORY_TXN,
  inventorySettings: INITIAL_INVENTORY_SETTINGS,

  // ── Materials CRUD (لا كمية — تُحسب من الحركات) ──────────
  // setInvMaterials: نفس نمط materials.slice.js's setMaterials بالضبط — يُستخدَم من
  // InventoryPage.jsx وMaterialsPage.jsx كلاهما بعد توحيدهما على invMaterials (انظر
  // MATERIALS_DOMAIN_DECISION_AUDIT.md) لتبنّي استجابة الخادم كما هي (server-truth-first).
  setInvMaterials: (v) => set((s) => ({ invMaterials: typeof v === 'function' ? v(s.invMaterials) : v })),

  // addInvMaterial/updateInvMaterial/removeInvMaterial أدناه محلية بحتة (بلا شبكة) — لم
  // تعد تُستدعى من InventoryPage.jsx (استبدلت بـ setInvMaterials + pgCreateMaterial/
  // pgUpdateMaterial/pgDeleteMaterial). أُبقيت كما هي عمداً بلا حذف — خارج نطاق هذا التغيير.
  addInvMaterial: (material) =>
    set((s) => ({ invMaterials: [material, ...s.invMaterials] })),

  updateInvMaterial: (id, updates) =>
    set((s) => ({
      invMaterials: s.invMaterials.map((m) =>
        m.id === id ? { ...m, ...updates, updatedAt: new Date().toISOString() } : m
      ),
    })),

  // الحذف مسموح فقط عند عدم وجود حركات (يتحقق المستدعي عبر canDeleteMaterial)
  removeInvMaterial: (id) =>
    set((s) => ({ invMaterials: s.invMaterials.filter((m) => m.id !== id) })),

  // ── Inventory transactions (append-only — لا حذف) ────────
  addInventoryTxn: (txn) =>
    set((s) => ({ inventoryTxn: [txn, ...s.inventoryTxn] })),

  // matDist read-path migration: يُستخدَم من MaterialDistribution.jsx بعد نجاح الحفظ
  // لدمج (لا استبدال — نفس mergeById المُستخدَمة إقلاعياً) أحدث inventoryTxn من الخادم،
  // حتى لا تُفقَد أي حركة محلية بحتة أُنشئت عبر مسار InventoryPage المباشر المنفصل
  // (خارج نطاق هذا التغيير تماماً). نفس نمط setInvMaterials بالضبط.
  setInventoryTxn: (v) =>
    set((s) => ({ inventoryTxn: typeof v === 'function' ? v(s.inventoryTxn) : v })),

  // ── Settings ─────────────────────────────────────────────
  updateInventorySettings: (updates) =>
    set((s) => ({ inventorySettings: { ...s.inventorySettings, ...updates } })),
});
