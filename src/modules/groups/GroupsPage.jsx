// src/modules/groups/GroupsPage.jsx
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { useAuth }     from '../../store/auth.context';
import { SectionBoundary }  from '../../components/ErrorBoundary';
import { Modal, ConfirmModal } from '../../components/ui/Modal';
import Button               from '../../components/ui/Button';
import { useToast }         from '../../components/Toast';
import { useErrorHandler }  from '../../hooks/useErrorHandler';
import { createGroup, updateGroup, getGroupStats, formatDays, GROUP_COLORS } from '../../services/groupService';
import { pgCreateGroup, pgUpdateGroup, pgDeleteGroup } from '../../services/api';
import { formatCurrency }   from '../../utils/helpers';
import GroupForm             from './GroupForm';
import GroupCard             from './components/GroupCard';
import GroupStudents, { TransferModal } from './GroupStudents';

// ── Overview stats bar ───────────────────────────────────────
function OverviewBar({ groups, students, payments, attendance }) {
  const totalStudents = students.filter(s => s.status === 'active').length;
  const totalRevenue  = payments.reduce((s, p) => s + p.amount, 0);
  const fullGroups    = groups.filter(g => {
    const count = students.filter(s => s.groupId === g.id && s.status === 'active').length;
    return count >= g.max;
  }).length;
  const avgFill = groups.length > 0
    ? Math.round(groups.reduce((sum, g) => {
        const count = students.filter(s => s.groupId === g.id && s.status === 'active').length;
        return sum + (g.max > 0 ? count / g.max * 100 : 0);
      }, 0) / groups.length)
    : 0;

  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, padding:'0 28px', marginBottom:24 }}>
      {[
        { icon:'◈',  label:'إجمالي المجموعات', value:groups.length,         color:'var(--accent)'  },
        { icon:'👥', label:'إجمالي الطلاب',    value:totalStudents,          color:'#3b82f6'        },
        { icon:'📊', label:'متوسط الإشغال',    value:`${avgFill}%`,          color: avgFill > 80 ? '#ef4444' : avgFill > 60 ? '#f59e0b' : '#10b981' },
        { icon:'💰', label:'الإيراد الكلي',    value:formatCurrency(totalRevenue), color:'#10b981'  },
      ].map(s => (
        <div key={s.label} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'16px 18px' }}>
          <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>{s.icon} {s.label}</div>
          <div style={{ fontSize:'1.5rem', fontWeight:800, color:s.color, fontFamily:'Cairo,sans-serif', letterSpacing:'-0.5px' }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
export default function GroupsPage() {
  const addLog               = useAppStore((s) => s.addLog);
  const admissions           = useAppStore((s) => s.admissions);
  const attendance           = useAppStore((s) => s.attendance);
  const communications       = useAppStore((s) => s.communications);
  const exams                = useAppStore((s) => s.exams);
  const groups               = useAppStore((s) => s.groups);
  const homeworks            = useAppStore((s) => s.homeworks);
  const payments             = useAppStore((s) => s.payments);
  const setGroups            = useAppStore((s) => s.setGroups);
  const students             = useAppStore((s) => s.students);
  const { currentUser } = useAuth();
  const toast = useToast();
  const { loading, run } = useErrorHandler(toast);

  // ── Modal state ───────────────────────────────────────────
  const [modal,         setModal]        = useState({ type: null, group: null });
  const [viewGroup,     setViewGroup]    = useState(null);   // group being viewed
  const [transferGroup, setTransferGroup]= useState(null);   // group for transfer modal
  const [viewMode,      setViewMode]     = useState('grid'); // 'grid' | 'list'
  const [filterGrade,   setFilterGrade]  = useState('');
  const [search,        setSearch]       = useState('');

  const openAdd    = useCallback(() => setModal({ type:'add',    group:null }), []);
  const openEdit   = useCallback((g) => setModal({ type:'edit',  group:g }),   []);
  const openDelete = useCallback((g) => setModal({ type:'delete',group:g }),   []);
  const closeModal = useCallback(() => setModal({ type:null, group:null }),     []);

  const openViewStudents = useCallback((group) => {
    setViewGroup(group);
    setModal({ type:'students', group });
  }, []);

  const openTransfer = useCallback((group) => {
    setTransferGroup(group);
  }, []);

  // ── Filtered groups ───────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return groups.filter(g =>
      (!filterGrade || g.grade === filterGrade) &&
      (!q || g.name.toLowerCase().includes(q) || g.subject?.toLowerCase().includes(q) || g.teacher?.toLowerCase().includes(q))
    );
  }, [groups, filterGrade, search]);

  const gradesList = useMemo(() => [...new Set(groups.map(g => g.grade))], [groups]);

  // ── CRUD ──────────────────────────────────────────────────
  // Phase 3B-3: PostgreSQL هو مصدر الحقيقة الآن — الحفظ/الحذف يذهب للـ backend أولاً،
  // ولا يُطبَّق أي تغيير على الحالة المحلية إلا بعد نجاح الخادم (نفس نمط Students).
  const handleSave = useCallback(async (formData) => {
    await run(async () => {
      if (modal.type === 'edit' && modal.group) {
        const updated = updateGroup(modal.group.id, formData, groups);
        const saved   = await pgUpdateGroup(modal.group.id, updated);
        setGroups(prev => prev.map(g => g.id === modal.group.id ? saved : g));
        addLog({ action:'update', module:'groups', entityType:'group', entityId:saved.id, description:`تعديل مجموعة: ${saved.name}` })
          .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
        toast.success(`تم تعديل "${saved.name}" ✓`);
      } else {
        const ng    = createGroup(formData, groups);
        const saved = await pgCreateGroup(ng);
        setGroups(prev => [...prev, saved]);
        addLog({ action:'create', module:'groups', entityType:'group', entityId:saved.id, description:`إنشاء مجموعة: ${saved.name}` })
          .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
        toast.success(`تم إنشاء "${saved.name}" ✓`);
      }
      closeModal();
    }, { errorMsg: 'فشل حفظ بيانات المجموعة' });
  }, [modal, groups, setGroups, run, toast, addLog, currentUser, closeModal]);

  // Phase 3B-4 (تحضيري): attendance الآن قيد التفعيل عبر PostgreSQL بقيد مفتاح خارجي
  // NO ACTION على group_id — مجموعة بلا طلاب حاليين قد يبقى لها سجل حضور تاريخي
  // (طلاب سابقون نُقلوا/حُذفوا)، فحذفها سيُرفَض من الخادم رغم أن فحص studentCount مرّ.
  const handleDelete = useCallback(async () => {
    const g = modal.group;
    const studentCount = students.filter(s => s.groupId === g.id).length;
    if (studentCount > 0) {
      toast.error(`لا يمكن حذف المجموعة — بها ${studentCount} طالب. انقل الطلاب أولاً.`);
      closeModal();
      return;
    }
    const attendanceCount = attendance.filter(a => a.groupId === g.id).length;
    if (attendanceCount > 0) {
      toast.error(`لا يمكن حذف المجموعة — لها ${attendanceCount} سجل حضور تاريخي.`);
      closeModal();
      return;
    }
    // Phase 3B-5: exams الآن قيد التفعيل عبر PostgreSQL بقيد مفتاح خارجي NO ACTION
    // على group_id — نفس فحص attendance أعلاه، ونفس السبب (تاريخ امتحانات قد يبقى
    // حتى لو أصبحت المجموعة بلا طلاب حاليين).
    const examsCount = exams.filter(e => e.groupId === g.id).length;
    if (examsCount > 0) {
      toast.error(`لا يمكن حذف المجموعة — لها ${examsCount} امتحان.`);
      closeModal();
      return;
    }
    // MEDIUM-A Finding 3: باقي جداول groups.id (NO ACTION) الأربعة غير المفحوصة محلياً —
    // نفس نمط attendance/exams أعلاه بالضبط (الخادم يمنع الحذف دائماً؛ هذا يستبدل رسالة
    // P2003 العامة برسالة واضحة قبل الوصول للخادم).
    const admissionsCount = admissions.filter(a => a.groupId === g.id).length;
    if (admissionsCount > 0) {
      toast.error(`لا يمكن حذف المجموعة — لها ${admissionsCount} سجل قبول مرتبط.`);
      closeModal();
      return;
    }
    const communicationsCount = communications.filter(c => c.groupId === g.id).length;
    if (communicationsCount > 0) {
      toast.error(`لا يمكن حذف المجموعة — لها ${communicationsCount} سجل تواصل مرتبط.`);
      closeModal();
      return;
    }
    const homeworksCount = homeworks.filter(h => h.groupId === g.id).length;
    if (homeworksCount > 0) {
      toast.error(`لا يمكن حذف المجموعة — لها ${homeworksCount} واجب مسجَّل.`);
      closeModal();
      return;
    }
    const paymentsCount = payments.filter(p => p.groupId === g.id).length;
    if (paymentsCount > 0) {
      toast.error(`لا يمكن حذف المجموعة — لها ${paymentsCount} دفعة مسجَّلة.`);
      closeModal();
      return;
    }
    await run(async () => {
      await pgDeleteGroup(g.id);
      setGroups(prev => prev.filter(x => x.id !== g.id));
      addLog({ action:'delete', module:'groups', entityType:'group', entityId:g.id, description:`حذف مجموعة: ${g.name}` })
        .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
      toast.info(`تم حذف "${g.name}"`);
      closeModal();
    }, { errorMsg: 'فشل حذف المجموعة' });
  }, [modal.group, students, attendance, exams, admissions, communications, homeworks, payments, setGroups, run, toast, addLog, currentUser, closeModal]);

  const selStyle = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 11px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' };

  return (
    <div>
      {/* ── Page header ─────────────────────── */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:14, padding:'0 28px', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:'1.35rem', fontWeight:800, letterSpacing:'-0.3px', marginBottom:3 }}>إدارة المجموعات</h1>
          <p style={{ fontSize:'0.78rem', color:'var(--text3)' }}>
            {filtered.length} مجموعة
            {filterGrade && <span style={{ color:'var(--accent)', marginRight:6 }}>(مفلتر)</span>}
          </p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {/* View toggle */}
          <div style={{ display:'flex', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, overflow:'hidden' }}>
            {['grid','list'].map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)}
                style={{ padding:'7px 14px', fontSize:'0.78rem', fontWeight:600, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s',
                  background: viewMode === mode ? 'var(--accent)' : 'transparent',
                  color:      viewMode === mode ? 'var(--surface)' : 'var(--text3)',
                  border:     'none',
                }}>
                {mode === 'grid' ? '⊞ شبكة' : '≡ قائمة'}
              </button>
            ))}
          </div>
          <Button variant="primary" size="sm" onClick={openAdd}>+ مجموعة جديدة</Button>
        </div>
      </div>

      {/* ── Overview stats ──────────────────── */}
      <SectionBoundary label="Overview Stats">
        <OverviewBar groups={groups} students={students} payments={payments} attendance={attendance}/>
      </SectionBoundary>

      {/* ── Filters ─────────────────────────── */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', padding:'0 28px', marginBottom:20 }}>
        <div style={{ flex:1, minWidth:200, display:'flex', alignItems:'center', gap:8, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'0 12px' }}
          onFocusCapture={e => e.currentTarget.style.borderColor='var(--accent)'}
          onBlurCapture={e  => e.currentTarget.style.borderColor='var(--border)'}
        >
          <span style={{ color:'var(--text3)' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم أو المادة أو المدرس..."
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', padding:'8px 0', direction:'rtl' }}/>
          {search && <button onClick={() => setSearch('')} style={{ color:'var(--text3)', cursor:'pointer', fontSize:'0.95rem' }}>×</button>}
        </div>
        <select style={selStyle} value={filterGrade} onChange={e => setFilterGrade(e.target.value)}>
          <option value="">كل السنوات</option>
          {gradesList.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        {(search || filterGrade) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setFilterGrade(''); }}>× مسح</Button>
        )}
      </div>

      {/* ── Groups display ──────────────────── */}
      <SectionBoundary label="Groups Display">
        <div style={{ padding:'0 28px 28px' }}>
          {filtered.length === 0 ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'60px 20px', gap:12, color:'var(--text3)', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14 }}>
              <div style={{ fontSize:44, opacity:.4 }}>◈</div>
              <div style={{ fontSize:'0.88rem', fontWeight:600 }}>
                {(search || filterGrade) ? 'لا توجد نتائج تطابق البحث' : 'لا توجد مجموعات بعد'}
              </div>
              {!search && !filterGrade && (
                <Button variant="primary" size="sm" onClick={openAdd}>+ إنشاء أول مجموعة</Button>
              )}
            </div>
          ) : viewMode === 'grid' ? (
            // ── GRID VIEW ──────────────────────
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:16 }}>
              {filtered.map(group => (
                <SectionBoundary key={group.id} label={`GroupCard:${group.id}`}>
                  <GroupCard
                    group={group}
                    onEdit={() => openEdit(group)}
                    onDelete={() => openDelete(group)}
                    onViewStudents={() => openViewStudents(group)}
                    onTransfer={() => openTransfer(group)}
                  />
                </SectionBoundary>
              ))}
            </div>
          ) : (
            // ── LIST VIEW ──────────────────────
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
              {filtered.map((group, i) => {
                const count   = students.filter(s => s.groupId === group.id && s.status === 'active').length;
                const fillPct = group.max > 0 ? Math.round(count / group.max * 100) : 0;
                const isFull  = count >= group.max;
                const revenue = payments.filter(p => p.groupId === group.id).reduce((s, p) => s + p.amount, 0);

                return (
                  <div key={group.id} style={{
                    display:'flex', alignItems:'center', gap:14, padding:'13px 18px',
                    borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                    transition:'background .12s',
                  }}
                    onMouseOver={e  => e.currentTarget.style.background='var(--surface2)'}
                    onMouseOut={e   => e.currentTarget.style.background=''}
                  >
                    {/* Color dot */}
                    <div style={{ width:10, height:10, borderRadius:'50%', background:group.color||'var(--accent)', flexShrink:0 }}/>

                    {/* Name + subject */}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:'0.9rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{group.name}</div>
                      <div style={{ fontSize:'0.72rem', color:'var(--text3)', display:'flex', gap:10, marginTop:2 }}>
                        <span>{group.subject}</span>
                        <span>{group.grade}</span>
                        <span>🕐 {group.time} · {formatDays(group.days)}</span>
                        {group.teacher && <span>👤 {group.teacher}</span>}
                      </div>
                    </div>

                    {/* Capacity */}
                    <div style={{ width:100, flexShrink:0 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4, fontSize:'0.68rem' }}>
                        <span style={{ color:'var(--text3)' }}>السعة</span>
                        <span style={{ fontWeight:700, color: isFull ? '#ef4444' : 'var(--text)' }}>{count}/{group.max}</span>
                      </div>
                      <div style={{ height:5, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${Math.min(fillPct,100)}%`, background: isFull ? '#ef4444' : fillPct > 80 ? '#f59e0b' : group.color||'var(--accent)', borderRadius:99 }}/>
                      </div>
                    </div>

                    {/* Revenue */}
                    <div style={{ width:80, textAlign:'center', flexShrink:0 }}>
                      <div style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--green)', fontFamily:'Cairo,sans-serif' }}>{formatCurrency(revenue).replace(' ج.م','')}</div>
                      <div style={{ fontSize:'0.62rem', color:'var(--text3)' }}>ج.م</div>
                    </div>

                    {/* Actions */}
                    <div style={{ display:'flex', gap:4, flexShrink:0 }}>
                      <button onClick={() => openViewStudents(group)} title="عرض الطلاب"
                        style={{ padding:'5px 10px', borderRadius:7, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.72rem', cursor:'pointer', color:'var(--text2)', transition:'all .12s', fontFamily:'Cairo,sans-serif' }}
                        onMouseOver={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--accent)'; }}
                        onMouseOut={e  => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text2)'; }}>👁</button>
                      <button onClick={() => openTransfer(group)} title="نقل طلاب"
                        style={{ padding:'5px 10px', borderRadius:7, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.72rem', cursor:'pointer', color:'var(--text2)', transition:'all .12s', fontFamily:'Cairo,sans-serif' }}
                        onMouseOver={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--accent)'; }}
                        onMouseOut={e  => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text2)'; }}>⇄</button>
                      <button onClick={() => openEdit(group)} title="تعديل"
                        style={{ padding:'5px 10px', borderRadius:7, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.72rem', cursor:'pointer', color:'var(--text2)', transition:'all .12s', fontFamily:'Cairo,sans-serif' }}
                        onMouseOver={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--accent)'; }}
                        onMouseOut={e  => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text2)'; }}>✎</button>
                      <button onClick={() => openDelete(group)} title="حذف"
                        style={{ padding:'5px 10px', borderRadius:7, border:'1px solid rgba(239,68,68,.2)', background:'rgba(239,68,68,.08)', fontSize:'0.72rem', cursor:'pointer', color:'var(--red)', transition:'all .12s', fontFamily:'Cairo,sans-serif' }}
                        onMouseOver={e => { e.currentTarget.style.background='var(--red)'; e.currentTarget.style.color='#fff'; }}
                        onMouseOut={e  => { e.currentTarget.style.background='rgba(239,68,68,.08)'; e.currentTarget.style.color='var(--red)'; }}>🗑</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SectionBoundary>

      {/* ── Add / Edit Modal ─────────────────── */}
      <Modal isOpen={modal.type==='add'||modal.type==='edit'} onClose={closeModal}
        title={modal.type==='edit' ? `تعديل — ${modal.group?.name}` : 'إنشاء مجموعة جديدة'} size="md">
        <GroupForm
          initialValues={modal.group}
          editId={modal.group?.id}
          existingGroups={groups}
          onSubmit={handleSave}
          onCancel={closeModal}
          loading={loading}
        />
      </Modal>

      {/* ── Delete Confirm ───────────────────── */}
      <ConfirmModal isOpen={modal.type==='delete'} onClose={closeModal} onConfirm={handleDelete}
        loading={loading} title="تأكيد الحذف"
        message={`هل أنت متأكد من حذف "${modal.group?.name}"؟\nتأكد من نقل الطلاب قبل الحذف.`}
        confirmLabel="نعم، احذف"/>

      {/* ── View Students Modal ──────────────── */}
      <Modal isOpen={modal.type==='students' && !!modal.group} onClose={closeModal}
        title={`طلاب — ${modal.group?.name}`} size="md">
        {modal.group && (
          <GroupStudents
            group={modal.group}
            onClose={closeModal}
            onTransferOpen={() => { closeModal(); setTransferGroup(modal.group); }}
          />
        )}
      </Modal>

      {/* ── Transfer Modal (standalone) ─────── */}
      {transferGroup && (
        <TransferModal
          group={transferGroup}
          onClose={() => setTransferGroup(null)}
        />
      )}
    </div>
  );
}
