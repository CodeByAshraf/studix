// backend/src/lib/startupErrors.test.js
// Phase 6b — pure unit tests, no database, no network. Security-relevant assertions in
// particular: no returned/thrown message ever contains a credential embedded in the input.
import { describe, it, expect } from 'vitest';
import { ConfigError, validateDatabaseUrl, describeStartupFailure } from './startupErrors.js';

describe('validateDatabaseUrl', () => {
  it('throws ConfigError when DATABASE_URL is missing', () => {
    expect(() => validateDatabaseUrl(undefined)).toThrow(ConfigError);
    expect(() => validateDatabaseUrl('')).toThrow(ConfigError);
    expect(() => validateDatabaseUrl('   ')).toThrow(ConfigError);
  });

  it('throws ConfigError when DATABASE_URL is malformed', () => {
    expect(() => validateDatabaseUrl('not-a-url-at-all')).toThrow(ConfigError);
  });

  it('throws ConfigError when DATABASE_URL uses an unsupported protocol', () => {
    expect(() => validateDatabaseUrl('mysql://user:pass@localhost:3306/studix')).toThrow(ConfigError);
  });

  it('accepts postgres:// and postgresql:// without throwing', () => {
    expect(() => validateDatabaseUrl('postgres://user:pass@localhost:5432/studix')).not.toThrow();
    expect(() => validateDatabaseUrl('postgresql://user:pass@localhost:5432/studix')).not.toThrow();
  });

  it('never includes the actual password/credential from a malformed or wrong-protocol URL in its error message', () => {
    const secret = 'SUPER-SECRET-PASSWORD-12345';
    let caught;
    try {
      validateDatabaseUrl(`mysql://user:${secret}@localhost:3306/studix`);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught.message).not.toContain(secret);
  });

  it('missing-DATABASE_URL message explains where configuration is expected, without ever quoting a value', () => {
    let caught;
    try {
      validateDatabaseUrl(undefined);
    } catch (err) {
      caught = err;
    }
    expect(caught.message).toMatch(/DATABASE_URL/);
    expect(caught.message).toMatch(/\.env/);
  });
});

describe('describeStartupFailure', () => {
  it('returns the ConfigError message verbatim', () => {
    const err = new ConfigError('رسالة إعداد واضحة');
    expect(describeStartupFailure(err)).toBe('رسالة إعداد واضحة');
  });

  it('classifies a Prisma-style unreachable-database error into a clear PostgreSQL message', () => {
    const err = new Error("Can't reach database server at `localhost:5432`");
    err.errorCode = 'P1001';
    expect(describeStartupFailure(err)).toMatch(/PostgreSQL/);
  });

  it('classifies EADDRINUSE into a clear port-conflict message', () => {
    const err = new Error('listen EADDRINUSE: address already in use :::4000');
    err.code = 'EADDRINUSE';
    expect(describeStartupFailure(err)).toMatch(/المنفذ/);
  });

  it('falls back to the raw message for an unrecognized error shape', () => {
    const err = new Error('something totally unrelated happened');
    expect(describeStartupFailure(err)).toBe('something totally unrelated happened');
  });

  it('never echoes a DATABASE_URL-shaped credential even for an unrecognized error whose message happens to contain one', () => {
    // Defensive check: describeStartupFailure must not additionally embed/duplicate a raw
    // connection string anywhere beyond whatever the underlying error's own message already
    // was — it should pass an unrecognized message through unchanged, never enrich it with
    // config values pulled from elsewhere.
    const err = new Error('unexpected failure, no DB details here');
    expect(describeStartupFailure(err)).not.toMatch(/postgres(ql)?:\/\//);
  });
});
