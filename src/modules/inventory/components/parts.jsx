// src/modules/inventory/components/parts.jsx
// ─────────────────────────────────────────────────────────────────────────────
// مكوّنات عرض صغيرة قابلة لإعادة الاستخدام لوحدة المخزون.
// ─────────────────────────────────────────────────────────────────────────────

import { MaterialStatus } from '../constants';
import { TXN_TYPE_META, STOCK_LEVEL_META, txnSign, txnSignColor, fmtDate } from '../displayMeta';

// ── اللوحة العلوية (مؤشرات) ──────────────────────────────────────────────
export function KpiRow({ dashboard }) {
  const cards = [
    { label: 'المواد النشطة', value: dashboard.materialsCount, icon: '📚', color: '#3b82f6' },
    { label: 'إجمالي المخزون', value: dashboard.totalStock, icon: '📦', color: '#10b981' },
    { label: 'مخزون منخفض', value: dashboard.low, icon: '⚠️', color: '#f59e0b' },
    { label: 'نافد', value: dashboard.out, icon: '🚫', color: '#ef4444' },
    { label: 'قيمة المخزون (تكلفة)', value: `${dashboard.stockValue} ج.م`, icon: '💵', color: '#8b5cf6' },
    { label: 'قيمة البيع المتوقعة', value: `${dashboard.retailValue} ج.م`, icon: '🏷️', color: '#06b6d4' },
    { label: 'إجمالي المبيعات', value: dashboard.totalSold, icon: '💰', color: '#10b981' },
    { label: 'معدل التالف', value: `${dashboard.damageRate}%`, icon: '📉', color: '#ef4444' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
      {cards.map((c) => (
        <div key={c.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 18 }}>{c.icon}</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{c.label}</span>
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: c.color }}>{c.value}</div>
        </div>
      ))}
      {dashboard.topSeller && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 18 }}>🏆</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>الأكثر مبيعاً</span>
          </div>
          <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f59e0b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dashboard.topSeller.name}</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text3)' }}>{dashboard.topSeller.qty} نسخة</div>
        </div>
      )}
    </div>
  );
}

// ── بطاقة مادة في القائمة ────────────────────────────────────────────────
export function MaterialCard({ material, stats, selected, onClick }) {
  const lvl = STOCK_LEVEL_META[stats.level] || STOCK_LEVEL_META.ok;
  return (
    <div
      onClick={onClick}
      style={{
        padding: '11px 12px',
        borderRadius: 10,
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        background: selected ? 'var(--accent-soft, rgba(99,102,241,.08))' : 'var(--surface2)',
        cursor: 'pointer',
        transition: 'all .15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.84rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{material.name}</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text3)' }}>{material.code} · {material.grade}</div>
        </div>
        <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: `${lvl.color}18`, color: lvl.color, whiteSpace: 'nowrap' }}>
          {lvl.icon} {stats.current}
        </span>
      </div>
      {material.status !== MaterialStatus.ACTIVE && (
        <div style={{ fontSize: '0.62rem', color: 'var(--text3)', marginTop: 4 }}>مؤرشفة</div>
      )}
    </div>
  );
}

// ── صف في سجل الحركات ────────────────────────────────────────────────────
export function LedgerRow({ txn }) {
  const meta = TXN_TYPE_META[txn.type] || { label: txn.type, icon: '•', color: '#888' };
  const sign = txnSign(txn.type);
  const color = txnSignColor(txn.type);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
      <span style={{ fontSize: 16 }}>{meta.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{meta.label}</div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text3)' }}>
          {txn.number} · {fmtDate(txn.date)} · {txn.employee}
          {txn.reason ? ` · ${txn.reason}` : ''}
        </div>
      </div>
      <span style={{ fontWeight: 800, color, whiteSpace: 'nowrap' }}>
        {sign}{Math.abs(txn.quantity)}
      </span>
    </div>
  );
}

// ── مؤشر كمية في لوحة التفاصيل ───────────────────────────────────────────
export function DetailStat({ label, value, color = 'var(--text)', big = false }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: '0.66rem', color: 'var(--text3)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: big ? '1.15rem' : '0.95rem', fontWeight: 800, color }}>{value}</div>
    </div>
  );
}
