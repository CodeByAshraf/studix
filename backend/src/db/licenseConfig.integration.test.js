// backend/src/db/licenseConfig.integration.test.js
// Phase 5a — Licensing schema-only migration (backend/migrations/003_licensing.sql).
// Verifies license_config exists with the right structure/constraints on both the
// fresh-install path (schema-only artifact) and the incremental migration path (existing
// installations — the CREATE TABLE genuinely executes for real), that no row is seeded
// (deliberately, unlike Phase 4a's support_access_config — see 003_licensing.sql's header),
// and that the activation-consistency invariant (license_artifact/activated_at both-null-or-
// both-set) is enforced at the database level. Real scratch databases only
// (setupScratchDb/teardownScratchDb, unmodified) — studix الحقيقية لا تُلمَس بأي خطوة في هذا
// الملف. No routes/UI/verification logic exists yet (out of Phase 5a scope) — this file
// tests the schema only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';
import { runMigrations } from './migrationRunner.js';

const dbCheck = await checkPostgresReachable();
const REAL_MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');
const okBackup = async () => 'C:\\fake\\license-config-test.dump';

describe('license_config — Phase 5a schema-only migration (real scratch databases)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  describe('fresh install (studix-schema.sql already applied) — table/constraints/trigger exist, no seeded row', () => {
    let scratch;
    beforeAll(async () => {
      scratch = await setupScratchDb('licensecfg_fresh');
      await applyFullSchemaDDL(scratch.client); // simulates the installer having applied studix-schema.sql
    }, 60_000);
    afterAll(async () => { if (scratch) await teardownScratchDb(scratch); });

    it('stamps migration 3 as applied, with zero SQL executed', async () => {
      const result = await runMigrations(scratch.client, {
        migrationsDir: REAL_MIGRATIONS_DIR, databaseUrl: scratch.scratchUrl, backup: okBackup,
      });
      expect(result.action).toBe('stamped');
      expect(result.versions).toContain(3);
    });

    it('the table, its columns, the single-row CHECK, the activation-consistency CHECK, and the updated_at trigger all exist', async () => {
      const cols = await scratch.client.$queryRaw`
        SELECT column_name, is_nullable, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'license_config'`;
      const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
      expect(byName.id?.is_nullable).toBe('NO');
      expect(byName.licensing_public_key?.is_nullable).toBe('YES');
      expect(byName.license_artifact?.is_nullable).toBe('YES');
      expect(byName.license_id?.is_nullable).toBe('YES');
      expect(byName.product?.is_nullable).toBe('YES');
      expect(byName.expires_at?.is_nullable).toBe('YES');
      expect(byName.features?.is_nullable).toBe('YES');
      expect(byName.features?.data_type).toBe('jsonb');
      expect(byName.activated_at?.is_nullable).toBe('YES');
      expect(byName.created_at?.is_nullable).toBe('NO');
      expect(byName.updated_at?.is_nullable).toBe('NO');

      const singleRowCheck = await scratch.client.$queryRaw`
        SELECT conname FROM pg_constraint WHERE conname = 'license_config_single_row'`;
      expect(singleRowCheck.length).toBe(1);

      const consistencyCheck = await scratch.client.$queryRaw`
        SELECT conname FROM pg_constraint WHERE conname = 'chk_license_activation_consistency'`;
      expect(consistencyCheck.length).toBe(1);

      const trgRows = await scratch.client.$queryRaw`
        SELECT tgname FROM pg_trigger WHERE tgname = 'trg_license_config_updated'`;
      expect(trgRows.length).toBe(1);
    });

    it('no row is seeded — deliberately, unlike support_access_config (nothing needs installation_id-style urgency here yet)', async () => {
      const rows = await scratch.client.$queryRaw`SELECT * FROM license_config`;
      expect(rows.length).toBe(0);
    });
  });

  describe('existing installation upgrading to Phase 5a (table did not exist before) — CREATE TABLE executes for real', () => {
    let scratch;
    beforeAll(async () => {
      scratch = await setupScratchDb('licensecfg_existing');
      // db push (inside setupScratchDb) already created license_config from the current
      // schema.prisma — drop it so this scratch DB genuinely matches every real Studix
      // installation today, which does not have this table yet.
      await scratch.client.$executeRawUnsafe(`DROP TABLE public.license_config`);
    }, 60_000);
    afterAll(async () => { if (scratch) await teardownScratchDb(scratch); });

    it('applies all real pending migrations for real, creating the table, still with no seeded row', async () => {
      const result = await runMigrations(scratch.client, {
        migrationsDir: REAL_MIGRATIONS_DIR, databaseUrl: scratch.scratchUrl, backup: okBackup,
      });
      expect(result.action).toBe('migrated');
      expect(result.versions).toContain(3);

      const rows = await scratch.client.$queryRaw`SELECT * FROM license_config`;
      expect(rows.length).toBe(0);
    });

    it('table structure matches schema.prisma exactly (columns/nullability)', async () => {
      const cols = await scratch.client.$queryRaw`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'license_config'`;
      const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
      expect(Object.keys(byName).sort()).toEqual(
        ['activated_at', 'created_at', 'expires_at', 'features', 'id', 'license_artifact',
          'license_id', 'licensing_public_key', 'product', 'updated_at'].sort()
      );
    });

    it('a manually-inserted row respects the single-row CHECK (id must be 1)', async () => {
      await expect(scratch.client.$executeRawUnsafe(
        `INSERT INTO license_config (id) VALUES (2)`
      )).rejects.toThrow(/license_config_single_row/);
    });

    it('installation_id is NOT a column here — reused from support_access_config only, never duplicated', async () => {
      const cols = await scratch.client.$queryRaw`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'license_config' AND column_name = 'installation_id'`;
      expect(cols.length).toBe(0);
    });

    describe('chk_license_activation_consistency — license_artifact and activated_at are both-null or both-set, never partial', () => {
      it('accepts a fully-empty (not yet activated) row', async () => {
        await scratch.client.license_config.create({ data: { id: 1 } });
        const row = await scratch.client.license_config.findUnique({ where: { id: 1 } });
        expect(row.license_artifact).toBeNull();
        expect(row.activated_at).toBeNull();
      });

      it('accepts license_artifact and activated_at set together', async () => {
        await scratch.client.$executeRawUnsafe(`DELETE FROM license_config`);
        await scratch.client.license_config.create({
          data: { id: 1, license_artifact: 'fake-signed-artifact', activated_at: new Date() },
        });
        const row = await scratch.client.license_config.findUnique({ where: { id: 1 } });
        expect(row.license_artifact).toBe('fake-signed-artifact');
        expect(row.activated_at).not.toBeNull();
      });

      it('rejects license_artifact set without activated_at', async () => {
        await scratch.client.$executeRawUnsafe(`DELETE FROM license_config`);
        await expect(scratch.client.license_config.create({
          data: { id: 1, license_artifact: 'fake-signed-artifact' },
        })).rejects.toThrow();
      });

      it('rejects activated_at set without license_artifact', async () => {
        await scratch.client.$executeRawUnsafe(`DELETE FROM license_config`);
        await expect(scratch.client.license_config.create({
          data: { id: 1, activated_at: new Date() },
        })).rejects.toThrow();
      });
    });

    it('trg_license_config_updated bumps updated_at on UPDATE, leaves other rows/columns alone', async () => {
      await scratch.client.$executeRawUnsafe(`DELETE FROM license_config`);
      const created = await scratch.client.license_config.create({ data: { id: 1, product: 'studix' } });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await scratch.client.$executeRawUnsafe(`UPDATE license_config SET product = 'studix-pro' WHERE id = 1`);
      const updated = await scratch.client.license_config.findUnique({ where: { id: 1 } });
      expect(updated.product).toBe('studix-pro');
      expect(updated.updated_at.getTime()).toBeGreaterThan(created.updated_at.getTime());
    });

    it('a second run is a pure no-op (idempotent rerun)', async () => {
      const result = await runMigrations(scratch.client, {
        migrationsDir: REAL_MIGRATIONS_DIR, databaseUrl: scratch.scratchUrl, backup: okBackup,
      });
      expect(result).toEqual({ action: 'up-to-date', versions: [], backupPath: null });
    });
  });
});
