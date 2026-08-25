// src/modules/payments/components/PaymentBadge.jsx
import { PAYMENT_STATUS, PAYMENT_METHODS } from '../../../services/paymentService';

export function StatusBadge({ status, size = 'md' }) {
  const s = PAYMENT_STATUS[status] || PAYMENT_STATUS.unpaid;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:4,
      padding: size === 'sm' ? '2px 8px' : '3px 10px',
      borderRadius:99, fontSize: size === 'sm' ? '0.65rem' : '0.7rem',
      fontWeight:700, background:s.bg, color:s.color, border:`1px solid ${s.border}`,
      whiteSpace:'nowrap',
    }}>
      <span style={{ width:5, height:5, borderRadius:'50%', background:s.color }}/>
      {s.label}
    </span>
  );
}

export function MethodBadge({ method }) {
  const m = PAYMENT_METHODS[method] || { label: method, icon: '💰' };
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      padding:'3px 9px', borderRadius:7, fontSize:'0.72rem', fontWeight:600,
      background:'var(--surface3)', color:'var(--text2)',
      border:'1px solid var(--border)', whiteSpace:'nowrap',
    }}>
      <span style={{ fontSize:'0.85rem' }}>{m.icon}</span>
      {m.label}
    </span>
  );
}
