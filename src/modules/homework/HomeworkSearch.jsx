// src/modules/homework/HomeworkSearch.jsx
// Homework Phase 3A — a new search screen answering "which students submitted / did not
// submit?" across homeworks: one row per (homework, eligible student) pair, filterable by
// Date/Date Range, Academic Year, Grade, and Submission Status. Sits alongside (does not
// replace) the existing per-homework List/Reports screens.
import { useMemo, useState } from 'react';
import { useAppStore } from '../../store/app.store';
import { GRADES } from '../../services/groupService';
import { SUB_STATUS } from '../../services/homeworkService';
import { buildHomeworkSubmissionRows, filterHomeworkSubmissionRows } from '../../services/homeworkSearchService';
import { openHomeworkSearchReportPrint } from './buildHomeworkSearchReport';
import { getHomeworkContactPhone, buildHomeworkMessage, shouldShowHomeworkWhatsapp, openWhatsapp, copyMessage } from './homeworkWhatsappService';
import WhatsappPreviewModal from '../student-report/WhatsappPreviewModal';
import { formatDate } from '../../utils/helpers';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/Toast';

const SEL = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 11px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' };
const LBL = { fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', display:'block', marginBottom:4 };

export default function HomeworkSearch() {
  const homeworks     = useAppStore((s) => s.homeworks);
  const students       = useAppStore((s) => s.students);
  const hwSubmissions  = useAppStore((s) => s.hwSubmissions);
  const centerProfile  = useAppStore((s) => s.centerProfile);
  const toast = useToast();

  const [waPreview, setWaPreview] = useState(null);

  const [dateFrom, setDateFrom]         = useState('');
  const [dateTo, setDateTo]             = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [grade, setGrade]               = useState('');
  const [status, setStatus]             = useState('');

  // مصدر البيانات الموحَّد: صف واحد لكل زوج (واجب، طالب مؤهَّل) — نفس الدالة المستخدَمة
  // في الطباعة، فلا يمكن أن تنحرف الشاشة والطباعة عن بعضهما.
  const allRows = useMemo(
    () => buildHomeworkSubmissionRows(homeworks, students, hwSubmissions),
    [homeworks, students, hwSubmissions]
  );

  const filtered = useMemo(
    () => filterHomeworkSubmissionRows(allRows, { dateFrom, dateTo, academicYear, grade, status }),
    [allRows, dateFrom, dateTo, academicYear, grade, status]
  );

  const academicYears = useMemo(
    () => [...new Set(homeworks.map((h) => h.academicYear).filter(Boolean))],
    [homeworks]
  );

  const hasFilters = !!(dateFrom || dateTo || academicYear || grade || status);
  const clearFilters = () => { setDateFrom(''); setDateTo(''); setAcademicYear(''); setGrade(''); setStatus(''); };

  // Homework Phase 3B — نفس نمط StudentReportPage.jsx's ذو الخطوتين (معاينة ثم فتح
  // صريح)، وليس نمط AbsenceFollowup.jsx المباشر — لا فتح واتساب قبل المعاينة إطلاقاً.
  // لا استعلام بيانات جديد: الطالب الكامل (لهاتف ولي الأمر) يُقرَأ من `students` الموجودة
  // أصلاً في الشاشة، وباقي محتوى الرسالة يأتي حرفياً من صف بحث الواجبات (Phase 3A).
  const openWaPreview = (row) => {
    const student = students.find((s) => s.id === row.studentId);
    const parentPhone = getHomeworkContactPhone(student);
    const message = buildHomeworkMessage({
      studentName: row.studentName,
      homeworkTitle: row.homeworkTitle,
      subject: row.subject,
      homeworkDate: row.homeworkDate,
      status: row.status,
      score: row.score,
      totalScore: row.totalScore,
    });
    setWaPreview({ studentName: row.studentName, parentPhone, message });
  };

  const handleWaOpen = () => {
    if (!waPreview) return;
    const res = openWhatsapp(waPreview.parentPhone, waPreview.message);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success('تم فتح واتساب بالرسالة الجاهزة');
    setWaPreview(null);
  };

  return (
    <div>
      {/* Filters */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:18, alignItems:'flex-end' }}>
        <div>
          <label htmlFor="hw-search-date-from" style={LBL}>من تاريخ</label>
          <input id="hw-search-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={SEL}/>
        </div>
        <div>
          <label htmlFor="hw-search-date-to" style={LBL}>إلى تاريخ</label>
          <input id="hw-search-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={SEL}/>
        </div>
        <div>
          <label htmlFor="hw-search-academic-year" style={LBL}>السنة الدراسية</label>
          <select id="hw-search-academic-year" style={SEL} value={academicYear} onChange={(e) => setAcademicYear(e.target.value)}>
            <option value="">كل السنوات</option>
            {academicYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="hw-search-grade" style={LBL}>الصف</label>
          <select id="hw-search-grade" style={SEL} value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">كل الصفوف</option>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="hw-search-status" style={LBL}>حالة التسليم</label>
          <select id="hw-search-status" style={SEL} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">الكل</option>
            <option value="submitted">تم التسليم</option>
            <option value="not_submitted">لم يُسلَّم</option>
          </select>
        </div>
        {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters}>× مسح</Button>}
        <Button variant="secondary" size="sm" onClick={() => openHomeworkSearchReportPrint({ rows: filtered, profile: centerProfile })}>
          🖨 طباعة النتائج
        </Button>
      </div>

      <div style={{ fontSize:'0.78rem', color:'var(--text3)', marginBottom:10 }}>{filtered.length} نتيجة</div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'48px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, color:'var(--text3)' }}>
          لا توجد نتائج مطابقة
        </div>
      ) : (
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
            <thead>
              <tr style={{ background:'var(--surface2)' }}>
                {['تاريخ الواجب','عنوان الواجب','الطالب','الصف','الحالة','الدرجة',''].map((h) => (
                  <th key={h} style={{ padding:'9px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const meta = SUB_STATUS[r.status] || SUB_STATUS.missing;
                return (
                  <tr key={`${r.homeworkId}:${r.studentId}`}>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text3)' }}>{formatDate(r.homeworkDate)}</td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontWeight:600 }}>{r.homeworkTitle}</td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>{r.studentName}</td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>{r.grade || '—'}</td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'2px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:700, background:meta.bg, color:meta.color, border:`1px solid ${meta.border}` }}>
                        {meta.icon} {meta.label}
                      </span>
                    </td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem' }}>
                      {r.score != null ? `${r.score}/${r.totalScore ?? '—'}` : '—'}
                    </td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                      {shouldShowHomeworkWhatsapp(r) && (
                        <button onClick={() => openWaPreview(r)}
                          style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1rem' }}
                          aria-label="📲 متابعة عبر واتساب"
                        >
                          📲
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {waPreview && (
        <WhatsappPreviewModal
          studentName={waPreview.studentName}
          parentPhone={waPreview.parentPhone}
          message={waPreview.message}
          onCopy={copyMessage}
          onOpen={handleWaOpen}
          onClose={() => setWaPreview(null)}
        />
      )}
    </div>
  );
}
