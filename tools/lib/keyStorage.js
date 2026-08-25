// tools/lib/keyStorage.js
// Owner-side key file location + load/save helpers for the Support Access signer.
//
// The private key NEVER lives inside this repository, is NEVER read from any environment
// variable value that could end up in a committed file (e.g. backend/.env), and is NEVER
// generated automatically as a side effect of normal signing — see support-keygen.js for
// the one explicit, separate command that creates it.
//
// Default location: <home directory>/StudixSupport/support-private-key.pem — the home
// directory is resolved dynamically via os.homedir() (whatever OS user runs this tool),
// never a hardcoded username or path. Fully overridable via environment variables for
// operators who prefer a different location (e.g. a removable encrypted drive).
import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_DIR_NAME = 'StudixSupport';
const PRIVATE_KEY_FILENAME = 'support-private-key.pem';
const PUBLIC_KEY_FILENAME = 'support-public-key.pem';

export function resolveKeyDir() {
  return process.env.STUDIX_SUPPORT_KEY_DIR || path.join(os.homedir(), DEFAULT_DIR_NAME);
}

export function resolvePrivateKeyPath() {
  return process.env.STUDIX_SUPPORT_PRIVATE_KEY_PATH || path.join(resolveKeyDir(), PRIVATE_KEY_FILENAME);
}

export function resolvePublicKeyPath() {
  return process.env.STUDIX_SUPPORT_PUBLIC_KEY_PATH || path.join(resolveKeyDir(), PUBLIC_KEY_FILENAME);
}

export function privateKeyExists(filePath = resolvePrivateKeyPath()) {
  return fs.existsSync(filePath);
}

// loadPrivateKeyPem: reads the PEM file as text. Never logs its content — the caller
// (support-signer.js) passes this string straight into crypto.createPrivateKey/crypto.sign
// and never prints it. Throws a clear, actionable error if the file is missing — this tool
// must never silently fall back to generating a key on its own.
export function loadPrivateKeyPem(filePath = resolvePrivateKeyPath()) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Support Access private key not found at: ${filePath}\n` +
      `Run "node tools/support-keygen.js" once to generate a new keypair, or set\n` +
      `STUDIX_SUPPORT_PRIVATE_KEY_PATH to the correct location if you already have one.`
    );
  }
  return fs.readFileSync(filePath, 'utf8');
}

// saveKeyPairFiles: used only by support-keygen.js. Writes both PEM files to the resolved
// key directory (created if missing) and best-effort restricts the private key file's
// permissions to owner-only (POSIX chmod 0600 — a no-op on Windows NTFS, which uses ACLs
// instead; the write itself already targets a directory outside any web/app root, which is
// the real protection on Windows). Never overwrites silently — support-keygen.js itself
// enforces the --force gate before calling this.
export function saveKeyPairFiles({ privateKeyPem, publicKeyPem, dir = resolveKeyDir() }) {
  fs.mkdirSync(dir, { recursive: true });
  const privatePath = resolvePrivateKeyPath();
  const publicPath = resolvePublicKeyPath();

  fs.writeFileSync(privatePath, privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(privatePath, 0o600); } catch { /* best-effort only — e.g. Windows NTFS */ }

  fs.writeFileSync(publicPath, publicKeyPem, 'utf8');

  return { privatePath, publicPath };
}
