// backend/src/lib/supportAccessCache.js
// ─────────────────────────────────────────────────────────────
// Phase 4b — Support Access in-memory state: consumed/revoked challenge nonces + the
// active support-session registry. Same "single-process, in-memory Map/Set, by design"
// pattern as authCache.js (Decision 7 in that module's own contract) — this app is one
// Node process per tutoring-center desktop install, so there is no distributed-cache
// need here either. A server restart empties this state entirely, which is an accepted
// (and for this feature, actually desirable) limitation: every outstanding challenge and
// every active support session dies the moment the process restarts, on top of their own
// short embedded TTLs — never anything longer-lived than memory.
//
// PostgreSQL (support_access_config) stays authoritative for installation_id/public key
// (see supportAccess.js). Nothing security-relevant is ever derived from this cache alone
// without also re-checking the signed token's own embedded expiry/signature first.
// ─────────────────────────────────────────────────────────────

// nonce -> true (challenge already redeemed — anti-replay)
const consumedNonces = new Set();
// nonce -> true (challenge explicitly cancelled before it was ever redeemed)
const revokedNonces = new Set();
// sessionId -> { installationId, issuedAt, expiresAt, revoked }
const activeSessions = new Map();

export function isNonceConsumed(nonce) {
  return consumedNonces.has(nonce);
}

export function markNonceConsumed(nonce) {
  consumedNonces.add(nonce);
}

export function isNonceRevoked(nonce) {
  return revokedNonces.has(nonce);
}

export function revokeNonce(nonce) {
  revokedNonces.add(nonce);
}

export function registerSupportSession(sessionId, { installationId, issuedAt, expiresAt }) {
  activeSessions.set(sessionId, { installationId, issuedAt, expiresAt, revoked: false });
}

// isSupportSessionActive: fail-closed — أي غياب/انتهاء/إلغاء يُعيد false صراحةً، لا افتراضاً.
export function isSupportSessionActive(sessionId) {
  const entry = activeSessions.get(sessionId);
  if (!entry) return false;
  if (entry.revoked) return false;
  if (entry.expiresAt < Date.now()) return false;
  return true;
}

export function revokeSupportSession(sessionId) {
  const entry = activeSessions.get(sessionId);
  if (!entry) return false;
  entry.revoked = true;
  return true;
}

// getActiveSupportSession: تثبيت واحد لكل جهاز — يُعيد أحدث جلسة لا تزال فعّالة فعلياً
// (غير ملغاة، غير منتهية)، أو null. لا يفترض بنيوياً استحالة تعدّد الجلسات الفعّالة (لا
// حصر إجباري هنا)، فقط يُعيد الأحدث للعرض/الإلغاء اليدوي.
export function getActiveSupportSession() {
  let latest = null;
  for (const [id, entry] of activeSessions) {
    if (entry.revoked) continue;
    if (entry.expiresAt < Date.now()) continue;
    if (!latest || entry.issuedAt > latest.issuedAt) latest = { id, ...entry };
  }
  return latest;
}

export function revokeActiveSupportSession() {
  const active = getActiveSupportSession();
  if (!active) return false;
  return revokeSupportSession(active.id);
}

// clearAll: للاختبارات فقط — نفس دور authCache.js's clearAll، يُحاكي إعادة تشغيل الخادم.
export function clearAll() {
  consumedNonces.clear();
  revokedNonces.clear();
  activeSessions.clear();
}
