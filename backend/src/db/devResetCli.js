// backend/src/db/devResetCli.js
// ─────────────────────────────────────────────────────────────
// Developer Data Reset — STEP 3: the interactive CLI flow (`npm run dev:reset`, entrypoint
// backend/scripts/devReset.js). This module only orchestrates user interaction and safety
// checks; the destructive work is entirely the existing, already-verified services:
//   - db/devResetBackup.js runDevResetWithVerifiedBackup (step 2): both locks → verified
//     pre-reset backup → db/devReset.js performDevReset (step 1: one TRUNCATE transaction,
//     auth_version +1 for every user, audit entry)
//   - db/databaseIdentity.js generateDatabaseIdentity + promoteActiveDatabaseIdentity: the same
//     rotation databaseSwitch.js performs after a verified switch — run only AFTER the reset
//     transaction has committed, so browsers drop their stale 'studix-v1' snapshot through the
//     existing frontend identity check.
//
// It reads configuration ONLY from the `env` object it is handed (the entrypoint passes
// process.env after lib/config.js loaded it), so tests never depend on a developer's .env.
//
// Safety gates, all fail-closed, in order — nothing is backed up or reset unless every one passes:
//   1. the exact typed phrase RESET STUDIX DATA (no flag or env var can supply it)
//   2. not production: lib/config.js's configSource.mode must be 'development' and NODE_ENV must
//      not be 'production'
//   3. explicit developer opt-in: STUDIX_DEV_TOOLS=1
//   4. DATABASE_URL present, and STUDIX_DEV_RESET_DATABASE (the database the developer means to
//      reset) set and equal to the database DATABASE_URL names
//   5. every path the flow writes is usable — backup dir (STUDIX_BACKUP_DIR), restore lock
//      (STUDIX_RESTORE_LOCK_PATH), database identity (STUDIX_DB_IDENTITY_PATH) — proven with a
//      real probe-file write, not an access() check (on Windows access() ignores NTFS ACLs);
//      an existing identity file must be valid
//   6. the connected database really is that database (current_database())
//   7. no other client is connected to it — the running backend always holds a Prisma
//      connection, and its in-memory auth cache (lib/authCache.js) would otherwise keep old
//      sessions alive after the auth_version bump. Checked read-only through pg_stat_activity
//      (the same catalog databaseSwitch.js uses, which terminates such sessions — this never
//      does). The CLI's own client is limited to one connection, so every OTHER client backend
//      counts. Limitation: this detects a backend that is connected to THIS database; it cannot
//      see a process that has not connected yet — start the backend only after the reset.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import process from 'process';
import { URL } from 'url';
import { getBackupDir } from './backup.js';
import { resolveRestoreLockPath } from './restoreLock.js';
import { resolveBackupLockPath } from './routineBackup.js';
import {
  resolveDatabaseIdentityPath, readActiveDatabaseIdentity, generateDatabaseIdentity, promoteActiveDatabaseIdentity,
} from './databaseIdentity.js';
import { runDevResetWithVerifiedBackup, createVerifiedPreResetBackup, resolveDevResetBackupDir } from './devResetBackup.js';
import { performDevReset, RESET_CONFIRMATION_PHRASE, RESET_TABLES, PRESERVE_TABLES } from './devReset.js';

export const EXIT = Object.freeze({ success: 0, refused: 1, resetFailed: 1, postResetFailed: 2 });
export const BROWSER_STATE_KEYS = Object.freeze(['studix-v1', 'studix_autobackup', 'studix-db-identity']);

// Scrub anything that could carry credentials before it is printed.
const CONNECTION_STRING_RE = /postgres(?:ql)?:\/\/[^\s"')]+/gi;
export function redact(message, secrets = []) {
  let out = String(message ?? '').replace(CONNECTION_STRING_RE, 'postgresql://[REDACTED]');
  for (const s of secrets) if (s && s.length >= 3) out = out.split(s).join('[REDACTED]');
  return out;
}

function parseDatabaseUrl(databaseUrl) {
  try {
    const u = new URL(databaseUrl);
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
    return {
      databaseName: decodeURIComponent(u.pathname.replace(/^\//, '')),
      host: u.hostname,
      port: u.port || '5432',
      password: decodeURIComponent(u.password || ''),
    };
  } catch {
    return null;
  }
}

// The CLI's own Prisma client: exactly one connection, so "any other client backend on this
// database" is a reliable "someone else is connected" signal.
function withSingleConnection(databaseUrl) {
  const u = new URL(databaseUrl);
  u.searchParams.set('connection_limit', '1');
  return u.toString();
}

async function defaultCreatePrisma(databaseUrl) {
  const { PrismaClient } = await import('@prisma/client');
  return new PrismaClient({ datasources: { db: { url: withSingleConnection(databaseUrl) } } });
}

// A real write+delete of a probe file (created exclusively) — the only reliable writability
// test on Windows, where fs.access(W_OK) does not consult NTFS ACLs.
export function probeWritableDir(dir, { fsImpl = fs, pid = process.pid } = {}) {
  fsImpl.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.studix-dev-reset-probe-${pid}`);
  fsImpl.writeFileSync(probe, 'probe', { flag: 'wx' });
  fsImpl.unlinkSync(probe);
}

class Refusal extends Error {}

/**
 * Runs the interactive developer reset. Returns a process exit code (EXIT.*); never throws.
 * @param {{
 *   env: object,                         // configuration source (process.env in the entrypoint)
 *   configMode: 'development'|'production',   // lib/config.js configSource.mode
 *   prompt: (question: string) => Promise<string>,
 *   print?: (line: string) => void,
 *   deps?: object,                       // injectable collaborators (tests)
 * }} opts
 */
export async function runDevResetCli({
  env, configMode, prompt, print = (line) => process.stdout.write(`${line}\n`), deps = {},
}) {
  const {
    createPrisma = defaultCreatePrisma,
    runResetFn = runDevResetWithVerifiedBackup,
    createBackupFn = createVerifiedPreResetBackup,
    performResetFn = performDevReset,
    readIdentityFn = readActiveDatabaseIdentity,
    generateIdentityFn = generateDatabaseIdentity,
    promoteIdentityFn = promoteActiveDatabaseIdentity,
    probeWritableDirFn = probeWritableDir,
  } = deps;

  const databaseUrl = env.DATABASE_URL;
  const target = parseDatabaseUrl(databaseUrl || '');
  const secrets = [databaseUrl, target?.password].filter(Boolean);
  const say = (line = '') => print(redact(line, secrets));
  const ok = (line) => say(`✓ ${line}`);
  const refuse = (line) => { throw new Refusal(line); };

  say('Studix Developer Reset');
  say('');
  say('WARNING:');
  say(`This will remove ALL developer/test data from the target database (${RESET_TABLES.length} tables: students, groups,`);
  say('enrollments, attendance, exams, homework, materials, admissions, communications, payments, treasury, activity log).');
  say(`Preserved: ${PRESERVE_TABLES.join(', ')} — users, roles, licensing,`);
  say('installation identity and configuration stay as they are. Every user will have to sign in again.');
  say('A verified pre-reset backup is created first. The reset cannot be undone directly —');
  say('only by restoring that backup.');
  say('');
  say('Type exactly:');
  say(RESET_CONFIRMATION_PHRASE);
  say('');

  let prisma = null;
  try {
    const answer = String((await prompt('> ')) ?? '').replace(/\r?\n$/, '');
    if (answer !== RESET_CONFIRMATION_PHRASE) {
      refuse('Confirmation phrase did not match. Nothing was changed.');
    }

    say('');
    say('Checking developer environment...');
    if (configMode !== 'development' || env.NODE_ENV === 'production') {
      refuse('This is a production installation (installed configuration or NODE_ENV=production). The developer reset is not available.');
    }
    if (env.STUDIX_DEV_TOOLS !== '1') {
      refuse('Developer tools are not enabled. Set STUDIX_DEV_TOOLS=1 in backend/.env on a developer machine only.');
    }
    if (!databaseUrl || !target || !target.databaseName) {
      refuse('DATABASE_URL is missing or is not a valid PostgreSQL URL.');
    }
    const expectedDatabaseName = env.STUDIX_DEV_RESET_DATABASE;
    if (typeof expectedDatabaseName !== 'string' || !expectedDatabaseName.trim()) {
      refuse('STUDIX_DEV_RESET_DATABASE is not set. Set it to the name of the developer database you intend to reset.');
    }
    if (target.databaseName !== expectedDatabaseName) {
      refuse(`DATABASE_URL targets database "${target.databaseName}", not the expected developer database "${expectedDatabaseName}".`);
    }

    const backupDir = env.STUDIX_BACKUP_DIR || getBackupDir();
    const restoreLockPath = env.STUDIX_RESTORE_LOCK_PATH || resolveRestoreLockPath();
    const identityPath = env.STUDIX_DB_IDENTITY_PATH || resolveDatabaseIdentityPath();
    const backupLockPath = resolveBackupLockPath(backupDir);
    for (const [label, dir] of [
      ['backup directory (STUDIX_BACKUP_DIR)', resolveDevResetBackupDir(backupDir)],
      ['restore lock directory (STUDIX_RESTORE_LOCK_PATH)', path.dirname(restoreLockPath)],
      ['database identity directory (STUDIX_DB_IDENTITY_PATH)', path.dirname(identityPath)],
    ]) {
      try {
        probeWritableDirFn(dir);
      } catch (err) {
        refuse(`The ${label} is not writable: ${dir} (${err.code || err.message}). Point it at a writable developer folder.`);
      }
    }
    let previousIdentity;
    try {
      previousIdentity = readIdentityFn({ configPath: identityPath });
    } catch (err) {
      refuse(`The database identity file is unreadable or invalid (${identityPath}): ${err.message}`);
    }
    ok('Backup configuration verified');

    prisma = await createPrisma(databaseUrl);
    const [{ current_database: connectedName }] = await prisma.$queryRawUnsafe('SELECT current_database()');
    if (connectedName !== expectedDatabaseName) {
      refuse(`Connected to database "${connectedName}", not the expected developer database "${expectedDatabaseName}".`);
    }
    ok(`Database identity verified (${expectedDatabaseName} on ${target.host}:${target.port})`);

    const [{ n: otherSessions }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'`);
    if (otherSessions > 0) {
      refuse(`${otherSessions} other client connection(s) are open on "${expectedDatabaseName}" — the Studix backend (or another tool) is running. Stop the backend and close other database tools, then run the reset again. Nothing was changed.`);
    }
    ok('Backend is stopped (no other connections to the database)');

    say('');
    let result;
    try {
      result = await runResetFn({
        prisma,
        databaseUrl,
        expectedDatabaseName,
        confirmation: answer,
        actor: null,
        backupDir,
        restoreLockPath,
        backupLockPath,
        createBackupFn: (opts) => {
          say('Creating pre-reset backup...');
          const backup = createBackupFn(opts);
          ok(`Backup created and verified: ${backup.path}`);
          say('');
          say('Resetting developer data...');
          return backup;
        },
        performResetFn,
      });
    } catch (err) {
      say('');
      say(`✗ Developer reset failed: ${err.message}`);
      say(err.code === 'lock_unavailable' || err.code === 'backup_dir_unavailable' || err.code === 'pg_dump_failed'
          || err.code === 'backup_verification_failed' || err.code === 'backup_publish_failed'
        ? 'The reset did not start. No data was changed.'
        : 'The reset transaction was rolled back. No data was changed.');
      return EXIT.resetFailed;
    }
    const deleted = Object.values(result.reset.deletedCounts).reduce((a, b) => a + b, 0);
    ok(`Database reset completed (${deleted} rows removed, ${result.reset.usersInvalidated} user session(s) invalidated)`);
    if (result.lockReleaseErrors?.length) {
      say(`! Warning: could not release lock(s): ${result.lockReleaseErrors.map((e) => e.lock).join(', ')} — remove them manually if they remain.`);
    }

    say('');
    say('Rotating database identity...');
    try {
      promoteIdentityFn({ configPath: identityPath, identity: generateIdentityFn({ role: 'active' }) });
    } catch (err) {
      say(`✗ Database identity rotation FAILED: ${err.message}`);
      say('The database reset HAS been committed and the backup is kept, but browsers will not be told');
      say(`that the data changed. Fix ${identityPath}, and clear the browser state below manually.`);
      printNextSteps(say);
      return EXIT.postResetFailed;
    }
    ok(`Database identity rotated${previousIdentity ? '' : ' (no previous identity existed)'}`);

    say('');
    say('Developer reset completed successfully.');
    printNextSteps(say);
    return EXIT.success;
  } catch (err) {
    say('');
    if (err instanceof Refusal) {
      say(`✗ Refused: ${err.message}`);
    } else {
      say(`✗ Developer reset stopped before any change: ${err.message}`);
    }
    return EXIT.refused;
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {});
  }
}

function printNextSteps(say) {
  say('');
  say('Next:');
  say('1. Start the Studix backend.');
  say('2. Clear the browser developer state (keep theme/report settings):');
  for (const key of BROWSER_STATE_KEYS) say(`   - ${key}`);
  say('3. Open Studix and sign in again.');
}
