// backend/src/routes/crudPolicies.test.js
// P2-1 — unit tests for the generic CRUD domain-rule policies: which generic methods are
// blocked, the create-field whitelists, and the server wiring. The Prisma client is mocked —
// a blocked method must answer 405 without touching the database at all. Real-database proof
// of every rule lives in crudPolicies.integration.test.js.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function mockModel() {
  return {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    create: vi.fn(async ({ data }) => ({ id: 'new-id', ...data })),
    update: vi.fn(async ({ where, data }) => ({ ...where, ...data })),
    delete: vi.fn(async () => ({})),
    aggregate: vi.fn(async () => ({ _max: { score: null } })),
  };
}

const mockPrisma = {};
vi.mock('../prisma.js', () => ({ prisma: mockPrisma }));

const { makeCrudRouter } = await import('./crud.js');
const { CRUD_POLICIES, enforceCreatePolicy } = await import('./crudPolicies.js');
const { COLLECTION_MODELS } = await import('./collections.js');

beforeEach(() => {
  for (const modelName of Object.values(COLLECTION_MODELS)) mockPrisma[modelName] = mockModel();
});

function call(router, { method, url = '/', body }) {
  return new Promise((resolve, reject) => {
    const req = { method, url, headers: {}, body, query: {} };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ statusCode: this.statusCode, body: b }); return this; },
    };
    router.handle(req, res, (err) => (err ? reject(err) : reject(new Error('no route matched'))));
  });
}

function routerFor(apiPath, { writable = true } = {}) {
  return makeCrudRouter(COLLECTION_MODELS[apiPath], { writable, policy: CRUD_POLICIES[apiPath] });
}

function expectNoWrites(apiPath) {
  const m = mockPrisma[COLLECTION_MODELS[apiPath]];
  expect(m.create).not.toHaveBeenCalled();
  expect(m.update).not.toHaveBeenCalled();
  expect(m.delete).not.toHaveBeenCalled();
}

describe('blocked generic writes answer 405 before any database access', () => {
  it.each([
    ['attendance', ['POST', 'PUT', 'PATCH', 'DELETE']],
    ['grades', ['POST', 'PUT', 'PATCH', 'DELETE']],
    ['hwSubmissions', ['POST', 'PUT', 'PATCH', 'DELETE']],
    ['inventoryTxn', ['PUT', 'PATCH', 'DELETE']],
    ['admissionSystemLog', ['PUT', 'PATCH', 'DELETE']],
    ['payments', ['POST', 'PUT', 'PATCH', 'DELETE']],
    ['admissionPayments', ['POST', 'PUT', 'PATCH', 'DELETE']],
  ])('%s: %j', async (apiPath, methods) => {
    const router = routerFor(apiPath);
    for (const method of methods) {
      // eslint-disable-next-line no-await-in-loop
      const res = await call(router, { method, url: method === 'POST' ? '/' : '/some-id', body: { score: 999, status: 'x' } });
      expect(res.statusCode).toBe(405);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBeTruthy();
    }
    expectNoWrites(apiPath);
  });

  it('reads stay available on blocked collections (GET list and GET /:id)', async () => {
    const router = routerFor('attendance');
    expect((await call(router, { method: 'GET', url: '/' })).body.ok).toBe(true);
    mockPrisma.attendance.findUnique.mockResolvedValueOnce({ id: 'a1', status: 'present' });
    expect((await call(router, { method: 'GET', url: '/a1' })).body.data).toEqual({ id: 'a1', status: 'present' });
  });
});

describe('create-field whitelists', () => {
  it('treasuryTxn: a manual entry (with the UI\'s null link fields) is accepted; status is forced to active', async () => {
    const res = await call(routerFor('treasuryTxn'), {
      method: 'POST',
      body: {
        cashboxId: 'cb1', date: '2026-09-01T00:00:00.000Z', type: 'income', category: 'other', amount: 50,
        method: 'cash', party: 'x', notes: 'desc', refType: null, refId: null, admissionId: null,
        sourceModule: null, sourceDocNo: null, status: 'active', createdBy: 'u1',
      },
    });
    expect(res.statusCode).toBe(201);
    const { data } = mockPrisma.treasury_txn.create.mock.calls[0][0];
    expect(data).toMatchObject({ cashbox_id: 'cb1', status: 'active', created_by: 'u1' });
    for (const k of ['ref_type', 'ref_id', 'admission_id', 'source_module', 'source_doc_no', 'payment_id']) {
      expect(data).not.toHaveProperty(k);
    }
  });

  it.each([
    ['status', { status: 'cancelled' }],
    ['ref_type', { refType: 'reversal', refId: 'tx_other' }],
    ['payment_id', { paymentId: 'pay_1' }],
    ['admission_id', { admissionId: 'adm_1' }],
    ['source_module', { sourceModule: 'payments' }],
    ['created_by_name', { createdByName: 'مدير مزيَّف' }],
  ])('treasuryTxn: a non-null %s is rejected with 400 and nothing is written', async (_label, extra) => {
    await expect(call(routerFor('treasuryTxn'), {
      method: 'POST', body: { cashboxId: 'cb1', type: 'income', category: 'x', amount: 1, date: '2026-09-01', ...extra },
    })).rejects.toMatchObject({ status: 400 });
    expect(mockPrisma.treasury_txn.create).not.toHaveBeenCalled();
  });

  it('admissionSystemLog: create keeps the whitelisted fields; a client timestamp is rejected', async () => {
    const ok = await call(routerFor('admissionSystemLog'), {
      method: 'POST', body: { admissionId: 'adm1', activityType: 'created', byUser: 'موظف', details: 'x' },
    });
    expect(ok.statusCode).toBe(201);
    await expect(call(routerFor('admissionSystemLog'), {
      method: 'POST', body: { admissionId: 'adm1', activityType: 'created', timestamp: '2020-01-01T00:00:00Z' },
    })).rejects.toMatchObject({ status: 400 });
  });

  it('activityLogs: a backdated timestamp is rejected; normal entries pass', async () => {
    const ok = await call(routerFor('activityLogs'), {
      method: 'POST', body: { action: 'export', module: 'settings', details: 'x', entityType: null, entityId: null, userId: 'u1', userName: 'n' },
    });
    expect(ok.statusCode).toBe(201);
    await expect(call(routerFor('activityLogs'), {
      method: 'POST', body: { action: 'x', timestamp: '2020-01-01T00:00:00Z' },
    })).rejects.toMatchObject({ status: 400 });
  });

  it('enforceCreatePolicy without a policy leaves data untouched', () => {
    const data = { a: 1, b: null };
    expect(enforceCreatePolicy(undefined, data)).toEqual({ a: 1, b: null });
  });
});

describe('collections without a policy keep their generic behavior', () => {
  it('parents: POST/PUT/DELETE still reach the database', async () => {
    const router = makeCrudRouter('parents', { writable: true, policy: CRUD_POLICIES.parents });
    expect((await call(router, { method: 'POST', body: { fullName: 'x', phone: '010' } })).statusCode).toBe(201);
    expect((await call(router, { method: 'PUT', url: '/5', body: { fullName: 'y' } })).body.ok).toBe(true);
    expect((await call(router, { method: 'DELETE', url: '/5' })).body.ok).toBe(true);
  });
});

describe('server wiring', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  it('every generic collection router receives its CRUD_POLICIES entry', () => {
    expect(server).toMatch(/const policy = CRUD_POLICIES\[apiPath\];/);
    expect(server).toMatch(/makeCrudRouter\(modelName, \{ writable, preserveClientId, policy \}\)/);
  });

  it('authorization is unchanged: requireAuth + requirePermission(pageId) still guard every generic route', () => {
    expect(server).toMatch(/const guards = pageId \? \[requireAuth, requirePermission\(pageId\)\] : \[requireAuth\];/);
    expect(server).toMatch(/app\.use\(`\/api\/\$\{apiPath\}`, \.\.\.guards, makeCrudRouter/);
  });

  it('payments/admissionPayments stay read-only on the generic router', () => {
    expect(server).toMatch(/const READ_ONLY_COLLECTIONS = new Set\(\['payments', 'admissionPayments'\]\);/);
  });

  it('every policy key is a real generic collection', () => {
    for (const key of Object.keys(CRUD_POLICIES)) expect(COLLECTION_MODELS).toHaveProperty(key);
  });
});
