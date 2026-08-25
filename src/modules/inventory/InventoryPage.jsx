// src/modules/inventory/InventoryPage.jsx
// ═══════════════════════════════════════════════════════════════════════════
// مخزون المواد التعليمية — شاشة واحدة:
// لوحة علوية + قائمة المواد (يمين) + سجل الحركات (وسط) + تفاصيل المادة (يسار).
// المخزون transaction-based بالكامل. موديول مستقل — لا يعتمد على موديولات أخرى.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import { useAppStore } from '../../store/app.store';
import { useAuth } from '../../store/auth.context';
import { SectionBoundary } from '../../components/ErrorBoundary';
import { useToast } from '../../components/Toast';
import { MaterialStatus } from './constants';
import {
  buildInventoryTxn, getMaterialStats,
  getInventoryKpis, buildCountAdjustment, nextMaterialCode,
} from './inventoryService';
import { validateMaterial, validateTxn, canDeleteMaterial, hasErrors } from './validators';
import { pgCreateMaterial, pgUpdateMaterial, pgDeleteMaterial, pgGetCollection } from '../../services/api';
import { TXN_TYPE_META, STOCK_LEVEL_META } from './displayMeta';
import MaterialFormModal from './components/MaterialFormModal';
import TxnFormModal from './components/TxnFormModal';
import CountModal from './components/CountModal';
import { KpiRow, MaterialCard, LedgerRow, DetailStat } from './components/parts';

export default function InventoryPage() {
  const toast = useToast();
  const { currentUser } = useAuth();
  const employee = currentUser?.name || currentUser?.id || 'الموظف الحالي';

  // ── الحالة من الـ store ──
  const materials = useAppStore((s) => s.invMaterials);
  const txns      = useAppStore((s) => s.inventoryTxn);
  const settings  = useAppStore((s) => s.inventorySettings);
  const setMaterials    = useAppStore((s) => s.setInvMaterials);
  const addTxn          = useAppStore((s) => s.addInventoryTxn);

  // ── حالة الواجهة ──
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [ledgerFilter, setLedgerFilter] = useState('all');
  const [showMatForm, setShowMatForm] = useState(false);
  const [editingMat, setEditingMat] = useState(null);
  const [showTxnForm, setShowTxnForm] = useState(false);
  const [showCountForm, setShowCountForm] = useState(false);

  // ── مواد مفلترة بالبحث ──
  const filteredMaterials = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter((m) =>
      [m.code, m.name, m.grade, m.subject, m.academicYear]
        .filter(Boolean).some((v) => v.toLowerCase().includes(q))
    );
  }, [materials, search]);

  const selected = materials.find((m) => m.id === selectedId) || null;
  const selectedStats = selected ? getMaterialStats(selected, txns) : null;

  // ── حركات المادة المختارة (مفلترة) ──
  const selectedTxns = useMemo(() => {
    if (!selected) return [];
    let list = txns.filter((t) => t.materialId === selected.id);
    if (ledgerFilter !== 'all') list = list.filter((t) => t.type === ledgerFilter);
    return list.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [txns, selected, ledgerFilter]);

  // ── مؤشرات اللوحة العلوية (متقدمة) ──
  const dashboard = useMemo(() => getInventoryKpis(materials, txns), [materials, txns]);

  // ── حفظ مادة (إضافة/تعديل) ──
  // PostgreSQL هو مصدر الحقيقة الآن (نفس نمط MaterialsPage.jsx بالضبط — inv_materials
  // جدول مشترك بين الموديولين، انظر MATERIALS_DOMAIN_DECISION_AUDIT.md) — لا تعديل محلي
  // إلا بعد نجاح الخادم، ونتبنّى استجابته كما هي. فقط الحقول التي تديرها هذه الواجهة
  // فعلياً تُرسَل (name/subject/grade/price)؛ academicYear/edition/printingCost/notes
  // تبقى محلية فقط كما كانت (لا عمود لها في inv_materials — خارج نطاق هذا التغيير).
  const handleSaveMaterial = async (data) => {
    const errors = validateMaterial(data, materials, editingMat?.id);
    if (hasErrors(errors)) { toast.error(Object.values(errors)[0]); return; }
    try {
      if (editingMat) {
        const saved = await pgUpdateMaterial(editingMat.id, {
          name: data.name, subject: data.subject, grade: data.grade, price: Number(data.sellingPrice) || 0,
        });
        setMaterials((prev) => prev.map((m) => (m.id === editingMat.id ? saved : m)));
        toast.success('تم تحديث المادة');
      } else {
        const code = (data.code || '').trim() || nextMaterialCode(materials);
        const saved = await pgCreateMaterial(
          { name: data.name, subject: data.subject, grade: data.grade, price: Number(data.sellingPrice) || 0, code },
          { computeNextCode: async () => nextMaterialCode(await pgGetCollection('invMaterials')) }
        );
        setMaterials((prev) => [saved, ...prev]);
        toast.success(`تمت إضافة المادة (${saved.code})`);
      }
      setShowMatForm(false);
      setEditingMat(null);
    } catch (err) {
      toast.error(err.message || 'فشل حفظ المادة');
    }
  };

  // ── حذف مادة (ممنوع لو لها حركات) ──
  // الفحص المحلي (canDeleteMaterial) أولاً كتحقق سريع؛ رفض الخادم (409، FK على
  // inventory_txn) هو الحارس الفعلي — نفس نمط MaterialsPage.jsx's pgDeleteMaterial.
  const handleDeleteMaterial = async (mat) => {
    if (!canDeleteMaterial(mat.id, txns)) {
      toast.error('لا يمكن حذف مادة لها حركات مخزون');
      return;
    }
    try {
      await pgDeleteMaterial(mat.id);
      setMaterials((prev) => prev.filter((m) => m.id !== mat.id));
      if (selectedId === mat.id) setSelectedId(null);
      toast.info('تم حذف المادة');
    } catch (err) {
      toast.error(err.message || 'فشل حذف المادة');
    }
  };

  // ── تسجيل حركة ──
  const handleSaveTxn = (data) => {
    const errors = validateTxn(
      { ...data, materialId: selected.id },
      txns,
      { allowNegative: settings.allowNegativeStock }
    );
    if (hasErrors(errors)) { toast.error(Object.values(errors)[0]); return; }
    const txn = buildInventoryTxn({ ...data, materialId: selected.id, employee }, txns, employee);
    addTxn(txn);
    toast.success(`تم تسجيل الحركة (${txn.number})`);
    setShowTxnForm(false);
  };

  // ── جرد فعلي → تسوية تلقائية بالفرق ──
  const handleSaveCount = (countedQty) => {
    const counted = Number(countedQty);
    if (counted < 0 || Number.isNaN(counted)) { toast.error('أدخل كمية صحيحة'); return; }
    const txn = buildCountAdjustment(selected.id, counted, txns, employee);
    if (!txn) { toast.info('الكمية المعدودة مطابقة للمحسوبة — لا حاجة لتسوية'); setShowCountForm(false); return; }
    addTxn(txn);
    const diff = txn.quantity;
    toast.success(`تم تسجيل الجرد — ${diff > 0 ? 'زيادة' : 'عجز'} ${Math.abs(diff)} نسخة`);
    setShowCountForm(false);
  };

  return (
    <SectionBoundary name="InventoryPage">
      <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>
        {/* العنوان */}
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>📦 مخزون المواد التعليمية</h1>
          <p style={{ color: 'var(--text3)', fontSize: '0.85rem', margin: '4px 0 0' }}>
            إدارة مخزون المذكرات والكتب — كل الكميات محسوبة من الحركات
          </p>
        </div>

        {/* اللوحة العلوية */}
        <KpiRow dashboard={dashboard} />

        {/* الجسم: 3 أعمدة */}
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 320px', gap: 14, marginTop: 16, alignItems: 'start' }}>

          {/* يمين: قائمة المواد */}
          <div style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>المواد ({materials.length})</span>
              <button onClick={() => { setEditingMat(null); setShowMatForm(true); }} style={addBtn}>+ مادة</button>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالكود/الاسم/الصف..."
              style={searchStyle}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, maxHeight: 560, overflowY: 'auto' }}>
              {filteredMaterials.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: '0.8rem', padding: 20 }}>
                  {materials.length === 0 ? 'لا توجد مواد — أضف مادة جديدة' : 'لا نتائج للبحث'}
                </div>
              ) : filteredMaterials.map((m) => (
                <MaterialCard
                  key={m.id}
                  material={m}
                  stats={getMaterialStats(m, txns)}
                  selected={selectedId === m.id}
                  onClick={() => setSelectedId(m.id)}
                />
              ))}
            </div>
          </div>

          {/* وسط: سجل الحركات */}
          <div style={panelStyle}>
            {!selected ? (
              <EmptyCenter />
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>سجل حركة: {selected.name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{selected.code}</div>
                  </div>
                  <button onClick={() => setShowTxnForm(true)} style={addBtn}>+ حركة</button>
                </div>

                {/* فلتر النوع */}
                <select value={ledgerFilter} onChange={(e) => setLedgerFilter(e.target.value)} style={{ ...searchStyle, cursor: 'pointer', marginBottom: 10 }}>
                  <option value="all">كل الحركات</option>
                  {Object.entries(TXN_TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>

                {/* جدول الحركات */}
                <div style={{ maxHeight: 520, overflowY: 'auto' }}>
                  {selectedTxns.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: '0.8rem', padding: 20 }}>لا توجد حركات</div>
                  ) : selectedTxns.map((t) => <LedgerRow key={t.id} txn={t} />)}
                </div>
              </>
            )}
          </div>

          {/* يسار: تفاصيل المادة */}
          <div style={panelStyle}>
            {!selected ? (
              <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: '0.8rem', padding: 30 }}>
                اختر مادة لعرض التفاصيل
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{selected.name}</div>
                  <StockBadge level={selectedStats.level} />
                </div>

                {/* لوحة كميات المادة */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                  <DetailStat label="المخزون الحالي" value={selectedStats.current} color="var(--accent)" big />
                  <DetailStat label="المتاح" value={selectedStats.available} color="var(--green)" big />
                  <DetailStat label="محجوز" value={selectedStats.reserved} />
                  <DetailStat label="مُسلّم" value={selectedStats.delivered} />
                  <DetailStat label="مُباع" value={selectedStats.sold} />
                  <DetailStat label="مجاني" value={selectedStats.free} />
                  <DetailStat label="تالف" value={selectedStats.damaged} />
                  <DetailStat label="مرتجع" value={selectedStats.returned} />
                </div>

                {/* بيانات المادة */}
                <div style={{ fontSize: '0.78rem', color: 'var(--text2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <InfoRow label="الكود" value={selected.code} />
                  <InfoRow label="المادة" value={selected.subject || '—'} />
                  <InfoRow label="الصف" value={selected.grade || '—'} />
                  <InfoRow label="العام الدراسي" value={selected.academicYear || '—'} />
                  <InfoRow label="الإصدار" value={selected.edition || '—'} />
                  <InfoRow label="سعر البيع" value={`${selected.sellingPrice} ج.م`} />
                  <InfoRow label="تكلفة الطباعة" value={`${selected.printingCost} ج.م`} />
                  <InfoRow label="الحد الأدنى" value={selected.minStock} />
                  <InfoRow label="الحالة" value={selected.status === MaterialStatus.ACTIVE ? 'نشطة' : 'مؤرشفة'} />
                  {selected.barcode && <InfoRow label="الباركود" value={selected.barcode} />}
                </div>

                {/* أزرار */}
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button onClick={() => setShowCountForm(true)} style={{ ...addBtn, flex: 1 }}>📋 جرد فعلي</button>
                  <button onClick={() => { setEditingMat(selected); setShowMatForm(true); }} style={{ ...addBtn, flex: 1, background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)' }}>تعديل</button>
                  <button onClick={() => handleDeleteMaterial(selected)} style={{ ...addBtn, background: 'transparent', color: 'var(--red)', border: '1px solid var(--red)' }}>حذف</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* المودالات */}
      {showMatForm && (
        <MaterialFormModal
          material={editingMat}
          onClose={() => { setShowMatForm(false); setEditingMat(null); }}
          onSave={handleSaveMaterial}
          defaultMinStock={settings.defaultMinStock}
        />
      )}
      {showTxnForm && selected && (
        <TxnFormModal
          material={selected}
          currentStock={selectedStats.current}
          available={selectedStats.available}
          onClose={() => setShowTxnForm(false)}
          onSave={handleSaveTxn}
        />
      )}
      {showCountForm && selected && (
        <CountModal
          material={selected}
          systemQty={selectedStats.current}
          onClose={() => setShowCountForm(false)}
          onSave={handleSaveCount}
        />
      )}
    </SectionBoundary>
  );
}

// ── مكوّنات صغيرة محلية ──
function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--text3)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function StockBadge({ level }) {
  const meta = STOCK_LEVEL_META[level] || STOCK_LEVEL_META.ok;
  return (
    <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: `${meta.color}18`, color: meta.color, whiteSpace: 'nowrap' }}>
      {meta.icon} {meta.label}
    </span>
  );
}

function EmptyCenter() {
  return (
    <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
      <div style={{ fontSize: '0.85rem' }}>اختر مادة من القائمة لعرض سجل حركاتها</div>
    </div>
  );
}

const panelStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 16,
};

const addBtn = {
  padding: '7px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontFamily: 'Cairo, sans-serif',
  fontSize: '0.78rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const searchStyle = {
  width: '100%',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '9px 11px',
  color: 'var(--text)',
  fontFamily: 'Cairo, sans-serif',
  fontSize: '0.82rem',
  direction: 'rtl',
};
