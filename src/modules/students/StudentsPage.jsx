// src/modules/students/StudentsPage.jsx
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { useAuth }     from '../../store/auth.context';
import { SectionBoundary } from '../../components/ErrorBoundary';
import { Modal, ConfirmModal } from '../../components/ui/Modal';
import Button              from '../../components/ui/Button';
import { useToast }        from '../../components/Toast';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { createStudent, updateStudent, filterStudents } from '../../services/studentService';
import { pgCreateStudent, pgUpdateStudent, pgDeleteStudent, pgCreateParent, pgGetCollection } from '../../services/api';
import { normalizeParentPhone } from '../communication/parentService';
import { paginate, formatDate } from '../../utils/helpers';
import StudentForm         from './StudentForm';
import StudentProfile      from './StudentProfile';
import StudentAvatar       from './components/StudentAvatar';
import StatusBadge         from './components/StatusBadge';
import AttendanceHeatMap   from './components/AttendanceHeatMap';

const PAGE_SIZE = 10;
const GRADES = ['الصف الأول الثانوي','الصف الثاني الثانوي','الصف الثالث الثانوي','الصف الأول الإعدادي','الصف الثاني الإعدادي','الصف الثالث الإعدادي'];

// Product Completion Phase 1 — Issue 3: ربط الطالب بصف parents حقيقي عند إنشائه مباشرة
// (ليس عبر تفعيل قبول). نفس منطق find-or-create بالهاتف المطبَّع المستخدَم بالفعل في
// CommunicationPage.jsx's handleSaveParent (مقروء لا منسوخ — لا لمس لذلك الملف)، لكن بلا
// فرع "تحديث بيانات موجودة" لأننا هنا نربط فقط، لا نحرّر بيانات ولي الأمر. هاتف غير صالح
// أو فارغ → null بلا أي حظر (نفس السلوك الحالي تماماً، parent_id يبقى NULL).
async function findOrCreateParentId(phone) {
  const normalized = normalizeParentPhone(phone);
  if (!normalized) return null;
  const result = await pgCreateParent(
    { phone: normalized },
    {
      onPhoneConflict: async () => {
        const fresh = await pgGetCollection('parents');
        return fresh.find((r) => normalizeParentPhone(r.phone) === normalized)?.id ?? null;
      },
    }
  );
  if (result.conflict) {
    if (!result.existingId) throw new Error('تعذّر إيجاد سجل ولي الأمر بعد تعارض الهاتف');
    return result.existingId;
  }
  return result.data.id;
}

export default function StudentsPage() {
  const addLog               = useAppStore((s) => s.addLog);
  const admissions           = useAppStore((s) => s.admissions);
  const attendance           = useAppStore((s) => s.attendance);
  const communications       = useAppStore((s) => s.communications);
  const grades               = useAppStore((s) => s.grades);
  const groups               = useAppStore((s) => s.groups);
  const hwSubmissions        = useAppStore((s) => s.hwSubmissions);
  const inventoryTxn         = useAppStore((s) => s.inventoryTxn);
  const payments             = useAppStore((s) => s.payments);
  const setStudents          = useAppStore((s) => s.setStudents);
  const students             = useAppStore((s) => s.students);
  const waReportLog          = useAppStore((s) => s.waReportLog);
  const { currentUser } = useAuth();
  const toast = useToast();
  const { loading, run } = useErrorHandler(toast);

  const [view,         setView]        = useState('list');
  const [profileId,    setProfileId]   = useState(null);
  const [search,       setSearch]      = useState('');
  const [filterGrade,  setFilterGrade] = useState('');
  const [filterGroup,  setFilterGroup] = useState('');
  const [filterStatus, setFilterStatus]= useState('');
  const [page,         setPage]        = useState(1);
  const [modal,        setModal]       = useState({ type: null, student: null });

  const openAdd    = useCallback(() => setModal({ type:'add',    student:null }), []);
  const openEdit   = useCallback((s) => setModal({ type:'edit',  student:s }),   []);
  const openDelete = useCallback((s) => setModal({ type:'delete',student:s }),   []);
  const closeModal = useCallback(() => setModal({ type:null, student:null }),     []);
  const openProfile = useCallback((id) => { setProfileId(id); setView('profile'); }, []);
  const backToList  = useCallback(() => { setView('list'); setProfileId(null); },   []);

  const filtered = useMemo(() =>
    filterStudents(students, { query:search, grade:filterGrade, groupId:filterGroup, status:filterStatus }),
  [students, search, filterGrade, filterGroup, filterStatus]);

  const pg = useMemo(() => paginate(filtered, page, PAGE_SIZE), [filtered, page]);
  const hasFilters = !!(search || filterGrade || filterGroup || filterStatus);

  const clearFilters = useCallback(() => { setSearch(''); setFilterGrade(''); setFilterGroup(''); setFilterStatus(''); setPage(1); }, []);

  // Phase 3B-2: PostgreSQL هو مصدر الحقيقة الآن — الحفظ/الحذف يذهب للـ backend أولاً،
  // ولا يُطبَّق أي تغيير على الحالة المحلية (Zustand/localStorage) إلا بعد نجاح الخادم.
  // id/created_at/updated_at الفعليين يأتيان دائماً من استجابة الخادم، لا من القيم المحلية.
  const handleSave = useCallback(async (formData) => {
    await run(async () => {
      if (modal.type === 'edit' && modal.student) {
        const updated = updateStudent(modal.student.id, formData, students);
        const saved   = await pgUpdateStudent(modal.student.id, updated);
        setStudents(prev => prev.map(s => s.id === modal.student.id ? saved : s));
        addLog({ action:'update', module:'students', entityType:'student', entityId:saved.id, description:`تعديل: ${saved.name}` })
          .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
        toast.success(`تم تعديل بيانات ${saved.name} ✓`);
      } else {
        const ns       = createStudent(formData, students);
        const parentId = await findOrCreateParentId(ns.parentPhone);
        const saved    = await pgCreateStudent(parentId ? { ...ns, parentId } : ns);
        setStudents(prev => [...prev, saved]);
        addLog({ action:'create', module:'students', entityType:'student', entityId:saved.id, description:`إضافة: ${saved.name}` })
          .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
        toast.success(`تم تسجيل ${saved.name} بنجاح ✓`);
      }
      closeModal();
    }, { errorMsg: 'فشل حفظ بيانات الطالب' });
  }, [modal, students, setStudents, run, toast, addLog, currentUser, closeModal]);

  // Phase 3B-4 (تحضيري): attendance الآن قيد التفعيل عبر PostgreSQL بقيد مفتاح
  // خارجي NO ACTION على student_id — حذف طالب له سجلات حضور سيُرفَض من الخادم (409).
  // نفس نمط فحص "طلاب المجموعة" في GroupsPage: نمنع محلياً برسالة مفهومة بدل
  // ترك الخطأ العام "فشل حذف الطالب" يظهر بلا سبب واضح.
  const handleDelete = useCallback(async () => {
    const s = modal.student;
    const attendanceCount = attendance.filter(a => a.studentId === s.id).length;
    if (attendanceCount > 0) {
      toast.error(`لا يمكن حذف ${s.name} — له ${attendanceCount} سجل حضور. أوقفه بدلاً من حذفه (الحالة: موقوف).`);
      closeModal();
      return;
    }
    // Phase 3B-5: grades الآن قيد التفعيل عبر PostgreSQL بقيد مفتاح خارجي NO ACTION
    // على student_id — نفس فحص attendance أعلاه.
    const gradesCount = grades.filter(g => g.studentId === s.id).length;
    if (gradesCount > 0) {
      toast.error(`لا يمكن حذف ${s.name} — له ${gradesCount} درجة مسجّلة. أوقفه بدلاً من حذفه (الحالة: موقوف).`);
      closeModal();
      return;
    }
    // MEDIUM-A Finding 3: باقي جداول students.id (NO ACTION) الستة غير المفحوصة محلياً —
    // نفس نمط attendance/grades أعلاه بالضبط. الخادم يمنع الحذف في كل الحالات دائماً
    // (لا خطر على تكامل البيانات)؛ هذا فقط يستبدل رسالة P2003 العامة المُربكة برسالة
    // واضحة قبل الوصول للخادم إطلاقاً.
    const admissionsCount = admissions.filter(a => a.studentId === s.id).length;
    if (admissionsCount > 0) {
      toast.error(`لا يمكن حذف ${s.name} — له ${admissionsCount} سجل قبول. أوقفه بدلاً من حذفه (الحالة: موقوف).`);
      closeModal();
      return;
    }
    const communicationsCount = communications.filter(c => c.studentId === s.id).length;
    if (communicationsCount > 0) {
      toast.error(`لا يمكن حذف ${s.name} — له ${communicationsCount} سجل تواصل. أوقفه بدلاً من حذفه (الحالة: موقوف).`);
      closeModal();
      return;
    }
    const hwSubmissionsCount = hwSubmissions.filter(h => h.studentId === s.id).length;
    if (hwSubmissionsCount > 0) {
      toast.error(`لا يمكن حذف ${s.name} — له ${hwSubmissionsCount} تسليم واجب. أوقفه بدلاً من حذفه (الحالة: موقوف).`);
      closeModal();
      return;
    }
    const inventoryTxnCount = inventoryTxn.filter(t => t.studentId === s.id).length;
    if (inventoryTxnCount > 0) {
      toast.error(`لا يمكن حذف ${s.name} — له ${inventoryTxnCount} حركة مخزون. أوقفه بدلاً من حذفه (الحالة: موقوف).`);
      closeModal();
      return;
    }
    const paymentsCount = payments.filter(p => p.studentId === s.id).length;
    if (paymentsCount > 0) {
      toast.error(`لا يمكن حذف ${s.name} — له ${paymentsCount} دفعة مسجّلة. أوقفه بدلاً من حذفه (الحالة: موقوف).`);
      closeModal();
      return;
    }
    const waReportLogCount = waReportLog.filter(w => w.studentId === s.id).length;
    if (waReportLogCount > 0) {
      toast.error(`لا يمكن حذف ${s.name} — له ${waReportLogCount} سجل تقرير واتساب. أوقفه بدلاً من حذفه (الحالة: موقوف).`);
      closeModal();
      return;
    }
    await run(async () => {
      await pgDeleteStudent(s.id);
      setStudents(prev => prev.filter(x => x.id !== s.id));
      addLog({ action:'delete', module:'students', entityType:'student', entityId:s.id, description:`حذف: ${s.name}` })
        .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
      toast.info(`تم حذف ${s.name}`);
      closeModal();
    }, { errorMsg: 'فشل حذف الطالب' });
  }, [modal.student, attendance, grades, admissions, communications, hwSubmissions, inventoryTxn, payments, waReportLog, setStudents, run, toast, addLog, currentUser, closeModal]);

  const selStyle = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'8px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' };
  const btnStyle = (hover) => ({ padding:'4px 9px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.72rem', cursor:'pointer', color:'var(--text2)', transition:'all 0.12s', fontFamily:'Cairo,sans-serif' });

  // ── PROFILE VIEW ──────────────────────────────────────────
  if (view === 'profile' && profileId) {
    return (
      <SectionBoundary label="StudentProfile">
        <StudentProfile studentId={profileId} onBack={backToList}
          onEdit={(s) => { backToList(); setTimeout(() => openEdit(s), 80); }}/>
      </SectionBoundary>
    );
  }

  // ── LIST VIEW ─────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:14, padding:'0 28px', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:'1.35rem', fontWeight:800, letterSpacing:'-0.3px', marginBottom:3 }}>إدارة الطلاب</h1>
          <p style={{ fontSize:'0.78rem', color:'var(--text3)' }}>
            {filtered.length} طالب{hasFilters && <span style={{ color:'var(--accent)', marginRight:6 }}>(مفلتر)</span>} من {students.length} إجمالي
          </p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <Button variant="ghost" size="sm">⬇ تصدير</Button>
          <Button variant="primary" size="sm" onClick={openAdd}>+ طالب جديد</Button>
        </div>
      </div>

      {/* Filters */}
      <SectionBoundary label="Filters">
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', padding:'0 28px', marginBottom:16 }}>
          <div style={{ flex:1, minWidth:220, display:'flex', alignItems:'center', gap:8, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:10, padding:'0 12px', transition:'all 0.15s' }}
            onFocusCapture={e => e.currentTarget.style.borderColor='var(--accent)'}
            onBlurCapture={e  => e.currentTarget.style.borderColor='var(--border)'}
          >
            <span style={{ color:'var(--text3)', flexShrink:0 }}>🔍</span>
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="بحث بالاسم أو الكود أو الهاتف..."
              style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.85rem', padding:'9px 0', direction:'rtl' }}/>
            {search && <button onClick={() => { setSearch(''); setPage(1); }} style={{ color:'var(--text3)', cursor:'pointer', fontSize:'0.95rem' }}>×</button>}
          </div>
          <select style={selStyle} value={filterGrade}  onChange={e => { setFilterGrade(e.target.value); setPage(1); }}>
            <option value="">كل السنوات</option>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select style={selStyle} value={filterGroup}  onChange={e => { setFilterGroup(e.target.value); setPage(1); }}>
            <option value="">كل المجموعات</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select style={selStyle} value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
            <option value="">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="inactive">موقوف</option>
            <option value="graduated">متخرج</option>
          </select>
          {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters}>× مسح الكل</Button>}
        </div>
      </SectionBoundary>

      {/* Table */}
      <SectionBoundary label="Students Table">
        <div style={{ padding:'0 28px' }}>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
            {pg.total === 0 ? (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'56px 20px', gap:12, color:'var(--text3)' }}>
                <div style={{ fontSize:44, opacity:.4 }}>👥</div>
                <div style={{ fontSize:'0.88rem', fontWeight:600 }}>{hasFilters ? 'لا توجد نتائج تطابق البحث' : 'لا يوجد طلاب بعد'}</div>
                {!hasFilters && <Button variant="primary" size="sm" onClick={openAdd}>+ تسجيل أول طالب</Button>}
                {hasFilters  && <Button variant="ghost"   size="sm" onClick={clearFilters}>مسح الفلتر</Button>}
              </div>
            ) : (
              <>
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
                    <thead>
                      <tr style={{ background:'var(--surface2)' }}>
                        {['الطالب','رقم الهاتف','المجموعة','السنة الدراسية','الحضور','الحالة',''].map(h => (
                          <th key={h} style={{ padding:'10px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.08em', whiteSpace:'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pg.items.map(student => {
                        const grp    = groups.find(g => g.id === student.groupId);
                        const attRec = attendance.filter(a => a.studentId === student.id);
                        return (
                          <tr key={student.id} style={{ cursor:'pointer', transition:'background 0.12s' }}
                            onMouseOver={e  => Array.from(e.currentTarget.cells).forEach(td => td.style.background='var(--surface2)')}
                            onMouseOut={e   => Array.from(e.currentTarget.cells).forEach(td => td.style.background='')}
                            onClick={() => openProfile(student.id)}
                          >
                            <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                                <StudentAvatar name={student.name} size={34}/>
                                <div>
                                  <div style={{ fontWeight:700, fontSize:'0.88rem', color:'var(--accent)' }}>{student.name}</div>
                                  <div style={{ fontSize:'0.68rem', color:'var(--text3)', fontFamily:'Cairo,sans-serif' }}>{student.code}</div>
                                </div>
                              </div>
                            </td>
                            <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', fontSize:'0.78rem', color:'var(--text2)' }}>{student.phone}</td>
                            <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.8rem', color:'var(--text2)' }}>
                              {grp ? <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:8, height:8, borderRadius:'50%', background:grp.color||'var(--accent)', flexShrink:0 }}/>{grp.name}</span> : '—'}
                            </td>
                            <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.8rem', color:'var(--text2)' }}>{student.grade}</td>
                            <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                              <AttendanceHeatMap records={attRec} maxCells={10} size={11}/>
                            </td>
                            <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}><StatusBadge status={student.status}/></td>
                            <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                              <div style={{ display:'flex', gap:4 }}>
                                <button onClick={() => openProfile(student.id)} style={btnStyle()} title="عرض الملف"
                                  onMouseOver={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--accent)'; }}
                                  onMouseOut={e  => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text2)'; }}>👁</button>
                                <button onClick={() => openEdit(student)} style={btnStyle()} title="تعديل"
                                  onMouseOver={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--accent)'; }}
                                  onMouseOut={e  => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text2)'; }}>✎</button>
                                <button onClick={() => openDelete(student)} style={{ ...btnStyle(), border:'1px solid rgba(239,68,68,.2)', background:'rgba(239,68,68,.08)', color:'var(--red)' }} title="حذف"
                                  onMouseOver={e => { e.currentTarget.style.background='var(--red)'; e.currentTarget.style.color='#fff'; }}
                                  onMouseOut={e  => { e.currentTarget.style.background='rgba(239,68,68,.08)'; e.currentTarget.style.color='var(--red)'; }}>🗑</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {pg.totalPages > 1 && (
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 20px', borderTop:'1px solid var(--border)', fontSize:'0.78rem', flexWrap:'wrap', gap:8 }}>
                    <span style={{ color:'var(--text3)' }}>عرض {pg.start}–{pg.end} من {pg.total}</span>
                    <div style={{ display:'flex', gap:4 }}>
                      <button disabled={!pg.hasPrev} onClick={() => setPage(p => p-1)} style={{ minWidth:30, height:30, borderRadius:7, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.78rem', cursor:'pointer', color:'var(--text2)' }}>›</button>
                      {Array.from({ length:pg.totalPages },(_,i)=>i+1).filter(p=>Math.abs(p-page)<=2||p===1||p===pg.totalPages).map((p,i,arr)=>(
                        <span key={p}>
                          {i>0&&arr[i-1]!==p-1&&<span style={{ padding:'0 4px', color:'var(--text3)' }}>…</span>}
                          <button onClick={()=>setPage(p)} style={{ minWidth:30, height:30, borderRadius:7, border:'1px solid', fontSize:'0.78rem', cursor:'pointer', fontFamily:'Cairo,sans-serif', borderColor:p===page?'var(--accent)':'var(--border)', background:p===page?'var(--accent)':'var(--surface2)', color:p===page?'var(--surface)':'var(--text2)' }}>{p}</button>
                        </span>
                      ))}
                      <button disabled={!pg.hasNext} onClick={() => setPage(p => p+1)} style={{ minWidth:30, height:30, borderRadius:7, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.78rem', cursor:'pointer', color:'var(--text2)' }}>‹</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </SectionBoundary>

      {/* Modals */}
      <Modal isOpen={modal.type==='add'||modal.type==='edit'} onClose={closeModal}
        title={modal.type==='edit' ? `تعديل — ${modal.student?.name}` : 'إضافة طالب جديد'} size="md">
        <StudentForm initialValues={modal.student} editId={modal.student?.id}
          onSubmit={handleSave} onCancel={closeModal} loading={loading}/>
      </Modal>

      <ConfirmModal isOpen={modal.type==='delete'} onClose={closeModal} onConfirm={handleDelete}
        loading={loading} title="تأكيد الحذف"
        message={`هل أنت متأكد من حذف "${modal.student?.name}"؟ لا يمكن التراجع.`}
        confirmLabel="نعم، احذف"/>
    </div>
  );
}
