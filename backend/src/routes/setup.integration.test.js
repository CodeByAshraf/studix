// backend/src/routes/setup.integration.test.js
// INSTALL-04 — real scratch PostgreSQL database + a real (ephemeral-port) HTTP server wrapping
// only routes/setup.js. A real server (not a hand-mocked req/res) is used deliberately here —
// express-rate-limit's IP-based limiting and real Origin/Host headers cannot be meaningfully
// exercised through direct router.handle() invocation, and no HTTP-testing dependency (e.g.
// supertest) exists in this project already — Node's own built-in http.request gives full
// header control with zero new dependencies.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function request(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch { /* no/invalid body */ }
          resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('routes/setup.js — real PostgreSQL + real HTTP integration', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port;
  let savedPort, savedFrontendOrigin;

  beforeAll(async () => {
    scratch = await setupScratchDb('setup_route');
    client = scratch.client; // becomes globalThis.prisma — routes/setup.js's own `import { prisma }` picks this up

    savedPort = process.env.PORT;
    savedFrontendOrigin = process.env.FRONTEND_ORIGIN;

    const { default: setupRouter } = await import('./setup.js');
    const app = express();
    app.use(express.json());
    app.use('/api/setup', setupRouter);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    // setupOriginGuard reads process.env.PORT live, per request — aligning it with the actual
    // ephemeral test port so a same-origin request from "this app's own origin" validates
    // correctly, exactly as it would in production where PORT matches the real listening port.
    process.env.PORT = String(port);
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
    if (savedPort === undefined) delete process.env.PORT; else process.env.PORT = savedPort;
    if (savedFrontendOrigin === undefined) delete process.env.FRONTEND_ORIGIN; else process.env.FRONTEND_ORIGIN = savedFrontendOrigin;
  });

  beforeEach(async () => {
    await client.$executeRawUnsafe('DELETE FROM users');
  });

  describe('GET /api/setup/status', () => {
    it('reports open on a fresh database', async () => {
      const res = await request(port, { path: '/api/setup/status' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, open: true });
    });

    it('reports closed once an active admin exists, and reveals nothing else', async () => {
      await client.users.create({ data: { id: 'admin', name: 'Admin', is_admin: true, active: true, permissions: ['dashboard'] } });
      const res = await request(port, { path: '/api/setup/status' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, open: false });
      const keys = Object.keys(res.body).sort();
      expect(keys).toEqual(['ok', 'open']); // no id/count/name/role/permissions leaked
    });
  });

  describe('POST /api/setup — success path', () => {
    it('creates the admin, sets a session cookie, and never echoes the password/hash', async () => {
      const res = await request(port, {
        method: 'POST',
        path: '/api/setup',
        headers: { Origin: `http://127.0.0.1:${port}` },
        body: { name: 'مدير النظام', id: 'admin', password: 'correct-horse-battery-staple', confirmPassword: 'correct-horse-battery-staple' },
      });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.user.id).toBe('admin');
      expect(res.body.user.role).toBe('admin');
      expect(JSON.stringify(res.body)).not.toContain('correct-horse-battery-staple');
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);

      const setCookie = res.headers['set-cookie']?.join(';') || '';
      expect(setCookie).toContain('studix_session=');
      expect(setCookie.toLowerCase()).toContain('httponly');
    });

    it('rejects a mismatched password confirmation without creating anything', async () => {
      const res = await request(port, {
        method: 'POST', path: '/api/setup',
        body: { name: 'Admin', id: 'admin', password: 'correct-horse-battery-staple', confirmPassword: 'different' },
      });
      expect(res.status).toBe(400);
      expect(await client.users.count()).toBe(0);
    });
  });

  describe('POST /api/setup — closed once an admin exists', () => {
    it('returns 404 (not a soft "closed" body) once an active admin exists', async () => {
      await client.users.create({ data: { id: 'admin', name: 'Admin', is_admin: true, active: true, permissions: ['dashboard'] } });

      const res = await request(port, {
        method: 'POST', path: '/api/setup',
        body: { name: 'Attacker', id: 'attacker', password: 'correct-horse-battery-staple', confirmPassword: 'correct-horse-battery-staple' },
      });

      expect(res.status).toBe(404);
      expect(await client.users.count()).toBe(1); // nothing new created
    });

    it('GET /status also reports closed, consistently', async () => {
      await client.users.create({ data: { id: 'admin', name: 'Admin', is_admin: true, active: true, permissions: ['dashboard'] } });
      const res = await request(port, { path: '/api/setup/status' });
      expect(res.body.open).toBe(false);
    });
  });

  describe('Origin/Host defense-in-depth (POST only)', () => {
    it('rejects an unexpected Origin header with 403, creates nothing', async () => {
      const res = await request(port, {
        method: 'POST', path: '/api/setup',
        headers: { Origin: 'http://evil.example.com' },
        body: { name: 'Admin', id: 'admin', password: 'correct-horse-battery-staple', confirmPassword: 'correct-horse-battery-staple' },
      });
      expect(res.status).toBe(403);
      expect(await client.users.count()).toBe(0);
    });

    it('accepts a request with no Origin header at all (many legitimate non-browser/same-origin requests omit it)', async () => {
      const res = await request(port, {
        method: 'POST', path: '/api/setup',
        body: { name: 'Admin', id: 'admin', password: 'correct-horse-battery-staple', confirmPassword: 'correct-horse-battery-staple' },
      });
      expect(res.status).toBe(201);
    });

    it('accepts a request whose Origin matches this app\'s own 127.0.0.1 origin', async () => {
      const res = await request(port, {
        method: 'POST', path: '/api/setup',
        headers: { Origin: `http://127.0.0.1:${port}` },
        body: { name: 'Admin', id: 'admin', password: 'correct-horse-battery-staple', confirmPassword: 'correct-horse-battery-staple' },
      });
      expect(res.status).toBe(201);
    });

    it('accepts a request whose Origin matches the configured FRONTEND_ORIGIN dev topology', async () => {
      process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
      const res = await request(port, {
        method: 'POST', path: '/api/setup',
        headers: { Origin: 'http://localhost:5173' },
        body: { name: 'Admin', id: 'admin', password: 'correct-horse-battery-staple', confirmPassword: 'correct-horse-battery-staple' },
      });
      expect(res.status).toBe(201);
    });

    it('rejects a request with a non-loopback Host header (DNS-rebinding-style defense-in-depth)', async () => {
      const res = await request(port, {
        method: 'POST', path: '/api/setup',
        headers: { Host: 'attacker.example.com' },
        body: { name: 'Admin', id: 'admin', password: 'correct-horse-battery-staple', confirmPassword: 'correct-horse-battery-staple' },
      });
      expect(res.status).toBe(403);
      expect(await client.users.count()).toBe(0);
    });
  });

  describe('rate limiting', () => {
    it('the setup limiter eventually returns 429 under repeated rapid requests from the same IP', async () => {
      const results = [];
      for (let i = 0; i < 12; i++) {
        // eslint-disable-next-line no-await-in-loop -- deliberately sequential to count reliably
        results.push(await request(port, {
          method: 'POST', path: '/api/setup',
          body: { name: '', id: '', password: '', confirmPassword: '' }, // invalid body — rate limiter still counts it (runs before validation)
        }));
      }
      expect(results.some((r) => r.status === 429)).toBe(true);
    }, 20_000);
  });
});
