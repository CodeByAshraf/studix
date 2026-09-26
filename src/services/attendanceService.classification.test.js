// src/services/attendanceService.classification.test.js
// متابعة الغياب — تصنيف classifyAbsenceFollowups (تدقيق: لماذا تتراكم الغيابات القديمة
// بلا حدّ، ثم التنفيذ). نفس أسلوب reminderService.test.js بالضبط في حساب "اليوم"/"أمس"
// (بلا محاكاة الساعة، new Date() الحقيقي)، بلا مكتبة تاريخ جديدة.
import { describe, it, expect } from 'vitest';
import { classifyAbsenceFollowups } from './attendanceService';

function todayStr() { return new Date().toISOString().split('T')[0]; }
function pastStr(daysAgo) { return new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0]; }

const STUDENT = { id: 's1', name: 'أحمد' };

describe('classifyAbsenceFollowups', () => {
  it("1. today's unresolved absence -> active", () => {
    const attendance = [{ id: 'a1', studentId: 's1', groupId: 'g1', date: todayStr(), status: 'absent' }];
    const { active, overdue, history } = classifyAbsenceFollowups(attendance, [], [STUDENT]);
    expect(active.map(x => x.attendance.id)).toEqual(['a1']);
    expect(overdue).toEqual([]);
    expect(history).toEqual([]);
  });

  it("2. yesterday's unresolved absence -> overdue (calendar-day comparison, not 24h)", () => {
    const attendance = [{ id: 'a2', studentId: 's1', groupId: 'g1', date: pastStr(1), status: 'absent' }];
    const { active, overdue } = classifyAbsenceFollowups(attendance, [], [STUDENT]);
    expect(overdue.map(x => x.attendance.id)).toEqual(['a2']);
    expect(active).toEqual([]);
  });

  it('3. a completed follow-up -> history/resolved, regardless of how old the absence is', () => {
    const attendance = [{ id: 'a3', studentId: 's1', groupId: 'g1', date: pastStr(10), status: 'absent' }];
    const followup = [{ id: 'f1', attendanceId: 'a3', followStatus: 'contacted' }];
    const { active, overdue, history } = classifyAbsenceFollowups(attendance, followup, [STUDENT]);
    expect(history.map(x => x.attendance.id)).toEqual(['a3']);
    expect(active).toEqual([]);
    expect(overdue).toEqual([]);
  });

  it("an explicit followStatus:'pending' row still counts as unresolved, not completed (preserves the existing pending-default rule)", () => {
    const attendance = [{ id: 'a3b', studentId: 's1', groupId: 'g1', date: pastStr(2), status: 'absent' }];
    const followup = [{ id: 'f1b', attendanceId: 'a3b', followStatus: 'pending' }];
    const { overdue, history } = classifyAbsenceFollowups(attendance, followup, [STUDENT]);
    expect(overdue.map(x => x.attendance.id)).toEqual(['a3b']);
    expect(history).toEqual([]);
  });

  it('4. a historical unresolved absence remains accessible — bucketed as overdue, never dropped', () => {
    const attendance = [{ id: 'a4', studentId: 's1', groupId: 'g1', date: pastStr(200), status: 'absent' }];
    const { overdue } = classifyAbsenceFollowups(attendance, [], [STUDENT]);
    expect(overdue).toHaveLength(1);
  });

  it('5. a deleted/missing student is excluded entirely from every bucket', () => {
    const attendance = [{ id: 'a5', studentId: 'ghost', groupId: 'g1', date: pastStr(1), status: 'absent' }];
    const { active, overdue, history } = classifyAbsenceFollowups(attendance, [], [STUDENT]);
    expect([...active, ...overdue, ...history]).toEqual([]);
  });

  it('6. multiple attendance records for the same student remain independent (each its own case)', () => {
    const attendance = [
      { id: 'a6a', studentId: 's1', groupId: 'g1', date: pastStr(1), status: 'absent' },
      { id: 'a6b', studentId: 's1', groupId: 'g1', date: pastStr(2), status: 'absent' },
    ];
    const { overdue } = classifyAbsenceFollowups(attendance, [], [STUDENT]);
    expect(overdue.map(x => x.attendance.id).sort()).toEqual(['a6a', 'a6b']);
  });

  it('ignores present/late attendance records entirely (only status===absent is classified)', () => {
    const attendance = [{ id: 'a7', studentId: 's1', groupId: 'g1', date: pastStr(1), status: 'present' }];
    const { active, overdue, history } = classifyAbsenceFollowups(attendance, [], [STUDENT]);
    expect([...active, ...overdue, ...history]).toEqual([]);
  });

  it('does not mutate the input attendance/absenceFollowup arrays or records', () => {
    const attendance = [{ id: 'a8', studentId: 's1', groupId: 'g1', date: pastStr(1), status: 'absent' }];
    const followup = [];
    const attendanceCopy = JSON.parse(JSON.stringify(attendance));
    classifyAbsenceFollowups(attendance, followup, [STUDENT]);
    expect(attendance).toEqual(attendanceCopy);
    expect(followup).toEqual([]);
  });
});
