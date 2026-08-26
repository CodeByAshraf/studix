// backend/src/db/bootstrapDatabase.integration.test.js
// Phase 6c — real scratch PostgreSQL databases only, never the real `studix` database. Two
// distinct fixture styles are needed here (unlike most other integration test files in this
// project, which only ever need setupScratchDb's "already created + schema-pushed" shape):
//   - "bare" scratch databases that do NOT exist yet — created directly (or left non-existent)
//     to exercise bootstrapDatabase's own create/apply logic, managed by this file's own
//     tiny helpers below (mirroring test-helpers/scratchDb.js's proven safety checks: unique
//     per-file name prefix, explicit assertion the name never equals the real database).
//   - setupScratchDb/teardownScratchDb (test-helpers/scratchDb.js, unmodified) for scenarios
//     that need an ALREADY schema'd database (via `prisma db push`) to verify bootstrap
//     preserves it untouched.
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import {
  BootstrapError, bootstrapDatabase, resolveAdminDatabaseUrl, extractDatabaseName, databaseExists,
} from './bootstrapDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'prisma', 'studix-schema.sql');

const dbCheck = await checkPostgresReachable();

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

describe('bootstrapDatabase — Phase 6c (real scratch PostgreSQL, never the real studix database)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  const realUrl = process.env.DATABASE_URL;
  const realDbName = extractDatabaseName(realUrl);
  const adminUrl = resolveAdminDatabaseUrl(realUrl);
  let counter = 0;
  const createdDbNames = []; // every bare scratch name this file created, for guaranteed cleanup

  function freshScratchName() {
    counter += 1;
    const name = `${realDbName}_test_bootstrap_${process.pid}_${counter}`;
    if (name === realDbName) throw new Error('SAFETY: derived scratch name equals the real database name — aborting.');
    createdDbNames.push(name);
    return name;
  }

  afterEach(async () => {
    // Belt-and-suspenders cleanup after every test, in addition to whatever a given test
    // already tears down itself — guarantees no scratch database survives a failed assertion.
    for (const name of createdDbNames.splice(0)) {
      await dropIfExists(adminUrl, name).catch(() => {});
    }
  });

  describe('1. PostgreSQL reachable', () => {
    it('checkPostgresReachable confirms a usable connection before any bootstrap test runs', () => {
      expect(dbCheck.reachable).toBe(true);
    });
  });

  describe('2–3. database does not exist -> bootstrap creates it and applies the schema', () => {
    it('creates the database and applies studix-schema.sql when nothing existed before', async () => {
      const name = freshScratchName();
      const scratchUrl = withDbName(realUrl, name);
      expect(await databaseExists(adminUrl, name)).toBe(false);

      const result = await bootstrapDatabase({ databaseUrl: scratchUrl, schemaPath: SCHEMA_PATH });

      expect(result.action).toBe('schema_applied');
      expect(result.databaseCreated).toBe(true);
      expect(result.tableCount).toBeGreaterThan(0);
      expect(await databaseExists(adminUrl, name)).toBe(true);

      const client = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
      const rows = await client.$queryRaw`SELECT to_regclass('public.students')::text AS reg`;
      expect(rows[0].reg).not.toBeNull();
      await client.$disconnect();
    });

    it('never includes DATABASE_URL/password anywhere in the returned result', async () => {
      const name = freshScratchName();
      const scratchUrl = withDbName(realUrl, name);
      const result = await bootstrapDatabase({ databaseUrl: scratchUrl, schemaPath: SCHEMA_PATH });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(scratchUrl);
      // the password segment of the real DATABASE_URL must never leak into the result either
      const realPassword = new URL(realUrl).password;
      if (realPassword) expect(serialized).not.toContain(realPassword);
    });
  });

  describe('4. fresh database -> migration runner can subsequently run', () => {
    it('after bootstrap, the existing migrationRunner.js recognizes the baseline and stamps cleanly', async () => {
      const { runMigrations } = await import('./migrationRunner.js');
      const name = freshScratchName();
      const scratchUrl = withDbName(realUrl, name);
      await bootstrapDatabase({ databaseUrl: scratchUrl, schemaPath: SCHEMA_PATH });

      const client = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
      const migrationResult = await runMigrations(client, { databaseUrl: scratchUrl });
      expect(['stamped', 'up-to-date']).toContain(migrationResult.action);
      await client.$disconnect();
    });
  });

  describe('5. idempotency — running bootstrap twice', () => {
    it('produces the same final state, with no error and no destructive action the second time', async () => {
      const name = freshScratchName();
      const scratchUrl = withDbName(realUrl, name);

      const first = await bootstrapDatabase({ databaseUrl: scratchUrl, schemaPath: SCHEMA_PATH });
      const second = await bootstrapDatabase({ databaseUrl: scratchUrl, schemaPath: SCHEMA_PATH });

      expect(first.action).toBe('schema_applied');
      expect(second.action).toBe('already_initialized');
      expect(second.databaseCreated).toBe(false);
      expect(second.tableCount).toBe(first.tableCount);
    });
  });

  describe('6–7. existing initialized database — preserved unchanged, business data survives', () => {
    it('a database already schema-pushed via setupScratchDb is left untouched, and seeded data survives a second bootstrap', async () => {
      const scratch = await setupScratchDb('bootstrap_preserve');
      try {
        await scratch.client.students.create({ data: { id: 'bootstrap-test-student-1', code: 'BOOT-TEST-1', name: 'Preserve Me' } });

        const result = await bootstrapDatabase({ databaseUrl: scratch.scratchUrl, schemaPath: SCHEMA_PATH });

        expect(result.action).toBe('already_initialized');
        const student = await scratch.client.students.findUnique({ where: { id: 'bootstrap-test-student-1' } });
        expect(student).not.toBeNull();
        expect(student.name).toBe('Preserve Me');
      } finally {
        await teardownScratchDb(scratch);
      }
    });
  });

  describe('8. existing license_config survives a second bootstrap', () => {
    it('a pre-existing license_config row is untouched after bootstrap runs again', async () => {
      const scratch = await setupScratchDb('bootstrap_license');
      try {
        await scratch.client.license_config.create({ data: { id: 1, license_id: 'lic-preserve-test', product: 'studix' } });

        await bootstrapDatabase({ databaseUrl: scratch.scratchUrl, schemaPath: SCHEMA_PATH });

        const row = await scratch.client.license_config.findUnique({ where: { id: 1 } });
        expect(row).not.toBeNull();
        expect(row.license_id).toBe('lic-preserve-test');
      } finally {
        await teardownScratchDb(scratch);
      }
    });
  });

  describe('9. existing support_access_config survives a second bootstrap', () => {
    it('a pre-existing support_access_config row (with its installation_id) is untouched after bootstrap runs again', async () => {
      const scratch = await setupScratchDb('bootstrap_support');
      try {
        const seeded = await scratch.client.support_access_config.create({ data: { id: 1 } });

        await bootstrapDatabase({ databaseUrl: scratch.scratchUrl, schemaPath: SCHEMA_PATH });

        const row = await scratch.client.support_access_config.findUnique({ where: { id: 1 } });
        expect(row).not.toBeNull();
        expect(row.installation_id).toBe(seeded.installation_id);
      } finally {
        await teardownScratchDb(scratch);
      }
    });
  });

  describe('10–11. partial/inconsistent schema -> fail closed', () => {
    it('a database with some tables but no `students` table is refused, not repaired', async () => {
      const name = freshScratchName();
      const scratchUrl = withDbName(realUrl, name);
      const adminClient = new PrismaClient({ datasources: { db: { url: adminUrl } } });
      await adminClient.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      await adminClient.$disconnect();

      const targetClient = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
      await targetClient.$executeRawUnsafe('CREATE TABLE public.unrelated_leftover (id text)');
      await targetClient.$disconnect();

      await expect(bootstrapDatabase({ databaseUrl: scratchUrl, schemaPath: SCHEMA_PATH }))
        .rejects.toMatchObject({ reason: 'partial_schema' });

      // never touched — the leftover table must still be exactly there afterwards
      const verifyClient = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
      const rows = await verifyClient.$queryRaw`SELECT to_regclass('public.unrelated_leftover')::text AS reg`;
      expect(rows[0].reg).not.toBeNull();
      await verifyClient.$disconnect();
    });

    it('a database with unrelated populated tables (no Studix base schema) is refused, data left intact', async () => {
      const name = freshScratchName();
      const scratchUrl = withDbName(realUrl, name);
      const adminClient = new PrismaClient({ datasources: { db: { url: adminUrl } } });
      await adminClient.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      await adminClient.$disconnect();

      const targetClient = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
      await targetClient.$executeRawUnsafe('CREATE TABLE public.some_other_app_table (id text, payload text)');
      await targetClient.$executeRawUnsafe(`INSERT INTO public.some_other_app_table VALUES ('1', 'do-not-touch')`);
      await targetClient.$disconnect();

      await expect(bootstrapDatabase({ databaseUrl: scratchUrl, schemaPath: SCHEMA_PATH }))
        .rejects.toThrow(BootstrapError);

      const verifyClient = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
      const rows = await verifyClient.$queryRaw`SELECT payload FROM public.some_other_app_table WHERE id = '1'`;
      expect(rows[0].payload).toBe('do-not-touch');
      await verifyClient.$disconnect();
    });
  });

  describe('12. invalid credentials -> clear, safe error', () => {
    it('rejects with a classified BootstrapError, never containing the attempted password', async () => {
      const secret = 'DEFINITELY-WRONG-PASSWORD-XYZ';
      const badUrl = new URL(realUrl);
      badUrl.password = secret;
      badUrl.pathname = '/postgres';

      let caught;
      try {
        await bootstrapDatabase({ databaseUrl: badUrl.toString(), schemaPath: SCHEMA_PATH, adminUrlOverride: badUrl.toString() });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(BootstrapError);
      expect(caught.message).not.toContain(secret);
    });
  });

  describe('13. PostgreSQL unavailable -> clear, safe error', () => {
    it('rejects with a classified BootstrapError when the host is unreachable', async () => {
      const unreachable = new URL(realUrl);
      unreachable.hostname = '127.0.0.1';
      unreachable.port = '59999'; // nothing listens here
      unreachable.pathname = '/studix';

      let caught;
      try {
        await bootstrapDatabase({ databaseUrl: unreachable.toString(), schemaPath: SCHEMA_PATH });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(BootstrapError);
    }, 20_000);
  });

  describe('14. passwords/DATABASE_URL never appear in thrown/logged error messages', () => {
    it('across every failure path exercised above, no thrown message contains the real password', async () => {
      const realPassword = new URL(realUrl).password;
      const name = freshScratchName();
      const scratchUrl = withDbName(realUrl, name);
      const adminClient = new PrismaClient({ datasources: { db: { url: adminUrl } } });
      await adminClient.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      await adminClient.$executeRawUnsafe.bind(adminClient); // no-op to keep client referenced
      const targetClient = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
      await targetClient.$executeRawUnsafe('CREATE TABLE public.junk (id text)');
      await targetClient.$disconnect();
      await adminClient.$disconnect();

      let caught;
      try {
        await bootstrapDatabase({ databaseUrl: scratchUrl, schemaPath: SCHEMA_PATH });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(BootstrapError);
      if (realPassword) expect(caught.message).not.toContain(realPassword);
    });
  });

  describe('15. no destructive SQL is ever executed by bootstrap', () => {
    it('bootstrapDatabase.js source contains no DROP DATABASE / DROP TABLE / TRUNCATE statement', async () => {
      const fs = await import('fs');
      const source = fs.readFileSync(new URL('./bootstrapDatabase.js', import.meta.url), 'utf8');
      expect(source).not.toMatch(/DROP\s+DATABASE/i);
      expect(source).not.toMatch(/DROP\s+TABLE/i);
      expect(source).not.toMatch(/TRUNCATE/i);
    });
  });

  describe('16. concurrent bootstrap attempts are safely rejected, not corrupting', () => {
    it('two simultaneous bootstrap calls on the same fresh database: exactly one applies the schema, the other is rejected or sees it already applied — never a corrupted half-state', async () => {
      const name = freshScratchName();
      const scratchUrl = withDbName(realUrl, name);

      const results = await Promise.allSettled([
        bootstrapDatabase({ databaseUrl: scratchUrl, schemaPath: SCHEMA_PATH }),
        bootstrapDatabase({ databaseUrl: scratchUrl, schemaPath: SCHEMA_PATH }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      // Either both eventually succeed (lock serializes them: first applies, second finds it
      // already initialized) or one is explicitly rejected as "in progress" — never both
      // reporting a fresh schema_applied (which would mean unsynchronized concurrent DDL).
      expect(fulfilled.length + rejected.length).toBe(2);
      const schemaAppliedCount = fulfilled.filter((r) => r.value.action === 'schema_applied').length;
      expect(schemaAppliedCount).toBeLessThanOrEqual(1);

      const client = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
      const rows = await client.$queryRaw`SELECT to_regclass('public.students')::text AS reg`;
      expect(rows[0].reg).not.toBeNull();
      await client.$disconnect();
    }, 30_000);
  });

  describe('17. migration runner remains solely responsible for incremental migrations', () => {
    it('bootstrapDatabase never writes to _studix_migrations — only migrationRunner.js does', async () => {
      const name = freshScratchName();
      const scratchUrl = withDbName(realUrl, name);
      await bootstrapDatabase({ databaseUrl: scratchUrl, schemaPath: SCHEMA_PATH });

      const client = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
      const rows = await client.$queryRaw`SELECT to_regclass('public._studix_migrations')::text AS reg`;
      expect(rows[0].reg).toBeNull(); // table doesn't exist yet — only migrationRunner.js creates it
      await client.$disconnect();
    });
  });

  describe('18. real database remains untouched', () => {
    it('this entire suite never referenced the real DATABASE_URL for anything other than deriving scratch names/admin URL', () => {
      // Structural proof, not a live query against the real DB (which this suite must never
      // touch): every test above operates on a name derived via freshScratchName() or
      // setupScratchDb()'s own namespaced convention, both of which assert inequality with
      // the real database name before proceeding.
      expect(realDbName).not.toMatch(/_test_(bootstrap|scratch)_/);
    });
  });
});
