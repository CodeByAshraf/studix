// backend/src/db/databaseIdentity.test.js
// Phase 2C-1 — unit tests for the database-identity marker. Every test uses a real temp
// directory and an explicit configPath — never the real C:\ProgramData\Studix\config\.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  generateDatabaseIdentity, readActiveDatabaseIdentity, ensureActiveDatabaseIdentity,
  hasDatabaseIdentityChanged, promoteActiveDatabaseIdentity, DatabaseIdentityError,
} from './databaseIdentity.js';

function mkConfigPath() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-dbidentity-test-'));
  return path.join(tmpDir, 'config', 'db-identity.json');
}

describe('generateDatabaseIdentity', () => {
  it('produces a unique id, an ISO timestamp, and the requested role', () => {
    const a = generateDatabaseIdentity({ role: 'active' });
    const b = generateDatabaseIdentity({ role: 'candidate' });

    expect(a.id).not.toBe(b.id);
    expect(a.role).toBe('active');
    expect(b.role).toBe('candidate');
    expect(new Date(a.createdAt).toString()).not.toBe('Invalid Date');
  });

  it('rejects an unknown role rather than silently accepting it', () => {
    expect(() => generateDatabaseIdentity({ role: 'bogus' })).toThrow(DatabaseIdentityError);
  });
});

describe('readActiveDatabaseIdentity — missing/corrupt', () => {
  it('returns null when the file does not exist yet (safe, expected default)', () => {
    const configPath = mkConfigPath();
    expect(readActiveDatabaseIdentity({ configPath })).toBeNull();
  });

  it('throws DatabaseIdentityError("corrupt_identity") for unparseable JSON — never silently null', () => {
    const configPath = mkConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'not json', 'utf8');

    expect(() => readActiveDatabaseIdentity({ configPath })).toThrow(DatabaseIdentityError);
    try {
      readActiveDatabaseIdentity({ configPath });
    } catch (err) {
      expect(err.reason).toBe('corrupt_identity');
    }
  });

  it('throws DatabaseIdentityError("corrupt_identity") for a valid-JSON but invalid shape', () => {
    const configPath = mkConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ id: '', role: 'active', createdAt: 'x' }), 'utf8');

    expect(() => readActiveDatabaseIdentity({ configPath })).toThrow(DatabaseIdentityError);
  });

  it('throws DatabaseIdentityError("corrupt_identity") for an unknown role value', () => {
    const configPath = mkConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ id: 'abc', role: 'bogus', createdAt: new Date().toISOString() }), 'utf8');

    expect(() => readActiveDatabaseIdentity({ configPath })).toThrow(DatabaseIdentityError);
  });
});

describe('ensureActiveDatabaseIdentity — idempotency', () => {
  it('creates a fresh identity on first call', () => {
    const configPath = mkConfigPath();
    const result = ensureActiveDatabaseIdentity({ configPath });

    expect(result.created).toBe(true);
    expect(result.identity.role).toBe('active');
    expect(readActiveDatabaseIdentity({ configPath })).toEqual(result.identity);
  });

  it('never rotates an already-existing identity — second call returns the SAME id, created:false', () => {
    const configPath = mkConfigPath();
    const first = ensureActiveDatabaseIdentity({ configPath });
    const second = ensureActiveDatabaseIdentity({ configPath });

    expect(second.created).toBe(false);
    expect(second.identity.id).toBe(first.identity.id);
  });

  it('does not touch the filesystem at all on the already-exists path (no read-then-rewrite)', () => {
    const configPath = mkConfigPath();
    ensureActiveDatabaseIdentity({ configPath });

    const writeFileSync = () => { throw new Error('should never be called'); };
    expect(() => ensureActiveDatabaseIdentity({ configPath, writeFileSync })).not.toThrow();
  });
});

describe('hasDatabaseIdentityChanged', () => {
  it('is false when both identities have the same id', () => {
    const id = generateDatabaseIdentity();
    expect(hasDatabaseIdentityChanged(id, { ...id })).toBe(false);
  });

  it('is true when the ids differ', () => {
    const a = generateDatabaseIdentity();
    const b = generateDatabaseIdentity();
    expect(hasDatabaseIdentityChanged(a, b)).toBe(true);
  });

  it('is false (never true) when either side is missing — nothing to compare against yet', () => {
    const a = generateDatabaseIdentity();
    expect(hasDatabaseIdentityChanged(null, a)).toBe(false);
    expect(hasDatabaseIdentityChanged(a, null)).toBe(false);
    expect(hasDatabaseIdentityChanged(null, null)).toBe(false);
  });
});

describe('promoteActiveDatabaseIdentity — Phase 2C-3B deliberate rotation', () => {
  it('overwrites the active identity file with the exact id/createdAt supplied, forcing role to "active"', () => {
    const configPath = mkConfigPath();
    ensureActiveDatabaseIdentity({ configPath }); // pre-existing active identity
    const candidateIdentity = generateDatabaseIdentity({ role: 'candidate' });

    const { identity } = promoteActiveDatabaseIdentity({ configPath, identity: candidateIdentity });

    expect(identity).toEqual({ id: candidateIdentity.id, role: 'active', createdAt: candidateIdentity.createdAt });
    expect(readActiveDatabaseIdentity({ configPath })).toEqual(identity);
  });

  it('rejects a malformed identity object rather than writing it', () => {
    const configPath = mkConfigPath();
    expect(() => promoteActiveDatabaseIdentity({ configPath, identity: { role: 'active' } })).toThrow(DatabaseIdentityError);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('a promotion can later be reversed by promoting the ORIGINAL identity back (rollback path)', () => {
    const configPath = mkConfigPath();
    const original = ensureActiveDatabaseIdentity({ configPath }).identity;
    const candidateIdentity = generateDatabaseIdentity({ role: 'candidate' });
    promoteActiveDatabaseIdentity({ configPath, identity: candidateIdentity });

    const { identity: reverted } = promoteActiveDatabaseIdentity({ configPath, identity: original });

    expect(reverted.id).toBe(original.id);
    expect(reverted.createdAt).toBe(original.createdAt);
    expect(readActiveDatabaseIdentity({ configPath }).id).toBe(original.id);
  });
});
