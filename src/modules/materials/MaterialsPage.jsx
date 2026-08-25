// src/modules/materials/MaterialsPage.jsx
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { useAuth }     from '../../store/auth.context';
import { SectionBoundary } from '../../components/ErrorBoundary';
import { Modal, ConfirmModal } from '../../components/ui/Modal';
import Button        from '../../components/ui/Button';
import { useToast }  from '../../components/Toast';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { createMaterial, updateMaterial, getMatStats, getTotalRevenue, deriveMatDist, PAY_STATUS, GRADES, SUBJECTS } from '../../services/materialService';
import { pgCreateMaterial, pgUpdateMaterial, pgDeleteMaterial, pgGetCollection } from '../../services/api';
import { formatDate, formatCurrency } from '../../utils/helpers';
import MaterialForm         from './MaterialForm';
import MaterialDistribution from './MaterialDistribution';
import MaterialReports      from './MaterialReports';

// Phase 3B-11 — يبني رقم "MAT-XXXXXX" التالي، نفس نمط nextCommNumber
// (communicationService.js). محلي هنا فقط (لا يمسّ materialService.js).
function nextMatCode(records = []) {
  const re = /^MAT-(\d+)$/;
  let max = 0;
  for (const r of records) {
    const m = re.exec(r.code || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `MAT-${String(max + 1).padStart(6, '0')}`;
}

const VIEWS = [
  { id:'list',     icon:'📚', label:'قائمة المذكرات'  },
  { id:'tracking', icon:'👥', label:'تتبع الاستلام'    },
  { id:'reports',  icon:'📊', label:'التقارير'          },
];

function KPI({ icon, label, value, color='var(--text)', sub }) {
  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'16px 18px' }}>
      <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>{icon} {label}</div>
      <div style={{ fontSize:'1.55rem', fontWeight:800, color, fontFamily:'Cairo,sans-serif', letterSpacing:'-0.4px', lineHeight:1 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize:'0.7rem', color:'var(--text3)', marginTop:5 }}>{sub}</div>}
    </div>
  );
}

export default function MaterialsPage() {
  const addLog               = useAppStore((s) => s.addLog);
  const inventoryTxn          = useAppStore((s) => s.inventoryTxn);
  const materials              = useAppStore((s) => s.invMaterials);
  const setMaterials          = useAppStore((s) => s.setInvMaterials);
  const students              = useAppStore((s) => s.students);
  // matDist لم يعد حالة مستقلة — يُشتَق دائماً من inventoryTxn المُزامَن إقلاعياً
  // (PostgreSQL هو مصدر الحقيقة الوحيد؛ انظر PHASE_NEXT_MATDIST_IMPLEMENTATION_PLAN.md).
  const matDist = useMemo(() => deriveMatDist(inventoryTxn), [inventoryTxn]);
  const { currentUser } = useAuth();
  const toast = useToast();
  const { loading, run } = useErrorHandler(toast);

  const [view,        setView]        = useState('list');
  const [modal,       setModal]       = useState({ type:null, mat:null });
  const [distMat,     setDistMat]     = useState(null);
  const [search,      setSearch]      = useState('');
  const [filterSubj,  setFilterSubj]  = useState('');
  const [filterGrade, setFilterGrade] = useState('');

  const openAdd    = useCallback(() => setModal({ type:'add',    mat:null }), []);
  const openEdit   = useCallback(m  => setModal({ type:'edit',  mat:m }),    []);
  const openDelete = useCallback(m  => setModal({ type:'delete',mat:m }),    []);
  const closeModal = useCallback(() => setModal({ type:null, mat:null }),    []);
  const openDist   = useCallback(m  => { setDistMat(m); setView('tracking'); }, []);

  // KPIs
  const kpi = useMemo(() => {
    const total     = materials.length;
    const totalRev  = getTotalRevenue(matDist);
    const totalDist = matDist.filter(d => d.received).length;
    const unpaid    = matDist.filter(d => d.payStatus==='unpaid' && d.received).length;
    return { total, totalRev, totalDist, unpaid };
  }, [materials, matDist]);

  // Filtered
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return materials.filter(m =>
      (!filterSubj  || m.subject === filterSubj) &&
      (!filterGrade || m.grade   === filterGrade) &&
      (!q || m.name.toLowerCase().includes(q) || m.teacher?.toLowerCase().includes(q))
    ).sort((a,b) => b.addedAt.localeCompare(a.addedAt));
  }, [materials, filterSubj, filterGrade, search]);

  const subjects = useMemo(() => [...new Set(materials.map(m=>m.subject))], [materials]);
  const grades   = useMemo(() => [...new Set(materials.map(m=>m.grade))], [materials]);

  // CRUD
  // Phase 3B-11: PostgreSQL هو مصدر الحقيقة الآن — الحفظ/الحذف يذهب للـ backend أولاً،
  // ولا يُطبَّق أي تغيير على الحالة المحلية إلا بعد نجاح الخادم (نفس نمط Exams/Homeworks).
  // matDist/inventory_txn خارج نطاق هذه المرحلة تماماً — تبقى معالجتها المحلية كما هي.
  const handleSave = useCallback(async (formData) => {
    await run(async () => {
      if (modal.type==='edit' && modal.mat) {
        const updated = updateMaterial(modal.mat.id, formData);
        const saved   = await pgUpdateMaterial(modal.mat.id, updated);
        setMaterials(prev => prev.map(m => m.id===modal.mat.id ? saved : m));
        addLog({ action:'update', module:'materials', entityType:'material', entityId:String(saved.id), description:`تعديل: ${saved.name}` })
          .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
        toast.success(`تم تعديل "${saved.name}" ✓`);
      } else {
        const nm   = createMaterial(formData);
        const code = nextMatCode(materials);
        const saved = await pgCreateMaterial({ ...nm, code }, {
          // إعادة المحاولة الوحيدة المسموحة: فقط عند تعارض code الفريد (409) — تُحسب من
          // أحدث حقيقة من الخادم، لا من القائمة المحلية المحتمل أنها قديمة (نفس نمط
          // communications).
          computeNextCode: async () => {
            const fresh = await pgGetCollection('invMaterials');
            return nextMatCode(fresh);
          },
        });
        setMaterials(prev => [saved, ...prev]);
        addLog({ action:'create', module:'materials', entityType:'material', entityId:String(saved.id), description:`إضافة: ${saved.name}` })
          .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
        toast.success(`تمت إضافة "${saved.name}" ✓`);
      }
      closeModal();
    }, { errorMsg: (err) => err.message || 'فشل حفظ المذكرة' });
  }, [modal, materials, setMaterials, run, toast, addLog, currentUser, closeModal]);

  // Phase 3B-12: الخادم يرفض حذف مادة لها inventory_txn (409) تلقائياً — لا حاجة لأي
  // تنظيف محلي لـ matDist بعد الآن، لأنه لم يعد حالة مستقلة (مُشتَق من inventoryTxn
  // نفسه؛ حذف المادة الفعلي إمّا ينجح لمادة بلا أي حركات أصلاً، أو يُرفَض من الخادم).
  const handleDelete = useCallback(async () => {
    const m = modal.mat;
    await run(async () => {
      await pgDeleteMaterial(m.id);
      setMaterials(prev => prev.filter(x => x.id!==m.id));
      addLog({ action:'delete', module:'materials', entityType:'material', entityId:String(m.id), description:`حذف: ${m.name}` })
        .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
      toast.info(`تم حذف "${m.name}"`);
      closeModal();
    }, { errorMsg: (err) => err.message || 'فشل حذف المذكرة' });
  }, [modal.mat, setMaterials, run, toast, addLog, currentUser, closeModal]);

  const hasFilters = !!(filterSubj||filterGrade||search);
  const SEL = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 11px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' };

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:14, padding:'0 28px', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:'1.35rem', fontWeight:800, letterSpacing:'-0.3px', marginBottom:3 }}>إدارة المذكرات الدراسية</h1>
          <p style={{ fontSize:'0.78rem', color:'var(--text3)' }}>{filtered.length} مذكرة</p>
        </div>
        <Button variant="primary" size="sm" onClick={openAdd}>+ إضافة مذكرة</Button>
      </div>

      {/* KPIs */}
      <SectionBoundary label="Materials KPIs">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, padding:'0 28px', marginBottom:24 }}>
          <KPI icon="📚" label="إجمالي المذكرات"   value={kpi.total}/>
          <KPI icon="✓"  label="استلموا"             value={kpi.totalDist}           color="#10b981"/>
          <KPI icon="💰" label="إجمالي الإيرادات"   value={formatCurrency(kpi.totalRev)} color="var(--green)"/>
          <KPI icon="⚠"  label="لم يدفعوا (استلموا)" value={kpi.unpaid} color={kpi.unpaid>0?'#ef4444':'#10b981'}/>
        </div>
      </SectionBoundary>

      {/* View tabs */}
      <div style={{ display:'flex', gap:2, padding:'0 28px', marginBottom:20 }}>
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => { setView(v.id); if(v.id!=='tracking') setDistMat(null); }}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 18px', borderRadius:10, fontSize:'0.88rem', fontWeight:view===v.id?700:500, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .15s', border:`1.5px solid ${view===v.id?'var(--accent)':'var(--border)'}`, background:view===v.id?'rgba(13,148,136,.1)':'transparent', color:view===v.id?'var(--accent)':'var(--text2)' }}
            onMouseOver={e => { if(view!==v.id){e.currentTarget.style.background='var(--surface2)';e.currentTarget.style.color='var(--text)';} }}
            onMouseOut={e  => { if(view!==v.id){e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text2)';} }}
          >
            <span>{v.icon}</span>{v.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding:'0 28px 40px', animation:'pageIn .2s ease' }}>

        <SectionBoundary label={`materials:${view}`}>

          {/* ── LIST ─────────────────────── */}
          {view === 'list' && (
            <>
              {/* Filters */}
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:18 }}>
                <div style={{ flex:1, minWidth:200, display:'flex', alignItems:'center', gap:8, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'0 12px' }}
                  onFocusCapture={e => e.currentTarget.style.borderColor='var(--accent)'}
                  onBlurCapture={e  => e.currentTarget.style.borderColor='var(--border)'}
                >
                  <span style={{ color:'var(--text3)' }}>🔍</span>
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم أو المدرس..."
                    style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', padding:'8px 0', direction:'rtl' }}/>
                  {search && <button onClick={()=>setSearch('')} style={{ color:'var(--text3)', cursor:'pointer' }}>×</button>}
                </div>
                <select style={SEL} value={filterSubj}  onChange={e => setFilterSubj(e.target.value)}>
                  <option value="">كل المواد</option>
                  {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select style={SEL} value={filterGrade} onChange={e => setFilterGrade(e.target.value)}>
                  <option value="">كل السنوات</option>
                  {grades.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                {hasFilters && <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setFilterSubj(''); setFilterGrade(''); }}>× مسح</Button>}
              </div>

              {/* Table */}
              {filtered.length === 0 ? (
                <div style={{ textAlign:'center', padding:'60px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, color:'var(--text3)' }}>
                  <div style={{ fontSize:44, opacity:.4, marginBottom:10 }}>📚</div>
                  <div style={{ fontWeight:600 }}>{hasFilters?'لا توجد نتائج':'لا توجد مذكرات بعد'}</div>
                  {!hasFilters && <Button variant="primary" size="sm" onClick={openAdd} style={{ marginTop:12 }}>+ إضافة مذكرة</Button>}
                </div>
              ) : (
                <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
                      <thead>
                        <tr style={{ background:'var(--surface2)' }}>
                          {['اسم المذكرة','المادة','المدرس','السنة الدراسية','السعر','تاريخ الإضافة','الاستلام','الإيراد',''].map(h => (
                            <th key={h} style={{ padding:'10px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(mat => {
                          const stats = getMatStats(mat.id, matDist, students);
                          const distPct = stats.totalStudents > 0 ? Math.round(stats.received/stats.totalStudents*100) : 0;
                          return (
                            <tr key={mat.id} style={{ transition:'background .12s' }}
                              onMouseOver={e => Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--surface2)')}
                              onMouseOut={e  => Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}
                            >
                              <td style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)', fontWeight:700, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                <div>{mat.name}</div>
                                {mat.description && <div style={{ fontSize:'0.68rem', color:'var(--text3)', fontWeight:400, marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{mat.description}</div>}
                              </td>
                              <td style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>{mat.subject}</td>
                              <td style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>{mat.teacher||'—'}</td>
                              <td style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>{mat.grade}</td>
                              <td style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', fontWeight:700, color:'var(--green)' }}>{mat.price>0 ? `${mat.price} ج.م` : 'مجاني'}</td>
                              <td style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text3)' }}>{formatDate(mat.addedAt, {month:'short',day:'numeric',year:'numeric'})}</td>
                              <td style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)' }}>
                                <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                                  <div style={{ width:55, height:5, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
                                    <div style={{ height:'100%', width:`${distPct}%`, background: distPct>=80?'#10b981':distPct>=50?'#f59e0b':'#ef4444' }}/>
                                  </div>
                                  <span style={{ fontSize:'0.7rem', fontFamily:'Cairo,sans-serif', fontWeight:700, color: distPct>=80?'#10b981':distPct>=50?'#f59e0b':'#ef4444', minWidth:32 }}>{distPct}%</span>
                                </div>
                                <div style={{ fontSize:'0.65rem', color:'var(--text3)', marginTop:3 }}>{stats.received}/{stats.totalStudents}</div>
                              </td>
                              <td style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', fontWeight:700, color:'var(--green)', fontSize:'0.78rem' }}>
                                {formatCurrency(stats.totalCollected)}
                              </td>
                              <td style={{ padding:'12px 14px', borderBottom:'1px solid var(--border)' }}>
                                <div style={{ display:'flex', gap:4 }}>
                                  <button onClick={() => openDist(mat)} title="متابعة التوزيع"
                                    style={{ padding:'4px 9px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.72rem', cursor:'pointer', color:'var(--text2)', fontFamily:'Cairo,sans-serif', transition:'all .12s' }}
                                    onMouseOver={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--accent)';}}
                                    onMouseOut={e =>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text2)';}}>
                                    👥
                                  </button>
                                  <button onClick={() => openEdit(mat)} title="تعديل"
                                    style={{ padding:'4px 9px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.72rem', cursor:'pointer', color:'var(--text2)', fontFamily:'Cairo,sans-serif', transition:'all .12s' }}
                                    onMouseOver={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--accent)';}}
                                    onMouseOut={e =>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text2)';}}>
                                    ✎
                                  </button>
                                  <button onClick={() => openDelete(mat)} title="حذف"
                                    style={{ padding:'4px 9px', borderRadius:6, border:'1px solid rgba(239,68,68,.2)', background:'rgba(239,68,68,.08)', fontSize:'0.72rem', cursor:'pointer', color:'var(--red)', fontFamily:'Cairo,sans-serif', transition:'all .12s' }}
                                    onMouseOver={e=>{e.currentTarget.style.background='var(--red)';e.currentTarget.style.color='#fff';}}
                                    onMouseOut={e =>{e.currentTarget.style.background='rgba(239,68,68,.08)';e.currentTarget.style.color='var(--red)';}}>
                                    🗑
                                  </button>
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
            </>
          )}

          {/* ── TRACKING ─────────────────── */}
          {view === 'tracking' && (
            distMat ? (
              <div>
                <div style={{ marginBottom:16 }}>
                  <button onClick={() => { setDistMat(null); }}
                    style={{ display:'flex', alignItems:'center', gap:6, color:'var(--text2)', fontSize:'0.82rem', fontWeight:600, padding:'6px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)', transition:'all .15s', cursor:'pointer' }}
                    onMouseOver={e => { e.currentTarget.style.background='var(--surface2)'; e.currentTarget.style.color='var(--text)'; }}
                    onMouseOut={e  => { e.currentTarget.style.background='var(--surface)';  e.currentTarget.style.color='var(--text2)'; }}
                  >
                    ← الرجوع للقائمة
                  </button>
                </div>
                <SectionBoundary label="MaterialDistribution">
                  <MaterialDistribution material={distMat} onClose={() => setDistMat(null)}/>
                </SectionBoundary>
              </div>
            ) : (
              <div>
                <div style={{ fontSize:'0.88rem', color:'var(--text3)', marginBottom:16 }}>اختر مذكرة لمتابعة التوزيع:</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:14 }}>
                  {materials.map(mat => {
                    const stats   = getMatStats(mat.id, matDist, students);
                    const distPct = stats.totalStudents>0 ? Math.round(stats.received/stats.totalStudents*100) : 0;
                    const pctColor= distPct>=80?'#10b981':distPct>=50?'#f59e0b':'#ef4444';
                    return (
                      <div key={mat.id} onClick={() => setDistMat(mat)}
                        style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'16px 18px', cursor:'pointer', transition:'all .15s' }}
                        onMouseOver={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,.2)'; e.currentTarget.style.borderColor='var(--accent)'; }}
                        onMouseOut={e  => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; e.currentTarget.style.borderColor='var(--border)'; }}
                      >
                        <div style={{ fontWeight:700, marginBottom:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{mat.name}</div>
                        <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginBottom:10, display:'flex', gap:8 }}>
                          <span>{mat.subject}</span>
                          <span>{mat.grade}</span>
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ flex:1, height:6, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
                            <div style={{ height:'100%', width:`${distPct}%`, background:pctColor, transition:'width .5s' }}/>
                          </div>
                          <span style={{ fontSize:'0.72rem', fontWeight:800, color:pctColor, fontFamily:'Cairo,sans-serif', minWidth:36 }}>{distPct}%</span>
                        </div>
                        <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginTop:4 }}>
                          {stats.received}/{stats.totalStudents} استلموا · محصّل: {formatCurrency(stats.totalCollected)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          )}

          {/* ── REPORTS ──────────────────── */}
          {view === 'reports' && (
            <MaterialReports onDistribute={(m) => { setDistMat(m); setView('tracking'); }}/>
          )}

        </SectionBoundary>
      </div>

      {/* Modals */}
      <Modal isOpen={modal.type==='add'||modal.type==='edit'} onClose={closeModal}
        title={modal.type==='edit'?`تعديل — ${modal.mat?.name}`:'إضافة مذكرة جديدة'} size="md">
        <MaterialForm initialValues={modal.mat} editId={modal.mat?.id}
          onSubmit={handleSave} onCancel={closeModal} loading={loading}/>
      </Modal>

      <ConfirmModal isOpen={modal.type==='delete'} onClose={closeModal} onConfirm={handleDelete}
        loading={loading} title="تأكيد الحذف"
        message={`هل أنت متأكد من حذف "${modal.mat?.name}"؟\nسيتم حذف جميع سجلات التوزيع المرتبطة.`}
        confirmLabel="نعم، احذف"/>
    </div>
  );
}
