// backend/src/middleware/activation.routing.test.js
// M1 — Express matches routes case-insensitively by default, while isActivationExempt()
// compares paths case-sensitively: '/API/students' was "not under /api/" (exempt) yet still
// matched the '/api/students' mount, bypassing requireActivation. server.js now enables
// 'case sensitive routing' so route matching agrees with the activation check.
// No DB: getCachedLicenseStatus is mocked; the real requireActivation middleware is used.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

vi.mock('../lib/license.js', () => ({ getCachedLicenseStatus: vi.fn() }));
import { getCachedLicenseStatus } from '../lib/license.js';
import { requireActivation } from './activation.js';
import { notFound } from './errorHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mirrors server.js's order: setting → requireActivation → exempt + guarded mounts → 404.
// The auth stand-in only checks a header; it proves the guard still runs, unchanged.
function buildApp({ caseSensitive }) {
  const app = express();
  if (caseSensitive) app.set('case sensitive routing', true);
  app.use(requireActivation);
  app.use('/api/session', (req, res) => res.json({ ok: true, route: 'session' }));
  const fakeAuth = (req, res, next) => (req.headers['x-test-user'] ? next() : res.status(401).json({ ok: false }));
  const students = express.Router();
  students.get('/', (req, res) => res.json({ ok: true, route: 'students' }));
  app.use('/api/students', fakeAuth, students);
  app.use(notFound);
  return app;
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    return await fn((p, headers = {}) => globalThis.fetch(base + p, { headers }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const AUTH = { 'x-test-user': 'u1' };

beforeEach(() => { getCachedLicenseStatus.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('server.js wiring', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  it("enables 'case sensitive routing'", () => {
    expect(source).toMatch(/app\.set\(['"]case sensitive routing['"],\s*true\)/);
  });

  it('sets it before the first app.use (Express builds its router lazily on first use; a later set() is ignored)', () => {
    const setAt = source.search(/app\.set\(['"]case sensitive routing['"],\s*true\)/);
    const firstUse = source.search(/^\s*(if \([^)]*\) )?app\.use\(/m);
    expect(setAt).toBeGreaterThan(-1);
    expect(firstUse).toBeGreaterThan(-1);
    expect(setAt).toBeLessThan(firstUse);
    expect(setAt).toBeLessThan(source.indexOf('app.use(requireActivation)'));
  });
});

describe('control — default (case-insensitive) routing reproduces the M1 bypass', () => {
  it('/API/students reaches the handler on an unactivated install', async () => {
    getCachedLicenseStatus.mockResolvedValue({ activated: false });
    await withServer(buildApp({ caseSensitive: false }), async (get) => {
      const res = await get('/API/students', AUTH);
      expect(res.status).toBe(200);
    });
  });
});

describe('case-sensitive routing — unactivated install', () => {
  beforeEach(() => { getCachedLicenseStatus.mockResolvedValue({ activated: false }); });

  it('/api/students is still blocked with 402 (unchanged)', async () => {
    await withServer(buildApp({ caseSensitive: true }), async (get) => {
      const res = await get('/api/students', AUTH);
      expect(res.status).toBe(402);
      expect((await res.json()).licenseRequired).toBe(true);
    });
  });

  it.each(['/API/students', '/Api/Students', '/api/Students', '/API/STUDENTS'])(
    '%s cannot reach the protected handler', async (p) => {
      await withServer(buildApp({ caseSensitive: true }), async (get) => {
        const res = await get(p, AUTH);
        expect(res.status).not.toBe(200);
        const body = await res.json();
        expect(body.route).toBeUndefined();
      });
    });

  it('activation-exempt /api/session keeps working', async () => {
    await withServer(buildApp({ caseSensitive: true }), async (get) => {
      const res = await get('/api/session');
      expect(res.status).toBe(200);
      expect((await res.json()).route).toBe('session');
    });
  });
});

describe('case-sensitive routing — activated install', () => {
  beforeEach(() => { getCachedLicenseStatus.mockResolvedValue({ activated: true }); });

  it('normal lowercase /api/students works for an authenticated user', async () => {
    await withServer(buildApp({ caseSensitive: true }), async (get) => {
      const res = await get('/api/students', AUTH);
      expect(res.status).toBe(200);
      expect((await res.json()).route).toBe('students');
    });
  });

  it('authentication still runs: no session → 401 (unchanged)', async () => {
    await withServer(buildApp({ caseSensitive: true }), async (get) => {
      const res = await get('/api/students');
      expect(res.status).toBe(401);
    });
  });

  it('a case-variant path is a 404, not a second entry point', async () => {
    await withServer(buildApp({ caseSensitive: true }), async (get) => {
      const res = await get('/API/students', AUTH);
      expect(res.status).toBe(404);
    });
  });
});
