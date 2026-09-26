// backend/src/db/databaseIdentity.js
// ─────────────────────────────────────────────────────────────
// Phase 2C-1 — a stable identity marker for "which physical database is currently active",
// per the approved Phase 2B design (§11 "Frontend LocalStorage Strategy"). This lets a future
// boot-sync step detect that the active database changed underneath a browser that already has
// older localStorage state cached, WITHOUT relying on PostgreSQL row content itself (a restore
// to an older backup can look, from the data's own point of view, just like "some rows are
// missing" — the existing merge-by-id boot-sync already treats that as normal and harmless, see
// src/store/db.middleware.js's own "لا نلمس localStorage" contract, deliberately unchanged here).
//
// Deliberately file-based, NOT a database table/row (explicit instruction: "Do NOT add
// unnecessary schema changes") — lives under the same %ProgramData%\Studix\config\ directory
// as restoreState.js/lib/config.js/lib/provisioningAdminConfig.js, covered by the same existing
// installer ACL, no installer change needed.
//
// Scope of THIS phase: create/read the CURRENT ACTIVE identity (idempotent, exactly like
// lib/productionConfig.js's ensureProductionConfig — written once, never rotated as a side
// effect of reading it) and a pure generator for a CANDIDATE identity a future restore step can
// attach to a restore-state.json candidateDb entry. Actually ROTATING the active identity (the
// real "promote a verified candidate to active" step) is deliberately NOT implemented here —
// that is switch logic, out of scope for this phase (see this repo's Phase 2C-1 task).
// ─────────────────────────────────────────────────────────────
import path from 'path';
import crypto from 'crypto';
import { writeJsonFileAtomic, readJsonFileOrNull } from './atomicJsonFile.js';

export class DatabaseIdentityError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

const VALID_ROLES = Object.freeze(['active', 'candidate']);

export function resolveDatabaseIdentityPath() {
  if (process.env.STUDIX_DB_IDENTITY_PATH) return process.env.STUDIX_DB_IDENTITY_PATH;
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  return path.join(programData, 'Studix', 'config', 'db-identity.json');
}

function isValidIdentity(obj) {
  return !!obj && typeof obj === 'object'
    && typeof obj.id === 'string' && obj.id.length > 0
    && typeof obj.createdAt === 'string' && obj.createdAt.length > 0
    && VALID_ROLES.includes(obj.role);
}

/**
 * generateDatabaseIdentity: pure, no I/O — a fresh, unique identity value. Used both to create
 * the very first "active" identity (ensureActiveDatabaseIdentity below) and, by a future
 * restore step, to tag a not-yet-promoted candidate database (stored inside restoreState.js's
 * own candidateDb bookkeeping, never written to THIS file until an actual promotion happens).
 */
export function generateDatabaseIdentity({ role = 'active', randomUUID = crypto.randomUUID } = {}) {
  if (!VALID_ROLES.includes(role)) {
    throw new DatabaseIdentityError('invalid_role', `دور هوية غير معروف: "${role}" (المسموح: ${VALID_ROLES.join(', ')}).`);
  }
  return { id: randomUUID(), role, createdAt: new Date().toISOString() };
}

/**
 * readActiveDatabaseIdentity: null means "never created yet" (safe, expected — e.g. an
 * installation from before this phase, or a fresh install that hasn't called
 * ensureActiveDatabaseIdentity yet). A file that EXISTS but is unparseable or fails shape
 * validation throws DatabaseIdentityError('corrupt_identity', ...) — never silently replaced.
 */
export function readActiveDatabaseIdentity({
  configPath = resolveDatabaseIdentityPath(),
  existsSync, readFileSync,
} = {}) {
  const parsed = readJsonFileOrNull(configPath, {
    existsSync, readFileSync,
    onCorrupt: (err) => new DatabaseIdentityError(
      'corrupt_identity',
      `ملف هوية قاعدة البيانات عند ${configPath} موجود لكن محتواه JSON غير صالح: ${err.message}`
    ),
  });
  if (parsed === null) return null;
  if (!isValidIdentity(parsed)) {
    throw new DatabaseIdentityError(
      'corrupt_identity',
      `ملف هوية قاعدة البيانات عند ${configPath} موجود لكن شكله غير صالح (حقول مفقودة أو من نوع خاطئ) — تم الرفض بدل تخمين قيمة.`
    );
  }
  return parsed;
}

/**
 * ensureActiveDatabaseIdentity: idempotent creation — same idiom as lib/productionConfig.js's
 * ensureProductionConfig / lib/provisioningAdminConfig.js's ensureProvisioningAdminConfig.
 * If a valid identity already exists, it is returned completely unmodified — not read-then-
 * rewritten. Rotating this value is a deliberate future action (a real, verified database
 * switch), never an automatic side effect of merely ensuring/reading it.
 */
export function ensureActiveDatabaseIdentity({
  configPath = resolveDatabaseIdentityPath(),
  existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, randomBytes,
  randomUUID = crypto.randomUUID,
} = {}) {
  const existing = readActiveDatabaseIdentity({ configPath, existsSync, readFileSync });
  if (existing) return { created: false, identity: existing };

  const identity = generateDatabaseIdentity({ role: 'active', randomUUID });
  writeJsonFileAtomic(configPath, identity, { writeFileSync, renameSync, mkdirSync, randomBytes });
  return { created: true, identity };
}

/**
 * promoteActiveDatabaseIdentity: Phase 2C-3B — the ONE deliberate place this file's own
 * "never rotate automatically" rule is intentionally overridden, by DESIGN, for the one real
 * event that justifies it: a verified candidate database has just been renamed to become the
 * production database (databaseSwitch.js's own "candidate_renamed" checkpoint). Replaces the
 * active identity file wholesale with the caller-supplied `identity` object (already generated
 * earlier, at candidate-creation time, via generateDatabaseIdentity({role:'active'}) or by
 * re-tagging a previously-generated candidate identity — never generated fresh here, so a
 * later rollback can restore the EXACT prior value via the same function rather than a new one).
 */
export function promoteActiveDatabaseIdentity({
  configPath = resolveDatabaseIdentityPath(),
  identity,
  writeFileSync, renameSync, mkdirSync, randomBytes,
} = {}) {
  if (!identity || typeof identity.id !== 'string' || !identity.id || typeof identity.createdAt !== 'string' || !identity.createdAt) {
    throw new DatabaseIdentityError('invalid_identity', 'الهوية المُمرَّرة للترقية غير صالحة الشكل — تم الرفض بدل كتابتها.');
  }
  // Always written with role:'active' regardless of the input's own role field — promoting a
  // formerly-'candidate'-tagged identity IS what changes its role; the id/createdAt are kept
  // byte-for-byte (identity, not a fresh value) so a later rollback can restore the exact prior
  // active identity via this same function.
  const promoted = { id: identity.id, role: 'active', createdAt: identity.createdAt };
  writeJsonFileAtomic(configPath, promoted, { writeFileSync, renameSync, mkdirSync, randomBytes });
  return { identity: promoted };
}

/**
 * hasDatabaseIdentityChanged: pure comparison, the one primitive a future frontend-facing
 * endpoint/boot-sync step needs. Returns false (never true) when either side is missing —
 * "nothing to compare against yet" is not the same claim as "confirmed changed."
 */
export function hasDatabaseIdentityChanged(previousIdentity, currentIdentity) {
  if (!previousIdentity?.id || !currentIdentity?.id) return false;
  return previousIdentity.id !== currentIdentity.id;
}
