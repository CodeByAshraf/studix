// src/modules/groups/GroupStudents.jsx
// Panel showing students in a group + transfer modal
import { useAppStore } from '../../store/app.store';
import { useAuth }     from '../../store/auth.context';
import { useState, useMemo, useCallback, useRef } from 'react';
import { useToast }  from '../../components/Toast';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import Button        from '../../components/ui/Button';
import { formatDate } from '../../utils/helpers';
import { updateStudent } from '../../services/studentService';
import { pgUpdateStudent } from '../../services/api';
import { useAvatarStyle } from '../students/components/StudentAvatar';
import StatusBadge   from '../students/components/StatusBadge';
import { formatCurrency } from '../../utils/helpers';

// ── Single student row ───────────────────────────────────────
function StudentRow({ student, onSelect, selected, payments }) {
  const { bg, color } = useAvatarStyle(student.name);
  const letters = student.name.split(' ').map(w => w[0]).slice(0, 2).join('');

  const lastPayment = useMemo(() => {
    const recs = payments.filter(p => p.studentId === student.id).sort((a, b) => b.date.localeCompare(a.date));
    return recs[0] || null;
  }, [payments, student.id]);

  return (
    <div
      onClick={() => onSelect?.(student.id)}
      style={{
        display:'flex', alignItems:'center', gap:12,
        padding:'11px 16px',
        borderBottom:'1px solid var(--border)',
        cursor: onSelect ? 'pointer' : 'default',
        background: selected ? 'rgba(13,148,136,.06)' : 'transparent',
        borderRight: selected ? '3px solid var(--accent)' : '3px solid transparent',
        transition:'all .12s',
      }}
      onMouseOver={e  => { if (!selected) e.currentTarget.style.background='var(--surface2)'; }}
      onMouseOut={e   => { if (!selected) e.currentTarget.style.background='transparent'; }}
    >
      {/* Checkbox */}
      {onSelect && (
        <div style={{
          width:18, height:18, borderRadius:5, border:`2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
          background: selected ? 'var(--accent)' : 'transparent',
          display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all .12s',
        }}>
          {selected && <span style={{ color:'var(--surface)', fontSize:'0.65rem', fontWeight:900 }}>✓</span>}
        </div>
      )}

      {/* Avatar */}
      <div style={{ width:34, height:34, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.78rem', fontWeight:700, flexShrink:0 }}>
        {letters}
      </div>

      {/* Info */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontWeight:600, fontSize:'0.88rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {student.name}
        </div>
        <div style={{ fontSize:'0.7rem', color:'var(--text3)', display:'flex', gap:10, marginTop:1 }}>
          <span style={{ fontFamily:'Cairo,sans-serif' }}>{student.code}</span>
          <span>{student.grade}</span>
        </div>
      </div>

      {/* Last payment */}
      <div style={{ textAlign:'left', flexShrink:0 }}>
        {lastPayment ? (
          <>
            <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--green)', fontFamily:'Cairo,sans-serif' }}>
              {formatCurrency(lastPayment.amount)}
            </div>
            <div style={{ fontSize:'0.65rem', color:'var(--text3)' }}>
              {formatDate(lastPayment.date, { month:'short', day:'numeric' })}
            </div>
          </>
        ) : (
          <div style={{ fontSize:'0.68rem', color:'var(--text3)' }}>لا دفعات</div>
        )}
      </div>

      <StatusBadge status={student.status} size="sm"/>
    </div>
  );
}

// ── Transfer modal ───────────────────────────────────────────
function TransferModal({ group, onClose }) {
  const groups               = useAppStore((s) => s.groups);
  const payments             = useAppStore((s) => s.payments);
  const setStudents          = useAppStore((s) => s.setStudents);
  const students             = useAppStore((s) => s.students);
  const addLog                = useAppStore((s) => s.addLog);
  const toast = useToast();
  const { loading, run } = useErrorHandler(toast);
  const [selected,   setSelected]   = useState([]);
  const [targetGroup,setTargetGroup]= useState('');

  // نغلق عند الضغط على الخلفية فقط إذا بدأت الضغطة وانتهت عليها، حتى لا يؤدي
  // تحديد نص داخل النافذة وسحب الماوس للخارج إلى إغلاقها.
  const downOnBackdrop = useRef(false);

  const groupStudents = students.filter(s => s.groupId === group.id);
  const otherGroups   = groups.filter(g => g.id !== group.id);

  const toggle = useCallback((id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const selectAll  = () => setSelected(groupStudents.map(s => s.id));
  const clearAll   = () => setSelected([]);

  // Product Completion Phase 2 — Finding 1: نقل حقيقي عبر الخادم (PUT /api/students/:id
  // لكل طالب محدَّد)، بنفس نمط StudentsPage.jsx's handleSave (updateStudent يتحقّق، ثم
  // pgUpdateStudent يكتب فعلياً). لا تعديل محلي إلا بعد رد الخادم — نجاح جزئي يُطبَّق فقط
  // على من نجح فعلاً، ويبقى الفاشلون محدَّدين لإعادة المحاولة والنافذة مفتوحة.
  const handleTransfer = async () => {
    if (!selected.length) { toast.warning('اختر طالباً واحداً على الأقل'); return; }
    if (!targetGroup)     { toast.warning('اختر المجموعة المستهدفة');      return; }

    const targetName = groups.find(g => g.id === targetGroup)?.name;
    const targets     = students.filter(s => selected.includes(s.id));

    await run(async () => {
      const results = await Promise.allSettled(
        targets.map(async (s) => {
          const updated = updateStudent(s.id, { ...s, groupId: targetGroup }, students);
          return pgUpdateStudent(s.id, updated);
        })
      );

      const succeeded = [];
      const failed     = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') succeeded.push(r.value);
        else failed.push({ student: targets[i], error: r.reason });
      });

      if (succeeded.length) {
        setStudents(prev => prev.map(s => succeeded.find(x => x.id === s.id) || s));
        succeeded.forEach((saved) => {
          addLog({ action:'update', module:'groups', entityType:'student', entityId:saved.id, description:`نقل: ${saved.name} إلى "${targetName}"` })
            .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
        });
      }

      if (failed.length && !succeeded.length) {
        // فشل كامل — لا تعديل محلي إطلاقاً، رسالة الخطأ العامة في run() تكفي
        throw failed[0].error;
      }

      if (failed.length) {
        setSelected(failed.map(f => f.student.id));
        toast.error(`تم نقل ${succeeded.length} وفشل نقل ${failed.length} — حاول مجدداً للطلاب المتبقين`);
      } else {
        toast.success(`تم نقل ${succeeded.length} طالب إلى "${targetName}" ✓`);
        onClose();
      }
    }, { errorMsg: 'فشل نقل الطلاب' });
  };

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.55)',
      zIndex:500, display:'flex', alignItems:'center', justifyContent:'center',
      padding:20, backdropFilter:'blur(4px)', direction:'rtl',
    }}
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onMouseUp={e => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
        downOnBackdrop.current = false;
      }}>
      <div style={{
        background:'var(--surface)', border:'1px solid var(--border)',
        borderRadius:16, width:'100%', maxWidth:520, maxHeight:'85vh',
        display:'flex', flexDirection:'column', overflow:'hidden',
        animation:'modalIn .2s ease',
        boxShadow:'0 20px 60px rgba(0,0,0,.4)',
      }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:'1px solid var(--border)' }}>
          <div style={{ fontSize:'1rem', fontWeight:800 }}>⇄ نقل طلاب</div>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', background:'var(--surface2)', color:'var(--text3)', fontSize:'1.1rem', border:'none', cursor:'pointer' }}>×</button>
        </div>

        {/* Target group selector */}
        <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', background:'var(--surface2)' }}>
          <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:7 }}>
            نقل إلى المجموعة
          </div>
          <select value={targetGroup} onChange={e => setTargetGroup(e.target.value)}
            style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:9, padding:'9px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.875rem', outline:'none', direction:'rtl', cursor:'pointer' }}
            onFocus={e  => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.12)'; }}
            onBlur={e   => { e.target.style.borderColor='var(--border)'; e.target.style.boxShadow='none'; }}
          >
            <option value="">اختر المجموعة المستهدفة...</option>
            {otherGroups.map(g => (
              <option key={g.id} value={g.id}>{g.name} — {g.grade}</option>
            ))}
          </select>
        </div>

        {/* Students list */}
        <div style={{ padding:'10px 20px 6px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--text2)' }}>
            طلاب {group.name}
            <span style={{ marginRight:6, background:'var(--surface3)', color:'var(--text3)', fontSize:'0.62rem', padding:'1px 7px', borderRadius:99, fontFamily:'Cairo,sans-serif' }}>
              {groupStudents.length}
            </span>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {selected.length < groupStudents.length
              ? <button onClick={selectAll}  style={{ fontSize:'0.72rem', color:'var(--accent)', fontWeight:600, cursor:'pointer', border:'none', background:'none', fontFamily:'Cairo,sans-serif' }}>تحديد الكل</button>
              : <button onClick={clearAll}   style={{ fontSize:'0.72rem', color:'var(--text3)', fontWeight:600, cursor:'pointer', border:'none', background:'none', fontFamily:'Cairo,sans-serif' }}>إلغاء التحديد</button>
            }
          </div>
        </div>

        <div style={{ flex:1, overflowY:'auto', minHeight:0 }}>
          {groupStudents.length === 0 ? (
            <div style={{ textAlign:'center', padding:'32px', color:'var(--text3)', fontSize:'0.85rem' }}>لا يوجد طلاب في هذه المجموعة</div>
          ) : (
            groupStudents.map(s => (
              <StudentRow key={s.id} student={s} onSelect={toggle} selected={selected.includes(s.id)} payments={[]}/>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 20px', borderTop:'1px solid var(--border)' }}>
          <div style={{ fontSize:'0.78rem', color:'var(--text3)' }}>
            {selected.length > 0 ? (
              <span style={{ color:'var(--accent)', fontWeight:700 }}>{selected.length} طالب محدد</span>
            ) : 'لم يُحدد أي طالب'}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Button variant="secondary" size="sm" onClick={onClose}>إلغاء</Button>
            <Button variant="primary" size="sm" loading={loading} onClick={handleTransfer}
              disabled={!selected.length || !targetGroup}
            >
              ⇄ نقل {selected.length > 0 ? `(${selected.length})` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────
export default function GroupStudents({ group, onClose, onTransferOpen }) {
  const groups               = useAppStore((s) => s.groups);
  const payments             = useAppStore((s) => s.payments);
  const setStudents          = useAppStore((s) => s.setStudents);
  const students             = useAppStore((s) => s.students);
  const [search, setSearch] = useState('');

  const groupStudents = useMemo(() => {
    const q = search.toLowerCase();
    return students
      .filter(s => s.groupId === group.id)
      .filter(s => !q || s.name.toLowerCase().includes(q) || s.code?.toLowerCase().includes(q));
  }, [students, group.id, search]);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:400 }}>
      {/* Search */}
      <div style={{ padding:'12px 0 8px', display:'flex', gap:8 }}>
        <div style={{ flex:1, display:'flex', alignItems:'center', gap:8, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'0 12px' }}
          onFocusCapture={e => e.currentTarget.style.borderColor='var(--accent)'}
          onBlurCapture={e  => e.currentTarget.style.borderColor='var(--border)'}
        >
          <span style={{ color:'var(--text3)' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث في طلاب المجموعة..."
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', padding:'8px 0', direction:'rtl' }}/>
        </div>
        <Button variant="primary" size="sm" onClick={onTransferOpen}>⇄ نقل طلاب</Button>
      </div>

      {/* List */}
      <div style={{ border:'1px solid var(--border)', borderRadius:12, overflow:'hidden', flex:1 }}>
        <div style={{ padding:'10px 16px 6px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em' }}>الطلاب</span>
          <span style={{ fontSize:'0.7rem', fontFamily:'Cairo,sans-serif', color:'var(--text3)' }}>
            {groupStudents.length} / {group.max} (الأقصى)
          </span>
        </div>
        {groupStudents.length === 0 ? (
          <div style={{ textAlign:'center', padding:'40px', color:'var(--text3)', fontSize:'0.85rem' }}>
            {search ? 'لا توجد نتائج' : 'لا يوجد طلاب في هذه المجموعة'}
          </div>
        ) : (
          groupStudents.map(s => (
            <StudentRow key={s.id} student={s} payments={payments}/>
          ))
        )}
      </div>
    </div>
  );
}

export { TransferModal };
