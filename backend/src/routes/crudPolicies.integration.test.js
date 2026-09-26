// backend/src/routes/crudPolicies.integration.test.js
// P2-1 — real-PostgreSQL proof that the generic CRUD router (crud.js + crudPolicies.js) can no
// longer bypass the domain rules enforced by the dedicated APIs, and that the legitimate generic
// operations the UI relies on still work. Invokes makeCrudRouter(...) directly with the exact
// policy server.js passes (same technique as crud.admissionsStudentId.integration.test.js).
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED" test is
// recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';

const dbCheck = await checkPostgresReachable();

describe('generic CRUD domain-rule policies (P2-1, real PostgreSQL integration)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, makeCrudRouter, CRUD_POLICIES, COLLECTION_MODELS;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('crud_policies');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    ({ makeCrudRouter } = await import('./crud.js'));
    ({ CRUD_POLICIES } = await import('./crudPolicies.js'));
    ({ COLLECTION_MODELS } = await import('./collections.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  // Same flags server.js computes for each collection.
  function routerFor(apiPath) {
    const writable = !['payments', 'admissionPayments'].includes(apiPath);
    const preserveClientId = ['students', 'groups', 'admissions', 'cashboxes'].includes(apiPath);
    return makeCrudRouter(COLLECTION_MODELS[apiPath], { writable, preserveClientId, policy: CRUD_POLICIES[apiPath] });
  }

  function call(apiPath, { method, id, body }) {
    const router = routerFor(apiPath);
    return new Promise((resolve, reject) => {
      const req = { method, url: id ? `/${id}` : '/', headers: {}, body, query: {} };
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(b) { resolve({ statusCode: this.statusCode, body: b }); return this; },
      };
      router.handle(req, res, (err) => (err ? reject(err) : reject(new Error('no route matched'))));
    });
  }

  async function seedGroupAndStudent() {
    const groupId = nextId('g');
    await client.groups.create({ data: { id: groupId, name: 'مجموعة', subject: 'رياضيات', grade: 'الثالث', time: '10:00', days: [], max: 10, color: '#000' } });
    const studentId = nextId('s');
    await client.students.create({ data: { id: studentId, name: 'طالب', code: nextId('code'), group_id: groupId, grade: 'الثالث' } });
    return { groupId, studentId };
  }

  async function seedCashbox(opening = 500) {
    const id = nextId('cb');
    await client.cashboxes.create({ data: { id, name: 'خزنة', opening_balance: opening } });
    return id;
  }

  // ── attendance ────────────────────────────────────────────────────────────────────────────
  it('1. a COMPLETED attendance session cannot be modified through generic CRUD (POST/PUT/PATCH/DELETE all 405, row unchanged)', async () => {
    const { groupId, studentId } = await seedGroupAndStudent();
    const date = new Date('2026-09-01T00:00:00.000Z');
    await client.attendance_sessions.create({ data: { id: nextId('as'), group_id: groupId, date, status: 'completed', completed_at: new Date() } });
    const attId = nextId('att');
    await client.attendance.create({ data: { id: attId, student_id: studentId, group_id: groupId, date, status: 'absent' } });

    for (const method of ['PUT', 'PATCH']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await call('attendance', { method, id: attId, body: { status: 'present' } });
      expect(r.statusCode).toBe(405);
    }
    expect((await call('attendance', { method: 'DELETE', id: attId })).statusCode).toBe(405);
    const created = await call('attendance', { method: 'POST', body: { studentId, groupId, date: '2026-09-01T00:00:00.000Z', status: 'present' } });
    expect(created.statusCode).toBe(405);

    const rows = await client.attendance.findMany({ where: { group_id: groupId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('absent');
  });

  // ── grades / exams ────────────────────────────────────────────────────────────────────────
  it('2. a grade above the exam total cannot be written through generic CRUD; lowering the total below saved scores is refused', async () => {
    const { studentId } = await seedGroupAndStudent();
    const examId = nextId('ex');
    await client.exams.create({ data: { id: examId, name: 'امتحان', date: new Date('2026-09-01'), total: 20, pass: 10 } });
    const gradeId = nextId('gr');
    await client.grades.create({ data: { id: gradeId, exam_id: examId, student_id: studentId, score: 18 } });

    expect((await call('grades', { method: 'POST', body: { examId, studentId, score: 50 } })).statusCode).toBe(405);
    expect((await call('grades', { method: 'PUT', id: gradeId, body: { score: 99 } })).statusCode).toBe(405);
    expect((await call('grades', { method: 'DELETE', id: gradeId })).statusCode).toBe(405);
    expect(Number((await client.grades.findUnique({ where: { id: gradeId } })).score)).toBe(18);

    // indirect bypass: shrinking the exam total under an existing score
    await expect(call('exams', { method: 'PUT', id: examId, body: { total: 15, pass: 10 } })).rejects.toMatchObject({ status: 409 });
    expect(Number((await client.exams.findUnique({ where: { id: examId } })).total)).toBe(20);

    // legitimate edits still work: a total >= the highest score, and edits that do not touch total
    const ok = await call('exams', { method: 'PUT', id: examId, body: { total: 18, name: 'امتحان معدَّل' } });
    expect(ok.body.ok).toBe(true);
    expect(Number((await client.exams.findUnique({ where: { id: examId } })).total)).toBe(18);
    expect((await call('exams', { method: 'PATCH', id: examId, body: { name: 'اسم فقط' } })).body.ok).toBe(true);
  });

  // ── hw_submissions / homeworks ────────────────────────────────────────────────────────────
  it('3. a homework submission score above the homework total cannot be written through generic CRUD; the total cannot drop below saved scores', async () => {
    const { studentId } = await seedGroupAndStudent();
    const hwId = nextId('hw');
    await client.homeworks.create({ data: { id: hwId, title: 'واجب', due_date: new Date('2026-09-05'), total_score: 10 } });
    const subId = nextId('sub');
    await client.hw_submissions.create({ data: { id: subId, homework_id: hwId, student_id: studentId, status: 'submitted', score: 9 } });

    expect((await call('hwSubmissions', { method: 'POST', body: { homeworkId: hwId, studentId, score: 50, status: 'submitted' } })).statusCode).toBe(405);
    expect((await call('hwSubmissions', { method: 'PATCH', id: subId, body: { score: 50 } })).statusCode).toBe(405);
    expect((await call('hwSubmissions', { method: 'DELETE', id: subId })).statusCode).toBe(405);
    expect(Number((await client.hw_submissions.findUnique({ where: { id: subId } })).score)).toBe(9);

    await expect(call('homeworks', { method: 'PUT', id: hwId, body: { totalScore: 5 } })).rejects.toMatchObject({ status: 409 });
    expect(Number((await client.homeworks.findUnique({ where: { id: hwId } })).total_score)).toBe(10);
    expect((await call('homeworks', { method: 'PUT', id: hwId, body: { totalScore: 12, title: 'واجب معدَّل' } })).body.ok).toBe(true);
  });

  // ── inventory ledger ──────────────────────────────────────────────────────────────────────
  it('4. a historical inventory transaction cannot be rewritten or deleted through generic CRUD', async () => {
    const material = await client.inv_materials.create({ data: { code: nextId('MAT'), name: 'مذكرة' } });
    const txnId = nextId('it');
    await client.inventory_txn.create({ data: { id: txnId, number: nextId('INV'), material_id: material.id, type: 'purchase', quantity: 10, status: 'active' } });

    for (const [method, body] of [['PUT', { quantity: 1 }], ['PATCH', { status: 'cancelled', paymentId: 'pay_x' }]]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await call('inventoryTxn', { method, id: txnId, body })).statusCode).toBe(405);
    }
    expect((await call('inventoryTxn', { method: 'DELETE', id: txnId })).statusCode).toBe(405);
    const row = await client.inventory_txn.findUnique({ where: { id: txnId } });
    expect(Number(row.quantity)).toBe(10);
    expect(row.status).toBe('active');
    expect(row.payment_id).toBeNull();
  });

  // ── admission system log ──────────────────────────────────────────────────────────────────
  it('5. an admission system log entry cannot be edited or deleted; new entries still work and always get the server timestamp', async () => {
    const admissionId = nextId('adm');
    await client.admissions.create({ data: { id: admissionId, number: nextId('ADM'), name: 'عميل', stage: 'lead' } });
    const logId = nextId('log');
    await client.admission_system_log.create({ data: { id: logId, admission_id: admissionId, activity_type: 'created', details: 'أصلي' } });

    expect((await call('admissionSystemLog', { method: 'PUT', id: logId, body: { details: 'معدَّل' } })).statusCode).toBe(405);
    expect((await call('admissionSystemLog', { method: 'PATCH', id: logId, body: { activityType: 'cancelled' } })).statusCode).toBe(405);
    expect((await call('admissionSystemLog', { method: 'DELETE', id: logId })).statusCode).toBe(405);
    expect((await client.admission_system_log.findUnique({ where: { id: logId } })).details).toBe('أصلي');

    const before = Date.now();
    const created = await call('admissionSystemLog', { method: 'POST', body: { admissionId, activityType: 'reservation', byUser: 'موظف', details: 'حجز' } });
    expect(created.statusCode).toBe(201);
    expect(new Date(created.body.data.timestamp).getTime()).toBeGreaterThanOrEqual(before - 5_000);

    await expect(call('admissionSystemLog', {
      method: 'POST', body: { admissionId, activityType: 'reservation', timestamp: '2020-01-01T00:00:00.000Z' },
    })).rejects.toMatchObject({ status: 400 });
  });

  // ── cashboxes ─────────────────────────────────────────────────────────────────────────────
  it('6. a cashbox opening balance cannot be changed retroactively; the UI\'s normal edit (same opening balance re-sent) still works', async () => {
    const cbId = await seedCashbox(500);

    await expect(call('cashboxes', { method: 'PUT', id: cbId, body: { name: 'x', openingBalance: 900 } })).rejects.toMatchObject({ status: 409 });
    await expect(call('cashboxes', { method: 'PATCH', id: cbId, body: { openingBalance: 0 } })).rejects.toMatchObject({ status: 409 });
    const after = await client.cashboxes.findUnique({ where: { id: cbId } });
    expect(Number(after.opening_balance)).toBe(500);
    expect(after.name).toBe('خزنة');

    // exactly what TreasuryPage sends on edit: the whole cashbox, opening balance unchanged
    const edited = await call('cashboxes', {
      method: 'PUT', id: cbId,
      body: { id: cbId, name: 'خزنة رئيسية', type: 'main', openingBalance: 500, color: '#111', icon: '🏦', notes: 'n', active: true, isDefault: false },
    });
    expect(edited.body.ok).toBe(true);
    expect(edited.body.data.name).toBe('خزنة رئيسية');
    expect(Number((await client.cashboxes.findUnique({ where: { id: cbId } })).opening_balance)).toBe(500);

    // creating a cashbox with an opening balance is still allowed
    const created = await call('cashboxes', { method: 'POST', body: { id: nextId('cb'), name: 'جديدة', openingBalance: 100 } });
    expect(created.statusCode).toBe(201);
    expect(Number(created.body.data.openingBalance)).toBe(100);

    await expect(call('cashboxes', { method: 'PUT', id: 'missing-cashbox', body: { openingBalance: 1 } })).rejects.toMatchObject({ status: 404 });
  });

  // ── treasury ──────────────────────────────────────────────────────────────────────────────
  it('7. a generic treasury transaction cannot carry dangerous fields; a manual income/expense entry still works', async () => {
    const cbId = await seedCashbox(0);
    const base = { cashboxId: cbId, date: new Date('2026-09-01T00:00:00.000Z'), type: 'income', category: 'other', amount: 100, method: 'cash', createdBy: null };
    const countBefore = await client.treasury_txn.count();

    for (const extra of [
      { status: 'cancelled' },
      { refType: 'reversal', refId: 'tx_x' },
      { paymentId: 'pay_x' },
      { admissionId: 'adm_x' },
      { sourceModule: 'payments', sourceDocNo: 'PAY-1' },
      { createdByName: 'مزيَّف' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(call('treasuryTxn', { method: 'POST', body: { ...base, ...extra } })).rejects.toMatchObject({ status: 400 });
    }
    expect(await client.treasury_txn.count()).toBe(countBefore);

    // the UI's manual entry: link fields present but null, status 'active'
    const ok = await call('treasuryTxn', {
      method: 'POST',
      body: { ...base, notes: 'إيراد يدوي', party: '', refType: null, refId: null, admissionId: null, sourceModule: null, sourceDocNo: null, status: 'active' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.body.data.status).toBe('active');
    expect(ok.body.data.refType).toBeNull();
    expect(ok.body.data.paymentId).toBeNull();
  });

  // ── protected financial records ───────────────────────────────────────────────────────────
  it('8. payments and admission payments cannot be created or mutated through generic CRUD', async () => {
    for (const apiPath of ['payments', 'admissionPayments']) {
      for (const [method, id] of [['POST', null], ['PUT', 'p1'], ['PATCH', 'p1'], ['DELETE', 'p1']]) {
        // eslint-disable-next-line no-await-in-loop
        const r = await call(apiPath, { method, id, body: { amount: 1 } });
        expect(r.statusCode).toBe(405);
      }
    }
  });

  // ── unaffected generic CRUD ───────────────────────────────────────────────────────────────
  it('9. collections without a domain rule keep full generic CRUD (parents: create, update, delete)', async () => {
    const created = await call('parents', { method: 'POST', body: { fullName: 'ولي أمر', phone: `010${Date.now() % 100000000}` } });
    expect(created.statusCode).toBe(201);
    const id = created.body.data.id;
    expect((await call('parents', { method: 'PUT', id, body: { fullName: 'ولي أمر معدَّل' } })).body.data.fullName).toBe('ولي أمر معدَّل');
    expect((await call('parents', { method: 'DELETE', id })).body.ok).toBe(true);
    expect(await client.parents.findUnique({ where: { id: BigInt(id) } })).toBeNull();
  });
});
