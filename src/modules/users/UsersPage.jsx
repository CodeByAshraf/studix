// src/modules/users/UsersPage.jsx
// Stabilization phase — Users/Roles أصبحا PostgreSQL-backed (server-truth-first)
// عبر pgGetUsers/pgCreateUser/pgUpdateUser/pgDeleteUser وما يقابلها للأدوار. Teachers
// يبقى محلياً تماماً كما كان (نطاق منفصل، خارج هذه المرحلة) — لا تغيير على ربط
// المدرّس بحساب مستخدم (userId على سجل teacher محلي)، ولا يُرسَل teacherId إطلاقاً
// لمسارات users الجديدة (عمود teacher_id بالخادم يشير لجدول teachers الحقيقي
// الفارغ حالياً — إرساله سيفشل بخرق مفتاح خارجي، عمداً غير مستخدَم هنا).
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAppStore } from '../../store/app.store';
import { useAuth }     from '../../store/auth.context';
import {
  pgGetUsers, pgCreateUser, pgUpdateUser, pgDeleteUser,
  pgGetRoles, pgCreateRole, pgUpdateRole, pgDeleteRole,
} from '../../services/api';
import { SectionBoundary } from '../../components/ErrorBoundary';
import { Modal, ConfirmModal } from '../../components/ui/Modal';
import Button       from '../../components/ui/Button';
import { useToast } from '../../components/Toast';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { formatDate } from '../../utils/helpers';
import {
  SYSTEM_PAGES, PAGE_GROUPS, ROLE_COLORS,
  validateTeacher, createTeacher, updateTeacher,
  validateUser, validateRole,
} from '../../services/usersService';

const SUBJECTS = ['رياضيات','فيزياء','كيمياء','أحياء','إنجليزية','عربي','تاريخ','جغرافيا','فلسفة','حاسب','علوم','أخرى'];
const VIEWS    = [
  { id:'teachers', icon:'👨‍🏫', label:'المدرسون'           },
  { id:'users',    icon:'👤',   label:'حسابات المستخدمين'  },
  { id:'roles',    icon:'🛡',   label:'الأدوار والصلاحيات' },
];

// ── Avatar helper ─────────────────────────────────────────────
const AV_PAL = [
  {bg:'rgba(124,58,237,.18)',color:'#7c3aed'},{bg:'rgba(13,148,136,.18)',color:'#0d9488'},
  {bg:'rgba(59,130,246,.18)',color:'#3b82f6'},{bg:'rgba(245,158,11,.18)',color:'#f59e0b'},
  {bg:'rgba(239,68,68,.18)', color:'#ef4444'},{bg:'rgba(16,185,129,.18)',color:'#10b981'},
];
const av = n => AV_PAL[((n?.charCodeAt(0)||0)+(n?.charCodeAt(1)||0))%AV_PAL.length];

// ── Shared form styles ────────────────────────────────────────
const BASE = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'9px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.875rem', outline:'none', width:'100%', direction:'rtl', transition:'border-color .15s, box-shadow .15s' };
const fo = e => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.12)'; };
const bl = inv => e => { e.target.style.borderColor=inv?'var(--red)':'var(--border)'; e.target.style.boxShadow='none'; };
const I = ({ name, value, onChange, placeholder, type='text', invalid, min }) => <input name={name} type={type} value={value||''} min={min} onChange={onChange} placeholder={placeholder} style={{...BASE, borderColor:invalid?'var(--red)':'var(--border)', background:invalid?'rgba(239,68,68,.05)':'var(--surface2)'}} onFocus={fo} onBlur={bl(invalid)}/>;
const S = ({ name, value, onChange, children, invalid, disabled }) => <select name={name} value={value||''} onChange={onChange} disabled={disabled} style={{...BASE, cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.65:1, borderColor:invalid?'var(--red)':'var(--border)'}} onFocus={fo} onBlur={bl(invalid)}>{children}</select>;
function F({ label, required, error, children }) {
  return <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
    <label style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em' }}>{label}{required&&<span style={{color:'var(--red)',marginRight:3}}>*</span>}</label>
    {children}
    {error && <div style={{ fontSize:'0.7rem', color:'var(--red)' }}>⚠ {error}</div>}
  </div>;
}

// ════════════════════════════════════════════════════════════
// ── Teacher Form ─────────────────────────────────────────────
function TeacherForm({ initial, editId, onSave, onClose, loading }) {
  const [form, setForm] = useState(initial || { name:'', phone:'', subject:'', address:'', email:'', hireDate:new Date().toISOString().split('T')[0], status:'active', notes:'' });
  const [errors, setErrors] = useState({});
  const set = (k,v) => setForm(p=>({...p,[k]:v}));
  const ch  = e => set(e.target.name, e.target.value);
  const err = k => errors[k];
  const isEr= k => !!errors[k];

  const handleSave = () => {
    const errs = validateTeacher(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSave(form);
  };

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
      <div style={{ gridColumn:'1/-1' }}><F label="اسم المدرس" required error={err('name')}><I name="name" value={form.name} onChange={ch} placeholder="الاسم الكامل" invalid={isEr('name')}/></F></div>
      <F label="رقم الهاتف" required error={err('phone')}><I name="phone" value={form.phone} onChange={ch} placeholder="01xxxxxxxxx" invalid={isEr('phone')}/></F>
      <F label="المادة" required error={err('subject')}><S name="subject" value={form.subject} onChange={ch} invalid={isEr('subject')}><option value="">اختر...</option>{SUBJECTS.map(s=><option key={s} value={s}>{s}</option>)}</S></F>
      <F label="العنوان"><I name="address" value={form.address} onChange={ch} placeholder="المدينة أو الحي"/></F>
      <F label="البريد الإلكتروني" error={err('email')}><I name="email" value={form.email} onChange={ch} type="email" placeholder="example@mail.com" invalid={isEr('email')}/></F>
      <F label="تاريخ التعيين" required error={err('hireDate')}><I name="hireDate" value={form.hireDate} onChange={ch} type="date" invalid={isEr('hireDate')}/></F>
      <F label="الحالة"><S name="status" value={form.status} onChange={ch}><option value="active">نشط</option><option value="inactive">غير نشط</option></S></F>
      <div style={{ gridColumn:'1/-1' }}><F label="ملاحظات"><textarea name="notes" value={form.notes} onChange={ch} rows={2} style={{...BASE, resize:'vertical', minHeight:56}} onFocus={fo} onBlur={e=>{e.target.style.borderColor='var(--border)';e.target.style.boxShadow='none';}}/></F></div>
      <div style={{ gridColumn:'1/-1', display:'flex', justifyContent:'flex-end', gap:10, paddingTop:12, borderTop:'1px solid var(--border)' }}>
        <Button variant="secondary" onClick={onClose}>إلغاء</Button>
        <Button variant="primary" loading={loading} onClick={handleSave}>💾 {editId ? 'حفظ' : 'إضافة المدرس'}</Button>
      </div>
    </div>
  );
}

// ── User Form ─────────────────────────────────────────────────
function UserForm({ initial, editId, onSave, onClose, loading, roles, teachers, users }) {
  const addLog               = useAppStore((s) => s.addLog);
  const { currentUser }      = useAuth();
  const [form, setForm]   = useState(initial || { id:'', name:'', roleId:'', password:'', active:true, teacherId:'', email:'' });
  const [errors, setErrors] = useState({});
  const [showPass, setShowPass] = useState(false);
  const ch  = e => setForm(p=>({...p,[e.target.name]: e.target.type==='checkbox'?e.target.checked:e.target.value}));
  const err = k => errors[k];
  const isEr= k => !!errors[k];

  // تعديل حسابه الخاص: الدور يبقى admin دائماً — لا يمكن تخفيضه من الواجهة
  const isEditingSelf = !!editId && currentUser?.id === editId;

  // Auto-fill from teacher
  const handleTeacherChange = (e) => {
    const tc = teachers.find(t=>t.id===e.target.value);
    setForm(p=>({ ...p, teacherId:e.target.value, name:tc?tc.name:p.name, email:tc?tc.email:p.email }));
  };

  const handleSave = () => {
    const errs = validateUser(form, users, editId);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSave(form);
  };

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
      <F label="ربط بمدرس (اختياري)"><S name="teacherId" value={form.teacherId} onChange={handleTeacherChange}><option value="">بدون ربط</option>{teachers.map(t=><option key={t.id} value={t.id}>{t.name} — {t.subject}</option>)}</S></F>
      <F label="الاسم الكامل" required error={err('name')}><I name="name" value={form.name} onChange={ch} placeholder="اسم المستخدم الكامل" invalid={isEr('name')}/></F>
      <F label="اسم الدخول (ID)" required error={err('id')}><I name="id" value={form.id} onChange={ch} placeholder="user_name" invalid={isEr('id')} disabled={!!editId}/></F>
      <F label="الدور" required error={err('roleId')}><S name="roleId" value={isEditingSelf ? 'admin' : form.roleId} onChange={ch} invalid={isEr('roleId')} disabled={isEditingSelf}><option value="">اختر الدور...</option>{Object.values(roles).map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</S></F>
      <F label={editId ? 'كلمة المرور الجديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور'} required={!editId} error={err('password')}>
        <div style={{ position:'relative' }}>
          <I name="password" value={form.password} onChange={ch} type={showPass?'text':'password'} placeholder="••••••••" invalid={isEr('password')}/>
          <button type="button" onClick={()=>setShowPass(p=>!p)} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text3)', fontSize:'0.85rem' }}>{showPass?'🙈':'👁'}</button>
        </div>
      </F>
      <F label="البريد الإلكتروني"><I name="email" value={form.email} onChange={ch} type="email" placeholder="example@mail.com"/></F>
      <div style={{ gridColumn:'1/-1', display:'flex', alignItems:'center', gap:10 }}>
        <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:'0.85rem', fontWeight:600 }}>
          <input type="checkbox" name="active" checked={form.active!==false} onChange={ch} style={{ width:16, height:16, cursor:'pointer' }}/>
          الحساب نشط
        </label>
      </div>
      <div style={{ gridColumn:'1/-1', display:'flex', justifyContent:'flex-end', gap:10, paddingTop:12, borderTop:'1px solid var(--border)' }}>
        <Button variant="secondary" onClick={onClose}>إلغاء</Button>
        <Button variant="primary" loading={loading} onClick={handleSave}>💾 {editId ? 'حفظ التعديلات' : 'إنشاء الحساب'}</Button>
      </div>
    </div>
  );
}

// ── Role Form ─────────────────────────────────────────────────
function RoleForm({ initial, editId, onSave, onClose, loading }) {
  const [form, setForm] = useState(initial || { id:'', label:'', color:ROLE_COLORS[1], description:'', permissions:[] });
  const [errors, setErrors] = useState({});
  const ch  = e => setForm(p=>({...p,[e.target.name]:e.target.value}));
  const err = k => errors[k];
  const isEr= k => !!errors[k];

  const togglePerm = (pageId) => {
    setForm(p => ({
      ...p,
      permissions: p.permissions.includes(pageId) ? p.permissions.filter(x=>x!==pageId) : [...p.permissions, pageId],
    }));
  };

  const toggleGroup = (groupPages, allOn) => {
    setForm(p => {
      const ids = groupPages.map(x=>x.id);
      const newPerms = allOn ? p.permissions.filter(x=>!ids.includes(x)) : [...new Set([...p.permissions, ...ids])];
      return { ...p, permissions: newPerms };
    });
  };

  const handleSave = () => {
    const errs = validateRole(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSave(form);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        <F label="معرف الدور (إنجليزي)" required error={err('id')}><I name="id" value={form.id} onChange={ch} placeholder="teacher_assistant" invalid={isEr('id')} disabled={!!editId && form.isSystem}/></F>
        <F label="اسم الدور (عربي)" required error={err('label')}><I name="label" value={form.label} onChange={ch} placeholder="مساعد مدرس" invalid={isEr('label')}/></F>
        <F label="وصف الدور"><I name="description" value={form.description} onChange={ch} placeholder="وصف مختصر للصلاحيات..."/></F>
        <F label="لون الدور">
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', paddingTop:4 }}>
            {ROLE_COLORS.map(c=>(
              <button key={c} onClick={()=>setForm(p=>({...p,color:c}))}
                style={{ width:28, height:28, borderRadius:'50%', background:c, border:`3px solid ${form.color===c?'var(--text)':'transparent'}`, cursor:'pointer', transition:'transform .1s' }}
                onMouseOver={e=>e.currentTarget.style.transform='scale(1.2)'}
                onMouseOut={e =>e.currentTarget.style.transform='scale(1)'}/>
            ))}
          </div>
        </F>
      </div>

      {/* Permission matrix */}
      <div>
        <div style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--text3)', marginBottom:12, textTransform:'uppercase', letterSpacing:'0.05em' }}>الصلاحيات</div>
        <div style={{ background:'var(--surface2)', borderRadius:12, padding:14, display:'flex', flexDirection:'column', gap:14, maxHeight:360, overflowY:'auto' }}>
          {PAGE_GROUPS.map(grp => {
            const grpPages = SYSTEM_PAGES.filter(p=>p.group===grp);
            const allOn    = grpPages.every(p=>form.permissions.includes(p.id));
            const someOn   = grpPages.some(p=>form.permissions.includes(p.id));
            return (
              <div key={grp}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                  <button onClick={()=>toggleGroup(grpPages, allOn)}
                    style={{ width:18, height:18, borderRadius:4, border:`2px solid ${allOn?form.color:someOn?form.color:'var(--border)'}`, background:allOn?form.color:someOn?form.color+'44':'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    {allOn && <span style={{color:'#fff',fontSize:'0.6rem',fontWeight:900}}>✓</span>}
                    {someOn && !allOn && <span style={{color:'#fff',fontSize:'0.5rem',fontWeight:900}}>—</span>}
                  </button>
                  <span style={{ fontSize:'0.76rem', fontWeight:700, color:'var(--text2)' }}>{grp}</span>
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:7, paddingRight:26 }}>
                  {grpPages.map(p => {
                    const on = form.permissions.includes(p.id);
                    return (
                      <button key={p.id} onClick={()=>togglePerm(p.id)}
                        style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:8, fontSize:'0.76rem', fontWeight:600, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s',
                          border:`1.5px solid ${on?form.color:'var(--border)'}`,
                          background: on ? form.color+'22' : 'var(--surface)',
                          color:      on ? form.color       : 'var(--text2)',
                        }}>
                        <span style={{ width:14, height:14, borderRadius:3, border:`1.5px solid ${on?form.color:'var(--border)'}`, background:on?form.color:'transparent', display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          {on && <span style={{color:'#fff',fontSize:'0.5rem',fontWeight:900}}>✓</span>}
                        </span>
                        {p.icon} {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginTop:6 }}>
          {form.permissions.length} صلاحية من {SYSTEM_PAGES.length} محددة
        </div>
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, paddingTop:12, borderTop:'1px solid var(--border)' }}>
        <Button variant="secondary" onClick={onClose}>إلغاء</Button>
        <Button variant="primary" loading={loading} onClick={handleSave} style={{ background:form.color, borderColor:form.color }}>
          💾 {editId ? 'حفظ التعديلات' : 'إنشاء الدور'}
        </Button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
export default function UsersPage() {
  const addLog               = useAppStore((s) => s.addLog);
  const { currentUser, setTeachers, teachers } = useAuth();
  const toast = useToast();
  const { loading, run } = useErrorHandler(toast);

  // users/roles: PostgreSQL هو مصدر الحقيقة الوحيد الآن (Stabilization phase) — لا
  // يعودان من useAuth() بعد الآن، بل يُجلَبان مباشرة عبر pgGetUsers/pgGetRoles.
  // roles يبقى object مفهرَس بالـ id محلياً (نفس شكل الاستهلاك القديم في هذا الملف).
  const [users, setUsersState] = useState([]);
  const [roles, setRolesState] = useState({});

  const loadUsersAndRoles = useCallback(async () => {
    await run(async () => {
      const [userList, roleList] = await Promise.all([pgGetUsers(), pgGetRoles()]);
      setUsersState(userList);
      setRolesState(Object.fromEntries(roleList.map((r) => [r.id, r])));
    }, { errorMsg: 'فشل تحميل المستخدمين/الأدوار' });
  }, [run]);

  useEffect(() => { loadUsersAndRoles(); }, [loadUsersAndRoles]);

  const [view,     setView]    = useState('teachers');
  const [modal,    setModal]   = useState({ type:null, data:null });
  const [delModal, setDelModal]= useState({ open:false, item:null, what:'' });
  const [search,   setSearch]  = useState('');

  const closeModal = useCallback(() => setModal({ type:null, data:null }), []);
  const isAdmin    = currentUser?.isAdmin || currentUser?.role==='admin';

  // ── Teachers CRUD ─────────────────────────────────────────
  const filteredTeachers = useMemo(() => {
    const q = search.toLowerCase();
    return teachers.filter(t => !q || t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q) || t.phone.includes(q));
  }, [teachers, search]);

  const saveTeacher = useCallback(async (formData) => {
    await run(async () => {
      if (modal.data?.id) {
        const updated = updateTeacher(modal.data.id, formData);
        setTeachers(prev => prev.map(t => t.id===modal.data.id ? {...modal.data,...updated} : t));
        toast.success(`تم تعديل بيانات ${updated.name} ✓`);
      } else {
        const nt = createTeacher(formData);
        setTeachers(prev => [...prev, nt]);
        addLog({ action:'create', module:'users', entityType:'teacher', entityId:nt.id, description:`إضافة مدرس: ${nt.name}` })
          .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
        toast.success(`تمت إضافة ${nt.name} ✓`);
      }
      closeModal();
    }, { errorMsg:'فشل حفظ بيانات المدرس' });
  }, [modal, setTeachers, run, toast, addLog, currentUser, closeModal]);

  const deleteTeacher = useCallback(async () => {
    const tc = delModal.item;
    await run(async () => {
      setTeachers(prev => prev.filter(t=>t.id!==tc.id));
      // لا حاجة لإلغاء ربط أي مستخدم — حسابات PostgreSQL لا تحمل teacherId إطلاقاً
      // (Teachers domain خارج نطاق هذه المرحلة، انظر التعليق أعلى الملف).
      toast.info(`تم حذف ${tc.name}`);
      setDelModal({open:false,item:null,what:''});
    }, { errorMsg:'فشل حذف المدرس' });
  }, [delModal.item, setTeachers, run, toast]);

  // ── Users CRUD ────────────────────────────────────────────
  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter(u => !q || u.name.toLowerCase().includes(q) || u.id.includes(q));
  }, [users, search]);

  const saveUser = useCallback(async (formData) => {
    await run(async () => {
      // تعديل الحساب الخاص بالمستخدم الحالي: الدور يبقى admin دائماً بغض النظر عن قيمة الفورم
      // (حماية ضد التلاعب بالقيمة المُرسَلة — الواجهة تعطّل الحقل لكن هذا هو الضمان الفعلي
      // على العميل؛ الخادم نفسه يرفض أيضاً ترك النظام بلا مدير نشط واحد على الأقل).
      // ملاحظة: teacherId لا يُرسَل أبداً لمسارات users الجديدة — عمود teacher_id بالخادم
      // يشير لجدول teachers الحقيقي الفارغ حالياً (Teachers domain خارج النطاق).
      if (modal.data?.id) {
        const isSelfSave = modal.data.id === currentUser?.id;
        const payload = {
          name:   formData.name.trim(),
          roleId: isSelfSave ? 'admin' : formData.roleId,
          email:  formData.email?.trim() || '',
          active: formData.active !== false,
        };
        if (formData.password?.trim()) payload.password = formData.password.trim();
        const updated = await pgUpdateUser(modal.data.id, payload);
        setUsersState(prev => prev.map(u => u.id === modal.data.id ? updated : u));
        // ربط المدرّس محلي بحت — على سجل teacher نفسه فقط، لا على حساب المستخدم.
        if (formData.teacherId) {
          setTeachers(prev => prev.map(t => t.id===formData.teacherId ? {...t, userId:modal.data.id} : t));
        }
        toast.success('تم تعديل الحساب ✓');
      } else {
        const nu = await pgCreateUser({
          id: formData.id.trim(),
          name: formData.name.trim(),
          roleId: formData.roleId,
          email: formData.email?.trim() || '',
          active: formData.active !== false,
          password: formData.password.trim(),
        });
        setUsersState(prev => [...prev, nu]);
        if (formData.teacherId) {
          setTeachers(prev => prev.map(t => t.id===formData.teacherId ? {...t, userId:nu.id} : t));
        }
        addLog({ action:'create', module:'users', entityType:'user', entityId:nu.id, description:`إنشاء حساب: ${nu.name} (${nu.roleId})` })
          .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
        toast.success(`تم إنشاء حساب ${nu.name} ✓`);
      }
      closeModal();
    }, { errorMsg:'فشل حفظ حسابات المستخدمين' });
  }, [modal, setTeachers, run, toast, addLog, currentUser, closeModal]);

  const toggleUserActive = useCallback((user) => {
    run(async () => {
      const updated = await pgUpdateUser(user.id, { active: !user.active });
      setUsersState(prev => prev.map(u => u.id === user.id ? updated : u));
      toast.info(`${user.name}: ${user.active ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب'}`);
    }, { errorMsg: 'فشل تعديل حالة الحساب' });
  }, [run, toast]);

  // ── Roles CRUD ────────────────────────────────────────────
  const saveRole = useCallback(async (formData) => {
    await run(async () => {
      const payload = {
        label:       formData.label.trim(),
        color:       formData.color,
        description: formData.description?.trim() || '',
        permissions: formData.permissions,
      };
      const roleData = modal.data?.id
        ? await pgUpdateRole(modal.data.id, payload)
        : await pgCreateRole({ id: formData.id.trim(), ...payload });
      setRolesState(prev => ({ ...prev, [roleData.id]: roleData }));
      addLog({ action:'create', module:'users', entityType:'role', entityId:roleData.id, description:`حفظ دور: ${roleData.label}` })
        .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
      toast.success(`تم حفظ الدور "${roleData.label}" ✓`);
      closeModal();
    }, { errorMsg:'فشل حفظ الدور' });
  }, [modal, run, toast, addLog, currentUser, closeModal]);

  const deleteRole = useCallback(async () => {
    const role = delModal.item;
    if (role.isSystem) { toast.error('لا يمكن حذف الأدوار الأساسية'); setDelModal({open:false,item:null,what:''}); return; }
    await run(async () => {
      await pgDeleteRole(role.id);
      setRolesState(prev => { const n={...prev}; delete n[role.id]; return n; });
      toast.info(`تم حذف الدور "${role.label}"`);
      setDelModal({open:false,item:null,what:''});
    }, { errorMsg:'فشل حذف الدور' });
  }, [delModal.item, run, toast]);

  const deleteUser = useCallback(async () => {
    const u = delModal.item;
    await run(async () => {
      await pgDeleteUser(u.id);
      setUsersState(prev => prev.filter(x => x.id !== u.id));
      toast.info('تم حذف الحساب');
      setDelModal({open:false,item:null,what:''});
    }, { errorMsg:'فشل حذف الحساب' });
  }, [delModal.item, run, toast]);

  const SEL = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 10px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' };

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:14, padding:'0 28px', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:'1.35rem', fontWeight:800, letterSpacing:'-0.3px', marginBottom:3 }}>إدارة المستخدمين والصلاحيات</h1>
          <p style={{ fontSize:'0.78rem', color:'var(--text3)' }}>
            {teachers.length} مدرس · {users.length} مستخدم · {Object.keys(roles).length} أدوار
          </p>
        </div>
        {isAdmin && (
          <Button variant="primary" size="sm" onClick={() => setModal({ type:`add_${view}`, data:null })}>
            + إضافة {view==='teachers'?'مدرس':view==='users'?'مستخدم':'دور'}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:2, padding:'0 28px', marginBottom:20 }}>
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => { setView(v.id); setSearch(''); }}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 18px', borderRadius:10, fontSize:'0.88rem', fontWeight:view===v.id?700:500, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .15s', border:`1.5px solid ${view===v.id?'var(--accent)':'var(--border)'}`, background:view===v.id?'rgba(13,148,136,.1)':'transparent', color:view===v.id?'var(--accent)':'var(--text2)' }}
            onMouseOver={e => { if(view!==v.id){e.currentTarget.style.background='var(--surface2)';e.currentTarget.style.color='var(--text)';} }}
            onMouseOut={e  => { if(view!==v.id){e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text2)';} }}
          >
            <span>{v.icon}</span>{v.label}
          </button>
        ))}
      </div>

      <div style={{ padding:'0 28px 40px', animation:'pageIn .2s ease' }}>

        {/* Search bar (teachers + users) */}
        {view !== 'roles' && (
          <div style={{ display:'flex', alignItems:'center', gap:8, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'0 12px', marginBottom:16, maxWidth:380 }}
            onFocusCapture={e=>e.currentTarget.style.borderColor='var(--accent)'}
            onBlurCapture={e =>e.currentTarget.style.borderColor='var(--border)'}
          >
            <span style={{ color:'var(--text3)' }}>🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={view==='teachers'?'بحث بالاسم أو المادة...':'بحث بالاسم أو ID...'}
              style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.85rem', padding:'8px 0', direction:'rtl' }}/>
            {search && <button onClick={()=>setSearch('')} style={{color:'var(--text3)',cursor:'pointer'}}>×</button>}
          </div>
        )}

        <SectionBoundary label={`users:${view}`}>

          {/* ── TEACHERS ─────────────────────── */}
          {view === 'teachers' && (
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
                  <thead>
                    <tr style={{ background:'var(--surface2)' }}>
                      {['المدرس','المادة','رقم الهاتف','البريد','تاريخ التعيين','الحالة','حساب',''].map(h=>(
                        <th key={h} style={{ padding:'10px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTeachers.length===0 ? (
                      <tr><td colSpan={8} style={{ padding:'40px', textAlign:'center', color:'var(--text3)' }}>
                        <div style={{ fontSize:36, opacity:.3, marginBottom:8 }}>👨‍🏫</div>لا يوجد مدرسون
                      </td></tr>
                    ) : filteredTeachers.map(tc => {
                      const { bg, color } = av(tc.name);
                      const letters = tc.name.split(' ').map(w=>w[0]).slice(0,2).join('');
                      const user = users.find(u=>u.id===tc.userId);
                      return (
                        <tr key={tc.id} style={{ transition:'background .12s' }}
                          onMouseOver={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--surface2)')}
                          onMouseOut={e =>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}
                        >
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                              <div style={{ width:34, height:34, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.78rem', fontWeight:700, flexShrink:0 }}>{letters}</div>
                              <div>
                                <div style={{ fontWeight:700 }}>{tc.name}</div>
                                {tc.address && <div style={{ fontSize:'0.68rem', color:'var(--text3)' }}>📍 {tc.address}</div>}
                              </div>
                            </div>
                          </td>
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>{tc.subject}</td>
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', fontSize:'0.78rem' }}>{tc.phone}</td>
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.72rem', color:'var(--text3)' }}>{tc.email||'—'}</td>
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text3)' }}>{formatDate(tc.hireDate)}</td>
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                            <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:700,
                              background:tc.status==='active'?'rgba(16,185,129,.1)':'rgba(239,68,68,.1)',
                              color:tc.status==='active'?'#10b981':'#ef4444',
                              border:`1px solid ${tc.status==='active'?'rgba(16,185,129,.2)':'rgba(239,68,68,.2)'}`,
                            }}>{tc.status==='active'?'✓ نشط':'✗ غير نشط'}</span>
                          </td>
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                            {user ? (
                              <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:700, background:'rgba(13,148,136,.1)', color:'var(--accent)', border:'1px solid rgba(13,148,136,.2)' }}>
                                🔑 {user.id}
                              </span>
                            ) : isAdmin ? (
                              <button onClick={()=>setModal({type:'add_users', data:{teacherId:tc.id, name:tc.name, email:tc.email}})}
                                style={{ padding:'3px 10px', borderRadius:7, border:'1px dashed var(--border)', background:'transparent', fontSize:'0.68rem', color:'var(--text3)', cursor:'pointer', fontFamily:'Cairo,sans-serif' }}
                                onMouseOver={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--accent)';}}
                                onMouseOut={e =>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text3)';}}>
                                + إنشاء حساب
                              </button>
                            ) : <span style={{color:'var(--text3)',fontSize:'0.72rem'}}>—</span>}
                          </td>
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                            {isAdmin && <div style={{ display:'flex', gap:4 }}>
                              <button onClick={()=>setModal({type:'edit_teachers',data:tc})} style={{ padding:'3px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.72rem', cursor:'pointer', color:'var(--text2)' }} onMouseOver={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--accent)';}} onMouseOut={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text2)';}}>✎</button>
                              <button onClick={()=>setDelModal({open:true,item:tc,what:'teacher'})} style={{ padding:'3px 8px', borderRadius:6, border:'1px solid rgba(239,68,68,.2)', background:'rgba(239,68,68,.06)', fontSize:'0.72rem', cursor:'pointer', color:'var(--red)' }} onMouseOver={e=>{e.currentTarget.style.background='var(--red)';e.currentTarget.style.color='#fff';}} onMouseOut={e=>{e.currentTarget.style.background='rgba(239,68,68,.06)';e.currentTarget.style.color='var(--red)';}}>🗑</button>
                            </div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── USERS ────────────────────────── */}
          {view === 'users' && (
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
                  <thead>
                    <tr style={{ background:'var(--surface2)' }}>
                      {['المستخدم','اسم الدخول','الدور','البريد','آخر دخول','الحالة',''].map(h=>(
                        <th key={h} style={{ padding:'10px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map(u => {
                      const { bg, color } = av(u.name);
                      const letters = u.name.split(' ').map(w=>w[0]).slice(0,2).join('');
                      const roleInfo = roles[u.roleId] || { label:u.roleId, color:'var(--text3)' };
                      const isSelf   = u.id === currentUser?.id;
                      return (
                        <tr key={u.id} style={{ transition:'background .12s' }}
                          onMouseOver={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--surface2)')}
                          onMouseOut={e =>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}
                        >
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                              <div style={{ width:34, height:34, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.78rem', fontWeight:700, flexShrink:0 }}>{letters}</div>
                              <div style={{ fontWeight:700 }}>{u.name}{isSelf&&<span style={{fontSize:'0.62rem',color:'var(--accent)',marginRight:4}}>(أنت)</span>}</div>
                            </div>
                          </td>
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', fontSize:'0.78rem', color:'var(--accent)', fontWeight:700 }}>{u.id}</td>
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                            <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:99, fontSize:'0.72rem', fontWeight:700, background:`${roleInfo.color}18`, color:roleInfo.color, border:`1px solid ${roleInfo.color}30` }}>{roleInfo.label}</span>
                          </td>
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.76rem', color:'var(--text3)' }}>{u.email||'—'}</td>
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.72rem', color:'var(--text3)' }}>
                            {u.lastLogin ? formatDate(u.lastLogin.split('T')[0], {month:'short',day:'numeric'}) : '—'}
                          </td>
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                            {isAdmin && !isSelf ? (
                              <button onClick={()=>toggleUserActive(u)}
                                style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:99, fontSize:'0.68rem', fontWeight:700, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s',
                                  background:u.active?'rgba(16,185,129,.1)':'rgba(239,68,68,.1)',
                                  color:u.active?'#10b981':'#ef4444',
                                  border:`1px solid ${u.active?'rgba(16,185,129,.2)':'rgba(239,68,68,.2)'}`,
                                }}>
                                {u.active?'✓ نشط':'✗ معطّل'}
                              </button>
                            ) : (
                              <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:99, fontSize:'0.68rem', fontWeight:700,
                                background:u.active?'rgba(16,185,129,.1)':'rgba(239,68,68,.1)',
                                color:u.active?'#10b981':'#ef4444',
                              }}>{u.active?'✓ نشط':'✗ معطّل'}</span>
                            )}
                          </td>
                          <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                            {isAdmin && <div style={{ display:'flex', gap:4 }}>
                              <button onClick={()=>setModal({type:'edit_users',data:u})} style={{ padding:'3px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.72rem', cursor:'pointer', color:'var(--text2)' }} onMouseOver={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--accent)';}} onMouseOut={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text2)';}}>✎</button>
                              {u.roleId !== 'admin' && !isSelf && <button onClick={()=>setDelModal({open:true,item:u,what:'user'})} style={{ padding:'3px 8px', borderRadius:6, border:'1px solid rgba(239,68,68,.2)', background:'rgba(239,68,68,.06)', fontSize:'0.72rem', cursor:'pointer', color:'var(--red)' }} onMouseOver={e=>{e.currentTarget.style.background='var(--red)';e.currentTarget.style.color='#fff';}} onMouseOut={e=>{e.currentTarget.style.background='rgba(239,68,68,.06)';e.currentTarget.style.color='var(--red)';}}>🗑</button>}
                            </div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── ROLES ────────────────────────── */}
          {view === 'roles' && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:16 }}>
              {Object.values(roles).map(role => {
                const pages = SYSTEM_PAGES.filter(p => role.permissions===null || role.permissions.includes(p.id));
                const usersWithRole = users.filter(u=>u.roleId===role.id).length;
                return (
                  <div key={role.id} style={{ background:'var(--surface)', border:`1px solid var(--border)`, borderRadius:14, overflow:'hidden', transition:'transform .12s, box-shadow .12s' }}
                    onMouseOver={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 6px 24px rgba(0,0,0,.2)';}}
                    onMouseOut={e =>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow='';}}
                  >
                    <div style={{ height:4, background:role.color }}/>
                    <div style={{ padding:'16px 18px' }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ width:38, height:38, borderRadius:10, background:`${role.color}20`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.2rem' }}>🛡</div>
                          <div>
                            <div style={{ fontWeight:800, fontSize:'0.95rem' }}>{role.label}</div>
                            <div style={{ fontSize:'0.68rem', fontFamily:'Cairo,sans-serif', color:'var(--text3)' }}>{role.id}</div>
                          </div>
                        </div>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:700, background:`${role.color}18`, color:role.color, border:`1px solid ${role.color}30` }}>
                          👤 {usersWithRole}
                        </span>
                      </div>
                      {role.description && <div style={{ fontSize:'0.75rem', color:'var(--text3)', marginBottom:10 }}>{role.description}</div>}
                      {role.permissions === null ? (
                        <div style={{ fontSize:'0.72rem', color:role.color, fontWeight:700, marginBottom:10 }}>🔓 صلاحيات كاملة</div>
                      ) : (
                        <div style={{ marginBottom:10 }}>
                          <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginBottom:6 }}>{pages.length} صلاحية</div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                            {pages.slice(0,8).map(p=>(
                              <span key={p.id} style={{ fontSize:'0.62rem', padding:'2px 7px', borderRadius:5, background:`${role.color}15`, color:role.color, fontWeight:600 }}>
                                {p.icon} {p.label}
                              </span>
                            ))}
                            {pages.length > 8 && <span style={{ fontSize:'0.62rem', color:'var(--text3)', padding:'2px 5px' }}>+{pages.length-8}</span>}
                          </div>
                        </div>
                      )}
                      {isAdmin && (
                        <div style={{ display:'flex', gap:6, paddingTop:10, borderTop:'1px solid var(--border)' }}>
                          {!role.isSystem && (
                            <Button variant="ghost" size="xs" onClick={()=>setModal({type:'edit_roles', data:{...role, permissions:role.permissions||[]}})} style={{ flex:1 }}>
                              ✎ تعديل
                            </Button>
                          )}
                          {!role.isSystem && (
                            <Button variant="danger" size="xs" onClick={()=>setDelModal({open:true,item:role,what:'role'})}>
                              🗑
                            </Button>
                          )}
                          {role.isSystem && <span style={{ fontSize:'0.68rem', color:'var(--text3)', paddingTop:4 }}>دور أساسي — محمي</span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </SectionBoundary>
      </div>

      {/* ── Modals ─────────────────────────── */}
      {/* Teacher form */}
      <Modal isOpen={modal.type==='add_teachers'||modal.type==='edit_teachers'} onClose={closeModal}
        title={modal.type==='edit_teachers'?`تعديل — ${modal.data?.name}`:'إضافة مدرس جديد'} size="md">
        <TeacherForm initial={modal.data} editId={modal.data?.id} onSave={saveTeacher} onClose={closeModal} loading={loading}/>
      </Modal>

      {/* User form */}
      <Modal isOpen={modal.type==='add_users'||modal.type==='edit_users'} onClose={closeModal}
        title={modal.type==='edit_users'?`تعديل حساب — ${modal.data?.name}`:'إنشاء حساب مستخدم'} size="md">
        <UserForm initial={modal.data} editId={modal.data?.id} onSave={saveUser} onClose={closeModal} loading={loading} roles={roles} teachers={teachers} users={users}/>
      </Modal>

      {/* Role form */}
      <Modal isOpen={modal.type==='add_roles'||modal.type==='edit_roles'} onClose={closeModal}
        title={modal.type==='edit_roles'?`تعديل دور — ${modal.data?.label}`:'إنشاء دور جديد'} size="lg">
        <RoleForm initial={modal.data} editId={modal.data?.id} onSave={saveRole} onClose={closeModal} loading={loading}/>
      </Modal>

      {/* Delete confirm */}
      <ConfirmModal isOpen={delModal.open} onClose={()=>setDelModal({open:false,item:null,what:''})}
        onConfirm={delModal.what==='teacher'?deleteTeacher:delModal.what==='role'?deleteRole:deleteUser}
        loading={loading} title="تأكيد الحذف"
        message={`هل أنت متأكد من حذف "${delModal.item?.name||delModal.item?.label}"؟`}
        confirmLabel="نعم، احذف"/>
    </div>
  );
}
