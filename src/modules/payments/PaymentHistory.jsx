// src/modules/payments/PaymentHistory.jsx
import { useAppStore } from '../../store/app.store';
import { useState, useMemo } from 'react';
import { MONTHS_AR, PAYMENT_METHODS, PAYMENT_STATUS } from '../../services/paymentService';
import { StatusBadge, MethodBadge } from './components/PaymentBadge';
import { formatDate, formatCurrency, paginate } from '../../utils/helpers';

const PALETTE = [
  {bg:'rgba(59,130,246,.18)',color:'#3b82f6'},{bg:'rgba(16,185,129,.18)',color:'#10b981'},
  {bg:'rgba(245,158,11,.18)',color:'#f59e0b'},{bg:'rgba(139,92,246,.18)',color:'#8b5cf6'},
  {bg:'rgba(239,68,68,.18)', color:'#ef4444'},
];
const av = (name='') => PALETTE[((name.charCodeAt(0)||0)+(name.charCodeAt(1)||0))%PALETTE.length];

const SEL = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 11px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' };

export default function PaymentHistory({ onAddPayment, onDeletePayment }) {
  const groups               = useAppStore((s) => s.groups);
  const payments             = useAppStore((s) => s.payments);
  const students             = useAppStore((s) => s.students);
  const [filterMonth,  setFilterMonth]  = useState('');
  const [filterGroup,  setFilterGroup]  = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search,       setSearch]       = useState('');
  const [page,         setPage]         = useState(1);
  const PAGE_SIZE = 12;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return payments
      .filter(p => {
        if (filterMonth  && p.month  !== Number(filterMonth))  return false;
        if (filterGroup  && p.groupId !== filterGroup)          return false;
        if (filterStatus && p.status  !== filterStatus)         return false;
        if (q) {
          const student = students.find(s => s.id === p.studentId);
          if (!student?.name.toLowerCase().includes(q) && !p.id.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [payments, students, filterMonth, filterGroup, filterStatus, search]);

  const pg = useMemo(() => paginate(filtered, page, PAGE_SIZE), [filtered, page]);

  const totalFiltered = filtered.reduce((s, p) => s + p.amount, 0);
  const hasFilters = !!(filterMonth || filterGroup || filterStatus || search);

  const clearAll = () => { setFilterMonth(''); setFilterGroup(''); setFilterStatus(''); setSearch(''); setPage(1); };

  return (
    <div>
      {/* Filters */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:16 }}>
        <div style={{ flex:1, minWidth:200, display:'flex', alignItems:'center', gap:8, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'0 12px' }}
          onFocusCapture={e => e.currentTarget.style.borderColor='var(--accent)'}
          onBlurCapture={e  => e.currentTarget.style.borderColor='var(--border)'}
        >
          <span style={{ color:'var(--text3)' }}>🔍</span>
          <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="بحث بالاسم..."
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', padding:'8px 0', direction:'rtl' }}/>
          {search && <button onClick={()=>setSearch('')} style={{ color:'var(--text3)', cursor:'pointer' }}>×</button>}
        </div>

        <select style={SEL} value={filterMonth} onChange={e=>{setFilterMonth(e.target.value);setPage(1);}}>
          <option value="">كل الشهور</option>
          {MONTHS_AR.slice(1).map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
        </select>

        <select style={SEL} value={filterGroup} onChange={e=>{setFilterGroup(e.target.value);setPage(1);}}>
          <option value="">كل المجموعات</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>

        <select style={SEL} value={filterStatus} onChange={e=>{setFilterStatus(e.target.value);setPage(1);}}>
          <option value="">كل الحالات</option>
          {Object.entries(PAYMENT_STATUS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>

        {hasFilters && (
          <button onClick={clearAll} style={{ ...SEL, color:'var(--text3)', cursor:'pointer' }}>× مسح</button>
        )}

        {hasFilters && (
          <div style={{ display:'flex', alignItems:'center', gap:6, padding:'0 12px', background:'rgba(16,185,129,.1)', border:'1px solid rgba(16,185,129,.2)', borderRadius:9, fontSize:'0.78rem', color:'var(--green)', fontWeight:700, fontFamily:'Cairo,sans-serif' }}>
            {formatCurrency(totalFiltered)}
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
        {pg.total === 0 ? (
          <div style={{ textAlign:'center', padding:'48px', color:'var(--text3)' }}>
            <div style={{ fontSize:40, opacity:.4, marginBottom:10 }}>💰</div>
            <div style={{ fontSize:'0.88rem', fontWeight:600 }}>{hasFilters ? 'لا توجد نتائج' : 'لا توجد مدفوعات بعد'}</div>
            {!hasFilters && <button onClick={onAddPayment} style={{ marginTop:12, padding:'8px 18px', borderRadius:9, background:'var(--accent)', color:'var(--surface)', border:'none', fontSize:'0.82rem', fontWeight:700, cursor:'pointer', fontFamily:'Cairo,sans-serif' }}>+ تسجيل أول دفعة</button>}
          </div>
        ) : (
          <>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
                <thead>
                  <tr style={{ background:'var(--surface2)' }}>
                    {['الطالب','الشهر','المبلغ','الطريقة','التاريخ','الحالة',''].map(h => (
                      <th key={h} style={{ padding:'10px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.08em', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pg.items.map(p => {
                    const student = students.find(s => s.id === p.studentId);
                    const group   = groups.find(g => g.id === p.groupId);
                    const { bg, color } = av(student?.name || '');
                    const letters = (student?.name||'').split(' ').map(w=>w[0]).slice(0,2).join('');
                    return (
                      <tr key={p.id} style={{ transition:'background .12s', cursor:'default' }}
                        onMouseOver={e => Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--surface2)')}
                        onMouseOut={e  => Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}
                      >
                        <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                            <div style={{ width:32, height:32, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.75rem', fontWeight:700, flexShrink:0 }}>{letters}</div>
                            <div>
                              <div style={{ fontWeight:600, fontSize:'0.88rem' }}>{student?.name || '—'}</div>
                              <div style={{ fontSize:'0.68rem', color:'var(--text3)' }}>{group?.name || '—'}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontWeight:600 }}>{MONTHS_AR[p.month]}</td>
                        <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', fontWeight:700, color:'var(--green)' }}>{formatCurrency(p.amount)}</td>
                        <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}><MethodBadge method={p.method}/></td>
                        <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text3)' }}>{formatDate(p.date)}</td>
                        <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}><StatusBadge status={p.status}/></td>
                        <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                          <button onClick={() => onDeletePayment?.(p)} title="استرداد كامل" style={{ padding:'3px 9px', borderRadius:6, border:'1px solid rgba(239,68,68,.2)', background:'rgba(239,68,68,.08)', fontSize:'0.7rem', cursor:'pointer', color:'var(--red)', transition:'all .12s', fontFamily:'Cairo,sans-serif' }}
                            onMouseOver={e=>{e.currentTarget.style.background='var(--red)';e.currentTarget.style.color='#fff';}}
                            onMouseOut={e =>{e.currentTarget.style.background='rgba(239,68,68,.08)';e.currentTarget.style.color='var(--red)';}}>
                            ↩️
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pg.totalPages > 1 && (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'11px 18px', borderTop:'1px solid var(--border)', fontSize:'0.78rem', flexWrap:'wrap', gap:8 }}>
                <span style={{ color:'var(--text3)' }}>عرض {pg.start}–{pg.end} من {pg.total} دفعة</span>
                <div style={{ display:'flex', gap:4 }}>
                  <button disabled={!pg.hasPrev} onClick={()=>setPage(p=>p-1)} style={{ minWidth:30, height:30, borderRadius:7, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.78rem', cursor:'pointer', color:'var(--text2)' }}>›</button>
                  {Array.from({length:pg.totalPages},(_,i)=>i+1).filter(p=>Math.abs(p-page)<=2||p===1||p===pg.totalPages).map((p,i,arr)=>(
                    <span key={p}>
                      {i>0&&arr[i-1]!==p-1&&<span style={{padding:'0 4px',color:'var(--text3)'}}>…</span>}
                      <button onClick={()=>setPage(p)} style={{ minWidth:30,height:30,borderRadius:7,border:'1px solid',fontSize:'0.78rem',cursor:'pointer',fontFamily:'Cairo,sans-serif', borderColor:p===page?'var(--accent)':'var(--border)',background:p===page?'var(--accent)':'var(--surface2)',color:p===page?'var(--surface)':'var(--text2)' }}>{p}</button>
                    </span>
                  ))}
                  <button disabled={!pg.hasNext} onClick={()=>setPage(p=>p+1)} style={{ minWidth:30, height:30, borderRadius:7, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.78rem', cursor:'pointer', color:'var(--text2)' }}>‹</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
