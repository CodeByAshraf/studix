// backend/src/routes/paymentsAggregate.integration.test.js
// Scalability Architecture Phase 4 (broader analytics consumers) — real PostgreSQL
// integration (scratch database only). Proves getPaymentAggregates reproduces the exact
// reference formulas already used client-side:
//   - src/services/paymentService.js's getRevenueByGroup (groupBy=group)
//   - getMonthlyBreakdown/getMonthlyRevenue (groupBy=month, year-scoped)
//   - src/modules/reports/FinancialAnalytics.jsx's byMethod/byStatus (count-only, no
//     refund netting — this is a documented, intentional match of the CURRENT behavior,
//     not a new business rule: the existing code counts records, it does not net revenue,
//     for these two specific breakdowns)
//   - src/modules/reports/StudentPerformance.jsx's per-student totalPaid (groupBy=student,
//     all-time)
//   - src/modules/payments/PaymentReports.jsx's dailyData (groupBy=day, month+year-scoped)
//   - src/services/paymentService.js's getNetRevenue (groupBy=none, the "total" KPI)
// Also covers the new date=/limit=/orderBy= additions to the base GET / route
// (FinancialAnalytics.jsx's todayRev and "recent 8 payments").
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

describe('GET /api/payments/aggregate + date/limit/orderBy — real PostgreSQL + Express integration (Phase 4)', () => {
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
    scratch = await setupScratchDb('payments_aggregate');
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

  async function seedStudent(overrides = {}) {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'طالب اختبار', status: 'active', ...overrides } });
  }
  async function seedGroup(overrides = {}) {
    const id = nextId('g');
    return client.groups.create({ data: { id, name: 'مجموعة اختبار', ...overrides } });
  }
  async function seedCashbox() {
    const id = nextId('cb');
    return client.cashboxes.create({ data: { id, name: 'خزنة', active: true } });
  }
  async function seedPayment(overrides = {}) {
    return client.payments.create({
      data: {
        id: nextId('p'), student_id: overrides.student_id, month: 1, year: 2026, amount: 300,
        method: 'cash', pay_type: 'subscription', date: new Date('2026-01-05'), status: 'paid', ...overrides,
      },
    });
  }
  async function seedRefund(cashboxId, payment, amount, overrides = {}) {
    return client.treasury_txn.create({
      data: {
        id: nextId('tx'), cashbox_id: cashboxId, date: new Date('2026-01-10'), type: 'expense',
        category: 'refund', amount, ref_type: 'refund', ref_id: payment.id, payment_id: payment.id,
        status: 'active', ...overrides,
      },
    });
  }

  it('groupBy=group: matches getRevenueByGroup exactly — all-time, net of active refunds', async () => {
    const cashbox = await seedCashbox();
    const groupA = await seedGroup();
    const groupB = await seedGroup();
    const s1 = await seedStudent({ group_id: groupA.id });
    const s2 = await seedStudent({ group_id: groupB.id });
    const p1 = await seedPayment({ student_id: s1.id, group_id: groupA.id, amount: 1000 });
    await seedRefund(cashbox.id, p1, 300); // net 700 for groupA
    await seedPayment({ student_id: s2.id, group_id: groupB.id, amount: 500 }); // net 500 for groupB

    const res = await request(port, '/api/payments/aggregate?groupBy=group');
    const byGroup = Object.fromEntries(res.body.data.map((d) => [d.key, d.revenue]));
    expect(byGroup[groupA.id]).toBe(700);
    expect(byGroup[groupB.id]).toBe(500);
  });

  it('groupBy=student: matches StudentPerformance.jsx\'s totalPaid exactly — all-time, per student, net of refunds', async () => {
    const s1 = await seedStudent();
    const s2 = await seedStudent();
    await seedPayment({ student_id: s1.id, amount: 200 });
    await seedPayment({ student_id: s1.id, amount: 100, month: 2 });
    await seedPayment({ student_id: s2.id, amount: 50 });

    const res = await request(port, '/api/payments/aggregate?groupBy=student');
    const byStudent = Object.fromEntries(res.body.data.map((d) => [d.key, d.revenue]));
    expect(byStudent[s1.id]).toBe(300);
    expect(byStudent[s2.id]).toBe(50);
  });

  it('groupBy=month, year-scoped: matches getMonthlyBreakdown exactly, Dec/Jan year boundary distinguished', async () => {
    const s1 = await seedStudent();
    await seedPayment({ student_id: s1.id, month: 12, year: 2025, date: new Date('2025-12-20'), amount: 100 });
    await seedPayment({ student_id: s1.id, month: 1, year: 2026, date: new Date('2026-01-05'), amount: 200 });
    await seedPayment({ student_id: s1.id, month: 1, year: 2025, date: new Date('2025-01-05'), amount: 999 }); // same month number, different year

    const res2026 = await request(port, `/api/payments/aggregate?groupBy=month&year=2026&studentId=${s1.id}`);
    const byMonth2026 = Object.fromEntries(res2026.body.data.map((d) => [d.key, d.revenue]));
    expect(byMonth2026[1]).toBe(200);
    expect(byMonth2026[12]).toBeUndefined();

    const res2025 = await request(port, `/api/payments/aggregate?groupBy=month&year=2025&studentId=${s1.id}`);
    const byMonth2025 = Object.fromEntries(res2025.body.data.map((d) => [d.key, d.revenue]));
    expect(byMonth2025[12]).toBe(100);
    expect(byMonth2025[1]).toBe(999);
  });

  it('groupBy=day, month+year-scoped: matches PaymentReports.jsx\'s dailyData exactly', async () => {
    const s1 = await seedStudent();
    await seedPayment({ student_id: s1.id, month: 3, year: 2026, date: new Date('2026-03-01'), amount: 100 });
    await seedPayment({ student_id: s1.id, month: 3, year: 2026, date: new Date('2026-03-01'), amount: 50 }); // same day, sums together
    await seedPayment({ student_id: s1.id, month: 3, year: 2026, date: new Date('2026-03-02'), amount: 75 });

    const res = await request(port, '/api/payments/aggregate?groupBy=day&month=3&year=2026');
    const byDay = Object.fromEntries(res.body.data.map((d) => [d.key, d.revenue]));
    expect(byDay['2026-03-01']).toBe(150);
    expect(byDay['2026-03-02']).toBe(75);
  });

  it('groupBy=method and groupBy=status: COUNT only, no refund netting — matches FinancialAnalytics.jsx\'s byMethod/byStatus exactly (all-time, unfiltered)', async () => {
    const cashbox = await seedCashbox();
    const s1 = await seedStudent();
    const p1 = await seedPayment({ student_id: s1.id, method: 'cash', status: 'paid', amount: 1000 });
    await seedRefund(cashbox.id, p1, 1000); // fully refunded — must still COUNT (count-only dimension)
    await seedPayment({ student_id: s1.id, method: 'cash', status: 'partial', amount: 100 });
    await seedPayment({ student_id: s1.id, method: 'transfer', status: 'paid', amount: 200 });

    const byMethod = await request(port, `/api/payments/aggregate?groupBy=method&studentId=${s1.id}`);
    const methodCounts = Object.fromEntries(byMethod.body.data.map((d) => [d.key, d.count]));
    expect(methodCounts.cash).toBe(2);
    expect(methodCounts.transfer).toBe(1);
    expect(byMethod.body.data[0].revenue).toBeUndefined(); // count-only, no revenue field at all

    const byStatus = await request(port, `/api/payments/aggregate?groupBy=status&studentId=${s1.id}`);
    const statusCounts = Object.fromEntries(byStatus.body.data.map((d) => [d.key, d.count]));
    expect(statusCounts.paid).toBe(2);
    expect(statusCounts.partial).toBe(1);
  });

  it('groupBy=none: matches getNetRevenue(payments) exactly — single all-time total, net of refunds', async () => {
    const cashbox = await seedCashbox();
    const s1 = await seedStudent();
    const p1 = await seedPayment({ student_id: s1.id, amount: 1000 });
    await seedRefund(cashbox.id, p1, 400);
    await seedPayment({ student_id: s1.id, amount: 500 });

    const res = await request(port, `/api/payments/aggregate?groupBy=none&studentId=${s1.id}`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].count).toBe(2);
    expect(res.body.data[0].revenue).toBe(1000 - 400 + 500);
  });

  it('groupBy=none with a year filter: matches the "monthRev"/"total-for-a-year" pattern', async () => {
    const s1 = await seedStudent();
    await seedPayment({ student_id: s1.id, year: 2026, amount: 100 });
    await seedPayment({ student_id: s1.id, year: 2025, amount: 9999 });

    const res = await request(port, `/api/payments/aggregate?groupBy=none&year=2026&studentId=${s1.id}`);
    expect(res.body.data[0].revenue).toBe(100);
  });

  it('a cancelled (non-active) refund is NOT netted out — matches getRefundedAmount\'s exact status filter', async () => {
    const cashbox = await seedCashbox();
    const s1 = await seedStudent();
    const p1 = await seedPayment({ student_id: s1.id, amount: 1000 });
    await seedRefund(cashbox.id, p1, 300, { status: 'cancelled' });

    const res = await request(port, `/api/payments/aggregate?groupBy=none&studentId=${s1.id}`);
    expect(res.body.data[0].revenue).toBe(1000); // cancelled refund ignored entirely
  });

  it('empty data: groupBy=group with zero payments returns an empty array, not an error', async () => {
    const res = await request(port, `/api/payments/aggregate?groupBy=group&groupId=nonexistent-group`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('single record: groupBy=student with exactly one payment returns exactly one bucket', async () => {
    const s1 = await seedStudent();
    await seedPayment({ student_id: s1.id, amount: 42 });
    const res = await request(port, `/api/payments/aggregate?groupBy=student&studentId=${s1.id}`);
    expect(res.body.data).toEqual([{ key: s1.id, count: 1, revenue: 42 }]);
  });

  it('invalid groupBy is rejected with a clear 400, not a raw 500', async () => {
    const res = await request(port, '/api/payments/aggregate?groupBy=not-a-real-dimension');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('groupBy');
  });

  it('date= param on the base GET matches FinancialAnalytics.jsx\'s todayRev filter (exact date equality)', async () => {
    const s1 = await seedStudent();
    await seedPayment({ student_id: s1.id, date: new Date('2026-06-15') });
    await seedPayment({ student_id: s1.id, date: new Date('2026-06-16') });

    const res = await request(port, '/api/payments?date=2026-06-15');
    expect(res.body.data).toHaveLength(1);
  });

  it('limit + orderBy=date_desc matches FinancialAnalytics.jsx\'s "recent 8" (most recent first, capped)', async () => {
    const s1 = await seedStudent();
    for (const d of ['2026-07-01', '2026-07-02', '2026-07-03']) {
      await seedPayment({ student_id: s1.id, date: new Date(d), month: 7 });
    }

    const res = await request(port, '/api/payments?studentId=' + s1.id + '&orderBy=date_desc&limit=2');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].date.slice(0, 10)).toBe('2026-07-03');
    expect(res.body.data[1].date.slice(0, 10)).toBe('2026-07-02');
  });

  it('invalid limit/date values are rejected with a clear 400', async () => {
    const badLimit = await request(port, '/api/payments?limit=not-a-number');
    expect(badLimit.status).toBe(400);
    const badDate = await request(port, '/api/payments?date=not-a-date');
    expect(badDate.status).toBe(400);
  });
});
