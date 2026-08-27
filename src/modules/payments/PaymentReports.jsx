// src/modules/payments/PaymentReports.jsx
import { useState, useMemo } from 'react';
import { useAppStore } from '../../store/app.store';
import { MONTHS_AR, getMonthlyBreakdown, getRevenueByGroup, getStudentFee, getRefundedAmount, getNetRevenue } from '../../services/paymentService';
import { formatCurrency } from '../../utils/helpers';
import { PrintHeader } from '../../components/shared';
import { openPaymentsReportPrint, openStudentPaymentsReport } from './buildPaymentsReport';
import Button from '../../components/ui/Button';

function BarChart({ data, valueKey, labelKey, colorFn, maxVal, height = 120 }) {
  const max = maxVal || Math.max(...data.map(d => d[valueKey]), 1);
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:4, height, padding:'0 4px' }}>
      {data.map((d, i) => {
        const pct = Math.round((d[valueKey] / max) * 100);
        const color = colorFn ? colorFn(d, i) : 'var(--accent)';
        return (
          <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
            <div style={{
              width:'100%', background:color+'28', borderRadius:'4px 4px 0 0',
              height:`${pct}%`, minHeight: d[valueKey] > 0 ? 4 : 0,
              position:'relative', cursor:'default', transition:'background .15s',
            }}
              onMouseOver={e  => e.currentTarget.style.background = color+'55'}
              onMouseOut={e   => e.currentTarget.style.background = color+'28'}
              title={`${d[labelKey]}: ${formatCurrency(d[valueKey])}`}
            >
              {pct > 0 && (
                <div style={{
                  position:'absolute', top:-18, left:'50%', transform:'translateX(-50%)',
                  fontSize:'0.58rem', fontWeight:700, color, fontFamily:'Cairo,sans-serif', whiteSpace:'nowrap',
                  opacity: d[valueKey] > 0 ? 1 : 0,
                }}>
                  {d[valueKey] > 999 ? `${Math.round(d[valueKey]/1000)}k` : d[valueKey]}
                </div>
              )}
              <div style={{ position:'absolute', bottom:0, width:'100%', height:`${pct}%`, background:color, borderRadius:'3px 3px 0 0' }}/>
            </div>
            <span style={{ fontSize:'0.6rem', color:'var(--text3)', textAlign:'center', maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {d[labelKey]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ title, value, sub, color = 'var(--text)' }) {
  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'16px 18px' }}>
      <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>{title}</div>
      <div style={{ fontSize:'1.5rem', fontWeight:800, color, fontFamily:'Cairo,sans-serif', letterSpacing:'-0.4px', lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginTop:5 }}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
export default function PaymentReports() {
  const groups               = useAppStore((s) => s.groups);
  const payments             = useAppStore((s) => s.payments);
  const students             = useAppStore((s) => s.students);
  const treasuryTxn          = useAppStore((s) => s.treasuryTxn);
  const [reportTab, setReportTab] = useState('monthly');
  const [year, setYear] = useState(new Date().getFullYear());
  const centerProfile        = useAppStore((s) => s.centerProfile);
  // اختيارات كشف الطباعة (مجموعة + شهر)
  const [printGroupId, setPrintGroupId] = useState('');
  const [printMonth, setPrintMonth] = useState(new Date().getMonth() + 1);
  const [printMode, setPrintMode] = useState('group'); // 'group' | 'student'
  const [printStudentId, setPrintStudentId] = useState('');

  // ── Monthly breakdown ─────────────────────────────────────
  const monthly = useMemo(() => getMonthlyBreakdown(payments, year, treasuryTxn), [payments, year, treasuryTxn]);
  const totalYear = monthly.reduce((s, m) => s + m.revenue, 0);
  const bestMonth = monthly.reduce((best, m) => m.revenue > best.revenue ? m : best, { revenue: 0, label: '—' });
  const avgMonthly = Math.round(totalYear / 12);

  // ── Group breakdown ───────────────────────────────────────
  const byGroup = useMemo(() => getRevenueByGroup(payments, groups, treasuryTxn), [payments, groups, treasuryTxn]);
  const maxGroupRev = Math.max(...byGroup.map(g => g.revenue), 1);

  // ── Daily (current month) ─────────────────────────────────
  const currentMonth = new Date().getMonth() + 1;
  const dailyData = useMemo(() => {
    const thisMonthPayments = payments.filter(p => {
      const d = new Date(p.date);
      return d.getMonth() + 1 === currentMonth && d.getFullYear() === year;
    });
    const byDay = {};
    thisMonthPayments.forEach(p => {
      byDay[p.date] = (byDay[p.date] || 0) + (p.amount - getRefundedAmount(p.id, treasuryTxn));
    });
    return Object.entries(byDay)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([date, revenue]) => ({
        date,
        label: new Date(date).getDate() + '/' + (new Date(date).getMonth()+1),
        revenue,
      }));
  }, [payments, currentMonth, year, treasuryTxn]);

  const dailyTotal = dailyData.reduce((s, d) => s + d.revenue, 0);

  const GROUP_COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#84cc16','#f97316'];

  const TABS = [
    { id:'monthly', label:'الشهري' },
    { id:'daily',   label:'اليومي (الشهر الحالي)' },
    { id:'group',   label:'حسب المجموعة' },
    { id:'print',   label:'🖨 طباعة كشف' },
  ];

  return (
    <>
      <PrintHeader reportTitle="تقارير المدفوعات" reportSubtitle="" />
      <div>
      {/* Year selector + Tabs */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:10 }}>
        <div style={{ display:'flex', gap:2, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:10, padding:3, width:'fit-content' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setReportTab(t.id)}
              style={{ padding:'7px 16px', borderRadius:8, fontSize:'0.82rem', fontWeight:reportTab===t.id?700:500, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .15s', border:'none',
                background:reportTab===t.id ? 'var(--surface)' : 'transparent',
                color:      reportTab===t.id ? 'var(--accent)'  : 'var(--text2)',
                boxShadow:  reportTab===t.id ? '0 1px 4px rgba(0,0,0,.15)' : 'none',
              }}>
              {t.label}
            </button>
          ))}
        </div>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer' }}>
          {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* ── MONTHLY REPORT ──────────────────────── */}
      {reportTab === 'monthly' && (
        <div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 }}>
            <StatCard title="إيراد السنة الكلي"    value={formatCurrency(totalYear)} color="var(--green)"/>
            <StatCard title="أفضل شهر"             value={bestMonth.label} sub={formatCurrency(bestMonth.revenue)}/>
            <StatCard title="متوسط شهري"           value={formatCurrency(avgMonthly)}/>
          </div>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'20px 20px 10px', marginBottom:4 }}>
            <div style={{ fontSize:'0.85rem', fontWeight:700, marginBottom:16 }}>الإيراد الشهري — {year}</div>
            <BarChart data={monthly} valueKey="revenue" labelKey="label"
              colorFn={(d) => d.revenue === bestMonth.revenue ? 'var(--accent)' : 'var(--blue, #3b82f6)'}
              height={140}/>
          </div>
          {/* Monthly detail table */}
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden', marginTop:14 }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
              <thead>
                <tr style={{ background:'var(--surface2)' }}>
                  {['الشهر','الإيراد','عدد الدفعات','المتوسط اليومي'].map(h => (
                    <th key={h} style={{ padding:'9px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthly.filter(m => m.revenue > 0).map(m => (
                  <tr key={m.month} style={{ transition:'background .12s' }}
                    onMouseOver={e => Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--surface2)')}
                    onMouseOut={e  => Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontWeight:600 }}>{m.label}</td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', fontWeight:700, color:'var(--green)' }}>{formatCurrency(m.revenue)}</td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif' }}>{m.count}</td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', color:'var(--text3)' }}>{formatCurrency(Math.round(m.revenue/30))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── DAILY REPORT ──────────────────────────── */}
      {reportTab === 'daily' && (
        <div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 }}>
            <StatCard title={`إيراد ${MONTHS_AR[currentMonth]}`} value={formatCurrency(dailyTotal)} color="var(--green)"/>
            <StatCard title="أيام فيها دفعات" value={dailyData.length}/>
            <StatCard title="متوسط يومي"       value={formatCurrency(dailyData.length > 0 ? Math.round(dailyTotal/dailyData.length) : 0)}/>
          </div>
          {dailyData.length === 0 ? (
            <div style={{ textAlign:'center', padding:'48px', color:'var(--text3)', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14 }}>
              <div style={{ fontSize:38, opacity:.4, marginBottom:8 }}>📊</div>
              <div>لا توجد دفعات هذا الشهر</div>
            </div>
          ) : (
            <>
              <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'20px 20px 10px', marginBottom:14 }}>
                <div style={{ fontSize:'0.85rem', fontWeight:700, marginBottom:16 }}>الإيراد اليومي — {MONTHS_AR[currentMonth]} {year}</div>
                <BarChart data={dailyData} valueKey="revenue" labelKey="label"
                  colorFn={() => 'var(--accent)'} height={120}/>
              </div>
              <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
                  <thead>
                    <tr style={{ background:'var(--surface2)' }}>
                      {['التاريخ','الإيراد'].map(h => (
                        <th key={h} style={{ padding:'9px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...dailyData].reverse().map(d => (
                      <tr key={d.date} onMouseOver={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--surface2)')} onMouseOut={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}>
                        <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontWeight:600 }}>{new Date(d.date).toLocaleDateString('ar-EG',{weekday:'long',month:'long',day:'numeric'})}</td>
                        <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', fontWeight:700, color:'var(--green)' }}>{formatCurrency(d.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── GROUP REPORT ──────────────────────────── */}
      {reportTab === 'group' && (
        <div>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'20px 20px 10px', marginBottom:14 }}>
            <div style={{ fontSize:'0.85rem', fontWeight:700, marginBottom:16 }}>الإيراد حسب المجموعة</div>
            <BarChart data={byGroup.map((g,i)=>({...g,label:g.name.split('—')[0].trim()}))} valueKey="revenue" labelKey="label"
              colorFn={(_,i) => GROUP_COLORS[i % GROUP_COLORS.length]} height={130}/>
          </div>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
              <thead>
                <tr style={{ background:'var(--surface2)' }}>
                  {['المجموعة','المادة','السعر الشهري','إجمالي الإيراد','نسبة السداد'].map(h => (
                    <th key={h} style={{ padding:'9px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byGroup.sort((a,b) => b.revenue - a.revenue).map((g,i) => {
                  const groupActiveStudents = students.filter(s => s.groupId === g.id && s.status === 'active');
                  const studentCount = groupActiveStudents.length;
                  const expectedMonthly = groupActiveStudents.reduce((sum, s) => sum + getStudentFee(s, g), 0);
                  const currentMonthRevenue = getNetRevenue(payments.filter(p => p.groupId === g.id && p.month === currentMonth && p.year === year), treasuryTxn);
                  const paymentRate = expectedMonthly > 0 ? Math.round(currentMonthRevenue/expectedMonthly*100) : 0;
                  return (
                    <tr key={g.id} onMouseOver={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--surface2)')} onMouseOut={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}>
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ width:9, height:9, borderRadius:'50%', background:GROUP_COLORS[i%GROUP_COLORS.length], flexShrink:0 }}/>
                          <span style={{ fontWeight:600 }}>{g.name}</span>
                        </div>
                      </td>
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>{g.subject}</td>
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', color:'var(--text2)' }}>{studentCount > 0 ? Math.round(expectedMonthly/studentCount) : (g.price || '—')} ج.م</td>
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', fontWeight:700, color:'var(--green)' }}>{formatCurrency(g.revenue)}</td>
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ width:70, height:5, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
                            <div style={{ height:'100%', width:`${Math.min(paymentRate,100)}%`, background: paymentRate>=80?'#10b981':paymentRate>=50?'#f59e0b':'#ef4444', borderRadius:99 }}/>
                          </div>
                          <span style={{ fontSize:'0.72rem', fontWeight:700, fontFamily:'Cairo,sans-serif', color: paymentRate>=80?'#10b981':paymentRate>=50?'#f59e0b':'#ef4444' }}>{paymentRate}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reportTab === 'print' && (() => {
        const selStyle = { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'10px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.88rem', cursor:'pointer', direction:'rtl' };
        const lblStyle = { fontSize:'0.75rem', fontWeight:700, color:'var(--text3)', display:'block', marginBottom:6 };
        const modeStudents = students.filter(s => s.groupId === printGroupId && s.status === 'active');
        return (
        <div style={{ maxWidth:560, margin:'0 auto', padding:'8px 4px' }}>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'24px' }}>
            <div style={{ fontWeight:800, fontSize:'1rem', marginBottom:16 }}>🖨 طباعة كشف مدفوعات</div>

            {/* اختيار النوع */}
            <div style={{ display:'flex', gap:8, marginBottom:18, background:'var(--surface2)', borderRadius:10, padding:3 }}>
              {[{id:'group',l:'مجموعة + شهر'},{id:'student',l:'بالطالب (كل مدفوعاته)'}].map(m => (
                <button key={m.id} onClick={()=>setPrintMode(m.id)}
                  style={{ flex:1, padding:'8px', borderRadius:8, border:'none', cursor:'pointer', fontFamily:'Cairo,sans-serif', fontSize:'0.8rem', fontWeight:printMode===m.id?700:500,
                    background:printMode===m.id?'var(--accent)':'transparent', color:printMode===m.id?'var(--surface)':'var(--text2)' }}>
                  {m.l}
                </button>
              ))}
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={lblStyle}>المجموعة</label>
                <select value={printGroupId} onChange={e=>{setPrintGroupId(e.target.value);setPrintStudentId('');}} style={selStyle}>
                  <option value="">اختر المجموعة...</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}{g.grade ? ` — ${g.grade}` : ''}</option>)}
                </select>
              </div>

              {printMode === 'group' && (
                <div>
                  <label style={lblStyle}>الشهر</label>
                  <select value={printMonth} onChange={e=>setPrintMonth(Number(e.target.value))} style={selStyle}>
                    {MONTHS_AR.slice(1).map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
                  </select>
                </div>
              )}

              {printMode === 'student' && (
                <div>
                  <label style={lblStyle}>الطالب</label>
                  <select value={printStudentId} onChange={e=>setPrintStudentId(e.target.value)} style={selStyle} disabled={!printGroupId}>
                    <option value="">{!printGroupId ? 'اختر المجموعة أولاً...' : 'اختر الطالب...'}</option>
                    {modeStudents.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}

              <Button variant="primary"
                disabled={printMode==='group' ? !printGroupId : (!printGroupId || !printStudentId)}
                onClick={() => {
                  const group = groups.find(g => g.id === printGroupId);
                  if (printMode === 'group') {
                    openPaymentsReportPrint({ group, month:printMonth, year, students, payments, profile:centerProfile, treasuryTxn });
                  } else {
                    const student = students.find(s => s.id === printStudentId);
                    openStudentPaymentsReport({ student, group, payments, profile:centerProfile, treasuryTxn });
                  }
                }} style={{ marginTop:6 }}>
                🖨 توليد الكشف وطباعته
              </Button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
    </>
  );
}
