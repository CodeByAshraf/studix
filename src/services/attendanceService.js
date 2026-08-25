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

export function getFrequentAbsentees(students, records, threshold = 3) {
  return students
    .filter(s => s.status === 'active')
    .map(s => ({ ...s, ...getAttendanceStats(s.id, records) }))
    .filter(s => s.absent >= threshold)
    .sort((a, b) => b.absent - a.absent);
}

export function getGroupAttendanceForDate(groupId, date, records) {
  return records.filter(r => r.groupId === groupId && r.date === date);
}
