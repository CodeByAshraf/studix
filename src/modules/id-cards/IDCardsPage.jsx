// src/modules/id-cards/IDCardsPage.jsx
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { SectionBoundary } from '../../components/ErrorBoundary';
import { CardFront, CardBack } from './components/StudentCard';
import QRCode, { buildQRPayload } from './components/QRCode';
import QRScanner       from './components/QRScanner';
import { qrToSVG }       from '../../utils/qrcode';
import { sanitizeSVG, escapeHTML } from '../../utils/sanitize';

const AV_PAL = [
  {bg:'rgba(59,130,246,.18)',color:'#3b82f6'},{bg:'rgba(16,185,129,.18)',color:'#10b981'},
  {bg:'rgba(245,158,11,.18)',color:'#f59e0b'},{bg:'rgba(139,92,246,.18)',color:'#8b5cf6'},
  {bg:'rgba(239,68,68,.18)', color:'#ef4444'},
];
const avStyle = n => AV_PAL[((n?.charCodeAt(0)||0)+(n?.charCodeAt(1)||0))%AV_PAL.length];

const VIEWS = [
  { id:'cards',   icon:'🪪', label:'بطاقات الطلاب'     },
  { id:'scanner', icon:'📷', label:'تسجيل QR'           },
];

function MiniQR({ student, size = 48 }) {
  const svgStr = useMemo(() => {
    if (!student) return '';
    const raw = qrToSVG(buildQRPayload(student), { size, fg: 'var(--text)', bg: 'transparent', quiet: 2 });
    return sanitizeSVG(raw);
  }, [student?.id, size]);
  return <div dangerouslySetInnerHTML={{ __html: svgStr }} style={{ lineHeight: 0, flexShrink: 0 }}/>;
}

function printCard(student, group, theme) {
  const accentColors = ['#1a56db','#059669','#7c3aed','#d97706','#0d9488','#e11d48'];
  const accent   = group?.color || accentColors[((student.name.charCodeAt(0)||0)+(student.name.charCodeAt(1)||0))%accentColors.length];
  const isDark   = theme === 'dark';
  const bg       = isDark ? '#0f172a' : '#ffffff';
  const tx       = isDark ? '#f8fafc' : '#0f172a';
  const sub      = isDark ? '#94a3b8' : '#64748b';
  // sanitizeSVG: يمنع أي SVG خبيث من الظهور في نافذة الطباعة
  const qrSvg    = sanitizeSVG(qrToSVG(buildQRPayload(student), { size:96, fg:'#000000', bg:'#ffffff', quiet:2 }));
  // escapeHTML: كل بيانات الطالب تُهرَّب قبل إدراجها في HTML string
  const initials = escapeHTML(student.name.split(' ').map(w=>w[0]).slice(0,2).join(''));
  const sName    = escapeHTML(student.name);
  const sGrade   = escapeHTML(student.grade);
  const sCode    = escapeHTML(student.code);
  const sPhone   = escapeHTML(student.phone);
  const gName    = escapeHTML(group?.name    || '');
  const gTeacher = escapeHTML(group?.teacher || '—');
  const sParent  = escapeHTML(student.parentPhone || '—');
  const sEnroll  = escapeHTML(student.enrollDate  || '—');
  const sSchool  = escapeHTML(student.school      || '—');
  const sStatus  = student.status === 'active' ? 'نشط' : 'موقوف';
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet"><title>بطاقة ${sName}</title><style>*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:Cairo,sans-serif;direction:rtl;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;gap:18px;flex-direction:column}.card{width:320px;height:200px;border-radius:16px;position:relative;overflow:hidden;background:${bg};border:1px solid ${isDark?'#1e293b':'#e2e8f0'};box-shadow:${isDark?'0 8px 32px rgba(0,0,0,.35)':'0 6px 24px rgba(15,23,42,.10)'}}.bar{position:absolute;top:0;left:0;right:0;height:5px;background:linear-gradient(135deg,${accent},${accent}cc)}@media print{body{background:#fff;padding:0;flex-direction:row;flex-wrap:wrap;gap:8px;align-items:flex-start}@page{size:landscape;margin:8mm}.no-print{display:none!important}.card{box-shadow:none;border:1px solid #cbd5e1}}</style></head><body>
<div class="card"><div class="bar"></div>
<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px 8px">
<div style="display:flex;align-items:center;gap:7px"><div style="width:28px;height:28px;border-radius:7px;background:linear-gradient(135deg,${accent},${accent}cc);display:flex;align-items:center;justify-content:center;font-family:Cairo,sans-serif;font-weight:900;font-size:11px;color:#fff">Sx</div><div><div style="font-size:0.68rem;font-weight:800;color:${accent}">Studix</div><div style="font-size:0.52rem;color:${sub}">Student Card</div></div></div>
<span style="padding:2px 8px;border-radius:99px;font-size:0.55rem;font-weight:700;background:${student.status==='active'?'rgba(16,185,129,.15)':'rgba(245,158,11,.15)'};color:${student.status==='active'?'#10b981':'#f59e0b'}">${sStatus}</span></div>
<div style="display:flex;gap:12px;padding:0 16px"><div style="width:58px;height:58px;border-radius:13px;background:linear-gradient(135deg,${accent},${accent}cc);display:flex;align-items:center;justify-content:center;font-size:1.25rem;font-weight:800;color:#fff;flex-shrink:0">${initials}</div>
<div style="flex:1;min-width:0"><div style="font-weight:900;font-size:0.98rem;color:${tx};line-height:1.2;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sName}</div><div style="font-size:0.62rem;color:${sub};margin-bottom:5px">${sGrade}</div>${group?`<div style="display:inline-flex;background:${accent}22;border-radius:5px;padding:2px 7px;font-size:0.6rem;color:${accent};font-weight:700">${gName}</div>`:''}</div></div>
<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px 10px;margin-top:8px">
<div><div style="font-size:0.52rem;color:${sub};margin-bottom:1px">رقم الطالب</div><div style="font-size:0.78rem;font-weight:800;color:${tx};font-family:Cairo,sans-serif">${sCode}</div></div>
<div><div style="font-size:0.52rem;color:${sub};margin-bottom:1px">الهاتف</div><div style="font-size:0.68rem;color:${tx};font-family:Cairo,sans-serif;direction:ltr">${sPhone}</div></div></div></div>
<div class="card"><div class="bar"></div>
<div style="display:flex;height:100%;padding-top:5px">
<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px 14px;gap:5px;width:130px"><div style="background:#fff;padding:5px;border-radius:10px;border:2px solid ${accent}30">${qrSvg}</div><div style="font-size:0.52rem;color:${sub};text-align:center">امسح للحضور / الانصراف</div></div>
<div style="width:1px;background:${isDark?'#1e293b':'#e2e8f0'};margin:14px 0"></div>
<div style="flex:1;padding:10px 12px;display:flex;flex-direction:column;gap:7px">
${[['الكود',sCode,true],['المدرس',gTeacher,false],['ولي الأمر',sParent,true],['تاريخ التسجيل',sEnroll,false],['المدرسة',sSchool,false]].map(([l,v,m])=>`<div><div style="font-size:0.5rem;color:${sub};margin-bottom:1px">${l}</div><div style="font-size:0.68rem;font-weight:700;color:${tx};font-family:${m?'Cairo,sans-serif':'Cairo,sans-serif'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v}</div></div>`).join('')}
</div></div></div>
<button class="no-print" onclick="window.print()" style="padding:10px 24px;background:${accent};color:#fff;border:none;border-radius:9px;font-family:Cairo,sans-serif;font-size:1rem;font-weight:700;cursor:pointer">🖨 طباعة</button>
</body></html>`;
  const win = window.open('', '_blank');
  if (win) { win.document.write(html); win.document.close(); }
}

export default function IDCardsPage() {
  const groups               = useAppStore((s) => s.groups);
  const students             = useAppStore((s) => s.students);
  const [view,         setView]        = useState('cards');
  const [search,       setSearch]      = useState('');
  const [filterGroup,  setFilterGroup] = useState('');
  const [filterStatus, setFilterStatus]= useState('active');
  const [theme,        setTheme]       = useState('light');
  const [selectedId,   setSelectedId]  = useState(null);
  const [cardView,     setCardView]    = useState('gallery');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return students.filter(s =>
      (!filterStatus || s.status === filterStatus) &&
      (!filterGroup  || s.groupId === filterGroup)  &&
      (!q || s.name.toLowerCase().includes(q) || s.code?.toLowerCase().includes(q))
    );
  }, [students, search, filterStatus, filterGroup]);

  const selected      = students.find(s => s.id === selectedId);
  const selectedGroup = groups.find(g => g.id === selected?.groupId);

  const handlePrint = useCallback((student) => {
    const group = groups.find(g => g.id === student.groupId);
    printCard(student, group, theme);
  }, [groups, theme]);

  const SEL = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 10px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' };

  return (
    <div>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:14, padding:'0 28px', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:'1.35rem', fontWeight:800, letterSpacing:'-0.3px', marginBottom:3 }}>بطاقات الطلاب</h1>
          <p style={{ fontSize:'0.78rem', color:'var(--text3)' }}>{filtered.length} طالب · بطاقة + QR</p>
        </div>
        {view === 'cards' && (
          <div style={{ display:'flex', gap:8 }}>
            <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, overflow:'hidden' }}>
              {[{id:'dark',l:'🌙'},{id:'light',l:'☀'}].map(t=>(
                <button key={t.id} onClick={()=>setTheme(t.id)} style={{ padding:'7px 12px', fontSize:'0.82rem', cursor:'pointer', border:'none', background:theme===t.id?'var(--accent)':'transparent', color:theme===t.id?'var(--surface)':'var(--text3)', transition:'all .12s' }}>{t.l}</button>
              ))}
            </div>
            <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, overflow:'hidden' }}>
              {[{id:'gallery',l:'⊞'},{id:'list',l:'≡'}].map(v=>(
                <button key={v.id} onClick={()=>setCardView(v.id)} style={{ padding:'7px 14px', fontSize:'0.88rem', cursor:'pointer', border:'none', background:cardView===v.id?'var(--accent)':'transparent', color:cardView===v.id?'var(--surface)':'var(--text3)', transition:'all .12s' }}>{v.l}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ display:'flex', gap:2, padding:'0 28px', marginBottom:20 }}>
        {VIEWS.map(v=>(
          <button key={v.id} onClick={()=>setView(v.id)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 18px', borderRadius:10, fontSize:'0.88rem', fontWeight:view===v.id?700:500, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .15s', border:`1.5px solid ${view===v.id?'var(--accent)':'var(--border)'}`, background:view===v.id?'rgba(13,148,136,.1)':'transparent', color:view===v.id?'var(--accent)':'var(--text2)' }}
            onMouseOver={e=>{if(view!==v.id){e.currentTarget.style.background='var(--surface2)';e.currentTarget.style.color='var(--text)';}}}
            onMouseOut={e =>{if(view!==v.id){e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text2)';}}}
          >{v.icon} {v.label}</button>
        ))}
      </div>

      <div style={{ padding:'0 28px 40px' }}>
        <SectionBoundary label={`id-cards:${view}`}>

          {view === 'cards' && (
            <>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:18 }}>
                <div style={{ flex:1, minWidth:200, display:'flex', alignItems:'center', gap:8, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'0 12px' }}
                  onFocusCapture={e=>e.currentTarget.style.borderColor='var(--accent)'}
                  onBlurCapture={e =>e.currentTarget.style.borderColor='var(--border)'}
                >
                  <span style={{color:'var(--text3)'}}>🔍</span>
                  <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="بحث..."
                    style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.85rem', padding:'8px 0', direction:'rtl' }}/>
                  {search&&<button onClick={()=>setSearch('')} style={{color:'var(--text3)',cursor:'pointer'}}>×</button>}
                </div>
                <select style={SEL} value={filterGroup}  onChange={e=>setFilterGroup(e.target.value)}><option value="">كل المجموعات</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>
                <select style={SEL} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}><option value="">كل الحالات</option><option value="active">نشط</option><option value="inactive">موقوف</option></select>
              </div>
              {cardView === 'gallery' ? (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(330px,1fr))', gap:20 }}>
                  {filtered.map(s => {
                    const g = groups.find(x=>x.id===s.groupId);
                    const isSel = selectedId === s.id;
                    return (
                      <div key={s.id} style={{ display:'flex', flexDirection:'column', gap:8 }}>
                        <div onClick={()=>setSelectedId(isSel?null:s.id)} style={{ cursor:'pointer', outline:isSel?'3px solid var(--accent)':'3px solid transparent', borderRadius:18, transition:'all .12s' }}
                          onMouseOver={e=>e.currentTarget.style.transform='translateY(-2px)'}
                          onMouseOut={e =>e.currentTarget.style.transform=''}>
                          <CardFront student={s} group={g} theme={theme}/>
                        </div>
                        <div style={{ cursor:'pointer' }} onClick={()=>setSelectedId(isSel?null:s.id)}>
                          <CardBack student={s} group={g} theme={theme}/>
                        </div>
                        <div style={{ display:'flex', gap:6 }}>
                          <button onClick={()=>handlePrint(s)} style={{ flex:1, padding:'7px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface2)', color:'var(--text2)', fontSize:'0.76rem', fontWeight:600, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s' }}
                            onMouseOver={e=>{e.currentTarget.style.background='var(--accent)';e.currentTarget.style.color='var(--surface)';e.currentTarget.style.borderColor='var(--accent)';}}
                            onMouseOut={e =>{e.currentTarget.style.background='var(--surface2)';e.currentTarget.style.color='var(--text2)';e.currentTarget.style.borderColor='var(--border)';}}>
                            🖨 طباعة البطاقة
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
                    <thead><tr style={{ background:'var(--surface2)' }}>{['الطالب','الكود','المجموعة','QR',''].map(h=><th key={h} style={{ padding:'10px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {filtered.map(s=>{
                        const g=groups.find(x=>x.id===s.groupId), {bg,color}=avStyle(s.name), letters=s.name.split(' ').map(w=>w[0]).slice(0,2).join('');
                        return (
                          <tr key={s.id} onMouseOver={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--surface2)')} onMouseOut={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}>
                            <td style={{padding:'10px 14px',borderBottom:'1px solid var(--border)'}}><div style={{display:'flex',alignItems:'center',gap:9}}><div style={{width:32,height:32,borderRadius:'50%',background:bg,color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'0.72rem',fontWeight:700,flexShrink:0}}>{letters}</div><div><div style={{fontWeight:700}}>{s.name}</div><div style={{fontSize:'0.68rem',color:'var(--text3)'}}>{s.grade}</div></div></div></td>
                            <td style={{padding:'10px 14px',borderBottom:'1px solid var(--border)',fontFamily:'Cairo,sans-serif',fontSize:'0.78rem',color:'var(--accent)',fontWeight:700}}>{s.code}</td>
                            <td style={{padding:'10px 14px',borderBottom:'1px solid var(--border)',fontSize:'0.78rem',color:'var(--text2)'}}>{g?.name||'—'}</td>
                            <td style={{padding:'8px 14px',borderBottom:'1px solid var(--border)'}}><div style={{background:'#fff',padding:3,borderRadius:5,display:'inline-block'}}><MiniQR student={s} size={44}/></div></td>
                            <td style={{padding:'10px 14px',borderBottom:'1px solid var(--border)'}}><button onClick={()=>handlePrint(s)} style={{padding:'4px 9px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface2)',fontSize:'0.72rem',cursor:'pointer',color:'var(--text2)',fontFamily:'Cairo,sans-serif'}} onMouseOver={e=>{e.currentTarget.style.background='var(--accent)';e.currentTarget.style.color='var(--surface)';}} onMouseOut={e=>{e.currentTarget.style.background='var(--surface2)';e.currentTarget.style.color='var(--text2)';}}>🖨</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {view === 'scanner' && <QRScanner/>}


        </SectionBoundary>
      </div>

    </div>
  );
}
