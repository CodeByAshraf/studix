// backend/src/routes/enrollments.groupMembership.test.js
// Group Membership unification — GET /api/enrollments?groupId= (the Groups screen's
// membership source) and attendanceEligibility.js (the attendance roster) must read the SAME
// student_group_enrollments rows. Mocks the Prisma client entirely (no live DB touched — same
// technique as admissionActivation.test.js): one in-memory enrollments table serves both
// callers, and a minimal `where` evaluator applies exactly the filters each caller passes.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = { groups: [], enrollments: [] };

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return cond.some((alt) => matches(row, alt));
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const v = row[key];
      if ('lte' in cond && !(v !== null && v <= cond.lte)) return false;
      if ('gte' in cond && !(v !== null && v >= cond.gte)) return false;
      return true;
    }
    return row[key] === cond;
  });
}

vi.mock('../prisma.js', () => ({
  prisma: {
    groups: {
      findUnique: vi.fn(async ({ where }) => db.groups.find((g) => g.id === where.id) ?? null),
    },
    student_group_enrollments: {
      findMany: vi.fn(async ({ where }) => db.enrollments.filter((e) => matches(e, where))),
      findFirst: vi.fn(async ({ where }) => db.enrollments.find((e) => matches(e, where)) ?? null),
    },
  },
}));

const { enrollmentRouter } = await import('./enrollments.js');
const { getEligibleStudentIdsForGroupDate, isStudentEligibleForGroupDate } = await import('../lib/attendanceEligibility.js');

function callRoute(router, { method, url }) {
  return new Promise((resolve, reject) => {
    const [path, qs = ''] = url.split('?');
    const req = { method, url, path, headers: {}, query: Object.fromEntries(new URLSearchParams(qs)) };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ statusCode: this.statusCode, body: b }); return this; },
    };
    router.handle(req, res, (err) => (err ? reject(err) : reject(new Error('no route matched'))));
  });
}

const START = new Date('2026-01-01T00:00:00.000Z');
function enrollment(id, studentId, groupId, role, extra = {}) {
  return { id, student_id: studentId, group_id: groupId, role, status: 'active', start_date: START, end_date: null, attend_days: null, ...extra };
}

async function groupMemberIds(groupId) {
  const { body } = await callRoute(enrollmentRouter, { method: 'GET', url: `/?groupId=${groupId}` });
  return body.data.map((e) => e.studentId);
}

// 2026-09-26 is a Saturday, 2026-09-28 a Monday.
const SATURDAY = '2026-09-26';
const MONDAY = '2026-09-28';

beforeEach(() => {
  db.groups = [
    { id: 'gA', days: ['sat', 'mon'] },
    { id: 'gB', days: ['sat', 'mon'] },
  ];
  db.enrollments = [];
});

describe('GET /api/enrollments — group membership from student_group_enrollments', () => {
  it('returns only ACTIVE enrollments, camelCased, scoped to ?groupId=', async () => {
    db.enrollments = [
      enrollment('e1', 's1', 'gA', 'primary'),
      enrollment('e2', 's2', 'gA', 'primary', { status: 'transferred', end_date: START }),
      enrollment('e3', 's3', 'gB', 'primary'),
    ];

    const { body } = await callRoute(enrollmentRouter, { method: 'GET', url: '/?groupId=gA' });

    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: 'e1', studentId: 's1', groupId: 'gA', role: 'primary', status: 'active' });
  });

  it('without groupId returns the active enrollments of every group (one call for all group cards)', async () => {
    db.enrollments = [enrollment('e1', 's1', 'gA', 'primary'), enrollment('e3', 's3', 'gB', 'primary')];

    const { body } = await callRoute(enrollmentRouter, { method: 'GET', url: '/' });

    expect(body.data.map((e) => e.groupId).sort()).toEqual(['gA', 'gB']);
  });

  it('rejects an empty groupId instead of silently returning every group', async () => {
    await expect(callRoute(enrollmentRouter, { method: 'GET', url: '/?groupId=' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('Groups membership and the attendance roster agree (same enrollment rows)', () => {
  it('Case A — Primary Group: the student is a member of Group A and on its attendance roster', async () => {
    db.enrollments = [enrollment('e1', 's1', 'gA', 'primary')];

    expect(await groupMemberIds('gA')).toEqual(['s1']);
    expect(await getEligibleStudentIdsForGroupDate('gA', SATURDAY)).toEqual(['s1']);
  });

  it('Case B — Additional Group: the student is a member of both Group A and Group B', async () => {
    db.enrollments = [
      enrollment('e1', 's1', 'gA', 'primary'),
      enrollment('e2', 's1', 'gB', 'additional'),
    ];

    expect(await groupMemberIds('gA')).toEqual(['s1']);
    expect(await groupMemberIds('gB')).toEqual(['s1']);
    expect(await getEligibleStudentIdsForGroupDate('gB', SATURDAY)).toEqual(['s1']);
  });

  it('Case C — attend_days [sat] on a sat+mon group: eligible Saturday, not Monday (unchanged rule)', async () => {
    db.enrollments = [enrollment('e1', 's1', 'gA', 'primary', { attend_days: ['sat'] })];

    expect(await isStudentEligibleForGroupDate('s1', 'gA', SATURDAY)).toBe(true);
    expect(await isStudentEligibleForGroupDate('s1', 'gA', MONDAY)).toBe(false);
    // membership itself is not day-filtered — the student is a member of Group A either way
    expect(await groupMemberIds('gA')).toEqual(['s1']);
  });

  it('Case D — students.group_id without an active enrollment is a member of neither view', async () => {
    db.enrollments = []; // s1.group_id = gA exists only on the students row

    expect(await groupMemberIds('gA')).toEqual([]);
    expect(await getEligibleStudentIdsForGroupDate('gA', SATURDAY)).toEqual([]);
  });
});
