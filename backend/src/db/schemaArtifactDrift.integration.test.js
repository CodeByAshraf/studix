// backend/src/db/schemaArtifactDrift.integration.test.js
// Phase 6D — closes R1 (final full-system audit finding): "no automated drift-detection
// between studix-schema.sql and backend/migrations/*.sql". Real scratch PostgreSQL
// databases only, never the real studix database.
//
// The gap this guards against: migrationRunner.js's fresh-install path (see
// runMigrationsLocked in migrationRunner.js) trusts a SINGLE canary check
// (functionExists(prisma, 'prevent_delete')) to decide "studix-schema.sql already
// contains everything migrations 001..N would have produced" and, if true, STAMPS every
// migration file as applied WITHOUT executing any of their SQL. Nothing before this test
// ever verified that trust — bootstrapDatabase.integration.test.js's "fresh database ->
// migration runner can subsequently run" test only asserts the resulting action is
// 'stamped'/'up-to-date', never that the two schemas actually agree. If a future
// migration is added/changed without re-running `node backend/scripts/
// generateSchemaArtifact.js`, every fresh customer install from that point silently ships
// with a schema that's missing that migration's changes — the exact corruption class this
// project has already had to repair once, left architecturally possible to recur.
//
// Two independently-built scratch databases:
//   A ("artifact path")   — bootstrapDatabase() applies studix-schema.sql, then
//                            runMigrations() (expected to STAMP, not execute) — exactly
//                            what a real fresh customer install goes through today.
//   B ("authoritative path") — `prisma db push` (schema.prisma) + applyFullSchemaDDL()
//                            (backend/migrations/*.sql applied directly, statement by
//                            statement — the same source runMigrations() itself reads on
//                            an incremental-upgrade install).
// A comprehensive, name-list-free structural snapshot (tables, every column's type/
// nullability/default, primary keys, foreign keys — full pg_get_constraintdef, every
// index including partial/unique — full pg_get_indexdef, every CHECK constraint — full
// pg_get_constraintdef (not just its name), every trigger — full pg_get_triggerdef, every
// function — full pg_get_functiondef) is taken of both and deep-compared. Using the full
// canonical definition text (not just object names) means a same-named object whose
// CONTENT silently changed is caught too, not only additions/removals — this is the
// specific thing item 6 of the Phase 6D plan required ("do not weaken the test by
// comparing only a single canary such as prevent_delete").
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';
import { bootstrapDatabase, BootstrapError } from './bootstrapDatabase.js';
import { runMigrations } from './migrationRunner.js';

// bootstrapDatabase()/runMigrations() both take a cluster-wide advisory lock (deliberately
// fail-fast, never blocking — see their own header comments: this is a production-safety
// property, not a bug). Advisory locks are per-CLUSTER in PostgreSQL, not per-database, so
// when vitest runs integration test FILES in parallel workers (its default), this file's
// calls can genuinely race against bootstrapDatabase.integration.test.js's/
// migrationRunner.integration.test.js's own — already-tested-and-expected contention
// between independent callers, not a bug in either. A short bounded retry here (test setup
// only, never in production code) absorbs that expected cross-file timing without weakening
// what's actually being tested.
async function retryOnLockContention(fn, { attempts = 8, delayMs = 500 } = {}) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      const isLockContention =
        (err instanceof BootstrapError && err.reason === 'bootstrap_in_progress') ||
        /تعذّر الحصول على قفل الترحيل/.test(err?.message || '');
      if (!isLockContention || i === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'prisma', 'studix-schema.sql');

const dbCheck = await checkPostgresReachable();

// ── "bare" (not-yet-existing) scratch database helpers ────────────────────────────────
// Mirrors bootstrapDatabase.integration.test.js's own local helpers exactly (that file's
// own comment explains why: bootstrapDatabase's own create/apply logic needs a database
// that does NOT exist yet, unlike setupScratchDb's "already schema-pushed" shape) — not
// imported from there since these are file-local, not shared production code.
function withDbName(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function dropIfExists(adminUrl, name) {
  const client = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await client.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      name
    );
    await client.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

// ── Comprehensive, definition-level schema snapshot ────────────────────────────────────
// Every query is scoped to schema 'public' only. Views/sequences are deliberately excluded
// — matching the project's own explicit, documented decision (see
// scratchDbFullSchema.js's header and generateSchemaArtifact.js's header): views/sequences
// are not produced by anything in backend/migrations, so they're never part of what "drift"
// could mean here. Sequences backing an autoincrement column ARE covered indirectly, via
// each such column's `column_default` (nextval('<deterministic-name>'::regclass)).
// _studix_migrations is deliberately excluded everywhere below: it is runner-internal
// bookkeeping self-created by migrationRunner.js's own ensureTrackingTable() (called
// unconditionally on every runMigrations() invocation, fresh or incremental) — no
// migration FILE creates it, and applyFullSchemaDDL() (database B's construction, which
// never calls runMigrations() at all) never touches it either. Comparing it would only
// ever detect "did this snapshot's database happen to run the migration runner," never
// real drift between the artifact and the migration set — the one thing this file exists
// to catch.
const TRACKING_TABLE = '_studix_migrations';

// Line-ending normalization only — CRLF vs LF is an environment/checkout artifact (this
// Windows checkout's git core.autocrlf, the same behavior every git command in this repo
// has printed a warning about all session), not a real schema difference: Postgres treats
// \r\n and \n identically inside a plpgsql function/trigger body, and pg_get_*def() output
// is otherwise already fully canonical (whitespace/formatting-independent of how the
// original DDL was written). Applied ONLY to `definition` text, never to any other field —
// a genuine content change (the exact thing this file exists to catch, per the two
// simulated-drift tests below) still fails the comparison normally.
function normalizeDef(text) {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n') : text;
}

async function snapshotSchema(client) {
  const tables = (await client.$queryRaw`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name != ${TRACKING_TABLE}
    ORDER BY table_name
  `).map((r) => r.table_name);

  const columns = (await client.$queryRaw`
    SELECT table_name, column_name, data_type, is_nullable, column_default,
           character_maximum_length, numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name != ${TRACKING_TABLE}
    ORDER BY table_name, column_name
  `).map((c) => ({
    table: c.table_name, column: c.column_name, type: c.data_type,
    nullable: c.is_nullable, default: c.column_default,
    maxLength: c.character_maximum_length, precision: c.numeric_precision, scale: c.numeric_scale,
  }));

  const primaryKeys = (await client.$queryRaw`
    SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name != ${TRACKING_TABLE}
    ORDER BY tc.table_name, kcu.ordinal_position
  `).map((r) => ({ table: r.table_name, column: r.column_name, position: r.ordinal_position }));

  const foreignKeys = (await client.$queryRaw`
    SELECT conrelid::regclass::text AS table_name, conname AS constraint_name, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
    ORDER BY conrelid::regclass::text, conname
  `).map((r) => ({ table: r.table_name, name: r.constraint_name, definition: normalizeDef(r.definition) }));

  const checkConstraints = (await client.$queryRaw`
    SELECT conrelid::regclass::text AS table_name, conname AS constraint_name, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE contype = 'c' AND connamespace = 'public'::regnamespace
    ORDER BY conrelid::regclass::text, conname
  `).map((r) => ({ table: r.table_name, name: r.constraint_name, definition: normalizeDef(r.definition) }));

  const indexes = (await client.$queryRaw`
    SELECT tablename AS table_name, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename != ${TRACKING_TABLE}
    ORDER BY tablename, indexname
  `).map((r) => ({ table: r.table_name, name: r.indexname, definition: normalizeDef(r.indexdef) }));

  const triggers = (await client.$queryRaw`
    SELECT c.relname AS table_name, t.tgname AS trigger_name, pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal
    ORDER BY c.relname, t.tgname
  `).map((r) => ({ table: r.table_name, name: r.trigger_name, definition: normalizeDef(r.definition) }));

  const functions = (await client.$queryRaw`
    SELECT p.proname AS function_name, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    ORDER BY p.proname, pg_get_functiondef(p.oid)
  `).map((r) => ({ name: r.function_name, definition: normalizeDef(r.definition) }));

  return { tables, columns, primaryKeys, foreignKeys, checkConstraints, indexes, triggers, functions };
}

describe('Phase 6D — studix-schema.sql / backend/migrations drift detection (R1)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  const realUrl = process.env.DATABASE_URL;
  const realDbName = new URL(realUrl).pathname.replace(/^\//, '');
  const adminUrl = withDbName(realUrl, 'postgres');
  let counter = 0;
  const bareDbNames = [];

  function freshBareName(suffix) {
    counter += 1;
    const name = `${realDbName}_test_schemadrift_${suffix}_${process.pid}_${counter}`;
    if (name === realDbName) throw new Error('SAFETY: derived scratch name equals the real database name — aborting.');
    bareDbNames.push(name);
    return name;
  }

  let scratchB; // setupScratchDb-managed (db-push shape)
  let clientA;  // bare -> bootstrapDatabase() + runMigrations()
  let scratchUrlA;

  beforeAll(async () => {
    // ── Database A: the real fresh-install path ──────────────────────────────────────
    const nameA = freshBareName('a');
    scratchUrlA = withDbName(realUrl, nameA);
    await retryOnLockContention(() => bootstrapDatabase({ databaseUrl: scratchUrlA, schemaPath: SCHEMA_PATH }));
    clientA = new PrismaClient({ datasources: { db: { url: scratchUrlA } } });
    const migrationResult = await retryOnLockContention(() => runMigrations(clientA, { databaseUrl: scratchUrlA }));
    // Sanity precondition for this whole file: if this ever isn't 'stamped', the fresh-
    // install path itself changed behavior and every assertion below would be testing the
    // wrong thing — fail loudly and immediately rather than silently comparing garbage.
    if (migrationResult.action !== 'stamped') {
      throw new Error(`Expected runMigrations() on a fresh bootstrap to STAMP, got action="${migrationResult.action}" — precondition for this whole test file is violated.`);
    }

    // ── Database B: the authoritative incremental-migration path ────────────────────
    scratchB = await setupScratchDb('schemadrift_b');
    await applyFullSchemaDDL(scratchB.client);
  }, 120_000);

  afterAll(async () => {
    if (clientA) await clientA.$disconnect().catch(() => {});
    if (scratchUrlA) await dropIfExists(adminUrl, new URL(scratchUrlA).pathname.replace(/^\//, '')).catch(() => {});
    if (scratchB) await teardownScratchDb(scratchB);
    for (const name of bareDbNames) {
      await dropIfExists(adminUrl, name).catch(() => {});
    }
  }, 60_000);

  it('database A confirms the fresh-install path really did STAMP (not execute) the migration files', async () => {
    // Re-derived independently of the beforeAll precondition check above, from the actual
    // tracking table content this time — belt-and-suspenders against a false "stamped".
    const rows = await clientA.$queryRaw`SELECT version FROM _studix_migrations ORDER BY version`;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('the repository is in sync TODAY: studix-schema.sql (database A) and backend/migrations/*.sql (database B) produce an identical schema', async () => {
    const [snapA, snapB] = await Promise.all([snapshotSchema(clientA), snapshotSchema(scratchB.client)]);
    expect(snapA).toEqual(snapB);
  });

  describe('the guard genuinely detects future drift (simulated, not a real migration file change)', () => {
    it('a column ADDED to the authoritative path but never applied to the artifact is detected', async () => {
      const scratchC = await setupScratchDb('schemadrift_c_added');
      try {
        await applyFullSchemaDDL(scratchC.client);
        // Simulates: a hypothetical migration 005 adds a column, but nobody re-ran
        // generateSchemaArtifact.js — studix-schema.sql (database A) never learns about it.
        await scratchC.client.$executeRawUnsafe(`ALTER TABLE students ADD COLUMN drift_test_marker TEXT`);

        const [snapA, snapC] = await Promise.all([snapshotSchema(clientA), snapshotSchema(scratchC.client)]);
        expect(snapA).not.toEqual(snapC);
        // Confirms the failure is specifically visible in the columns comparison, not just
        // "some field somewhere differs" — a real reviewer reading a failed assertion here
        // would immediately see the added column.
        expect(snapC.columns.some((c) => c.table === 'students' && c.column === 'drift_test_marker')).toBe(true);
        expect(snapA.columns.some((c) => c.table === 'students' && c.column === 'drift_test_marker')).toBe(false);
      } finally {
        await teardownScratchDb(scratchC);
      }
    });

    it('an existing CHECK constraint CHANGED (same name, different expression) on the authoritative path but not the artifact is detected', async () => {
      const scratchC = await setupScratchDb('schemadrift_c_changed');
      try {
        await applyFullSchemaDDL(scratchC.client);
        // Simulates: a hypothetical migration 005 loosens chk_payment_amount's bound
        // (same constraint NAME — a name-only comparison, like the pre-existing
        // EXPECTED_CHECK_CONSTRAINT_NAMES lists elsewhere, would miss this entirely).
        await scratchC.client.$executeRawUnsafe(
          `ALTER TABLE payments DROP CONSTRAINT chk_payment_amount, ADD CONSTRAINT chk_payment_amount CHECK (amount >= -1)`
        );

        const [snapA, snapC] = await Promise.all([snapshotSchema(clientA), snapshotSchema(scratchC.client)]);
        expect(snapA).not.toEqual(snapC);
        const defA = snapA.checkConstraints.find((c) => c.name === 'chk_payment_amount')?.definition;
        const defC = snapC.checkConstraints.find((c) => c.name === 'chk_payment_amount')?.definition;
        expect(defA).not.toEqual(defC);
      } finally {
        await teardownScratchDb(scratchC);
      }
    });
  });
});
