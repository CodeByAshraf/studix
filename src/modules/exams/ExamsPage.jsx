// src/modules/exams/ExamsPage.jsx
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { useAuth }     from '../../store/auth.context';
import { SectionBoundary } from '../../components/ErrorBoundary';
import { Modal, ConfirmModal } from '../../components/ui/Modal';
import Button        from '../../components/ui/Button';
import { useToast }  from '../../components/Toast';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { createExam, updateExam, getExamStatsWithPass, EXAM_TYPES, EXAM_STATUS } from '../../services/examService';
import { pgCreateExam, pgUpdateExam, pgDeleteExam } from '../../services/api';
import { formatDate } from '../../utils/helpers';
import ExamForm      from './ExamForm';
import GradeEntry    from './GradeEntry';
import ExamResults   from './ExamResults';
import ExamReports   from './ExamReports';

const VIEWS = [
  { id:'list',    icon:'📋', label:'الامتحانات'   },
  { id:'reports', icon:'📊', label:'التقارير'      },
];

function ExamCard({ exam, group, stats, onEdit, onDelete, onGrades, onResults }) {
  const typeInfo   = EXAM_TYPES[exam.type]  || EXAM_TYPES.monthly;
  const statusInfo = EXAM_STATUS[exam.status] || EXAM_STATUS.upcoming;
  const passRate   = stats.count > 0 ? Math.round(stats.passed / stats.count * 100) : null;
  const passColor  = passRate === null ? 'var(--text3)' : passRate >= 80 ? '#10b981' : passRate >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden', display:'flex', flexDirection:'column', transition:'transform .12s, box-shadow .12s' }}
      onMouseOver={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 6px 24px rgba(0,0,0,.2)'; }}
      onMouseOut={e  => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}
    >
      {/* Status stripe */}
      <div style={{ height:4, background:statusInfo.color }}/>

      <div style={{ padding:'16px 18px', flex:1, display:'flex', flexDirection:'column', gap:10 }}>
        {/* Header row */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:800, fontSize:'0.95rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:4 }}>{exam.name}</div>
            <div style={{ display:'flex', gap:8, fontSize:'0.72rem', flexWrap:'wrap' }}>
              <span style={{ background:'var(--surface2)', padding:'2px 8px', borderRadius:5 }}>{typeInfo.icon} {typeInfo.label}</span>
              <span style={{ color:'var(--text3)' }}>📅 {formatDate(exam.date, { month:'short', day:'numeric' })}</span>
              {group && <span style={{ color:'var(--text3)' }}>◈ {group.name}</span>}
              {exam.teacher && <span style={{ color:'var(--text3)' }}>👤 {exam.teacher}</span>}
            </div>
          </div>
          <span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'3px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:700, background:statusInfo.bg, color:statusInfo.color, border:`1px solid ${statusInfo.border}`, flexShrink:0 }}>
            {statusInfo.label}
          </span>
        </div>

        {/* Score info */}
        <div style={{ display:'flex', gap:8, fontSize:'0.75rem', color:'var(--text2)' }}>
          <span>الدرجة: <strong style={{ fontFamily:'Cairo,sans-serif' }}>{exam.total}</strong></span>
          <span>النجاح: <strong style={{ fontFamily:'Cairo,sans-serif', color:'var(--green)' }}>{exam.pass}</strong></span>
        </div>

        {/* Stats row */}
        {stats.count > 0 ? (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {[
              { l:'متوسط', v: stats.avg !== null ? `${stats.avg}` : '—',  c:'var(--accent)' },
              { l:'ناجح',  v: stats.passed, c:'#10b981' },
              { l:'راسب',  v: stats.failed, c:'#ef4444' },
              { l:'غائب',  v: stats.absent, c:'var(--text3)' },
            ].map(s => (
              <div key={s.l} style={{ background:'var(--surface2)', borderRadius:8, padding:'5px 10px', textAlign:'center' }}>
                <div style={{ fontSize:'0.9rem', fontWeight:800, color:s.c, fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{s.v}</div>
                <div style={{ fontSize:'0.58rem', color:'var(--text3)', marginTop:2 }}>{s.l}</div>
              </div>
            ))}
            {passRate !== null && (
              <div style={{ background:`${passColor}18`, border:`1px solid ${passColor}30`, borderRadius:8, padding:'5px 10px', textAlign:'center' }}>
                <div style={{ fontSize:'0.9rem', fontWeight:800, color:passColor, fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{passRate}%</div>
                <div style={{ fontSize:'0.58rem', color:passColor, marginTop:2 }}>نسبة نجاح</div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize:'0.74rem', color:'var(--text3)', fontStyle:'italic' }}>لم تُدخَل الدرجات بعد</div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display:'flex', borderTop:'1px solid var(--border)' }}>
        {[
          { icon:'📊', label:'النتائج',  action:onResults },
          { icon:'✎',  label:'الدرجات', action:onGrades  },
          { icon:'⚙',  label:'تعديل',   action:onEdit    },
          { icon:'🗑',  label:'حذف',    action:onDelete, danger:true },
        ].map((btn, i) => (
          <button key={i} onClick={btn.action}
            style={{ flex:1, padding:'9px 4px', fontSize:'0.7rem', fontWeight:600, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s', background:'transparent', borderRight: i<3 ? '1px solid var(--border)' : 'none', display:'flex', flexDirection:'column', alignItems:'center', gap:2, color: btn.danger ? 'var(--red)' : 'var(--text2)', border:'none', borderRight: i<3 ? '1px solid var(--border)' : 'none' }}
            onMouseOver={e => { e.currentTarget.style.background = btn.danger ? 'rgba(239,68,68,.08)' : 'var(--surface2)'; e.currentTarget.style.color = btn.danger ? '#ef4444' : 'var(--text)'; }}
            onMouseOut={e  => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = btn.danger ? 'var(--red)' : 'var(--text2)'; }}
          >
            <span style={{ fontSize:'0.85rem' }}>{btn.icon}</span>
            <span>{btn.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function KPI({ icon, label, value, color = 'var(--text)', sub }) {
  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'16px 18px' }}>
      <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>{icon} {label}</div>
      <div style={{ fontSize:'1.5rem', fontWeight:800, color, fontFamily:'Cairo,sans-serif', letterSpacing:'-0.4px', lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:'0.7rem', color:'var(--text3)', marginTop:5 }}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
export default function ExamsPage() {
  const addLog               = useAppStore((s) => s.addLog);
  const exams                = useAppStore((s) => s.exams);
  const grades               = useAppStore((s) => s.grades);
  const groups               = useAppStore((s) => s.groups);
  const setExams             = useAppStore((s) => s.setExams);
  const setGrades            = useAppStore((s) => s.setGrades);
  const students             = useAppStore((s) => s.students);
  const { currentUser } = useAuth();
  const toast = useToast();
  const { loading, run } = useErrorHandler(toast);

  const [view,   setView]   = useState('list');
  const [modal,  setModal]  = useState({ type:null, exam:null });
  const [filter, setFilter] = useState({ status:'', groupId:'', search:'' });

  const openAdd    = useCallback(() => setModal({ type:'add',     exam:null }), []);
  const openEdit   = useCallback(e  => setModal({ type:'edit',    exam:e    }), []);
  const openDelete = useCallback(e  => setModal({ type:'delete',  exam:e    }), []);
  const openGrades = useCallback(e  => setModal({ type:'grades',  exam:e    }), []);
  const openResults= useCallback(e  => setModal({ type:'results', exam:e    }), []);
  const closeModal = useCallback(() => setModal({ type:null, exam:null }),       []);

  // KPIs
  const kpi = useMemo(() => {
    const done     = exams.filter(e => e.status === 'done').length;
    const grading  = exams.filter(e => e.status === 'grading').length;
    const upcoming = exams.filter(e => e.status === 'upcoming').length;
    const allGrades = grades.filter(g => !g.absent && g.score !== null);
    const avgPct = allGrades.length ? Math.round(allGrades.reduce((sum, g) => {
      const exam = exams.find(e => e.id === g.examId);
      return sum + (exam ? (g.score/exam.total)*100 : 0);
    }, 0) / allGrades.length) : null;
    return { total:exams.length, done, grading, upcoming, avgPct };
  }, [exams, grades]);

  // Filtered exams
  const filtered = useMemo(() => {
    const q = filter.search.toLowerCase();
    return exams.filter(e =>
      (!filter.status  || e.status  === filter.status)  &&
      (!filter.groupId || e.groupId === filter.groupId) &&
      (!q || e.name.toLowerCase().includes(q) || e.subject.toLowerCase().includes(q))
    ).sort((a,b) => b.date.localeCompare(a.date));
  }, [exams, filter]);

  // CRUD
  // Phase 3B-5: PostgreSQL هو مصدر الحقيقة الآن — الحفظ/الحذف يذهب للـ backend أولاً،
  // ولا يُطبَّق أي تغيير على الحالة المحلية إلا بعد نجاح الخادم (نفس نمط Students/Groups).
  const handleSave = useCallback(async (formData) => {
    await run(async () => {
      if (modal.type === 'edit' && modal.exam) {
        const updated = updateExam(modal.exam.id, formData);
        const saved   = await pgUpdateExam(modal.exam.id, updated);
        setExams(prev => prev.map(e => e.id === modal.exam.id ? saved : e));
        addLog({ action:'update', module:'exams', entityType:'exam', entityId:saved.id, description:`تعديل: ${saved.name}` })
          .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
        toast.success(`تم تعديل "${saved.name}" ✓`);
      } else {
        const ne    = createExam(formData);
        const saved = await pgCreateExam(ne);
        setExams(prev => [saved, ...prev]);
        addLog({ action:'create', module:'exams', entityType:'exam', entityId:saved.id, description:`إنشاء: ${saved.name}` })
          .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
        toast.success(`تم إنشاء "${saved.name}" ✓`);
      }
      closeModal();
    }, { errorMsg: (err) => err.message || 'فشل حفظ بيانات الامتحان' });
  }, [modal, setExams, run, toast, addLog, currentUser, closeModal]);

  // pgDeleteExam ينفّذ معاملة ذرّية على الخادم: يحذف كل درجات الامتحان ثم الامتحان
  // نفسه معاً (backend/src/routes/examDelete.js) — نفس الوعد الحالي للمستخدم
  // ("سيتم حذف جميع الدرجات المرتبطة")، لكن فعلياً الآن، لا مجرد حذف محلي متفائل.
  const handleDelete = useCallback(async () => {
    const e = modal.exam;
    await run(async () => {
      await pgDeleteExam(e.id);
      setExams(prev => prev.filter(x => x.id !== e.id));
      setGrades(prev => prev.filter(g => g.examId !== e.id));
      addLog({ action:'delete', module:'exams', entityType:'exam', entityId:e.id, description:`حذف: ${e.name}` })
        .catch((err) => toast.error(err.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
      toast.info(`تم حذف "${e.name}"`);
      closeModal();
    }, { errorMsg: (err) => err.message || 'فشل حذف الامتحان' });
  }, [modal.exam, setExams, setGrades, run, toast, addLog, currentUser, closeModal]);

  const SEL = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 11px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' };

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:14, padding:'0 28px', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:'1.35rem', fontWeight:800, letterSpacing:'-0.3px', marginBottom:3 }}>إدارة الامتحانات</h1>
          <p style={{ fontSize:'0.78rem', color:'var(--text3)' }}>{filtered.length} امتحان</p>
        </div>
        <Button variant="primary" size="sm" onClick={openAdd}>+ إنشاء امتحان</Button>
      </div>

      {/* KPIs */}
      <SectionBoundary label="Exam KPIs">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, padding:'0 28px', marginBottom:24 }}>
          <KPI icon="📝" label="إجمالي الامتحانات" value={kpi.total}/>
          <KPI icon="✓"  label="منتهية"             value={kpi.done}     color="#10b981"/>
          <KPI icon="⏱"  label="قيد التصحيح"       value={kpi.grading}  color="#f59e0b"/>
          <KPI icon="📅" label="قادمة"              value={kpi.upcoming} color="#3b82f6"/>
          <KPI icon="📊" label="متوسط الدرجات"      value={kpi.avgPct !== null ? `${kpi.avgPct}%` : '—'} color={kpi.avgPct >= 70 ? '#10b981' : kpi.avgPct >= 50 ? '#f59e0b' : '#ef4444'}/>
        </div>
      </SectionBoundary>

      {/* View toggle */}
      <div style={{ display:'flex', gap:2, padding:'0 28px', marginBottom:22 }}>
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 18px', borderRadius:10, fontSize:'0.88rem', fontWeight:view===v.id?700:500, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .15s', border:`1.5px solid ${view===v.id?'var(--accent)':'var(--border)'}`, background:view===v.id?'rgba(13,148,136,.1)':'transparent', color:view===v.id?'var(--accent)':'var(--text2)' }}
            onMouseOver={e => { if(view!==v.id){e.currentTarget.style.background='var(--surface2)';e.currentTarget.style.color='var(--text)';} }}
            onMouseOut={e  => { if(view!==v.id){e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text2)';} }}
          ><span>{v.icon}</span>{v.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding:'0 28px 40px', animation:'pageIn .2s ease' }}>

        <SectionBoundary label={`exams:${view}`}>
          {view === 'reports' ? (
            <ExamReports/>
          ) : (
            <>
              {/* Filters */}
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:18 }}>
                <div style={{ flex:1, minWidth:200, display:'flex', alignItems:'center', gap:8, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'0 12px' }}
                  onFocusCapture={e => e.currentTarget.style.borderColor='var(--accent)'}
                  onBlurCapture={e  => e.currentTarget.style.borderColor='var(--border)'}
                >
                  <span style={{ color:'var(--text3)' }}>🔍</span>
                  <input value={filter.search} onChange={e => setFilter(f=>({...f,search:e.target.value}))} placeholder="بحث..."
                    style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', padding:'8px 0', direction:'rtl' }}/>
                </div>
                <select style={SEL} value={filter.status} onChange={e => setFilter(f=>({...f,status:e.target.value}))}>
                  <option value="">كل الحالات</option>
                  {Object.entries(EXAM_STATUS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <select style={SEL} value={filter.groupId} onChange={e => setFilter(f=>({...f,groupId:e.target.value}))}>
                  <option value="">كل المجموعات</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                {(filter.status||filter.groupId||filter.search) && (
                  <button onClick={() => setFilter({status:'',groupId:'',search:''})} style={{ ...SEL, color:'var(--text3)' }}>× مسح</button>
                )}
              </div>

              {/* Grid */}
              {filtered.length === 0 ? (
                <div style={{ textAlign:'center', padding:'60px 20px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, color:'var(--text3)' }}>
                  <div style={{ fontSize:44, opacity:.4, marginBottom:10 }}>📝</div>
                  <div style={{ fontWeight:600 }}>لا توجد امتحانات</div>
                  <Button variant="primary" size="sm" style={{ marginTop:14 }} onClick={openAdd}>+ إنشاء امتحان</Button>
                </div>
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:16 }}>
                  {filtered.map(exam => {
                    const group = groups.find(g => g.id === exam.groupId);
                    const stats = getExamStatsWithPass(exam.id, grades, exam);
                    return (
                      <SectionBoundary key={exam.id} label={`ExamCard:${exam.id}`}>
                        <ExamCard exam={exam} group={group} stats={stats}
                          onEdit   ={() => openEdit(exam)}
                          onDelete ={() => openDelete(exam)}
                          onGrades ={() => openGrades(exam)}
                          onResults={() => openResults(exam)}
                        />
                      </SectionBoundary>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </SectionBoundary>
      </div>

      {/* Modals */}
      <Modal isOpen={modal.type==='add'||modal.type==='edit'} onClose={closeModal}
        title={modal.type==='edit'?`تعديل — ${modal.exam?.name}`:'إنشاء امتحان جديد'} size="md">
        <ExamForm initialValues={modal.exam} editId={modal.exam?.id} onSubmit={handleSave} onCancel={closeModal} loading={loading}/>
      </Modal>

      <ConfirmModal isOpen={modal.type==='delete'} onClose={closeModal} onConfirm={handleDelete}
        loading={loading} title="تأكيد الحذف"
        message={`هل أنت متأكد من حذف "${modal.exam?.name}"؟\nسيتم حذف جميع الدرجات المرتبطة.`}
        confirmLabel="نعم، احذف"/>

      <Modal isOpen={modal.type==='grades'} onClose={closeModal}
        title={`إدخال الدرجات — ${modal.exam?.name}`} size="lg">
        {modal.exam && <GradeEntry exam={modal.exam} onClose={closeModal}/>}
      </Modal>

      <Modal isOpen={modal.type==='results'} onClose={closeModal}
        title={`نتائج — ${modal.exam?.name}`} size="lg">
        {modal.exam && <ExamResults exam={modal.exam}/>}
      </Modal>
    </div>
  );
}
