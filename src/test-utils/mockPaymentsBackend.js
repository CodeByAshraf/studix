// src/test-utils/mockPaymentsBackend.js
// Scalability Architecture Phase 4 Cutover 1 — a faithful in-memory test double of
// backend/src/routes/payments.js's GET / and GET /aggregate, driven by the same
// payments/treasuryTxn fixture arrays a test would otherwise seed into the Zustand store
// directly. Used by every payments-consumer test migrated off the full payments store
// array so that one fixture array remains the single source of truth for both "what the
// UI shows" and "what the mocked network layer returns" — mirrors getPaymentAggregates'
// exact formula (sum(amount) - sum(active refunds), count-only for method/status) rather
// than re-deriving it ad hoc per test file.
//
// Usage: mockPaymentsBackend(payments, treasuryTxn) sets globalThis.fetch for the
// duration of the test; call it again (or vi.restoreAllMocks() in afterEach) to reset.
import { vi } from 'vitest';

function netRevenue(rows, treasuryTxn) {
  return rows.reduce((sum, p) => {
    const refunded = treasuryTxn
      .filter((t) => t.paymentId === p.id && t.refType === 'refund' && t.status === 'active')
      .reduce((s, t) => s + Number(t.amount), 0);
    return sum + (Number(p.amount) - refunded);
  }, 0);
}

const AGGREGATE_COLUMNS = { method: 'method', status: 'status', group: 'groupId', student: 'studentId', month: 'month', day: 'date' };
const COUNT_ONLY = new Set(['method', 'status']);

export function mockPaymentsBackend(payments, treasuryTxn = []) {
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    const qp = new URL(u).searchParams;

    if (u.includes('/api/payments/aggregate')) {
      const groupBy = qp.get('groupBy');
      let rows = payments;
      if (qp.get('year') !== null) rows = rows.filter((p) => p.year === Number(qp.get('year')));
      if (qp.get('month') !== null) rows = rows.filter((p) => p.month === Number(qp.get('month')));
      if (qp.get('groupId')) rows = rows.filter((p) => p.groupId === qp.get('groupId'));
      if (qp.get('studentId')) rows = rows.filter((p) => p.studentId === qp.get('studentId'));

      if (groupBy === 'none') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [{ key: null, count: rows.length, revenue: netRevenue(rows, treasuryTxn) }] }) });
      }
      const column = AGGREGATE_COLUMNS[groupBy];
      const buckets = new Map();
      for (const r of rows) {
        const key = column === 'date' ? r.date : r[column];
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(r);
      }
      const data = [...buckets.entries()].map(([key, groupRows]) => (
        COUNT_ONLY.has(groupBy)
          ? { key, count: groupRows.length }
          : { key, count: groupRows.length, revenue: netRevenue(groupRows, treasuryTxn) }
      ));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
    }

    if (u.includes('/api/payments?') || u.endsWith('/api/payments')) {
      let rows = payments;
      if (qp.get('studentId')) rows = rows.filter((p) => p.studentId === qp.get('studentId'));
      if (qp.get('groupId')) rows = rows.filter((p) => p.groupId === qp.get('groupId'));
      if (qp.get('month') !== null) rows = rows.filter((p) => p.month === Number(qp.get('month')));
      if (qp.get('year') !== null) rows = rows.filter((p) => p.year === Number(qp.get('year')));
      if (qp.get('date')) rows = rows.filter((p) => p.date === qp.get('date'));
      if (qp.get('orderBy') === 'date_desc') rows = [...rows].sort((a, b) => b.date.localeCompare(a.date));
      if (qp.get('limit') !== null) rows = rows.slice(0, Number(qp.get('limit')));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: rows, count: rows.length }) });
    }

    return Promise.reject(new Error(`mockPaymentsBackend: unexpected fetch ${u}`));
  });
}
