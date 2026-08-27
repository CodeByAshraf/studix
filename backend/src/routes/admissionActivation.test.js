// backend/src/routes/admissionActivation.test.js
// Product Completion Phase 1 — Issue 3. Mocks the Prisma client entirely (no live DB
// touched) — same technique the frontend test suite already uses for network mocking,
// applied here to Prisma's tx client instead of fetch. Verifies the one additive change
// (optional student.parentId -> students.parent_id, BigInt-converted) without disturbing
// activateAdmission's existing idempotency/error-path guarantees.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTx = {
  admissions: { findUnique: vi.fn(), updateMany: vi.fn() },
  students: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  admission_system_log: { create: vi.fn() },
};

vi.mock('../prisma.js', () => ({
  prisma: { $transaction: (work) => work(mockTx) },
}));

const { activateAdmission } = await import('./admissionActivation.js');

function baseStudentInput(extra = {}) {
  return { name: 'أحمد علي', groupId: 'g1', phone: '201000000000', ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTx.students.findMany.mockResolvedValue([]);
});

describe('activateAdmission — parentId (Issue 3)', () => {
  it('sets students.parent_id when a valid parentId is provided', async () => {
    mockTx.admissions.findUnique
      .mockResolvedValueOnce({ id: 'a1', stage: 'reserved', student_id: null })
      .mockResolvedValueOnce({ id: 'a1', stage: 'active', student_id: 's-new1' });
    mockTx.students.create.mockImplementation(({ data }) => Promise.resolve({ ...data }));
    mockTx.admissions.updateMany.mockResolvedValue({ count: 1 });
    mockTx.admission_system_log.create.mockImplementation(({ data }) => Promise.resolve(data));

    await activateAdmission({ admissionId: 'a1', student: baseStudentInput({ parentId: '42' }) }, { userId: 'u1' });

    expect(mockTx.students.create).toHaveBeenCalledTimes(1);
    const createData = mockTx.students.create.mock.calls[0][0].data;
    expect(createData.parent_id).toBe(42n);
  });

  it('leaves students.parent_id null when parentId is omitted', async () => {
    mockTx.admissions.findUnique
      .mockResolvedValueOnce({ id: 'a2', stage: 'reserved', student_id: null })
      .mockResolvedValueOnce({ id: 'a2', stage: 'active', student_id: 's-new2' });
    mockTx.students.create.mockImplementation(({ data }) => Promise.resolve({ ...data }));
    mockTx.admissions.updateMany.mockResolvedValue({ count: 1 });
    mockTx.admission_system_log.create.mockImplementation(({ data }) => Promise.resolve(data));

    await activateAdmission({ admissionId: 'a2', student: baseStudentInput() }, { userId: 'u1' });

    const createData = mockTx.students.create.mock.calls[0][0].data;
    expect(createData.parent_id).toBeNull();
  });

  it('rejects a non-numeric parentId before touching the transaction body', async () => {
    mockTx.admissions.findUnique.mockResolvedValue({ id: 'a3', stage: 'reserved', student_id: null });

    await expect(
      activateAdmission({ admissionId: 'a3', student: baseStudentInput({ parentId: 'not-a-number' }) }, { userId: 'u1' })
    ).rejects.toThrow('معرّف ولي الأمر غير صحيح.');
    expect(mockTx.students.create).not.toHaveBeenCalled();
  });

  it('response serializes the BigInt parent_id to a string (would otherwise crash JSON.stringify)', async () => {
    mockTx.admissions.findUnique
      .mockResolvedValueOnce({ id: 'a4', stage: 'reserved', student_id: null })
      .mockResolvedValueOnce({ id: 'a4', stage: 'active', student_id: 's-new4' });
    mockTx.students.create.mockImplementation(({ data }) => Promise.resolve({ ...data }));
    mockTx.admissions.updateMany.mockResolvedValue({ count: 1 });
    mockTx.admission_system_log.create.mockImplementation(({ data }) => Promise.resolve(data));

    const result = await activateAdmission({ admissionId: 'a4', student: baseStudentInput({ parentId: '7' }) }, { userId: 'u1' });

    expect(typeof result.student.parentId).toBe('string');
    expect(result.student.parentId).toBe('7');
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});

describe('activateAdmission — existing guarantees unaffected by the parentId addition', () => {
  it('stays idempotent: re-activating an already-active admission returns the existing student without creating a second one', async () => {
    mockTx.admissions.findUnique.mockResolvedValue({ id: 'a5', stage: 'active', student_id: 's-existing' });
    mockTx.students.findUnique.mockResolvedValue({ id: 's-existing', code: 'TC-2026-0001', name: 'موجود بالفعل', parent_id: null });

    const result = await activateAdmission({ admissionId: 'a5', student: baseStudentInput({ parentId: '99' }) }, { userId: 'u1' });

    expect(mockTx.students.create).not.toHaveBeenCalled();
    expect(mockTx.admissions.updateMany).not.toHaveBeenCalled();
    expect(result.student.id).toBe('s-existing');
    expect(result.systemLogEntries).toEqual([]);
  });

  it('rejects an inconsistent state (student_id set, stage not active) exactly as before', async () => {
    mockTx.admissions.findUnique.mockResolvedValue({ id: 'a6', stage: 'reserved', student_id: 's-orphan' });

    await expect(
      activateAdmission({ admissionId: 'a6', student: baseStudentInput() }, { userId: 'u1' })
    ).rejects.toThrow('سجل القبول مرتبط بطالب لكن في حالة غير متوقّعة — يتطلّب مراجعة يدوية.');
    expect(mockTx.students.create).not.toHaveBeenCalled();
  });
});

// BUG-05 — the final admission write now guards the state transition inside the UPDATE's
// WHERE clause itself (updateMany + count check), the same proven pattern already used by
// reverseTreasuryTxn (treasuryTxn.js) and cancelAdmissionWithRefund (admissionCancellation.js).
// A real concurrent-race proof (against a live scratch database, two genuinely simultaneous
// requests) lives in admissionActivation.integration.test.js — this is the mock-level unit
// test for the guard's losing branch in isolation.
describe('activateAdmission — BUG-05: atomic guard on the final admissions write', () => {
  it('when the guarded updateMany matches zero rows (lost the race), rejects and never creates activity-log entries', async () => {
    mockTx.admissions.findUnique.mockResolvedValueOnce({ id: 'a7', stage: 'reserved', student_id: null });
    mockTx.students.create.mockImplementation(({ data }) => Promise.resolve({ ...data }));
    // يحاكي سباق مفقود: طلب آخر متزامن ثبَّت student_id بالفعل بين القراءة الأولى هنا
    // وبين تنفيذ updateMany — فتُطابِق الـ WHERE صفراً من الصفوف.
    mockTx.admissions.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      activateAdmission({ admissionId: 'a7', student: baseStudentInput() }, { userId: 'u1' })
    ).rejects.toThrow('سجل القبول تم تفعيله للتو من طلب آخر متزامن — تحقّق من حالته الحالية.');

    expect(mockTx.students.create).toHaveBeenCalledTimes(1);
    expect(mockTx.admission_system_log.create).not.toHaveBeenCalled();
  });

  it('the guarded updateMany call itself carries student_id:null in its WHERE clause', async () => {
    mockTx.admissions.findUnique
      .mockResolvedValueOnce({ id: 'a8', stage: 'reserved', student_id: null })
      .mockResolvedValueOnce({ id: 'a8', stage: 'active', student_id: 's-new8' });
    mockTx.students.create.mockImplementation(({ data }) => Promise.resolve({ ...data }));
    mockTx.admissions.updateMany.mockResolvedValue({ count: 1 });
    mockTx.admission_system_log.create.mockImplementation(({ data }) => Promise.resolve(data));

    await activateAdmission({ admissionId: 'a8', student: baseStudentInput() }, { userId: 'u1' });

    expect(mockTx.admissions.updateMany).toHaveBeenCalledTimes(1);
    const call = mockTx.admissions.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'a8', student_id: null });
    const createdStudent = await mockTx.students.create.mock.results[0].value;
    expect(call.data.student_id).toBe(createdStudent.id);
    expect(call.data.stage).toBe('active');
  });
});
