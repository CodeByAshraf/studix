// tools/lib/licenseKeyStorage.js
// Owner-side key file location + load/save helpers for the Licensing issuer — a
// COMPLETELY SEPARATE key namespace from Support Access (tools/lib/keyStorage.js).
// Never share a keypair between the two: compromise or rotation of one must never affect
// the other. Same pattern, different directory/env-vars/filenames — see
// tools/lib/keyStorage.js's own header for the full rationale (repeated only where it
// differs below).
//
// Default location: <home directory>/StudixLicensing/license-private-key.pem — resolved
// dynamically via os.homedir(), never a hardcoded username or path. Fully overridable via
// environment variables.
import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_DIR_NAME = 'StudixLicensing';
const PRIVATE_KEY_FILENAME = 'license-private-key.pem';
const PUBLIC_KEY_FILENAME = 'license-public-key.pem';

export function resolveKeyDir() {
  return process.env.STUDIX_LICENSE_KEY_DIR || path.join(os.homedir(), DEFAULT_DIR_NAME);
}

export function resolvePrivateKeyPath() {
  return process.env.STUDIX_LICENSE_PRIVATE_KEY_PATH || path.join(resolveKeyDir(), PRIVATE_KEY_FILENAME);
}

export function resolvePublicKeyPath() {
  return process.env.STUDIX_LICENSE_PUBLIC_KEY_PATH || path.join(resolveKeyDir(), PUBLIC_KEY_FILENAME);
}

export function privateKeyExists(filePath = resolvePrivateKeyPath()) {
  return fs.existsSync(filePath);
}

// loadPrivateKeyPem: reads the PEM file as text. Never logs its content — the caller
// (license-issuer.js) passes this string straight into crypto.createPrivateKey/crypto.sign
// and never prints it. Throws a clear, actionable error if the file is missing.
export function loadPrivateKeyPem(filePath = resolvePrivateKeyPath()) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Licensing private key not found at: ${filePath}\n` +
      `Run "node tools/license-keygen.js" once to generate a new keypair, or set\n` +
      `STUDIX_LICENSE_PRIVATE_KEY_PATH to the correct location if you already have one.`
    );
  }
  return fs.readFileSync(filePath, 'utf8');
}

// saveKeyPairFiles: used only by license-keygen.js. Writes both PEM files to the resolved
// key directory (created if missing) and best-effort restricts the private key file's
// permissions to owner-only (POSIX chmod 0600 — a no-op on Windows NTFS). Never overwrites
// silently — license-keygen.js itself enforces the --force gate before calling this.
export function saveKeyPairFiles({ privateKeyPem, publicKeyPem, dir = resolveKeyDir() }) {
  fs.mkdirSync(dir, { recursive: true });
  const privatePath = resolvePrivateKeyPath();
  const publicPath = resolvePublicKeyPath();

  fs.writeFileSync(privatePath, privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(privatePath, 0o600); } catch { /* best-effort only — e.g. Windows NTFS */ }

  fs.writeFileSync(publicPath, publicKeyPem, 'utf8');

  return { privatePath, publicPath };
}
