// src/store/slices/materials.slice.js

// matDist لم يعد حالة مستقلة هنا إطلاقاً — أُزيل بالكامل (لا تُترَك نسخة خاملة، بعكس
// materials أدناه). يُشتَق الآن دائماً من inventoryTxn (inventory.slice.js) عبر
// deriveMatDist في src/services/materialService.js — انظر
// PHASE_NEXT_MATDIST_IMPLEMENTATION_PLAN.md/PHASE_NEXT_MATDIST_IMPLEMENTATION_AUDIT.md.
export const createMaterialsSlice = (set) => ({
  materials: INITIAL_MATERIALS,

  setMaterials: (v) => set((s) => ({ materials: typeof v === 'function' ? v(s.materials) : v })),

  addMaterial: (mat) =>
    set((s) => ({ materials: [...s.materials, mat] })),

  updateMaterial: (id, updates) =>
    set((s) => ({ materials: s.materials.map((m) => m.id === id ? { ...m, ...updates } : m) })),

  removeMaterial: (id) =>
    set((s) => ({ materials: s.materials.filter((m) => m.id !== id) })),
});
import { INITIAL_MATERIALS } from '../../data/initialData';
