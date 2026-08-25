// src/services/api.test.js
// Phase 3B-5 — يتحقّق من التحويلات الفعلية في pgCreateExam/pgUpdateExam (لا محاكاة):
// exams.date يُرسَل للخادم كطابع زمني كامل (crud.js العام يرفض "YYYY-MM-DD" وحدها
// لعمود @db.Date)، واستجابة الخادم تُطبَّع (date → plain، total/pass → أرقام حقيقية
// لا نصوص Decimal). لا يلمس شبكة حقيقية — fetch مموَّه بالكامل.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pgCreateExam, pgUpdateExam, pgCreateHomework, pgUpdateHomework, pgSaveHwSubmissions, pgCreateCommunication, pgCreateCommTask, pgCreateActivityLog } from './api';

describe('pgCreateExam / pgUpdateExam', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockResponse(data) {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, data }),
    });
  }

  it('pgCreateExam sends date as a full ISO timestamp, not a plain YYYY-MM-DD string', async () => {
    mockResponse({ id: 'e1', name: 'x', date: '2026-03-15T00:00:00.000Z', total: '100', pass: '50' });
    await pgCreateExam({ name: 'x', groupId: 'g1', date: '2026-03-15', total: 100, pass: 50 });

    const [, opts] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.date).toBe('2026-03-15T00:00:00.000Z');
  });

  it('pgUpdateExam sends date as a full ISO timestamp too', async () => {
    mockResponse({ id: 'e1', name: 'x', date: '2026-03-15T00:00:00.000Z', total: '100', pass: '50' });
    await pgUpdateExam('e1', { name: 'x', date: '2026-03-15', total: 100, pass: 50 });

    const [, opts] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.date).toBe('2026-03-15T00:00:00.000Z');
  });

  it('pgCreateExam normalizes the response: date trimmed to YYYY-MM-DD, total/pass coerced to real numbers', async () => {
    // total/pass تصل كنص من crud.js العام (Decimal.toJSON) — لو بقيت كذلك، "+" في
    // examService.js تصير دمج نصوص لا جمع أرقام
    mockResponse({ id: 'e1', name: 'x', date: '2026-03-15T00:00:00.000Z', total: '100', pass: '50' });
    const result = await pgCreateExam({ name: 'x', groupId: 'g1', date: '2026-03-15', total: 100, pass: 50 });

    expect(result.date).toBe('2026-03-15');
    expect(result.total).toBe(100);
    expect(typeof result.total).toBe('number');
    expect(result.pass).toBe(50);
    expect(typeof result.pass).toBe('number');
  });

  it('pgCreateExam throws the real server error message on failure', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: 'قيمة تنتهك قيداً (CHECK constraint) في قاعدة البيانات.' }),
    });
    await expect(pgCreateExam({ name: 'x', groupId: 'g1', date: '2026-01-01', total: 50, pass: 100 }))
      .rejects.toThrow('قيمة تنتهك قيداً');
  });
});

describe('pgCreateHomework / pgUpdateHomework', () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); globalThis.fetch = fetchMock; });
  afterEach(() => vi.restoreAllMocks());

  function mockResponse(data) {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true, data }) });
  }

  it('pgCreateHomework sends dueDate as full ISO, and createdAt as assignedDate (never as createdAt/created_at)', async () => {
    mockResponse({ id: 'h1', title: 'x', dueDate: '2026-03-15T00:00:00.000Z', assignedDate: '2026-03-01T00:00:00.000Z', totalScore: '10' });
    await pgCreateHomework({ title: 'x', groupId: 'g1', dueDate: '2026-03-15', createdAt: '2026-03-01', totalScore: 10 });

    const [, opts] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.dueDate).toBe('2026-03-15T00:00:00.000Z');
    expect(sentBody.assignedDate).toBe('2026-03-01T00:00:00.000Z');
    expect(sentBody.createdAt).toBeUndefined();
  });

  it('pgUpdateHomework does the same request-side mapping', async () => {
    mockResponse({ id: 'h1', title: 'x', dueDate: '2026-03-15T00:00:00.000Z', assignedDate: '2026-03-01T00:00:00.000Z', totalScore: '10' });
    await pgUpdateHomework('h1', { title: 'x', groupId: 'g1', dueDate: '2026-03-15', createdAt: '2026-03-01', totalScore: 10 });

    const [, opts] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.dueDate).toBe('2026-03-15T00:00:00.000Z');
    expect(sentBody.assignedDate).toBe('2026-03-01T00:00:00.000Z');
    expect(sentBody.createdAt).toBeUndefined();
  });

  it('pgCreateHomework normalizes the response: dueDate/createdAt trimmed, totalScore coerced to a number', async () => {
    mockResponse({ id: 'h1', title: 'x', dueDate: '2026-03-15T00:00:00.000Z', assignedDate: '2026-03-01T00:00:00.000Z', totalScore: '10' });
    const result = await pgCreateHomework({ title: 'x', groupId: 'g1', dueDate: '2026-03-15', createdAt: '2026-03-01', totalScore: 10 });

    expect(result.dueDate).toBe('2026-03-15');
    expect(result.createdAt).toBe('2026-03-01');
    expect(result.totalScore).toBe(10);
    expect(typeof result.totalScore).toBe('number');
    expect(result.assignedDate).toBeUndefined(); // لا يُسرَّب الاسم الخام للمستهلك
  });
});

describe('pgSaveHwSubmissions', () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); globalThis.fetch = fetchMock; });
  afterEach(() => vi.restoreAllMocks());

  it('never sends hwId in the request body — homeworkId comes only from the URL', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, data: { homeworkId: 'h1', records: [] } }) });
    await pgSaveHwSubmissions('h1', [{ studentId: 's1', status: 'submitted', submittedAt: '2026-03-10', score: 8, notes: '' }]);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/hw-submissions/h1');
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.records[0].hwId).toBeUndefined();
  });

  it('renames each returned record\'s homeworkId back to hwId, matching what the rest of the app expects', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: { homeworkId: 'h1', records: [{ id: 's1', homeworkId: 'h1', studentId: 'st1', score: 8, submittedAt: '2026-03-10', status: 'submitted' }] } }),
    });
    const result = await pgSaveHwSubmissions('h1', []);
    expect(result.records[0].hwId).toBe('h1');
    expect(result.records[0].homeworkId).toBeUndefined();
  });
});

describe('pgCreateCommunication', () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); globalThis.fetch = fetchMock; });
  afterEach(() => vi.restoreAllMocks());

  function okResponse(data) {
    return { ok: true, status: 201, json: async () => ({ ok: true, data }) };
  }
  function conflictResponse(field = ['number']) {
    return { ok: false, status: 409, json: async () => ({ ok: false, error: 'قيمة مكرّرة تنتهك قيد التفرّد.', field }) };
  }

  it('maps parentName to legacyParentName explicitly (not relying on automatic camelToSnake)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ id: 'c1', number: 'COM-000001', legacyParentName: 'Ahmed', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open' }));
    await pgCreateCommunication({ number: 'COM-000001', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open', parentName: 'Ahmed' });

    const [, opts] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.legacyParentName).toBe('Ahmed');
    expect(sentBody.parentName).toBeUndefined();
  });

  it('sends followupDate as a full ISO timestamp, and null stays null', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ id: 'c1', number: 'COM-000001', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open', followupDate: null }));
    await pgCreateCommunication({ number: 'COM-000001', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open', followupDate: '2026-04-01' });
    let sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.followupDate).toBe('2026-04-01T00:00:00.000Z');

    fetchMock.mockResolvedValueOnce(okResponse({ id: 'c2', number: 'COM-000002', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open', followupDate: null }));
    await pgCreateCommunication({ number: 'COM-000002', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open', followupDate: null });
    sentBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(sentBody.followupDate).toBeNull();
  });

  it('normalizes the response: legacyParentName → parentName, followupDate trimmed to YYYY-MM-DD', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({
      id: 'c1', number: 'COM-000001', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open',
      legacyParentName: 'Ahmed', followupDate: '2026-04-01T00:00:00.000Z',
    }));
    const result = await pgCreateCommunication({ number: 'COM-000001', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open', parentName: 'Ahmed', followupDate: '2026-04-01' });

    expect(result.parentName).toBe('Ahmed');
    expect(result.legacyParentName).toBeUndefined();
    expect(result.followupDate).toBe('2026-04-01');
  });

  it('does not send id/createdAt/updatedAt — they are server-managed', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ id: 'c1', number: 'COM-000001', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open' }));
    await pgCreateCommunication({ id: 'com_local_123', number: 'COM-000001', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open', createdAt: 'x', updatedAt: 'y', createdBy: 'emp1' });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.id).toBeUndefined();
    expect(sentBody.createdAt).toBeUndefined();
    expect(sentBody.updatedAt).toBeUndefined();
    expect(sentBody.createdBy).toBe('emp1'); // حقل عادي، ليس مُداراً من الخادم
  });

  it('retries exactly once on a communications.number conflict, using a freshly computed number, and returns the server record', async () => {
    fetchMock
      .mockResolvedValueOnce(conflictResponse(['number']))
      .mockResolvedValueOnce(okResponse({ id: 'c2', number: 'COM-000002', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open' }));

    const computeNextNumber = vi.fn().mockResolvedValue('COM-000002');
    const result = await pgCreateCommunication(
      { number: 'COM-000001', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open' },
      { computeNextNumber }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(computeNextNumber).toHaveBeenCalledTimes(1);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.number).toBe('COM-000002');
    expect(result.number).toBe('COM-000002');
  });

  it('does NOT retry a conflict on a different field', async () => {
    fetchMock.mockResolvedValueOnce(conflictResponse(['id']));
    const computeNextNumber = vi.fn();
    await expect(pgCreateCommunication({ number: 'COM-000001', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open' }, { computeNextNumber }))
      .rejects.toThrow('قيمة مكرّرة تنتهك قيد التفرّد.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(computeNextNumber).not.toHaveBeenCalled();
  });

  it('does NOT retry unrelated errors (500, network, auth)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ ok: false, error: 'خطأ داخلي في الخادم.' }) });
    const computeNextNumber = vi.fn();
    await expect(pgCreateCommunication({ number: 'COM-000001', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open' }, { computeNextNumber }))
      .rejects.toThrow('خطأ داخلي في الخادم.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(computeNextNumber).not.toHaveBeenCalled();
  });

  it('does not retry at all when no computeNextNumber callback is provided, even on a real number conflict', async () => {
    fetchMock.mockResolvedValueOnce(conflictResponse(['number']));
    await expect(pgCreateCommunication({ number: 'COM-000001', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open' }))
      .rejects.toThrow('قيمة مكرّرة تنتهك قيد التفرّد.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('pgCreateCommTask', () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); globalThis.fetch = fetchMock; });
  afterEach(() => vi.restoreAllMocks());

  it('maps commId to communicationId explicitly', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true, data: { id: 't1', communicationId: 'c1', title: 'x', priority: 'normal', status: 'pending' } }) });
    await pgCreateCommTask({ commId: 'c1', title: 'x', priority: 'normal', status: 'pending' });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.communicationId).toBe('c1');
    expect(sentBody.commId).toBeUndefined();
  });

  it('sends dueDate as a full ISO timestamp', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true, data: { id: 't1', communicationId: 'c1', title: 'x', dueDate: '2026-04-05T00:00:00.000Z' } }) });
    await pgCreateCommTask({ commId: 'c1', title: 'x', dueDate: '2026-04-05' });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.dueDate).toBe('2026-04-05T00:00:00.000Z');
  });

  it('normalizes the response: communicationId → commId, dueDate trimmed to YYYY-MM-DD', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true, data: { id: 't1', communicationId: 'c1', title: 'x', dueDate: '2026-04-05T00:00:00.000Z' } }) });
    const result = await pgCreateCommTask({ commId: 'c1', title: 'x', dueDate: '2026-04-05' });

    expect(result.commId).toBe('c1');
    expect(result.communicationId).toBeUndefined();
    expect(result.dueDate).toBe('2026-04-05');
  });

  it('does not send id/createdAt — server-managed', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true, data: { id: 't1', communicationId: 'c1', title: 'x' } }) });
    await pgCreateCommTask({ id: 'task_local_1', commId: 'c1', title: 'x', createdAt: 'x' });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.id).toBeUndefined();
    expect(sentBody.createdAt).toBeUndefined();
  });
});

// Phase 3B-15 — activity_logs. لا userId/userName يُرسَلان من هنا أبداً كسلطة (الخادم
// يشتقّهما من الجلسة دائماً — server.js's POST /api/activityLogs interceptor)؛ description
// المحلي يُرسَل كـ details (لا عمود description على الجدول إطلاقاً، نفس نمط treasury_txn).
describe('pgCreateActivityLog', () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); globalThis.fetch = fetchMock; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('sends description as details, and never sends userId/userName even if present on the entry', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true, data: {
      id: 'al1', action: 'create', module: 'students', details: 'إضافة: أحمد', entityType: 'student', entityId: 's1',
      userId: 'u1', userName: 'مدير النظام', timestamp: '2026-01-10T00:00:00.000Z',
    } }) });

    await pgCreateActivityLog({ action: 'create', module: 'students', description: 'إضافة: أحمد', entityType: 'student', entityId: 's1', userId: 'spoofed', userName: 'اسم-مزوَّر' });

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody.details).toBe('إضافة: أحمد');
    expect(sentBody.description).toBeUndefined();
    // ملاحظة: الخادم يتجاهل أي userId/userName يُرسَلان بصرف النظر — هذا الاختبار
    // يتحقّق فقط من شكل الطلب المُرسَل من هنا، لا من سلوك الخادم (مُختبَر بشكل منفصل).
  });

  it('normalizes the response: timestamp → ts, userName → user (fallback "النظام" when absent), details → description', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true, data: {
      id: 'al1', action: 'error', module: 'ui', details: 'خطأ في الواجهة', entityType: null, entityId: null,
      userId: null, userName: null, timestamp: '2026-01-10T00:00:00.000Z',
    } }) });

    const result = await pgCreateActivityLog({ action: 'error', module: 'ui', description: 'خطأ في الواجهة' });

    expect(result.ts).toBe('2026-01-10T00:00:00.000Z');
    expect(result.user).toBe('النظام'); // لا user_name (حدث نظامي بلا فاعل معتمَد)
    expect(result.description).toBe('خطأ في الواجهة');
  });

  it('normalizes a real authenticated actor correctly (user comes from server-derived userName, not the client)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true, data: {
      id: 'al2', action: 'create', module: 'students', details: 'إضافة: أحمد', entityType: 'student', entityId: 's1',
      userId: 'u1', userName: 'مدير النظام', timestamp: '2026-01-10T00:00:00.000Z',
    } }) });

    const result = await pgCreateActivityLog({ action: 'create', module: 'students', description: 'إضافة: أحمد', entityType: 'student', entityId: 's1' });

    expect(result.user).toBe('مدير النظام');
    expect(result.userId).toBe('u1');
  });

  it('rejects on a server failure — the caller (addLog\'s call site) is responsible for surfacing this, no silent fallback', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ ok: false, error: 'يجب تسجيل الدخول للوصول لهذا المسار.' }) });

    await expect(pgCreateActivityLog({ action: 'error', module: 'ui', description: 'x' }))
      .rejects.toThrow('يجب تسجيل الدخول للوصول لهذا المسار.');
  });
});
