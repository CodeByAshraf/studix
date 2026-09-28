// backend/src/db/devReset.integration.test.js
// Developer Data Reset — STEP 1 core against REAL PostgreSQL (a throwaway scratch database with
// the full production schema: triggers, CHECK constraints, partial unique indexes applied from
// backend/migrations). Proves what the unit tests cannot: TRUNCATE really bypasses the
// append-only prevent_delete triggers without disabling them, RESTART IDENTITY restarts only
// the owned sequences, preserved data is untouched, and every failure — before or AFTER the
// TRUNCATE — rolls back completely.
//
// npm run test:integration only, and ONLY against an explicitly isolated throwaway server:
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/<name> STUDIX_TEST_DB_ISOLATED=1 \
//     npx vitest run --config vitest.integration.config.js src/db/devReset.integration.test.js
//
// ── Isolation guard (fail-closed, evaluated before ANY PostgreSQL contact) ─────────────────
// This test creates a scratch database AND a cluster-wide login role on whatever server
// DATABASE_URL names, so a bare run must never reach the developer's real server. The guard
// reads the environment exactly as the caller supplied it, as this module's first work: nothing
// that can open a connection is imported statically — @prisma/client loads backend/.env into
// process.env when first imported, which would silently turn a bare run into a run against the
// real :5432 server. The scratch helper, @prisma/client and the schema helper are imported
// dynamically, only after the guard passes. Otherwise a single clear SKIPPED test is recorded
// and no PostgreSQL operation of any kind happens.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import process from 'process';
import { URL } from 'url';

const REAL_DATABASE_NAME = 'studix';

function evaluateIsolationGuard({ databaseUrl, isolatedFlag }) {
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) {
    return { ok: false, reason: 'DATABASE_URL was not explicitly supplied — point it at a throwaway PostgreSQL cluster.' };
  }
  if (isolatedFlag !== '1') {
    return { ok: false, reason: 'STUDIX_TEST_DB_ISOLATED must be exactly "1" — set it only for a throwaway PostgreSQL cluster.' };
  }
  let databaseName;
  try {
    databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  } catch {
    return { ok: false, reason: 'DATABASE_URL is not a valid URL.' };
  }
  if (!databaseName || databaseName === REAL_DATABASE_NAME) {
    return { ok: false, reason: `refusing to derive a scratch database from the real "${REAL_DATABASE_NAME}" database name.` };
  }
  return { ok: true, reason: null };
}

const isolationGuard = evaluateIsolationGuard({
  databaseUrl: process.env.DATABASE_URL,
  isolatedFlag: process.env.STUDIX_TEST_DB_ISOLATED,
});

let scratchDbHelper = null;
let dbCheck = { reachable: false, reason: null };
if (isolationGuard.ok) {
  scratchDbHelper = await import('../test-helpers/scratchDb.js');
  dbCheck = await scratchDbHelper.checkPostgresReachable();
}

const APPEND_ONLY_TRIGGERS = [
  'trg_no_delete_payments', 'trg_no_delete_treasury', 'trg_no_delete_inventory',
  'trg_no_delete_admission_payments', 'trg_no_delete_admlog', 'trg_no_delete_comm', 'trg_no_delete_activity',
];

describe('devReset.js — real PostgreSQL integration', () => {
  if (!isolationGuard.ok) {
    it.skip(`SKIPPED — isolation guard: ${isolationGuard.reason} No PostgreSQL connection was made.`, () => {});
    return;
  }
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, devReset, PrismaClient;
  const NO_TRUNCATE_ROLE = 'studix_devreset_test_app_role';

  beforeAll(async () => {
    scratch = await scratchDbHelper.setupScratchDb('dev_reset');
    client = scratch.client;
    ({ PrismaClient } = await import('@prisma/client'));
    const { applyFullSchemaDDL } = await import('../test-helpers/scratchDbFullSchema.js');
    await applyFullSchemaDDL(client);
    // Created by migrationRunner.js in a real database (not a Prisma model, so db push skips it).
    await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS _studix_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    // A standalone (unowned) sequence, like the real seq_* ones — must survive untouched.
    await client.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS seq_student_code');
    devReset = await import('./devReset.js');
  }, 120_000);

  afterAll(async () => {
    if (!scratch) return;
    await client.$executeRawUnsafe(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${NO_TRUNCATE_ROLE}') THEN
        EXECUTE 'DROP OWNED BY ${NO_TRUNCATE_ROLE}'; EXECUTE 'DROP ROLE ${NO_TRUNCATE_ROLE}';
      END IF; END $$`).catch(() => {});
    await scratchDbHelper.teardownScratchDb(scratch);
  });

  // ── Seed: preserved configuration + business data in every append-only table ─────────────
  async function seed() {
    await client.$executeRawUnsafe(`TRUNCATE TABLE ${devReset.RESET_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);
    for (const t of ['_studix_migrations', 'license_config', 'support_access_config', 'users', 'roles', 'center_profile', 'inventory_settings', 'teachers']) {
      await client.$executeRawUnsafe(`DELETE FROM "${t}"`);
    }
    const sql = [
      `INSERT INTO _studix_migrations (version, name, checksum) VALUES (1, '001_baseline.sql', 'abc'), (2, '002_x.sql', 'def')`,
      `INSERT INTO license_config (id) VALUES (1)`,
      `INSERT INTO support_access_config (id) VALUES (1)`,
      `INSERT INTO roles (id, label, permissions) VALUES ('admin', 'مدير', '["students"]'::jsonb)`,
      `INSERT INTO teachers (name) VALUES ('مدرس')`,
      `INSERT INTO users (id, name, role_id, is_admin, auth_version) VALUES ('admin', 'Admin', 'admin', true, 3), ('u2', 'User 2', 'admin', false, 1)`,
      `INSERT INTO center_profile (id, name) VALUES (1, 'مركز')`,
      `INSERT INTO inventory_settings (id) VALUES (1)`,
      `INSERT INTO groups (id, name, price, days) VALUES ('g1', 'G1', 100, '["sat"]'::jsonb)`,
      `INSERT INTO parents (full_name, phone) VALUES ('ولي', '01000000001')`,
      `INSERT INTO students (id, code, name, group_id, parent_id) VALUES ('s1', 'C1', 'Student', 'g1', 1)`,
      `INSERT INTO student_group_enrollments (id, student_id, group_id, role, status, start_date) VALUES ('e1', 's1', 'g1', 'primary', 'active', '2026-01-01')`,
      `INSERT INTO attendance (id, student_id, group_id, date, status) VALUES ('a1', 's1', 'g1', '2026-01-03', 'present')`,
      `INSERT INTO cashboxes (id, name, opening_balance, active) VALUES ('cb_main', 'Main', 0, true)`,
      `INSERT INTO treasury_txn (id, cashbox_id, date, type, category, amount, method, status) VALUES ('t1', 'cb_main', '2026-01-05', 'income', 'other', 100, 'cash', 'active')`,
      `INSERT INTO payments (id, student_id, group_id, month, year, amount, date, status, method, pay_type, treasury_txn_id) VALUES ('p1', 's1', 'g1', 1, 2026, 100, '2026-01-05', 'paid', 'cash', 'subscription', 't1')`,
      `INSERT INTO inv_materials (code, name) VALUES ('M1', 'Material')`,
      `INSERT INTO inventory_txn (id, number, material_id, type, quantity) VALUES ('i1', 'INV-1', 1, 'initialStock', 5)`,
      `INSERT INTO communications (id, number, type, result) VALUES ('c1', 'COM-1', 'phoneCall', 'answered')`,
      `INSERT INTO admissions (id, number, name) VALUES ('ad1', 'ADM-1', 'متقدم')`,
      `INSERT INTO admission_system_log (id, admission_id, activity_type) VALUES ('l1', 'ad1', 'created')`,
      `INSERT INTO treasury_txn (id, cashbox_id, date, type, category, amount, method, status) VALUES ('t2', 'cb_main', '2026-01-06', 'income', 'other', 50, 'cash', 'active')`,
      `INSERT INTO admission_payments (id, admission_id, type, amount, date, treasury_txn_id) VALUES ('ap1', 'ad1', 'deposit', 50, '2026-01-06', 't2')`,
      `INSERT INTO activity_logs (id, action, module, user_id) VALUES ('log-old-1', 'create', 'students', 'admin'), ('log-old-2', 'update', 'groups', 'u2')`,
    ];
    for (const s of sql) await client.$executeRawUnsafe(s);
    // advance the standalone sequence so "untouched" is observable
    await client.$queryRawUnsafe(`SELECT nextval('seq_student_code'), nextval('seq_student_code')`);
  }

  const PRESERVED = ['_studix_migrations', 'license_config', 'support_access_config', 'users', 'roles', 'center_profile', 'inventory_settings', 'teachers'];
  async function preservedFingerprints() {
    const out = {};
    for (const t of PRESERVED) {
      const drop = t === 'users' ? `- 'auth_version'` : '';
      const [row] = await client.$queryRawUnsafe(
        `SELECT count(*)::int AS n, md5(coalesce(string_agg((to_jsonb(x) ${drop})::text, '|' ORDER BY (to_jsonb(x) ${drop})::text), '')) AS h FROM "${t}" x`);
      out[t] = row;
    }
    return out;
  }
  async function counts(tables) {
    const out = {};
    for (const t of tables) out[t] = (await client.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}"`))[0].n;
    return out;
  }
  const authVersions = async () => Object.fromEntries(
    (await client.$queryRawUnsafe('SELECT id, auth_version FROM users ORDER BY id')).map((r) => [r.id, r.auth_version]));

  const args = () => ({
    expectedDatabaseName: scratch.scratchDbName,
    confirmation: devReset.RESET_CONFIRMATION_PHRASE,
    verifiedBackup: { path: 'C:/dev-reset/pre-reset-test.dump', verifiedAt: new Date().toISOString() },
    actor: { id: 'admin', name: 'Admin' },
  });

  beforeEach(seed);

  it('the seeded append-only tables really refuse a normal DELETE (sanity: triggers are live)', async () => {
    await expect(client.$executeRawUnsafe(`DELETE FROM payments WHERE id = 'p1'`)).rejects.toThrow(/append-only|ممنوع/);
    await expect(client.$executeRawUnsafe(`DELETE FROM activity_logs`)).rejects.toThrow(/append-only|ممنوع/);
  });

  it('resets exactly the 25 tables, preserves everything else, bumps auth_version, leaves one audit entry', async () => {
    const preservedBefore = await preservedFingerprints();
    const installationBefore = (await client.$queryRawUnsafe('SELECT installation_id FROM support_access_config'))[0].installation_id;
    const versionsBefore = await authVersions();

    const result = await devReset.performDevReset(client, args());

    expect(result.databaseName).toBe(scratch.scratchDbName);
    expect(result.usersInvalidated).toBe(2);
    expect(result.deletedCounts).toMatchObject({ payments: 1, treasury_txn: 2, students: 1, activity_logs: 2, admission_payments: 1 });

    const after = await counts(devReset.RESET_TABLES.filter((t) => t !== 'activity_logs'));
    expect(Object.values(after).every((n) => n === 0)).toBe(true);
    const logs = await client.$queryRawUnsafe('SELECT id, action, module, user_id, details FROM activity_logs');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ id: result.activityLogId, action: 'dev_reset', module: 'developer', user_id: 'admin' });
    expect(JSON.parse(logs[0].details).backupPath).toBe('C:/dev-reset/pre-reset-test.dump');

    expect(await preservedFingerprints()).toEqual(preservedBefore);
    expect((await client.$queryRawUnsafe('SELECT installation_id FROM support_access_config'))[0].installation_id).toBe(installationBefore);
    const versionsAfter = await authVersions();
    for (const [id, v] of Object.entries(versionsBefore)) expect(versionsAfter[id]).toBe(v + 1);
  });

  it('append-only triggers survive untouched and still block a normal DELETE after the reset', async () => {
    await devReset.performDevReset(client, args());
    const rows = await client.$queryRawUnsafe(
      `SELECT tgname, tgenabled FROM pg_trigger WHERE NOT tgisinternal AND tgname = ANY($1::text[])`, APPEND_ONLY_TRIGGERS);
    expect(rows.map((r) => r.tgname).sort()).toEqual([...APPEND_ONLY_TRIGGERS].sort());
    expect(rows.every((r) => r.tgenabled === 'O')).toBe(true);
    await expect(client.$executeRawUnsafe(`DELETE FROM activity_logs`)).rejects.toThrow(/append-only|ممنوع/);
  });

  it('RESTART IDENTITY restarts the owned sequences only; standalone seq_* keep their position', async () => {
    const [{ last_value: seqBefore }] = await client.$queryRawUnsafe(`SELECT last_value FROM seq_student_code`);
    await devReset.performDevReset(client, args());
    const [{ id: parentId }] = await client.$queryRawUnsafe(`INSERT INTO parents (full_name) VALUES ('x') RETURNING id`);
    const [{ id: materialId }] = await client.$queryRawUnsafe(`INSERT INTO inv_materials (code, name) VALUES ('M9', 'x') RETURNING id`);
    expect(Number(parentId)).toBe(1);
    expect(Number(materialId)).toBe(1);
    const [{ last_value: seqAfter }] = await client.$queryRawUnsafe(`SELECT last_value FROM seq_student_code`);
    expect(Number(seqAfter)).toBe(Number(seqBefore));
  });

  it('a failure AFTER the TRUNCATE (audit insert fails) rolls everything back — nothing changed', async () => {
    const countsBefore = await counts(devReset.RESET_TABLES);
    const preservedBefore = await preservedFingerprints();
    const versionsBefore = await authVersions();

    const err = await devReset.performDevReset(client, { ...args(), actor: { id: 'no-such-user', name: 'x' } }).catch((e) => e);
    expect(err).toMatchObject({ code: 'reset_failed' });

    expect(await counts(devReset.RESET_TABLES)).toEqual(countsBefore);
    expect(await preservedFingerprints()).toEqual(preservedBefore);
    expect(await authVersions()).toEqual(versionsBefore);
  });

  it('a production-like role without TRUNCATE privilege is refused and nothing changes', async () => {
    await client.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${NO_TRUNCATE_ROLE}') THEN
        EXECUTE 'CREATE ROLE ${NO_TRUNCATE_ROLE} LOGIN';
      END IF; END $$`);
    await client.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${scratch.scratchDbName}" TO ${NO_TRUNCATE_ROLE}`);
    await client.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${NO_TRUNCATE_ROLE}`);
    await client.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${NO_TRUNCATE_ROLE}`);
    await client.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${NO_TRUNCATE_ROLE}`);
    const url = new URL(scratch.scratchUrl);
    url.username = NO_TRUNCATE_ROLE;
    url.password = '';
    const limited = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const countsBefore = await counts(devReset.RESET_TABLES);
    try {
      const err = await devReset.performDevReset(limited, args()).catch((e) => e);
      expect(err).toMatchObject({ code: 'reset_failed' });
      expect(err.details.message).toMatch(/permission denied/i);
    } finally {
      await limited.$disconnect();
    }
    expect(await counts(devReset.RESET_TABLES)).toEqual(countsBefore);
  });

  it('pre-flight on the real catalog: wrong database name, an unclassified table, a preserved→reset FK', async () => {
    const countsBefore = await counts(devReset.RESET_TABLES);

    await expect(devReset.performDevReset(client, { ...args(), expectedDatabaseName: 'studix' }))
      .rejects.toMatchObject({ code: 'database_name_mismatch' });

    await client.$executeRawUnsafe('CREATE TABLE zz_unclassified (id int)');
    try {
      await expect(devReset.performDevReset(client, args())).rejects.toMatchObject({ code: 'unclassified_tables' });
    } finally {
      await client.$executeRawUnsafe('DROP TABLE zz_unclassified');
    }

    await client.$executeRawUnsafe(`ALTER TABLE teachers ADD COLUMN zz_group_id TEXT REFERENCES groups(id)`);
    try {
      await expect(devReset.performDevReset(client, args())).rejects.toMatchObject({ code: 'preserved_references_reset' });
    } finally {
      await client.$executeRawUnsafe('ALTER TABLE teachers DROP COLUMN zz_group_id');
    }

    expect(await counts(devReset.RESET_TABLES)).toEqual(countsBefore);
  });
});
