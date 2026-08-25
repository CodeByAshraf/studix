// src/modules/materials/MaterialDistribution.inventoryTxn.test.jsx
// Phase 3B-12 — MaterialDistribution.handleSave sends the complete roster as ONE
// dedicated-endpoint call (pgSaveMaterialDistribution), never per-student CRUD. The
// actual type-mapping/idempotency/legacy_metadata reconciliation logic lives entirely
// server-side in backend/src/routes/materialDistribution.js (verified separately
// against the real, live endpoint with explicit cleanup — see the implementation
// report; this project has no backend test runner to house an automated test for it).
// Here we verify the component's contract with that endpoint: server-truth-first,
// single bulk call, no financial fields ever sent from the client, and unchanged.
//
// matDist read-path migration — matDist is no longer independent local state; it is
// derived (deriveMatDist, materialService.js) from state.inventoryTxn. The save
// endpoint's response shape is unchanged (Decision 2: no backend enrichment) — after
// a successful save, the component re-fetches inventoryTxn fresh (pgGetCollection) and
// merges it (mergeById, same function db.middleware.js's boot-sync already uses) into
// state.inventoryTxn. These tests now assert on state.inventoryTxn directly.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import MaterialDistribution from './MaterialDistribution';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgSaveMaterialDistribution: vi.fn(), pgGetCollection: vi.fn() };
});
import { pgSaveMaterialDistribution, pgGetCollection } from '../../services/api';

const MATERIAL = { id: '7', name: 'مذكرة الرياضيات', subject: 'رياضيات', teacher: '', grade: 'الصف الأول الثانوي', price: 100 };

function renderPage(onClose = vi.fn()) {
  return render(
    <ToastProvider>
      <MaterialDistribution material={MATERIAL} onClose={onClose} />
    </ToastProvider>
  );
}

function seedStore(extra = {}) {
  useAppStore.setState({
    students: [
      { id: 's1', name: 'طالب واحد', code: 'C1', status: 'active', grade: MATERIAL.grade, groupId: 'g1' },
      { id: 's2', name: 'طالب اثنان', code: 'C2', status: 'active', grade: MATERIAL.grade, groupId: 'g1' },
    ],
    groups: [{ id: 'g1', name: 'مجموعة أ' }],
    inventoryTxn: [],
    ...extra,
  });
}

// صف inventory_txn حقيقي (camelCase، كما يصل من pgGetCollection) لطالب استلم ودفع.
function receivedTxn({ id = 'srv-1', studentId = 's1', paidAmount = 100, receivedAt = '2026-08-19' } = {}) {
  return {
    id, number: 'INV-000001', materialId: '7', type: 'studentDelivery', quantity: 1,
    studentId, status: 'active', createdAt: '2026-08-19T00:00:00.000Z',
    legacyMetadata: { payStatus: 'paid', paidAmount, receivedAt },
  };
}

describe('MaterialDistribution — inventory_txn write path (dedicated bulk endpoint) + matDist read-path (derived)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pgGetCollection.mockResolvedValue([]);
    seedStore();
  });

  it('save: sends the complete roster as exactly ONE pgSaveMaterialDistribution call (never per-student), does not touch local state before the backend resolves, then refreshes inventoryTxn from a fresh GET (no reliance on the save response\'s matDist-shaped records for local state)', async () => {
    let resolveSave;
    pgSaveMaterialDistribution.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));

    renderPage();
    fireEvent.click(screen.getByText('💾 حفظ التوزيع'));

    expect(pgSaveMaterialDistribution).toHaveBeenCalledTimes(1);
    const [sentMaterialId, sentRecords] = pgSaveMaterialDistribution.mock.calls[0];
    expect(sentMaterialId).toBe('7');
    expect(sentRecords).toHaveLength(2); // كل الروستر دفعة واحدة، لا نداء لكل طالب
    expect(sentRecords).toEqual(expect.arrayContaining([
      { studentId: 's1', received: false, payStatus: 'unpaid', paidAmount: 0, receivedAt: null },
      { studentId: 's2', received: false, payStatus: 'unpaid', paidAmount: 0, receivedAt: null },
    ]));

    // لا حقول مالية مخترَعة تُرسَل من الفرونت-إند إطلاقاً — لا paymentId ولا admissionId
    for (const r of sentRecords) {
      expect(r.paymentId).toBeUndefined();
      expect(r.admissionId).toBeUndefined();
    }

    // لا تعديل محلي قبل نجاح الخادم، ولا استدعاء لإعادة الجلب بعد
    expect(useAppStore.getState().inventoryTxn).toEqual([]);
    expect(pgGetCollection).not.toHaveBeenCalled();

    // فقط s1 لمس فعلياً (استلم+دفع) — s2 بقي بالحالة الافتراضية غير المُلمَسة، فلا صف
    // inventory_txn حقيقي له إطلاقاً (نفس isUntouchedDefault في materialDistribution.js).
    pgGetCollection.mockResolvedValueOnce([receivedTxn()]);
    resolveSave({ materialId: '7', records: [] }); // شكل استجابة نقطة النهاية لم يتغيّر، لكن لم نعد نعتمد عليه محلياً

    await waitFor(() => {
      expect(pgGetCollection).toHaveBeenCalledWith('inventoryTxn');
      expect(useAppStore.getState().inventoryTxn).toEqual([receivedTxn()]);
    });
  });

  it('save failure: leaves local inventoryTxn untouched, never calls pgGetCollection, and surfaces the real server error', async () => {
    pgSaveMaterialDistribution.mockRejectedValueOnce(new Error('المادة غير موجودة.'));
    const existing = [receivedTxn()];
    seedStore({ inventoryTxn: existing });

    renderPage();
    fireEvent.click(screen.getByText('💾 حفظ التوزيع'));

    expect(await screen.findByText('المادة غير موجودة.')).toBeInTheDocument();
    expect(pgGetCollection).not.toHaveBeenCalled();
    expect(useAppStore.getState().inventoryTxn).toEqual(existing);
  });

  it('save: an already-received student with existing paid state (derived from a real inventoryTxn row) is sent as part of the same single roster call, not touched optimistically; after refresh only students with real ledger history appear', async () => {
    seedStore({ inventoryTxn: [receivedTxn()] });
    pgSaveMaterialDistribution.mockResolvedValueOnce({ materialId: '7', records: [] });
    pgGetCollection.mockResolvedValueOnce([receivedTxn()]); // s2 يبقى غير مُلمَس — لا صف حقيقي جديد له

    renderPage();
    fireEvent.click(screen.getByText('💾 حفظ التوزيع'));

    await waitFor(() => expect(pgSaveMaterialDistribution).toHaveBeenCalledTimes(1));
    const sentRecords = pgSaveMaterialDistribution.mock.calls[0][1];
    expect(sentRecords.find((r) => r.studentId === 's1')).toEqual({ studentId: 's1', received: true, payStatus: 'paid', paidAmount: 100, receivedAt: '2026-08-19' });

    await waitFor(() => {
      // s2 غير مُلمَس فعلياً في الـ ledger الحقيقي → لا سجل matDist مشتقّ له إطلاقاً
      // (بعكس النموذج المحلي القديم، الذي كان يُدرج افتراضياً لكل طالب في الاستجابة).
      expect(useAppStore.getState().inventoryTxn).toHaveLength(1);
      expect(useAppStore.getState().inventoryTxn[0].studentId).toBe('s1');
    });
  });

  it('"مسجّل الكل استلم" then save: the toggled student is sent with received:true in the same single bulk call', async () => {
    pgSaveMaterialDistribution.mockResolvedValueOnce({ materialId: '7', records: [] });
    pgGetCollection.mockResolvedValueOnce([]);

    renderPage();
    fireEvent.click(screen.getByText('✓ تسجيل الكل استلم'));
    fireEvent.click(screen.getByText('💾 حفظ التوزيع'));

    await waitFor(() => expect(pgSaveMaterialDistribution).toHaveBeenCalledTimes(1));
    const sentRecords = pgSaveMaterialDistribution.mock.calls[0][1];
    expect(sentRecords.every((r) => r.received === true)).toBe(true);
  });
});
