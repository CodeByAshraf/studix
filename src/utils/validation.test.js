// src/utils/validation.test.js
// Phase 3B (Multi-Group Enrollment UI) — studentSchema.groupId is no longer required: a
// student may have zero Primary Groups (Additional Groups, or none at all, are managed
// through the Phase 3A enrollment API instead of the single groupId field). Every other
// studentSchema rule is unchanged — covered here as a regression check.
import { describe, it, expect } from 'vitest';
import { validate, hasErrors, studentSchema } from './validation';

const VALID_BASE = { name: 'أحمد محمد', phone: '01012345678', grade: 'الصف الأول الثانوي' };

describe('studentSchema — groupId is optional (Phase 3B)', () => {
  it('an empty-string groupId produces no validation error', () => {
    const errors = validate(studentSchema, { ...VALID_BASE, groupId: '' });
    expect(errors.groupId).toBeUndefined();
    expect(hasErrors(errors)).toBe(false);
  });

  it('a null groupId produces no validation error', () => {
    const errors = validate(studentSchema, { ...VALID_BASE, groupId: null });
    expect(errors.groupId).toBeUndefined();
    expect(hasErrors(errors)).toBe(false);
  });

  it('a groupId key entirely absent from the data produces no validation error', () => {
    const errors = validate(studentSchema, { ...VALID_BASE });
    expect(errors.groupId).toBeUndefined();
    expect(hasErrors(errors)).toBe(false);
  });

  it('a real groupId still validates successfully (unchanged behavior)', () => {
    const errors = validate(studentSchema, { ...VALID_BASE, groupId: 'g1' });
    expect(hasErrors(errors)).toBe(false);
  });

  // Regression — every OTHER studentSchema rule is unchanged.
  it('name/phone/grade are still required (regression)', () => {
    const errors = validate(studentSchema, { name: '', phone: '', grade: '', groupId: '' });
    expect(errors.name).toBeTruthy();
    expect(errors.phone).toBeTruthy();
    expect(errors.grade).toBeTruthy();
  });

  it('an invalid phone still fails validation (regression)', () => {
    const errors = validate(studentSchema, { ...VALID_BASE, phone: '123', groupId: '' });
    expect(errors.phone).toBeTruthy();
  });
});
