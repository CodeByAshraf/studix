// tools/license-manager-gui/main/sessionState.js
// Studix License Manager — in-memory signing-key session state (Phase 3).
//
// This is the ONLY place the decrypted private key PEM is ever held while the app is running.
// It lives exclusively in the Electron MAIN process's memory (this module is never imported by
// renderer/preload code) and is never written to disk, never logged, and never returned to any
// IPC caller — see licenseHandlers.js for the one function (issueLicenseWithSessionKey) that
// reads it, and note that function's own return value never includes it either.
//
// Deliberately a plain module-level closure, not a class exposed outside this file — there is
// exactly one signing session per running app instance, matching how the existing CLI issuer
// (tools/license-issuer.js) already loads one key for its whole process lifetime.
let current = null; // { privateKeyPem, publicKeyPem, keyFingerprint, source } | null

export function setSessionKey({ privateKeyPem, publicKeyPem, keyFingerprint, source }) {
  current = { privateKeyPem, publicKeyPem, keyFingerprint, source };
}

// getSafeSessionInfo: the ONLY view of session state that may ever cross the IPC boundary to
// the renderer. Never includes privateKeyPem.
export function getSafeSessionInfo() {
  if (!current) return { unlocked: false };
  return {
    unlocked: true, publicKeyPem: current.publicKeyPem, keyFingerprint: current.keyFingerprint, source: current.source,
  };
}

// getSigningKeyPem: main-process-internal only (licenseHandlers.js). Never exported through
// preload/IPC — grep this file's export list before wiring any new IPC channel.
export function getSigningKeyPem() {
  return current ? current.privateKeyPem : null;
}

export function isUnlocked() {
  return current !== null;
}

// clearSession: used by the "مسح الجلسة" (clear session) button and on app quit. Overwrites
// the reference so the decrypted PEM string becomes eligible for garbage collection — Node
// strings are immutable so this cannot forcibly zero the underlying memory, the same
// inherent limitation every other part of this codebase's key handling already accepts
// (e.g. tools/lib/licenseKeyStorage.js's loadPrivateKeyPem has the same property).
export function clearSession() {
  current = null;
}
