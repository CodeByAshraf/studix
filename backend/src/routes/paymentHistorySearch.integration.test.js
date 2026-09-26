// backend/src/routes/paymentHistorySearch.integration.test.js
// Scalability Architecture Phase 4 — real PostgreSQL integration (scratch database only).
// Proves the new, additive GET /api/payments/search reproduces PaymentHistory.jsx's exact
// current client-side filter/search/sort/paginate/totalFiltered behavior (see the Phase 4
// audit): month/groupId/status equality, name-or-id substring search (case-insensitive, not
// trimmed), newest-first ordering, page-beyond-last clamps to the last page instead of
// returning empty, and total/totalAmount computed over the WHOLE filtered set (not just the
// current page, no refund netting). Same technique as paymentsScopedGet.integration.test.js
// (real Express app + real HTTP requests) plus a dedicated equivalence test against an
// in-memory reference implementation of the OLD client-side logic.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function request(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* n/a */ }
        resolve({ status: res.statusCode, body: json });
      });
    }).on('error', reject);
  });
}

// نسخة طبق الأصل من منطق PaymentHistory.jsx القديم (filter/search/sort/paginate/
// totalFiltered) فوق بيانات في الذاكرة — مرجع الحقيقة لاختبار التكافؤ أدناه، لا يُستورَد من
// الكود الحقيقي عمداً (لو تغيّر أحدهما بلا الآخر، يفشل الاختبار بدل أن يُخفي الانحراف).
function referenceFilterSortPaginate(payments, students, { month, groupId, status, search, page, pageSize }) {
  const q = (search || '').toLowerCase();
  const filtered = payments
    .filter((p) => {
      if (month && p.month !== Number(month)) return false;
      if (groupId && p.groupId !== groupId) return false;
      if (status && p.status !== status) return false;
      if (q) {
        const student = students.find((s) => s.id === p.studentId);
        if (!student?.name.toLowerCase().includes(q) && !p.id.toLowerCase().includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * pageSize;
  const totalAmount = filtered.reduce((s, p) => s + p.amount, 0);

  return {
    items: filtered.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    total,
    totalAmount,
  };
}

describe('GET /api/payments/search — PaymentHistory scoped search/pagination (real PostgreSQL + Express, Phase 4)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port;
  let seq = 0;

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  beforeAll(async () => {
    scratch = await setupScratchDb('payment_history_search');
    client = scratch.client;

    const paymentsRouter = (await import('./payments.js')).default;
    const { errorHandler } = await import('../middleware/errorHandler.js');

    const app = express();
    app.use('/api/payments', paymentsRouter);
    app.use(errorHandler);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  // كل الاختبارات في هذا الملف تشارك قاعدة scratch واحدة (beforeAll مرة واحدة، بنفس منهجية
  // ملفات التكامل الأخرى) — لكن اختبارات هذا الملف تحديداً تتحقق من total/totalAmount/
  // totalPages على *كامل* المجموعة المُفلترة، فتسريب صفوف من اختبار سابق يُخطئ هذه الأرقام.
  // تفريغ payments قبل كل اختبار يعزل كل اختبار تماماً (بلا أثر جانبي على students/groups —
  // لا شيء آخر يعتمد على صفوف payments هنا، لا treasury_txn/communications تُنشَأ في هذا الملف).
  beforeEach(async () => {
    await client.payments.deleteMany({});
  });

  async function seedStudent(overrides = {}) {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'طالب اختبار', status: 'active', ...overrides } });
  }

  async function seedGroup(overrides = {}) {
    const id = nextId('g');
    return client.groups.create({ data: { id, name: 'مجموعة اختبار', price: 300, ...overrides } });
  }

  async function seedPayment(studentId, overrides = {}) {
    const id = overrides.id || nextId('p');
    return client.payments.create({
      data: {
        id, student_id: studentId, month: 1, year: 2026, amount: 300,
        pay_type: 'subscription', date: new Date('2026-01-05'), status: 'paid',
        ...overrides, id,
      },
    });
  }

  it('no filters: returns every row, newest-first, with correct total/totalAmount', async () => {
    const student = await seedStudent();
    await seedPayment(student.id, { amount: 100, date: new Date('2026-01-01') });
    await seedPayment(student.id, { amount: 200, date: new Date('2026-01-15') });

    const res = await request(port, '/api/payments/search?limit=50');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.totalAmount).toBe(300);
    expect(res.body.data.items[0].date >= res.body.data.items[res.body.data.items.length - 1].date || res.body.data.items.length === 1).toBe(true);
  });

  it('month filter: exact equality, matches PaymentHistory.jsx', async () => {
    const student = await seedStudent();
    await seedPayment(student.id, { month: 1 });
    await seedPayment(student.id, { month: 2 });

    const res = await request(port, `/api/payments/search?month=1&limit=50`);
    expect(res.body.data.items.every((p) => p.month === 1)).toBe(true);
    expect(res.body.data.items.some((p) => p.month === 2)).toBe(false);
  });

  it('group filter: exact equality', async () => {
    const groupA = await seedGroup();
    const groupB = await seedGroup();
    const studentA = await seedStudent({ group_id: groupA.id });
    const studentB = await seedStudent({ group_id: groupB.id });
    await seedPayment(studentA.id, { group_id: groupA.id });
    await seedPayment(studentB.id, { group_id: groupB.id });

    const res = await request(port, `/api/payments/search?groupId=${groupA.id}&limit=50`);
    expect(res.body.data.items.every((p) => p.groupId === groupA.id)).toBe(true);
  });

  it('status filter: exact equality (paid/partial/unpaid)', async () => {
    const student = await seedStudent();
    await seedPayment(student.id, { status: 'paid' });
    await seedPayment(student.id, { status: 'partial' });
    await seedPayment(student.id, { status: 'unpaid' });

    const res = await request(port, `/api/payments/search?status=partial&limit=50`);
    expect(res.body.data.items.every((p) => p.status === 'partial')).toBe(true);
  });

  it('search by full student name', async () => {
    const student = await seedStudent({ name: 'محمد أحمد الفريد' });
    const other = await seedStudent({ name: 'سارة علي' });
    await seedPayment(student.id);
    await seedPayment(other.id);

    const res = await request(port, `/api/payments/search?search=${encodeURIComponent('محمد أحمد الفريد')}&limit=50`);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].studentId).toBe(student.id);
  });

  it('search by partial student name', async () => {
    const student = await seedStudent({ name: 'محمد أحمد الفريد' });
    const other = await seedStudent({ name: 'سارة علي' });
    await seedPayment(student.id);
    await seedPayment(other.id);

    const res = await request(port, `/api/payments/search?search=${encodeURIComponent('أحمد')}&limit=50`);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].studentId).toBe(student.id);
  });

  it('search by payment id', async () => {
    const student = await seedStudent();
    const target = await seedPayment(student.id, { id: 'UNIQUE-PAY-ID-777' });
    await seedPayment(student.id, { id: nextId('other') });

    const res = await request(port, `/api/payments/search?search=UNIQUE-PAY-ID-777&limit=50`);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].id).toBe(target.id);
  });

  it('search is case-insensitive and NOT trimmed — matches search.toLowerCase() with no trim', async () => {
    const student = await seedStudent({ name: 'Ahmed Ali' });
    const other = await seedStudent({ name: 'سارة علي' });
    await seedPayment(student.id);
    await seedPayment(other.id);

    const upper = await request(port, `/api/payments/search?search=${encodeURIComponent('AHMED')}&limit=50`);
    expect(upper.body.data.items).toHaveLength(1);
    expect(upper.body.data.items[0].studentId).toBe(student.id);

    // مسافة وحيدة (غير مُهذَّبة) تُطابق أي اسم يحوي مسافة — "Ahmed Ali" يحوي مسافة.
    const spaceOnly = await request(port, `/api/payments/search?search=${encodeURIComponent(' ')}&limit=50`);
    expect(spaceOnly.body.data.items.some((p) => p.studentId === student.id)).toBe(true);
  });

  it('combined filters: month + group + status + search together', async () => {
    const group = await seedGroup();
    const student = await seedStudent({ name: 'خالد سعيد', group_id: group.id });
    const decoy = await seedStudent({ name: 'خالد آخر', group_id: group.id });
    await seedPayment(student.id, { group_id: group.id, month: 3, status: 'paid' });
    await seedPayment(student.id, { group_id: group.id, month: 3, status: 'unpaid' }); // wrong status
    await seedPayment(student.id, { group_id: group.id, month: 4, status: 'paid' }); // wrong month
    await seedPayment(decoy.id, { group_id: group.id, month: 3, status: 'paid' }); // wrong name

    const res = await request(
      port,
      `/api/payments/search?month=3&groupId=${group.id}&status=paid&search=${encodeURIComponent('سعيد')}&limit=50`
    );
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].studentId).toBe(student.id);
  });

  it('newest-first ordering by date', async () => {
    const student = await seedStudent();
    await seedPayment(student.id, { date: new Date('2026-01-01') });
    await seedPayment(student.id, { date: new Date('2026-03-01') });
    await seedPayment(student.id, { date: new Date('2026-02-01') });

    const res = await request(port, `/api/payments/search?limit=50`);
    const dates = res.body.data.items.map((p) => p.date);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });

  it('page 1 and page 2 return distinct, correctly-sized slices', async () => {
    const student = await seedStudent();
    for (let i = 0; i < 5; i += 1) {
      await seedPayment(student.id, { date: new Date(`2026-01-${String(i + 1).padStart(2, '0')}`), amount: 10 + i });
    }

    const page1 = await request(port, '/api/payments/search?limit=2&page=1');
    const page2 = await request(port, '/api/payments/search?limit=2&page=2');
    expect(page1.body.data.items).toHaveLength(2);
    expect(page2.body.data.items).toHaveLength(2);
    const ids1 = page1.body.data.items.map((p) => p.id);
    const ids2 = page2.body.data.items.map((p) => p.id);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });

  it('page beyond available rows clamps to the last page (matches paginate() in helpers.js, not an empty page)', async () => {
    const student = await seedStudent();
    await seedPayment(student.id);
    await seedPayment(student.id);

    const res = await request(port, '/api/payments/search?limit=2&page=99');
    expect(res.body.data.page).toBe(1); // totalPages = ceil(2/2) = 1
    expect(res.body.data.items).toHaveLength(2);
  });

  it('total count is correct across all filtered rows, not just the current page', async () => {
    const student = await seedStudent();
    for (let i = 0; i < 7; i += 1) await seedPayment(student.id, { date: new Date(`2026-01-0${i + 1}`) });

    const res = await request(port, '/api/payments/search?limit=3&page=1');
    expect(res.body.data.total).toBe(7);
    expect(res.body.data.items).toHaveLength(3);
  });

  it('total amount is the gross sum over all filtered rows (no refund netting), not just the current page', async () => {
    const student = await seedStudent();
    await seedPayment(student.id, { amount: 100, date: new Date('2026-01-01') });
    await seedPayment(student.id, { amount: 250, date: new Date('2026-01-02') });
    await seedPayment(student.id, { amount: 50, date: new Date('2026-01-03') });

    const res = await request(port, '/api/payments/search?limit=1&page=1');
    expect(res.body.data.totalAmount).toBe(400);
  });

  it('empty result: filters matching nothing return an empty array, not an error', async () => {
    const res = await request(port, '/api/payments/search?search=no-such-payment-xyz');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.totalAmount).toBe(0);
    expect(res.body.data.page).toBe(1);
  });

  it('status filter distinguishes paid/partial/unpaid independently', async () => {
    const student = await seedStudent();
    await seedPayment(student.id, { status: 'paid' });
    await seedPayment(student.id, { status: 'partial' });
    await seedPayment(student.id, { status: 'unpaid' });

    const paid = await request(port, '/api/payments/search?status=paid&limit=50');
    const unpaid = await request(port, '/api/payments/search?status=unpaid&limit=50');
    expect(paid.body.data.items.every((p) => p.status === 'paid')).toBe(true);
    expect(unpaid.body.data.items.every((p) => p.status === 'unpaid')).toBe(true);
  });

  it('invalid page/limit/month/status parameters are rejected with 400', async () => {
    const badPage = await request(port, '/api/payments/search?page=0');
    const badLimit = await request(port, '/api/payments/search?limit=abc');
    const badMonth = await request(port, '/api/payments/search?month=13');
    const badStatus = await request(port, '/api/payments/search?status=cancelled');
    expect(badPage.status).toBe(400);
    expect(badLimit.status).toBe(400);
    expect(badMonth.status).toBe(400);
    expect(badStatus.status).toBe(400);
  });

  it('large dataset: only the requested page rows are returned, not the whole table', async () => {
    const student = await seedStudent();
    for (let i = 0; i < 40; i += 1) {
      await seedPayment(student.id, { date: new Date(2026, 0, 1 + (i % 28)), amount: 10 });
    }

    const res = await request(port, '/api/payments/search?limit=5&page=1');
    expect(res.body.data.items).toHaveLength(5);
    expect(res.body.data.total).toBeGreaterThanOrEqual(40);
  });

  it('equivalence: server result matches an in-memory reference implementation of the old client logic', async () => {
    const groupA = await seedGroup({ name: 'مجموعة أ' });
    const groupB = await seedGroup({ name: 'مجموعة ب' });
    const students = await Promise.all([
      seedStudent({ name: 'ياسمين خالد', group_id: groupA.id }),
      seedStudent({ name: 'ياسر خالد', group_id: groupB.id }),
      seedStudent({ name: 'نور الدين', group_id: groupA.id }),
    ]);

    const seededPayments = [];
    const statuses = ['paid', 'partial', 'unpaid'];
    const months = [1, 2, 3];
    for (let i = 0; i < 25; i += 1) {
      const student = students[i % students.length];
      const month = months[i % months.length];
      const status = statuses[i % statuses.length];
      const groupId = student.group_id;
      const amount = 50 + i * 7;
      const date = new Date(2026, month - 1, 1 + (i % 27));
      const row = await seedPayment(student.id, { group_id: groupId, month, status, amount, date });
      seededPayments.push({
        id: row.id, studentId: row.student_id, groupId: row.group_id, month: row.month,
        status: row.status, amount: Number(row.amount), date: row.date.toISOString().slice(0, 10),
      });
    }
    const refStudents = students.map((s) => ({ id: s.id, name: s.name }));

    const cases = [
      { month: '', groupId: '', status: '', search: '', page: 1, pageSize: 10 },
      { month: '2', groupId: '', status: '', search: '', page: 1, pageSize: 5 },
      { month: '', groupId: groupA.id, status: '', search: '', page: 1, pageSize: 10 },
      { month: '', groupId: '', status: 'paid', search: '', page: 2, pageSize: 4 },
      { month: '', groupId: '', status: '', search: 'خالد', page: 1, pageSize: 50 },
      { month: '1', groupId: groupA.id, status: 'partial', search: '', page: 1, pageSize: 50 },
      { month: '', groupId: '', status: '', search: '', page: 999, pageSize: 6 }, // beyond last page
    ];

    for (const c of cases) {
      const expected = referenceFilterSortPaginate(seededPayments, refStudents, c);
      const qs = new URLSearchParams();
      if (c.month) qs.set('month', c.month);
      if (c.groupId) qs.set('groupId', c.groupId);
      if (c.status) qs.set('status', c.status);
      if (c.search) qs.set('search', c.search);
      qs.set('page', String(c.page));
      qs.set('limit', String(c.pageSize));

      const res = await request(port, `/api/payments/search?${qs.toString()}`);
      expect(res.status, `case ${JSON.stringify(c)}`).toBe(200);
      expect(res.body.data.page, `page for ${JSON.stringify(c)}`).toBe(expected.page);
      expect(res.body.data.totalPages, `totalPages for ${JSON.stringify(c)}`).toBe(expected.totalPages);
      expect(res.body.data.total, `total for ${JSON.stringify(c)}`).toBe(expected.total);
      expect(res.body.data.totalAmount, `totalAmount for ${JSON.stringify(c)}`).toBe(expected.totalAmount);
      expect(res.body.data.items.map((p) => p.id), `item ids for ${JSON.stringify(c)}`).toEqual(expected.items.map((p) => p.id));
    }
  });
});
