// src/services/attendanceService.frequentAbsentees.test.js
// C4 Attendance migration Phase 2 — getFrequentAbsentees now takes a per-student stats lookup
// (Map keyed by studentId, shaped like the GET /api/attendance/aggregate?groupBy=student row:
// {total, present, absent, late}) instead of a raw attendance records array, mirroring the
// GroupCard/GroupsPage attendanceStats convention. See spec.md FR-002/FR-008/FR-010,
// data-model.md, and research.md §3/§5.
import { describe, it, expect } from 'vitest';
import { getFrequentAbsentees, statsByStudentFromRecords } from './attendanceService';

const S1 = { id: 's1', name: 'أحمد', status: 'active', groupId: 'g1' };
const S2 = { id: 's2', name: 'سارة', status: 'active', groupId: 'g1' };
const S3 = { id: 's3', name: 'محمد', status: 'suspended', groupId: 'g1' };

describe('getFrequentAbsentees — pre-aggregated stats lookup (C4 Attendance migration Phase 2)', () => {
  it('only includes active students, even if an inactive student has a stats entry with high absences', () => {
    const stats = new Map([
      ['s1', { total: 10, present: 5, absent: 5, late: 0 }],
      ['s3', { total: 10, present: 1, absent: 9, late: 0 }], // suspended — must never appear
    ]);
    const result = getFrequentAbsentees([S1, S2, S3], stats, 2);
    expect(result.map(s => s.id)).toEqual(['s1']);
  });

  it('a student with no entry in the stats lookup is treated as absent: 0 / pct: null, never appearing at any threshold >= 2', () => {
    const stats = new Map([
      ['s1', { total: 4, present: 4, absent: 0, late: 0 }],
      // s2 has no entry at all — zero attendance history
    ]);
    const result = getFrequentAbsentees([S1, S2], stats, 2);
    expect(result).toEqual([]);

    const atZeroThreshold = getFrequentAbsentees([S1, S2], stats, 0);
    const s2Row = atZeroThreshold.find(s => s.id === 's2');
    expect(s2Row).toMatchObject({ absent: 0, pct: null, total: 0, present: 0, late: 0 });
  });

  it('filters by absent >= threshold', () => {
    const stats = new Map([
      ['s1', { total: 10, present: 8, absent: 2, late: 0 }],
      ['s2', { total: 10, present: 5, absent: 5, late: 0 }],
    ]);
    expect(getFrequentAbsentees([S1, S2], stats, 3).map(s => s.id)).toEqual(['s2']);
    expect(getFrequentAbsentees([S1, S2], stats, 2).map(s => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('sorts descending by absent count', () => {
    const stats = new Map([
      ['s1', { total: 10, present: 5, absent: 5, late: 0 }],
      ['s2', { total: 10, present: 1, absent: 9, late: 0 }],
    ]);
    const result = getFrequentAbsentees([S1, S2], stats, 2);
    expect(result.map(s => s.id)).toEqual(['s2', 's1']);
  });

  it('computes pct as round(present/total*100), and null when total is 0', () => {
    const stats = new Map([
      ['s1', { total: 3, present: 1, absent: 2, late: 0 }],
    ]);
    const result = getFrequentAbsentees([S1], stats, 2);
    expect(result[0].pct).toBe(33);
  });
});

describe('statsByStudentFromRecords — adapter for callers still holding a raw records array (AttendancePage.jsx, AttendanceAnalytics.jsx)', () => {
  it('produces the same per-student stats getFrequentAbsentees would get from a real aggregate response, from a raw records array', () => {
    const records = [
      { studentId: 's1', status: 'present' },
      { studentId: 's1', status: 'absent' },
      { studentId: 's1', status: 'absent' },
      { studentId: 's2', status: 'present' },
    ];
    const stats = statsByStudentFromRecords([S1, S2], records);
    expect(getFrequentAbsentees([S1, S2], stats, 2).map(s => s.id)).toEqual(['s1']);
    expect(stats.get('s1')).toMatchObject({ total: 3, present: 1, absent: 2, late: 0 });
  });
});
