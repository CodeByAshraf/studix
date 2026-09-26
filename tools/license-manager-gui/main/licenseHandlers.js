// tools/license-manager-gui/main/licenseHandlers.js
// Studix License Manager — the "GUI-facing core" (Phase 3): the thin, Electron-free layer that
// sits between the IPC boundary and two things, both reused unmodified:
//   - tools/license-manager-gui/core/licenseCore.js (Phase 2 — the exact existing licensing
//     protocol: parseCustomerRequestCode, issueLicense, PRODUCT_ID)
//   - sessionState.js (Phase 3 — the in-memory unlocked signing key)
//
// This file contains NO cryptography, NO serialization, and NO payload-shape logic of its own
// — it only (a) parses a request code via the real core, (b) reads the currently-unlocked key
// from sessionState and calls the real core's issueLicense with it, and (c) shapes the result
// for safe display, stripping nothing the protocol defines but adding nothing new either.
import { PRODUCT_ID, parseCustomerRequestCode, issueLicense } from '../core/licenseCore.js';
import { getSigningKeyPem, isUnlocked } from './sessionState.js';

export { PRODUCT_ID };

// parseRequestCode: identical contract to core/licenseCore.js's parseCustomerRequestCode —
// exists here only so the IPC layer has one obvious "GUI-facing" import surface. Never touches
// the signing key.
export function parseRequestCode(code) {
  return parseCustomerRequestCode(code);
}

// issueLicenseWithSessionKey: the ONLY function in this app that produces a signed artifact
// through the GUI. Reads the private key from sessionState.js (never accepts one as a
// parameter from the caller — the renderer/IPC layer has no way to hand this function a key,
// by construction), delegates the actual signing to the real, unmodified issueLicense(), and
// returns a result shape that never includes privateKeyPem (issueLicense's own return value
// already never includes it — see tools/lib/licenseIssuing.js — this is not a redaction step,
// just a pass-through of an already-safe shape).
export function issueLicenseWithSessionKey(params) {
  if (!isUnlocked()) {
    const err = new Error('No signing key is unlocked for this session.');
    err.reason = 'key_not_unlocked';
    throw err;
  }
  const privateKeyPem = getSigningKeyPem();
  return issueLicense(params, privateKeyPem);
}
