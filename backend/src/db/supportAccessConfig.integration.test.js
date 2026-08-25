// backend/src/db/supportAccessConfig.integration.test.js
// Phase 4a — Support Access schema-only migration (backend/migrations/002_support_access.sql).
// Verifies support_access_config exists with the right structure/constraints on both the
// fresh-install path (schema-only artifact, no seed row) and the incremental migration path
// (existing installations — the CREATE TABLE genuinely executes for real), and that
// installation_id is generated exactly once and stays immutable afterward. Real scratch
// databases only (setupScratchDb/teardownScratchDb, unmodified) — studix الحقيقية لا تُلمَس
// بأي خطوة في هذا الملف. No routes/UI/support-session logic exists yet (out of Phase 4a scope) —
// this file tests the schema only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';
import { runMigrations } from './migrationRunner.js';

const dbCheck = await checkPostgresReachable();
const REAL_MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');
const okBackup = async () => 'C:\\fake\\support-access-test.dump';

describe('support_access_config — Phase 4a schema-only migration (real scratch databases)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  // NOTE on fidelity: applyFullSchemaDDL (the project's established "fresh install already
  // applied studix-schema.sql" fixture, also used by migrationRunner.integration.test.js's
  // own fresh-install block) executes every migration statement literally, DML included —
  // unlike a real fresh install, which restores backend/prisma/studix-schema.sql, a
  // --schema-only pg_dump that excludes this migration's seed INSERT entirely (see
  // 002_support_access.sql's header). So this fixture's "fresh install" ends up WITH the
  // seeded row (asserted below), while a genuine schema-only-restored fresh install would
  // not (documented, not exercised here — no existing helper applies studix-schema.sql
  // itself to a scratch DB; that gap is pre-existing to this test harness, not introduced
  // by Phase 4a).
  describe('fresh install (studix-schema.sql already applied) — table/constraint/trigger exist', () => {
    let scratch;
    beforeAll(async () => {
      scratch = await setupScratchDb('supportcfg_fresh');
      await applyFullSchemaDDL(scratch.client); // simulates the installer having applied studix-schema.sql
    }, 60_000);
    afterAll(async () => { if (scratch) await teardownScratchDb(scratch); });

    it('stamps migration 2 as applied, with zero SQL executed', async () => {
      const result = await runMigrations(scratch.client, {
        migrationsDir: REAL_MIGRATIONS_DIR, databaseUrl: scratch.scratchUrl, backup: okBackup,
      });
      expect(result.action).toBe('stamped');
      expect(result.versions).toContain(2);
    });

    it('the table, its columns, the single-row CHECK, the unique index, and the immutability trigger all exist', async () => {
      const cols = await scratch.client.$queryRaw`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'support_access_config'`;
      const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
      expect(byName.id?.is_nullable).toBe('NO');
      expect(byName.installation_id?.is_nullable).toBe('NO');
      expect(byName.support_public_key?.is_nullable).toBe('YES');
      expect(byName.created_at?.is_nullable).toBe('NO');

      const checkRows = await scratch.client.$queryRaw`
        SELECT conname FROM pg_constraint WHERE conname = 'support_access_config_single_row'`;
      expect(checkRows.length).toBe(1);

      // Checked via pg_indexes (not pg_constraint) on purpose: on this path the table was
      // created by `prisma db push` from schema.prisma, where @unique produces a bare
      // CREATE UNIQUE INDEX (no pg_constraint row) — see students_code_key/
      // admissions_number_key in studix-schema.sql for the same pattern. On the "existing
      // installation" path below, the same guarantee instead comes from this migration's
      // own inline UNIQUE table constraint — both are always backed by a real unique index
      // either way, so pg_indexes reliably detects it regardless of which path created it.
      const uniqueIdxRows = await scratch.client.$queryRaw`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'support_access_config'
          AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%installation_id%'`;
      expect(uniqueIdxRows.length).toBeGreaterThanOrEqual(1);

      const trgRows = await scratch.client.$queryRaw`
        SELECT tgname FROM pg_trigger WHERE tgname = 'trg_support_config_installation_immutable'`;
      expect(trgRows.length).toBe(1);
    });

    it('exactly one row, seeded by this fixture (see fidelity note above — a real schema-only-restored fresh install would not have it)', async () => {
      const rows = await scratch.client.$queryRaw`SELECT id, installation_id FROM support_access_config`;
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(1);
      expect(typeof rows[0].installation_id).toBe('string');
      expect(rows[0].installation_id.length).toBeGreaterThan(0);
    });
  });

  describe('existing installation upgrading to Phase 4a (table did not exist before) — CREATE TABLE executes for real', () => {
    let scratch;
    beforeAll(async () => {
      scratch = await setupScratchDb('supportcfg_existing');
      // db push (inside setupScratchDb) already created support_access_config from the
      // current schema.prisma — drop it so this scratch DB genuinely matches every real
      // Studix installation today, which does not have this table yet.
      await scratch.client.$executeRawUnsafe(`DROP TABLE public.support_access_config`);
    }, 60_000);
    afterAll(async () => { if (scratch) await teardownScratchDb(scratch); });

    it('applies all real pending migrations, creating the table', async () => {
      const result = await runMigrations(scratch.client, {
        migrationsDir: REAL_MIGRATIONS_DIR, databaseUrl: scratch.scratchUrl, backup: okBackup,
      });
      expect(result.action).toBe('migrated');
      expect(result.versions).toContain(2); // exact set intentionally not pinned — grows as later phases add real migrations
    });

    it('table structure matches schema.prisma exactly (columns/nullability)', async () => {
      const cols = await scratch.client.$queryRaw`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'support_access_config'`;
      const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
      expect(Object.keys(byName).sort()).toEqual(
        ['created_at', 'id', 'installation_id', 'support_public_key'].sort()
      );
      expect(byName.id.is_nullable).toBe('NO');
      expect(byName.installation_id.is_nullable).toBe('NO');
      expect(byName.support_public_key.is_nullable).toBe('YES');
      expect(byName.created_at.is_nullable).toBe('NO');
    });

    it('seeded exactly one row (id=1) with a non-empty installation_id and a null support_public_key', async () => {
      const rows = await scratch.client.$queryRaw`
        SELECT id, installation_id, support_public_key FROM support_access_config`;
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(1);
      expect(typeof rows[0].installation_id).toBe('string');
      expect(rows[0].installation_id.length).toBeGreaterThan(0);
      expect(rows[0].support_public_key).toBeNull();
    });

    it('rejects a second row — single-row CHECK constraint', async () => {
      await expect(scratch.client.$executeRawUnsafe(
        `INSERT INTO support_access_config (id, installation_id) VALUES (2, 'x')`
      )).rejects.toThrow(/support_access_config_single_row/);
    });

    it('installation_id is immutable — a raw UPDATE is rejected by the trigger, value unchanged', async () => {
      const [before] = await scratch.client.$queryRaw`SELECT installation_id FROM support_access_config WHERE id = 1`;
      await expect(scratch.client.$executeRawUnsafe(
        `UPDATE support_access_config SET installation_id = 'changed' WHERE id = 1`
      )).rejects.toThrow(/installation_id ثابت/);
      const [after] = await scratch.client.$queryRaw`SELECT installation_id FROM support_access_config WHERE id = 1`;
      expect(after.installation_id).toBe(before.installation_id);
    });

    it('other columns (e.g. support_public_key) remain freely updatable', async () => {
      await scratch.client.$executeRawUnsafe(
        `UPDATE support_access_config SET support_public_key = 'placeholder-pub-key' WHERE id = 1`
      );
      const [row] = await scratch.client.$queryRaw`SELECT support_public_key FROM support_access_config WHERE id = 1`;
      expect(row.support_public_key).toBe('placeholder-pub-key');
    });

    it('a second runMigrations call is a pure no-op (idempotent rerun)', async () => {
      const result = await runMigrations(scratch.client, {
        migrationsDir: REAL_MIGRATIONS_DIR, databaseUrl: scratch.scratchUrl, backup: okBackup,
      });
      expect(result).toEqual({ action: 'up-to-date', versions: [], backupPath: null });
    });
  });
});
