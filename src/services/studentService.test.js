// src/services/studentService.test.js
// Phase 3B (Multi-Group Enrollment UI) — createStudent/updateStudent must send groupId as
// real null (not empty string) when no Primary Group is selected. This matters for the real
// backend request: crud.js's students.group_id branch treats an empty string as "set the
// Primary Group to the empty string" (fails, since '' is not a real group id — FK
// violation), while null correctly takes the "no Primary Group" / withdraw path. An empty
// string must never reach the network layer for this field.
import { describe, it, expect } from 'vitest';
import { createStudent, updateStudent, validateStudent } from './studentService';

const VALID_FIELDS = { name: 'أحمد محمد', phone: '01012345678', grade: 'الصف الأول الثانوي' };

describe('createStudent/updateStudent — groupId null-normalization (Phase 3B)', () => {
  it('createStudent turns an empty-string groupId into null', () => {
    const result = createStudent({ ...VALID_FIELDS, groupId: '' }, []);
    expect(result.groupId).toBeNull();
  });

  it('createStudent leaves a real groupId unchanged', () => {
    const result = createStudent({ ...VALID_FIELDS, groupId: 'g1' }, []);
    expect(result.groupId).toBe('g1');
  });

  it('updateStudent turns an empty-string groupId into null', () => {
    const result = updateStudent('s1', { ...VALID_FIELDS, groupId: '' }, []);
    expect(result.groupId).toBeNull();
  });

  it('createStudent succeeds (no thrown validation error) with no groupId at all', () => {
    expect(() => createStudent({ ...VALID_FIELDS }, [])).not.toThrow();
  });

  // Regression — validateStudent's other checks (phone duplicate/format) are unchanged.
  it('validateStudent still rejects a duplicate phone (regression)', () => {
    const existing = [{ id: 's-existing', phone: '01012345678' }];
    const errors = validateStudent({ ...VALID_FIELDS, groupId: '' }, existing, null);
    expect(errors.phone).toBeTruthy();
  });
});

// Fix 2 — the enrollment schedule rides along with the student (applied by the backend in the
// same transaction). Omitted from the payload when the caller never set it, so callers such as
// the Groups-screen Primary transfer (updateStudent({...s, groupId})) leave enrollments alone.
describe('createStudent/updateStudent — enrollment schedule fields', () => {
  it('passes primaryAttendDays and additionalGroups through unchanged', () => {
    const additionalGroups = [{ groupId: 'gB', attendDays: ['mon'] }];
    const created = createStudent({ ...VALID_FIELDS, groupId: 'gA', primaryAttendDays: ['sat'], additionalGroups }, []);
    expect(created.primaryAttendDays).toEqual(['sat']);
    expect(created.additionalGroups).toEqual(additionalGroups);

    const updated = updateStudent('s1', { ...VALID_FIELDS, groupId: 'gA', primaryAttendDays: null, additionalGroups: [] }, []);
    expect(updated.primaryAttendDays).toBeNull();
    expect(updated.additionalGroups).toEqual([]);
  });

  it('omits both fields entirely when they were not provided', () => {
    const updated = updateStudent('s1', { ...VALID_FIELDS, groupId: 'gA' }, []);
    expect(updated).not.toHaveProperty('primaryAttendDays');
    expect(updated).not.toHaveProperty('additionalGroups');
  });
});
