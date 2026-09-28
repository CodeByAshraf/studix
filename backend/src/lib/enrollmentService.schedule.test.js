// backend/src/lib/enrollmentService.schedule.test.js
// Fix 2 — Student Enrollment & Attendance Schedule. Mocks the Prisma client entirely (no live
// DB touched — same technique as routes/admissionActivation.test.js): an in-memory
// groups/students/student_group_enrollments store drives the REAL enrollmentService,
// studentCreate (POST /api/students), the generic students PUT (crud.js) and
// attendanceEligibility. $transaction snapshots the store and restores it when the work
// throws — the same all-or-nothing guarantee a real PostgreSQL transaction gives — so the
// atomicity tests observe exactly what a rollback would leave behind.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const db = { groups: [], students: [], student_group_enrollments: [] };

// Minimal Prisma `where` evaluator: equality, { lte, gte } range filters and OR — exactly the
// shapes enrollmentService.js/attendanceEligibility.js pass.
function matches(row, where = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return v.some((alt) => matches(row, alt));
    if (v !== null && typeof v === 'object' && !(v instanceof Date) && ('lte' in v || 'gte' in v)) {
      const cell = row[k];
      if (cell === null || cell === undefined) return false;
      if ('lte' in v && !(cell <= v.lte)) return false;
      if ('gte' in v && !(cell >= v.gte)) return false;
      return true;
    }
    return row[k] === v;
  });
}
function stored(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) out[k] = v === Prisma.DbNull ? null : v;
  return out;
}
function table(name) {
  return {
    findUnique: vi.fn(async ({ where }) => db[name].find((r) => matches(r, where)) ?? null),
    findFirst: vi.fn(async ({ where }) => db[name].find((r) => matches(r, where)) ?? null),
    findMany: vi.fn(async ({ where } = {}) => db[name].filter((r) => matches(r, where))),
    create: vi.fn(async ({ data }) => { const row = stored(data); db[name].push(row); return row; }),
    update: vi.fn(async ({ where, data }) => {
      const row = db[name].find((r) => matches(r, where));
      if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
      Object.assign(row, stored(data));
      return row;
    }),
  };
}

const client = {
  groups: table('groups'),
  students: table('students'),
  student_group_enrollments: table('student_group_enrollments'),
  $executeRaw: vi.fn(async () => 0),
};
client.$transaction = async (work) => {
  const snapshot = structuredClone(db);
  try {
    return await work(client);
  } catch (err) {
    Object.assign(db, snapshot);
    throw err;
  }
};

vi.mock('../prisma.js', () => ({ prisma: client }));

const { applyStudentEnrollmentsTx, addAdditionalEnrollmentTx, updateEnrollmentScheduleTx, setPrimaryGroupTx } =
  await import('./enrollmentService.js');
const { isStudentEligibleForGroupDate, getEligibleStudentIdsForGroupDate } = await import('./attendanceEligibility.js');
const { createStudentDirect } = await import('../routes/studentCreate.js');
const { makeCrudRouter } = await import('../routes/crud.js');

// 2026-09-26 Saturday, 2026-09-28 Monday, 2026-09-29 Tuesday, 2026-10-01 Thursday.
const SAT = '2026-09-26';
const MON = '2026-09-28';
const TUE = '2026-09-29';
const THU = '2026-10-01';

const active = (studentId) => db.student_group_enrollments.filter((e) => e.student_id === studentId && e.status === 'active');
const enrollmentIn = (studentId, groupId) => active(studentId).find((e) => e.group_id === groupId);

function seedStudent(id = 's1', groupId = null) {
  db.students.push({ id, name: 'طالب', code: `C-${id}`, group_id: groupId });
  return id;
}

async function createStudent(body) {
  return createStudentDirect({ name: 'طالب جديد', enrollDate: '2026-09-01', ...body });
}

function callPut(studentId, body) {
  const router = makeCrudRouter('students', { writable: true, preserveClientId: true });
  return new Promise((resolve, reject) => {
    const req = { method: 'PUT', url: `/${studentId}`, headers: {}, body };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ statusCode: this.statusCode, body: b }); return this; },
    };
    router.handle(req, res, (err) => (err ? reject(err) : reject(new Error('no route matched'))));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.groups = [
    { id: 'gA', days: ['sat', 'mon'] },
    { id: 'gB', days: ['mon', 'thu'] },
    { id: 'gC', days: ['tue'] },
    { id: 'gNoDays', days: null },
  ];
  db.students = [];
  db.student_group_enrollments = [];
});

describe('Student create — Primary + Additional schedules in one transaction', () => {
  it('1/9. Primary with all group days is stored as NULL, and NULL means every day the group meets', async () => {
    const s = await createStudent({ groupId: 'gA', primaryAttendDays: null });

    expect(enrollmentIn(s.id, 'gA')).toMatchObject({ role: 'primary', attend_days: null });
    expect(await isStudentEligibleForGroupDate(s.id, 'gA', SAT)).toBe(true);
    expect(await isStudentEligibleForGroupDate(s.id, 'gA', MON)).toBe(true);
  });

  it('2. Primary with a selected subset of days stores exactly that subset', async () => {
    const s = await createStudent({ groupId: 'gA', primaryAttendDays: ['sat'] });

    expect(enrollmentIn(s.id, 'gA').attend_days).toEqual(['sat']);
    expect(db.students.find((x) => x.id === s.id).group_id).toBe('gA');
  });

  it('3. multiple Additional Groups are created as separate enrollments with independent schedules', async () => {
    const s = await createStudent({
      groupId: 'gA', primaryAttendDays: ['sat'],
      additionalGroups: [{ groupId: 'gB', attendDays: ['mon', 'thu'] }, { groupId: 'gC', attendDays: ['tue'] }],
    });

    expect(active(s.id)).toHaveLength(3);
    expect(enrollmentIn(s.id, 'gB')).toMatchObject({ role: 'additional', attend_days: ['mon', 'thu'] });
    expect(enrollmentIn(s.id, 'gC')).toMatchObject({ role: 'additional', attend_days: ['tue'] });
    expect(await getEligibleStudentIdsForGroupDate('gB', THU)).toEqual([s.id]);
    expect(await getEligibleStudentIdsForGroupDate('gC', TUE)).toEqual([s.id]);
    expect(await getEligibleStudentIdsForGroupDate('gA', MON)).toEqual([]); // Primary is Saturday only
  });

  it('4/14. an Additional Group duplicating the Primary is rejected and the student is NOT created', async () => {
    await expect(createStudent({
      groupId: 'gA', additionalGroups: [{ groupId: 'gA', attendDays: null }],
    })).rejects.toMatchObject({ status: 400 });

    expect(db.students).toHaveLength(0);
    expect(db.student_group_enrollments).toHaveLength(0);
  });

  it('5. the same Additional Group listed twice is rejected (atomically)', async () => {
    await expect(createStudent({
      groupId: 'gA',
      additionalGroups: [{ groupId: 'gB', attendDays: null }, { groupId: 'gB', attendDays: ['mon'] }],
    })).rejects.toMatchObject({ status: 400 });

    expect(db.students).toHaveLength(0);
  });

  it('14. an invalid enrollment after valid ones rolls the whole creation back', async () => {
    await expect(createStudent({
      groupId: 'gA', primaryAttendDays: ['sat'],
      additionalGroups: [{ groupId: 'gB', attendDays: ['mon'] }, { groupId: 'gC', attendDays: ['sat'] }],
    })).rejects.toMatchObject({ status: 400 });

    expect(db.students).toHaveLength(0);
    expect(db.student_group_enrollments).toHaveLength(0);
  });

  it('creates a student with no Primary Group and no Additional Groups exactly as before', async () => {
    const s = await createStudent({ groupId: null });

    expect(db.students.find((x) => x.id === s.id).group_id).toBeNull();
    expect(active(s.id)).toHaveLength(0);
  });
});

describe('attend_days validation (shared by Primary, Additional and schedule updates)', () => {
  it('6. an unknown day code is rejected', async () => {
    seedStudent();
    await expect(setPrimaryGroupTx(client, 's1', 'gA', { attendDays: ['sat', 'xyz'] })).rejects.toMatchObject({ status: 400 });
    await expect(addAdditionalEnrollmentTx(client, 's1', 'gB', { attendDays: ['funday'] })).rejects.toMatchObject({ status: 400 });
  });

  it('7. a day the group does not meet on is rejected', async () => {
    seedStudent();
    await expect(setPrimaryGroupTx(client, 's1', 'gA', { attendDays: ['tue'] })).rejects.toMatchObject({ status: 400 });
    await expect(addAdditionalEnrollmentTx(client, 's1', 'gNoDays', { attendDays: ['sat'] })).rejects.toMatchObject({ status: 400 });
  });

  it('8. an empty attend_days array is rejected everywhere', async () => {
    seedStudent();
    await expect(setPrimaryGroupTx(client, 's1', 'gA', { attendDays: [] })).rejects.toMatchObject({ status: 400 });
    await expect(addAdditionalEnrollmentTx(client, 's1', 'gB', { attendDays: [] })).rejects.toMatchObject({ status: 400 });
    const primary = await setPrimaryGroupTx(client, 's1', 'gA', {});
    await expect(updateEnrollmentScheduleTx(client, primary.id, { attendDays: [] })).rejects.toMatchObject({ status: 400 });
  });

  it('5. adding an Additional Group the student is already actively enrolled in is a 409', async () => {
    seedStudent();
    await setPrimaryGroupTx(client, 's1', 'gA', {});
    await addAdditionalEnrollmentTx(client, 's1', 'gB', {});

    await expect(addAdditionalEnrollmentTx(client, 's1', 'gA', {})).rejects.toMatchObject({ status: 409 });
    await expect(addAdditionalEnrollmentTx(client, 's1', 'gB', {})).rejects.toMatchObject({ status: 409 });
  });

  it('non-array attend_days is rejected', async () => {
    seedStudent();
    await expect(setPrimaryGroupTx(client, 's1', 'gA', { attendDays: 'sat' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('Attendance eligibility — group.days decides when the group meets, attend_days narrows it', () => {
  it('10. an explicit attend_days can never make a student eligible on a day the group does not meet', async () => {
    seedStudent();
    await setPrimaryGroupTx(client, 's1', 'gA', { effectiveDate: '2026-01-01' });
    // legacy/unvalidated row: a day outside the group's schedule, written directly
    enrollmentIn('s1', 'gA').attend_days = ['tue'];

    expect(await isStudentEligibleForGroupDate('s1', 'gA', TUE)).toBe(false);
    expect(await getEligibleStudentIdsForGroupDate('gA', TUE)).toEqual([]);
  });

  it('11. explicit attend_days is respected: eligible on the selected day only', async () => {
    seedStudent();
    await setPrimaryGroupTx(client, 's1', 'gA', { effectiveDate: '2026-01-01', attendDays: ['sat'] });

    expect(await isStudentEligibleForGroupDate('s1', 'gA', SAT)).toBe(true);
    expect(await isStudentEligibleForGroupDate('s1', 'gA', MON)).toBe(false);
  });

  it('a group with no configured days has no eligible students on any date', async () => {
    seedStudent();
    await setPrimaryGroupTx(client, 's1', 'gNoDays', { effectiveDate: '2026-01-01' });

    expect(await isStudentEligibleForGroupDate('s1', 'gNoDays', SAT)).toBe(false);
  });
});

describe('Student edit — PUT /api/students/:id applies the whole schedule atomically', () => {
  async function seedScheduledStudent() {
    seedStudent('s1', null);
    await applyStudentEnrollmentsTx(client, 's1', {
      groupId: 'gA', primaryAttendDays: null,
      additionalGroups: [{ groupId: 'gB', attendDays: ['mon'] }],
      effectiveDate: '2026-01-01',
    });
  }

  it('12. editing Primary days updates the existing Primary enrollment (no new row)', async () => {
    await seedScheduledStudent();
    const before = enrollmentIn('s1', 'gA');

    await callPut('s1', { groupId: 'gA', primaryAttendDays: ['mon'] });

    const after = enrollmentIn('s1', 'gA');
    expect(after.id).toBe(before.id);
    expect(after.attend_days).toEqual(['mon']);
    expect(db.student_group_enrollments.filter((e) => e.group_id === 'gA')).toHaveLength(1);
  });

  it('12b. setting Primary days back to all days stores NULL', async () => {
    await seedScheduledStudent();
    await callPut('s1', { groupId: 'gA', primaryAttendDays: ['sat'] });
    await callPut('s1', { groupId: 'gA', primaryAttendDays: null });

    expect(enrollmentIn('s1', 'gA').attend_days).toBeNull();
  });

  it('13. editing Additional days updates that enrollment in place; a dropped one is withdrawn; a new one is added', async () => {
    await seedScheduledStudent();
    const bBefore = enrollmentIn('s1', 'gB');

    await callPut('s1', { groupId: 'gA', additionalGroups: [{ groupId: 'gB', attendDays: ['mon', 'thu'] }] });
    expect(enrollmentIn('s1', 'gB').id).toBe(bBefore.id);
    expect(enrollmentIn('s1', 'gB').attend_days).toEqual(['mon', 'thu']);

    await callPut('s1', { groupId: 'gA', additionalGroups: [{ groupId: 'gC', attendDays: null }] });
    expect(enrollmentIn('s1', 'gB')).toBeUndefined();
    expect(db.student_group_enrollments.find((e) => e.id === bBefore.id).status).toBe('withdrawn');
    expect(enrollmentIn('s1', 'gC')).toMatchObject({ role: 'additional', attend_days: null });
  });

  it('changing the Primary Group transfers it, and the old Primary can become an Additional Group in the same save', async () => {
    await seedScheduledStudent();

    await callPut('s1', { groupId: 'gB', primaryAttendDays: ['thu'], additionalGroups: [{ groupId: 'gA', attendDays: ['sat'] }] });

    expect(enrollmentIn('s1', 'gB')).toMatchObject({ role: 'primary', attend_days: ['thu'] });
    expect(enrollmentIn('s1', 'gA')).toMatchObject({ role: 'additional', attend_days: ['sat'] });
    expect(db.students.find((x) => x.id === 's1').group_id).toBe('gB');
    expect(active('s1')).toHaveLength(2);
  });

  it('a failing edit leaves every enrollment and the student row exactly as they were', async () => {
    await seedScheduledStudent();
    const snapshot = structuredClone(db);

    await expect(callPut('s1', {
      name: 'اسم جديد', groupId: 'gC',
      additionalGroups: [{ groupId: 'gB', attendDays: ['mon'] }, { groupId: 'gA', attendDays: ['tue'] }],
    })).rejects.toMatchObject({ status: 400 });

    expect(db).toEqual(snapshot);
  });

  it('a PUT without schedule fields (e.g. the Groups-screen transfer) leaves Additional Groups untouched', async () => {
    await seedScheduledStudent();

    await callPut('s1', { groupId: 'gC' });

    expect(enrollmentIn('s1', 'gC')).toMatchObject({ role: 'primary', attend_days: null });
    expect(enrollmentIn('s1', 'gB')).toMatchObject({ role: 'additional', attend_days: ['mon'] });
  });
});
