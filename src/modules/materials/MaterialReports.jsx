// src/modules/materials/MaterialReports.jsx
import { useState, useMemo } from 'react';
import { useAppStore } from '../../store/app.store';
import { formatDate, formatCurrency } from '../../utils/helpers';
import { PAY_STATUS, deriveMatDist } from '../../services/materialService';
import { PrintHeader } from '../../components/shared';

const TABS = [
  { id:'received',    label:'استلموا',        icon:'✓',  color:'#10b981' },
  { id:'notReceived', label:'لم يستلموا',     icon:'✗',  color:'#ef4444' },
  { id:'paid',        label:'دفعوا',          icon:'💰', color:'#10b981' },
  { id:'unpaid',      label:'لم يدفعوا',      icon:'⚠',  color:'#ef4444' },
  { id:'revenue',     label:'الإيرادات',      icon:'📊', color:'var(--accent)' },
];

const AV_PAL = [
  {bg:'rgba(59,130,246,.18)',color:'#3b82f6'},{bg:'rgba(16,185,129,.18)',color:'#10b981'},
  {bg:'rgba(245,158,11,.18)',color:'#f59e0b'},{bg:'rgba(139,92,246,.18)',color:'#8b5cf6'},
  {bg:'rgba(239,68,68,.18)', color:'#ef4444'},
];
const av = n => AV_PAL[((n.charCodeAt(0)||0)+(n.charCodeAt(1)||0))%AV_PAL.length];

function StudentRow({ student, dist, material }) {
  const { bg, color } = av(student.name);
  const letters = student.name.split(' ').map(w=>w[0]).slice(0,2).join('');
  const payMeta = PAY_STATUS[dist?.payStatus || 'unpaid'];

  return (
    <tr style={{ transition:'background .12s' }}
      onMouseOver={e  => Array.from(e.currentTarget.cells).forEach(td => td.style.background='var(--surface2)')}
      onMouseOut={e   => Array.from(e.currentTarget.cells).forEach(td => td.style.background='')}
    >
      <td style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:9 }}>
          <div style={{ width:30, height:30, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.7rem', fontWeight:700, flexShrink:0 }}>{letters}</div>
          <div>
            <div style={{ fontWeight:600, fontSize:'0.85rem' }}>{student.name}</div>
            <div style={{ fontSize:'0.66rem', color:'var(--text3)', fontFamily:'Cairo,sans-serif' }}>{student.code}</div>
          </div>
        </div>
      </td>
      <td style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>{student.grade}</td>
      <td style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text3)' }}>
        {dist?.receivedAt ? formatDate(dist.receivedAt, {month:'short',day:'numeric'}) : '—'}
      </td>
      <td style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)' }}>
        <span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'2px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:700, background:payMeta.bg, color:payMeta.color, border:`1px solid ${payMeta.border}` }}>
          {payMeta.label}
        </span>
      </td>
      <td style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', fontSize:'0.78rem', fontWeight:700, color:dist?.paidAmount>0?'var(--green)':'var(--text3)' }}>
        {dist?.paidAmount > 0 ? `${dist.paidAmount} ج` : '—'}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────
export default function MaterialReports({ onDistribute }) {
  const inventoryTxn         = useAppStore((s) => s.inventoryTxn);
  const materials            = useAppStore((s) => s.invMaterials);
  const students             = useAppStore((s) => s.students);
  // matDist مُشتَق من inventoryTxn — لا حالة مستقلة بعد الآن.
  const matDist = useMemo(() => deriveMatDist(inventoryTxn), [inventoryTxn]);
  const [tab, setTab]              = useState('received');
  const [filterMat, setFilterMat]  = useState('');
  const [filterSubj, setFilterSubj]= useState('');

  const subjects = useMemo(() => [...new Set(materials.map(m => m.subject))], [materials]);

  const filteredMats = useMemo(() => {
    return materials.filter(m => (!filterSubj || m.subject === filterSubj));
  }, [materials, filterSubj]);

  // For a given tab, build rows
  const reportData = useMemo(() => {
    const rows = [];
    const mats = filterMat ? filteredMats.filter(m => m.id === filterMat) : filteredMats;

    mats.forEach(mat => {
      const matDistRecs = matDist.filter(d => d.matId === mat.id);
      const eligible    = students.filter(s => s.status==='active' && s.grade===mat.grade);

      // Add all students for this material
      eligible.forEach(s => {
        const dist = matDistRecs.find(d => d.studentId === s.id) || { received:false, payStatus:'unpaid', paidAmount:0 };

        let include = false;
        if      (tab === 'received')    include = dist.received;
        else if (tab === 'notReceived') include = !dist.received;
        else if (tab === 'paid')        include = dist.payStatus === 'paid';
        else if (tab === 'unpaid')      include = dist.payStatus === 'unpaid' || !dist.payStatus;
        else if (tab === 'revenue')     include = true; // all for revenue

        if (include) rows.push({ student:s, dist, material:mat });
      });
    });
    return rows;
  }, [filteredMats, filterMat, matDist, students, tab]);

  // Summary stats across filtered
  const summary = useMemo(() => {
    const mats = filterMat ? filteredMats.filter(m=>m.id===filterMat) : filteredMats;
    let total=0, received=0, notReceived=0, collected=0, expected=0;
    mats.forEach(mat => {
      const eligible = students.filter(s => s.status==='active' && s.grade===mat.grade);
      const matD = matDist.filter(d => d.matId===mat.id);
      total      += eligible.length;
      received   += matD.filter(d=>d.received).length;
      notReceived+= eligible.length - matD.filter(d=>d.received).length;
      collected  += matD.reduce((s,d) => s+(d.paidAmount||0), 0);
      expected   += matD.filter(d=>d.received).length * mat.price;
    });
    return { total, received, notReceived, collected, expected };
  }, [filteredMats, filterMat, matDist, students]);

  const SEL = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 10px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' };

  return (
    <>
      <PrintHeader reportTitle="تقارير المذكرات" reportSubtitle="" />
      <div>
      {/* Summary cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:20 }}>
        {[
          { l:'إجمالي الطلاب',   v:summary.total,       c:'var(--text)'  },
          { l:'استلموا',          v:summary.received,    c:'#10b981'      },
          { l:'لم يستلموا',      v:summary.notReceived, c:'#ef4444'      },
          { l:'إجمالي المحصّل',  v:formatCurrency(summary.collected), c:'var(--green)' },
          { l:'نسبة التحصيل',    v: summary.expected > 0 ? `${Math.round(summary.collected/summary.expected*100)}%` : '—', c:'var(--accent)' },
        ].map(s => (
          <div key={s.l} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'14px 16px', textAlign:'center' }}>
            <div style={{ fontSize:'1.3rem', fontWeight:800, color:s.c, fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{s.v}</div>
            <div style={{ fontSize:'0.66rem', color:'var(--text3)', marginTop:4 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
        <select style={SEL} value={filterSubj} onChange={e => { setFilterSubj(e.target.value); setFilterMat(''); }}>
          <option value="">كل المواد</option>
          {subjects.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={SEL} value={filterMat} onChange={e => setFilterMat(e.target.value)}>
          <option value="">كل المذكرات</option>
          {filteredMats.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {(filterSubj||filterMat) && (
          <button onClick={() => { setFilterSubj(''); setFilterMat(''); }} style={{ ...SEL, color:'var(--text3)', cursor:'pointer' }}>× مسح</button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:2, marginBottom:16, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:12, padding:3, width:'fit-content', flexWrap:'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'7px 14px', borderRadius:10, fontSize:'0.82rem', fontWeight:tab===t.id?700:500, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .15s', border:'none',
              background:tab===t.id?'var(--surface)':'transparent',
              color:      tab===t.id?t.color:'var(--text2)',
              boxShadow:  tab===t.id?'0 1px 4px rgba(0,0,0,.15)':'none',
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Revenue special view */}
      {tab === 'revenue' ? (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {(filterMat ? filteredMats.filter(m=>m.id===filterMat) : filteredMats).map(mat => {
            const matD    = matDist.filter(d => d.matId===mat.id);
            const eligible= students.filter(s => s.status==='active' && s.grade===mat.grade).length;
            const rec     = matD.filter(d=>d.received).length;
            const coll    = matD.reduce((s,d) => s+(d.paidAmount||0), 0);
            const exp     = rec * mat.price;
            const pct     = exp > 0 ? Math.round(coll/exp*100) : 0;

            return (
              <div key={mat.id} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'16px 18px' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexWrap:'wrap', gap:8 }}>
                  <div>
                    <div style={{ fontWeight:800, fontSize:'0.92rem' }}>{mat.name}</div>
                    <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginTop:2 }}>{mat.subject} · {mat.grade} · {mat.teacher || '—'}</div>
                  </div>
                  <div style={{ display:'flex', gap:10 }}>
                    <div style={{ textAlign:'center', background:'var(--surface2)', borderRadius:10, padding:'8px 14px' }}>
                      <div style={{ fontSize:'1rem', fontWeight:800, color:'var(--green)', fontFamily:'Cairo,sans-serif' }}>{formatCurrency(coll)}</div>
                      <div style={{ fontSize:'0.62rem', color:'var(--text3)', marginTop:2 }}>محصّل</div>
                    </div>
                    <div style={{ textAlign:'center', background:'var(--surface2)', borderRadius:10, padding:'8px 14px' }}>
                      <div style={{ fontSize:'1rem', fontWeight:800, color:'var(--text3)', fontFamily:'Cairo,sans-serif' }}>{formatCurrency(exp)}</div>
                      <div style={{ fontSize:'0.62rem', color:'var(--text3)', marginTop:2 }}>متوقع</div>
                    </div>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ flex:1, height:6, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${pct}%`, background: pct>=80?'#10b981':pct>=50?'#f59e0b':'#ef4444', transition:'width .5s' }}/>
                  </div>
                  <span style={{ fontSize:'0.75rem', fontWeight:800, fontFamily:'Cairo,sans-serif', color: pct>=80?'#10b981':pct>=50?'#f59e0b':'#ef4444', minWidth:36 }}>{pct}%</span>
                </div>
                <div style={{ display:'flex', gap:12, marginTop:8, fontSize:'0.72rem', color:'var(--text3)' }}>
                  <span>استلم: <b style={{ color:'var(--text)' }}>{rec}</b></span>
                  <span>من: <b style={{ color:'var(--text)' }}>{eligible}</b> طالب</span>
                  <span>سعر المذكرة: <b style={{ color:'var(--text)', fontFamily:'Cairo,sans-serif' }}>{mat.price} ج.م</b></span>
                </div>
                <button onClick={() => onDistribute(mat)}
                  style={{ marginTop:10, padding:'5px 14px', borderRadius:8, border:'1px solid var(--accent)', background:'rgba(13,148,136,.1)', color:'var(--accent)', fontSize:'0.75rem', fontWeight:700, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s' }}
                  onMouseOver={e => { e.currentTarget.style.background='var(--accent)'; e.currentTarget.style.color='var(--surface)'; }}
                  onMouseOut={e  => { e.currentTarget.style.background='rgba(13,148,136,.1)'; e.currentTarget.style.color='var(--accent)'; }}
                >
                  👥 فتح التوزيع
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        /* Student list for other tabs */
        reportData.length === 0 ? (
          <div style={{ textAlign:'center', padding:'48px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, color:'var(--text3)' }}>
            <div style={{ fontSize:40, opacity:.4, marginBottom:10 }}>
              {tab==='received'?'✓':tab==='paid'?'💰':'👥'}
            </div>
            <div style={{ fontWeight:600 }}>لا توجد نتائج</div>
          </div>
        ) : (
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
            <div style={{ padding:'12px 16px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', fontWeight:700, color:'var(--text3)' }}>
              {reportData.length} طالب
            </div>
            <div style={{ maxHeight:460, overflowY:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
                <thead style={{ position:'sticky', top:0 }}>
                  <tr style={{ background:'var(--surface2)' }}>
                    {['الطالب','السنة الدراسية','تاريخ الاستلام','حالة الدفع','المبلغ المدفوع'].map(h => (
                      <th key={h} style={{ padding:'8px 16px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportData.map(({ student, dist, material }, i) => (
                    <StudentRow key={`${student.id}-${material.id}`} student={student} dist={dist} material={material}/>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
    </>
  );
}
