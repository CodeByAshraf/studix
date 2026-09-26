// backend/src/lib/attendanceEligibility.integration.test.js
// Phase 2 (Multi-Group Enrollment — Attendance Eligibility). Real PostgreSQL integration
// (scratch database only), same pattern as enrollmentService.integration.test.js:
// setupScratchDb (db push, base schema.prisma shape) + applyFullSchemaDDL (backend/migrations/
// *.sql — needed here specifically for the student_group_enrollments table, its partial
// unique indexes, and its CHECK constraints, none of which schema.prisma/db push represent).
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';

const dbCheck = await checkPostgresReachable();

describe('attendanceEligibility.js — real PostgreSQL integration', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let dayCodeOf;
  let getEligibleEnrollmentsForGroupDate;
  let getEligibleStudentIdsForGroupDate;
  let isStudentEligibleForGroupDate;
  let setPrimaryGroup;
  let addAdditionalEnrollment;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('attendance_eligibility');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    ({
      dayCodeOf,
      getEligibleEnrollmentsForGroupDate,
      getEligibleStudentIdsForGroupDate,
      isStudentEligibleForGroupDate,
    } = await import('./attendanceEligibility.js'));
    ({ setPrimaryGroup, addAdditionalEnrollment } = await import('./enrollmentService.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedGroup({ name = 'مجموعة', days = ['sat', 'tue'] } = {}) {
    const id = nextId('g');
    await client.groups.create({ data: { id, name, price: 100, days } });
    return id;
  }

  async function seedStudent() {
    const id = nextId('s');
    await client.students.create({ data: { id, name: 'طالب', code: nextId('code') } });
    return id;
  }

  // 2026-01-03 is a Saturday, 2026-01-06 is a Tuesday (both UTC, matching the app's
  // date-only convention — see enrollmentService.js's normalizeDate comment).
  const SATURDAY = '2026-01-03';
  const TUESDAY = '2026-01-06';
  const SUNDAY = '2026-01-04';

  // ── dayCodeOf sanity — the pattern this module reproduces from
  // src/modules/reports/AttendanceAnalytics.jsx (JS Date.getDay(), 0=Sunday..6=Saturday) ──
  it('0. dayCodeOf maps known real dates to the correct 3-letter day code', () => {
    expect(dayCodeOf(SATURDAY)).toBe('sat');
    expect(dayCodeOf(TUESDAY)).toBe('tue');
    expect(dayCodeOf(SUNDAY)).toBe('sun');
  });

  // ── 1. Primary enrollment + attend_days = NULL falls back to group.days ──────────────
  it('1. Primary enrollment with attend_days=NULL is eligible on every day the group meets', async () => {
    const groupId = await seedGroup({ days: ['sat', 'tue'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupId, { effectiveDate: '2026-01-01' });

    expect(await isStudentEligibleForGroupDate(studentId, groupId, SATURDAY)).toBe(true);
    expect(await isStudentEligibleForGroupDate(studentId, groupId, TUESDAY)).toBe(true);
    expect(await isStudentEligibleForGroupDate(studentId, groupId, SUNDAY)).toBe(false);
  });

  // ── 2 & 7. Primary enrollment + restricted attend_days ────────────────────────────────
  it('2/7. Primary enrollment with attend_days=["sat"] is eligible Saturday, not eligible Tuesday even though the group meets both days', async () => {
    const groupId = await seedGroup({ days: ['sat', 'tue'] }); // the prompt's own example
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupId, { effectiveDate: '2026-01-01' });
    await client.student_group_enrollments.updateMany({
      where: { student_id: studentId, group_id: groupId, role: 'primary' },
      data: { attend_days: ['sat'] },
    });

    expect(await isStudentEligibleForGroupDate(studentId, groupId, SATURDAY)).toBe(true);
    expect(await isStudentEligibleForGroupDate(studentId, groupId, TUESDAY)).toBe(false);
  });

  // ── 3. Additional enrollment behaves identically to Primary ───────────────────────────
  it('3. Additional enrollment with restricted attend_days is eligible/ineligible exactly like a Primary one would be', async () => {
    const primaryGroup = await seedGroup({ name: 'أساسية', days: ['sun'] });
    const additionalGroup = await seedGroup({ name: 'إضافية', days: ['sat', 'tue'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, primaryGroup, { effectiveDate: '2026-01-01' });
    const additional = await addAdditionalEnrollment(studentId, additionalGroup, { effectiveDate: '2026-01-01' });
    await client.student_group_enrollments.update({
      where: { id: additional.id },
      data: { attend_days: ['sat'] },
    });

    expect(await isStudentEligibleForGroupDate(studentId, additionalGroup, SATURDAY)).toBe(true);
    expect(await isStudentEligibleForGroupDate(studentId, additionalGroup, TUESDAY)).toBe(false);
  });

  // ── 4. Date before start_date ──────────────────────────────────────────────────────────
  it('4. a date before the enrollment start_date is not eligible', async () => {
    const groupId = await seedGroup({ days: ['sat', 'tue'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupId, { effectiveDate: '2026-01-07' }); // starts after TUESDAY (01-06)

    expect(await isStudentEligibleForGroupDate(studentId, groupId, TUESDAY)).toBe(false);
  });

  // ── 5. Date after end_date ─────────────────────────────────────────────────────────────
  it('5. a date after the enrollment end_date is not eligible', async () => {
    const groupId = await seedGroup({ days: ['sat', 'tue'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupId, { effectiveDate: '2026-01-01' });
    await client.student_group_enrollments.updateMany({
      where: { student_id: studentId, group_id: groupId, role: 'primary' },
      data: { end_date: new Date('2026-01-04T00:00:00.000Z') }, // before TUESDAY (01-06)
    });

    expect(await isStudentEligibleForGroupDate(studentId, groupId, TUESDAY)).toBe(false);
  });

  // ── 6. end_date = NULL means no upper bound ────────────────────────────────────────────
  it('6. end_date=NULL keeps the enrollment eligible far into the future', async () => {
    const groupId = await seedGroup({ days: ['sat'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupId, { effectiveDate: '2026-01-01' });

    expect(await isStudentEligibleForGroupDate(studentId, groupId, '2030-01-05')).toBe(true); // also a Saturday
  });

  // ── 8. Student with no active enrollment must not appear ──────────────────────────────
  it('8. a student with no active enrollment in the group is not eligible and not in the roster', async () => {
    const groupId = await seedGroup({ days: ['sat', 'tue'] });
    const studentId = await seedStudent(); // never enrolled

    expect(await isStudentEligibleForGroupDate(studentId, groupId, SATURDAY)).toBe(false);
    const roster = await getEligibleStudentIdsForGroupDate(groupId, SATURDAY);
    expect(roster).not.toContain(studentId);
  });

  // ── 9. Student with multiple active enrollments — eligible per group/date independently ─
  it('9. a student enrolled in two groups appears in each group\'s roster only on that group\'s eligible dates', async () => {
    const groupA = await seedGroup({ name: 'A', days: ['sat'] });
    const groupB = await seedGroup({ name: 'B', days: ['tue'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    await addAdditionalEnrollment(studentId, groupB, { effectiveDate: '2026-01-01' });

    const rosterA_Saturday = await getEligibleStudentIdsForGroupDate(groupA, SATURDAY);
    const rosterA_Tuesday = await getEligibleStudentIdsForGroupDate(groupA, TUESDAY);
    const rosterB_Saturday = await getEligibleStudentIdsForGroupDate(groupB, SATURDAY);
    const rosterB_Tuesday = await getEligibleStudentIdsForGroupDate(groupB, TUESDAY);

    expect(rosterA_Saturday).toContain(studentId);
    expect(rosterA_Tuesday).not.toContain(studentId);
    expect(rosterB_Saturday).not.toContain(studentId);
    expect(rosterB_Tuesday).toContain(studentId);
  });

  // ── withdrawn/transferred enrollments never appear for dates after their own end_date ──
  // (real production withdrawEnrollmentTx/setPrimaryGroupTx always set end_date together
  // with the status change — see enrollmentService.js — reproduced realistically here).
  it('10. a withdrawn Primary enrollment is not eligible for dates after its end_date', async () => {
    const groupId = await seedGroup({ days: ['sat'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupId, { effectiveDate: '2026-01-01' });
    await client.student_group_enrollments.updateMany({
      where: { student_id: studentId, group_id: groupId },
      data: { status: 'withdrawn', end_date: new Date('2026-01-02T00:00:00.000Z') }, // before SATURDAY (01-03)
    });

    expect(await isStudentEligibleForGroupDate(studentId, groupId, SATURDAY)).toBe(false);
    const roster = await getEligibleStudentIdsForGroupDate(groupId, SATURDAY);
    expect(roster).not.toContain(studentId);
  });

  // ── Group Closure (Attendance Integration) — historical correctness ───────────────────
  // A row that has SINCE been closed (transferred/withdrawn) still correctly represents
  // "this enrollment was active during [start_date, end_date]" as a historical fact — the
  // CURRENT status must not exclude a date that genuinely fell within that window before
  // closure. This is exactly what report-date eligibility (as opposed to today/future
  // roster-building) depends on; the same function must answer both correctly.
  it('12. a Primary enrollment later transferred away is still eligible for dates within its original [start_date, end_date] window (historical report correctness)', async () => {
    const groupA = await seedGroup({ name: 'A', days: ['sat'] });
    const groupB = await seedGroup({ name: 'B', days: ['sat'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' }); // active in A from Jan 1
    // transfer to B on 2026-02-01 — closes the A row as 'transferred', end_date=2026-02-01
    await setPrimaryGroup(studentId, groupB, { effectiveDate: '2026-02-01' });

    // A date genuinely inside the old A enrollment's window (Jan 1 – Feb 1) — was really
    // active in A on that Saturday, even though that row's CURRENT status is 'transferred'.
    const pastSaturdayInA = '2026-01-10'; // a Saturday
    expect(await isStudentEligibleForGroupDate(studentId, groupA, pastSaturdayInA)).toBe(true);
    const rosterA = await getEligibleStudentIdsForGroupDate(groupA, pastSaturdayInA);
    expect(rosterA).toContain(studentId);

    // After the transfer date, no longer eligible for A (real upper bound, not status).
    expect(await isStudentEligibleForGroupDate(studentId, groupA, '2026-02-07')).toBe(false); // also a Saturday
  });

  // ── Case I — changing Primary Group must not remove unrelated Additional Group eligibility
  it('13. transferring the Primary Group does not affect an unrelated Additional Group enrollment\'s eligibility', async () => {
    const primaryGroupOld = await seedGroup({ name: 'Old Primary', days: ['sat'] });
    const primaryGroupNew = await seedGroup({ name: 'New Primary', days: ['sat'] });
    const additionalGroup = await seedGroup({ name: 'Additional', days: ['tue'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, primaryGroupOld, { effectiveDate: '2026-01-01' });
    await addAdditionalEnrollment(studentId, additionalGroup, { effectiveDate: '2026-01-01' });

    // Transfer Primary from Old to New — must not touch the Additional enrollment at all.
    await setPrimaryGroup(studentId, primaryGroupNew, { effectiveDate: '2026-01-05' }); // a Monday

    expect(await isStudentEligibleForGroupDate(studentId, additionalGroup, TUESDAY)).toBe(true);
    expect(await isStudentEligibleForGroupDate(studentId, primaryGroupNew, '2026-01-10')).toBe(true); // a Saturday, on/after the transfer
  });

  // ── Case J — duplicate active enrollment must never create duplicate roster entries ────
  it('14. getEligibleStudentIdsForGroupDate never returns the same student id twice for one group/date', async () => {
    const groupId = await seedGroup({ days: ['sat'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupId, { effectiveDate: '2026-01-01' });

    const roster = await getEligibleStudentIdsForGroupDate(groupId, SATURDAY);

    expect(roster.filter((id) => id === studentId)).toHaveLength(1);
    expect(new Set(roster).size).toBe(roster.length);
  });

  // ── getEligibleEnrollmentsForGroupDate returns full enrollment rows, not just ids ──────
  it('11. getEligibleEnrollmentsForGroupDate returns the matching enrollment rows for a group/date', async () => {
    const groupId = await seedGroup({ days: ['sat'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupId, { effectiveDate: '2026-01-01' });

    const rows = await getEligibleEnrollmentsForGroupDate(groupId, SATURDAY);

    expect(rows).toHaveLength(1);
    expect(rows[0].student_id).toBe(studentId);
    expect(rows[0].group_id).toBe(groupId);
    expect(rows[0].role).toBe('primary');
  });
});
