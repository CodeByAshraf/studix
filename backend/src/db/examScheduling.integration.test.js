// backend/src/db/examScheduling.integration.test.js
// Exams Phase 3B — schema-only verification. Migration 008 adds three nullable columns
// (scheduled_time, duration_minutes, actual_started_at) to exams for the future
// administrative countdown display (see Phase 3A's architecture audit). No app code, no
// timer logic, no Start endpoint exists yet — this file only proves the schema itself:
// the three columns exist, are genuinely nullable, and a historical exam (none of the
// three set) remains a fully valid row, unaffected by this migration.
//
// Real PostgreSQL integration (scratch database), same pattern as
// schemaArtifactDrift.integration.test.js / examGrades.integration.test.js.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('exams — Phase 3B scheduling columns (scheduled_time, duration_minutes, actual_started_at)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('exam_scheduling_schema');
    client = scratch.client;
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  it('all three columns exist and are nullable per information_schema', async () => {
    const rows = await client.$queryRawUnsafe(`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'exams'
        AND column_name IN ('scheduled_time', 'duration_minutes', 'actual_started_at')
    `);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));

    expect(byName.scheduled_time).toBeTruthy();
    expect(byName.scheduled_time.is_nullable).toBe('YES');
    expect(byName.scheduled_time.data_type).toBe('text');

    expect(byName.duration_minutes).toBeTruthy();
    expect(byName.duration_minutes.is_nullable).toBe('YES');
    expect(byName.duration_minutes.data_type).toBe('integer');

    expect(byName.actual_started_at).toBeTruthy();
    expect(byName.actual_started_at.is_nullable).toBe('YES');
    expect(byName.actual_started_at.data_type).toBe('timestamp with time zone');
  });

  it('a historical-style exam (none of the three fields set) remains a fully valid row', async () => {
    const id = nextId('e');
    const exam = await client.exams.create({
      data: { id, name: 'امتحان قديم', grade: 'الصف السادس الابتدائي', date: new Date('2024-01-10'), total: 100, pass: 50 },
    });

    expect(exam.scheduled_time).toBeNull();
    expect(exam.duration_minutes).toBeNull();
    expect(exam.actual_started_at).toBeNull();

    const reread = await client.exams.findUnique({ where: { id } });
    expect(reread.scheduled_time).toBeNull();
    expect(reread.duration_minutes).toBeNull();
    expect(reread.actual_started_at).toBeNull();
  });

  it('all three fields can be set and round-trip correctly when provided', async () => {
    const id = nextId('e');
    const startedAt = new Date('2026-03-10T09:00:00.000Z');
    const exam = await client.exams.create({
      data: {
        id, name: 'امتحان مجدول', grade: 'الصف السادس الابتدائي', date: new Date('2026-03-10'), total: 100, pass: 50,
        scheduled_time: '09:00',
        duration_minutes: 60,
        actual_started_at: startedAt,
      },
    });

    expect(exam.scheduled_time).toBe('09:00');
    expect(exam.duration_minutes).toBe(60);
    expect(exam.actual_started_at.toISOString()).toBe(startedAt.toISOString());
  });

  it('existing exam data (every pre-migration 008 field) is untouched — the migration only adds columns, never updates rows', async () => {
    // Simulates a pre-existing (Phase 2) exam row exactly as it would have looked before
    // this migration — every non-scheduling field set, scheduling fields absent from the
    // insert entirely (not even passed) — proving the new columns default to NULL without
    // requiring any migration-time UPDATE, and every other field is preserved verbatim.
    const id = nextId('e');
    const created = await client.exams.create({
      data: {
        id, name: 'امتحان Phase 2', grade: 'الصف الأول الإعدادي', academic_year: '2025/2026',
        subject: 'رياضيات', date: new Date('2026-01-15'), total: 80, pass: 40, type: 'midterm',
        teacher: 'أ. محمد', status: 'grading',
      },
    });

    expect(created).toMatchObject({
      id, name: 'امتحان Phase 2', grade: 'الصف الأول الإعدادي', academic_year: '2025/2026',
      subject: 'رياضيات', type: 'midterm', teacher: 'أ. محمد', status: 'grading',
      scheduled_time: null, duration_minutes: null, actual_started_at: null,
    });
    expect(Number(created.total)).toBe(80);
    expect(Number(created.pass)).toBe(40);
  });
});
