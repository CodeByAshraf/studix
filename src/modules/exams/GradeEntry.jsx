// src/modules/exams/GradeEntry.jsx
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { useAuth }     from '../../store/auth.context';
import { useToast } from '../../components/Toast';
import Button       from '../../components/ui/Button';
import { scorePercent, scoreColor, scoreGrade } from '../../services/examService';
import { pgSaveExamGrades } from '../../services/api';
import { useAvatarStyle } from '../students/components/StudentAvatar';

// ── Single student grade row ─────────────────────────────────
function GradeRow({ student, grade, exam, onChange, index }) {
  const { bg, color } = useAvatarStyle(student.name);
  const letters = student.name.split(' ').map(w=>w[0]).slice(0,2).join('');

  const score   = grade?.score;
  const absent  = grade?.absent || false;
  const pct     = absent ? null : scorePercent(score, exam.total);
  const gColor  = absent ? 'var(--text3)' : scoreColor(pct);
  const letter  = absent ? 'غائب' : scoreGrade(pct);
  const isPassed = !absent && score !== null && score !== '' && score >= exam.pass;
  const isFailed = !absent && score !== null && score !== '' && score < exam.pass;

  const handleScoreChange = (e) => {
    const raw = e.target.value;
    if (raw === '') { onChange({ score: null, absent: false }); return; }
    const n = Math.min(Math.max(0, Number(raw)), exam.total);
    onChange({ score: n, absent: false });
  };

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:12,
      padding:'11px 18px',
      borderBottom:'1px solid var(--border)',
      background: absent ? 'rgba(239,68,68,.03)' : isFailed ? 'rgba(239,68,68,.02)' : isPassed ? 'rgba(16,185,129,.02)' : 'transparent',
      transition:'background .15s',
    }}>
      {/* Rank */}
      <span style={{ width:24, fontSize:'0.68rem', color:'var(--text3)', fontFamily:'Cairo,sans-serif', textAlign:'center', flexShrink:0 }}>{index+1}</span>

      {/* Avatar */}
      <div style={{ width:34, height:34, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.78rem', fontWeight:700, flexShrink:0 }}>{letters}</div>

      {/* Name */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontWeight:600, fontSize:'0.88rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{student.name}</div>
        <div style={{ fontSize:'0.68rem', color:'var(--text3)', fontFamily:'Cairo,sans-serif' }}>{student.code}</div>
      </div>

      {/* Score input */}
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        {!absent && (
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input
              type="number"
              min="0"
              max={exam.total}
              value={score === null || score === undefined ? '' : score}
              onChange={handleScoreChange}
              placeholder="—"
              style={{
                width:72, padding:'7px 10px', textAlign:'center',
                background:'var(--surface2)', border:`1.5px solid ${isFailed?'rgba(239,68,68,.4)':isPassed?'rgba(16,185,129,.4)':'var(--border)'}`,
                borderRadius:9, color:'var(--text)', fontFamily:'Cairo,sans-serif',
                fontSize:'0.95rem', fontWeight:700, outline:'none',
              }}
              onFocus={e => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.12)'; }}
              onBlur={e  => { e.target.style.borderColor=isFailed?'rgba(239,68,68,.4)':isPassed?'rgba(16,185,129,.4)':'var(--border)'; e.target.style.boxShadow='none'; }}
            />
            <span style={{ fontSize:'0.75rem', color:'var(--text3)' }}>/ {exam.total}</span>
          </div>
        )}

        {/* Percentage + grade */}
        <div style={{ width:60, textAlign:'center', flexShrink:0 }}>
          {absent ? (
            <span style={{ fontSize:'0.72rem', color:'var(--text3)' }}>غائب</span>
          ) : pct !== null ? (
            <div>
              <div style={{ fontSize:'0.85rem', fontWeight:800, color:gColor, fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{pct}%</div>
              <div style={{ fontSize:'0.68rem', color:gColor, marginTop:2, fontWeight:700 }}>{letter}</div>
            </div>
          ) : (
            <span style={{ fontSize:'0.72rem', color:'var(--text3)' }}>—</span>
          )}
        </div>

        {/* Pass/Fail badge */}
        {!absent && score !== null && score !== undefined && score !== '' && (
          <span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'3px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:700,
            background: isPassed ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
            color:      isPassed ? '#10b981' : '#ef4444',
            border:     `1px solid ${isPassed ? 'rgba(16,185,129,.2)' : 'rgba(239,68,68,.2)'}`,
            minWidth:58, justifyContent:'center',
          }}>
            {isPassed ? '✓ ناجح' : '✗ راسب'}
          </span>
        )}
        {absent && (
          <span style={{ display:'inline-flex', alignItems:'center', padding:'3px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:700, background:'rgba(239,68,68,.1)', color:'#ef4444', border:'1px solid rgba(239,68,68,.2)', minWidth:58, justifyContent:'center' }}>
            غائب
          </span>
        )}
      </div>

      {/* Absent toggle */}
      <button
        onClick={() => onChange({ score: absent ? score : null, absent: !absent })}
        style={{
          padding:'5px 10px', borderRadius:7, fontSize:'0.72rem', fontWeight:600, cursor:'pointer',
          fontFamily:'Cairo,sans-serif', transition:'all .12s', flexShrink:0,
          border:`1px solid ${absent ? 'rgba(239,68,68,.3)' : 'var(--border)'}`,
          background: absent ? 'rgba(239,68,68,.1)' : 'transparent',
          color: absent ? '#ef4444' : 'var(--text3)',
        }}
        onMouseOver={e => { if (!absent) { e.currentTarget.style.background='rgba(239,68,68,.08)'; e.currentTarget.style.color='#ef4444'; e.currentTarget.style.borderColor='rgba(239,68,68,.3)'; }}}
        onMouseOut={e  => { if (!absent) { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--text3)'; e.currentTarget.style.borderColor='var(--border)'; }}}
        title="تبديل الغياب"
      >
        {absent ? '✓ حاضر' : '✗ غائب'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
export default function GradeEntry({ exam, onClose }) {
  const addLog               = useAppStore((s) => s.addLog);
  const grades               = useAppStore((s) => s.grades);
  const setGrades            = useAppStore((s) => s.setGrades);
  const students             = useAppStore((s) => s.students);
  const { currentUser } = useAuth();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const groupStudents = useMemo(() =>
    students.filter(s => s.groupId === exam.groupId && s.status === 'active'),
  [students, exam.groupId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? groupStudents.filter(s => s.name.toLowerCase().includes(q)) : groupStudents;
  }, [groupStudents, search]);

  // Local grade state — keyed by studentId
  const [localGrades, setLocalGrades] = useState(() => {
    const map = {};
    groupStudents.forEach(s => {
      const existing = grades.find(g => g.examId === exam.id && g.studentId === s.id);
      map[s.id] = existing ? { score: existing.score, absent: existing.absent } : { score: null, absent: false };
    });
    return map;
  });

  const updateGrade = useCallback((studentId, data) => {
    setLocalGrades(prev => ({ ...prev, [studentId]: data }));
  }, []);

  // Live stats
  const liveStats = useMemo(() => {
    const valid = groupStudents.map(s => localGrades[s.id]).filter(g => g && !g.absent && g.score !== null && g.score !== '');
    if (!valid.length) return null;
    const scores = valid.map(g => g.score);
    const passed  = valid.filter(g => g.score >= exam.pass).length;
    return {
      avg:      Math.round(scores.reduce((s,n) => s+n, 0) / scores.length),
      highest:  Math.max(...scores),
      lowest:   Math.min(...scores),
      passed,
      failed:   valid.length - passed,
      absent:   groupStudents.filter(s => localGrades[s.id]?.absent).length,
      entered:  valid.length,
    };
  }, [localGrades, groupStudents, exam.pass]);

  // Phase 3B-5: PostgreSQL هو مصدر الحقيقة الآن — الحفظ يذهب للخادم أولاً (معاملة
  // ذرّية واحدة تستبدل كل درجات الامتحان)، ولا يُطبَّق أي تغيير على الحالة المحلية
  // إلا بعد نجاح الخادم. الـ id الفعلي يأتي من الاستجابة، لا من القيم المحلية.
  const handleSave = async () => {
    setSaving(true);
    try {
      const records = groupStudents.map(s => {
        const lg = localGrades[s.id];
        return {
          studentId: s.id,
          score:     lg?.absent ? null : (lg?.score ?? null),
          absent:    lg?.absent || false,
        };
      });

      const saved = await pgSaveExamGrades(exam.id, records);

      setGrades(prev => [
        ...prev.filter(g => g.examId !== exam.id),
        ...saved.records,
      ]);

      addLog({ action:'update', module:'exams', entityType:'exam', entityId:exam.id, description:`إدخال درجات: ${exam.name}` })
        .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
      toast.success(`تم حفظ الدرجات (${saved.records.length} طالب) ✓`);
      onClose();
    } catch (err) {
      toast.error(err.message || 'فشل حفظ الدرجات — حاول مرة أخرى');
    } finally {
      setSaving(false);
    }
  };

  const fillAll = (score) => {
    const updated = {};
    groupStudents.forEach(s => { updated[s.id] = { score, absent: false }; });
    setLocalGrades(prev => ({ ...prev, ...updated }));
  };

  return (
    <div>
      {/* Exam info header */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:16, padding:'14px 16px', background:'var(--surface2)', borderRadius:12 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:800, fontSize:'1rem', marginBottom:4 }}>{exam.name}</div>
          <div style={{ fontSize:'0.75rem', color:'var(--text3)', display:'flex', gap:10 }}>
            <span>الدرجة: <span style={{ fontFamily:'Cairo,sans-serif', fontWeight:700, color:'var(--text)' }}>{exam.total}</span></span>
            <span>النجاح: <span style={{ fontFamily:'Cairo,sans-serif', fontWeight:700, color:'var(--green)' }}>{exam.pass}</span></span>
            <span>{groupStudents.length} طالب</span>
          </div>
        </div>
        {liveStats && (
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            {[
              { l:'متوسط',  v:liveStats.avg,     c:'var(--accent)'  },
              { l:'أعلى',   v:liveStats.highest, c:'#10b981'        },
              { l:'أدنى',   v:liveStats.lowest,  c:'#ef4444'        },
              { l:'ناجح',   v:liveStats.passed,  c:'#10b981'        },
            ].map(s => (
              <div key={s.l} style={{ textAlign:'center', background:'var(--surface3)', borderRadius:8, padding:'6px 10px', minWidth:48 }}>
                <div style={{ fontSize:'0.95rem', fontWeight:800, color:s.c, fontFamily:'Cairo,sans-serif' }}>{s.v}</div>
                <div style={{ fontSize:'0.6rem', color:'var(--text3)' }}>{s.l}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display:'flex', gap:10, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ flex:1, minWidth:200, display:'flex', alignItems:'center', gap:8, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'0 11px' }}
          onFocusCapture={e => e.currentTarget.style.borderColor='var(--accent)'}
          onBlurCapture={e  => e.currentTarget.style.borderColor='var(--border)'}
        >
          <span style={{ color:'var(--text3)' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث عن طالب..."
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', padding:'8px 0', direction:'rtl' }}/>
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <span style={{ fontSize:'0.72rem', color:'var(--text3)' }}>تعبئة الكل:</span>
          <button onClick={() => fillAll(exam.total)} style={{ padding:'5px 11px', borderRadius:7, border:'1px solid rgba(16,185,129,.3)', background:'rgba(16,185,129,.08)', color:'#10b981', fontSize:'0.72rem', fontWeight:700, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s' }}
            onMouseOver={e => { e.currentTarget.style.background='rgba(16,185,129,.18)'; }}
            onMouseOut={e  => { e.currentTarget.style.background='rgba(16,185,129,.08)'; }}>
            {exam.total} (كامل)
          </button>
        </div>
      </div>

      {/* Grade list */}
      <div style={{ border:'1px solid var(--border)', borderRadius:14, overflow:'hidden', marginBottom:16, maxHeight:420, overflowY:'auto' }}>
        <div style={{ display:'flex', padding:'8px 18px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.07em' }}>
          <span style={{ width:24 }}>#</span>
          <span style={{ marginRight:46 }}>الطالب</span>
          <span style={{ marginRight:'auto' }}>الدرجة / {exam.total}</span>
        </div>
        {filtered.map((s, i) => (
          <GradeRow key={s.id} student={s} grade={localGrades[s.id]} exam={exam}
            onChange={data => updateGrade(s.id, data)} index={i}/>
        ))}
      </div>

      {/* Save bar */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
        {liveStats ? (
          <div style={{ fontSize:'0.8rem', color:'var(--text2)' }}>
            <span style={{ color:'#10b981', fontWeight:700 }}>{liveStats.passed}</span> ناجح ·{' '}
            <span style={{ color:'#ef4444', fontWeight:700 }}>{liveStats.failed}</span> راسب ·{' '}
            <span style={{ color:'var(--text3)' }}>{liveStats.absent}</span> غائب ·{' '}
            متوسط <span style={{ color:'var(--accent)', fontWeight:700, fontFamily:'Cairo,sans-serif' }}>{liveStats.avg}/{exam.total}</span>
          </div>
        ) : <span/>}
        <div style={{ display:'flex', gap:8 }}>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>💾 حفظ الدرجات</Button>
        </div>
      </div>
    </div>
  );
}
