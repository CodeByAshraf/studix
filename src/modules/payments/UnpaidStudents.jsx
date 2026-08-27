// src/modules/payments/UnpaidStudents.jsx
import { useAppStore } from '../../store/app.store';
import { useState, useMemo } from 'react';
import { MONTHS_AR, getUnpaidStudents, getPartialStudents, getStudentFee, getNetRevenue } from '../../services/paymentService';
import { formatCurrency } from '../../utils/helpers';
import Button from '../../components/ui/Button';

const PALETTE = [
  {bg:'rgba(59,130,246,.18)',color:'#3b82f6'},{bg:'rgba(16,185,129,.18)',color:'#10b981'},
  {bg:'rgba(245,158,11,.18)',color:'#f59e0b'},{bg:'rgba(139,92,246,.18)',color:'#8b5cf6'},
  {bg:'rgba(239,68,68,.18)', color:'#ef4444'},
];
const av = (name='') => PALETTE[((name.charCodeAt(0)||0)+(name.charCodeAt(1)||0))%PALETTE.length];

const SEL = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 11px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' };

export default function UnpaidStudents({ onQuickPay }) {
  const groups               = useAppStore((s) => s.groups);
  const payments             = useAppStore((s) => s.payments);
  const students             = useAppStore((s) => s.students);
  const treasuryTxn          = useAppStore((s) => s.treasuryTxn);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [filterGroup, setFilterGroup] = useState('');
  const [tab, setTab] = useState('unpaid'); // 'unpaid' | 'partial'

  const year = new Date().getFullYear();

  const unpaid = useMemo(() => {
    let list = getUnpaidStudents(students, payments, month, year);
    if (filterGroup) list = list.filter(s => s.groupId === filterGroup);
    return list;
  }, [students, payments, month, year, filterGroup]);

  const partial = useMemo(() => {
    let list = getPartialStudents(students, payments, month, year);
    if (filterGroup) list = list.filter(s => s.groupId === filterGroup);
    return list;
  }, [students, payments, month, year, filterGroup]);

  const activeList = tab === 'unpaid' ? unpaid : partial;

  // Potential revenue (unpaid * student fee)
  const potentialRevenue = unpaid.reduce((sum, s) => {
    const g = groups.find(g => g.id === s.groupId);
    return sum + getStudentFee(s, g);
  }, 0);

  // BUG-02: "paid" كان يجمع payments.amount الخام — دفعة استُرِدَّت جزئياً تُبقي "المتبقي"
  // أقل مما هو فعلاً. getNetRevenue تطرح أي استرداد فعّال (treasury_txn) لكل دفعة.
  const partialRemaining = partial.reduce((sum, s) => {
    const g = groups.find(g => g.id === s.groupId);
    const paid = getNetRevenue(payments.filter(p => p.studentId === s.id && p.month === month && p.year === year), treasuryTxn);
    return sum + Math.max(0, getStudentFee(s, g) - paid);
  }, 0);

  return (
    <div>
      {/* Controls */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:16 }}>
        <select style={SEL} value={month} onChange={e => setMonth(Number(e.target.value))}>
          {MONTHS_AR.slice(1).map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
        </select>
        <select style={SEL} value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
          <option value="">كل المجموعات</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {/* Summary cards */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'16px 18px' }}>
          <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>⚠ لم يدفعوا بعد</div>
          <div style={{ fontSize:'1.6rem', fontWeight:800, color:'#ef4444', fontFamily:'Cairo,sans-serif' }}>{unpaid.length}</div>
          <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginTop:4 }}>إيراد محتمل: <span style={{ color:'var(--green)', fontWeight:700 }}>{formatCurrency(potentialRevenue)}</span></div>
        </div>
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'16px 18px' }}>
          <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>⏱ دفعوا جزئياً</div>
          <div style={{ fontSize:'1.6rem', fontWeight:800, color:'#f59e0b', fontFamily:'Cairo,sans-serif' }}>{partial.length}</div>
          <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginTop:4 }}>متبقي: <span style={{ color:'#f59e0b', fontWeight:700 }}>{formatCurrency(partialRemaining)}</span></div>
        </div>
      </div>

      {/* Tab toggle */}
      <div style={{ display:'flex', gap:2, marginBottom:14, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:10, padding:3, width:'fit-content' }}>
        {[
          { id:'unpaid', label:`لم يدفعوا (${unpaid.length})` },
          { id:'partial',label:`جزئي (${partial.length})`      },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding:'7px 16px', borderRadius:8, fontSize:'0.82rem', fontWeight:tab===t.id?700:500, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s', border:'none',
              background:tab===t.id ? 'var(--surface)' : 'transparent',
              color:      tab===t.id ? 'var(--accent)'  : 'var(--text2)',
              boxShadow:  tab===t.id ? '0 1px 4px rgba(0,0,0,.15)' : 'none',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Students list */}
      {activeList.length === 0 ? (
        <div style={{ textAlign:'center', padding:'48px', color:'var(--text3)' }}>
          <div style={{ fontSize:40, marginBottom:10, opacity:.4 }}>🎉</div>
          <div style={{ fontWeight:600 }}>
            {tab === 'unpaid' ? `جميع الطلاب دفعوا رسوم ${MONTHS_AR[month]}` : `لا يوجد دفع جزئي هذا الشهر`}
          </div>
        </div>
      ) : (
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
          {activeList.map((student, i) => {
            const group  = groups.find(g => g.id === student.groupId);
            const { bg, color } = av(student.name);
            const letters = student.name.split(' ').map(w=>w[0]).slice(0,2).join('');
            // BUG-02: صافي بعد طرح أي استرداد فعّال — نفس منطق partialRemaining أعلاه.
            const paidSoFar = getNetRevenue(payments.filter(p => p.studentId === student.id && p.month === month && p.year === year), treasuryTxn);
            const remaining = group ? Math.max(0, getStudentFee(student, group) - paidSoFar) : 0;

            return (
              <div key={student.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 16px', borderBottom: i < activeList.length-1 ? '1px solid var(--border)' : 'none', transition:'background .12s' }}
                onMouseOver={e  => e.currentTarget.style.background='var(--surface2)'}
                onMouseOut={e   => e.currentTarget.style.background=''}
              >
                {/* Avatar */}
                <div style={{ width:36, height:36, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.78rem', fontWeight:700, flexShrink:0 }}>{letters}</div>

                {/* Info */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{student.name}</div>
                  <div style={{ fontSize:'0.7rem', color:'var(--text3)', display:'flex', gap:8, marginTop:1 }}>
                    <span>{group?.name || '—'}</span>
                    {group && (
                      <>
                        <span>·</span>
                        <span>الاشتراك: <span style={{ fontFamily:'Cairo,sans-serif', fontWeight:700 }}>{getStudentFee(student, group)} ج.م</span></span>
                        {paidSoFar > 0 && <>
                          <span>·</span>
                          <span style={{ color:'var(--green)', fontWeight:700 }}>دفع: {paidSoFar} ج.م</span>
                        </>}
                      </>
                    )}
                  </div>
                </div>

                {/* Remaining */}
                {remaining > 0 && (
                  <div style={{ textAlign:'center', flexShrink:0 }}>
                    <div style={{ fontSize:'1rem', fontWeight:800, color:'#ef4444', fontFamily:'Cairo,sans-serif' }}>{remaining}</div>
                    <div style={{ fontSize:'0.6rem', color:'var(--text3)' }}>ج.م متبقي</div>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                  <a href={`tel:${student.parentPhone || student.phone}`}
                    style={{ padding:'5px 10px', borderRadius:7, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.72rem', color:'var(--text2)', textDecoration:'none', transition:'all .12s' }}
                    onMouseOver={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--accent)'; }}
                    onMouseOut={e  => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text2)'; }}>
                    📞
                  </a>
                  <Button variant="primary" size="sm" onClick={() => onQuickPay(student.id)}>
                    💰 تسجيل دفعة
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
