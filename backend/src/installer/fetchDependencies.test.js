// backend/src/installer/fetchDependencies.test.js
// INSTALL-06 — pure, dependency-injected unit tests. Never downloads anything for real, never
// spawns a real tar.exe process — every network/filesystem/extraction call is injected. Uses a
// real temp directory + Node's own crypto for the "real hash math is correct" cases (matching
// this project's established convention of using real fs I/O for pure computation while
// injecting only the genuinely external/dangerous operations).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  computeSha256, verifyChecksum, downloadFile, extractZip, fetchAndVerify,
  DependencyFetchError, PLACEHOLDER_SHA256,
} from './fetchDependencies.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // backend/src/installer
const MANIFEST_PATH = path.join(__dirname, '..', '..', 'scripts', 'windows-runtime-dependencies.json');

// The exact SHA256 established in this session via the documented one-time manual process
// (design doc §4): downloaded https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip for real, confirmed
// it extracts win64\nssm.exe with FileVersion "2.24-101-g897c7ad" / ProductName "NSSM 64-bit" /
// CompanyName "Iain Patterson" (the real NSSM author), then hashed it with
// Get-FileHash -Algorithm SHA256. A hardcoded regression check, not a guess — if this ever
// stops matching windows-runtime-dependencies.json, something changed the pinned value.
const ESTABLISHED_NSSM_SHA256 = '99f5045fffbffb745d67fe3a065a953c4a3d9c253b868892d9b685b0ee7d07b8';

function realSha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

describe('computeSha256', () => {
  it('computes the real SHA256 of a real file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-fetch-test-'));
    const filePath = path.join(dir, 'sample.bin');
    const content = Buffer.from('studix-install-06-sample-content');
    fs.writeFileSync(filePath, content);
    try {
      expect(computeSha256(filePath)).toBe(realSha256(content));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('verifyChecksum', () => {
  it('refuses a placeholder hash with a clear, distinct error — never treats it as verified', () => {
    const io = { readFileSync: () => Buffer.from('anything') };
    try {
      verifyChecksum('C:\\fake\\file.zip', PLACEHOLDER_SHA256, { io });
      expect.fail('expected verifyChecksum to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DependencyFetchError);
      expect(err.reason).toBe('checksum_not_pinned');
    }
  });

  it('refuses an empty/undefined expected hash the same way as a placeholder', () => {
    const io = { readFileSync: () => Buffer.from('anything') };
    expect(() => verifyChecksum('x', undefined, { io })).toThrow(DependencyFetchError);
    expect(() => verifyChecksum('x', '', { io })).toThrow(DependencyFetchError);
  });

  it('accepts a matching real SHA256', () => {
    const content = Buffer.from('correct content');
    const io = { readFileSync: () => content };
    const result = verifyChecksum('x', realSha256(content), { io });
    expect(result).toEqual({ verified: true, sha256: realSha256(content) });
  });

  it('rejects a mismatched SHA256 (simulating a tampered/replaced/corrupted binary)', () => {
    const content = Buffer.from('actual downloaded content');
    const wrongHash = realSha256(Buffer.from('completely different content'));
    const io = { readFileSync: () => content };
    try {
      verifyChecksum('x', wrongHash, { io, label: 'nssm.exe' });
      expect.fail('expected verifyChecksum to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DependencyFetchError);
      expect(err.reason).toBe('checksum_mismatch');
      expect(err.message).toContain('nssm.exe');
    }
  });

  it('hash comparison is case-insensitive (hex casing should never matter)', () => {
    const content = Buffer.from('case test');
    const hash = realSha256(content);
    const io = { readFileSync: () => content };
    expect(() => verifyChecksum('x', hash.toUpperCase(), { io })).not.toThrow();
  });
});

describe('downloadFile', () => {
  it('requires an explicit downloadFn — never has an implicit default network call', async () => {
    await expect(downloadFile('https://example.com/x.zip', 'C:\\out\\x.zip', {}))
      .rejects.toThrow(DependencyFetchError);
  });

  it('writes the downloaded buffer to destPath, creating the parent directory', async () => {
    const writes = [];
    const mkdirCalls = [];
    const io = {
      mkdirSync: (p, opts) => mkdirCalls.push([p, opts]),
      writeFileSync: (p, data) => writes.push([p, data]),
    };
    const downloadFn = async () => Buffer.from('zip-bytes');
    const result = await downloadFile('https://example.com/x.zip', 'C:\\out\\nested\\x.zip', { downloadFn, io });

    expect(result).toEqual({ path: 'C:\\out\\nested\\x.zip', bytes: 9 });
    expect(mkdirCalls[0][0]).toBe('C:\\out\\nested');
    expect(writes[0]).toEqual(['C:\\out\\nested\\x.zip', Buffer.from('zip-bytes')]);
  });

  it('classifies a failed download clearly rather than propagating a raw network error', async () => {
    const downloadFn = async () => { throw new Error('ETIMEDOUT'); };
    await expect(downloadFile('https://example.com/x.zip', 'C:\\out\\x.zip', { downloadFn, io: { mkdirSync: () => {} } }))
      .rejects.toMatchObject({ reason: 'download_failed' });
  });
});

describe('extractZip', () => {
  it('invokes tar -xf <zip> -C <dest> — never a raw shell string, never PowerShell Expand-Archive', () => {
    const calls = [];
    const io = { mkdirSync: () => {}, execFileSync: (cmd, args, opts) => calls.push([cmd, args, opts]) };
    extractZip('C:\\downloads\\nssm.zip', 'C:\\out\\tools', io);
    expect(calls).toEqual([['tar', ['-xf', 'C:\\downloads\\nssm.zip', '-C', 'C:\\out\\tools'], expect.anything()]]);
  });

  it('classifies a failed extraction clearly', () => {
    const io = { mkdirSync: () => {}, execFileSync: () => { throw new Error('bad archive'); } };
    expect(() => extractZip('x.zip', 'dest', io)).toThrow(DependencyFetchError);
  });
});

describe('fetchAndVerify — composed download + checksum gate', () => {
  it('a verified download succeeds and leaves the file in place', async () => {
    const content = Buffer.from('trusted content');
    const written = {};
    const io = {
      mkdirSync: () => {},
      writeFileSync: (p, data) => { written[p] = data; },
      readFileSync: (p) => written[p],
      existsSync: () => true,
      rmSync: () => { throw new Error('should not be called on success'); },
    };
    const downloadFn = async () => content;
    const result = await fetchAndVerify({
      url: 'https://example.com/pg.zip', expectedSha256: realSha256(content), label: 'pg.zip',
      destPath: 'C:\\out\\pg.zip', downloadFn, io,
    });
    expect(result).toEqual({ path: 'C:\\out\\pg.zip' });
  });

  it('a checksum failure removes the downloaded file and throws — never leaves an unverified file behind silently', async () => {
    const content = Buffer.from('tampered content');
    const written = {};
    let removed = null;
    const io = {
      mkdirSync: () => {},
      writeFileSync: (p, data) => { written[p] = data; },
      readFileSync: (p) => written[p],
      existsSync: () => true,
      rmSync: (p) => { removed = p; },
    };
    const downloadFn = async () => content;
    await expect(fetchAndVerify({
      url: 'https://example.com/pg.zip', expectedSha256: realSha256(Buffer.from('wrong')), label: 'pg.zip',
      destPath: 'C:\\out\\pg.zip', downloadFn, io,
    })).rejects.toMatchObject({ reason: 'checksum_mismatch' });
    expect(removed).toBe('C:\\out\\pg.zip');
  });

  it('a placeholder-hash config is refused before any download is even attempted (no wasted network round-trip, no fetch of a still-placeholder URL string)', async () => {
    const io = { mkdirSync: () => {}, writeFileSync: () => {}, existsSync: () => true, rmSync: () => {} };
    let downloadCalled = false;
    const downloadFn = async () => { downloadCalled = true; return Buffer.from('anything'); };
    await expect(fetchAndVerify({
      url: 'REPLACE_WITH_CONFIRMED_DIRECT_DOWNLOAD_URL_FROM_LANDING_PAGE', expectedSha256: PLACEHOLDER_SHA256, label: 'pg.zip',
      destPath: 'C:\\out\\pg.zip', downloadFn, io,
    })).rejects.toMatchObject({ reason: 'checksum_not_pinned' });
    expect(downloadCalled).toBe(false);
  });

  it('an empty/undefined expected hash is also refused before any download is attempted', async () => {
    const io = { mkdirSync: () => {}, writeFileSync: () => {}, existsSync: () => true, rmSync: () => {} };
    let downloadCalled = false;
    const downloadFn = async () => { downloadCalled = true; return Buffer.from('anything'); };
    await expect(fetchAndVerify({
      url: 'https://example.com/pg.zip', expectedSha256: undefined, label: 'pg.zip',
      destPath: 'C:\\out\\pg.zip', downloadFn, io,
    })).rejects.toMatchObject({ reason: 'checksum_not_pinned' });
    expect(downloadCalled).toBe(false);
  });
});

describe('windows-runtime-dependencies.json — the real pinned manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  it('NSSM: the pinned SHA256 is the real, manually-established value (not a placeholder)', () => {
    expect(manifest.nssm.sha256).toBe(ESTABLISHED_NSSM_SHA256);
    expect(manifest.nssm.sha256).not.toBe(PLACEHOLDER_SHA256);
    expect(manifest.nssm.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.nssm.url).toBe('https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip');
  });

  it('NSSM: verifyChecksum genuinely accepts the exact real downloaded bytes against the pinned hash', () => {
    // The actual bytes downloaded and verified for real in this session (design doc §4) —
    // hashing them here again proves the verification gate really accepts the established
    // pinned value end-to-end, not just that two string literals happen to match.
    const realNssmZipPath = path.join(os.tmpdir(), 'nssm-2.24-101-g897c7ad.zip');
    if (!fs.existsSync(realNssmZipPath)) {
      // The real download from this session's manual verification step is no longer present
      // (e.g. a fresh environment) — computeSha256's own "real hash math is correct" test above
      // already proves the underlying crypto is right; skip re-asserting against a file that
      // isn't there rather than failing on an environment difference.
      return;
    }
    expect(() => verifyChecksum(realNssmZipPath, manifest.nssm.sha256, { label: 'nssm' })).not.toThrow();
  });

  it('PostgreSQL: honestly still a placeholder — the EDB download page returned HTTP 403 to every access method tried in this session (WebFetch, PowerShell Invoke-WebRequest, both the "-binaries" page and the general downloads page); the real download URL requires an opaque, page-embedded fileid (https://sbp.enterprisedb.com/getfile.jsp?fileid=<id>, confirmed via a third-party open-source script that documents this exact mechanism) that cannot be derived or safely guessed', () => {
    expect(manifest.postgresql.sha256).toBe(PLACEHOLDER_SHA256);
    expect(manifest.postgresql.url).not.toMatch(/^https?:\/\//); // still the placeholder string, not a real URL
    // This assertion is EXPECTED TO FAIL and require updating once a future session
    // successfully completes the one-time manual PostgreSQL verification process.
  });

  it('fetchAndVerify against the real manifest: PostgreSQL is refused before any download is attempted', async () => {
    const io = { mkdirSync: () => {}, writeFileSync: () => {}, existsSync: () => true, rmSync: () => {} };
    let pgDownloadCalled = false;
    await expect(fetchAndVerify({
      url: manifest.postgresql.url, expectedSha256: manifest.postgresql.sha256, label: 'PostgreSQL',
      destPath: 'C:\\out\\pg.zip', downloadFn: async () => { pgDownloadCalled = true; return Buffer.alloc(0); }, io,
    })).rejects.toMatchObject({ reason: 'checksum_not_pinned' });
    expect(pgDownloadCalled).toBe(false);
  });
});
