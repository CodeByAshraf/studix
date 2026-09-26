// backend/src/routes/dbIdentity.js
// ─────────────────────────────────────────────────────────────
// Phase 2C-3C Part 3 — the authenticated HTTP surface for the ALREADY-EXISTING (Phase 2C-1)
// database-identity marker (db/databaseIdentity.js), reused here completely unmodified. That
// file's own header already documents this exact purpose: "This lets a future boot-sync step
// detect that the active database changed underneath a browser that already has older
// localStorage state cached" — this route is that future step's backend half. The frontend half
// (src/store/dbIdentity.js — checkDatabaseIdentityAndInvalidate) already exists too and already
// expects exactly the `{id, ...}` shape this route returns; wiring it in is explicitly a LATER
// phase (frontend changes are out of scope here).
//
// Deliberately does NOT open a PostgreSQL connection of its own — readActiveDatabaseIdentity()
// is a plain file read (db-identity.json, under the same %ProgramData%\Studix\config\ directory
// restore-state.json/admin.env already live in), not a database query. There is therefore no
// second database-client architecture here to create, and no DATABASE_URL/credential of any kind
// for this route to ever see, hold, or leak — the identity value itself is a random, non-
// sensitive UUID + timestamp by construction (databaseIdentity.js's own generateDatabaseIdentity).
// ─────────────────────────────────────────────────────────────
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { readActiveDatabaseIdentity, DatabaseIdentityError } from '../db/databaseIdentity.js';

function executionFailed(message, status = 500) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

/**
 * getDatabaseIdentitySafe: the route's testable core (same convention as license.js's
 * getLicenseStatusForActor — exported separately from the router). Returns exactly
 * `{id, createdAt}` (never `.role` — always 'active' for this file, an internal bookkeeping
 * detail with no use to an HTTP caller) or `null` if no identity has ever been created yet (a
 * fresh/never-restored install — the safe, expected default, not an error). A file that EXISTS
 * but fails to parse/validate throws a DatabaseIdentityError — reading a "no identity yet"
 * signal as this endpoint's own real output would let a genuinely corrupt marker masquerade as
 * "nothing changed," which is exactly the fail-closed distinction databaseIdentity.js's own
 * readActiveDatabaseIdentity already draws; this route only ever propagates it, never blurs it.
 */
export function getDatabaseIdentitySafe({
  readActiveDatabaseIdentityFn = readActiveDatabaseIdentity,
} = {}) {
  let identity;
  try {
    identity = readActiveDatabaseIdentityFn();
  } catch (err) {
    if (err instanceof DatabaseIdentityError) {
      throw executionFailed('تعذّر قراءة هوية قاعدة البيانات الحالية.', 500);
    }
    throw err;
  }
  if (!identity) return null;
  // Whitelisted fields only — `role` is internal bookkeeping (always 'active' here), never
  // returned; nothing else in the identity file's shape ever grows beyond id/role/createdAt
  // (databaseIdentity.js's own isValidIdentity), but this whitelist is explicit regardless.
  return { id: identity.id, createdAt: identity.createdAt };
}

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const identity = getDatabaseIdentitySafe();
  res.json({ ok: true, identity });
}));

export default router;
