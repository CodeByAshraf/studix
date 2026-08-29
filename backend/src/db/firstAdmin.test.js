// backend/src/db/firstAdmin.test.js
// Pure, DB-free unit tests — only the validation paths that fail BEFORE ensureFirstAdmin ever
// constructs a database connection (missing fields, weak password). Everything that actually
// touches PostgreSQL (the advisory lock, the transactional recheck+insert, race conditions,
// permissions correctness) is real-scratch-DB integration coverage in
// firstAdmin.integration.test.js — mirroring this project's existing split between
// bootstrapDatabase.test.js (pure) and bootstrapDatabase.integration.test.js (real DB).
import { describe, it, expect } from 'vitest';
import { ensureFirstAdmin, FirstAdminError, ALL_PERMISSION_PAGES } from './firstAdmin.js';

describe('ALL_PERMISSION_PAGES', () => {
  it('is a non-empty array of unique string page ids', () => {
    expect(Array.isArray(ALL_PERMISSION_PAGES)).toBe(true);
    expect(ALL_PERMISSION_PAGES.length).toBeGreaterThan(0);
    expect(new Set(ALL_PERMISSION_PAGES).size).toBe(ALL_PERMISSION_PAGES.length);
    for (const id of ALL_PERMISSION_PAGES) expect(typeof id).toBe('string');
  });

  it('includes every page id referenced by server.js\'s own COLLECTION_PERMISSIONS/requirePermission calls', () => {
    // A representative sample of every distinct pageId actually used to guard a route in
    // server.js — if any of these were missing, a fresh-DB first admin would 403 on that
    // feature despite is_admin being true, reproducing the exact defect this file exists to
    // avoid (audit §1).
    const mustInclude = [
      'dashboard', 'students', 'groups', 'attendance', 'exams', 'homework', 'settings',
      'materials', 'admissions', 'treasury', 'payments', 'activity-log', 'users',
      'reports', 'id-cards', 'notifications',
    ];
    for (const id of mustInclude) expect(ALL_PERMISSION_PAGES).toContain(id);
  });
});

describe('ensureFirstAdmin — validation fails before any database connection is attempted', () => {
  const unusedDeps = { prisma: null, databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused' };

  it('rejects a missing id', async () => {
    await expect(ensureFirstAdmin({ id: '', name: 'Admin', password: 'longenough123', ...unusedDeps }))
      .rejects.toThrow(FirstAdminError);
  });

  it('rejects a missing name', async () => {
    await expect(ensureFirstAdmin({ id: 'admin', name: '', password: 'longenough123', ...unusedDeps }))
      .rejects.toThrow(FirstAdminError);
  });

  it('rejects a missing password', async () => {
    await expect(ensureFirstAdmin({ id: 'admin', name: 'Admin', password: '', ...unusedDeps }))
      .rejects.toThrow(FirstAdminError);
  });

  it('rejects a password shorter than the minimum (8 chars, matching scripts/adminCreate.js)', async () => {
    try {
      await ensureFirstAdmin({ id: 'admin', name: 'Admin', password: 'short1', ...unusedDeps });
      expect.fail('expected ensureFirstAdmin to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FirstAdminError);
      expect(err.reason).toBe('weak_password');
    }
  });

  it('the password/weak_password error message never contains the rejected password itself', async () => {
    const secretGuess = 'ThisExactStringMustNeverAppearInAnyErrorMessage';
    try {
      await ensureFirstAdmin({ id: 'admin', name: 'Admin', password: secretGuess.slice(0, 5), ...unusedDeps });
    } catch (err) {
      expect(err.message).not.toContain(secretGuess.slice(0, 5));
    }
  });
});
