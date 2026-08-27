// backend/src/routes/cryptoGlobalIndependence.integration.test.js
// Phase — BUG-01 functional verification, real scratch database (never the real studix
// database). Deletes globalThis.crypto for the duration of each test, then exercises the
// real exported write-path function from each of the 10 fixed files (crud.js via its
// returned Router directly, since it has no separately exported core function — same
// approach every other file already uses for direct testability without a full HTTP
// server/supertest). If any of these files still relied on the global instead of the
// module import, every one of these calls would throw ReferenceError.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('BUG-01 — write paths do not depend on globalThis.crypto (real scratch database)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client;
  let createPayment;
  let reverseTreasuryTxn;
  let activateAdmission;
  let cancelAdmissionWithRefund;
  let createAdmissionPayment;
  let saveAttendanceSession;
  let saveExamGrades;
  let saveHwSubmissions;
  let saveMaterialDistribution;
  let makeCrudRouter;

  let savedGlobalCrypto;

  beforeAll(async () => {
    scratch = await setupScratchDb('crypto_independence');
    client = scratch.client;

    ({ createPayment } = await import('./payments.js'));
    ({ reverseTreasuryTxn } = await import('./treasuryTxn.js'));
    ({ activateAdmission } = await import('./admissionActivation.js'));
    ({ cancelAdmissionWithRefund } = await import('./admissionCancellation.js'));
    ({ createAdmissionPayment } = await import('./admissionPayments.js'));
    ({ saveAttendanceSession } = await import('./attendanceSessions.js'));
    ({ saveExamGrades } = await import('./examGrades.js'));
    ({ saveHwSubmissions } = await import('./hwSubmissions.js'));
    ({ saveMaterialDistribution } = await import('./materialDistribution.js'));
    ({ makeCrudRouter } = await import('./crud.js'));

    await client.cashboxes.create({ data: { id: 'cb1', name: 'Main', opening_balance: 10000, active: true } });
    await client.groups.create({ data: { id: 'g1', name: 'G1', price: 100 } });
    await client.students.create({ data: { id: 's1', code: 'CRYPTO-S1', name: 'Student 1', group_id: 'g1' } });
    await client.exams.create({ data: { id: 'ex1', name: 'Exam 1', group_id: 'g1', date: new Date(), total: 100 } });
    await client.homeworks.create({ data: { id: 'hw1', title: 'HW 1', group_id: 'g1', total_score: 10, due_date: new Date() } });
    await client.inv_materials.create({ data: { code: 'MAT-1', name: 'Material 1' } });
    await client.treasury_txn.create({
      data: { id: 'tt1', cashbox_id: 'cb1', date: new Date(), type: 'income', category: 'other', amount: 50, method: 'cash', status: 'active' },
    });
    await client.admissions.create({ data: { id: 'adm1', number: 'A1', name: 'Admission 1', stage: 'lead' } });
    await client.admissions.create({ data: { id: 'adm2', number: 'A2', name: 'Admission 2' } });
    await client.admissions.create({ data: { id: 'adm3', number: 'A3', name: 'Admission 3', reservation_status: 'reserved' } });
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(() => {
    savedGlobalCrypto = globalThis.crypto;
    // Simulates a Node runtime where globalThis.crypto doesn't exist (e.g. Node 18.x
    // without --experimental-global-webcrypto) — the exact condition BUG-01 was found under.
    delete globalThis.crypto;
  });

  afterEach(() => {
    globalThis.crypto = savedGlobalCrypto;
  });

  it('sanity check: globalThis.crypto is genuinely absent during these tests', () => {
    expect(globalThis.crypto).toBeUndefined();
  });

  it('payments.js — createPayment succeeds and produces UUID ids', async () => {
    const result = await createPayment(
      { studentId: 's1', month: 1, year: 2026, amount: 100, method: 'cash', payType: 'subscription', date: '2026-01-01', cashboxId: 'cb1' },
      { userId: null }
    );
    expect(result.payment.id).toMatch(UUID_RE);
    expect(result.treasuryTxn.id).toMatch(UUID_RE);
  });

  it('treasuryTxn.js — reverseTreasuryTxn succeeds and produces a UUID id', async () => {
    const result = await reverseTreasuryTxn({ id: 'tt1', reason: 'test reversal' }, { userId: null });
    expect(result.reversal.id).toMatch(UUID_RE);
  });

  it('admissionActivation.js — activateAdmission succeeds and produces a UUID student id', async () => {
    const result = await activateAdmission(
      { admissionId: 'adm1', student: { name: 'New Student', groupId: 'g1' } },
      { userId: null }
    );
    expect(result.student.id).toMatch(UUID_RE);
  });

  it('admissionPayments.js — createAdmissionPayment succeeds and produces UUID ids', async () => {
    const result = await createAdmissionPayment(
      { admissionId: 'adm2', type: 'deposit', amount: 100, date: '2026-01-01', cashboxId: 'cb1' },
      { userId: null }
    );
    expect(result.payment.id).toMatch(UUID_RE);
    expect(result.treasuryTxn.id).toMatch(UUID_RE);
  });

  it('admissionCancellation.js — cancelAdmissionWithRefund succeeds and logs a UUID-keyed system-log entry', async () => {
    const result = await cancelAdmissionWithRefund({ admissionId: 'adm3', reason: 'test cancel' }, { userId: null });
    expect(result.logs[0].id).toMatch(UUID_RE);
  });

  it('attendanceSessions.js — saveAttendanceSession succeeds and produces a UUID attendance id', async () => {
    const result = await saveAttendanceSession({ groupId: 'g1', date: '2026-01-15', sessionTime: null, records: [{ studentId: 's1', status: 'present' }] });
    expect(result.records[0].id).toMatch(UUID_RE);
  });

  it('examGrades.js — saveExamGrades succeeds and produces a UUID grade id', async () => {
    const result = await saveExamGrades({ examId: 'ex1', records: [{ studentId: 's1', score: 90 }] });
    expect(result.records[0].id).toMatch(UUID_RE);
  });

  it('hwSubmissions.js — saveHwSubmissions succeeds and produces a UUID submission id', async () => {
    const result = await saveHwSubmissions({ homeworkId: 'hw1', records: [{ studentId: 's1', status: 'submitted', score: 8 }] });
    expect(result.records[0].id).toMatch(UUID_RE);
  });

  it('materialDistribution.js — saveMaterialDistribution succeeds and produces a UUID inventory_txn id', async () => {
    const material = await client.inv_materials.findFirst({ where: { code: 'MAT-1' } });
    const result = await saveMaterialDistribution(
      { materialId: material.id.toString(), records: [{ studentId: 's1', received: true, payStatus: 'paid', paidAmount: 50 }] },
      { createdBy: null }
    );
    expect(result.records[0].id).toMatch(UUID_RE);
  });

  it('crud.js — the generic router\'s POST / handler succeeds and generates a UUID id (invoked directly, same technique this project already uses to test routers without a full HTTP server)', async () => {
    const router = makeCrudRouter('groups', { writable: true, preserveClientId: true });
    const req = { method: 'POST', url: '/', headers: {}, body: { name: 'Crypto Test Group' } };
    const result = await new Promise((resolve, reject) => {
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(body) { resolve({ statusCode: this.statusCode, body }); return this; },
      };
      router.handle(req, res, (err) => (err ? reject(err) : reject(new Error('no route matched'))));
    });
    expect(result.statusCode).toBe(201);
    expect(result.body.ok).toBe(true);
    expect(result.body.data.id).toMatch(UUID_RE);
  });
});
