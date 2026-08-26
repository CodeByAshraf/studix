// backend/src/db/bootstrapDatabase.test.js
// Phase 6c — pure unit tests, no PostgreSQL, no network. Covers the parsing/validation/
// classification logic that doesn't require a real database connection.
import { describe, it, expect } from 'vitest';
import {
  BootstrapError, extractDatabaseName, resolveAdminDatabaseUrl, prepareSchemaStatements,
} from './bootstrapDatabase.js';

describe('extractDatabaseName', () => {
  it('extracts the database name from a normal DATABASE_URL', () => {
    expect(extractDatabaseName('postgresql://user:pass@localhost:5432/studix')).toBe('studix');
  });

  it('throws BootstrapError for a database name with unsafe characters', () => {
    expect(() => extractDatabaseName('postgresql://user:pass@localhost:5432/stu"dix; DROP TABLE x'))
      .toThrow(BootstrapError);
  });

  it('never includes the password in the thrown error message for an unsafe name', () => {
    const secret = 'SUPER-SECRET';
    let caught;
    try {
      extractDatabaseName(`postgresql://user:${secret}@localhost:5432/bad;name`);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BootstrapError);
    expect(caught.message).not.toContain(secret);
  });
});

describe('resolveAdminDatabaseUrl', () => {
  it('derives the admin URL by pointing at the postgres maintenance database, same host/credentials', () => {
    const admin = resolveAdminDatabaseUrl('postgresql://user:pass@localhost:5432/studix');
    const parsed = new URL(admin);
    expect(parsed.hostname).toBe('localhost');
    expect(parsed.pathname).toBe('/postgres');
    expect(parsed.username).toBe('user');
  });

  it('accepts STUDIX_DB_ADMIN_URL override when it targets the same host', () => {
    const override = 'postgresql://admin:pass@localhost:5432/postgres';
    const admin = resolveAdminDatabaseUrl('postgresql://user:pass@localhost:5432/studix', override);
    expect(admin).toBe(override);
  });

  it('rejects STUDIX_DB_ADMIN_URL when it targets a different host — never a silent remote fallback', () => {
    const override = 'postgresql://admin:pass@some-remote-host:5432/postgres';
    expect(() => resolveAdminDatabaseUrl('postgresql://user:pass@localhost:5432/studix', override))
      .toThrow(BootstrapError);
  });

  it('never includes a password in the host-mismatch error message', () => {
    const secret = 'SUPER-SECRET';
    let caught;
    try {
      resolveAdminDatabaseUrl(`postgresql://user:${secret}@localhost:5432/studix`, 'postgresql://admin:x@remote:5432/postgres');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BootstrapError);
    expect(caught.message).not.toContain(secret);
  });
});

describe('prepareSchemaStatements', () => {
  it('strips \\restrict and \\unrestrict lines before splitting', () => {
    const sql = [
      '\\restrict abc123',
      'CREATE TABLE public.foo (id text);',
      'CREATE TABLE public.bar (id text);',
      '\\unrestrict abc123',
      '',
    ].join('\n');
    const statements = prepareSchemaStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('CREATE TABLE public.foo');
    expect(statements[1]).toContain('CREATE TABLE public.bar');
    expect(statements.join(' ')).not.toContain('\\restrict');
    expect(statements.join(' ')).not.toContain('\\unrestrict');
  });

  it('handles a schema with no restrict/unrestrict lines at all (defensive — future pg_dump versions may omit them)', () => {
    const sql = 'CREATE TABLE public.only_one (id text);';
    const statements = prepareSchemaStatements(sql);
    expect(statements).toHaveLength(1);
  });

  it('correctly splits statements containing $-quoted plpgsql function bodies (reused splitter, not reimplemented)', () => {
    const sql = [
      '\\restrict x',
      'CREATE FUNCTION public.f() RETURNS trigger LANGUAGE plpgsql AS $$',
      'BEGIN',
      '  RAISE EXCEPTION \'no; semicolons; here; should; split\';',
      'END;',
      '$$;',
      'CREATE TABLE public.after_function (id text);',
      '\\unrestrict x',
    ].join('\n');
    const statements = prepareSchemaStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('CREATE FUNCTION');
    expect(statements[1]).toContain('CREATE TABLE public.after_function');
  });
});
