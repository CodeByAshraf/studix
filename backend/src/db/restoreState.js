// backend/src/db/restoreState.js
// ─────────────────────────────────────────────────────────────
// Phase 2C-1 — foundational, crash-safe restore-operation state, per the approved Phase 2B
// design (§8 "Crash-Safe State Machine"). This file implements ONLY the state/persistence
// layer — no pg_restore orchestration, no elevated execution, no service start/stop, no
// admin-credential handling, and nothing here is wired into server.js or any API route yet
// (all deliberately deferred to a later phase — see that file's own comment for the full list).
//
// Lives under the SAME %ProgramData%\Studix\config\ directory as the runtime .env
// (lib/config.js) and admin.env (lib/provisioningAdminConfig.js) — no new ACL/installer work
// needed, since installer/studix.iss's existing [Dirs] entry for the whole
// {commonappdata}\Studix tree (admins-full system-full) already covers this file too via NTFS
// inheritance, exactly like those two files.
//
// Deliberately holds NO module-level mutable state — every function re-reads the on-disk file
// fresh. That is itself the crash-safety property: a real process restart (or a genuine crash)
// has nothing in memory to lose, because nothing was ever kept only in memory.
//
// Missing file vs. corrupt file are NEVER treated the same: a missing file is the expected,
// safe "no restore has ever run yet" case (returns the initial `idle` state); a file that
// EXISTS but fails to parse or fails shape validation throws RestoreStateError('corrupt_state',
// ...) instead of silently substituting a default — per the explicit instruction not to
// silently recover from contradictory on-disk state.
// ─────────────────────────────────────────────────────────────
import path from 'path';
import { writeJsonFileAtomic, readJsonFileOrNull } from './atomicJsonFile.js';

export class RestoreStateError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

export const RESTORE_STATUSES = Object.freeze([
  'idle', 'preparing', 'restoring', 'verified', 'switching', 'active',
  'rolling_back', 'rolled_back', 'failed',
]);

const SUB_STATUSES = Object.freeze(['pending', 'completed', 'failed']); // verificationStatus only

// Phase 2C-3B — the forward switch and its rollback each have several individually-crashable
// checkpoints (Phase 2C-3A §4's design). These are richer value domains for the SAME two
// existing fields (switchStatus/rollbackStatus) — not new top-level fields, not a redesign.
export const SWITCH_STATUSES = Object.freeze([
  'pending', 'app_stopping', 'app_stopped', 'connections_terminated',
  'current_renamed', 'candidate_renamed', 'app_starting', 'app_started',
  'health_verifying', 'completed', 'failed',
]);
export const ROLLBACK_STATUSES = Object.freeze([
  'pending', 'app_stopping', 'reverse_renaming', 'app_starting', 'app_started',
  'health_verifying', 'completed', 'failed',
]);

// ALLOWED_TRANSITIONS — the one authoritative state graph (Phase 2B §8/§9's design, made
// concrete). "idle" is reachable again only from a terminal outcome (active/rolled_back/
// failed) — never a shortcut from the middle of an in-flight operation, so a caller can never
// accidentally abandon a partially-completed restore by jumping straight back to idle.
//
// Phase 2C-3B adds exactly two self-loops (switching->switching, rolling_back->rolling_back) —
// required so the switch/rollback's own internal checkpoints (switchStatus/rollbackStatus,
// above) can be persisted progressively without changing the outer status, which would
// otherwise falsely signal "the switch/rollback finished" after every single sub-step.
//
// Phase 2C-3C Part 1 adds exactly one more, for the identical reason: verified->verified. A
// pre-flight failure (e.g. the cross-install check, or a candidate database that went missing
// before the switch ever began — databaseSwitch.js's own failure-redaction/recording wrapper)
// needs to persist a redacted `error` onto the existing 'verified' state WITHOUT advancing it —
// the switch never actually began, so falsely marking it 'failed' (a terminal state, escapable
// only via 'idle') would make an already-verified, still-good candidate un-retryable without
// re-running the entire restore from backup. No other edge changes; every previously-valid
// transition remains valid unchanged.
const ALLOWED_TRANSITIONS = Object.freeze({
  idle: Object.freeze(['preparing']),
  preparing: Object.freeze(['restoring', 'failed']),
  restoring: Object.freeze(['verified', 'failed']),
  verified: Object.freeze(['switching', 'verified', 'failed']),
  switching: Object.freeze(['switching', 'active', 'rolling_back', 'failed']),
  active: Object.freeze(['idle']),
  rolling_back: Object.freeze(['rolling_back', 'rolled_back', 'failed']),
  rolled_back: Object.freeze(['idle']),
  failed: Object.freeze(['idle']),
});

export function resolveRestoreStatePath() {
  if (process.env.STUDIX_RESTORE_STATE_PATH) return process.env.STUDIX_RESTORE_STATE_PATH;
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  return path.join(programData, 'Studix', 'config', 'restore-state.json');
}

function createInitialState() {
  return {
    status: 'idle',
    restoreId: null,
    previousDb: null,
    candidateDb: null,
    startedAt: null,
    updatedAt: null,
    verificationStatus: 'pending',
    switchStatus: 'pending',
    rollbackStatus: 'pending',
    error: null,
    // Phase 2C-3B — minimum additional fields the real switch/rollback needs for
    // deterministic crash recovery (Phase 2C-3A §4/§7):
    //   renamedPreviousDb   — the archival name the current production DB is renamed TO,
    //                         committed BEFORE rename #1 is attempted so a crash mid-rename
    //                         never leaves ambiguity about what name to look for.
    //   previousIdentityId  — databaseIdentity.js's active identity, captured before the
    //                         switch begins, so a rollback restores this EXACT value rather
    //                         than generating a fresh one.
    //   candidateIdentityId — the candidate's own identity, generated before the switch begins
    //                         and promoted to "active" only once the candidate rename succeeds.
    renamedPreviousDb: null,
    previousIdentityId: null,
    candidateIdentityId: null,
  };
}

const REQUIRED_STRING_OR_NULL_FIELDS = [
  'restoreId', 'previousDb', 'candidateDb', 'startedAt', 'updatedAt', 'error',
  'renamedPreviousDb', 'previousIdentityId', 'candidateIdentityId',
];

// validateStateShape: cheap, explicit structural validation — never guesses at a partially-
// matching shape. Any single field that fails is reported by name in the thrown message, so a
// corrupted/hand-edited file gets a clear, actionable error instead of a generic parse failure.
function validateStateShape(state) {
  const problems = [];
  if (!state || typeof state !== 'object') {
    return ['ملف حالة الاستعادة لا يحتوي كائن JSON صالحاً.'];
  }
  if (!RESTORE_STATUSES.includes(state.status)) {
    problems.push(`status="${state.status}" ليست إحدى الحالات المعروفة (${RESTORE_STATUSES.join(', ')}).`);
  }
  for (const field of REQUIRED_STRING_OR_NULL_FIELDS) {
    if (state[field] !== null && typeof state[field] !== 'string') {
      problems.push(`الحقل "${field}" يجب أن يكون نصاً أو null، وُجد: ${JSON.stringify(state[field])}.`);
    }
  }
  const SUB_STATUS_DOMAINS = {
    verificationStatus: SUB_STATUSES,
    switchStatus: SWITCH_STATUSES,
    rollbackStatus: ROLLBACK_STATUSES,
  };
  for (const [field, domain] of Object.entries(SUB_STATUS_DOMAINS)) {
    if (!domain.includes(state[field])) {
      problems.push(`الحقل "${field}"="${state[field]}" ليس إحدى (${domain.join(', ')}).`);
    }
  }
  return problems;
}

function corruptStateError(configPath, detail) {
  return new RestoreStateError(
    'corrupt_state',
    `ملف حالة الاستعادة عند ${configPath} موجود لكن محتواه غير صالح — تم الرفض بدل تخمين قيمة ` +
    `افتراضية (قد يخفي ذلك عملية استعادة جارية فعلياً). التفاصيل: ${detail}`
  );
}

/**
 * readRestoreState: missing file -> a fresh `idle` state (safe, expected default — no restore
 * has ever run on this installation, or the last one fully cycled back to idle and the file
 * was never deleted... in which case it exists and is read normally below). A PRESENT but
 * unparseable/invalid-shape file throws RestoreStateError('corrupt_state', ...) — never
 * silently replaced with the default.
 */
export function readRestoreState({
  configPath = resolveRestoreStatePath(),
  existsSync, readFileSync,
} = {}) {
  const parsed = readJsonFileOrNull(configPath, {
    existsSync, readFileSync,
    onCorrupt: (err) => corruptStateError(configPath, `JSON غير صالح: ${err.message}`),
  });
  if (parsed === null) return createInitialState();

  const problems = validateStateShape(parsed);
  if (problems.length > 0) {
    throw corruptStateError(configPath, problems.join(' | '));
  }
  return parsed;
}

/**
 * transitionRestoreState: the one write path. Reads the current on-disk state (propagating a
 * corrupt-state error rather than papering over it — see readRestoreState above), rejects any
 * transition not present in ALLOWED_TRANSITIONS for the CURRENT status, then atomically writes
 * the merged next state. `patch` may set previousDb/candidateDb/verificationStatus/etc.; its
 * own `status` key (if present) is ignored — `nextStatus` is always the single source of truth
 * for what status is being written.
 */
export function transitionRestoreState(nextStatus, patch = {}, {
  configPath = resolveRestoreStatePath(),
  existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, randomBytes,
  now = () => new Date().toISOString(),
} = {}) {
  if (!RESTORE_STATUSES.includes(nextStatus)) {
    throw new RestoreStateError('unknown_status', `"${nextStatus}" ليست إحدى حالات الاستعادة المعروفة.`);
  }

  const current = readRestoreState({ configPath, existsSync, readFileSync });
  const allowed = ALLOWED_TRANSITIONS[current.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new RestoreStateError(
      'invalid_transition',
      `الانتقال من الحالة "${current.status}" إلى "${nextStatus}" غير مسموح — الحالات المسموحة من ` +
      `"${current.status}": ${allowed.length ? allowed.join(', ') : '(لا شيء — حالة نهائية)'}.`
    );
  }

  const { status: _ignoredStatus, ...safePatch } = patch;
  const next = { ...current, ...safePatch, status: nextStatus, updatedAt: now() };

  const problems = validateStateShape(next);
  if (problems.length > 0) {
    throw new RestoreStateError('invalid_patch', `الحالة الناتجة عن هذا الانتقال غير صالحة: ${problems.join(' | ')}`);
  }

  writeJsonFileAtomic(configPath, next, { writeFileSync, renameSync, mkdirSync, randomBytes });
  return next;
}

/**
 * resetRestoreState: the one deliberate escape hatch that bypasses ALLOWED_TRANSITIONS
 * entirely — writes a fresh `idle` state unconditionally. Never called automatically by
 * readRestoreState/transitionRestoreState (a corrupt or stuck state is always surfaced as a
 * thrown error first); this exists for a future orchestrator/operator to call ONLY after
 * deliberately deciding a stuck/corrupt state is safe to discard — never a side effect of
 * merely reading or attempting a transition. As of Phase 2C-3C Part 5B-1, that "future
 * orchestrator" caller now exists — see advanceToIdleIfTerminal() below, the one guarded,
 * deliberate use of this escape hatch in production code.
 */
export function resetRestoreState({
  configPath = resolveRestoreStatePath(),
  writeFileSync, renameSync, mkdirSync, randomBytes,
} = {}) {
  const fresh = createInitialState();
  writeJsonFileAtomic(configPath, fresh, { writeFileSync, renameSync, mkdirSync, randomBytes });
  return fresh;
}

// TERMINAL_HISTORICAL_STATUSES — Phase 2C-3C Part 5B-1: the statuses ALLOWED_TRANSITIONS
// itself already declares can ONLY ever go to 'idle' next (active/rolled_back/failed — a
// genuinely finished operation, successful or not, kept purely for diagnostic/history value
// until a NEW restore operation deliberately begins). Derived directly FROM
// ALLOWED_TRANSITIONS, never a second, independently-maintained list — if that graph ever
// gains/loses an idle-only terminal status, this list can never silently drift out of sync
// with it.
const TERMINAL_HISTORICAL_STATUSES = Object.freeze(
  Object.keys(ALLOWED_TRANSITIONS).filter((status) => {
    const edges = ALLOWED_TRANSITIONS[status];
    return status !== 'idle' && edges.length === 1 && edges[0] === 'idle';
  })
);

/**
 * advanceToIdleIfTerminal: closes the exact dead-end Phase 2C-3C Part 5A's audit found —
 * resetRestoreState() existed but had zero production callers, so restore-state.json
 * permanently stuck at 'active'/'rolled_back'/'failed' after the FIRST switch/rollback/failed
 * restore ever run, permanently blocking any later, independent restore attempt
 * (runRestoreOrchestrator()'s own idle-only entry requirement).
 *
 * Deliberately narrow: reads the CURRENT on-disk state first (propagating a corrupt-state
 * error exactly like every other reader in this file — never silently "fixed") and only ever
 * calls resetRestoreState() when that state is ALREADY one of the three genuinely-terminal,
 * idle-only statuses above. Every other status — 'idle' itself, or any genuinely in-flight
 * status (preparing/restoring/verified/switching/rolling_back) — is returned completely
 * untouched; a caller's own subsequent idle-only transition attempt (e.g.
 * runRestoreOrchestrator()'s idle->preparing) still correctly rejects those exactly as before
 * this function existed. This is what keeps a genuinely in-flight operation safe from ever
 * being silently discarded by this call — the guard IS the safety property, not an incidental
 * detail.
 */
export function advanceToIdleIfTerminal(opts = {}) {
  const current = readRestoreState(opts);
  if (!TERMINAL_HISTORICAL_STATUSES.includes(current.status)) return current;
  return resetRestoreState(opts);
}
