// src/modules/students/StudentProfile.jsx
// Full profile — attendance · payments · exams · notes
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { SectionBoundary } from '../../components/ErrorBoundary';
import Button            from '../../components/ui/Button';
import StatusBadge       from './components/StatusBadge';
import StudentAvatar     from './components/StudentAvatar';
import { formatDate, formatCurrency } from '../../utils/helpers';
import { getNetRevenue } from '../../services/paymentService';
import {
  pgGetPayments, pgUpdateStudent, pgGetAttendance, pgGetGrades,
  pgGetStudentEnrollments, pgAddAdditionalGroup, pgWithdrawEnrollment,
} from '../../services/api';
import { ALL_DAYS, DAYS_AR } from '../../services/groupService';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { useToast } from '../../components/Toast';
import { ConfirmModal } from '../../components/ui/Modal';

// MEDIUM-A Finding 6: نفس قيم preferredMethod الثلاث المستخدَمة في نموذج تعديل ولي
// الأمر (ParentEditModal.jsx بموديول communication) — نسخة محلية صغيرة هنا بدل استيراد
// عابر للموديولات، لإبقاء هذا الموديول مستقلاً (نفس مبدأ استقلالية communication).
const PARENT_PREFERRED_METHOD_META = {
  phoneCall: { label: 'مكالمة', icon: '📞' },
  whatsapp:  { label: 'واتساب', icon: '💬' },
  sms:       { label: 'رسالة',  icon: '✉️' },
};

// ── Tab IDs ─────────────────────────────────────────────────
const TABS = [
  { id: 'attendance', label: 'الحضور',      icon: '✓' },
  { id: 'payments',   label: 'المدفوعات',   icon: '💰' },
  { id: 'exams',      label: 'الامتحانات',  icon: '📝' },
  { id: 'notes',      label: 'الملاحظات',   icon: '📋' },
  { id: 'groups',     label: 'المجموعات',   icon: '◈' },
];

// ── Stat pill ────────────────────────────────────────────────
function StatPill({ label, value, color = 'var(--text)' }) {
  return (
    <div style={{ background:'var(--surface3)', borderRadius:10, padding:'10px 14px', textAlign:'center' }}>
      <div style={{ fontSize:'1.3rem', fontWeight:700, color, fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginTop:4, fontWeight:600 }}>{label}</div>
    </div>
  );
}

// ── Section heading ──────────────────────────────────────────
function SectionHead({ title, count }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
      <div style={{ fontSize:'0.8rem', fontWeight:700, color:'var(--text2)' }}>{title}</div>
      {count != null && (
        <span style={{ background:'var(--surface3)', color:'var(--text3)', fontSize:'0.62rem', fontWeight:700, padding:'1px 7px', borderRadius:99, fontFamily:'Cairo,sans-serif' }}>
          {count}
        </span>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// TAB: Attendance
// ════════════════════════════════════════════════════════════
// C4 Attendance migration Phase 2: `attendance` is now already student-scoped (fetched by
// the parent via pgGetAttendance({studentId}), not filtered here from the global array) —
// only the sort remains this component's own responsibility.
function AttendanceTab({ attendance }) {
  const records = useMemo(() =>
    [...attendance].sort((a, b) => b.date.localeCompare(a.date)),
  [attendance]);

  const stats = useMemo(() => {
    const total   = records.length;
    const present = records.filter(r => r.status === 'present').length;
    const absent  = records.filter(r => r.status === 'absent').length;
    const late    = records.filter(r => r.status === 'late').length;
    const pct     = total > 0 ? Math.round(present / total * 100) : 0;
    return { total, present, absent, late, pct };
  }, [records]);

  const pctColor = stats.pct >= 80 ? '#10b981' : stats.pct >= 60 ? '#f59e0b' : '#ef4444';

  const STATUS_META = {
    present: { label:'حاضر',  bg:'rgba(16,185,129,.1)', color:'#10b981', border:'rgba(16,185,129,.2)' },
    absent:  { label:'غائب',  bg:'rgba(239,68,68,.1)',  color:'#ef4444', border:'rgba(239,68,68,.2)'  },
    late:    { label:'متأخر', bg:'rgba(245,158,11,.1)', color:'#f59e0b', border:'rgba(245,158,11,.2)' },
  };

  return (
    <div>
      {/* Stats row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:20 }}>
        <StatPill label="إجمالي الجلسات" value={stats.total}/>
        <StatPill label="حضور" value={stats.present} color="#10b981"/>
        <StatPill label="غياب" value={stats.absent}  color="#ef4444"/>
        <StatPill label="نسبة الحضور" value={`${stats.pct}%`} color={pctColor}/>
      </div>

      {/* Progress bar */}
      <div style={{ background:'var(--surface3)', borderRadius:99, height:8, marginBottom:20, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${stats.pct}%`, background:pctColor, borderRadius:99, transition:'width .6s ease' }}/>
      </div>

      {/* Records table */}
      <SectionHead title="سجل الجلسات" count={records.length}/>
      {records.length === 0 ? (
        <div style={{ textAlign:'center', padding:'32px 0', color:'var(--text3)', fontSize:'0.85rem' }}>
          لا توجد سجلات حضور بعد
        </div>
      ) : (
        <div style={{ border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
            <thead>
              <tr style={{ background:'var(--surface2)' }}>
                {['التاريخ','وقت الجلسة','الحالة'].map(h => (
                  <th key={h} style={{ padding:'9px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => {
                const meta = STATUS_META[r.status] || STATUS_META.absent;
                return (
                  <tr key={r.id || i} style={{ transition:'background 0.12s' }}
                    onMouseOver={e  => Array.from(e.currentTarget.cells).forEach(td => td.style.background='var(--surface2)')}
                    onMouseOut={e   => Array.from(e.currentTarget.cells).forEach(td => td.style.background='')}
                  >
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                      {formatDate(r.date)}
                    </td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', fontSize:'0.78rem' }}>
                      {r.sessionTime || '—'}
                    </td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:700, background:meta.bg, color:meta.color, border:`1px solid ${meta.border}` }}>
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// TAB: Payments
// ════════════════════════════════════════════════════════════
function PaymentsTab({ student, payments, treasuryTxn }) {
  const records = useMemo(() =>
    payments.filter(p => p.studentId === student.id).sort((a, b) => b.date.localeCompare(a.date)),
  [payments, student.id]);

  // BUG-02: صافي بعد طرح أي استرداد فعّال (getNetRevenue) — هذا الرقم مؤشر أعلى الجدول
  // (ليس تذييلاً يجمع صفوف الجدول الظاهرة)، فلا خطر مطابقة يمنع عرضه صافياً.
  const totalPaid = getNetRevenue(records.filter(p => p.status !== 'unpaid'), treasuryTxn);

  const MONTH_NAMES = ['','يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const METHOD_LABELS = { cash:'نقدي', transfer:'تحويل', instapay:'إنستاباي', visa:'فيزا' };
  const STATUS_META = {
    paid:    { label:'مدفوع كامل', bg:'rgba(16,185,129,.1)', color:'#10b981', border:'rgba(16,185,129,.2)' },
    partial: { label:'جزئي',       bg:'rgba(245,158,11,.1)', color:'#f59e0b', border:'rgba(245,158,11,.2)' },
    unpaid:  { label:'لم يُسدَّد', bg:'rgba(239,68,68,.1)',  color:'#ef4444', border:'rgba(239,68,68,.2)'  },
  };

  return (
    <div>
      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:20 }}>
        <StatPill label="إجمالي المدفوعات" value={formatCurrency(totalPaid)} color="var(--green)"/>
        <StatPill label="عدد الدفعات" value={records.length}/>
        <StatPill label="آخر دفعة" value={records[0] ? formatDate(records[0].date, { month:'short', day:'numeric' }) : '—'}/>
      </div>

      <SectionHead title="سجل المدفوعات" count={records.length}/>
      {records.length === 0 ? (
        <div style={{ textAlign:'center', padding:'32px 0', color:'var(--text3)', fontSize:'0.85rem' }}>لا توجد دفعات مسجّلة</div>
      ) : (
        <div style={{ border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
            <thead>
              <tr style={{ background:'var(--surface2)' }}>
                {['الشهر','المبلغ','طريقة الدفع','التاريخ','الحالة'].map(h => (
                  <th key={h} style={{ padding:'9px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((p, i) => {
                const meta = STATUS_META[p.status] || STATUS_META.unpaid;
                return (
                  <tr key={p.id || i}
                    onMouseOver={e  => Array.from(e.currentTarget.cells).forEach(td => td.style.background='var(--surface2)')}
                    onMouseOut={e   => Array.from(e.currentTarget.cells).forEach(td => td.style.background='')}
                    style={{ transition:'background 0.12s' }}
                  >
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontWeight:600 }}>
                      {MONTH_NAMES[p.month] || p.month}
                    </td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', fontWeight:700, color:'var(--green)' }}>
                      {formatCurrency(p.amount)}
                    </td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>
                      {METHOD_LABELS[p.method] || p.method}
                    </td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text3)' }}>
                      {formatDate(p.date)}
                    </td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:700, background:meta.bg, color:meta.color, border:`1px solid ${meta.border}` }}>
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// TAB: Exams
// ════════════════════════════════════════════════════════════
function ExamsTab({ student, exams, grades, loading }) {
  const studentGrades = useMemo(() =>
    grades
      .filter(g => g.studentId === student.id)
      .map(g => ({ ...g, exam: exams.find(e => e.id === g.examId) }))
      .filter(g => g.exam)
      .sort((a, b) => b.exam.date.localeCompare(a.exam.date)),
  [grades, exams, student.id]);

  const passed  = studentGrades.filter(g => !g.absent && g.score !== null && g.score >= (g.exam?.pass || 50)).length;
  const avgScore = studentGrades.filter(g => !g.absent && g.score !== null).reduce((s, g, _, arr) => {
    return s + (g.score / (g.exam?.total || 100) * 100) / arr.length;
  }, 0);

  const EXAM_TYPE = { monthly:'شهري', midterm:'نصف فصل', final:'نهائي', quiz:'اختبار' };

  const getScoreColor = (score, total, pass) => {
    if (score === null) return 'var(--text3)';
    const pct = (score / total) * 100;
    return pct >= 80 ? '#10b981' : pct >= (pass / total * 100) ? '#f59e0b' : '#ef4444';
  };

  return (
    <div>
      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:20 }}>
        <StatPill label="امتحانات" value={studentGrades.length}/>
        <StatPill label="ناجح" value={passed} color="#10b981"/>
        <StatPill label="غائب" value={studentGrades.filter(g => g.absent).length} color="#ef4444"/>
        <StatPill label="متوسط الدرجات" value={studentGrades.length ? `${Math.round(avgScore)}%` : '—'} color={avgScore >= 70 ? '#10b981' : avgScore >= 50 ? '#f59e0b' : '#ef4444'}/>
      </div>

      <SectionHead title="نتائج الامتحانات" count={studentGrades.length}/>
      {loading ? null : studentGrades.length === 0 ? (
        <div style={{ textAlign:'center', padding:'32px 0', color:'var(--text3)', fontSize:'0.85rem' }}>لا توجد نتائج بعد</div>
      ) : (
        <div style={{ border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
            <thead>
              <tr style={{ background:'var(--surface2)' }}>
                {['الامتحان','النوع','التاريخ','الدرجة','النتيجة'].map(h => (
                  <th key={h} style={{ padding:'9px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {studentGrades.map((g, i) => {
                const sc     = g.score;
                const total  = g.exam.total;
                const pass   = g.exam.pass;
                const passed = !g.absent && sc !== null && sc >= pass;
                const pct    = !g.absent && sc !== null ? Math.round(sc / total * 100) : null;
                const color  = getScoreColor(sc, total, pass);

                return (
                  <tr key={g.id || i} style={{ transition:'background 0.12s' }}
                    onMouseOver={e  => Array.from(e.currentTarget.cells).forEach(td => td.style.background='var(--surface2)')}
                    onMouseOut={e   => Array.from(e.currentTarget.cells).forEach(td => td.style.background='')}
                  >
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontWeight:600, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {g.exam.name}
                    </td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.72rem', color:'var(--text3)' }}>
                      {EXAM_TYPE[g.exam.type] || g.exam.type}
                    </td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text3)' }}>
                      {formatDate(g.exam.date)}
                    </td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                      {g.absent ? (
                        <span style={{ color:'var(--text3)', fontSize:'0.75rem' }}>غائب</span>
                      ) : (
                        <span style={{ fontFamily:'Cairo,sans-serif', fontWeight:700, color }}>
                          {sc} / {total}
                          {pct !== null && <span style={{ fontSize:'0.68rem', marginRight:4, opacity:.7 }}>({pct}%)</span>}
                        </span>
                      )}
                    </td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                      {g.absent ? (
                        <span style={{ fontSize:'0.68rem', color:'var(--text3)' }}>—</span>
                      ) : (
                        <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:700,
                          background: passed ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
                          color:      passed ? '#10b981' : '#ef4444',
                          border:     `1px solid ${passed ? 'rgba(16,185,129,.2)' : 'rgba(239,68,68,.2)'}`,
                        }}>
                          {passed ? '✓ ناجح' : '✗ راسب'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// TAB: Notes
// ════════════════════════════════════════════════════════════
function NotesTab({ student, onSaveNotes }) {
  const [editing, setEditing] = useState(false);
  const [noteText, setNoteText] = useState(student.notes || '');
  const [saving, setSaving] = useState(false);

  // onSaveNotes الآن نداء خادم حقيقي (يُعيد true/false) — الإغلاق يحدث فقط عند نجاح
  // حقيقي؛ عند الفشل يبقى وضع التعديل مفتوحاً بالنص الذي كتبه المستخدم كما هو (لا فقد).
  const handleSave = async () => {
    setSaving(true);
    const ok = await onSaveNotes(noteText);
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <SectionHead title="ملاحظات الطالب"/>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>✎ تعديل</Button>
        )}
      </div>

      {editing ? (
        <div>
          <textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            rows={8}
            placeholder="اكتب ملاحظاتك هنا..."
            style={{
              width:'100%', background:'var(--surface2)', border:'1px solid var(--accent)',
              borderRadius:10, padding:'12px 14px', color:'var(--text)',
              fontFamily:'Cairo,sans-serif', fontSize:'0.875rem',
              outline:'none', direction:'rtl', resize:'vertical',
              lineHeight:1.7, boxShadow:'0 0 0 3px rgba(13,148,136,.12)',
            }}
            onFocus={e  => e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.2)'}
            onBlur={e   => e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.12)'}
          />
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:10 }}>
            <Button variant="secondary" size="sm" disabled={saving} onClick={() => { setNoteText(student.notes || ''); setEditing(false); }}>إلغاء</Button>
            <Button variant="primary" size="sm" loading={saving} onClick={handleSave}>حفظ الملاحظات</Button>
          </div>
        </div>
      ) : (
        <div style={{
          background:'var(--surface2)', borderRadius:12, padding:'16px 18px',
          minHeight:120, border:'1px solid var(--border)',
          fontSize:'0.875rem', color: noteText ? 'var(--text)' : 'var(--text3)',
          lineHeight:1.75, direction:'rtl',
          whiteSpace:'pre-wrap',
        }}>
          {noteText || 'لا توجد ملاحظات. اضغط تعديل لإضافة ملاحظة.'}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// TAB: Groups (Phase 3B — Multi-Group Enrollment)
// student_group_enrollments is the source of truth here (via pgGetStudentEnrollments) —
// not students.groupId, which this tab never reads or writes. Primary Group display is
// read-only in this tab (changing it stays the existing Phase 1 edit-student path);
// Additional Groups can be added/withdrawn here via the Phase 3A API as-is.
// ════════════════════════════════════════════════════════════
const SELECT_STYLE = {
  background:'var(--surface)', border:'1px solid var(--border)', borderRadius:9,
  padding:'9px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif',
  fontSize:'0.875rem', outline:'none', width:'100%', direction:'rtl', cursor:'pointer',
};
const DATE_INPUT_STYLE = {
  ...SELECT_STYLE, cursor:'text', flex:1,
};

function EnrollmentRow({ enrollment, group, onWithdraw, withdrawing }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
      padding:'12px 14px', borderBottom:'1px solid var(--border)',
    }}>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontWeight:700, fontSize:'0.88rem' }}>{group?.name || 'مجموعة غير معروفة'}</div>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', fontSize:'0.72rem', color:'var(--text3)', marginTop:4 }}>
          {enrollment.startDate && (
            <span>من {formatDate(enrollment.startDate, { month:'short', day:'numeric', year:'numeric' })}</span>
          )}
          {enrollment.endDate && (
            <span>إلى {formatDate(enrollment.endDate, { month:'short', day:'numeric', year:'numeric' })}</span>
          )}
          {Array.isArray(enrollment.attendDays) && enrollment.attendDays.length > 0 && (
            <span>أيام الحضور: {enrollment.attendDays.map(d => DAYS_AR[d] || d).join('، ')}</span>
          )}
        </div>
      </div>
      {onWithdraw && (
        <Button variant="ghost" size="sm" loading={withdrawing} onClick={() => onWithdraw(enrollment)}>سحب</Button>
      )}
    </div>
  );
}

// يمنع اختيار مجموعة الطالب فيها بالفعل تسجيل نشط (رئيسي أو إضافي) — excludeGroupIds
// يأتي من enrollments النشطة الحالية (دفاع في العمق فوق رفض الخادم نفسه لهذا التكرار).
function AddAdditionalGroupForm({ studentId, excludeGroupIds, groups, onAdded, onCancel }) {
  const toast = useToast();
  const { loading, run } = useErrorHandler(toast);
  const [groupId, setGroupId]     = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');
  const [days, setDays]           = useState([]);

  const availableGroups = groups.filter(g => !excludeGroupIds.includes(g.id));

  const toggleDay = (d) => setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);

  const handleSubmit = async () => {
    if (!groupId) { toast.warning('اختر مجموعة'); return; }
    await run(async () => {
      const created = await pgAddAdditionalGroup(studentId, {
        groupId,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        attendDays: days.length ? days : undefined,
      });
      onAdded(created);
    }, { successMsg: 'تمت إضافة المجموعة الإضافية ✓', errorMsg: 'تعذّر إضافة المجموعة' });
  };

  return (
    <div style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:12, padding:14, marginBottom:14, display:'flex', flexDirection:'column', gap:10 }}>
      <select value={groupId} onChange={e => setGroupId(e.target.value)} style={SELECT_STYLE}>
        <option value="">اختر مجموعة إضافية...</option>
        {availableGroups.map(g => <option key={g.id} value={g.id}>{g.name} — {g.subject}</option>)}
      </select>

      <div style={{ display:'flex', gap:10 }}>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
          aria-label="تاريخ البدء (اختياري)" style={DATE_INPUT_STYLE}/>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
          aria-label="تاريخ الانتهاء (اختياري)" style={DATE_INPUT_STYLE}/>
      </div>

      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        {ALL_DAYS.map(d => {
          const active = days.includes(d);
          return (
            <button key={d} type="button" onClick={() => toggleDay(d)} aria-pressed={active}
              style={{
                padding:'5px 11px', borderRadius:7, fontSize:'0.72rem', fontWeight:700,
                cursor:'pointer', fontFamily:'Cairo,sans-serif',
                border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'rgba(13,148,136,.12)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text3)',
              }}>
              {DAYS_AR[d]}
            </button>
          );
        })}
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
        <Button variant="secondary" size="sm" onClick={onCancel}>إلغاء</Button>
        <Button variant="primary" size="sm" loading={loading} onClick={handleSubmit}>إضافة</Button>
      </div>
    </div>
  );
}

function GroupsTab({ studentId, groups, refreshKey, bumpRefresh }) {
  const toast = useToast();
  const { data: enrollments = [], error } = useAsyncData(
    () => pgGetStudentEnrollments(studentId), [studentId, refreshKey], []);
  const [adding, setAdding] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(null);
  const { loading: withdrawing, run: runWithdraw } = useErrorHandler(toast);

  useEffect(() => {
    if (error) toast.error(error.message || 'فشل تحميل بيانات المجموعات');
  }, [error]);

  const primary        = enrollments.find(e => e.role === 'primary');
  const additional      = enrollments.filter(e => e.role === 'additional');
  const activeGroupIds  = enrollments.map(e => e.groupId);

  const handleWithdraw = async () => {
    const target = confirmWithdraw;
    await runWithdraw(async () => {
      await pgWithdrawEnrollment(target.id);
      setConfirmWithdraw(null);
      bumpRefresh();
    }, { successMsg: 'تم سحب المجموعة الإضافية ✓', errorMsg: 'تعذّر سحب المجموعة' });
  };

  return (
    <div>
      <SectionHead title="المجموعة الرئيسية"/>
      {primary ? (
        <div style={{ border:'1px solid var(--border)', borderRadius:12, marginBottom:20, overflow:'hidden' }}>
          <EnrollmentRow enrollment={primary} group={groups.find(g => g.id === primary.groupId)}/>
        </div>
      ) : (
        <div style={{ textAlign:'center', padding:'20px 0', color:'var(--text3)', fontSize:'0.85rem', marginBottom:20 }}>
          لا توجد مجموعة رئيسية حالياً
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <SectionHead title="المجموعات الإضافية" count={additional.length}/>
        {!adding && <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>+ إضافة مجموعة</Button>}
      </div>

      {adding && (
        <AddAdditionalGroupForm
          studentId={studentId}
          excludeGroupIds={activeGroupIds}
          groups={groups}
          onAdded={() => { setAdding(false); bumpRefresh(); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {additional.length === 0 ? (
        <div style={{ textAlign:'center', padding:'20px 0', color:'var(--text3)', fontSize:'0.85rem' }}>
          لا توجد مجموعات إضافية
        </div>
      ) : (
        <div style={{ border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
          {additional.map(e => (
            <EnrollmentRow key={e.id} enrollment={e} group={groups.find(g => g.id === e.groupId)}
              onWithdraw={(en) => setConfirmWithdraw(en)}
              withdrawing={withdrawing && confirmWithdraw?.id === e.id}/>
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={!!confirmWithdraw}
        onClose={() => setConfirmWithdraw(null)}
        onConfirm={handleWithdraw}
        title="سحب مجموعة إضافية"
        message={`هل تريد سحب "${groups.find(g => g.id === confirmWithdraw?.groupId)?.name || ''}"؟`}
        confirmLabel="نعم، اسحب"
        loading={withdrawing}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// MAIN PROFILE COMPONENT
// ════════════════════════════════════════════════════════════
export default function StudentProfile({ studentId, onBack, onEdit }) {
  const exams                = useAppStore((s) => s.exams);
  // C4 Grades/hwSubmissions Frontend Migration (Batch A, feature 004): removed in favor of the
  // scoped studentGrades fetch below (same pattern as studentAttendance/studentPayments).
  const groups               = useAppStore((s) => s.groups);
  const parents               = useAppStore((s) => s.parents);
  const treasuryTxn          = useAppStore((s) => s.treasuryTxn);
  const setStudents          = useAppStore((s) => s.setStudents);
  const students             = useAppStore((s) => s.students);
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('attendance');
  const [enrollmentsRefreshKey, setEnrollmentsRefreshKey] = useState(0);

  // Scalability Architecture Phase 4 Cutover 2: بدل مصفوفة payments الكاملة من الـ
  // store، يُجلَب تاريخ هذا الطالب فقط عبر GET /api/payments?studentId= — يُستخدَم لكل
  // من مؤشر الرأس هنا وPaymentsTab أدناه معاً (نفس النطاق، جلب واحد). يجب استدعاء هذا
  // الـ hook قبل أي return مبكّر (student غير موجود) — قاعدة hooks React.
  const { data: studentPayments = [], error: paymentsError } = useAsyncData(
    () => pgGetPayments({ studentId }), [studentId], []);

  // C4 Attendance migration Phase 2: same pattern as studentPayments above — one scoped
  // fetch (GET /api/attendance?studentId=) feeds both the header stat below and
  // AttendanceTab, instead of filtering the full global attendance array in either place.
  const { data: studentAttendance = [], error: attendanceError } = useAsyncData(
    () => pgGetAttendance({ studentId }), [studentId], []);

  // C4 Grades/hwSubmissions Frontend Migration (Batch A, feature 004): same pattern as
  // studentPayments/studentAttendance above — one scoped fetch (GET /api/grades?studentId=)
  // feeds ExamsTab instead of filtering the full global grades array there.
  const { data: studentGrades = [], loading: gradesLoading, error: gradesError } = useAsyncData(
    () => pgGetGrades({ studentId }), [studentId], []);

  useEffect(() => {
    if (paymentsError) toast.error(paymentsError.message || 'فشل تحميل مدفوعات الطالب');
  }, [paymentsError]);

  useEffect(() => {
    if (attendanceError) toast.error(attendanceError.message || 'فشل تحميل حضور الطالب');
  }, [attendanceError]);

  useEffect(() => {
    if (gradesError) toast.error(gradesError.message || 'فشل تحميل درجات الطالب');
  }, [gradesError]);

  // C1 fix (Pre-Installer Audit): handleSaveNotes doesn't depend on `student`, so it's
  // hoisted above the `!student` early return below — hooks must run unconditionally and
  // in the same order on every render (a student can disappear from the store between
  // renders of an already-mounted instance, e.g. deleted elsewhere while this stays open).
  // State Synchronization Audit fix — كانت هذه الدالة تُحدِّث Zustand محلياً فقط بلا أي
  // نداء للخادم إطلاقاً؛ الملاحظة تبدو محفوظة لكنها تُفقَد صامتاً عند أي مزامنة تالية
  // (boot-sync يستبدلها بقيمة القاعدة الحقيقية غير المُحدَّثة). الآن: نداء حقيقي عبر
  // pgUpdateStudent (نفس نقطة النهاية ونفس اتفاقية الحمولة الجزئية المُستخدَمة في
  // StudentsPage.jsx — الخادم يُطبِّق Prisma .update() جزئياً، فلا حاجة لإرسال كامل
  // كائن الطالب)، ولا تحديث لحالة Zustand إلا بعد نجاح الخادم فعلياً.
  const handleSaveNotes = useCallback(async (notes) => {
    try {
      const saved = await pgUpdateStudent(studentId, { notes });
      setStudents(prev => prev.map(s => s.id === studentId ? saved : s));
      return true;
    } catch (e) {
      toast.error(e.message || 'فشل حفظ الملاحظات');
      return false;
    }
  }, [studentId, setStudents, toast]);

  const student = students.find(s => s.id === studentId);
  if (!student) return null;

  const group = groups.find(g => g.id === student.groupId);
  // MEDIUM-A Finding 6: students.parent_id (Phase 1) مكتوب لكن لم يُعرَض أبداً — parents
  // مُزامَنة بالفعل (Phase 3B-16)، فقط ينقص الربط والعرض هنا. عرض إضافي بحت، لا كتابة.
  const linkedParent = student.parentId ? parents.find(p => p.id === student.parentId) : null;

  // Attendance stats for header — studentAttendance is already scoped to this student.
  const attRecs = studentAttendance;
  const attPct  = attRecs.length
    ? Math.round(attRecs.filter(a => a.status === 'present').length / attRecs.length * 100)
    : null;

  // BUG-02: صافي بعد طرح أي استرداد فعّال (getNetRevenue) — مؤشر رأس الملف، بلا جدول
  // خام مجاور، فلا خطر مطابقة يمنع عرضه صافياً. studentId===... لم تعد مطلوبة هنا —
  // studentPayments مُفلترة بالفعل من جهة الخادم (لا يوجد فرق سلوكي: هذا المؤشر لا
  // يستبعد status==='unpaid' — نفس PaymentsTab أدناه بالضبط قبل الهجرة، بلا تغيير).
  const payRecs = studentPayments;
  const totalPaid = getNetRevenue(payRecs, treasuryTxn);

  const CARD = {
    background:'var(--surface)', border:'1px solid var(--border)',
    borderRadius:14, overflow:'hidden',
  };

  return (
    <div>
      {/* ── Back button ─────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:20 }}>
        <button
          onClick={onBack}
          style={{ display:'flex', alignItems:'center', gap:6, color:'var(--text2)', fontSize:'0.82rem', fontWeight:600, padding:'6px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)', transition:'all 0.15s', cursor:'pointer' }}
          onMouseOver={e => { e.currentTarget.style.background='var(--surface2)'; e.currentTarget.style.color='var(--text)'; }}
          onMouseOut={e  => { e.currentTarget.style.background='var(--surface)';  e.currentTarget.style.color='var(--text2)'; }}
        >
          ← الرجوع للقائمة
        </button>
        <span style={{ color:'var(--text3)', opacity:.4 }}>›</span>
        <span style={{ fontSize:'0.82rem', color:'var(--text2)' }}>ملف الطالب</span>
        <span style={{ color:'var(--text3)', opacity:.4 }}>›</span>
        <span style={{ fontSize:'0.82rem', fontWeight:700 }}>{student.name}</span>
      </div>

      {/* ── Profile header card ──────────────── */}
      <div style={{ ...CARD, marginBottom:18 }}>
        <div style={{
          display:'flex', alignItems:'flex-start', gap:18,
          padding:'22px 24px', flexWrap:'wrap',
        }}>
          {/* Avatar */}
          <StudentAvatar name={student.name} size={72} fontSize={26}/>

          {/* Info */}
          <div style={{ flex:1, minWidth:200 }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:8 }}>
              <h2 style={{ fontSize:'1.25rem', fontWeight:800, letterSpacing:'-0.3px' }}>{student.name}</h2>
              <StatusBadge status={student.status}/>
              <span style={{ fontFamily:'Cairo,sans-serif', fontSize:'0.72rem', background:'var(--surface3)', color:'var(--accent)', padding:'3px 9px', borderRadius:6, fontWeight:700 }}>
                {student.code}
              </span>
            </div>

            <div style={{ display:'flex', gap:18, flexWrap:'wrap', fontSize:'0.8rem', color:'var(--text2)' }}>
              {[
                { icon:'📱', label: student.phone },
                { icon:'👪', label: student.parentPhone || '—' },
                { icon:'🏫', label: student.school || '—' },
                { icon:'◈',  label: group?.name || '—' },
                { icon:'🎓', label: student.grade },
              ].map((item, i) => (
                <span key={i} style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <span>{item.icon}</span>
                  {item.label}
                </span>
              ))}
            </div>

            {/* MEDIUM-A Finding 6: بيانات ولي الأمر المرتبط (parents، عبر parent_id) —
                عرض فقط، لا تعديل هنا (التعديل من مركز التواصل). لا شيء يظهر إن لم يوجد
                ربط، أو لم توجد أي قيمة من الثلاث. */}
            {linkedParent && (linkedParent.altPhone || linkedParent.preferredMethod || linkedParent.preferredTime) && (
              <div style={{ display:'flex', gap:18, flexWrap:'wrap', fontSize:'0.76rem', color:'var(--text3)', marginTop:6 }}>
                {linkedParent.altPhone && (
                  <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <span>☎️</span>هاتف بديل: {linkedParent.altPhone}
                  </span>
                )}
                {linkedParent.preferredMethod && (
                  <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <span>{PARENT_PREFERRED_METHOD_META[linkedParent.preferredMethod]?.icon || '💬'}</span>
                    التواصل المفضّل: {PARENT_PREFERRED_METHOD_META[linkedParent.preferredMethod]?.label || linkedParent.preferredMethod}
                  </span>
                )}
                {linkedParent.preferredTime && (
                  <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <span>🕐</span>الوقت المفضّل: {linkedParent.preferredTime}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Quick stats */}
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <StatPill label="نسبة الحضور"    value={attPct != null ? `${attPct}%` : '—'} color={attPct >= 80 ? '#10b981' : attPct >= 60 ? '#f59e0b' : '#ef4444'}/>
            <StatPill label="إجمالي المدفوع" value={formatCurrency(totalPaid)} color="var(--green)"/>
            <StatPill label="تاريخ التسجيل"  value={student.enrollDate ? formatDate(student.enrollDate, { month:'short', day:'numeric', year:'numeric' }) : '—'}/>
          </div>

          {/* Edit button */}
          <Button variant="primary" size="sm" onClick={() => onEdit(student)}>✎ تعديل</Button>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────── */}
      <div style={CARD}>
        {/* Tab headers */}
        <div style={{
          display:'flex', borderBottom:'1px solid var(--border)',
          padding:'0 20px', gap:2, overflowX:'auto',
        }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:          6,
                padding:      '13px 16px',
                fontSize:     '0.85rem',
                fontWeight:   activeTab === tab.id ? 700 : 500,
                color:        activeTab === tab.id ? 'var(--accent)' : 'var(--text2)',
                borderBottom: `2px solid ${activeTab === tab.id ? 'var(--accent)' : 'transparent'}`,
                marginBottom: -1,
                background:   'none',
                cursor:       'pointer',
                whiteSpace:   'nowrap',
                transition:   'all 0.15s',
                fontFamily:   'Cairo,sans-serif',
              }}
              onMouseOver={e => { if (activeTab !== tab.id) { e.currentTarget.style.color='var(--text)'; e.currentTarget.style.background='var(--surface2)'; }}}
              onMouseOut={e  => { if (activeTab !== tab.id) { e.currentTarget.style.color='var(--text2)'; e.currentTarget.style.background='none'; }}}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ padding:22, animation:'fadeIn .2s ease' }}>
          <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>

          <SectionBoundary label={`profile:${activeTab}`}>
            {activeTab === 'attendance' && (
              <AttendanceTab attendance={studentAttendance}/>
            )}
            {activeTab === 'payments' && (
              <PaymentsTab student={student} payments={studentPayments} treasuryTxn={treasuryTxn}/>
            )}
            {activeTab === 'exams' && (
              <ExamsTab student={student} exams={exams} grades={studentGrades} loading={gradesLoading}/>
            )}
            {activeTab === 'notes' && (
              <NotesTab student={student} onSaveNotes={handleSaveNotes}/>
            )}
            {activeTab === 'groups' && (
              <GroupsTab studentId={studentId} groups={groups} refreshKey={enrollmentsRefreshKey}
                bumpRefresh={() => setEnrollmentsRefreshKey(k => k + 1)}/>
            )}
          </SectionBoundary>
        </div>
      </div>
    </div>
  );
}
