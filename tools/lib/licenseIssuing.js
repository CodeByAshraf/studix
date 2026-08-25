// tools/lib/licenseIssuing.js
// Pure, offline license issuing — imports the real backend format module directly (not a
// re-implementation — zero protocol-drift risk), exactly like
// tools/lib/challengeSigning.js already does for Support Access. Deliberately does NOT
// import anything that touches Prisma/the database (license.js, prisma.js) — this tool
// runs on the owner's own machine, fully offline, with no database connection, ever.
import crypto from 'crypto';
import {
  PRODUCT_ID, buildLicenseArtifactPayload, parseActivationRequestCode,
} from '../../backend/src/lib/licenseArtifactFormat.js';

export { PRODUCT_ID };

// parseCustomerRequestCode: decodes the Activation Request Code a customer relays
// out-of-band (built by requestActivationCode()/buildActivationRequestCode() on their own
// installation — backend/src/lib/license.js, unmodified). Throws a clear error on anything
// malformed rather than ever attempting to sign garbage.
export function parseCustomerRequestCode(code) {
  const parsed = parseActivationRequestCode(code);
  if (!parsed) {
    const err = new Error('Not a valid Activation Request Code — make sure it was copied in full, with no extra characters.');
    err.reason = 'malformed_request_code';
    throw err;
  }
  return parsed; // { v, installationId, product }
}

const REASON_MESSAGES = {
  missing_installation_id: 'installationId is required to issue a license.',
  missing_product: 'product is required to issue a license.',
  bad_private_key: 'Could not load the private key — the file does not contain a valid Ed25519 private key in PEM format.',
};

function rejectionError(reason) {
  const err = new Error(REASON_MESSAGES[reason] || 'Could not issue this license.');
  err.reason = reason;
  return err;
}

// issueLicense: the one function that actually touches the private key. Builds the exact
// same payload shape the backend verifier expects (via buildLicenseArtifactPayload,
// imported — not duplicated), signs the payloadB64 bytes with Ed25519, and returns the
// self-contained artifact string ("<payloadB64>.<signatureB64>") ready to hand back to the
// customer. Supports both perpetual (expiresAt: null/omitted) and expiring licenses.
export function issueLicense({
  licenseId, installationId, product = PRODUCT_ID, expiresAt = null, features = null, notes = null,
}, privateKeyPem) {
  if (!installationId) throw rejectionError('missing_installation_id');
  if (!product) throw rejectionError('missing_product');

  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(privateKeyPem);
  } catch {
    throw rejectionError('bad_private_key');
  }

  const finalLicenseId = licenseId || `lic_${crypto.randomUUID()}`;
  const issuedAt = Date.now();
  const payloadB64 = buildLicenseArtifactPayload({
    licenseId: finalLicenseId, product, installationId, issuedAt, expiresAt, features, notes,
  });
  const signature = crypto.sign(null, Buffer.from(payloadB64, 'utf8'), privateKey);
  const artifact = `${payloadB64}.${signature.toString('base64url')}`;

  return {
    artifact,
    licenseId: finalLicenseId,
    installationId,
    product,
    issuedAt,
    expiresAt: expiresAt ?? null,
    features: features ?? null,
    notes: notes ?? null,
  };
}
