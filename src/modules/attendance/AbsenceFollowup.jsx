// src/modules/attendance/AbsenceFollowup.jsx
// نظام متابعة الغياب — سبب الغياب من ولي الأمر + متابعة السكرتيرة
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { useAuth }     from '../../store/auth.context';
import { useToast } from '../../components/Toast';
import Button       from '../../components/ui/Button';
import { Modal }    from '../../components/ui/Modal';
import { formatDate } from '../../utils/helpers';
import { pgCreateAbsenceFollowup, pgUpdateAbsenceFollowup } from '../../services/api';

// ── Status config ────────────────────────────────────────────
const FOLLOW_STATUS = {
  pending:   { label:'لم تتم المتابعة', color:'#ef4444', bg:'rgba(239,68,68,.1)',  border:'rgba(239,68,68,.2)',  icon:'⏳' },
  contacted: { label:'تم التواصل',      color:'#f59e0b', bg:'rgba(245,158,11,.1)', border:'rgba(245,158,11,.2)', icon:'📞' },
  excused:   { label:'غياب مبرر',       color:'#10b981', bg:'rgba(16,185,129,.1)', border:'rgba(16,185,129,.2)', icon:'✓'  },
  unexcused: { label:'غياب غير مبرر',  color:'#8b5cf6', bg:'rgba(139,92,246,.1)', border:'rgba(139,92,246,.2)', icon:'✗'  },
};

const ABSENCE_REASONS = [
  'مرض', 'ظروف عائلية', 'سفر', 'ارتباط آخر', 'لم يُبلَّغ', 'أخرى',
];

const AV_PAL = [
  {bg:'rgba(59,130,246,.18)',color:'#3b82f6'},{bg:'rgba(16,185,129,.18)',color:'#10b981'},
  {bg:'rgba(245,158,11,.18)',color:'#f59e0b'},{bg:'rgba(139,92,246,.18)',color:'#8b5cf6'},
  {bg:'rgba(239,68,68,.18)', color:'#ef4444'},{bg:'rgba(6,182,212,.18)', color:'#06b6d4'},
];
const av = n => AV_PAL[((n?.charCodeAt(0)||0)+(n?.charCodeAt(1)||0))%AV_PAL.length];

// ── Follow-up form modal ──────────────────────────────────────
function FollowupModal({ record, student, group, onSave, onClose, currentUser }) {
  const [form, setForm] = useState({
    absenceReason:      record?.absenceReason     || '',
    parentContactedUs:  record?.parentContactedUs || false,
    followedBy:         record?.followedBy        || currentUser?.name || '',
    followStatus:       record?.followStatus      || 'contacted',
    notes:              record?.notes             || '',
    parentPhone:        student?.parentPhone      || student?.phone || '',
  });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const ch  = e => set(e.target.name, e.target.type === 'checkbox' ? e.target.checked : e.target.value);

  const BASE = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'8px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.875rem', outline:'none', width:'100%', direction:'rtl', transition:'border-color .15s' };
  const fo = e => e.target.style.borderColor = 'var(--accent)';
  const bl = e => e.target.style.borderColor = 'var(--border)';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {/* Student info */}
      {student && (
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:'var(--surface2)', borderRadius:12 }}>
          {(() => { const { bg, color } = av(student.name); const l = student.name.split(' ').map(w=>w[0]).slice(0,2).join('');
            return <div style={{ width:38, height:38, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.82rem', fontWeight:700, flexShrink:0 }}>{l}</div>;
          })()}
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700 }}>{student.name}</div>
            <div style={{ fontSize:'0.72rem', color:'var(--text3)', display:'flex', gap:10, marginTop:2 }}>
              <span>{group?.name||'—'}</span>
              <span>📞 {student.phone}</span>
              {student.parentPhone && <span>👨‍👩‍👧 ولي الأمر: {student.parentPhone}</span>}
            </div>
          </div>
          {/* Quick call button */}
          {student.parentPhone && (
            <a href={`tel:${student.parentPhone}`}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:9, background:'rgba(16,185,129,.1)', color:'#10b981', border:'1px solid rgba(16,185,129,.2)', fontSize:'0.78rem', fontWeight:700, textDecoration:'none', transition:'all .12s' }}
              onMouseOver={e => { e.currentTarget.style.background='#10b981'; e.currentTarget.style.color='#fff'; }}
              onMouseOut={e  => { e.currentTarget.style.background='rgba(16,185,129,.1)'; e.currentTarget.style.color='#10b981'; }}>
              📞 اتصال
            </a>
          )}
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        {/* Reason */}
        <div style={{ gridColumn:'1/-1' }}>
          <label style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:5 }}>سبب الغياب (من ولي الأمر)</label>
          <input name="absenceReason" value={form.absenceReason} onChange={ch} list="reasons-list"
            placeholder="اكتب السبب أو اختر من القائمة..."
            style={BASE} onFocus={fo} onBlur={bl}/>
          <datalist id="reasons-list">{ABSENCE_REASONS.map(r=><option key={r} value={r}/>)}</datalist>
        </div>

        {/* Parent contacted us */}
        <div style={{ gridColumn:'1/-1' }}>
          <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', padding:'10px 14px', borderRadius:10, background:'var(--surface2)', border:'1px solid var(--border)', transition:'border-color .12s' }}
            onMouseOver={e=>e.currentTarget.style.borderColor='var(--accent)'}
            onMouseOut={e =>e.currentTarget.style.borderColor='var(--border)'}
          >
            <input type="checkbox" name="parentContactedUs" checked={form.parentContactedUs} onChange={ch}
              style={{ width:18, height:18, cursor:'pointer', accentColor:'var(--accent)' }}/>
            <div>
              <div style={{ fontWeight:700, fontSize:'0.88rem' }}>ولي الأمر اتصل بالمركز</div>
              <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginTop:2 }}>تم الإبلاغ مسبقاً من ولي الأمر عن الغياب</div>
            </div>
          </label>
        </div>

        {/* Follow status */}
        <div style={{ gridColumn:'1/-1' }}>
          <label style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:8 }}>نتيجة المتابعة</label>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {Object.entries(FOLLOW_STATUS).map(([k, meta]) => (
              <button key={k} onClick={() => set('followStatus', k)}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:9, fontSize:'0.78rem', fontWeight:700, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s',
                  border:`1.5px solid ${form.followStatus===k ? meta.border : 'var(--border)'}`,
                  background: form.followStatus===k ? meta.bg : 'transparent',
                  color:      form.followStatus===k ? meta.color : 'var(--text3)',
                }}
                onMouseOver={e => { if(form.followStatus!==k){ e.currentTarget.style.background=meta.bg; e.currentTarget.style.color=meta.color; }}}
                onMouseOut={e  => { if(form.followStatus!==k){ e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--text3)'; }}}
              >
                {meta.icon} {meta.label}
              </button>
            ))}
          </div>
        </div>

        {/* Followed by */}
        <div>
          <label style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:5 }}>متابعة بواسطة</label>
          <input name="followedBy" value={form.followedBy} onChange={ch} placeholder="اسم السكرتيرة / المتابع"
            style={BASE} onFocus={fo} onBlur={bl}/>
        </div>

        {/* Parent phone */}
        <div>
          <label style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:5 }}>هاتف ولي الأمر</label>
          <input name="parentPhone" value={form.parentPhone} onChange={ch} placeholder="01xxxxxxxxx"
            style={BASE} onFocus={fo} onBlur={bl}/>
        </div>

        {/* Notes */}
        <div style={{ gridColumn:'1/-1' }}>
          <label style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:5 }}>ملاحظات السكرتيرة</label>
          <textarea name="notes" value={form.notes} onChange={ch} rows={2} placeholder="تفاصيل المكالمة أو الملاحظات..."
            style={{ ...BASE, resize:'vertical', minHeight:64 }}
            onFocus={fo} onBlur={bl}/>
        </div>
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, paddingTop:12, borderTop:'1px solid var(--border)' }}>
        <Button variant="secondary" onClick={onClose}>إلغاء</Button>
        <Button variant="primary" onClick={() => onSave(form)}>💾 حفظ المتابعة</Button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
export default function AbsenceFollowup() {
  const absenceFollowup      = useAppStore((s) => s.absenceFollowup);
  const attendance           = useAppStore((s) => s.attendance);
  const groups               = useAppStore((s) => s.groups);
  const setAbsenceFollowup   = useAppStore((s) => s.setAbsenceFollowup);
  const students             = useAppStore((s) => s.students);

  const { currentUser } = useAuth();
  const toast = useToast();

  const [modal,       setModal]       = useState({ open:false, attRecord:null, existing:null });
  const [filterGroup, setFilterGroup] = useState('');
  const [filterStatus,setFilterStatus]= useState('');
  const [filterDate,  setFilterDate]  = useState('');
  const [search,      setSearch]      = useState('');

  // ── Get all absent records ────────────────────────────────
  const absentRecords = useMemo(() => {
    return attendance
      .filter(r => r.status === 'absent')
      .map(r => {
        const student  = students.find(s => s.id === r.studentId);
        const group    = groups.find(g => g.id === r.groupId);
        const followup = absenceFollowup.find(f => f.attendanceId === r.id);
        return { attRecord:r, student, group, followup };
      })
      .filter(x => x.student) // only known students
      .sort((a,b) => b.attRecord.date.localeCompare(a.attRecord.date));
  }, [attendance, students, groups, absenceFollowup]);

  // ── Filter ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return absentRecords.filter(x => {
      if (filterGroup  && x.attRecord.groupId !== filterGroup) return false;
      if (filterDate   && x.attRecord.date    !== filterDate)  return false;
      if (filterStatus) {
        const status = x.followup?.followStatus || 'pending';
        if (status !== filterStatus) return false;
      }
      if (q) {
        const match = x.student?.name.toLowerCase().includes(q) ||
                      x.student?.phone?.includes(search)         ||
                      x.followup?.absenceReason?.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [absentRecords, filterGroup, filterStatus, filterDate, search]);

  // ── Summary stats ─────────────────────────────────────────
  const stats = useMemo(() => {
    const total     = absentRecords.length;
    const pending   = absentRecords.filter(x => !x.followup || x.followup.followStatus==='pending').length;
    const contacted = absentRecords.filter(x => x.followup?.followStatus==='contacted').length;
    const excused   = absentRecords.filter(x => x.followup?.followStatus==='excused').length;
    const unexcused = absentRecords.filter(x => x.followup?.followStatus==='unexcused').length;
    const parentCalled = absentRecords.filter(x => x.followup?.parentContactedUs).length;
    return { total, pending, contacted, excused, unexcused, parentCalled };
  }, [absentRecords]);

  // ── Save followup ─────────────────────────────────────────
  // مصدر الحقيقة هو الخادم (PostgreSQL) — لا تعديل محلي إلا بعد نجاح الاستدعاء،
  // ونتبنّى سجل الاستجابة كما هو (نفس مبدأ SessionMarking/ExamsPage/CommunicationPage).
  const handleSave = useCallback(async (formData) => {
    const { attRecord, existing } = modal;
    const now = new Date().toISOString();

    const payload = {
      attendanceId:      attRecord.id,
      absenceReason:     formData.absenceReason || '',
      parentContactedUs: formData.parentContactedUs || false,
      followedBy:        formData.followedBy || currentUser?.name || '',
      followedAt:        now,
      followStatus:      formData.followStatus || 'contacted',
      notes:             formData.notes || '',
    };

    try {
      const saved = existing
        ? await pgUpdateAbsenceFollowup(existing.id, payload)
        : await pgCreateAbsenceFollowup(payload);

      setAbsenceFollowup(prev =>
        existing
          ? prev.map(f => f.id === existing.id ? saved : f)
          : [...prev, saved]
      );
      toast.success(`تم حفظ متابعة غياب ${modal.attRecord?.studentId ? students.find(s=>s.id===attRecord.studentId)?.name : ''} ✓`);
      setModal({ open:false, attRecord:null, existing:null });
    } catch (err) {
      toast.error(err.message || 'فشل حفظ متابعة الغياب — حاول مرة أخرى');
    }
  }, [modal, setAbsenceFollowup, currentUser, toast, students]);

  const SEL = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 10px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.8rem', outline:'none', cursor:'pointer', direction:'rtl' };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

      {/* ── Stats bar ─────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10 }}>
        {[
          { label:'إجمالي الغيابات',   value:stats.total,       color:'var(--text)'  },
          { label:'لم تتم المتابعة',   value:stats.pending,     color:'#ef4444', alert:stats.pending>0 },
          { label:'تم التواصل',        value:stats.contacted,   color:'#f59e0b'  },
          { label:'مبرر',              value:stats.excused,     color:'#10b981'  },
          { label:'غير مبرر',         value:stats.unexcused,   color:'#8b5cf6'  },
          { label:'ولي الأمر اتصل',   value:stats.parentCalled,color:'#3b82f6'  },
        ].map(s => (
          <div key={s.label} style={{ background:'var(--surface)', border:`1px solid ${s.alert?'rgba(239,68,68,.3)':'var(--border)'}`, borderRadius:12, padding:'12px 14px', textAlign:'center', transition:'transform .1s' }}>
            <div style={{ fontSize:'1.4rem', fontWeight:800, color:s.color, fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{s.value}</div>
            <div style={{ fontSize:'0.62rem', color:'var(--text3)', marginTop:4, fontWeight:600, lineHeight:1.3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Filters ───────────────────────── */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ flex:1, minWidth:180, display:'flex', alignItems:'center', gap:8, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'0 11px' }}
          onFocusCapture={e=>e.currentTarget.style.borderColor='var(--accent)'}
          onBlurCapture={e =>e.currentTarget.style.borderColor='var(--border)'}
        >
          <span style={{ color:'var(--text3)' }}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="بحث بالاسم أو السبب..."
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', padding:'8px 0', direction:'rtl' }}/>
          {search && <button onClick={()=>setSearch('')} style={{color:'var(--text3)',cursor:'pointer'}}>×</button>}
        </div>

        <select style={SEL} value={filterGroup} onChange={e=>setFilterGroup(e.target.value)}>
          <option value="">كل المجموعات</option>
          {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
        </select>

        <select style={SEL} value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="">كل الحالات</option>
          {Object.entries(FOLLOW_STATUS).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>

        <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} style={SEL}/>

        {(filterGroup||filterStatus||filterDate||search) && (
          <button onClick={()=>{setFilterGroup('');setFilterStatus('');setFilterDate('');setSearch('');}}
            style={{...SEL,color:'var(--text3)',cursor:'pointer'}}>× مسح</button>
        )}

        <span style={{ fontSize:'0.78rem', color:'var(--text3)', marginRight:'auto' }}>
          {filtered.length} غياب
        </span>
      </div>

      {/* ── Main table ────────────────────── */}
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign:'center', padding:'60px', color:'var(--text3)' }}>
            <div style={{ fontSize:44, opacity:.3, marginBottom:10 }}>✅</div>
            <div style={{ fontWeight:600 }}>لا توجد غيابات في هذا الفلتر</div>
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
              <thead>
                <tr style={{ background:'var(--surface2)' }}>
                  {['الطالب','المجموعة','تاريخ الغياب','سبب الغياب','ولي الأمر أبلغ','حالة المتابعة','المتابع','آخر تحديث',''].map(h=>(
                    <th key={h} style={{ padding:'10px 14px', fontSize:'0.63rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ attRecord, student, group, followup }) => {
                  const { bg, color } = av(student?.name||'');
                  const letters = (student?.name||'').split(' ').map(w=>w[0]).slice(0,2).join('');
                  const statusKey = followup?.followStatus || 'pending';
                  const meta      = FOLLOW_STATUS[statusKey];
                  const isPending = statusKey === 'pending';

                  return (
                    <tr key={attRecord.id}
                      style={{ background: isPending ? 'rgba(239,68,68,.02)' : 'transparent', transition:'background .12s', cursor:'pointer' }}
                      onMouseOver={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--surface2)')}
                      onMouseOut={e =>Array.from(e.currentTarget.cells).forEach(td=>td.style.background=isPending?'rgba(239,68,68,.02)':'')}
                      onClick={() => setModal({ open:true, attRecord, existing:followup||null })}
                    >
                      {/* Student */}
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                          <div style={{ width:32, height:32, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.72rem', fontWeight:700, flexShrink:0 }}>{letters}</div>
                          <div>
                            <div style={{ fontWeight:700, fontSize:'0.88rem' }}>{student?.name||'—'}</div>
                            <div style={{ fontSize:'0.68rem', color:'var(--text3)', fontFamily:'Cairo,sans-serif' }}>{student?.phone}</div>
                          </div>
                        </div>
                      </td>

                      {/* Group */}
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.76rem', color:'var(--text2)' }}>
                        {group?.name||'—'}
                      </td>

                      {/* Date */}
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', fontSize:'0.78rem', color:'var(--text3)', whiteSpace:'nowrap' }}>
                        {formatDate(attRecord.date, {weekday:'short',month:'short',day:'numeric'})}
                      </td>

                      {/* Absence reason */}
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {followup?.absenceReason
                          ? <span style={{ color:'var(--text)' }}>{followup.absenceReason}</span>
                          : <span style={{ color:'var(--text3)', fontStyle:'italic', fontSize:'0.76rem' }}>لم يُحدد بعد</span>
                        }
                      </td>

                      {/* Parent contacted */}
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', textAlign:'center' }}>
                        {followup?.parentContactedUs
                          ? <span style={{ color:'#10b981', fontWeight:700, fontSize:'0.82rem' }}>✓ نعم</span>
                          : <span style={{ color:'var(--text3)', fontSize:'0.76rem' }}>—</span>
                        }
                      </td>

                      {/* Follow status badge */}
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:99, fontSize:'0.7rem', fontWeight:700,
                          background:meta.bg, color:meta.color, border:`1px solid ${meta.border}`,
                          animation: isPending ? 'pulse 2s infinite' : 'none',
                        }}>
                          {meta.icon} {meta.label}
                        </span>
                      </td>

                      {/* Followed by */}
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.76rem', color:'var(--text2)' }}>
                        {followup?.followedBy || <span style={{ color:'var(--text3)' }}>—</span>}
                      </td>

                      {/* Last updated */}
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.72rem', color:'var(--text3)', whiteSpace:'nowrap' }}>
                        {followup?.followedAt
                          ? formatDate(followup.followedAt.split('T')[0], {month:'short',day:'numeric'}) + ' ' + followup.followedAt.split('T')[1]?.slice(0,5)
                          : <span style={{ color:'var(--red)', fontWeight:700 }}>لم تتم المتابعة</span>
                        }
                      </td>

                      {/* Action */}
                      <td style={{ padding:'11px 14px', borderBottom:'1px solid var(--border)' }}>
                        <button
                          onClick={e => { e.stopPropagation(); setModal({ open:true, attRecord, existing:followup||null }); }}
                          style={{ padding:'4px 12px', borderRadius:7, fontSize:'0.72rem', fontWeight:700, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s',
                            border:     isPending ? 'none'             : '1px solid var(--border)',
                            background: isPending ? '#ef4444'          : 'var(--surface2)',
                            color:      isPending ? '#fff'             : 'var(--text2)',
                          }}
                          onMouseOver={e => { if(!isPending){e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--accent)';} }}
                          onMouseOut={e  => { if(!isPending){e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text2)';} }}
                        >
                          {isPending ? '⚡ متابعة' : '✎ تعديل'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Quick pending alert ────────────── */}
      {stats.pending > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 18px', background:'rgba(239,68,68,.06)', border:'1px solid rgba(239,68,68,.2)', borderRadius:12 }}>
          <span style={{ fontSize:'1.3rem' }}>⚠️</span>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, color:'var(--red)', fontSize:'0.88rem' }}>
              {stats.pending} غياب لم تتم متابعته
            </div>
            <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginTop:2 }}>
              يرجى التواصل مع أولياء الأمور وتسجيل سبب الغياب
            </div>
          </div>
          <button onClick={() => setFilterStatus('pending')}
            style={{ padding:'6px 14px', borderRadius:8, background:'var(--red)', color:'#fff', border:'none', fontSize:'0.78rem', fontWeight:700, cursor:'pointer', fontFamily:'Cairo,sans-serif' }}>
            عرض فقط
          </button>
        </div>
      )}

      {/* ── Modal ────────────────────────── */}
      <Modal
        isOpen={modal.open}
        onClose={() => setModal({ open:false, attRecord:null, existing:null })}
        title={modal.existing ? 'تعديل متابعة الغياب' : '📞 تسجيل متابعة غياب'}
        size="md"
      >
        {modal.open && modal.attRecord && (
          <FollowupModal
            record={modal.existing}
            student={students.find(s => s.id === modal.attRecord.studentId)}
            group={groups.find(g => g.id === modal.attRecord.groupId)}
            onSave={handleSave}
            onClose={() => setModal({ open:false, attRecord:null, existing:null })}
            currentUser={currentUser}
          />
        )}
      </Modal>
    </div>
  );
}
