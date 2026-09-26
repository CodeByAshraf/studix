// backend/src/db/atomicJsonFile.test.js
// Phase 2C-1 — unit tests for the shared atomic-write helper used by restoreState.js and
// databaseIdentity.js. Every test uses a real temp directory (fs.mkdtempSync) — no fs mocking
// for the happy paths, so the actual OS rename semantics are what's being proven.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeJsonFileAtomic, readJsonFileOrNull } from './atomicJsonFile.js';

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'studix-atomicjson-test-'));
}

describe('writeJsonFileAtomic', () => {
  it('creates the parent directory and writes valid, re-readable JSON', () => {
    const tmpDir = mkTmpDir();
    const filePath = path.join(tmpDir, 'nested', 'dir', 'state.json');

    writeJsonFileAtomic(filePath, { hello: 'world' });

    expect(fs.existsSync(filePath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ hello: 'world' });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('leaves no leftover temp file behind after a successful write', () => {
    const tmpDir = mkTmpDir();
    const filePath = path.join(tmpDir, 'state.json');

    writeJsonFileAtomic(filePath, { a: 1 });

    const entries = fs.readdirSync(tmpDir);
    expect(entries).toEqual(['state.json']);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('overwrites an existing file completely (real rename-replace, not a merge)', () => {
    const tmpDir = mkTmpDir();
    const filePath = path.join(tmpDir, 'state.json');

    writeJsonFileAtomic(filePath, { version: 1, onlyInFirst: true });
    writeJsonFileAtomic(filePath, { version: 2 });

    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ version: 2 });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('a failure while writing the temp file never touches the existing destination file', () => {
    const tmpDir = mkTmpDir();
    const filePath = path.join(tmpDir, 'state.json');
    writeJsonFileAtomic(filePath, { safe: 'original' });

    const failingWriteFileSync = () => { throw new Error('simulated disk failure'); };
    expect(() => writeJsonFileAtomic(filePath, { unsafe: 'new' }, { writeFileSync: failingWriteFileSync }))
      .toThrow('simulated disk failure');

    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ safe: 'original' });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('readJsonFileOrNull', () => {
  it('returns null for a missing file (the safe, expected default)', () => {
    const tmpDir = mkTmpDir();
    const filePath = path.join(tmpDir, 'does-not-exist.json');

    expect(readJsonFileOrNull(filePath)).toBeNull();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses an existing valid file', () => {
    const tmpDir = mkTmpDir();
    const filePath = path.join(tmpDir, 'state.json');
    writeJsonFileAtomic(filePath, { x: 42 });

    expect(readJsonFileOrNull(filePath)).toEqual({ x: 42 });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws the default parse error for a corrupt file when no onCorrupt is given', () => {
    const tmpDir = mkTmpDir();
    const filePath = path.join(tmpDir, 'state.json');
    fs.writeFileSync(filePath, '{ not valid json', 'utf8');

    expect(() => readJsonFileOrNull(filePath)).toThrow();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws the caller-supplied typed error via onCorrupt for a corrupt file', () => {
    const tmpDir = mkTmpDir();
    const filePath = path.join(tmpDir, 'state.json');
    fs.writeFileSync(filePath, 'not json at all', 'utf8');

    class MyError extends Error { constructor(msg) { super(msg); this.reason = 'custom'; } }
    expect(() => readJsonFileOrNull(filePath, { onCorrupt: () => new MyError('bad') })).toThrow(MyError);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
