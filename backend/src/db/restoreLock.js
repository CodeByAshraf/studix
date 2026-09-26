// backend/src/db/restoreLock.js
// ─────────────────────────────────────────────────────────────
// Phase 2C-3C Part 1 — closes a real race the Phase 2C-3C audit identified: restoreState.js's
// transitionRestoreState() is a plain read-then-write with no concurrency protection, so two
// processes racing to call performDatabaseSwitch()/performRollback() at the exact moment state
// is 'verified' could both read 'verified' before either writes 'switching'. This file adds a
// minimal, file-based, process-boundary-surviving lock — NOT an in-memory mutex (this repo's own
// convention throughout restoreState.js/databaseIdentity.js is deliberately no module-level
// mutable state, for exactly the same crash-safety reason: nothing in memory to lose or that a
// second, freshly-started process could fail to see).
//
// Same %ProgramData%\Studix\config\ directory as restore-state.json/admin.env/db-identity.json —
// already covered by the existing installer ACL, no installer change needed.
//
// Deliberately does NOT touch restoreState.js's own transition rules or file — this is a
// SEPARATE file or the whole operation acquires before calling
// performDatabaseSwitch()/performRollback() and releases afterward (see databaseSwitch.js's own
// CLI entry point). restoreState.js is unmodified except for one new self-loop transition edge
// (ALLOWED_TRANSITIONS.verified) added for the unrelated failure-recording work in this same
// phase slice — nothing here depends on that change.
//
// Atomicity: acquisition uses fs.writeFileSync's own 'wx' flag (O_CREAT|O_EXCL) — a single,
// atomic "create only if it does not already exist" syscall, identical semantics on POSIX and
// Windows (both reject with EEXIST if the file is already there; no separate exists-check +
// write race is possible, unlike atomicJsonFile.js's write-then-rename, which is atomic for
// REPLACING a file but not for excluding a concurrent creator).
//
// Staleness: the ONE deterministic rule this module uses — never a guessed timeout — is "is the
// pid recorded in the lock file still alive?" (process.kill(pid, 0), which works identically on
// Windows for an existence check; documented Node.js behavior, not this module's own invention).
// A lock whose pid is genuinely gone is safely reclaimed (deleted, then re-acquired atomically);
// a lock whose pid is still alive is reported as held, never silently stolen. A lock file that
// exists but fails to parse or fails shape validation is treated exactly like restoreState.js's
// own corrupt-state handling: refused outright, never guessed at — "corrupt" and "held by a live
// process" are never conflated with each other or with "stale."
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';

export class RestoreLockError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

export function resolveRestoreLockPath() {
  if (process.env.STUDIX_RESTORE_LOCK_PATH) return process.env.STUDIX_RESTORE_LOCK_PATH;
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  return path.join(programData, 'Studix', 'config', 'restore-state.lock');
}

function isValidLockShape(obj) {
  return !!obj && typeof obj === 'object'
    && Number.isInteger(obj.pid)
    && typeof obj.acquiredAt === 'string' && obj.acquiredAt.length > 0;
}

// defaultIsProcessAlive: process.kill(pid, 0) sends no actual signal — it only asks the OS
// "does this pid exist" (works on Windows too — Node documents this exact use). ESRCH means
// genuinely gone (stale); EPERM means it exists but this process lacks permission to signal it
// (still alive — never treated as stale just because we can't reach it).
function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function readLockOrThrowCorrupt(configPath, { readFileSync }) {
  let raw;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (err) {
    throw new RestoreLockError('lock_read_failed', `القفل موجود لكن تعذّرت قراءته: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RestoreLockError(
      'corrupt_lock',
      `ملف القفل عند ${configPath} موجود لكن محتواه JSON غير صالح — تم الرفض بدل الافتراض أنه آمن لتخطّيه أو حذفه.`
    );
  }
  if (!isValidLockShape(parsed)) {
    throw new RestoreLockError(
      'corrupt_lock',
      `ملف القفل عند ${configPath} موجود لكن شكله غير صالح (pid/acquiredAt مفقودان أو من نوع خاطئ) — تم الرفض.`
    );
  }
  return parsed;
}

/**
 * acquireRestoreLock: atomic create-only-if-absent. Returns { acquired: true, stolenFromStalePid }
 * on success (stolenFromStalePid is null on a clean first acquisition, or the dead pid it
 * reclaimed from). Throws RestoreLockError('lock_held', ...) if a live process already holds it —
 * NEVER silently overwrites another active restore's lock.
 */
export function acquireRestoreLock({
  configPath = resolveRestoreLockPath(),
  pid = process.pid,
  now = () => new Date().toISOString(),
  writeFileSync = fs.writeFileSync,
  readFileSync = fs.readFileSync,
  unlinkSync = fs.unlinkSync,
  mkdirSync = fs.mkdirSync,
  isProcessAlive = defaultIsProcessAlive,
} = {}) {
  mkdirSync(path.dirname(configPath), { recursive: true });
  const payload = `${JSON.stringify({ pid, acquiredAt: now() }, null, 2)}\n`;

  try {
    writeFileSync(configPath, payload, { encoding: 'utf8', flag: 'wx' });
    return { acquired: true, stolenFromStalePid: null };
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw new RestoreLockError('lock_write_failed', `تعذّرت كتابة ملف القفل عند ${configPath}: ${err.message}`);
    }
  }

  // Lock already exists — the ONE deterministic staleness rule, never a guessed timeout.
  const existing = readLockOrThrowCorrupt(configPath, { readFileSync });
  if (isProcessAlive(existing.pid)) {
    throw new RestoreLockError(
      'lock_held',
      `عملية استعادة أخرى (pid=${existing.pid}) تملك القفل بالفعل منذ ${existing.acquiredAt} — تم الرفض بدل الكتابة فوقها.`
    );
  }

  // Stale — the recorded pid is genuinely gone. Reclaim: delete, then re-acquire atomically.
  try {
    unlinkSync(configPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new RestoreLockError('stale_lock_cleanup_failed', `تعذّر حذف القفل المنتهي عند ${configPath}: ${err.message}`);
    }
  }
  try {
    writeFileSync(configPath, payload, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    // Another process won the race for the just-freed slot — fail rather than silently
    // overwrite whatever it just wrote.
    throw new RestoreLockError(
      'lock_held',
      `قفل آخر استولى على العملية أثناء تنظيف القفل المنتهي (${err.message}) — تم الرفض.`
    );
  }
  return { acquired: true, stolenFromStalePid: existing.pid };
}

/**
 * releaseRestoreLock: only ever removes a lock this exact pid owns — never another active
 * restore's lock. Missing lock (already released, or never acquired) is a safe no-op, never an
 * error — mirrors readRestoreState's own "missing is the safe/expected case" convention.
 */
export function releaseRestoreLock({
  configPath = resolveRestoreLockPath(),
  pid = process.pid,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
  unlinkSync = fs.unlinkSync,
} = {}) {
  if (!existsSync(configPath)) {
    return { released: false, reason: 'not_locked' };
  }
  const existing = readLockOrThrowCorrupt(configPath, { readFileSync });
  if (existing.pid !== pid) {
    throw new RestoreLockError(
      'not_lock_owner',
      `القفل عند ${configPath} مملوك لعملية أخرى (pid=${existing.pid}) — رُفض تحريره من عملية pid=${pid}.`
    );
  }
  unlinkSync(configPath);
  return { released: true };
}
