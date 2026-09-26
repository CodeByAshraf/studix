// src/modules/student-report/reportData.communicationsMatching.test.js
// Pre-Installer Audit D1 — gatherStudentData's `communications` used to match only by
// (phone === student.parentPhone) OR (studentName === student.name), never by studentId,
// even though the column exists and StudentsPage.jsx/GroupsPage.jsx/the backend's scoped
// GET /api/communications?studentId= already matched by it directly. A record whose phone
// no longer matches the student's current parentPhone (e.g. the parent's number changed
// after the communication was logged) was silently dropped from the report despite being
// genuinely linked via studentId. Fix: studentId is now the canonical, exclusive match for
// any record that has one; phone/name matching is kept only as a fallback for legacy
// records with no studentId at all — mirrors bookletDeliveries' studentId-first pattern.
// Pure-function test of gatherStudentData — no React, no network.
import { describe, it, expect } from 'vitest';
import { gatherStudentData } from './reportData';

const STUDENT_ID = 's1';
const STUDENT = { id: STUDENT_ID, name: 'أحمد علي', parentPhone: '01000000001', groupId: null };

function storeWith(communications) {
  return {
    students: [STUDENT], groups: [], attendance: [], hwSubmissions: [], grades: [], exams: [],
    payments: [], inventoryTxn: [], communications,
  };
}

describe('gatherStudentData — communications matching (Pre-Installer Audit D1)', () => {
  it('matches a current record by studentId', () => {
    const rec = { id: 'c1', studentId: STUDENT_ID, phone: '01000000001', studentName: 'أحمد علي', createdAt: '2026-01-01' };
    const data = gatherStudentData(STUDENT_ID, storeWith([rec]));
    expect(data.communications).toEqual([expect.objectContaining({ id: 'c1' })]);
  });

  it('still matches by studentId even when the phone no longer matches the student\'s current parentPhone (the exact regression)', () => {
    const rec = { id: 'c2', studentId: STUDENT_ID, phone: '01099999999', studentName: 'اسم مختلف تماماً', createdAt: '2026-01-01' };
    const data = gatherStudentData(STUDENT_ID, storeWith([rec]));
    expect(data.communications).toEqual([expect.objectContaining({ id: 'c2' })]);
  });

  it('falls back to phone/name matching for a legacy record with no studentId at all', () => {
    const rec = { id: 'c3', studentId: null, phone: '01000000001', studentName: null, createdAt: '2026-01-01' };
    const data = gatherStudentData(STUDENT_ID, storeWith([rec]));
    expect(data.communications).toEqual([expect.objectContaining({ id: 'c3' })]);
  });

  it('a record with a studentId belonging to a DIFFERENT student is never matched by this student\'s phone', () => {
    const rec = { id: 'c4', studentId: 'other-student', phone: '01000000001', studentName: 'أحمد علي', createdAt: '2026-01-01' };
    const data = gatherStudentData(STUDENT_ID, storeWith([rec]));
    expect(data.communications).toEqual([]);
  });

  it('a legacy record (no studentId) that matches neither phone nor name is excluded', () => {
    const rec = { id: 'c5', studentId: null, phone: '01099999999', studentName: 'شخص آخر', createdAt: '2026-01-01' };
    const data = gatherStudentData(STUDENT_ID, storeWith([rec]));
    expect(data.communications).toEqual([]);
  });
});
