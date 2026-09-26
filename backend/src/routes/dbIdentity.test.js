// backend/src/routes/dbIdentity.test.js
// Phase 2C-3C Part 3 — pure unit tests (no real PostgreSQL, no real filesystem beyond an
// injected fake — readActiveDatabaseIdentityFn is always overridden). Auth-wiring proof lives
// in dbIdentity.integration.test.js (real scratch DB, matching dbSwitch.integration.test.js's
// established convention exactly).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabaseIdentitySafe } from './dbIdentity.js';
import { DatabaseIdentityError } from '../db/databaseIdentity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function codeOnly(source) {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

describe('architecture — reuses the existing databaseIdentity.js resolver, never a second DB client', () => {
  const source = fs.readFileSync(path.join(__dirname, 'dbIdentity.js'), 'utf8');
  const code = codeOnly(source);

  it('imports readActiveDatabaseIdentity from the existing db/databaseIdentity.js — no parallel resolver invented', () => {
    expect(code).toMatch(/import\s*\{[^}]*readActiveDatabaseIdentity[^}]*\}\s*from\s*['"]\.\.\/db\/databaseIdentity\.js['"]/);
  });

  it('never imports PrismaClient / @prisma/client — no PostgreSQL connection of its own', () => {
    expect(code).not.toMatch(/@prisma\/client/);
    expect(code).not.toMatch(/new\s+PrismaClient/);
  });

  it('never imports databaseSwitch.js / restoreState.js / restoreLock.js / windowsService.js — out of this phase\'s scope entirely', () => {
    expect(code).not.toMatch(/databaseSwitch\.js/);
    expect(code).not.toMatch(/restoreState\.js/);
    expect(code).not.toMatch(/restoreLock\.js/);
    expect(code).not.toMatch(/windowsService\.js/);
  });

  it('never reads req.query/req.body/req.params — the client cannot supply an alternate identity', () => {
    expect(code).not.toMatch(/req\.(query|body|params)/);
  });

  it('server.js mounts the route behind requireAuth + requireRole(\'admin\'), same as /api/db-switch', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(serverSource).toMatch(/app\.use\(['"]\/api\/db-identity['"],\s*requireAuth,\s*requireRole\('admin'\),\s*dbIdentityRouter\)/);
  });
});

describe('getDatabaseIdentitySafe — response shape (point 4/5/6)', () => {
  it('returns ONLY {id, createdAt} — never role, never any other field, even if the underlying file has more', async () => {
    const readActiveDatabaseIdentityFn = () => ({ id: 'abc-123', role: 'active', createdAt: '2026-01-01T00:00:00.000Z', extraField: 'should never surface' });
    const result = getDatabaseIdentitySafe({ readActiveDatabaseIdentityFn });
    expect(result).toEqual({ id: 'abc-123', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(result).not.toHaveProperty('role');
    expect(result).not.toHaveProperty('extraField');
  });

  it('never contains anything DATABASE_URL/connection-string/credential-shaped, by construction (the identity is a random UUID + timestamp)', () => {
    const readActiveDatabaseIdentityFn = () => ({ id: 'a1b2c3d4-uuid', role: 'active', createdAt: '2026-01-01T00:00:00.000Z' });
    const result = getDatabaseIdentitySafe({ readActiveDatabaseIdentityFn });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/DATABASE_URL/);
  });

  it('a fresh/never-restored install (no identity file yet) returns null, not an error', () => {
    const readActiveDatabaseIdentityFn = () => null;
    expect(getDatabaseIdentitySafe({ readActiveDatabaseIdentityFn })).toBeNull();
  });

  it('takes no user-controlled input at all — the identity is derived exclusively from the resolver, never a parameter the caller can steer', () => {
    // getDatabaseIdentitySafe's only option is the resolver function itself (a DI seam for
    // tests) — there is no id/name/database parameter of any kind for a caller to influence.
    const readActiveDatabaseIdentityFn = () => ({ id: 'fixed-id', role: 'active', createdAt: '2026-01-01T00:00:00.000Z' });
    const result1 = getDatabaseIdentitySafe({ readActiveDatabaseIdentityFn, id: 'attacker-supplied' });
    const result2 = getDatabaseIdentitySafe({ readActiveDatabaseIdentityFn });
    expect(result1).toEqual(result2); // the extra `id` option is simply ignored
  });
});

describe('getDatabaseIdentitySafe — failure handling (point 7)', () => {
  it('a corrupt identity file (DatabaseIdentityError) produces a safe, generic failure — never the raw file path/parse error', () => {
    const readActiveDatabaseIdentityFn = () => {
      throw new DatabaseIdentityError('corrupt_identity', 'ملف هوية قاعدة البيانات عند C:\\ProgramData\\Studix\\config\\db-identity.json موجود لكن محتواه JSON غير صالح: Unexpected token.');
    };
    let caught;
    try {
      getDatabaseIdentitySafe({ readActiveDatabaseIdentityFn });
    } catch (err) {
      caught = err;
    }
    expect(caught.status).toBe(500);
    expect(caught.expose).toBe(true);
    expect(caught.message).not.toContain('ProgramData');
    expect(caught.message).not.toContain('Unexpected token');
  });

  it('a genuinely unexpected error (not DatabaseIdentityError) propagates unchanged, for the generic errorHandler to log/handle', () => {
    const boom = new Error('some unrelated filesystem error');
    const readActiveDatabaseIdentityFn = () => { throw boom; };
    let caught;
    try {
      getDatabaseIdentitySafe({ readActiveDatabaseIdentityFn });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(boom);
  });
});
