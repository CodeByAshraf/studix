// src/modules/homework/HomeworkTracking.jsx
// Track submission status for every student in a group for a given homework
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { useToast } from '../../components/Toast';
import Button       from '../../components/ui/Button';
import { SUB_STATUS } from '../../services/homeworkService';
import { pgSaveHwSubmissions } from '../../services/api';
import { formatDate } from '../../utils/helpers';

const AV_PAL = [
  {bg:'rgba(59,130,246,.18)',color:'#3b82f6'},{bg:'rgba(16,185,129,.18)',color:'#10b981'},
  {bg:'rgba(245,158,11,.18)',color:'#f59e0b'},{bg:'rgba(139,92,246,.18)',color:'#8b5cf6'},
  {bg:'rgba(239,68,68,.18)', color:'#ef4444'},{bg:'rgba(6,182,212,.18)', color:'#06b6d4'},
];
const av = n => AV_PAL[((n.charCodeAt(0)||0)+(n.charCodeAt(1)||0))%AV_PAL.length];

// ── Single student row ───────────────────────────────────────
function StudentRow({ student, sub, hw, onChange }) {
  const { bg, color } = av(student.name);
  const letters = student.name.split(' ').map(w=>w[0]).slice(0,2).join('');
  const meta = SUB_STATUS[sub?.status || 'missing'];

  const [localScore, setLocalScore] = useState(sub?.score ?? '');
  const [localNotes, setLocalNotes] = useState(sub?.notes || '');

  const handleStatusChange = (status) => {
    const clamped = localScore !== '' ? Math.min(Math.max(0, Number(localScore)), hw.totalScore || Infinity) : null;
    onChange(student.id, {
      status,
      submittedAt: status === 'missing' ? null : sub?.submittedAt || new Date().toISOString().split('T')[0],
      score: clamped,
      notes: localNotes,
    });
  };

  const handleScoreBlur = () => {
    if (sub && localScore !== '') {
      // نفس نمط GradeEntry — تثبيت محلي بلا اعتماد على max HTML وحده (لا يُفرَض بشكل
      // موثوق في كل المتصفحات)، والخادم يُعيد التحقّق من total_score الفعلي دائماً.
      const clamped = Math.min(Math.max(0, Number(localScore)), hw.totalScore || Infinity);
      onChange(student.id, { ...sub, score: clamped });
    }
  };

  const handleNotesBlur = () => {
    if (sub) onChange(student.id, { ...sub, notes: localNotes });
  };

  return (
    <tr style={{ transition:'background .12s' }}
      onMouseOver={e  => Array.from(e.currentTarget.cells).forEach(td => td.style.background='var(--surface2)')}
      onMouseOut={e   => Array.from(e.currentTarget.cells).forEach(td => td.style.background='')}
    >
      {/* الطالب */}
      <td style={{ padding:'11px 16px', borderBottom:'1px solid var(--border)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.72rem', fontWeight:700, flexShrink:0 }}>{letters}</div>
          <div>
            <div style={{ fontWeight:600, fontSize:'0.88rem' }}>{student.name}</div>
            <div style={{ fontSize:'0.68rem', color:'var(--text3)', fontFamily:'Cairo,sans-serif' }}>{student.code}</div>
          </div>
        </div>
      </td>

      {/* الحالة */}
      <td style={{ padding:'11px 16px', borderBottom:'1px solid var(--border)' }}>
        <div style={{ display:'flex', gap:5 }}>
          {Object.entries(SUB_STATUS).map(([key, m]) => (
            <button key={key}
              onClick={() => handleStatusChange(key)}
              style={{
                padding:'4px 10px', borderRadius:7, fontSize:'0.72rem', fontWeight:700,
                cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s',
                border:`1.5px solid ${sub?.status===key ? m.border : 'var(--border)'}`,
                background: sub?.status===key ? m.bg : 'transparent',
                color:      sub?.status===key ? m.color : 'var(--text3)',
              }}
              onMouseOver={e => { if(sub?.status!==key) { e.currentTarget.style.background=m.bg; e.currentTarget.style.color=m.color; e.currentTarget.style.borderColor=m.border; }}}
              onMouseOut={e  => { if(sub?.status!==key) { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--text3)'; e.currentTarget.style.borderColor='var(--border)'; }}}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>
      </td>

      {/* تاريخ التسليم */}
      <td style={{ padding:'11px 16px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text3)' }}>
        {sub?.submittedAt ? formatDate(sub.submittedAt, {month:'short',day:'numeric'}) : '—'}
      </td>

      {/* الدرجة */}
      <td style={{ padding:'11px 16px', borderBottom:'1px solid var(--border)' }}>
        {sub?.status !== 'missing' && hw.totalScore ? (
          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
            <input type="number" min="0" max={hw.totalScore}
              value={localScore}
              onChange={e => setLocalScore(e.target.value)}
              placeholder="—"
              style={{ width:52, padding:'5px 8px', textAlign:'center', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:7, color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.85rem', fontWeight:700, outline:'none' }}
              onFocus={e => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.1)'; }}
              onBlur={e => { e.target.style.borderColor='var(--border)'; e.target.style.boxShadow='none'; handleScoreBlur(); }}
            />
            <span style={{ fontSize:'0.72rem', color:'var(--text3)' }}>/ {hw.totalScore}</span>
          </div>
        ) : <span style={{ color:'var(--text3)', fontSize:'0.75rem' }}>—</span>}
      </td>

      {/* ملاحظات */}
      <td style={{ padding:'11px 16px', borderBottom:'1px solid var(--border)' }}>
        <input type="text"
          value={localNotes}
          onChange={e => setLocalNotes(e.target.value)}
          placeholder="ملاحظة..."
          style={{ width:'100%', minWidth:100, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:7, padding:'5px 8px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.75rem', outline:'none', direction:'rtl' }}
          onFocus={e => e.target.style.borderColor='var(--accent)'}
          onBlur={e => { e.target.style.borderColor='var(--border)'; handleNotesBlur(); }}
        />
      </td>
    </tr>
  );
}

// ── Main tracking component ──────────────────────────────────
export default function HomeworkTracking({ hw, onClose }) {
  const groups               = useAppStore((s) => s.groups);
  const hwSubmissions        = useAppStore((s) => s.hwSubmissions);
  const setHwSubmissions     = useAppStore((s) => s.setHwSubmissions);
  const students             = useAppStore((s) => s.students);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const group = groups.find(g => g.id === hw.groupId);
  const groupStudents = useMemo(() =>
    students.filter(s => s.groupId === hw.groupId && s.status === 'active'),
  [students, hw.groupId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? groupStudents.filter(s => s.name.toLowerCase().includes(q)) : groupStudents;
  }, [groupStudents, search]);

  // Local submissions map: { [studentId]: sub }
  const [localSubs, setLocalSubs] = useState(() => {
    const map = {};
    groupStudents.forEach(s => {
      const existing = hwSubmissions.find(x => x.hwId === hw.id && x.studentId === s.id);
      map[s.id] = existing || { hwId: hw.id, studentId: s.id, status: 'missing', submittedAt: null, score: null, notes: '' };
    });
    return map;
  });

  const updateSub = useCallback((studentId, data) => {
    setLocalSubs(prev => ({ ...prev, [studentId]: { ...prev[studentId], ...data } }));
  }, []);

  // Stats
  const stats = useMemo(() => {
    const values = Object.values(localSubs);
    return {
      total:     groupStudents.length,
      submitted: values.filter(s => s.status === 'submitted').length,
      late:      values.filter(s => s.status === 'late').length,
      missing:   values.filter(s => s.status === 'missing').length,
    };
  }, [localSubs, groupStudents]);

  // Phase 3B-6: PostgreSQL هو مصدر الحقيقة الآن — الحفظ يذهب للخادم أولاً (معاملة
  // ذرّية واحدة تستبدل كل حالات تسليم الواجب)، ولا يُطبَّق أي تغيير على الحالة
  // المحلية إلا بعد نجاح الخادم. الـ id الفعلي يأتي من الاستجابة، لا من القيم المحلية.
  const handleSave = async () => {
    setSaving(true);
    try {
      const records = Object.values(localSubs).map(sub => ({
        studentId:   sub.studentId,
        status:      sub.status,
        submittedAt: sub.submittedAt || null,
        score:       sub.score ?? null,
        notes:       sub.notes || '',
      }));

      const saved = await pgSaveHwSubmissions(hw.id, records);

      setHwSubmissions(prev => [
        ...prev.filter(s => s.hwId !== hw.id),
        ...saved.records,
      ]);

      toast.success(`تم حفظ حالة الواجب (${saved.records.length} طالب) ✓`);
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'فشل حفظ حالة الواجب — حاول مرة أخرى');
    } finally {
      setSaving(false);
    }
  };

  const markAll = (status) => {
    const updated = {};
    groupStudents.forEach(s => {
      updated[s.id] = {
        ...localSubs[s.id],
        status,
        submittedAt: status === 'missing' ? null : new Date().toISOString().split('T')[0],
      };
    });
    setLocalSubs(prev => ({ ...prev, ...updated }));
  };

  const pctDone = stats.total > 0 ? Math.round((stats.submitted + stats.late) / stats.total * 100) : 0;

  return (
    <div>
      {/* Homework header */}
      <div style={{ background:'var(--surface2)', borderRadius:12, padding:'14px 16px', marginBottom:16 }}>
        <div style={{ fontWeight:800, fontSize:'0.95rem', marginBottom:6 }}>{hw.title}</div>
        <div style={{ fontSize:'0.75rem', color:'var(--text3)', display:'flex', gap:14, flexWrap:'wrap' }}>
          <span>📚 {hw.subject}</span>
          <span>👤 {hw.teacher || '—'}</span>
          <span>◈ {group?.name || '—'}</span>
          <span>📅 موعد التسليم: {formatDate(hw.dueDate)}</span>
          {hw.totalScore && <span>🎯 الدرجة: {hw.totalScore}</span>}
        </div>
      </div>

      {/* Stats summary */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:16 }}>
        {[
          { label:'إجمالي الطلاب',  value:stats.total,     color:'var(--text)'  },
          { label:'تم التسليم',      value:stats.submitted, color:'#10b981'      },
          { label:'متأخر',           value:stats.late,      color:'#f59e0b'      },
          { label:'لم يُسلَّم',      value:stats.missing,   color:'#ef4444'      },
        ].map(s => (
          <div key={s.label} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'12px 14px', textAlign:'center' }}>
            <div style={{ fontSize:'1.4rem', fontWeight:800, color:s.color, fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{s.value}</div>
            <div style={{ fontSize:'0.66rem', color:'var(--text3)', marginTop:4, fontWeight:600 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.72rem', color:'var(--text3)', marginBottom:4 }}>
          <span>نسبة التسليم</span>
          <span style={{ fontWeight:700, color:'var(--accent)', fontFamily:'Cairo,sans-serif' }}>{pctDone}%</span>
        </div>
        <div style={{ height:7, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
          <div style={{ height:'100%', display:'flex' }}>
            <div style={{ width:`${Math.round(stats.submitted/stats.total*100)}%`, background:'#10b981', transition:'width .5s' }}/>
            <div style={{ width:`${Math.round(stats.late/stats.total*100)}%`,      background:'#f59e0b', transition:'width .5s' }}/>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display:'flex', gap:10, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ flex:1, minWidth:180, display:'flex', alignItems:'center', gap:8, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'0 11px' }}
          onFocusCapture={e => e.currentTarget.style.borderColor='var(--accent)'}
          onBlurCapture={e  => e.currentTarget.style.borderColor='var(--border)'}
        >
          <span style={{ color:'var(--text3)' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث عن طالب..."
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', padding:'8px 0', direction:'rtl' }}/>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <span style={{ fontSize:'0.72rem', color:'var(--text3)' }}>تحديد الكل:</span>
          {Object.entries(SUB_STATUS).map(([k, m]) => (
            <button key={k} onClick={() => markAll(k)}
              style={{ padding:'5px 11px', borderRadius:7, fontSize:'0.72rem', fontWeight:700, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s', border:`1px solid ${m.border}`, background:m.bg, color:m.color }}
              onMouseOver={e => e.currentTarget.style.opacity='.75'}
              onMouseOut={e  => e.currentTarget.style.opacity='1'}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ border:'1px solid var(--border)', borderRadius:14, overflow:'hidden', marginBottom:16, maxHeight:380, overflowY:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
          <thead style={{ position:'sticky', top:0, zIndex:1 }}>
            <tr style={{ background:'var(--surface2)' }}>
              {['الطالب','الحالة','تاريخ التسليم','الدرجة','ملاحظات'].map(h => (
                <th key={h} style={{ padding:'9px 16px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <StudentRow key={s.id} student={s} sub={localSubs[s.id]} hw={hw} onChange={updateSub}/>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
        <div style={{ fontSize:'0.8rem', color:'var(--text2)' }}>
          <span style={{ color:'#10b981', fontWeight:700 }}>{stats.submitted}</span> تم التسليم ·{' '}
          <span style={{ color:'#f59e0b', fontWeight:700 }}>{stats.late}</span> متأخر ·{' '}
          <span style={{ color:'#ef4444', fontWeight:700 }}>{stats.missing}</span> لم يُسلَّم
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <Button variant="secondary" onClick={onClose}>إغلاق</Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>💾 حفظ الحالات</Button>
        </div>
      </div>
    </div>
  );
}
