// src/store/dbIdentity.js
// ─────────────────────────────────────────────────────────────
// Phase 2C-1 — frontend half of the database-identity cache-invalidation foundation (backend
// half: backend/src/db/databaseIdentity.js). Foundation only: nothing in this file is called
// from anywhere yet (no boot-sync wiring, no new API route exists yet to fetch a remote
// identity from) — see this repo's Phase 2C-1 task for the exact list of what's deferred.
//
// Why a dedicated localStorage key instead of folding this into useAppStore's own persisted
// 'studix-v1' blob: this value must survive and remain independently readable across a
// resetAppStore() call (which clears 'studix-v1' via persist.clearStorage()) — it needs to be
// the thing that DECIDES whether to call resetAppStore() in the first place, so it cannot live
// inside the state that decision is about to wipe.
//
// checkDatabaseIdentityAndInvalidate is the one integration point a future boot-sync step will
// call once the backend actually exposes the active database's identity to the frontend. On
// the very first run ever (no cached value yet), it only remembers the current identity —
// there is nothing yet to invalidate against, so resetAppStore() is never triggered by a fresh
// install or a browser that has simply never seen this value before.
// ─────────────────────────────────────────────────────────────
import { storage } from '../hooks/useErrorHandler';
import { resetAppStore } from './app.store';

export const DB_IDENTITY_STORAGE_KEY = 'studix-db-identity';

export function getCachedDatabaseIdentity() {
  return storage.get(DB_IDENTITY_STORAGE_KEY, null);
}

export function setCachedDatabaseIdentity(identity) {
  return storage.set(DB_IDENTITY_STORAGE_KEY, identity);
}

/**
 * checkDatabaseIdentityAndInvalidate: compares `remoteIdentity` (whatever the backend reports
 * as the currently-active database's identity) against the last value this browser cached.
 *   - no remoteIdentity (or malformed) -> no-op, nothing recorded, nothing wiped.
 *   - no cached value yet (first run) -> remembers remoteIdentity, does NOT wipe anything.
 *   - cached value matches remoteIdentity -> no-op (the common case, every ordinary boot).
 *   - cached value differs -> calls reset() (resetAppStore by default, unmodified) to clear the
 *     stale 'studix-v1' localStorage snapshot, THEN remembers the new remoteIdentity.
 * Returns { changed, reason } for the caller to log/report — never throws on a malformed
 * remoteIdentity, since a future caller of this function is a boot-time path that must never
 * itself crash the app.
 */
export function checkDatabaseIdentityAndInvalidate(remoteIdentity, {
  getCached = getCachedDatabaseIdentity,
  setCached = setCachedDatabaseIdentity,
  reset = resetAppStore,
} = {}) {
  if (!remoteIdentity?.id) {
    return { changed: false, reason: 'no_remote_identity' };
  }

  const cached = getCached();
  if (!cached?.id) {
    setCached(remoteIdentity);
    return { changed: false, reason: 'first_run' };
  }

  if (cached.id === remoteIdentity.id) {
    return { changed: false, reason: 'unchanged' };
  }

  reset();
  setCached(remoteIdentity);
  return { changed: true, reason: 'identity_mismatch' };
}
