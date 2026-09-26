// tools/license-manager-gui/main/keyStore.js
// Studix License Manager — Option A: passphrase-encrypted local key store (Phase 3, default
// key-protection strategy approved in the Phase 2 audit).
//
// Deliberately Electron-free (no `import ... from 'electron'` anywhere in this file) so it is
// directly unit-testable under plain vitest/Node, exactly like this codebase's existing
// injectable-IO modules (backend/src/lib/machineIdentity.js, backend/src/lib/windowsService.js).
//
// File format (JSON on disk):
//   {
//     v: 1, kdf: 'scrypt', kdfParams: { N, r, p, keyLen },
//     salt, iv, authTag, ciphertext: <base64>,   // AES-256-GCM(privateKeyPem) under scrypt(passphrase, salt)
//     publicKeyPem: <PEM text, plaintext — safe to store unencrypted>,
//     keyFingerprint: <sha256 hex of publicKeyPem>,
//     createdAt: <ms>,
//   }
//
// Only the PRIVATE key material is encrypted. The public key and fingerprint are stored in
// clear text alongside it deliberately — they are safe to expose (the public key is meant to
// be shared with every customer installation) and let the GUI show "which key is this" before
// unlocking, without ever touching the encrypted payload.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keyLen: 32 };
const STORE_VERSION = 1;

export function computeFingerprint(publicKeyPem) {
  return crypto.createHash('sha256').update(publicKeyPem, 'utf8').digest('hex');
}

// deriveKey: `params` defaults to the CURRENT scrypt parameters (used when creating a new
// store) but unlockKeyStore always passes the params actually read back from the store file
// being opened (Phase 4 audit fix C-4) — a future change to SCRYPT_PARAMS must not silently
// break decryption of key stores already created under the old parameters; the file is the
// source of truth for its own KDF params, not this module's current constant.
function deriveKey(passphrase, saltBuf, params = SCRYPT_PARAMS) {
  return crypto.scryptSync(passphrase, saltBuf, params.keyLen, {
    N: params.N, r: params.r, p: params.p,
  });
}

export function keyStoreExists(filePath) {
  return fs.existsSync(filePath);
}

// createKeyStore: writes a brand-new encrypted store. Refuses to overwrite an existing file
// unless `overwrite: true` is passed explicitly — mirrors tools/license-keygen.js's own
// refuse-without---force pattern, and satisfies "never migrate/overwrite an existing key
// without explicit action" (this function is never called implicitly by any other module in
// this app; only a direct, explicit GUI action wires to it).
export function createKeyStore({ filePath, privateKeyPem, publicKeyPem, passphrase, overwrite = false }) {
  if (!filePath) throw new Error('filePath is required.');
  if (!privateKeyPem || !publicKeyPem) throw new Error('Both privateKeyPem and publicKeyPem are required.');
  if (!passphrase || passphrase.length < 8) throw new Error('Passphrase must be at least 8 characters.');
  if (fs.existsSync(filePath) && !overwrite) {
    throw new Error(`A key store already exists at ${filePath}. Refusing to overwrite without explicit confirmation.`);
  }

  // Validate the key really is a usable Ed25519 private key before ever encrypting/writing it
  // — never persist something that would fail to load back later.
  crypto.createPrivateKey(privateKeyPem);

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const derivedKey = deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKeyPem, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const store = {
    v: STORE_VERSION,
    kdf: 'scrypt',
    kdfParams: SCRYPT_PARAMS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    publicKeyPem,
    keyFingerprint: computeFingerprint(publicKeyPem),
    createdAt: Date.now(),
  };

  // Atomic write (Phase 4 audit fix C-2): write to a sibling .tmp file, then rename it onto
  // the real destination. Matters most for the `overwrite: true` path — an interruption
  // (crash, power loss) mid-write must never leave the operator's ONLY copy of an existing
  // protected key half-written and unrecoverable. fs.renameSync is atomic on the same NTFS
  // volume, so the destination is always either the old complete file or the new complete
  // file, never a partial one.
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(tmpPath, 0o600); } catch { /* best-effort only — e.g. Windows NTFS */ }
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup only */ }
    throw err;
  }

  return { filePath, publicKeyPem, keyFingerprint: store.keyFingerprint };
}

// peekKeyStorePublicInfo: reads the UNENCRYPTED parts of a store file (public key, fingerprint,
// createdAt) without a passphrase — lets the GUI show "this is the key you're about to unlock"
// before asking for the passphrase, without ever touching the encrypted payload.
export function peekKeyStorePublicInfo(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`No key store found at ${filePath}.`);
  const store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (store.v !== STORE_VERSION) throw new Error(`Unsupported key store version: ${store.v}.`);
  return { publicKeyPem: store.publicKeyPem, keyFingerprint: store.keyFingerprint, createdAt: store.createdAt };
}

// unlockKeyStore: the ONLY function in this module that ever produces a decrypted private key
// PEM. Throws a single generic error on ANY failure (missing file, wrong passphrase, corrupted
// ciphertext, bad auth tag) — deliberately not distinguishing "wrong passphrase" from
// "corrupted file" in the thrown message, to avoid leaking which one it is to anything logging
// this error. Returns the PEM in memory only; the caller (licenseHandlers.js) is responsible
// for routing it into sessionState.js and never letting it reach an IPC response.
export function unlockKeyStore({ filePath, passphrase }) {
  if (!fs.existsSync(filePath)) throw new Error(`No key store found at ${filePath}.`);
  let store;
  try {
    store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('Key store file is not valid — cannot read it.');
  }
  if (store.v !== STORE_VERSION || store.kdf !== 'scrypt') {
    throw new Error('Unsupported or unrecognized key store format.');
  }

  try {
    const salt = Buffer.from(store.salt, 'base64');
    const iv = Buffer.from(store.iv, 'base64');
    const authTag = Buffer.from(store.authTag, 'base64');
    const ciphertext = Buffer.from(store.ciphertext, 'base64');
    const derivedKey = deriveKey(passphrase, salt, store.kdfParams);

    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(authTag);
    const privateKeyPem = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

    // Confirm it's actually a usable key before declaring success.
    crypto.createPrivateKey(privateKeyPem);

    return { privateKeyPem, publicKeyPem: store.publicKeyPem, keyFingerprint: store.keyFingerprint };
  } catch {
    throw new Error('Incorrect passphrase, or the key store file is corrupted.');
  }
}
