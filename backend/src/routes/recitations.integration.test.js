// backend/src/routes/recitations.integration.test.js
// Recitation Assessment — Phase 2, Parts B & C: the dedicated recitations.js route.
//
// Real PostgreSQL integration (scratch database), same pattern/helpers as
// attendanceSessions.integration.test.js / examGrades.integration.test.js: exported
// functions called directly, no HTTP/auth layer here (that boundary is covered
// separately by recitationsAuth.integration.test.js).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';

const dbCheck = await checkPostgresReachable();

describe('routes/recitations.js — Recitation Phase 2 Parts B & C (real PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client;
  let saveAttendanceSession, completeAttendanceSession;
  let listCompletedSessions, getRecitationSession, saveRecitations, completeRecitationSession;
  let setPrimaryGroup;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('recitations_phase2_bc');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    ({ saveAttendanceSession, completeAttendanceSession } = await import('./attendanceSessions.js'));
    ({ listCompletedSessions, getRecitationSession, saveRecitations, completeRecitationSession } = await import('./recitations.js'));
    ({ setPrimaryGroup } = await import('../lib/enrollmentService.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedGroup({ name = 'مجموعة', days = ['sat'] } = {}) {
    const id = nextId('g');
    await client.groups.create({ data: { id, name, price: 100, days } });
    return id;
  }

  async function seedStudent(name = 'طالب', overrides = {}) {
    const id = nextId('s');
    await client.students.create({ data: { id, name, code: nextId('code'), ...overrides } });
    return id;
  }

  async function seedEnrolledStudent(groupId, name, overrides = {}) {
    const studentId = await seedStudent(name, overrides);
    await setPrimaryGroup(studentId, groupId, { effectiveDate: '2026-01-01' });
    return studentId;
  }

  // date is always a Saturday (matches the seeded groups' days: ['sat']).
  async function seedCompletedSession(groupId, date, statusByStudent) {
    const records = Object.entries(statusByStudent).map(([studentId, status]) => ({ studentId, status }));
    await saveAttendanceSession({ groupId, date, sessionTime: '09:00', records });
    await completeAttendanceSession({ groupId, date }, { userId: null });
  }

  const SAT1 = '2026-01-03';
  const SAT2 = '2026-01-10';

  // ── 7. list completed sessions ─────────────────────────────────────────────────────
  it('7. completed sessions can be listed, sorted newest first, draft sessions excluded', async () => {
    const groupId = await seedGroup();
    const s1 = await seedEnrolledStudent(groupId, 'A');
    await seedCompletedSession(groupId, SAT1, { [s1]: 'present' });
    await seedCompletedSession(groupId, SAT2, { [s1]: 'present' });
    // a draft session (never completed) for the same group, different date
    const s2 = await seedEnrolledStudent(groupId, 'B');
    await saveAttendanceSession({ groupId, date: '2026-01-17', sessionTime: '09:00', records: [{ studentId: s2, status: 'present' }] });

    const list = await listCompletedSessions({ limit: 10 });

    const forThisGroup = list.filter((s) => s.groupId === groupId);
    expect(forThisGroup).toHaveLength(2);
    expect(forThisGroup[0].date).toBe(SAT2); // newest first
    expect(forThisGroup[1].date).toBe(SAT1);
    expect(forThisGroup[0].recitationStatus).toBe('not_started');
    expect(forThisGroup[0].attendeeCount).toBe(1);
    expect(forThisGroup[0].evaluatedCount).toBe(0);
  });

  // ── 8/9. load one recitation session — present/late only, absent excluded ─────────
  it('8. recitation session load returns only present/late students, with group/session info', async () => {
    const groupId = await seedGroup();
    const present = await seedEnrolledStudent(groupId, 'Present');
    const late = await seedEnrolledStudent(groupId, 'Late');
    const absent = await seedEnrolledStudent(groupId, 'Absent');
    await seedCompletedSession(groupId, SAT1, { [present]: 'present', [late]: 'late', [absent]: 'absent' });

    const data = await getRecitationSession({ groupId, date: SAT1 });

    expect(data.session.groupId).toBe(groupId);
    expect(data.session.date).toBe(SAT1);
    expect(data.session.status).toBe('completed');
    const rosterIds = data.roster.map((r) => r.studentId);
    expect(rosterIds).toContain(present);
    expect(rosterIds).toContain(late);
    expect(rosterIds).not.toContain(absent); // 9. absent student is not a recitation candidate
    expect(data.roster).toHaveLength(2);
  });

  it('recitation session load includes phone/parentPhone per roster student, correctly scoped (Recitation WhatsApp)', async () => {
    const groupId = await seedGroup();
    const withParentPhone = await seedEnrolledStudent(groupId, 'WithParentPhone', { phone: '01011110000', parent_phone: '01022220000' });
    const withOnlyOwnPhone = await seedEnrolledStudent(groupId, 'OwnPhoneOnly', { phone: '01033330000' });
    const withNoPhone = await seedEnrolledStudent(groupId, 'NoPhone');
    await seedCompletedSession(groupId, SAT1, { [withParentPhone]: 'present', [withOnlyOwnPhone]: 'present', [withNoPhone]: 'present' });

    const data = await getRecitationSession({ groupId, date: SAT1 });

    const r1 = data.roster.find((r) => r.studentId === withParentPhone);
    const r2 = data.roster.find((r) => r.studentId === withOnlyOwnPhone);
    const r3 = data.roster.find((r) => r.studentId === withNoPhone);
    expect(r1.phone).toBe('01011110000');
    expect(r1.parentPhone).toBe('01022220000');
    expect(r2.phone).toBe('01033330000');
    expect(r2.parentPhone).toBeNull();
    expect(r3.phone).toBeNull();
    expect(r3.parentPhone).toBeNull();
  });

  it('load fails clearly for a session whose attendance was never completed', async () => {
    const groupId = await seedGroup();
    const studentId = await seedEnrolledStudent(groupId);
    await saveAttendanceSession({ groupId, date: SAT1, sessionTime: '09:00', records: [{ studentId, status: 'present' }] });

    await expect(getRecitationSession({ groupId, date: SAT1 })).rejects.toThrow();
  });

  // ── 10/11/12. save — happy path + validation ───────────────────────────────────────
  it('10. recitation save works — creates rows, sets session max_score, sets recitation_status to in_progress', async () => {
    const groupId = await seedGroup();
    const s1 = await seedEnrolledStudent(groupId, 'A');
    const s2 = await seedEnrolledStudent(groupId, 'B');
    await seedCompletedSession(groupId, SAT1, { [s1]: 'present', [s2]: 'late' });

    const result = await saveRecitations({
      groupId, date: SAT1, maxScore: 20,
      records: [{ studentId: s1, score: 15, note: 'جيد' }, { studentId: s2, score: 20 }],
    }, { userId: null });

    expect(result.session.maxScore).toBe(20);
    expect(result.session.recitationStatus).toBe('in_progress');
    expect(result.records).toHaveLength(2);
    const r1 = result.records.find((r) => r.studentId === s1);
    expect(r1.score).toBe(15);
    expect(r1.maxScore).toBe(20);
    expect(r1.note).toBe('جيد');
  });

  it('11. negative score rejected, no rows persisted', async () => {
    const groupId = await seedGroup();
    const s1 = await seedEnrolledStudent(groupId);
    await seedCompletedSession(groupId, SAT1, { [s1]: 'present' });

    await expect(saveRecitations({
      groupId, date: SAT1, maxScore: 20, records: [{ studentId: s1, score: -1 }],
    }, { userId: null })).rejects.toThrow();

    const rows = await client.recitations.findMany({ where: { group_id: groupId } });
    expect(rows).toHaveLength(0);
  });

  it('12. score above max rejected, no rows persisted', async () => {
    const groupId = await seedGroup();
    const s1 = await seedEnrolledStudent(groupId);
    await seedCompletedSession(groupId, SAT1, { [s1]: 'present' });

    await expect(saveRecitations({
      groupId, date: SAT1, maxScore: 20, records: [{ studentId: s1, score: 21 }],
    }, { userId: null })).rejects.toThrow();

    const rows = await client.recitations.findMany({ where: { group_id: groupId } });
    expect(rows).toHaveLength(0);
  });

  // ── 13. max_score is immutable once established ────────────────────────────────────
  it('13. max_score cannot be silently changed after it is established', async () => {
    const groupId = await seedGroup();
    const s1 = await seedEnrolledStudent(groupId);
    await seedCompletedSession(groupId, SAT1, { [s1]: 'present' });

    await saveRecitations({ groupId, date: SAT1, maxScore: 20, records: [{ studentId: s1, score: 10 }] }, { userId: null });

    await expect(saveRecitations({
      groupId, date: SAT1, maxScore: 50, records: [{ studentId: s1, score: 10 }],
    }, { userId: null })).rejects.toThrow();

    const session = await client.attendance_sessions.findUnique({
      where: { group_id_date: { group_id: groupId, date: new Date(`${SAT1}T00:00:00.000Z`) } },
    });
    expect(Number(session.max_score)).toBe(20); // unchanged
  });

  // ── 14. partial coverage ────────────────────────────────────────────────────────────
  it('14. partial recitation save works — only some present students scored, others left untouched', async () => {
    const groupId = await seedGroup();
    const s1 = await seedEnrolledStudent(groupId, 'A');
    const s2 = await seedEnrolledStudent(groupId, 'B');
    await seedCompletedSession(groupId, SAT1, { [s1]: 'present', [s2]: 'present' });

    const result = await saveRecitations({
      groupId, date: SAT1, maxScore: 10, records: [{ studentId: s1, score: 8 }],
    }, { userId: null });

    expect(result.records).toHaveLength(1);
    const rows = await client.recitations.findMany({ where: { group_id: groupId, date: new Date(`${SAT1}T00:00:00.000Z`) } });
    expect(rows).toHaveLength(1); // s2 never got a row — no delete-diff, no destructive behavior
  });

  it('re-saving updates an existing student\'s row (upsert) without duplicating it', async () => {
    const groupId = await seedGroup();
    const s1 = await seedEnrolledStudent(groupId);
    await seedCompletedSession(groupId, SAT1, { [s1]: 'present' });

    await saveRecitations({ groupId, date: SAT1, maxScore: 10, records: [{ studentId: s1, score: 5 }] }, { userId: null });
    await saveRecitations({ groupId, date: SAT1, maxScore: 10, records: [{ studentId: s1, score: 9, note: 'أفضل' }] }, { userId: null });

    const rows = await client.recitations.findMany({ where: { group_id: groupId, student_id: s1 } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].score)).toBe(9);
    expect(rows[0].note).toBe('أفضل');
  });

  it('a non-roster (absent) student in the save payload rejects the whole save', async () => {
    const groupId = await seedGroup();
    const present = await seedEnrolledStudent(groupId, 'Present');
    const absent = await seedEnrolledStudent(groupId, 'Absent');
    await seedCompletedSession(groupId, SAT1, { [present]: 'present', [absent]: 'absent' });

    await expect(saveRecitations({
      groupId, date: SAT1, maxScore: 10,
      records: [{ studentId: present, score: 5 }, { studentId: absent, score: 5 }],
    }, { userId: null })).rejects.toThrow();

    const rows = await client.recitations.findMany({ where: { group_id: groupId } });
    expect(rows).toHaveLength(0); // whole save rejected, including the valid student
  });

  // ── 15. session isolation ───────────────────────────────────────────────────────────
  it('15. recitation from session A cannot affect session B (same group, different date)', async () => {
    const groupId = await seedGroup();
    const s1 = await seedEnrolledStudent(groupId);
    await seedCompletedSession(groupId, SAT1, { [s1]: 'present' });
    await seedCompletedSession(groupId, SAT2, { [s1]: 'present' });

    await saveRecitations({ groupId, date: SAT1, maxScore: 10, records: [{ studentId: s1, score: 3 }] }, { userId: null });
    await saveRecitations({ groupId, date: SAT2, maxScore: 20, records: [{ studentId: s1, score: 18 }] }, { userId: null });

    const rowsSat1 = await client.recitations.findMany({ where: { group_id: groupId, date: new Date(`${SAT1}T00:00:00.000Z`) } });
    const rowsSat2 = await client.recitations.findMany({ where: { group_id: groupId, date: new Date(`${SAT2}T00:00:00.000Z`) } });
    expect(rowsSat1).toHaveLength(1);
    expect(Number(rowsSat1[0].score)).toBe(3);
    expect(Number(rowsSat1[0].max_score)).toBe(10);
    expect(rowsSat2).toHaveLength(1);
    expect(Number(rowsSat2[0].score)).toBe(18);
    expect(Number(rowsSat2[0].max_score)).toBe(20);
  });

  // ── 16/17/18. complete recitation ───────────────────────────────────────────────────
  it('16. recitation completion works with partial coverage (12/18-style) — no full-coverage requirement', async () => {
    const groupId = await seedGroup();
    const s1 = await seedEnrolledStudent(groupId, 'A');
    const s2 = await seedEnrolledStudent(groupId, 'B');
    await seedCompletedSession(groupId, SAT1, { [s1]: 'present', [s2]: 'present' });
    await saveRecitations({ groupId, date: SAT1, maxScore: 10, records: [{ studentId: s1, score: 7 }] }, { userId: null });

    const result = await completeRecitationSession({ groupId, date: SAT1 }, { userId: null });

    expect(result.recitationStatus).toBe('completed');
    expect(result.recitationCompletedAt).toBeTruthy();
  });

  it('17. completed recitation rejects further writes (409-style)', async () => {
    const groupId = await seedGroup();
    const s1 = await seedEnrolledStudent(groupId);
    await seedCompletedSession(groupId, SAT1, { [s1]: 'present' });
    await saveRecitations({ groupId, date: SAT1, maxScore: 10, records: [{ studentId: s1, score: 7 }] }, { userId: null });
    await completeRecitationSession({ groupId, date: SAT1 }, { userId: null });

    await expect(saveRecitations({
      groupId, date: SAT1, maxScore: 10, records: [{ studentId: s1, score: 9 }],
    }, { userId: null })).rejects.toMatchObject({ status: 409 });

    const row = await client.recitations.findFirst({ where: { group_id: groupId, student_id: s1 } });
    expect(Number(row.score)).toBe(7); // unchanged
  });

  it('18. recitation completion is race-safe — two concurrent completions, exactly one succeeds', async () => {
    const groupId = await seedGroup();
    const s1 = await seedEnrolledStudent(groupId);
    await seedCompletedSession(groupId, SAT1, { [s1]: 'present' });
    await saveRecitations({ groupId, date: SAT1, maxScore: 10, records: [{ studentId: s1, score: 7 }] }, { userId: null });

    const results = await Promise.allSettled([
      completeRecitationSession({ groupId, date: SAT1 }, { userId: null }),
      completeRecitationSession({ groupId, date: SAT1 }, { userId: null }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ status: 409 });
  });

  it('18b. concurrent saveRecitations vs completeRecitationSession is race-safe — recitation_status always ends completed; whichever way the race resolves, data is never left partially written or silently corrupted', async () => {
    const groupId = await seedGroup();
    const s1 = await seedEnrolledStudent(groupId);
    await seedCompletedSession(groupId, SAT1, { [s1]: 'present' });
    // Establish an initial saved score first, so "untouched if save lost the race" is checkable precisely.
    await saveRecitations({ groupId, date: SAT1, maxScore: 10, records: [{ studentId: s1, score: 5 }] }, { userId: null });

    const results = await Promise.allSettled([
      saveRecitations({ groupId, date: SAT1, maxScore: 10, records: [{ studentId: s1, score: 9 }] }, { userId: null }),
      completeRecitationSession({ groupId, date: SAT1 }, { userId: null }),
    ]);
    const [saveResult, completeResult] = results;

    // Complete succeeds in this race regardless of ordering — nothing about a concurrent save
    // (which never touches recitation_status itself, except draft->in_progress) prevents it.
    expect(completeResult.status).toBe('fulfilled');
    const session = await client.attendance_sessions.findUnique({
      where: { group_id_date: { group_id: groupId, date: new Date(`${SAT1}T00:00:00.000Z`) } },
    });
    expect(session.recitation_status).toBe('completed');

    const row = await client.recitations.findFirst({ where: { group_id: groupId, student_id: s1 } });
    if (saveResult.status === 'fulfilled') {
      // The save won the race (ran to completion before the lock was taken by complete) — its
      // value is the final, real state, not a half-applied write.
      expect(Number(row.score)).toBe(9);
    } else {
      // The save lost the race — cleanly rejected with the existing 409 contract, and the
      // pre-existing row is completely untouched (not partially overwritten).
      expect(saveResult.reason).toMatchObject({ status: 409 });
      expect(Number(row.score)).toBe(5);
    }
  });

  it('19b. concurrent first-time saveRecitations calls never let a later one silently overwrite the now-immutable max_score', async () => {
    const groupId = await seedGroup();
    const s1 = await seedEnrolledStudent(groupId, 'A');
    const s2 = await seedEnrolledStudent(groupId, 'B');
    await seedCompletedSession(groupId, SAT1, { [s1]: 'present', [s2]: 'present' });

    const results = await Promise.allSettled([
      saveRecitations({ groupId, date: SAT1, maxScore: 10, records: [{ studentId: s1, score: 5 }] }, { userId: null }),
      saveRecitations({ groupId, date: SAT1, maxScore: 20, records: [{ studentId: s2, score: 15 }] }, { userId: null }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    // Exactly one establishes max_score for real; the other is rejected for conflicting with
    // the now-fixed value — never both silently succeeding with two different max scores.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/الدرجة الكلية/);

    const session = await client.attendance_sessions.findUnique({
      where: { group_id_date: { group_id: groupId, date: new Date(`${SAT1}T00:00:00.000Z`) } },
    });
    expect([10, 20]).toContain(Number(session.max_score)); // one real value, never overwritten afterward
  });

  it('attendance not yet completed blocks recitation completion too', async () => {
    const groupId = await seedGroup();
    const s1 = await seedEnrolledStudent(groupId);
    await saveAttendanceSession({ groupId, date: SAT1, sessionTime: '09:00', records: [{ studentId: s1, status: 'present' }] });

    await expect(completeRecitationSession({ groupId, date: SAT1 }, { userId: null })).rejects.toThrow();
  });

  // ── 19. multi-group isolation ───────────────────────────────────────────────────────
  it('19. a multi-group student\'s recitations stay isolated by group — Group A score never appears under Group B', async () => {
    const groupA = await seedGroup({ name: 'A' });
    const groupB = await seedGroup({ name: 'B', days: ['sun'] });
    const studentId = await seedStudent('Multi');
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    const { addAdditionalEnrollment } = await import('../lib/enrollmentService.js');
    await addAdditionalEnrollment(studentId, groupB, { effectiveDate: '2026-01-01' });

    const SUNDAY = '2026-01-04';
    await seedCompletedSession(groupA, SAT1, { [studentId]: 'present' });
    await seedCompletedSession(groupB, SUNDAY, { [studentId]: 'present' });

    await saveRecitations({ groupId: groupA, date: SAT1, maxScore: 10, records: [{ studentId, score: 4 }] }, { userId: null });
    await saveRecitations({ groupId: groupB, date: SUNDAY, maxScore: 10, records: [{ studentId, score: 9 }] }, { userId: null });

    const rowsA = await client.recitations.findMany({ where: { group_id: groupA, student_id: studentId } });
    const rowsB = await client.recitations.findMany({ where: { group_id: groupB, student_id: studentId } });
    expect(rowsA).toHaveLength(1);
    expect(Number(rowsA[0].score)).toBe(4);
    expect(rowsB).toHaveLength(1);
    expect(Number(rowsB[0].score)).toBe(9);
  });
});
