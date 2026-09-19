// src/modules/homework/buildHomeworkReport.test.js
// New feature — printable homework grades report. Reuses printStyles.js (the same unified
// print system already proven by buildExamReport.js/buildPaymentsReport.js) — no new print
// engine, no new grading model.
//
// Homework 2.0 Phase 2: eligibility is grade-based (getHomeworkEligibleStudents, shared
// with HomeworkTracking.jsx/HomeworkReports.jsx/HomeworkPage.jsx) — student.grade===hw.grade
// && status==='active' — never Group membership. `group` is passed only for the report's
// display header (a homework's optional historical group tag), independent of eligibility.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openHomeworkReportPrint } from './buildHomeworkReport';

let writtenHtml;
function mockWindow() {
  writtenHtml = '';
  const win = { document: { open: vi.fn(), write: vi.fn((html) => { writtenHtml += html; }), close: vi.fn() }, focus: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(win);
  return win;
}

const GRADE_6 = 'الصف السادس الابتدائي';
const GRADE_7 = 'الصف الأول الإعدادي';

const GROUP_A = { id: 'g1', name: 'مجموعة أ' }; // display-only, independent of eligibility
const HW = { id: 'hw1', title: 'واجب الجبر', subject: 'رياضيات', teacher: 'أ. محمد', grade: GRADE_6, academicYear: '2025/2026', totalScore: 20, dueDate: '2026-01-10', status: 'active' };

// s1/s2/s3: grade 6 (matches hw.grade). s1: submitted with a score. s2: late with a score.
// s3: missing (no submission record at all -> defaults to "missing", no score). s4: SAME
// hw.id note irrelevant, but a DIFFERENT grade entirely (grade 7) — must be excluded even
// though a stray submission record exists for them, proving eligibility is by
// student.grade===hw.grade, not by whichever students happen to have a submission row (and
// never by Group membership at all — s4 isn't even given a groupId here).
const STUDENTS = [
  { id: 's1', name: 'أحمد علي',  code: 'C001', grade: GRADE_6, status: 'active' },
  { id: 's2', name: 'سارة محمد', code: 'C002', grade: GRADE_6, status: 'active' },
  { id: 's3', name: 'خالد سعيد', code: 'C003', grade: GRADE_6, status: 'active' },
  { id: 's4', name: 'منى فتحي',  code: 'C004', grade: GRADE_7, status: 'active' },
];

const SUBMISSIONS = [
  { hwId: 'hw1', studentId: 's1', status: 'submitted', submittedAt: '2026-01-09', score: 18, notes: '' },
  { hwId: 'hw1', studentId: 's2', status: 'late',      submittedAt: '2026-01-11', score: 10, notes: '' },
  // s3: no submission row at all -> missing, no score
  { hwId: 'hw1', studentId: 's4', status: 'submitted', submittedAt: '2026-01-09', score: 20, notes: '' }, // different grade
];

describe('openHomeworkReportPrint — grade-based eligibility (Homework 2.0), scores/percentage, and print header', () => {
  beforeEach(() => { mockWindow(); });

  it('includes only students whose grade matches hw.grade — a student from a different grade is excluded even with a submission row', () => {
    openHomeworkReportPrint({ hw: HW, group: GROUP_A, students: STUDENTS, hwSubmissions: SUBMISSIONS, profile: {} });
    expect(writtenHtml).toContain('أحمد علي');
    expect(writtenHtml).toContain('سارة محمد');
    expect(writtenHtml).toContain('خالد سعيد');
    expect(writtenHtml).not.toContain('منى فتحي'); // grade 7 — excluded by hw.grade, not by submission presence
  });

  it('a student with no submission row renders as "missing" with no score, not a crash or a fabricated zero', () => {
    openHomeworkReportPrint({ hw: HW, group: GROUP_A, students: STUDENTS, hwSubmissions: SUBMISSIONS, profile: {} });
    const rows = writtenHtml.split('<tr>').slice(1);
    const s3Row = rows.find(r => r.includes('خالد سعيد'));
    expect(s3Row).toContain('لم يُسلَّم');
    expect(s3Row).toContain('—'); // لا درجة
  });

  it('score and percentage render correctly: 18/20 = 90%, 10/20 = 50%', () => {
    openHomeworkReportPrint({ hw: HW, group: GROUP_A, students: STUDENTS, hwSubmissions: SUBMISSIONS, profile: {} });
    const rows = writtenHtml.split('<tr>').slice(1);

    const s1Row = rows.find(r => r.includes('أحمد علي'));
    expect(s1Row).toContain('18/20');
    expect(s1Row).toContain('90%');
    expect(s1Row).toContain('تم التسليم');

    const s2Row = rows.find(r => r.includes('سارة محمد'));
    expect(s2Row).toContain('10/20');
    expect(s2Row).toContain('50%');
    expect(s2Row).toContain('متأخر');
  });

  it('KPIs: average is computed only from scored submissions, submitted/missing counts and highest/lowest are correct', () => {
    openHomeworkReportPrint({ hw: HW, group: GROUP_A, students: STUDENTS, hwSubmissions: SUBMISSIONS, profile: {} });
    // متوسط (90+50)/2 = 70%
    expect(writtenHtml).toContain('70%');
    // تم التسليم = حصراً status==='submitted' (s1 فقط) — نفس الفصل الحالي بين
    // submitted/late/missing كفئات منفصلة في HomeworkTracking.jsx/HomeworkReports.jsx،
    // بلا دمج submitted+late هنا.
    expect(writtenHtml).toContain('1/3');
    expect(writtenHtml).toContain('1 متأخر');
    // أعلى/أدنى: 18 / 10
    expect(writtenHtml).toContain('18 / 10');
  });

  it('centerProfile.name renders exactly as entered in the report header (no derived initials)', () => {
    openHomeworkReportPrint({ hw: HW, group: GROUP_A, students: STUDENTS, hwSubmissions: SUBMISSIONS, profile: { name: 'م خالد جمعه' } });
    expect(writtenHtml).toContain('م خالد جمعه');
    expect(writtenHtml).not.toContain('مخ خالد جمعه');
    expect(writtenHtml).not.toContain('class="rh-logo rh-logo-ph"');
  });

  it('shows homework metadata (title, subject, total score) and the display-only group name', () => {
    openHomeworkReportPrint({ hw: HW, group: GROUP_A, students: STUDENTS, hwSubmissions: SUBMISSIONS, profile: {} });
    expect(writtenHtml).toContain('واجب الجبر');
    expect(writtenHtml).toContain('رياضيات');
    expect(writtenHtml).toContain('مجموعة أ');
    expect(writtenHtml).toContain('الدرجة من 20');
  });

  it('renders correctly with no group at all (Homework 2.0: a homework may have no historical group tag)', () => {
    openHomeworkReportPrint({ hw: HW, group: null, students: STUDENTS, hwSubmissions: SUBMISSIONS, profile: {} });
    expect(writtenHtml).toContain('واجب الجبر');
    expect(writtenHtml).not.toContain('— مجموعة أ');
  });

  it('an empty grade (zero eligible students) shows the honest empty-state row instead of crashing', () => {
    openHomeworkReportPrint({ hw: HW, group: GROUP_A, students: [], hwSubmissions: [], profile: {} });
    expect(writtenHtml).toContain('لا يوجد طلاب');
  });

  it('does nothing (no window opened) when no homework is given', () => {
    openHomeworkReportPrint({ hw: null, group: GROUP_A, students: STUDENTS, hwSubmissions: SUBMISSIONS, profile: {} });
    expect(window.open).not.toHaveBeenCalled();
  });
});
