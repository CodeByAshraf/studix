// src/services/attendanceService.js

import { validate, attendanceSchema, hasErrors } from '../utils/validation';

// ── Validation ────────────────────────────────────────────────────────────────
export function validateSession(data) {
  const errors = validate(attendanceSchema, data);
  // تحقق إضافي: يجب أن يكون هناك طلاب في الجلسة
  if (!data.marks || Object.keys(data.marks).length === 0) {
    errors.marks = 'لا يوجد طلاب في هذه الجلسة';
  }
  return errors;
}



export const ATTENDANCE_STATUS = {
  PRESENT: 'present',
  ABSENT:  'absent',
  LATE:    'late',
};

export const STATUS_META = {
  present: { label:'حاضر',  color:'#10b981', bg:'rgba(16,185,129,.12)', border:'rgba(16,185,129,.25)', icon:'✓' },
  absent:  { label:'غائب',  color:'#ef4444', bg:'rgba(239,68,68,.12)',  border:'rgba(239,68,68,.25)',  icon:'✗' },
  late:    { label:'متأخر', color:'#f59e0b', bg:'rgba(245,158,11,.12)', border:'rgba(245,158,11,.25)', icon:'⏱' },
  none:    { label:'—',     color:'var(--text3)', bg:'var(--surface3)', border:'var(--border)',         icon:'○' },
};

export function createAttendanceRecord(studentId, groupId, date, status, sessionTime) {
  return {
    id:          `a${Date.now()}-${Math.random().toString(36).slice(2,6)}-${studentId}`,
    studentId, groupId, date, status,
    sessionTime: sessionTime || '09:00',
    createdAt:   new Date().toISOString(),
  };
}

export function buildSessionRecords(marks, groupId, date, sessionTime) {
  return Object.entries(marks)
    .filter(([, s]) => s && s !== 'none')
    .map(([studentId, status]) =>
      createAttendanceRecord(studentId, groupId, date, status, sessionTime)
    );
}

export function getSessionRecords(groupId, date, allRecords) {
  return allRecords.filter(r => r.groupId === groupId && r.date === date);
}

export function getAttendanceStats(studentId, records) {
  const recs    = records.filter(r => r.studentId === studentId);
  const total   = recs.length;
  const present = recs.filter(r => r.status === 'present').length;
  const absent  = recs.filter(r => r.status === 'absent').length;
  const late    = recs.filter(r => r.status === 'late').length;
  const pct     = total ? Math.round(present / total * 100) : null;
  return { total, present, absent, late, pct };
}

export function getGroupAttendanceStats(groupId, records) {
  const recs    = records.filter(r => r.groupId === groupId);
  const total   = recs.length;
  const present = recs.filter(r => r.status === 'present').length;
  const absent  = recs.filter(r => r.status === 'absent').length;
  const late    = recs.filter(r => r.status === 'late').length;
  const pct     = total ? Math.round(present / total * 100) : null;
  const sessions = [...new Set(recs.map(r => r.date))];
  return { total, present, absent, late, pct, sessionCount: sessions.length };
}

export function getGroupSessions(groupId, records) {
  const recs   = records.filter(r => r.groupId === groupId);
  const byDate = {};
  recs.forEach(r => { (byDate[r.date] = byDate[r.date] || []).push(r); });
  return Object.entries(byDate)
    .sort(([a],[b]) => b.localeCompare(a))
    .map(([date, recs]) => ({
      date,
      records:      recs,
      presentCount: recs.filter(r => r.status==='present').length,
      absentCount:  recs.filter(r => r.status==='absent').length,
      lateCount:    recs.filter(r => r.status==='late').length,
      total:        recs.length,
    }));
}

// Adapter for the two remaining callers of getFrequentAbsentees that still hold a raw,
// already-loaded records array (AttendancePage.jsx's KPI tile, AttendanceAnalytics.jsx's
// widget — neither is in scope for the C4 Attendance Phase 2 migration, which only covers
// AttendanceReports.jsx's "frequent absentees" tab). Reuses getAttendanceStats per student so
// this never disagrees with that function's own present/absent/late/pct computation.
export function statsByStudentFromRecords(students, records) {
  return new Map(students.map(s => [s.id, getAttendanceStats(s.id, records)]));
}

// C4 Attendance migration Phase 2 — statsByStudentId is a Map (or plain object) keyed by
// studentId, each value shaped { total, present, absent, late } — the exact row shape
// GET /api/attendance/aggregate?groupBy=student returns, same convention as GroupCard's
// attendanceStats prop (see GroupCard.jsx/GroupsPage.jsx). Replaces the old raw-records
// param; a student with no entry (no attendance history, or excluded from the request's
// studentIds scope) is treated as zero attendance, not an error — see research.md §5.
export function getFrequentAbsentees(students, statsByStudentId, threshold = 3) {
  const getStats = (id) => (statsByStudentId instanceof Map ? statsByStudentId.get(id) : statsByStudentId[id]);
  return students
    .filter(s => s.status === 'active')
    .map(s => {
      const { total = 0, present = 0, absent = 0, late = 0 } = getStats(s.id) || {};
      const pct = total > 0 ? Math.round(present / total * 100) : null;
      return { ...s, total, present, absent, late, pct };
    })
    .filter(s => s.absent >= threshold)
    .sort((a, b) => b.absent - a.absent);
}

export function getGroupAttendanceForDate(groupId, date, records) {
  return records.filter(r => r.groupId === groupId && r.date === date);
}

// ── Absence follow-up classification ───────────────────────────────────────────
// نفس مبدأ reminderService.generateReminders بالضبط: مقارنة تقويمية (يوم كامل)، لا 24
// ساعة — غياب يوم السبت يصبح "متأخر" يوم الأحد، لا بعد 24 ساعة بالضبط. لا مكتبة تاريخ/
// منطقة زمنية جديدة، نفس أسلوب todayStr() في reminderService.js حرفياً.
function todayDateStr() {
  return new Date().toISOString().split('T')[0];
}

// followup غائب أو followStatus==='pending' = لم تتم المتابعة بعد (نفس المنطق المستخدَم
// بالفعل في AbsenceFollowup.jsx: followup?.followStatus || 'pending'). أي حالة أخرى
// (contacted/excused/unexcused) = متابعة مكتملة فعلياً → سجل.
export function classifyAbsenceFollowups(attendance = [], absenceFollowup = [], students = []) {
  const today = todayDateStr();
  const studentIds = new Set(students.map(s => s.id));
  const followupByAttendanceId = new Map(absenceFollowup.map(f => [f.attendanceId, f]));

  const active = [];
  const overdue = [];
  const history = [];

  for (const record of attendance) {
    if (record.status !== 'absent') continue;
    const student = students.find(s => s.id === record.studentId);
    if (!student || !studentIds.has(student.id)) continue; // طالب محذوف — نفس فلتر AbsenceFollowup.jsx الحالي

    const followup = followupByAttendanceId.get(record.id) || null;
    const isCompleted = !!followup && followup.followStatus !== 'pending';
    const item = { attendance: record, student, followup };

    if (isCompleted) {
      history.push(item);
    } else if (record.date < today) {
      overdue.push(item);
    } else {
      // record.date === today، أو تاريخ مستقبلي (نادر/غير متوقَّع عملياً) — يبقى ضمن
      // القائمة النشطة بدل أن يختفي بصمت من الأقسام الثلاثة كلها.
      active.push(item);
    }
  }

  return { active, overdue, history };
}
