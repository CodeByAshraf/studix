// backend/src/lib/windowsService.js
// ─────────────────────────────────────────────────────────────
// INSTALL-05 — Windows Service management primitives for the two services a future installer
// (INSTALL-06) will register: PostgreSQL (native `pg_ctl register`, no wrapper needed — Windows
// PostgreSQL builds implement the SCM service-control protocol themselves) and the Studix Node
// application (wrapped via NSSM, since a plain node.exe process has no native SCM integration).
//
// Scope is deliberately narrow — register/start/stop/status/unregister for each service, plus
// dependency-ordering and restart-on-failure configuration. This module does NOT decide WHEN to
// call any of this (the one-time first-install sequencing — provisionPostgres -> stopPostgres
// -> register -> start — is the future installer's job, INSTALL-06) and does NOT acquire
// nssm.exe itself (assumed supplied by that same future installer, via STUDIX_NSSM_PATH or PATH
// — see resolveNssmPath below). See migration/reports/INSTALL-03_POSTGRES_PROVISIONING_DESIGN.md
// for why PostgreSQL is started ad-hoc during provisioning and must be stopped
// (db/postgresProvisioning.js's existing stopPostgres()) before being handed off to the
// SCM-managed service registered here — reused as-is, not duplicated.
//
// Every register/unregister function is idempotent AND fail-closed: an already-registered
// service is only ever treated as "ours" after verifying its actual configuration (PostgreSQL:
// the registered pg_ctl.exe binary path + datadir; the app: NSSM's own stored Application/
// AppParameters) — a same-named service that doesn't match is left completely untouched and
// surfaces a clear WindowsServiceError rather than being silently overwritten or claimed.
//
// Start/stop always go through `sc.exe start/stop <name>` — for BOTH services — never through
// pg_ctl start/stop directly once a service is registered, which would create exactly the
// ad-hoc-vs-SCM-managed conflict this whole design exists to avoid.
// ─────────────────────────────────────────────────────────────
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { resolvePgHome, resolvePgDataDir, locatePgBinaries } from '../db/postgresProvisioning.js';
import { resolveLogDir } from './logger.js';

export class WindowsServiceError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

// defaultSleepSync: a real, blocking (non-busy-loop) synchronous sleep — used only to space out
// polling attempts in waitUntilServiceState/waitUntilServicePurged below. execFileSync itself is
// synchronous, so this module has no event loop to hand control back to; Atomics.wait on a
// throwaway SharedArrayBuffer is the standard technique for a genuine synchronous sleep in Node
// without spawning a child process — already relied on by this exact name/shape in
// windowsService.integration.test.js's own sleepSync helper.
function defaultSleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const REAL_IO = { execFileSync, sleepSync: defaultSleepSync };

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // backend/src/lib

// Default install root: three levels up from backend/src/lib -> the assembled runtime
// package's own root (release/win-x64/studix/ once packaged) — the exact same
// __dirname-relative-sibling convention db/postgresProvisioning.js's DEFAULT_PG_HOME and
// server.js's DIST_DIR already use, at the same directory depth.
const DEFAULT_INSTALL_ROOT = path.join(__dirname, '..', '..', '..');

export const STUDIX_POSTGRES_SERVICE_NAME = 'StudixPostgreSQL';
export const STUDIX_APP_SERVICE_NAME = 'StudixApp';

// ── path resolution ────────────────────────────────────────────────────────────────────────
export function resolveInstallRoot() {
  return process.env.STUDIX_INSTALL_ROOT || DEFAULT_INSTALL_ROOT;
}

export function resolveNodeExePath(installRoot = resolveInstallRoot()) {
  return path.join(installRoot, 'node', 'node.exe');
}

export function resolveServerJsPath(installRoot = resolveInstallRoot()) {
  return path.join(installRoot, 'backend', 'src', 'server.js');
}

// resolveNssmPath: INSTALL-05 never downloads/vendors nssm.exe (INSTALL-06's job) — this only
// resolves WHERE to invoke it from: an explicit override, or bare "nssm.exe" relying on the
// installer having placed it somewhere on PATH.
export function resolveNssmPath() {
  return process.env.STUDIX_NSSM_PATH || 'nssm.exe';
}

// resolvePinnedNssmPath: the bundled nssm.exe's actual, fixed, guaranteed location —
// {installRoot}\tools\nssm.exe — never a bare "nssm.exe" PATH lookup and never deferring to
// STUDIX_NSSM_PATH. INSTALL-06 never adds nssm.exe to system PATH (deliberately — decision #3),
// so any installer-driven caller (never a human typing a command interactively) must resolve
// this exact location, not resolveNssmPath()'s own PATH-lookup default, which exists purely for
// manual/dev CLI convenience (see that function's own header). firstInstall.js's orchestrator
// already inlines this identical join when it calls registerAppService directly; this shared
// helper lets every OTHER installer-driven caller (manageWindowsServices.js's CLI, used at
// uninstall time by studix.iss) reuse the exact same convention instead of re-deriving it — see
// that CLI's own comment for the bug this closes (a bare "nssm.exe" PATH lookup failing at
// uninstall time, since nssm.exe is never on PATH, which left StudixApp/StudixPostgreSQL running
// and blocked the rest of a normal uninstall).
export function resolvePinnedNssmPath(installRoot = resolveInstallRoot()) {
  return path.join(installRoot, 'tools', 'nssm.exe');
}

// ── low-level command execution — the only place in this module that touches a real process ─
function runExec(cmd, args, io) {
  const { execFileSync: exec } = { ...REAL_IO, ...io };
  return exec(cmd, args, { encoding: 'utf8' });
}

// ── sc.exe query parsing ───────────────────────────────────────────────────────────────────
// parseScQcOutput: minimal, targeted parser for `sc qc <name>` — only the fields this module
// actually needs (binary path, start type, dependencies), not a general-purpose sc.exe parser.
export function parseScQcOutput(text) {
  const get = (label) => {
    // [ \t]* (not \s*) around the colon deliberately — \s also matches \n, so a bare \s* here
    // would happily consume an empty field's trailing newline and the next line's leading
    // indentation too, capturing the FOLLOWING field's content instead of an empty string.
    // Verified against a real empty DEPENDENCIES field, which is the common case.
    const m = text.match(new RegExp(`^[ \\t]*${label}[ \\t]*:[ \\t]*(.*)$`, 'm'));
    return m ? m[1].trim() : null;
  };
  const binaryPathRaw = get('BINARY_PATH_NAME');
  const startTypeRaw = get('START_TYPE');
  const dependenciesRaw = get('DEPENDENCIES');
  return {
    binaryPathName: binaryPathRaw ? binaryPathRaw.replace(/^"|"$/g, '') : null,
    startType: startTypeRaw ? startTypeRaw.replace(/^\d+\s+/, '') : null, // "2   AUTO_START" -> "AUTO_START"
    dependencies: dependenciesRaw ? dependenciesRaw.split(/\s+/).filter(Boolean) : [],
  };
}

// queryServiceConfig: null means "not registered at all" (sc.exe exits with code 1060 — "the
// specified service does not exist"), the expected, common, non-error case. Any OTHER sc.exe
// failure (access denied, sc.exe itself missing, ...) throws — never silently reinterpreted as
// "not registered", which could otherwise mask a real problem as a false "safe to register" signal.
export function queryServiceConfig(serviceName, io = {}) {
  let output;
  try {
    output = runExec('sc.exe', ['qc', serviceName], io);
  } catch (err) {
    if (err.status === 1060) return null;
    throw new WindowsServiceError('sc_query_failed', `تعذّر الاستعلام عن إعداد خدمة "${serviceName}": ${err.message}`);
  }
  return parseScQcOutput(output);
}

export function queryServiceState(serviceName, io = {}) {
  let output;
  try {
    output = runExec('sc.exe', ['query', serviceName], io);
  } catch (err) {
    if (err.status === 1060) return null;
    throw new WindowsServiceError('sc_query_failed', `تعذّر الاستعلام عن حالة خدمة "${serviceName}": ${err.message}`);
  }
  const m = output.match(/STATE\s*:\s*\d+\s+(\S+)/);
  return m ? m[1] : 'UNKNOWN';
}

// ── condition-based waiting for real SCM state transitions ──────────────────────────────────
// Both `sc.exe stop` and a service deletion (`nssm remove` / `pg_ctl unregister`) are
// asynchronous requests, not synchronous completions: `sc.exe stop` returns as soon as the stop
// control code is accepted (the service can sit in STOP_PENDING for a while afterward), and even
// a successful delete can leave the service briefly still queryable while the SCM finishes
// purging its database entry (observed and documented independently in
// windowsService.integration.test.js's own real-nssm.exe teardown). A caller that immediately
// treats "the command exited 0" as "the service is genuinely gone" and then acts on a service
// THAT one depended on it (e.g. stopping/unregistering StudixPostgreSQL right after StudixApp,
// which lists StudixPostgreSQL via DependOnService) can hit a real SCM failure
// (ERROR_DEPENDENT_SERVICES_RUNNING-class: the dependent service is not YET in a terminal state)
// — this is the exact uninstall-time race this module fixes. waitUntil polls the ACTUAL SCM
// state via the same query functions this module already uses elsewhere, never guesses at a
// fixed delay.
//
// timeoutMs/pollIntervalMs are read from `io` (same dependency-injection channel as
// execFileSync/sleepSync) rather than a separate parameter — this lets tests that need to prove
// the timeout path shrink both to milliseconds instead of spending real wall-clock seconds on
// every timeout-path assertion.
function waitUntil(check, io) {
  const { sleepSync, timeoutMs = 15_000, pollIntervalMs = 200 } = { ...REAL_IO, ...io };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return true;
    if (Date.now() >= deadline) return false;
    sleepSync(pollIntervalMs);
  }
}

// ── generic lifecycle — identical mechanism for both services once registered ───────────────
export function startService(serviceName, io = {}) {
  const stateBefore = queryServiceState(serviceName, io);
  if (stateBefore === null) {
    throw new WindowsServiceError('not_registered', `الخدمة "${serviceName}" غير مسجَّلة — لا يمكن بدؤها.`);
  }
  if (stateBefore === 'RUNNING') return { status: 'already_running', serviceName };
  try {
    runExec('sc.exe', ['start', serviceName], io);
  } catch (err) {
    throw new WindowsServiceError('start_failed', `فشل بدء خدمة "${serviceName}": ${err.message}`);
  }
  return { status: 'started', serviceName };
}

export function stopService(serviceName, io = {}) {
  const state = queryServiceState(serviceName, io);
  if (state === null) {
    throw new WindowsServiceError('not_registered', `الخدمة "${serviceName}" غير مسجَّلة — لا يوجد ما يُوقَف.`);
  }
  if (state === 'STOPPED') return { status: 'already_stopped', serviceName };
  try {
    runExec('sc.exe', ['stop', serviceName], io);
  } catch (err) {
    throw new WindowsServiceError('stop_failed', `فشل إيقاف خدمة "${serviceName}": ${err.message}`);
  }
  // `sc.exe stop` only REQUESTS the stop (SERVICE_STOP_PENDING) — wait for the real, terminal
  // STOPPED state before reporting success, so a caller that next acts on a service this one
  // depends on never proceeds while the SCM might still consider this one not-yet-stopped.
  const stopped = waitUntil(() => queryServiceState(serviceName, io) === 'STOPPED', io);
  if (!stopped) {
    throw new WindowsServiceError(
      'stop_timeout',
      `لم تصل خدمة "${serviceName}" إلى حالة التوقّف الفعلي (STOPPED) خلال المهلة المتاحة بعد إرسال أمر الإيقاف.`
    );
  }
  return { status: 'stopped', serviceName };
}

export function serviceStatus(serviceName, io = {}) {
  const config = queryServiceConfig(serviceName, io);
  if (!config) return { registered: false, serviceName };
  const state = queryServiceState(serviceName, io);
  return {
    registered: true, serviceName, state,
    binaryPathName: config.binaryPathName, startType: config.startType, dependencies: config.dependencies,
  };
}

// ── restart-on-failure configuration ─────────────────────────────────────────────────────────
// configureServiceRecovery: native SCM recovery actions (`sc failure`) — used for the
// PostgreSQL service, which (registered via pg_ctl register) has no NSSM-style restart policy
// of its own. Note the mandatory space after "reset="/"actions=" is preserved by passing them
// as separate argv entries (execFileSync never invokes a shell, so sc.exe's own quirky
// key=value-with-a-space-after-= parsing requirement is met exactly, not accidentally broken
// by a naive single-string "reset=86400").
export function configureServiceRecovery(serviceName, { resetPeriodSeconds = 86400, restartDelayMs = 60_000 } = {}, io = {}) {
  try {
    runExec('sc.exe', ['failure', serviceName, 'reset=', String(resetPeriodSeconds), 'actions=', `restart/${restartDelayMs}`], io);
  } catch (err) {
    throw new WindowsServiceError('recovery_config_failed', `فشل إعداد سياسة الاسترداد لخدمة "${serviceName}": ${err.message}`);
  }
  return { status: 'configured', serviceName };
}

// configureAppRecovery: NSSM's own restart mechanism — more direct/appropriate for the process
// NSSM itself is already supervising, so this is used instead of (not in addition to)
// configureServiceRecovery for the app service — layering both would be redundant, possibly
// conflicting, policy for the same failure.
export function configureAppRecovery({ serviceName = STUDIX_APP_SERVICE_NAME, nssmPath = resolveNssmPath(), restartDelayMs = 5000 } = {}, io = {}) {
  try {
    runExec(nssmPath, ['set', serviceName, 'AppExit', 'Default', 'Restart'], io);
    runExec(nssmPath, ['set', serviceName, 'AppRestartDelay', String(restartDelayMs)], io);
  } catch (err) {
    throw new WindowsServiceError('recovery_config_failed', `فشل إعداد سياسة إعادة التشغيل لخدمة "${serviceName}": ${err.message}`);
  }
  return { status: 'configured', serviceName };
}

// ── PostgreSQL service ───────────────────────────────────────────────────────────────────────
// isOurPostgresService: verifies an already-registered service is genuinely the pg_ctl-managed
// Studix PostgreSQL instance — the exact binary-path shape `pg_ctl register` produces is
// documented/verified as `"<...>\pg_ctl.exe" runservice -N "<name>" -D "<datadir>" -w`.
function isOurPostgresService(config, pgDataDir) {
  if (!config?.binaryPathName) return false;
  const bp = config.binaryPathName.toLowerCase();
  return bp.includes('pg_ctl.exe') && bp.includes('runservice') && bp.includes(pgDataDir.toLowerCase());
}

// isPostgresServiceRegisteredFor: true only when `serviceName` is BOTH currently registered AND
// verified (via isOurPostgresService) to be the pg_ctl-managed Studix PostgreSQL service for THIS
// exact pgDataDir — never a bare "does a service with this name exist" check, which could wrongly
// treat an unrelated/conflicting same-named service as ours. Exposed so callers outside this
// module can ask "is PostgreSQL lifecycle already service-owned for this data directory?" without
// duplicating queryServiceConfig/isOurPostgresService's own logic.
//
// db/postgresProvisioning.js is the intended caller (via an injected dependency, never a direct
// import — that module must never depend on this one, since this module already depends on it
// for resolvePgHome/resolvePgDataDir/locatePgBinaries; see provisionPostgres()'s own comment on
// why the fix for the upgrade-path Windows-identity/ACL mismatch is wired at the installer-
// orchestrator layer, which already imports both modules, instead of here).
export function isPostgresServiceRegisteredFor(pgDataDir, serviceName = STUDIX_POSTGRES_SERVICE_NAME, io = {}) {
  const existing = queryServiceConfig(serviceName, io);
  return existing !== null && isOurPostgresService(existing, pgDataDir);
}

export function registerPostgresService({
  pgHome = resolvePgHome(),
  pgDataDir = resolvePgDataDir(),
  serviceName = STUDIX_POSTGRES_SERVICE_NAME,
} = {}, io = {}) {
  const binaries = locatePgBinaries(pgHome, io); // reused from INSTALL-03, not duplicated

  const existing = queryServiceConfig(serviceName, io);
  if (existing) {
    if (isOurPostgresService(existing, pgDataDir)) {
      return { status: 'already_registered', serviceName };
    }
    throw new WindowsServiceError(
      'service_name_conflict',
      `خدمة موجودة بالفعل باسم "${serviceName}" لكنها لا تشير إلى pg_ctl.exe/مجلد بيانات Studix ` +
      'المتوقَّع — لن يُعاد تسجيلها أو استبدالها تلقائياً. راجعها يدوياً.'
    );
  }

  try {
    runExec(binaries.pg_ctl, ['register', '-N', serviceName, '-D', pgDataDir, '-S', 'auto', '-w'], io);
  } catch (err) {
    throw new WindowsServiceError('register_failed', `فشل تسجيل خدمة PostgreSQL: ${err.message}`);
  }
  configureServiceRecovery(serviceName, {}, io);
  return { status: 'registered', serviceName };
}

export function unregisterPostgresService({
  pgHome = resolvePgHome(),
  pgDataDir = resolvePgDataDir(),
  serviceName = STUDIX_POSTGRES_SERVICE_NAME,
} = {}, io = {}) {
  const existing = queryServiceConfig(serviceName, io);
  if (!existing) return { status: 'not_registered', serviceName };
  if (!isOurPostgresService(existing, pgDataDir)) {
    throw new WindowsServiceError(
      'service_name_conflict',
      `الخدمة "${serviceName}" موجودة لكنها لا تطابق تكوين Studix المتوقَّع — لن تُحذَف تلقائياً.`
    );
  }

  const binaries = locatePgBinaries(pgHome, io);
  if (queryServiceState(serviceName, io) === 'RUNNING') stopService(serviceName, io);
  try {
    runExec(binaries.pg_ctl, ['unregister', '-N', serviceName], io);
  } catch (err) {
    throw new WindowsServiceError('unregister_failed', `فشل إلغاء تسجيل خدمة PostgreSQL: ${err.message}`);
  }
  // The SCM can briefly still report this service as queryable ("marked for deletion") right
  // after a successful unregister — wait for it to be genuinely purged (queryServiceConfig ->
  // null) before reporting success, so a caller relying on this to gate a destructive action
  // never proceeds on a stale, not-yet-settled SCM state.
  const purged = waitUntil(() => queryServiceConfig(serviceName, io) === null, io);
  if (!purged) {
    throw new WindowsServiceError(
      'unregister_timeout',
      `لم يتأكّد إزالة خدمة "${serviceName}" فعلياً من سجل مدير التحكم بالخدمات (SCM) خلال المهلة المتاحة.`
    );
  }
  return { status: 'unregistered', serviceName };
}

// ── Studix application service (NSSM) ───────────────────────────────────────────────────────
// quoteNssmParam: NSSM stores whatever it's given for AppParameters VERBATIM, and — unlike the
// Application field, which it does quote itself when reconstructing the child process command
// line at service-start time — adds no quoting of its own around AppParameters. serverJs (e.g.
// "C:\Program Files\Studix\backend\src\server.js") contains a space, so an unquoted AppParameters
// value produces an ambiguous child command line: node.exe's own argv parser splits it at the
// space, and Node treats the first fragment ("C:\Program") as the main module to require —
// `Error: Cannot find module 'C:\Program'`. Embedding literal quote characters in the value we
// hand to `nssm install`/`nssm set ... AppParameters` is the documented NSSM workaround for this
// exact class of bug — verified empirically against the real bundled nssm.exe + a real node.exe
// (install -> get AppParameters -> start -> confirm node.exe received the complete, unmangled
// path) before this fix was written, not merely reasoned about.
function quoteNssmParam(value) {
  return `"${value}"`;
}

// isOurAppService: `sc qc` shows nssm.exe itself as the binary for an NSSM-managed service, not
// node.exe — verification instead uses NSSM's own `get` query for its stored Application/
// AppParameters. Any failure to query (not an NSSM-managed service at all, nssm.exe missing,
// ...) is treated as "cannot verify" by the caller, never as "assume it's fine."
//
// Recognizes exactly two legitimate AppParameters shapes: the current, correctly-quoted form
// (quoteNssmParam(serverJs)) and the legacy, pre-fix UNQUOTED form (bare serverJs) that a
// service registered before this fix still carries — that legacy shape crashes at runtime
// exactly as described above once serverJs contains a space, so registerAppService's caller
// uses `legacyUnquoted` to repair it in place rather than treating it as a foreign conflict.
// Anything else (including a mere substring match) is NOT recognized as ours — a same-named
// service must match one of these two known-exact shapes to be adopted, never a loose guess.
function isOurAppService({ serviceName, nssmPath, nodeExe, serverJs }, io) {
  const application = runExec(nssmPath, ['get', serviceName, 'Application'], io).trim();
  const appParameters = runExec(nssmPath, ['get', serviceName, 'AppParameters'], io).trim();
  if (application.toLowerCase() !== nodeExe.toLowerCase()) {
    return { matches: false, legacyUnquoted: false };
  }
  if (appParameters === quoteNssmParam(serverJs)) return { matches: true, legacyUnquoted: false };
  if (appParameters === serverJs) return { matches: true, legacyUnquoted: true };
  return { matches: false, legacyUnquoted: false };
}

export function registerAppService({
  installRoot = resolveInstallRoot(),
  serviceName = STUDIX_APP_SERVICE_NAME,
  dependsOnServiceName = STUDIX_POSTGRES_SERVICE_NAME,
  nssmPath = resolveNssmPath(),
} = {}, io = {}) {
  const nodeExe = resolveNodeExePath(installRoot);
  const serverJs = resolveServerJsPath(installRoot);

  const existing = queryServiceConfig(serviceName, io);
  if (existing) {
    let verification;
    try {
      verification = isOurAppService({ serviceName, nssmPath, nodeExe, serverJs }, io);
    } catch (err) {
      throw new WindowsServiceError(
        'verify_failed',
        `تعذّر التحقّق من إعداد الخدمة الموجودة "${serviceName}" عبر NSSM: ${err.message}`
      );
    }
    if (!verification.matches) {
      throw new WindowsServiceError(
        'service_name_conflict',
        `خدمة موجودة بالفعل باسم "${serviceName}" لا تشير إلى تطبيق Studix المتوقَّع (node.exe/server.js) ` +
        '— لن يُعاد تسجيلها أو استبدالها تلقائياً. راجعها يدوياً.'
      );
    }
    if (verification.legacyUnquoted) {
      // Repair in place — NSSM's own `set` updates just this one stored field on the existing
      // service; never unregister/reinstall (destructive-adjacent, and unnecessary — every other
      // already-configured field, e.g. AppDirectory/DependOnService/log paths/recovery policy,
      // is already correct and untouched).
      try {
        runExec(nssmPath, ['set', serviceName, 'AppParameters', quoteNssmParam(serverJs)], io);
      } catch (err) {
        throw new WindowsServiceError(
          'repair_failed',
          `تعذّر تصحيح إعداد AppParameters القديم (غير المُقتبَس) لخدمة "${serviceName}": ${err.message}`
        );
      }
      return { status: 'repaired', serviceName };
    }
    return { status: 'already_registered', serviceName };
  }

  try {
    runExec(nssmPath, ['install', serviceName, nodeExe, quoteNssmParam(serverJs)], io);
    runExec(nssmPath, ['set', serviceName, 'AppDirectory', installRoot], io);
    runExec(nssmPath, ['set', serviceName, 'Start', 'SERVICE_AUTO_START'], io);
    runExec(nssmPath, ['set', serviceName, 'DependOnService', dependsOnServiceName], io);
    runExec(nssmPath, ['set', serviceName, 'AppStdout', path.join(resolveLogDir(), 'studix-app-service-stdout.log')], io);
    runExec(nssmPath, ['set', serviceName, 'AppStderr', path.join(resolveLogDir(), 'studix-app-service-stderr.log')], io);
  } catch (err) {
    if (err instanceof WindowsServiceError) throw err;
    throw new WindowsServiceError('register_failed', `فشل تسجيل خدمة تطبيق Studix: ${err.message}`);
  }
  configureAppRecovery({ serviceName, nssmPath }, io);
  return { status: 'registered', serviceName };
}

export function unregisterAppService({
  installRoot = resolveInstallRoot(),
  serviceName = STUDIX_APP_SERVICE_NAME,
  nssmPath = resolveNssmPath(),
} = {}, io = {}) {
  const nodeExe = resolveNodeExePath(installRoot);
  const serverJs = resolveServerJsPath(installRoot);

  const existing = queryServiceConfig(serviceName, io);
  if (!existing) return { status: 'not_registered', serviceName };

  let verification;
  try {
    verification = isOurAppService({ serviceName, nssmPath, nodeExe, serverJs }, io);
  } catch (err) {
    throw new WindowsServiceError(
      'verify_failed',
      `تعذّر التحقّق من إعداد الخدمة الموجودة "${serviceName}" عبر NSSM قبل الحذف: ${err.message}`
    );
  }
  if (!verification.matches) {
    throw new WindowsServiceError(
      'service_name_conflict',
      `الخدمة "${serviceName}" موجودة لكنها لا تطابق تكوين Studix المتوقَّع — لن تُحذَف تلقائياً.`
    );
  }

  if (queryServiceState(serviceName, io) === 'RUNNING') stopService(serviceName, io);
  try {
    runExec(nssmPath, ['remove', serviceName, 'confirm'], io);
  } catch (err) {
    throw new WindowsServiceError('unregister_failed', `فشل إلغاء تسجيل خدمة تطبيق Studix: ${err.message}`);
  }
  // Same SCM-settling race as unregisterPostgresService above — this is exactly the case that
  // matters most for the uninstall-time wipe, since StudixPostgreSQL's own teardown runs
  // immediately after this one returns and would otherwise be able to observe a StudixApp
  // registration the SCM hasn't finished purging yet (it still lists StudixPostgreSQL via
  // DependOnService until fully gone).
  const purged = waitUntil(() => queryServiceConfig(serviceName, io) === null, io);
  if (!purged) {
    throw new WindowsServiceError(
      'unregister_timeout',
      `لم يتأكّد إزالة خدمة "${serviceName}" فعلياً من سجل مدير التحكم بالخدمات (SCM) خلال المهلة المتاحة.`
    );
  }
  return { status: 'unregistered', serviceName };
}
