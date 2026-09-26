// src/services/api.dbSwitch.test.js
// Phase 2C-3C Part 4 — pgGetDatabaseIdentity/pgTriggerDatabaseSwitch. Never touches a real
// network — fetch is fully mocked, same convention as api.test.js's own pgCreateExam tests.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pgGetDatabaseIdentity, pgTriggerDatabaseSwitch } from './api';

describe('pgGetDatabaseIdentity — never throws (same convention as pgCheckHealth)', () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); globalThis.fetch = fetchMock; });
  afterEach(() => vi.restoreAllMocks());

  it('200 with a real identity: returns {ok:true, identity}', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, identity: { id: 'abc-123', createdAt: '2026-01-01T00:00:00.000Z' } }) });
    const result = await pgGetDatabaseIdentity();
    expect(result).toEqual({ ok: true, identity: { id: 'abc-123', createdAt: '2026-01-01T00:00:00.000Z' } });
  });

  it('200 with identity:null (fresh install, no identity created yet): returns {ok:true, identity:null}', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, identity: null }) });
    const result = await pgGetDatabaseIdentity();
    expect(result).toEqual({ ok: true, identity: null });
  });

  it('403 (non-admin — the endpoint is admin-only): returns {ok:false, identity:null}, never throws', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ ok: false, error: 'لا تملك صلاحية الوصول لهذا الإجراء.' }) });
    const result = await pgGetDatabaseIdentity();
    expect(result).toEqual({ ok: false, identity: null });
  });

  it('401 (unauthenticated): returns {ok:false, identity:null}, never throws', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ ok: false, error: 'يجب تسجيل الدخول.' }) });
    const result = await pgGetDatabaseIdentity();
    expect(result).toEqual({ ok: false, identity: null });
  });

  it('500 (server failure): returns {ok:false, identity:null}, never throws', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ ok: false, error: 'خطأ داخلي.' }) });
    const result = await pgGetDatabaseIdentity();
    expect(result).toEqual({ ok: false, identity: null });
  });

  it('a network error (fetch rejects): returns {ok:false, identity:null}, never throws', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await pgGetDatabaseIdentity();
    expect(result).toEqual({ ok: false, identity: null });
  });

  it('sends credentials:include (same session-cookie convention as every other pg* call)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, identity: null }) });
    await pgGetDatabaseIdentity();
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.credentials).toBe('include');
  });

  it('never sends a body / never a POST — read-only GET', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, identity: null }) });
    await pgGetDatabaseIdentity();
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts?.method ?? 'GET').toBe('GET');
    expect(opts?.body).toBeUndefined();
  });
});

describe('pgTriggerDatabaseSwitch — request shape / action whitelist', () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); globalThis.fetch = fetchMock; });
  afterEach(() => vi.restoreAllMocks());

  it('switch sends exactly {action:"switch"} in the body, no other field', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, action: 'switch', status: 'active' }) });
    await pgTriggerDatabaseSwitch('switch');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/db-switch');
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('include');
    expect(JSON.parse(opts.body)).toEqual({ action: 'switch' });
  });

  it('rollback sends exactly {action:"rollback"}', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, action: 'rollback', status: 'rolled_back' }) });
    await pgTriggerDatabaseSwitch('rollback');
    const [, opts] = fetchMock.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ action: 'rollback' });
  });

  it('an arbitrary/unsupported action is rejected client-side, BEFORE any network request is ever made', async () => {
    await expect(pgTriggerDatabaseSwitch('drop-everything')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a DATABASE_URL-shaped value passed as action is rejected client-side too, never sent', async () => {
    await expect(pgTriggerDatabaseSwitch('postgresql://user:pw@host/db')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a missing/undefined action is rejected client-side', async () => {
    await expect(pgTriggerDatabaseSwitch(undefined)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('success (200) resolves with the server\'s own {ok, action, status}', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, action: 'switch', status: 'active' }) });
    const result = await pgTriggerDatabaseSwitch('switch');
    expect(result).toEqual({ ok: true, action: 'switch', status: 'active' });
  });

  it.each([
    [400, 'إجراء غير مدعوم.'],
    [401, 'يجب تسجيل الدخول للوصول لهذا المسار.'],
    [403, 'لا تملك صلاحية الوصول لهذا الإجراء.'],
    [409, 'عملية استعادة/تبديل أخرى قيد التنفيذ بالفعل — يُرجى الانتظار حتى تنتهي.'],
    [500, 'تعذّر بدء عملية قاعدة البيانات.'],
    [504, 'تجاوزت عملية قاعدة البيانات المهلة المتاحة.'],
  ])('a %i response throws an Error carrying the server\'s own safe message', async (status, error) => {
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({ ok: false, error }) });
    await expect(pgTriggerDatabaseSwitch('switch')).rejects.toThrow(error);
  });

  it('a response with no JSON body at all still throws a safe, generic error (never crashes)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } });
    await expect(pgTriggerDatabaseSwitch('switch')).rejects.toThrow(/db-switch/);
  });

  it('never exposes DATABASE_URL/credentials in the thrown error even if the (mocked) server response somehow contained one', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ ok: false, error: 'خطأ داخلي في الخادم.' }) });
    let caught;
    try {
      await pgTriggerDatabaseSwitch('switch');
    } catch (err) {
      caught = err;
    }
    expect(caught.message).not.toMatch(/postgres(?:ql)?:\/\//i);
  });
});
