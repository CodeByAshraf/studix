// backend/src/lib/licensingTrustAnchor.js
// ─────────────────────────────────────────────────────────────────────────────
// P1-3 — the licensing TRUST ANCHOR, shipped with the release (not configured per install).
//
// This is the owner's licensing PUBLIC key (Ed25519, SPKI). Only a PUBLIC key ever lives here:
// the matching private key stays exclusively with the owner's issuing workflow
// (tools/license-keygen.js → <home>/StudixLicensing/, tools/license-issuer.js, the License
// Manager GUI) and is never part of Studix, the installer, this source tree, or the database.
//
// How it is used:
//   - installation (installer/firstInstall.js → provisionLicensingPublicKey) writes it into
//     license_config.licensing_public_key automatically — no manual psql step;
//   - at runtime (lib/license.js) the database value is only trusted when it is the SAME key as
//     this anchor; a divergent database key fails closed ('trust_anchor_mismatch'), so a
//     database-only edit can no longer make a self-signed license verify.
//
// Rotating the licensing keypair = replacing this constant in a new release (and re-issuing
// licenses); the next install/upgrade re-provisions the database value to match.
// EXPECTED_LICENSING_PUBLIC_KEY_SHA256 guards against accidental edits (see its unit test).
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';

export const EXPECTED_LICENSING_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAY0rwdewGJlYYsHaIcmtnBctS2558WM7WLw+tiSDZvS4=
-----END PUBLIC KEY-----
`;

// sha256 of the key's DER-encoded SPKI — the value the owner can compare against
// `tools/license-keygen.js` output / their own key file to confirm which key a release trusts.
export const EXPECTED_LICENSING_PUBLIC_KEY_SHA256 =
  '09bf4b2c4274e5111d27f5430907c47abf9a7782845eeb4cbbd3eb83efff0fd5';

// The single accessor every consumer uses (so tests can substitute their own throwaway anchor
// via vi.mock of this module — the same technique already used for machineIdentity.js).
export function getExpectedLicensingPublicKeyPem() {
  return EXPECTED_LICENSING_PUBLIC_KEY_PEM;
}

// sha256 (hex) of a PEM public key's DER SPKI, or null when the value is not a parseable
// public key. Comparing DER — not PEM text — makes the check immune to line-ending/whitespace
// differences in how the PEM was stored.
export function publicKeyFingerprint(pem) {
  if (typeof pem !== 'string' || !pem.trim()) return null;
  try {
    const der = crypto.createPublicKey(pem.trim()).export({ type: 'spki', format: 'der' });
    return crypto.createHash('sha256').update(der).digest('hex');
  } catch {
    return null;
  }
}

// true only when both are parseable public keys and they are the same key.
export function isSamePublicKey(a, b) {
  const fa = publicKeyFingerprint(a);
  return fa !== null && fa === publicKeyFingerprint(b);
}

// Idempotent installation step: makes license_config.licensing_public_key hold the trust
// anchor. Touches ONLY that column (and creates the singleton row when missing) — never
// license_artifact/activation fields, so an already-activated license signed by the anchor
// stays activated. `client` is any Prisma client (the installer passes its admin client).
// Returns { action: 'created' | 'provisioned' | 'unchanged' | 'corrected', ... }.
export async function provisionLicensingPublicKey(client, { expectedPublicKeyPem = getExpectedLicensingPublicKeyPem() } = {}) {
  const expectedFingerprint = publicKeyFingerprint(expectedPublicKeyPem);
  if (!expectedFingerprint) {
    throw new Error('مفتاح الترخيص العام المُضمَّن في هذا الإصدار غير صالح — لا يمكن التزويد.');
  }

  const existing = await client.license_config.findUnique({ where: { id: 1 }, select: { licensing_public_key: true } });
  if (!existing) {
    try {
      await client.license_config.create({ data: { id: 1, licensing_public_key: expectedPublicKeyPem } });
      return { action: 'created', fingerprint: expectedFingerprint };
    } catch (err) {
      if (err?.code !== 'P2002') throw err; // concurrent creator won — fall through and re-check
    }
    return provisionLicensingPublicKey(client, { expectedPublicKeyPem });
  }

  if (!existing.licensing_public_key) {
    await client.license_config.update({ where: { id: 1 }, data: { licensing_public_key: expectedPublicKeyPem } });
    return { action: 'provisioned', fingerprint: expectedFingerprint };
  }

  if (isSamePublicKey(existing.licensing_public_key, expectedPublicKeyPem)) {
    return { action: 'unchanged', fingerprint: expectedFingerprint };
  }

  // A different (or unparseable) key: the release anchor is authoritative. Restore it, and
  // report the replaced fingerprint so the installer output makes the divergence visible.
  await client.license_config.update({ where: { id: 1 }, data: { licensing_public_key: expectedPublicKeyPem } });
  return {
    action: 'corrected',
    fingerprint: expectedFingerprint,
    previousFingerprint: publicKeyFingerprint(existing.licensing_public_key),
  };
}
