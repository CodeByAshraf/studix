// tools/lib/challengeSigning.js
// Pure, offline Support Access challenge signing — the exact inverse of
// backend/src/lib/supportChallengeFormat.js's verifyChallengeSignature.
//
// This module imports parseChallengeString directly from the backend's own pure
// format module (not a re-implementation — zero protocol-drift risk) but deliberately
// does NOT import anything that touches Prisma/the database (supportAccess.js,
// prisma.js) — this tool runs on the owner's own machine, fully offline, with no
// database connection, ever.
//
// Signing convention (must match backend/src/lib/supportChallengeFormat.js's
// verifyChallengeSignature exactly): sign the UTF-8 bytes of the challenge string
// *as received* (the base64url blob itself, not the decoded JSON) with Ed25519,
// algorithm=null (Ed25519 has its own built-in hash — no separate digest), and
// base64url-encode the raw signature bytes as the response.
import crypto from 'crypto';
import { parseChallengeString } from '../../backend/src/lib/supportChallengeFormat.js';

// validateChallengeLocally: parses and sanity-checks a challenge *before* ever touching
// the private key — this tool must never attempt to sign something malformed, and must
// warn the operator locally about an already-expired challenge rather than silently
// producing a response the server will reject anyway.
export function validateChallengeLocally(challengeString) {
  const trimmed = typeof challengeString === 'string' ? challengeString.trim() : '';
  if (!trimmed) return { ok: false, reason: 'empty' };

  const parsed = parseChallengeString(trimmed);
  if (!parsed) return { ok: false, reason: 'malformed' };

  if (parsed.exp < Date.now()) return { ok: false, reason: 'expired', parsed, challenge: trimmed };

  return { ok: true, parsed, challenge: trimmed };
}

const REASON_MESSAGES = {
  empty: 'The challenge is empty.',
  malformed: 'Not a valid Support Access challenge — make sure it was copied in full, with no extra characters.',
  expired: 'This challenge has already expired — ask the customer to generate a new one.',
  bad_private_key: 'Could not load the private key — the file does not contain a valid Ed25519 private key in PEM format.',
};

function rejectionError(reason) {
  const err = new Error(REASON_MESSAGES[reason] || 'Invalid Support Access challenge.');
  err.reason = reason;
  return err;
}

// signChallenge: the one function that actually touches the private key. Throws a plain
// Error (never exposing the key material) for every rejection case — malformed/expired
// challenge, or a private key file that doesn't parse as Ed25519.
export function signChallenge(challengeString, privateKeyPem) {
  const check = validateChallengeLocally(challengeString);
  if (!check.ok) throw rejectionError(check.reason);

  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(privateKeyPem);
  } catch {
    throw rejectionError('bad_private_key');
  }

  const signature = crypto.sign(null, Buffer.from(check.challenge, 'utf8'), privateKey);

  return {
    response: signature.toString('base64url'),
    installationId: check.parsed.installationId,
    nonce: check.parsed.nonce,
    expiresAt: check.parsed.exp,
  };
}
