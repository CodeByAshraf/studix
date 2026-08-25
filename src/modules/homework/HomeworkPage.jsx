// src/modules/homework/HomeworkPage.jsx
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { useAuth }     from '../../store/auth.context';
import { SectionBoundary } from '../../components/ErrorBoundary';
import { Modal, ConfirmModal } from '../../components/ui/Modal';
import Button        from '../../components/ui/Button';
import { useToast }  from '../../components/Toast';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { createHomework, updateHomework, HW_STATUS, SUB_STATUS, isOverdue, daysUntilDue } from '../../services/homeworkService';
import { pgCreateHomework, pgUpdateHomework, pgDeleteHomework } from '../../services/api';
import { formatDate } from '../../utils/helpers';
import HomeworkForm     from './HomeworkForm';
import HomeworkTracking from './HomeworkTracking';
import HomeworkReports  from './HomeworkReports';

const VIEWS = [
  { id:'list',     icon:'📋', label:'قائمة الواجبات' },
  { id:'tracking', icon:'📊', label:'متابعة الحالات'  },
  { id:'reports',  icon:'📈', label:'التقارير'         },
];

// ── Palette for avatars ──────────────────────────────────────
const AV_PAL = [
  {bg:'rgba(59,130,246,.18)',color:'#3b82f6'},{bg:'rgba(16,185,129,.18)',color:'#10b981'},
  {bg:'rgba(245,158,11,.18)',color:'#f59e0b'},{bg:'rgba(139,92,246,.18)',color:'#8b5cf6'},
  {bg:'rgba(239,68,68,.18)', color:'#ef4444'},
];

// ── KPI card ─────────────────────────────────────────────────
function KPI({ icon, label, value, color='var(--text)', sub, alert }) {
  return (
    <div style={{ background:'var(--surface)', border:`1px solid ${alert?'rgba(239,68,68,.3)':'var(--border)'}`, borderRadius:14, padding:'16px 18px' }}>
      <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>{icon} {label}</div>
      <div style={{ fontSize:'1.55rem', fontWeight:800, color, fontFamily:'Cairo,sans-serif', letterSpacing:'-0.4px', lineHeight:1 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize:'0.7rem', color:'var(--text3)', marginTop:5 }}>{sub}</div>}
    </div>
  );
}

// ── Homework card (grid view) ─────────────────────────────────
function HomeworkCard({ hw, group, stats, onEdit, onDelete, onTrack }) {
  const overdue = isOverdue(hw);
  const days    = daysUntilDue(hw);
  const statusInfo = HW_STATUS[hw.status] || HW_STATUS.active;
  const subPct  = stats.total > 0 ? Math.round((stats.submitted + stats.late) / stats.total * 100) : 0;

  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden', display:'flex', flexDirection:'column', transition:'transform .12s, box-shadow .12s' }}
      onMouseOver={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 6px 24px rgba(0,0,0,.2)'; }}
      onMouseOut={e  => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}
    >
      {/* Color bar */}
      <div style={{ height:4, background: overdue ? '#ef4444' : hw.status==='closed' ? '#10b981' : '#3b82f6' }}/>

      <div style={{ padding:'16px 18px', flex:1, display:'flex', flexDirection:'column', gap:10 }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:800, fontSize:'0.95rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:3 }}>{hw.title}</div>
            <div style={{ display:'flex', gap:6, fontSize:'0.72rem', flexWrap:'wrap' }}>
              <span style={{ background:'var(--surface2)', padding:'2px 7px', borderRadius:5 }}>📚 {hw.subject}</span>
              {hw.teacher && <span style={{ color:'var(--text3)' }}>👤 {hw.teacher}</span>}
              {group && <span style={{ color:'var(--text3)' }}>◈ {group.name}</span>}
            </div>
          </div>
          <span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'3px 9px', borderRadius:99, fontSize:'0.65rem', fontWeight:700, background:statusInfo.bg, color:statusInfo.color, border:`1px solid ${statusInfo.border}`, flexShrink:0 }}>
            {statusInfo.label}
          </span>
        </div>

        {/* Due date */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:'0.76rem' }}>
          <div style={{ color:'var(--text3)' }}>
            📅 موعد التسليم: <span style={{ fontWeight:700, color: overdue ? '#ef4444' : days <= 2 ? '#f59e0b' : 'var(--text)' }}>
              {formatDate(hw.dueDate, {month:'short',day:'numeric'})}
            </span>
          </div>
          {hw.status === 'active' && (
            <div style={{ fontSize:'0.68rem', fontWeight:700, padding:'2px 8px', borderRadius:99,
              background: overdue ? 'rgba(239,68,68,.1)' : days <= 2 ? 'rgba(245,158,11,.1)' : 'rgba(59,130,246,.1)',
              color: overdue ? '#ef4444' : days <= 2 ? '#f59e0b' : '#3b82f6',
            }}>
              {overdue ? 'انتهى الموعد' : days === 0 ? 'اليوم' : `${days} يوم`}
            </div>
          )}
        </div>

        {/* Stats + progress */}
        {stats.total > 0 && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.68rem', marginBottom:4 }}>
              <span style={{ color:'var(--text3)' }}>نسبة التسليم</span>
              <div style={{ display:'flex', gap:8 }}>
                <span style={{ color:'#10b981' }}>✓ {stats.submitted}</span>
                <span style={{ color:'#f59e0b' }}>⏱ {stats.late}</span>
                <span style={{ color:'#ef4444' }}>✗ {stats.missing}</span>
              </div>
            </div>
            <div style={{ height:5, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
              <div style={{ height:'100%', display:'flex' }}>
                <div style={{ width:`${Math.round(stats.submitted/stats.total*100)}%`, background:'#10b981' }}/>
                <div style={{ width:`${Math.round(stats.late/stats.total*100)}%`,      background:'#f59e0b' }}/>
              </div>
            </div>
          </div>
        )}

        {hw.totalScore && (
          <div style={{ fontSize:'0.72rem', color:'var(--text3)' }}>
            🎯 الدرجة الكلية: <span style={{ fontWeight:700, color:'var(--text)', fontFamily:'Cairo,sans-serif' }}>{hw.totalScore}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display:'flex', borderTop:'1px solid var(--border)' }}>
        {[
          { icon:'📊', label:'متابعة', action:onTrack    },
          { icon:'✎',  label:'تعديل',  action:onEdit     },
          { icon:'🗑',  label:'حذف',   action:onDelete, danger:true },
        ].map((btn, i) => (
          <button key={i} onClick={btn.action}
            style={{ flex:1, padding:'9px 4px', fontSize:'0.7rem', fontWeight:600, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s', background:'transparent', borderRight:i<2?'1px solid var(--border)':'none', display:'flex', flexDirection:'column', alignItems:'center', gap:2, color:btn.danger?'var(--red)':'var(--text2)', border:'none', borderRight:i<2?'1px solid var(--border)':'none' }}
            onMouseOver={e => { e.currentTarget.style.background=btn.danger?'rgba(239,68,68,.08)':'var(--surface2)'; e.currentTarget.style.color=btn.danger?'#ef4444':'var(--text)'; }}
            onMouseOut={e  => { e.currentTarget.style.background='transparent'; e.currentTarget.style.color=btn.danger?'var(--red)':'var(--text2)'; }}
          >
            <span style={{ fontSize:'0.88rem' }}>{btn.icon}</span>
            <span>{btn.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
export default function HomeworkPage() {
  const addLog               = useAppStore((s) => s.addLog);
  const groups               = useAppStore((s) => s.groups);
  const homeworks            = useAppStore((s) => s.homeworks);
  const hwSubmissions        = useAppStore((s) => s.hwSubmissions);
  const setHomeworks         = useAppStore((s) => s.setHomeworks);
  const setHwSubmissions     = useAppStore((s) => s.setHwSubmissions);
  const students             = useAppStore((s) => s.students);
  const { currentUser } = useAuth();
  const toast = useToast();
  const { loading, run } = useErrorHandler(toast);

  const [view,        setView]        = useState('list');
  const [modal,       setModal]       = useState({ type:null, hw:null });
  const [trackHw,     setTrackHw]     = useState(null);
  const [filterStatus,setFilterStatus]= useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [filterSubj,  setFilterSubj]  = useState('');
  const [search,      setSearch]      = useState('');

  const openAdd    = useCallback(() => setModal({ type:'add',    hw:null }), []);
  const openEdit   = useCallback(hw => setModal({ type:'edit',  hw }),      []);
  const openDelete = useCallback(hw => setModal({ type:'delete',hw }),      []);
  const closeModal = useCallback(() => setModal({ type:null, hw:null }),    []);

  const openTrack  = useCallback((hw) => { setTrackHw(hw); setView('tracking'); }, []);
  const closeTrack = useCallback(() => { setTrackHw(null); setView('list'); },     []);

  // ── KPIs ──────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const now = new Date().toISOString().split('T')[0];
    const active  = homeworks.filter(h => h.status==='active').length;
    const overdue = homeworks.filter(h => isOverdue(h)).length;
    const dueToday= homeworks.filter(h => h.dueDate===now && h.status==='active').length;
    const totalSub= hwSubmissions.filter(s => s.status==='submitted').length;
    return { total:homeworks.length, active, overdue, dueToday, totalSub };
  }, [homeworks, hwSubmissions]);

  // ── Filtered list ─────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return homeworks.filter(h =>
      (!filterStatus || h.status === filterStatus) &&
      (!filterGroup  || h.groupId === filterGroup)  &&
      (!filterSubj   || h.subject === filterSubj)   &&
      (!q || h.title.toLowerCase().includes(q) || h.subject.toLowerCase().includes(q) || h.teacher?.toLowerCase().includes(q))
    ).sort((a,b) => b.dueDate.localeCompare(a.dueDate));
  }, [homeworks, filterStatus, filterGroup, filterSubj, search]);

  const subjects = useMemo(() => [...new Set(homeworks.map(h=>h.subject))], [homeworks]);

  // ── Stats per homework ────────────────────────────────────
  const getHwStats = useCallback((hw) => {
    const grpStudents = students.filter(s => s.groupId===hw.groupId && s.status==='active');
    const subs = hwSubmissions.filter(s => s.hwId===hw.id);
    return {
      total:     grpStudents.length,
      submitted: subs.filter(s=>s.status==='submitted').length,
      late:      subs.filter(s=>s.status==='late').length,
      missing:   subs.filter(s=>s.status==='missing').length,
    };
  }, [students, hwSubmissions]);

  // ── CRUD ──────────────────────────────────────────────────
  // Phase 3B-6: PostgreSQL هو مصدر الحقيقة الآن — الحفظ/الحذف يذهب للـ backend أولاً،
  // ولا يُطبَّق أي تغيير على الحالة المحلية إلا بعد نجاح الخادم (نفس نمط Exams).
  const handleSave = useCallback(async (formData) => {
    await run(async () => {
      if (modal.type==='edit' && modal.hw) {
        const updated = updateHomework(modal.hw.id, formData);
        const saved   = await pgUpdateHomework(modal.hw.id, updated);
        setHomeworks(prev => prev.map(h => h.id===modal.hw.id ? saved : h));
        addLog({ action:'update', module:'homework', entityType:'homework', entityId:saved.id, description:`تعديل: ${saved.title}` })
          .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
        toast.success(`تم تعديل "${saved.title}" ✓`);
      } else {
        const nh    = createHomework(formData);
        const saved = await pgCreateHomework(nh);
        setHomeworks(prev => [saved, ...prev]);
        addLog({ action:'create', module:'homework', entityType:'homework', entityId:saved.id, description:`إنشاء: ${saved.title}` })
          .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
        toast.success(`تم إنشاء "${saved.title}" ✓`);
      }
      closeModal();
    }, { errorMsg: (err) => err.message || 'فشل حفظ الواجب' });
  }, [modal, setHomeworks, run, toast, addLog, currentUser, closeModal]);

  // pgDeleteHomework ينفّذ معاملة ذرّية على الخادم: يحذف كل سجلات تسليم الواجب ثم
  // الواجب نفسه معاً (backend/src/routes/homeworkDelete.js) — نفس الوعد الحالي
  // للمستخدم ("سيتم حذف جميع سجلات التسليم المرتبطة")، لكن فعلياً الآن.
  const handleDelete = useCallback(async () => {
    const hw = modal.hw;
    await run(async () => {
      await pgDeleteHomework(hw.id);
      setHomeworks(prev => prev.filter(h => h.id!==hw.id));
      setHwSubmissions(prev => prev.filter(s => s.hwId!==hw.id));
      addLog({ action:'delete', module:'homework', entityType:'homework', entityId:hw.id, description:`حذف: ${hw.title}` })
        .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
      toast.info(`تم حذف "${hw.title}"`);
      closeModal();
    }, { errorMsg: (err) => err.message || 'فشل حذف الواجب' });
  }, [modal.hw, setHomeworks, setHwSubmissions, run, toast, addLog, currentUser, closeModal]);

  const hasFilters = !!(filterStatus||filterGroup||filterSubj||search);
  const SEL = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 11px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' };

  return (
    <div>
      {/* ── Page header ─────────────────────── */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:14, padding:'0 28px', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:'1.35rem', fontWeight:800, letterSpacing:'-0.3px', marginBottom:3 }}>إدارة الواجبات</h1>
          <p style={{ fontSize:'0.78rem', color:'var(--text3)' }}>{filtered.length} واجب</p>
        </div>
        <Button variant="primary" size="sm" onClick={openAdd}>+ واجب جديد</Button>
      </div>

      {/* ── KPIs ────────────────────────────── */}
      <SectionBoundary label="Homework KPIs">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, padding:'0 28px', marginBottom:24 }}>
          <KPI icon="📋" label="إجمالي الواجبات" value={kpi.total}/>
          <KPI icon="▶"  label="نشط"              value={kpi.active}   color="#3b82f6"/>
          <KPI icon="⏱"  label="اليوم موعد تسليم" value={kpi.dueToday} color="#f59e0b"/>
          <KPI icon="⚠"  label="انتهى الموعد"     value={kpi.overdue}  color={kpi.overdue>0?'#ef4444':'#10b981'} alert={kpi.overdue>0}/>
          <KPI icon="✓"  label="إجمالي تم التسليم" value={kpi.totalSub} color="#10b981"/>
        </div>
      </SectionBoundary>

      {/* ── View tabs ───────────────────────── */}
      <div style={{ display:'flex', gap:2, padding:'0 28px', marginBottom:20 }}>
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => { setView(v.id); if(v.id!=='tracking') setTrackHw(null); }}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 18px', borderRadius:10, fontSize:'0.88rem', fontWeight:view===v.id?700:500, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .15s', border:`1.5px solid ${view===v.id?'var(--accent)':'var(--border)'}`, background:view===v.id?'rgba(13,148,136,.1)':'transparent', color:view===v.id?'var(--accent)':'var(--text2)' }}
            onMouseOver={e => { if(view!==v.id){e.currentTarget.style.background='var(--surface2)';e.currentTarget.style.color='var(--text)';} }}
            onMouseOut={e  => { if(view!==v.id){e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text2)';} }}
          >
            <span>{v.icon}</span>{v.label}
          </button>
        ))}
      </div>

      {/* ── Content ──────────────────────────── */}
      <div style={{ padding:'0 28px 40px', animation:'pageIn .2s ease' }}>

        <SectionBoundary label={`homework:${view}`}>

          {/* ── LIST VIEW ──────────────────── */}
          {view === 'list' && (
            <>
              {/* Filters */}
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:18 }}>
                <div style={{ flex:1, minWidth:200, display:'flex', alignItems:'center', gap:8, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'0 12px' }}
                  onFocusCapture={e => e.currentTarget.style.borderColor='var(--accent)'}
                  onBlurCapture={e  => e.currentTarget.style.borderColor='var(--border)'}
                >
                  <span style={{ color:'var(--text3)' }}>🔍</span>
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالعنوان أو المادة أو المدرس..."
                    style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', padding:'8px 0', direction:'rtl' }}/>
                  {search && <button onClick={() => setSearch('')} style={{ color:'var(--text3)', cursor:'pointer' }}>×</button>}
                </div>
                <select style={SEL} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  <option value="">كل الحالات</option>
                  {Object.entries(HW_STATUS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <select style={SEL} value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
                  <option value="">كل المجموعات</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <select style={SEL} value={filterSubj} onChange={e => setFilterSubj(e.target.value)}>
                  <option value="">كل المواد</option>
                  {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {hasFilters && <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setFilterStatus(''); setFilterGroup(''); setFilterSubj(''); }}>× مسح</Button>}
              </div>

              {/* Grid */}
              {filtered.length === 0 ? (
                <div style={{ textAlign:'center', padding:'60px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, color:'var(--text3)' }}>
                  <div style={{ fontSize:44, opacity:.4, marginBottom:10 }}>📋</div>
                  <div style={{ fontWeight:600 }}>{hasFilters ? 'لا توجد نتائج' : 'لا توجد واجبات بعد'}</div>
                  {!hasFilters && <Button variant="primary" size="sm" onClick={openAdd} style={{ marginTop:12 }}>+ إنشاء أول واجب</Button>}
                </div>
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:16 }}>
                  {filtered.map(hw => (
                    <SectionBoundary key={hw.id} label={`hw:${hw.id}`}>
                      <HomeworkCard
                        hw={hw}
                        group={groups.find(g => g.id===hw.groupId)}
                        stats={getHwStats(hw)}
                        onEdit  ={() => openEdit(hw)}
                        onDelete={() => openDelete(hw)}
                        onTrack ={() => openTrack(hw)}
                      />
                    </SectionBoundary>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── TRACKING VIEW ──────────────── */}
          {view === 'tracking' && (
            <div>
              {!trackHw ? (
                <div>
                  <div style={{ fontSize:'0.88rem', color:'var(--text3)', marginBottom:16 }}>
                    اختر واجباً من القائمة لمتابعة حالات التسليم:
                  </div>
                  <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
                    {homeworks.length === 0 ? (
                      <div style={{ textAlign:'center', padding:'40px', color:'var(--text3)' }}>لا توجد واجبات</div>
                    ) : (
                      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
                        <thead>
                          <tr style={{ background:'var(--surface2)' }}>
                            {['الواجب','المادة','المجموعة','موعد التسليم','الإحصائيات',''].map(h => (
                              <th key={h} style={{ padding:'9px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {homeworks.map(hw => {
                            const grp   = groups.find(g => g.id===hw.groupId);
                            const stats = getHwStats(hw);
                            const overdue = isOverdue(hw);
                            return (
                              <tr key={hw.id} style={{ cursor:'pointer', transition:'background .12s' }}
                                onMouseOver={e => Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--surface2)')}
                                onMouseOut={e  => Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}
                                onClick={() => setTrackHw(hw)}
                              >
                                <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontWeight:600 }}>{hw.title}</td>
                                <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>{hw.subject}</td>
                                <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>{grp?.name||'—'}</td>
                                <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:overdue?'#ef4444':'var(--text3)' }}>{formatDate(hw.dueDate)}</td>
                                <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                                  <div style={{ display:'flex', gap:8, fontSize:'0.72rem' }}>
                                    <span style={{ color:'#10b981', fontWeight:700 }}>✓{stats.submitted}</span>
                                    <span style={{ color:'#f59e0b', fontWeight:700 }}>⏱{stats.late}</span>
                                    <span style={{ color:'#ef4444', fontWeight:700 }}>✗{stats.missing}</span>
                                    <span style={{ color:'var(--text3)' }}>/{stats.total}</span>
                                  </div>
                                </td>
                                <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                                  <Button variant="primary" size="sm">📊 متابعة</Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ marginBottom:16 }}>
                    <button onClick={closeTrack}
                      style={{ display:'flex', alignItems:'center', gap:6, color:'var(--text2)', fontSize:'0.82rem', fontWeight:600, padding:'6px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)', transition:'all .15s', cursor:'pointer' }}
                      onMouseOver={e => { e.currentTarget.style.background='var(--surface2)'; e.currentTarget.style.color='var(--text)'; }}
                      onMouseOut={e  => { e.currentTarget.style.background='var(--surface)';  e.currentTarget.style.color='var(--text2)'; }}
                    >
                      ← الرجوع للقائمة
                    </button>
                  </div>
                  <SectionBoundary label="HomeworkTracking">
                    <HomeworkTracking hw={trackHw} onClose={closeTrack}/>
                  </SectionBoundary>
                </div>
              )}
            </div>
          )}

          {/* ── REPORTS VIEW ───────────────── */}
          {view === 'reports' && (
            <HomeworkReports onViewHomework={(hw) => { setTrackHw(hw); setView('tracking'); }}/>
          )}

        </SectionBoundary>
      </div>

      {/* ── Modals ──────────────────────────── */}
      <Modal isOpen={modal.type==='add'||modal.type==='edit'} onClose={closeModal}
        title={modal.type==='edit'?`تعديل — ${modal.hw?.title}`:'إنشاء واجب جديد'} size="md">
        <HomeworkForm initialValues={modal.hw} editId={modal.hw?.id}
          onSubmit={handleSave} onCancel={closeModal} loading={loading}/>
      </Modal>

      <ConfirmModal isOpen={modal.type==='delete'} onClose={closeModal} onConfirm={handleDelete}
        loading={loading} title="تأكيد الحذف"
        message={`هل أنت متأكد من حذف "${modal.hw?.title}"؟\nسيتم حذف جميع سجلات التسليم المرتبطة.`}
        confirmLabel="نعم، احذف"/>
    </div>
  );
}
