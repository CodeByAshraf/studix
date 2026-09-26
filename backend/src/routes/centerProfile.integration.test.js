// backend/src/routes/centerProfile.integration.test.js
// ─────────────────────────────────────────────────────────────
// Regression for the "Print Settings save doesn't persist" bug: studix-schema.sql is a
// --schema-only pg_dump (no INSERT), and nothing in bootstrapDatabase.js/firstInstall.js
// seeds a center_profile row — a fresh install starts with ZERO rows. PUT /api/centerProfile
// used to call prisma.center_profile.update({ where: { id: 1 }, ... }), which requires the
// row to already exist — so on a fresh install every "حفظ" click failed with P2025 ("السجل
// غير موجود") and nothing was ever persisted. Fixed by switching to upsert (see
// centerProfile.js). Real scratch database only (setupScratchDb/teardownScratchDb,
// unmodified) — never the real studix database, and no schema/migration/installer file is
// touched by this test or the fix.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('PUT /api/centerProfile — persistence on a fresh (unseeded) install', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, router;

  beforeAll(async () => {
    scratch = await setupScratchDb('centerprofile_route');
    client = scratch.client;
    ({ default: router } = await import('./centerProfile.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    await client.$executeRawUnsafe('DELETE FROM center_profile');
  });

  // Calls the route's PUT handler directly (same technique already used by
  // permissions.integration.test.js) — no HTTP layer, no Prisma mocking.
  async function putCenterProfile(body) {
    const layer = router.stack.find((l) => l.route?.methods?.put);
    const req = { body };
    const result = await new Promise((resolve, reject) => {
      let statusCode = 200;
      const res = {
        status(c) { statusCode = c; return this; },
        json(b) { resolve({ statusCode, body: b }); return this; },
      };
      layer.route.stack[0].handle(req, res, (err) => { if (err) reject(err); });
    });
    return result;
  }

  it('1. default load: a genuinely fresh install has no center_profile row yet', async () => {
    const rows = await client.center_profile.findMany();
    expect(rows).toHaveLength(0);
  });

  it('2-3. editing + save: first save on a fresh install creates the row instead of failing with P2025', async () => {
    const { statusCode, body } = await putCenterProfile({
      name: 'مركز ستوديكس', address: 'القاهرة', phone1: '0100000000', phone2: '', logoUrl: '',
    });

    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe('مركز ستوديكس');

    const rows = await client.center_profile.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });

  it('4. reload: the saved value is what a subsequent read returns', async () => {
    await putCenterProfile({ name: 'اسم مُحفَّظ', address: '', phone1: '', phone2: '', logoUrl: '' });

    const reloaded = await client.center_profile.findUnique({ where: { id: 1 } });
    expect(reloaded.name).toBe('اسم مُحفَّظ');
  });

  it('6. multiple fields persist together in one save', async () => {
    await putCenterProfile({
      name: 'مركز النور', address: '15 شارع الجمهورية', phone1: '0111111111', phone2: '0222222222', logoUrl: 'data:image/png;base64,abc',
    });

    const reloaded = await client.center_profile.findUnique({ where: { id: 1 } });
    expect(reloaded).toMatchObject({
      name: 'مركز النور', address: '15 شارع الجمهورية', phone1: '0111111111', phone2: '0222222222', logo_url: 'data:image/png;base64,abc',
    });
  });

  it('7. empty values behave correctly (cleared fields are saved as empty, not rejected)', async () => {
    await putCenterProfile({ name: 'اسم', address: '', phone1: '', phone2: '', logoUrl: '' });
    await putCenterProfile({ name: '', address: '', phone1: '', phone2: '', logoUrl: '' });

    const reloaded = await client.center_profile.findUnique({ where: { id: 1 } });
    expect(reloaded.name).toBe('');
  });

  it('a second save updates the existing row in place — never creates a second row (CHECK id=1 would reject it anyway)', async () => {
    await putCenterProfile({ name: 'أول', address: '', phone1: '', phone2: '', logoUrl: '' });
    await putCenterProfile({ name: 'ثاني', address: '', phone1: '', phone2: '', logoUrl: '' });

    const rows = await client.center_profile.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('ثاني');
  });
});
