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
