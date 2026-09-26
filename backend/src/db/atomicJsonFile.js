// backend/src/db/atomicJsonFile.js
// ─────────────────────────────────────────────────────────────
// Phase 2C-1 — the one shared "write a small JSON config file durably" mechanism, used by
// both restoreState.js and databaseIdentity.js so the two files persist under the exact same
// crash-safety contract instead of each reimplementing it. Every fs dependency is injectable
// (same convention as postgresProvisioning.js/bootstrapDatabase.js's own `io` parameter) so
// callers' tests never touch the real filesystem beyond an explicit temp directory.
//
// Atomicity: write the full content to a throwaway sibling file, then rename it onto the real
// path. A process that dies between those two steps leaves either the OLD complete file or the
// NEW complete file at the real path — never a half-written one. fs.renameSync replaces an
// existing destination on Windows too (libuv's uv_fs_rename uses MoveFileExW with
// MOVEFILE_REPLACE_EXISTING), so this works identically on the real target platform, not just
// on POSIX.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export function writeJsonFileAtomic(filePath, data, {
  writeFileSync = fs.writeFileSync,
  renameSync = fs.renameSync,
  mkdirSync = fs.mkdirSync,
  randomBytes = crypto.randomBytes,
} = {}) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmpPath, filePath);
}

// readJsonFileOrNull: null means "the file genuinely does not exist yet" — the expected, safe
// default for every caller of this helper (a fresh install, or a first-ever restore attempt).
// A file that EXISTS but fails to parse is deliberately never folded into that same "null"
// result — that would hide real, on-disk corruption behind the identical signal as "nothing
// has happened yet." `onCorrupt(err)` lets each caller throw its own typed, reason-carrying
// error for that case (e.g. RestoreStateError('corrupt_state', ...)) instead.
export function readJsonFileOrNull(filePath, {
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
  onCorrupt,
} = {}) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (onCorrupt) throw onCorrupt(err);
    throw err;
  }
}
