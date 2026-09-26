// backend/src/db/databaseSwitch.js
// ─────────────────────────────────────────────────────────────
// Phase 2C-3B — the real database switch/rollback mechanism designed (read-only, no code) in
// Phase 2C-3A. This file performs the ONE thing Phase 2C-2 explicitly deferred: promoting a
// verified candidate database to become the production database, and reversing that promotion
// on failure. Strategy A from the approved design — rename current production DB to an
// archival name, then rename the candidate to the production name — chosen because it is the
// only strategy that never rewrites admin.env or the runtime .env (both already hardcode the
// production database's literal name; renaming makes that name refer to different physical
// data instead of ever changing what name the config files point at).
//
// OD3 — reuses restoreDatabase.js's readAdminCredential()/assertSafeDatabaseIdentifier()/
// assertSafeCandidateDatabaseName() and provisioningAdminConfig.js's own file format UNMODIFIED.
// This module opens the admin connection itself (it IS part of the same elevated,
// short-lived-process family as restoreDatabase.js — see that file's own header for the
// process-boundary contract) — server.js/lib/config.js have no import path to this file either.
//
// Every step below is individually idempotent and ground-truth-checked (never trusts
// restoreState.js's own recorded checkpoint alone — always re-queries pg_database/service state
// before deciding whether an action already happened), per Phase 2C-3A §4's explicit crash-
// safety requirement. Calling performDatabaseSwitch()/performRollback() again after a crash
// simply resumes from whatever ground truth shows, never repeats a completed step, and never
// guesses.
//
// simulateCrashAfter (test-only fault injection): both orchestrators accept an optional
// `simulateCrashAfter` checkpoint name. If given, the process throws SimulatedCrashError
// immediately after persisting that exact checkpoint — before the NEXT step's action ever
// runs — deterministically reproducing "the process died right here" for crash-recovery
// testing. Never used in production wiring (no caller passes it there); the checkpoint is
// always fully persisted before the throw, exactly matching what a real crash would leave
// behind.
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import {
  assertSafeDatabaseIdentifier, assertSafeCandidateDatabaseName, withDatabaseName,
  readAdminCredential, redactErrorMessage,
} from './restoreDatabase.js';
import { databaseExists, classifySchemaState } from './bootstrapDatabase.js';
import { checkMigrationsUpToDate } from './migrationRunner.js';
import { transitionRestoreState, readRestoreState, SWITCH_STATUSES, ROLLBACK_STATUSES } from './restoreState.js';
import {
  generateDatabaseIdentity, ensureActiveDatabaseIdentity, readActiveDatabaseIdentity,
  promoteActiveDatabaseIdentity,
} from './databaseIdentity.js';
import { acquireRestoreLock, releaseRestoreLock } from './restoreLock.js';
import {
  createRealStopAppFn, createRealStartAppFn, createRealGetAppStatusFn, createRealFetchHealthFn,
} from './switchAdapters.js';

export class DatabaseSwitchError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

export class SimulatedCrashError extends Error {}

const MAX_IDENTIFIER_LENGTH = 63;
const ARCHIVAL_MARKER = '_previous_';

// writeCheckpoint: the one place every restore-state write in this file goes through — wraps
// transitionRestoreState with the optional test-only crash-simulation throw described above.
//
// Post-implementation review fix (F1) — `error: null` is merged into every patch BEFORE the
// caller's own patch (so an explicit patch.error, if any caller ever added one, would still
// win — none do today). writeCheckpoint is used ONLY for legitimate forward-progress writes;
// recordFailureAndRedact() (below) sets a real `error` value by calling transitionRestoreState()
// DIRECTLY, bypassing writeCheckpoint entirely, so this default never interferes with failure
// recording itself. The effect: the moment a retry reaches its NEXT durable checkpoint after an
// earlier failure was recorded (via recordFailureAndRedact's own same-status self-loop write),
// that stale `error` is cleared — a checkpoint that successfully advances IS, by definition, past
// whatever earlier failure produced it. No status/switchStatus/rollbackStatus semantics change.
function writeCheckpoint(nextStatus, patch, stateOpts, simulateCrashAfter) {
  const next = transitionRestoreState(nextStatus, { error: null, ...patch }, stateOpts);
  const checkpointName = patch.switchStatus || patch.rollbackStatus;
  if (simulateCrashAfter && checkpointName === simulateCrashAfter) {
    throw new SimulatedCrashError(`Simulated crash immediately after checkpoint "${checkpointName}" (test-only).`);
  }
  return next;
}

// recordFailureAndRedact: Phase 2C-3C Part 1 — the ONE place a real (non-simulated-crash)
// failure from performDatabaseSwitch()/performRollback() is redacted and durably recorded.
// ALWAYS throws — never returns — so every call site is `recordFailureAndRedact(err, ...)`
// with no separate `throw` needed.
//
// A SimulatedCrashError is passed straight through, completely untouched: it models a REAL
// process crash, which gets no chance to redact or record anything either — intercepting it here
// would corrupt every crash-recovery test/behavior this same file already proves (the whole
// point of a checkpoint-based crash-recovery design is that nothing runs after the crash).
//
// `currentStatus` MUST be a status with a same-status self-loop in restoreState.js's
// ALLOWED_TRANSITIONS ('verified', 'switching', or 'rolling_back' — the three in-flight states)
// so this writes ONLY the `error` field, never `status`/`switchStatus`/`rollbackStatus` —
// preserving every existing crash-recovery/rollback-eligibility guarantee those fields provide
// (e.g. a mid-switch failure must stay at status:'switching' so performRollback() remains
// callable; see this file's own performRollback() entry check). If the write itself fails for
// any reason (including a status with no such self-loop, or restoreLock.js's own concurrency
// guard), the original redacted error is never masked — both are surfaced together, exactly like
// restoreDatabase.js's own runRestoreOrchestrator() already does for its own 'failed' recording.
function recordFailureAndRedact(err, currentStatus, stateOpts) {
  if (err instanceof SimulatedCrashError) throw err;
  const message = redactErrorMessage(err);
  const safeErr = new DatabaseSwitchError(err?.reason || 'operation_failed', message);
  try {
    transitionRestoreState(currentStatus, { error: message }, stateOpts);
  } catch (stateErr) {
    throw new DatabaseSwitchError(
      safeErr.reason,
      `${message} (كما فشل تسجيل حالة الفشل في restore-state.json: ${redactErrorMessage(stateErr)})`
    );
  }
  throw safeErr;
}

// ── naming ──────────────────────────────────────────────────────────────────────────────────

/**
 * computeArchivalName: the name the current production DB is renamed TO. Sanitizes restoreId
 * (which may be a UUID, containing hyphens — not a safe SQL identifier character) down to
 * [A-Za-z0-9_] rather than rejecting it, since restoreId is a label, not a security boundary in
 * itself — assertSafeDatabaseIdentifier is still the real gate, applied to the FINAL name below.
 */
export function computeArchivalName(productionDbName, restoreId) {
  assertSafeDatabaseIdentifier(productionDbName, { label: 'اسم قاعدة الإنتاج' });
  const safeSuffix = String(restoreId).replace(/[^A-Za-z0-9_]/g, '').slice(0, 32) || crypto.randomBytes(4).toString('hex');
  const name = `${productionDbName}${ARCHIVAL_MARKER}${safeSuffix}`;
  assertSafeDatabaseIdentifier(name, { label: 'اسم القاعدة الأرشيفية' });
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    throw new DatabaseSwitchError(
      'archival_name_too_long',
      `الاسم الأرشيفي المُشتقّ أطول من حد PostgreSQL للمُعرِّفات (${MAX_IDENTIFIER_LENGTH}): "${name}".`
    );
  }
  return name;
}

// ── low-level, real PostgreSQL operations — every name validated before use, every connection
// made to the `postgres` maintenance database, never to the database being acted upon ─────────

async function terminateConnectionsTo(maintenanceUrl, dbName) {
  assertSafeDatabaseIdentifier(dbName, { label: 'اسم قاعدة الإنهاء المُستهدَفة' });
  const client = new PrismaClient({ datasources: { db: { url: maintenanceUrl } } });
  try {
    await client.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`
    );
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

async function renameDatabase(maintenanceUrl, fromName, toName) {
  assertSafeDatabaseIdentifier(fromName, { label: 'الاسم الحالي' });
  assertSafeDatabaseIdentifier(toName, { label: 'الاسم الجديد' });
  const client = new PrismaClient({ datasources: { db: { url: maintenanceUrl } } });
  try {
    await client.$executeRawUnsafe(`ALTER DATABASE "${fromName}" RENAME TO "${toName}"`);
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

// ── cross-install protection (Phase 2C-3A §12 — "blocked") ───────────────────────────────────

export async function readInstallationId(databaseUrl) {
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const row = await client.support_access_config.findUnique({ where: { id: 1 } });
    return row?.installation_id ?? null;
  } catch (err) {
    throw new DatabaseSwitchError('installation_id_read_failed', `تعذّرت قراءة هوية التثبيت: ${redactErrorMessage(err)}`);
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

export function assertSameInstallation(currentInstallationId, candidateInstallationId) {
  if (!currentInstallationId || !candidateInstallationId) {
    throw new DatabaseSwitchError(
      'installation_identity_unavailable',
      'تعذّر تحديد هوية التثبيت (installation_id) لأحد الطرفين — تم الرفض بدل الافتراض.'
    );
  }
  if (currentInstallationId !== candidateInstallationId) {
    throw new DatabaseSwitchError(
      'cross_install_backup_rejected',
      'النسخة الاحتياطية المُرشَّحة تنتمي لتثبيت Studix مختلف (installation_id مختلف) — تم رفض الترقية للحفاظ على ربط الترخيص/الجلسات الصحيح لهذا الجهاز.'
    );
  }
  return true;
}

// ── deep health verification (Phase 2C-3A §11 / task Part 8) ────────────────────────────────

/**
 * runDeepHealthVerification: every check reuses existing, unmodified helpers
 * (classifySchemaState, checkMigrationsUpToDate) except the two genuinely new ones this phase
 * adds: current_database()/expected-name, and a disposable INSERT-then-ROLLBACK DML probe that
 * never commits.
 */
export async function runDeepHealthVerification({
  appUrl, expectedDbName, expectedIdentityId, dbIdentityConfigPath, getAppStatusFn, fetchHealthFn,
} = {}) {
  const results = {};

  const client = new PrismaClient({ datasources: { db: { url: appUrl } } });
  try {
    const dbRows = await client.$queryRaw`SELECT current_database() AS name`;
    results.currentDatabase = dbRows[0].name;
    results.reachable = true;
    if (results.currentDatabase !== expectedDbName) {
      throw new DatabaseSwitchError(
        'health_wrong_database',
        `القاعدة الحالية "${results.currentDatabase}" لا تطابق الاسم المتوقَّع "${expectedDbName}".`
      );
    }

    const identity = readActiveDatabaseIdentity({ configPath: dbIdentityConfigPath });
    results.activeIdentityId = identity?.id ?? null;
    if (!identity || identity.id !== expectedIdentityId) {
      throw new DatabaseSwitchError(
        'health_wrong_identity',
        `هوية قاعدة البيانات النشطة (${identity?.id ?? 'null'}) لا تطابق الهوية المتوقَّعة (${expectedIdentityId}).`
      );
    }

    const structure = await classifySchemaState(appUrl);
    results.schemaState = structure.state;
    if (structure.state !== 'has_base_schema') {
      throw new DatabaseSwitchError('health_schema_incomplete', `حالة الـ schema غير مكتملة: ${structure.state}.`);
    }

    const migrationCheck = await checkMigrationsUpToDate(client);
    results.migrationsUpToDate = migrationCheck.upToDate;
    if (!migrationCheck.upToDate) {
      throw new DatabaseSwitchError('health_migrations_pending', `ترحيلات معلَّقة: ${migrationCheck.pendingVersions.join(', ')}.`);
    }

    // Disposable DML probe — INSERT into activity_logs (the same minimal shape Phase 2A's own
    // seed already proved works against this schema), unconditionally rolled back. Proves the
    // runtime role's actual INSERT grant survived the switch, without ever committing a row.
    class ProbeAbort extends Error {}
    try {
      await client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO activity_logs (id, action, module, entity_type, entity_id, details, timestamp) ` +
          `VALUES ('__health_probe__', 'health_probe', 'system', 'system', '__health_probe__', 'health verification probe (never committed)', now())`
        );
        throw new ProbeAbort();
      });
    } catch (err) {
      if (!(err instanceof ProbeAbort)) throw err;
    }
    results.dmlProbe = 'ok';

    const studentCountRows = await client.$queryRaw`SELECT COUNT(*)::int AS count FROM students`;
    results.representativeReadCount = studentCountRows[0].count;

    const userCountRows = await client.$queryRaw`SELECT COUNT(*)::int AS count FROM users`;
    results.authDataReadable = userCountRows[0].count >= 0;
  } finally {
    await client.$disconnect().catch(() => {});
  }

  if (getAppStatusFn) {
    const status = await getAppStatusFn();
    results.appRunning = !!status?.running;
    if (!results.appRunning) {
      throw new DatabaseSwitchError('health_app_not_running', 'التطبيق غير قيد التشغيل وقت التحقّق الصحّي.');
    }
  }

  if (fetchHealthFn) {
    const health = await fetchHealthFn();
    results.httpHealth = health;
    if (!health?.ok) {
      throw new DatabaseSwitchError('health_http_check_failed', 'فحص /health الحقيقي لم يُعِد نتيجة ناجحة.');
    }
  } else {
    results.httpHealth = { skipped: true, reason: 'لا خادم Express حقيقي قيد التشغيل في هذه البيئة/الاختبار.' };
  }

  return results;
}

// ── forward switch ────────────────────────────────────────────────────────────────────────────

const SWITCH_ORDER = SWITCH_STATUSES.filter((s) => s !== 'failed');
function switchOrderIndex(status) {
  return SWITCH_ORDER.indexOf(status);
}

/**
 * performDatabaseSwitch: resumable. First call (state at 'verified') performs the cross-install
 * check and the initial 'switching' transition (capturing renamedPreviousDb/previousIdentityId/
 * candidateIdentityId BEFORE any destructive step). Every subsequent call — including one made
 * by a freshly-started recovery process after a real crash — re-reads the state, re-derives
 * ground truth from pg_database/service status, and resumes from exactly the right checkpoint,
 * never repeating a completed step and never guessing.
 */
export async function performDatabaseSwitch({
  productionDbName,
  candidateDb,
  adminConfigPath,
  restoreStateConfigPath,
  dbIdentityConfigPath,
  stopAppFn,
  startAppFn,
  getAppStatusFn,
  fetchHealthFn,
  readAdminCredentialFn = readAdminCredential,
  buildRuntimeUrlFn,
  simulateCrashAfter,
} = {}) {
  const stateOpts = { configPath: restoreStateConfigPath };
  let state = readRestoreState(stateOpts);

  // Phase 2C-3C Part 1 — everything below (including reading the admin credential itself) is
  // wrapped in ONE try/catch. A real (non-simulated-crash) failure ANYWHERE in here is redacted
  // and recorded via recordFailureAndRedact(), using `state.status` AS IT STANDS AT CATCH TIME —
  // still 'verified' if the failure happened before the first destructive writeCheckpoint call
  // (recorded onto 'verified' via its self-loop, never advanced to 'failed' — an already-verified
  // candidate should stay retryable), or 'switching' if it happened afterward (recorded onto
  // 'switching' via ITS self-loop, so performRollback() remains callable exactly as every
  // existing crash/rollback test already proves — never advanced to 'failed' there either).
  try {
    // A resuming recovery process (after a real crash) may not have these passed in explicitly —
    // both are already durably recorded in restore-state.json from the 'preparing' stage onward,
    // so they are recoverable from the state file alone, never re-derived by guessing.
    productionDbName = productionDbName || state.previousDb;
    candidateDb = candidateDb || state.candidateDb;

    const adminUrl = readAdminCredentialFn({ configPath: adminConfigPath });
    const maintenanceUrl = withDatabaseName(adminUrl, 'postgres');

    // ── first-time entry: verified -> switching, with every crash-recovery field captured
    // BEFORE any destructive action ──────────────────────────────────────────────────────────
    if (state.status === 'verified') {
      assertSafeCandidateDatabaseName(candidateDb, productionDbName);

      const candidateUrl = withDatabaseName(adminUrl, candidateDb);
      const currentUrl = withDatabaseName(adminUrl, productionDbName);
      const currentInstallationId = await readInstallationId(currentUrl);
      const candidateInstallationId = await readInstallationId(candidateUrl);
      assertSameInstallation(currentInstallationId, candidateInstallationId); // throws before ANY state write if mismatched

      const { identity: previousIdentity } = ensureActiveDatabaseIdentity({ configPath: dbIdentityConfigPath });
      const candidateIdentity = generateDatabaseIdentity({ role: 'candidate' });
      const renamedPreviousDb = computeArchivalName(productionDbName, state.restoreId || candidateDb);

      state = writeCheckpoint('switching', {
        switchStatus: 'pending',
        renamedPreviousDb,
        previousIdentityId: previousIdentity.id,
        candidateIdentityId: candidateIdentity.id,
      }, stateOpts, simulateCrashAfter);
    }

    if (state.status !== 'switching') {
      throw new DatabaseSwitchError(
        'not_in_switching_state',
        `لا يمكن متابعة التبديل — الحالة الحالية "${state.status}" ليست "verified" ولا "switching".`
      );
    }

    const { renamedPreviousDb, previousIdentityId, candidateIdentityId } = state;

  // ── step: stop the app (idempotent — checks real status first) ───────────────────────────
  if (switchOrderIndex(state.switchStatus) < switchOrderIndex('app_stopped')) {
    state = writeCheckpoint('switching', { switchStatus: 'app_stopping' }, stateOpts, simulateCrashAfter);
    const before = await getAppStatusFn();
    if (before.running) {
      await stopAppFn();
      const after = await getAppStatusFn();
      if (after.running) {
        throw new DatabaseSwitchError('app_stop_failed', 'فشل إيقاف التطبيق — ما زال يعمل بعد محاولة الإيقاف.');
      }
    }
    state = writeCheckpoint('switching', { switchStatus: 'app_stopped' }, stateOpts, simulateCrashAfter);
  }

  // ── step: terminate remaining connections (always safe to redo, idempotent) ──────────────
  if (switchOrderIndex(state.switchStatus) < switchOrderIndex('connections_terminated')) {
    await terminateConnectionsTo(maintenanceUrl, productionDbName);
    state = writeCheckpoint('switching', { switchStatus: 'connections_terminated' }, stateOpts, simulateCrashAfter);
  }

  // ── steps: rename #1, rename #2, identity promotion ───────────────────────────────────────
  // These three sub-actions are grouped under ONE outer gate (not reached 'app_starting' yet)
  // but each sub-action's OWN idempotency is decided from ground truth (pg_database / the
  // identity file's actual content), never from switchStatus alone. This matters precisely
  // because a crash can land BETWEEN a checkpoint write and its own follow-up action (e.g.
  // right after the 'candidate_renamed' checkpoint is durably written, but before identity
  // promotion runs) — gating identity promotion on "switchStatus hasn't reached
  // candidate_renamed yet" would then skip it forever on resume, since the checkpoint already
  // shows candidate_renamed as done. Re-deriving each sub-action's own truth independently
  // closes that gap: every sub-action asks "did *I* already happen," never "did the checkpoint
  // that happens to sit near me get written."
  if (switchOrderIndex(state.switchStatus) < switchOrderIndex('app_starting')) {
    // rename #1 — current production DB -> archival name. "Already done" is decided from the
    // ARCHIVAL name's existence ALONE — production may legitimately exist again by the time
    // this re-runs on resume (rename #2 may have ALSO already completed, in which case
    // productionDbName now holds the candidate's data under its original name again). Checking
    // "production must be absent" as part of the done-condition would be correct only in the
    // narrow window between rename #1 and rename #2, and wrongly reject the fully-switched
    // state as "inconsistent."
    const prodStillExists = await databaseExists(maintenanceUrl, productionDbName);
    const archivalExists = await databaseExists(maintenanceUrl, renamedPreviousDb);
    if (archivalExists) {
      // already done — nothing to verify further here; rename #2's own check below re-verifies
      // the production name independently.
    } else if (prodStillExists) {
      await renameDatabase(maintenanceUrl, productionDbName, renamedPreviousDb);
      if (!(await databaseExists(maintenanceUrl, renamedPreviousDb))) {
        throw new DatabaseSwitchError('rename_1_unverified', 'تعذّر التحقّق من نجاح إعادة التسمية الأولى عبر pg_database.');
      }
    } else {
      throw new DatabaseSwitchError(
        'inconsistent_rename_state',
        `حالة غير متّسقة قبل إعادة التسمية الأولى: الإنتاج موجود=${prodStillExists}, الأرشيف موجود=${archivalExists} — تم الإيقاف بدل التخمين.`
      );
    }
    if (switchOrderIndex(state.switchStatus) < switchOrderIndex('current_renamed')) {
      state = writeCheckpoint('switching', { switchStatus: 'current_renamed' }, stateOpts, simulateCrashAfter);
    }

    // rename #2 — candidate -> production name
    const candidateStillExists = await databaseExists(maintenanceUrl, candidateDb);
    const prodExists = await databaseExists(maintenanceUrl, productionDbName);
    if (candidateStillExists && !prodExists) {
      await terminateConnectionsTo(maintenanceUrl, candidateDb);
      await renameDatabase(maintenanceUrl, candidateDb, productionDbName);
    } else if (!(prodExists && !candidateStillExists)) {
      throw new DatabaseSwitchError(
        'inconsistent_rename_state',
        `حالة غير متّسقة قبل إعادة التسمية الثانية: المُرشَّحة موجودة=${candidateStillExists}, الإنتاج موجود=${prodExists} — تم الإيقاف بدل التخمين.`
      );
    }
    const verify2 = (await databaseExists(maintenanceUrl, productionDbName)) && !(await databaseExists(maintenanceUrl, candidateDb));
    if (!verify2) throw new DatabaseSwitchError('rename_2_unverified', 'تعذّر التحقّق من نجاح إعادة التسمية الثانية عبر pg_database.');
    if (switchOrderIndex(state.switchStatus) < switchOrderIndex('candidate_renamed')) {
      state = writeCheckpoint('switching', { switchStatus: 'candidate_renamed' }, stateOpts, simulateCrashAfter);
    }

    // identity promotion — idempotent via the file's own actual content, not via switchStatus.
    // A fresh createdAt is fine here (never compared; see databaseIdentity.js's own
    // hasDatabaseIdentityChanged, which only ever compares `.id`).
    const currentIdentity = readActiveDatabaseIdentity({ configPath: dbIdentityConfigPath });
    if (!currentIdentity || currentIdentity.id !== candidateIdentityId) {
      promoteActiveDatabaseIdentity({
        configPath: dbIdentityConfigPath,
        identity: { id: candidateIdentityId, createdAt: new Date().toISOString() },
      });
    }
  }

  // ── step: start the app ────────────────────────────────────────────────────────────────────
  if (switchOrderIndex(state.switchStatus) < switchOrderIndex('app_started')) {
    state = writeCheckpoint('switching', { switchStatus: 'app_starting' }, stateOpts, simulateCrashAfter);
    const before = await getAppStatusFn();
    if (!before.running) {
      await startAppFn();
      const after = await getAppStatusFn();
      if (!after.running) {
        throw new DatabaseSwitchError('app_start_failed', 'فشل بدء التطبيق بعد التبديل.');
      }
    }
    state = writeCheckpoint('switching', { switchStatus: 'app_started' }, stateOpts, simulateCrashAfter);
  }

  // ── step: deep health verification ────────────────────────────────────────────────────────
  if (switchOrderIndex(state.switchStatus) < switchOrderIndex('completed')) {
    state = writeCheckpoint('switching', { switchStatus: 'health_verifying' }, stateOpts, simulateCrashAfter);
    // buildRuntimeUrlFn SHOULD be the restricted studix_app-role connection (proving that
    // exact role's grants survived the switch) — this module has no independent way to learn
    // that role's password itself, so it falls back to the admin connection ONLY when no
    // builder is supplied. Real production wiring (Phase 2C-3C) MUST always supply the
    // restricted-role builder; the fallback exists purely so this function is still callable
    // in isolation/tests that don't care about that specific distinction.
    const appUrl = buildRuntimeUrlFn ? buildRuntimeUrlFn(productionDbName) : withDatabaseName(adminUrl, productionDbName);
    await runDeepHealthVerification({
      appUrl, expectedDbName: productionDbName, expectedIdentityId: candidateIdentityId,
      dbIdentityConfigPath, getAppStatusFn, fetchHealthFn,
    });
    state = writeCheckpoint('switching', { switchStatus: 'completed' }, stateOpts, simulateCrashAfter);
    state = writeCheckpoint('active', {}, stateOpts, simulateCrashAfter);
  }

    return { status: state.status, productionDbName, renamedPreviousDb, previousIdentityId, candidateIdentityId };
  } catch (err) {
    recordFailureAndRedact(err, state.status, stateOpts);
  }
}

// ── rollback ─────────────────────────────────────────────────────────────────────────────────

const ROLLBACK_ORDER = ROLLBACK_STATUSES.filter((s) => s !== 'failed');
function rollbackOrderIndex(status) {
  return ROLLBACK_ORDER.indexOf(status);
}

/**
 * performRollback: the mirror image of performDatabaseSwitch, equally resumable. Reverses
 * whatever renames already happened (never assumes both did), restores the ORIGINAL active
 * identity (previousIdentityId — never a freshly generated one), and re-runs the same deep
 * health verification against the reverted database before ever reporting rolled_back.
 * Deliberately never deletes anything — the failed/candidate database is renamed back to its
 * OWN original name (candidateDb), never dropped.
 */
export async function performRollback({
  productionDbName,
  candidateDb,
  adminConfigPath,
  restoreStateConfigPath,
  dbIdentityConfigPath,
  stopAppFn,
  startAppFn,
  getAppStatusFn,
  fetchHealthFn,
  readAdminCredentialFn = readAdminCredential,
  buildRuntimeUrlFn,
  simulateCrashAfter,
} = {}) {
  const stateOpts = { configPath: restoreStateConfigPath };
  let state = readRestoreState(stateOpts);

  // Phase 2C-3C Part 1 — same single-try discipline as performDatabaseSwitch above: one
  // try/catch around everything (including reading the admin credential itself), redacting and
  // recording via recordFailureAndRedact() using `state.status` as it stands at catch time —
  // 'switching' if the failure happened before rollback ever durably began (recorded via
  // switching's OWN self-loop), or 'rolling_back' afterward (via ITS self-loop) — never advanced
  // to 'failed', so a rollback that fails mid-way stays resumable exactly as every existing
  // crash-recovery test already proves.
  try {
    productionDbName = productionDbName || state.previousDb;
    candidateDb = candidateDb || state.candidateDb;

    const adminUrl = readAdminCredentialFn({ configPath: adminConfigPath });
    const maintenanceUrl = withDatabaseName(adminUrl, 'postgres');

    if (state.status === 'switching') {
      state = writeCheckpoint('rolling_back', { rollbackStatus: 'pending' }, stateOpts, simulateCrashAfter);
    }
    if (state.status !== 'rolling_back') {
      throw new DatabaseSwitchError(
        'not_in_rollback_state',
        `لا يمكن متابعة التراجع — الحالة الحالية "${state.status}" ليست "switching" ولا "rolling_back".`
      );
    }

    const { renamedPreviousDb, previousIdentityId } = state;
    if (!renamedPreviousDb) {
      throw new DatabaseSwitchError('rollback_missing_archival_name', 'لا يمكن التراجع — لا يوجد اسم أرشيفي مسجَّل لهذه العملية.');
    }

  if (rollbackOrderIndex(state.rollbackStatus) < rollbackOrderIndex('app_stopping')) {
    state = writeCheckpoint('rolling_back', { rollbackStatus: 'app_stopping' }, stateOpts, simulateCrashAfter);
    const before = await getAppStatusFn();
    if (before.running) {
      await stopAppFn();
      const after = await getAppStatusFn();
      if (after.running) throw new DatabaseSwitchError('rollback_app_stop_failed', 'فشل إيقاف التطبيق أثناء التراجع.');
    }
  }

  // Same discipline as the forward switch above: one outer gate (haven't reached app_starting
  // yet), but every sub-action's own idempotency is decided from ground truth, never from
  // rollbackStatus alone — a crash between the 'reverse_renaming' checkpoint write and the
  // identity revert that follows it must not skip that revert forever on resume.
  if (rollbackOrderIndex(state.rollbackStatus) < rollbackOrderIndex('app_starting')) {
    if (rollbackOrderIndex(state.rollbackStatus) < rollbackOrderIndex('reverse_renaming')) {
      state = writeCheckpoint('rolling_back', { rollbackStatus: 'reverse_renaming' }, stateOpts, simulateCrashAfter);
    }

    // sub-step 1: whatever currently occupies productionDbName (the failed/unhealthy
    // candidate-turned-production) goes back to its own original candidate name.
    const prodExists = await databaseExists(maintenanceUrl, productionDbName);
    const candidateExists = await databaseExists(maintenanceUrl, candidateDb);
    if (prodExists && !candidateExists) {
      await terminateConnectionsTo(maintenanceUrl, productionDbName);
      await renameDatabase(maintenanceUrl, productionDbName, candidateDb);
    } else if (candidateExists && !prodExists) {
      // already done
    } else if (prodExists && candidateExists) {
      throw new DatabaseSwitchError('rollback_inconsistent_state', 'كل من اسم الإنتاج واسم القاعدة المُرشَّحة موجودان معاً — حالة غير متوقَّعة، تم الإيقاف.');
    } else {
      throw new DatabaseSwitchError('rollback_inconsistent_state', 'لا اسم الإنتاج ولا اسم القاعدة المُرشَّحة موجود — لا يمكن تحديد الحالة الفعلية بأمان.');
    }

    // sub-step 2: the archival copy goes back to being the production name.
    const archivalExists = await databaseExists(maintenanceUrl, renamedPreviousDb);
    const prodExistsNow = await databaseExists(maintenanceUrl, productionDbName);
    if (archivalExists && !prodExistsNow) {
      await terminateConnectionsTo(maintenanceUrl, renamedPreviousDb);
      await renameDatabase(maintenanceUrl, renamedPreviousDb, productionDbName);
    } else if (prodExistsNow && !archivalExists) {
      // already done
    } else {
      throw new DatabaseSwitchError('rollback_inconsistent_state', 'حالة غير متّسقة عند إعادة الاسم الأرشيفي — تم الإيقاف.');
    }

    if (!(await databaseExists(maintenanceUrl, productionDbName)) || (await databaseExists(maintenanceUrl, renamedPreviousDb))) {
      throw new DatabaseSwitchError('rollback_rename_unverified', 'تعذّر التحقّق من اكتمال التراجع عبر pg_database.');
    }

    // identity revert — idempotent via the file's own actual content, not via rollbackStatus.
    if (previousIdentityId) {
      const currentIdentity = readActiveDatabaseIdentity({ configPath: dbIdentityConfigPath });
      if (!currentIdentity || currentIdentity.id !== previousIdentityId) {
        promoteActiveDatabaseIdentity({
          configPath: dbIdentityConfigPath,
          identity: { id: previousIdentityId, createdAt: new Date().toISOString() },
        });
      }
    }
  }

  if (rollbackOrderIndex(state.rollbackStatus) < rollbackOrderIndex('app_started')) {
    state = writeCheckpoint('rolling_back', { rollbackStatus: 'app_starting' }, stateOpts, simulateCrashAfter);
    const before = await getAppStatusFn();
    if (!before.running) {
      await startAppFn();
      const after = await getAppStatusFn();
      if (!after.running) throw new DatabaseSwitchError('rollback_app_start_failed', 'فشل بدء التطبيق بعد التراجع.');
    }
    state = writeCheckpoint('rolling_back', { rollbackStatus: 'app_started' }, stateOpts, simulateCrashAfter);
  }

  if (rollbackOrderIndex(state.rollbackStatus) < rollbackOrderIndex('completed')) {
    state = writeCheckpoint('rolling_back', { rollbackStatus: 'health_verifying' }, stateOpts, simulateCrashAfter);
    const appUrl = buildRuntimeUrlFn ? buildRuntimeUrlFn(productionDbName) : withDatabaseName(adminUrl, productionDbName);
    await runDeepHealthVerification({
      appUrl, expectedDbName: productionDbName, expectedIdentityId: previousIdentityId,
      dbIdentityConfigPath, getAppStatusFn, fetchHealthFn,
    });
    state = writeCheckpoint('rolling_back', { rollbackStatus: 'completed' }, stateOpts, simulateCrashAfter);
    state = writeCheckpoint('rolled_back', {}, stateOpts, simulateCrashAfter);
  }

    return { status: state.status, productionDbName, restoredIdentityId: previousIdentityId };
  } catch (err) {
    recordFailureAndRedact(err, state.status, stateOpts);
  }
}

// ── CLI entry point (Phase 2C-3C Part 1) ────────────────────────────────────────────────────
// Mirrors restoreDatabase.js's own CLI guard exactly: never accepts an admin connection string
// OR any DATABASE_URL-shaped value as an argument — every token, flag name and value alike, is
// checked in one pass before anything else is parsed, and rejected outright if it looks like a
// postgres(ql):// URL. The ONLY thing this CLI accepts is --action (switch|rollback); which
// production/candidate database, which admin credential, which restore-state/identity file —
// every one of those is recovered exclusively from admin.env/restore-state.json/db-identity.json
// via their own existing default resolvers, exactly like the "freshly-started recovery process"
// shape this file's own integration test suite already proves works (performDatabaseSwitch/
// performRollback fall back to state.previousDb/state.candidateDb when not passed explicitly).
//
// Meant to run as its own separate, short-lived Node process (mirroring firstInstall.js's own
// shape exactly) — never imported by server.js/lib/config.js, not wired into HTTP or a UAC
// launcher yet (Phase 2C-3C Part 1 scope only — see later phases). Acquires restoreLock.js's
// process-boundary lock for the full duration of the operation so two concurrent invocations can
// never race restore-state.json (see restoreLock.js's own header for why an in-memory guard is
// not enough here).
export class SwitchCliError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

export function parseSwitchCliArgs(argv) {
  for (const token of argv) {
    if (/^postgres(?:ql)?:\/\//i.test(token)) {
      throw new SwitchCliError(
        'connection_string_in_cli_rejected',
        'رُفض: أحد معطيات سطر الأوامر يبدو كرابط اتصال PostgreSQL — هذه الأداة لا تقبل بيانات اعتماد أو ' +
        'DATABASE_URL عبر سطر الأوامر إطلاقاً؛ كل شيء يُقرَأ من admin.env/restore-state.json/db-identity.json.'
      );
    }
  }

  const args = { action: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--action') { args.action = argv[i + 1]; i += 1; }
  }
  if (args.action !== 'switch' && args.action !== 'rollback') {
    throw new SwitchCliError(
      'invalid_cli_action',
      `الاستخدام: node databaseSwitch.js --action <switch|rollback> — القيمة المُمرَّرة: ${JSON.stringify(args.action)}.`
    );
  }
  return args;
}

/**
 * runSwitchCli: the real, DI-testable core (no console/process side effects — those live in
 * main() below only). Acquires the restore lock, wires the real Windows-service/health adapters
 * (switchAdapters.js) unless overridden, calls the requested operation, and always releases the
 * lock — success or failure — never leaving a stale active lock behind after this process's own
 * attempt, whatever the outcome.
 */
export async function runSwitchCli(argv, {
  acquireRestoreLockFn = acquireRestoreLock,
  releaseRestoreLockFn = releaseRestoreLock,
  performDatabaseSwitchFn = performDatabaseSwitch,
  performRollbackFn = performRollback,
  createRealStopAppFnFn = createRealStopAppFn,
  createRealStartAppFnFn = createRealStartAppFn,
  createRealGetAppStatusFnFn = createRealGetAppStatusFn,
  createRealFetchHealthFnFn = createRealFetchHealthFn,
} = {}) {
  const args = parseSwitchCliArgs(argv);

  acquireRestoreLockFn();
  try {
    const adapters = {
      stopAppFn: createRealStopAppFnFn(),
      startAppFn: createRealStartAppFnFn(),
      getAppStatusFn: createRealGetAppStatusFnFn(),
      fetchHealthFn: createRealFetchHealthFnFn(),
    };
    const result = args.action === 'switch'
      ? await performDatabaseSwitchFn(adapters)
      : await performRollbackFn(adapters);
    return { ok: true, action: args.action, ...result };
  } finally {
    releaseRestoreLockFn();
  }
}

async function main() {
  try {
    const result = await runSwitchCli(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    // redactErrorMessage is applied unconditionally, even to errors that already look safe
    // (SwitchCliError/DatabaseSwitchError/RestoreLockError/SwitchAdapterError messages never
    // embed a connection string by construction) — defense in depth, same philosophy
    // restoreDatabase.js's own redactErrorMessage header already states, never trusting a
    // message is safe just because of which class threw it.
    console.error(`❌ [${err.reason || 'unknown'}] ${redactErrorMessage(err)}`);
    process.exitCode = 1;
  }
}

// Only auto-runs when executed directly (`node databaseSwitch.js --action switch`), never when
// imported by a test file or by any other module — same guard convention as restoreDatabase.js/
// tools/license-issuer.js.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
