// backend/src/db/devReset.test.js
// Developer Data Reset — STEP 1 core. Unit tests (no database): the classification lists, the
// exact TRUNCATE statement, every fail-closed pre-flight check, and performDevReset's
// transaction flow driven by a fake Prisma client that routes each SQL shape the module
// issues. Real-PostgreSQL behavior (triggers, RESTART IDENTITY, rollback) is proven separately
// in devReset.integration.test.js on a throwaway database.
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  RESET_TABLES, PRESERVE_TABLES, RESET_CONFIRMATION_PHRASE,
  buildTruncateSql, runPreflightChecks, performDevReset, DevResetError,
} from './devReset.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXPECTED_RESET = [
  'students', 'parents', 'groups', 'student_group_enrollments',
  'attendance', 'attendance_sessions', 'absence_followup', 'recitations',
  'exams', 'grades', 'homeworks', 'hw_submissions',
  'inv_materials', 'inventory_txn',
  'admissions', 'admission_followups', 'admission_system_log', 'admission_payments',
  'communications', 'comm_tasks', 'wa_report_log',
  'payments', 'treasury_txn', 'cashboxes',
  'activity_logs',
];
const EXPECTED_PRESERVE = [
  '_studix_migrations', 'license_config', 'support_access_config', 'users', 'roles',
  'center_profile', 'inventory_settings', 'teachers',
];

describe('classification', () => {
  it('RESET_TABLES is exactly the approved 25 tables', () => {
    expect(RESET_TABLES).toHaveLength(25);
    expect([...RESET_TABLES].sort()).toEqual([...EXPECTED_RESET].sort());
    expect(Object.isFrozen(RESET_TABLES)).toBe(true);
  });

  it('PRESERVE_TABLES is exactly the approved preserve set (teachers preserved, cashboxes not)', () => {
    expect([...PRESERVE_TABLES].sort()).toEqual([...EXPECTED_PRESERVE].sort());
    expect(PRESERVE_TABLES).toContain('teachers');
    expect(PRESERVE_TABLES).not.toContain('cashboxes');
    expect(Object.isFrozen(PRESERVE_TABLES)).toBe(true);
  });

  it('the two lists are disjoint', () => {
    expect(RESET_TABLES.filter((t) => PRESERVE_TABLES.includes(t))).toEqual([]);
  });

  it('together they classify every Prisma model plus _studix_migrations — nothing unclassified', () => {
    const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf8');
    const models = [...schema.matchAll(/^model\s+([a-z_]+)\s*\{/gm)].map((m) => m[1]);
    const classified = [...RESET_TABLES, ...PRESERVE_TABLES].sort();
    expect(classified).toEqual([...models, '_studix_migrations'].sort());
  });
});

describe('buildTruncateSql', () => {
  const sql = buildTruncateSql();

  it('is ONE TRUNCATE naming all 25 reset tables, quoted, with RESTART IDENTITY', () => {
    expect(sql.startsWith('TRUNCATE TABLE ')).toBe(true);
    expect(sql.endsWith(' RESTART IDENTITY')).toBe(true);
    for (const t of EXPECTED_RESET) expect(sql).toContain(`"${t}"`);
    expect(sql.match(/"[a-z_]+"/g)).toHaveLength(25);
    expect(sql.split(';')).toHaveLength(1);
  });

  it('never CASCADEs, DROPs, DELETEs or touches triggers — and names no preserved table', () => {
    expect(sql).not.toMatch(/cascade|drop|delete|trigger|disable/i);
    for (const t of EXPECTED_PRESERVE) expect(sql).not.toContain(`"${t}"`);
  });

  it('rejects unsafe identifiers, duplicates and an empty list', () => {
    expect(() => buildTruncateSql(['students; DROP TABLE users'])).toThrow(DevResetError);
    expect(() => buildTruncateSql(['Students'])).toThrow(/غير آمن/);
    expect(() => buildTruncateSql(['students', 'students'])).toThrow(DevResetError);
    expect(() => buildTruncateSql([])).toThrow(DevResetError);
  });
});

// ── Fake Prisma: routes each SQL shape the module issues ─────────────────────────────────
function fakeDb({
  dbName = 'studix_dev',
  tables = [...EXPECTED_RESET, ...EXPECTED_PRESERVE],
  fks = [{ name: 'students_group_id_fkey', child: 'students', parent: 'groups' },
         { name: 'users_teacher_id_fkey', child: 'users', parent: 'teachers' },
         { name: 'activity_logs_user_id_fkey', child: 'activity_logs', parent: 'users' }],
  rowsBefore = 3,
  rowsAfterTruncate = 0,
  preservedHashChanges = [],     // tables whose fingerprint differs after the reset
  authBump = 1,                  // how much auth_version actually moves
  logRowsAfterInsert = 1,
  failOn = null,                 // SQL substring that throws
} = {}) {
  const state = { truncated: false, bumped: false, executed: [], created: [] };
  const users = [{ id: 'admin', auth_version: 4 }, { id: 'u2', auth_version: 1 }];
  const maybeFail = (sql) => { if (failOn && sql.includes(failOn)) throw Object.assign(new Error('boom'), { code: 'P2010' }); };

  const tx = {
    $executeRawUnsafe: vi.fn(async (sql) => {
      maybeFail(sql);
      state.executed.push(sql);
      if (sql.startsWith('TRUNCATE')) state.truncated = true;
      if (sql.startsWith('UPDATE "users"')) { state.bumped = true; return users.length; }
      return 0;
    }),
    $queryRawUnsafe: vi.fn(async (sql) => {
      maybeFail(sql);
      if (sql.includes('current_database()')) return [{ current_database: dbName }];
      if (sql.includes('information_schema.tables')) return tables.map((table_name) => ({ table_name }));
      if (sql.includes('pg_constraint')) return fks;
      if (sql.includes('FROM "users"')) {
        return users.map((u) => ({ id: u.id, auth_version: u.auth_version + (state.bumped ? authBump : 0) }));
      }
      if (sql.includes('md5(')) {
        const table = sql.match(/FROM "([a-z_]+)" t\)/)[1];
        const changed = state.truncated && preservedHashChanges.includes(table);
        return [{ n: 2, h: changed ? `changed-${table}` : `hash-${table}` }];
      }
      if (sql.startsWith('SELECT count(*)::int AS n FROM "activity_logs"') && state.created.length) {
        return [{ n: logRowsAfterInsert }];
      }
      if (sql.startsWith('SELECT count(*)::int AS n FROM')) {
        return [{ n: state.truncated ? rowsAfterTruncate : rowsBefore }];
      }
      throw new Error(`unexpected query: ${sql}`);
    }),
    activity_logs: { create: vi.fn(async ({ data }) => { state.created.push(data); return data; }) },
  };
  const prisma = {
    $transaction: vi.fn(async (work, options) => { state.options = options; return work(tx); }),
    ...tx,
  };
  return { prisma, tx, state };
}

const OK_ARGS = {
  expectedDatabaseName: 'studix_dev',
  confirmation: RESET_CONFIRMATION_PHRASE,
  verifiedBackup: { path: 'C:/backups/dev-reset/pre-reset-x.dump', verifiedAt: '2026-09-28T10:00:00.000Z' },
  actor: { id: 'admin', name: 'Admin' },
};

describe('runPreflightChecks (fail-closed)', () => {
  it('passes on the expected, fully-classified schema', async () => {
    const { prisma } = fakeDb();
    await expect(runPreflightChecks(prisma, { expectedDatabaseName: 'studix_dev' }))
      .resolves.toMatchObject({ databaseName: 'studix_dev', tableCount: 33 });
  });

  it('requires an explicit expected database name', async () => {
    const { prisma } = fakeDb();
    await expect(runPreflightChecks(prisma, {})).rejects.toMatchObject({ code: 'database_name_required' });
    await expect(runPreflightChecks(prisma, { expectedDatabaseName: ' ' })).rejects.toMatchObject({ code: 'database_name_required' });
  });

  it('aborts when connected to a different database', async () => {
    const { prisma } = fakeDb({ dbName: 'studix' });
    await expect(runPreflightChecks(prisma, { expectedDatabaseName: 'studix_dev' }))
      .rejects.toMatchObject({ code: 'database_name_mismatch' });
  });

  it('aborts on an unclassified public table', async () => {
    const { prisma } = fakeDb({ tables: [...EXPECTED_RESET, ...EXPECTED_PRESERVE, 'new_feature_table'] });
    await expect(runPreflightChecks(prisma, { expectedDatabaseName: 'studix_dev' }))
      .rejects.toMatchObject({ code: 'unclassified_tables', details: { unclassified: ['new_feature_table'] } });
  });

  it('aborts when a classified table is missing (schema drift)', async () => {
    const { prisma } = fakeDb({ tables: [...EXPECTED_RESET, ...EXPECTED_PRESERVE].filter((t) => t !== 'cashboxes') });
    await expect(runPreflightChecks(prisma, { expectedDatabaseName: 'studix_dev' }))
      .rejects.toMatchObject({ code: 'missing_tables' });
  });

  it('aborts on a foreign key from a preserved table into a reset table', async () => {
    const { prisma } = fakeDb({ fks: [{ name: 'users_group_fk', child: 'users', parent: 'groups' }] });
    await expect(runPreflightChecks(prisma, { expectedDatabaseName: 'studix_dev' }))
      .rejects.toMatchObject({ code: 'preserved_references_reset' });
  });
});

describe('performDevReset', () => {
  it('refuses without the exact confirmation phrase — before any database access', async () => {
    const { prisma } = fakeDb();
    for (const confirmation of [undefined, '', 'reset studix data', 'RESET STUDIX DATA ']) {
      await expect(performDevReset(prisma, { ...OK_ARGS, confirmation })).rejects.toMatchObject({ code: 'confirmation_mismatch' });
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses without a verified backup record — before any database access', async () => {
    const { prisma } = fakeDb();
    for (const verifiedBackup of [undefined, {}, { path: 'x' }, { path: ' ', verifiedAt: 'now' }]) {
      await expect(performDevReset(prisma, { ...OK_ARGS, verifiedBackup })).rejects.toMatchObject({ code: 'backup_required' });
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('happy path: one transaction, one TRUNCATE, auth_version bump, one audit entry', async () => {
    const { prisma, state, tx } = fakeDb();
    const result = await performDevReset(prisma, OK_ARGS);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(state.options).toMatchObject({ isolationLevel: 'RepeatableRead' });
    const truncates = state.executed.filter((s) => s.startsWith('TRUNCATE'));
    expect(truncates).toEqual([buildTruncateSql()]);
    expect(state.executed[0]).toMatch(/SET LOCAL lock_timeout/);
    expect(state.executed).toContain('UPDATE "users" SET auth_version = auth_version + 1');
    expect(state.executed.join('\n')).not.toMatch(/cascade|drop|disable/i);

    expect(tx.activity_logs.create).toHaveBeenCalledTimes(1);
    const entry = state.created[0];
    expect(entry).toMatchObject({ action: 'dev_reset', module: 'developer', user_id: 'admin', user_name: 'Admin', entity_id: 'studix_dev' });
    expect(JSON.parse(entry.details)).toMatchObject({ backupPath: OK_ARGS.verifiedBackup.path, usersInvalidated: 2 });

    expect(result).toMatchObject({ databaseName: 'studix_dev', usersInvalidated: 2, activityLogId: entry.id, backupPath: OK_ARGS.verifiedBackup.path });
    expect(Object.keys(result.deletedCounts).sort()).toEqual([...EXPECTED_RESET].sort());
  });

  it('pre-flight failure aborts before the TRUNCATE', async () => {
    const { prisma, state } = fakeDb({ dbName: 'studix' });
    await expect(performDevReset(prisma, OK_ARGS)).rejects.toMatchObject({ code: 'database_name_mismatch' });
    expect(state.truncated).toBe(false);
  });

  it('a reset table that is not empty after TRUNCATE aborts (transaction rolls back)', async () => {
    const { prisma } = fakeDb({ rowsAfterTruncate: 1 });
    await expect(performDevReset(prisma, OK_ARGS)).rejects.toMatchObject({ code: 'reset_incomplete' });
  });

  it('any change to preserved data aborts', async () => {
    const { prisma } = fakeDb({ preservedHashChanges: ['license_config'] });
    await expect(performDevReset(prisma, OK_ARGS)).rejects.toMatchObject({ code: 'preserved_data_changed', details: { changed: ['license_config'] } });
  });

  it('auth_version not moving by exactly +1 aborts', async () => {
    const { prisma } = fakeDb({ authBump: 2 });
    await expect(performDevReset(prisma, OK_ARGS)).rejects.toMatchObject({ code: 'auth_version_mismatch' });
  });

  it('more than one activity_logs row after the reset aborts', async () => {
    const { prisma } = fakeDb({ logRowsAfterInsert: 2 });
    await expect(performDevReset(prisma, OK_ARGS)).rejects.toMatchObject({ code: 'audit_entry_invalid' });
  });

  it('a database error (e.g. permission denied on TRUNCATE) becomes reset_failed with a stable code', async () => {
    const { prisma } = fakeDb({ failOn: 'TRUNCATE' });
    const err = await performDevReset(prisma, OK_ARGS).catch((e) => e);
    expect(err).toBeInstanceOf(DevResetError);
    expect(err.code).toBe('reset_failed');
    expect(err.details).toMatchObject({ cause: 'P2010', message: 'boom' });
  });

  it('records a CLI/system actor as user_id NULL', async () => {
    const { prisma, state } = fakeDb();
    await performDevReset(prisma, { ...OK_ARGS, actor: null });
    expect(state.created[0]).toMatchObject({ user_id: null, user_name: 'Developer Data Reset' });
  });
});
