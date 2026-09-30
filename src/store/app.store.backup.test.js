// src/store/app.store.backup.test.js
// Scalability Architecture Phase 4 — payments PG_COLLECTIONS cutover prep. Once `payments`
// leaves PG_COLLECTIONS, state.payments is no longer boot-synced with the full dataset, so
// exportBackup()/saveAutoBackup() (previously reading it straight from the store) needed to
// change:
//   - exportBackup (manual, rare — one button in Settings) now fetches the complete current
//     payments array fresh from GET /api/payments (via pgGetPayments({})) at export time,
//     preserving the exact same exported JSON content/shape as before.
//   - saveAutoBackup (automatic browser snapshot) was later removed entirely in P2 Fix A —
//     see the last describe block below.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore } from './app.store';
import { storage } from '../hooks/useErrorHandler';

vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return { ...actual, pgGetPayments: vi.fn(), pgGetGrades: vi.fn(), pgGetHomeworks: vi.fn(), pgGetHwSubmissions: vi.fn() };
});
import { pgGetPayments, pgGetGrades, pgGetHomeworks, pgGetHwSubmissions } from '../services/api';

const STUDENTS  = [{ id: 's1', name: 'أحمد' }];
const GROUPS    = [{ id: 'g1', name: 'مجموعة أ' }];
const ATTENDANCE = [{ id: 'a1', studentId: 's1', date: '2026-01-01', status: 'present' }];
const EXAMS     = [{ id: 'e1', name: 'اختبار' }];
const GRADES    = [{ id: 'gr1', studentId: 's1', examId: 'e1', score: 90 }];
const HOMEWORKS = [{ id: 'hw1', title: 'واجب' }];
const HW_SUBS   = [{ id: 'sub1', hwId: 'hw1', studentId: 's1', status: 'submitted' }];
// عمداً مختلفة عن أي شيء قد يكون بقي في الـ store محلياً — تثبت أن exportBackup يستخدم
// نتيجة الـ API الطازجة، لا مصفوفة payments القديمة في الـ store.
const FRESH_API_PAYMENTS = [
  { id: 'p1', studentId: 's1', amount: 500, month: 1, year: 2026, date: '2026-01-05', status: 'paid' },
  { id: 'p2', studentId: 's1', amount: 300, month: 2, year: 2026, date: '2026-02-05', status: 'partial' },
];
const STALE_STORE_PAYMENTS = [{ id: 'stale-p', studentId: 's1', amount: 999999, status: 'paid' }];
// Grades + Homework global-read migration, Phase 3: grades/homeworks/hwSubmissions left
// PG_COLLECTIONS, so exportBackup fetches them fresh too — deliberately different from the
// store copies (GRADES/HOMEWORKS/HW_SUBS) to prove the export uses the API result.
const FRESH_API_GRADES    = [{ id: 'gr-api', studentId: 's1', examId: 'e1', score: 75 }];
const FRESH_API_HOMEWORKS = [{ id: 'hw-api', title: 'واجب من الخادم' }];
const FRESH_API_HW_SUBS   = [{ id: 'sub-api', hwId: 'hw-api', studentId: 's1', status: 'late' }];

function seedStore() {
  const addLog = vi.fn().mockResolvedValue({ id: 'log1' });
  useAppStore.setState({
    students: STUDENTS, groups: GROUPS, payments: STALE_STORE_PAYMENTS, attendance: ATTENDANCE,
    exams: EXAMS, grades: GRADES, homeworks: HOMEWORKS, hwSubmissions: HW_SUBS, addLog,
  });
  return addLog;
}

let blobParts;
let clickSpy;
const RealBlob = globalThis.Blob;
beforeEach(() => {
  vi.clearAllMocks();
  pgGetGrades.mockResolvedValue(FRESH_API_GRADES);
  pgGetHomeworks.mockResolvedValue(FRESH_API_HOMEWORKS);
  pgGetHwSubmissions.mockResolvedValue(FRESH_API_HW_SUBS);
  blobParts = [];
  // Blob نفسه مموَّه لالتقاط النص الخام المُمرَّر إليه مباشرة — أبسط وأوثق من محاولة
  // قراءته لاحقاً عبر .text()/Response() (غير مدعومتين بشكل موثوق في بيئة jsdom هنا).
  vi.stubGlobal('Blob', vi.fn().mockImplementation((parts, opts) => {
    blobParts.push(parts[0]);
    return new RealBlob(parts, opts);
  }));
  // jsdom لا يُطبِّق createObjectURL/revokeObjectURL إطلاقاً (غير موجودتين على الكائن) —
  // vi.spyOn يتطلّب خاصية موجودة سلفاً، فتُعرَّفان مباشرة بدلاً من ذلك.
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
  try { localStorage.removeItem('studix_autobackup'); } catch {}
});

function lastExportedJson() {
  expect(blobParts).toHaveLength(1);
  return JSON.parse(blobParts[0]);
}

describe('exportBackup — fetches payments fresh, not from the store', () => {
  it('calls pgGetPayments({}) (unfiltered GET /api/payments) rather than reading state.payments', async () => {
    seedStore();
    pgGetPayments.mockResolvedValue(FRESH_API_PAYMENTS);

    await useAppStore.getState().exportBackup('u1');

    expect(pgGetPayments).toHaveBeenCalledTimes(1);
    expect(pgGetPayments).toHaveBeenCalledWith({});
  });

  it('the exported JSON contains the complete fresh API payments array, not the stale store array', async () => {
    seedStore();
    pgGetPayments.mockResolvedValue(FRESH_API_PAYMENTS);

    await useAppStore.getState().exportBackup('u1');

    const exported = await lastExportedJson();
    expect(exported.payments).toEqual(FRESH_API_PAYMENTS);
    expect(exported.payments).not.toEqual(STALE_STORE_PAYMENTS);
  });

  it('preserves the exact existing export shape and every other collection', async () => {
    seedStore();
    pgGetPayments.mockResolvedValue(FRESH_API_PAYMENTS);

    await useAppStore.getState().exportBackup('u1');
    const exported = await lastExportedJson();

    expect(Object.keys(exported).sort()).toEqual(
      ['attendance', 'exams', 'exportedAt', 'grades', 'groups', 'homeworks', 'hwSubmissions', 'payments', 'students'].sort()
    );
    expect(exported.students).toEqual(STUDENTS);
    expect(exported.groups).toEqual(GROUPS);
    expect(exported.attendance).toEqual(ATTENDANCE);
    expect(exported.exams).toEqual(EXAMS);
    expect(exported.grades).toEqual(FRESH_API_GRADES);
    expect(exported.homeworks).toEqual(FRESH_API_HOMEWORKS);
    expect(exported.hwSubmissions).toEqual(FRESH_API_HW_SUBS);
    expect(typeof exported.exportedAt).toBe('string');
  });

  // Grades + Homework global-read migration, Phase 3 (final cutover).
  it('fetches grades/homeworks/hwSubmissions fresh via the unfiltered scoped GETs, never from the store', async () => {
    seedStore();
    pgGetPayments.mockResolvedValue(FRESH_API_PAYMENTS);

    await useAppStore.getState().exportBackup('u1');
    const exported = lastExportedJson();

    expect(pgGetGrades).toHaveBeenCalledTimes(1);
    expect(pgGetGrades).toHaveBeenCalledWith({});
    expect(pgGetHomeworks).toHaveBeenCalledTimes(1);
    expect(pgGetHomeworks).toHaveBeenCalledWith();
    expect(pgGetHwSubmissions).toHaveBeenCalledTimes(1);
    expect(pgGetHwSubmissions).toHaveBeenCalledWith({});
    expect(exported.grades).not.toEqual(GRADES);
    expect(exported.homeworks).not.toEqual(HOMEWORKS);
    expect(exported.hwSubmissions).not.toEqual(HW_SUBS);
  });

  it('a fresh browser (empty store snapshot) still exports the complete server data, not empty arrays', async () => {
    seedStore();
    useAppStore.setState({ grades: [], homeworks: [], hwSubmissions: [] });
    pgGetPayments.mockResolvedValue(FRESH_API_PAYMENTS);

    await useAppStore.getState().exportBackup('u1');
    const exported = lastExportedJson();

    expect(exported.grades).toEqual(FRESH_API_GRADES);
    expect(exported.homeworks).toEqual(FRESH_API_HOMEWORKS);
    expect(exported.hwSubmissions).toEqual(FRESH_API_HW_SUBS);
  });

  it('a failing grades/homework fetch fails the whole export (no partial backup, no success log)', async () => {
    const addLog = seedStore();
    pgGetPayments.mockResolvedValue(FRESH_API_PAYMENTS);
    pgGetHwSubmissions.mockRejectedValue(new Error('PG GET /hwSubmissions → 403'));

    await expect(useAppStore.getState().exportBackup('u1')).rejects.toThrow('PG GET /hwSubmissions → 403');

    expect(clickSpy).not.toHaveBeenCalled();
    expect(blobParts).toHaveLength(0);
    expect(addLog).not.toHaveBeenCalled();
  });

  it('still logs the export activity on success', async () => {
    const addLog = seedStore();
    pgGetPayments.mockResolvedValue(FRESH_API_PAYMENTS);

    await useAppStore.getState().exportBackup('u1');

    expect(addLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'export', module: 'settings' })
    );
  });

  it('export failure (payments fetch rejects) propagates as a rejected promise, downloads nothing, and never logs a (misleading) success', async () => {
    const addLog = seedStore();
    pgGetPayments.mockRejectedValue(new Error('PG GET /payments → 500'));

    await expect(useAppStore.getState().exportBackup('u1')).rejects.toThrow('PG GET /payments → 500');

    expect(clickSpy).not.toHaveBeenCalled();
    expect(blobParts).toHaveLength(0);
    expect(addLog).not.toHaveBeenCalled();
  });
});

// P2 Fix A — saveAutoBackup (the obsolete localStorage['studix_autobackup'] writer) was
// removed: nothing read it and it duplicated server-owned data into the browser quota.
describe('saveAutoBackup — removed (P2 Fix A)', () => {
  it('the store no longer exposes saveAutoBackup', () => {
    expect(useAppStore.getState().saveAutoBackup).toBeUndefined();
  });

  it('exportBackup never writes the obsolete studix_autobackup key', async () => {
    seedStore();
    pgGetPayments.mockResolvedValue(FRESH_API_PAYMENTS);

    await useAppStore.getState().exportBackup('u1');

    expect(storage.get('studix_autobackup')).toBeNull();
  });
});
