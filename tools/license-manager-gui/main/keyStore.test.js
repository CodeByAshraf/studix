// tools/license-manager-gui/main/keyStore.test.js
// Option A (passphrase-encrypted local key store) — Phase 3 required coverage: create,
// unlock with correct passphrase, reject incorrect passphrase, plus the refuse-to-overwrite
// and public-peek-without-passphrase guarantees the GUI relies on. Uses a real temp directory
// on disk (no mocks) — never touches the real STUDIX_LICENSE_KEY_DIR used by the existing CLI
// tools (tools/lib/licenseKeyStorage.js is a completely separate module, untouched).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  createKeyStore, unlockKeyStore, keyStoreExists, peekKeyStorePublicInfo, computeFingerprint,
} from './keyStore.js';

function makeTestKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

let tmpDir;
let storePath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-lm-keystore-'));
  storePath = path.join(tmpDir, 'license-key.store.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createKeyStore + unlockKeyStore — round trip', () => {
  it('creates an encrypted store and unlocks it with the correct passphrase', () => {
    const { publicKey, privateKey } = makeTestKeyPair();
    const created = createKeyStore({ filePath: storePath, privateKeyPem: privateKey, publicKeyPem: publicKey, passphrase: 'correct-horse-battery-staple' });
    expect(created.filePath).toBe(storePath);
    expect(keyStoreExists(storePath)).toBe(true);

    const unlocked = unlockKeyStore({ filePath: storePath, passphrase: 'correct-horse-battery-staple' });
    expect(unlocked.privateKeyPem).toBe(privateKey);
    expect(unlocked.publicKeyPem).toBe(publicKey);
    expect(unlocked.keyFingerprint).toBe(computeFingerprint(publicKey));
  });

  it('rejects an incorrect passphrase', () => {
    const { publicKey, privateKey } = makeTestKeyPair();
    createKeyStore({ filePath: storePath, privateKeyPem: privateKey, publicKeyPem: publicKey, passphrase: 'the-real-passphrase' });

    expect(() => unlockKeyStore({ filePath: storePath, passphrase: 'wrong-passphrase' })).toThrow(/incorrect passphrase/i);
  });

  it('the on-disk file never contains the plaintext private key PEM', () => {
    const { publicKey, privateKey } = makeTestKeyPair();
    createKeyStore({ filePath: storePath, privateKeyPem: privateKey, publicKeyPem: publicKey, passphrase: 'some-passphrase-123' });

    const raw = fs.readFileSync(storePath, 'utf8');
    expect(raw).not.toContain(privateKey);
    expect(raw).not.toContain('BEGIN PRIVATE KEY');
  });

  it('refuses to overwrite an existing store without overwrite:true', () => {
    const a = makeTestKeyPair();
    const b = makeTestKeyPair();
    createKeyStore({ filePath: storePath, privateKeyPem: a.privateKey, publicKeyPem: a.publicKey, passphrase: 'first-passphrase' });

    expect(() => createKeyStore({ filePath: storePath, privateKeyPem: b.privateKey, publicKeyPem: b.publicKey, passphrase: 'second-passphrase' }))
      .toThrow(/already exists/i);

    // Confirm the original key is genuinely untouched.
    const unlocked = unlockKeyStore({ filePath: storePath, passphrase: 'first-passphrase' });
    expect(unlocked.privateKeyPem).toBe(a.privateKey);
  });

  it('overwrite:true explicitly replaces an existing store', () => {
    const a = makeTestKeyPair();
    const b = makeTestKeyPair();
    createKeyStore({ filePath: storePath, privateKeyPem: a.privateKey, publicKeyPem: a.publicKey, passphrase: 'first-passphrase' });
    createKeyStore({ filePath: storePath, privateKeyPem: b.privateKey, publicKeyPem: b.publicKey, passphrase: 'second-passphrase', overwrite: true });

    const unlocked = unlockKeyStore({ filePath: storePath, passphrase: 'second-passphrase' });
    expect(unlocked.privateKeyPem).toBe(b.privateKey);
  });

  it('rejects a too-short passphrase at creation time', () => {
    const { publicKey, privateKey } = makeTestKeyPair();
    expect(() => createKeyStore({ filePath: storePath, privateKeyPem: privateKey, publicKeyPem: publicKey, passphrase: 'short' }))
      .toThrow(/at least 8 characters/i);
  });

  it('rejects a malformed private key at creation time, before ever writing a file', () => {
    const { publicKey } = makeTestKeyPair();
    expect(() => createKeyStore({ filePath: storePath, privateKeyPem: 'not a real key', publicKeyPem: publicKey, passphrase: 'a-fine-passphrase' })).toThrow();
    expect(fs.existsSync(storePath)).toBe(false);
  });
});

describe('peekKeyStorePublicInfo — no passphrase required, never exposes the encrypted payload', () => {
  it('returns the public key and fingerprint without needing a passphrase', () => {
    const { publicKey, privateKey } = makeTestKeyPair();
    createKeyStore({ filePath: storePath, privateKeyPem: privateKey, publicKeyPem: publicKey, passphrase: 'irrelevant-here' });

    const info = peekKeyStorePublicInfo(storePath);
    expect(info.publicKeyPem).toBe(publicKey);
    expect(info.keyFingerprint).toBe(computeFingerprint(publicKey));
    expect(info).not.toHaveProperty('ciphertext');
    expect(info).not.toHaveProperty('privateKeyPem');
  });

  it('throws a clear error for a missing file', () => {
    expect(() => peekKeyStorePublicInfo(path.join(tmpDir, 'does-not-exist.json'))).toThrow(/no key store found/i);
  });
});

// Phase 4 audit fix C-2: atomic write (write to .tmp, then rename onto the destination).
describe('createKeyStore — atomic write (Phase 4, C-2)', () => {
  it('leaves no leftover .tmp file after a successful write', () => {
    const { publicKey, privateKey } = makeTestKeyPair();
    createKeyStore({ filePath: storePath, privateKeyPem: privateKey, publicKeyPem: publicKey, passphrase: 'atomic-write-ok' });

    expect(fs.existsSync(`${storePath}.tmp`)).toBe(false);
    expect(fs.existsSync(storePath)).toBe(true);
  });

  it('cleans up the .tmp file if the final rename fails, and never leaves a partial destination file', () => {
    const { publicKey, privateKey } = makeTestKeyPair();
    // Force the rename step to fail: pre-create a DIRECTORY at the destination path — a file
    // can never be renamed onto an existing directory, so this reliably fails after the .tmp
    // write already succeeded, exercising the cleanup path.
    fs.mkdirSync(storePath);

    expect(() => createKeyStore({ filePath: storePath, privateKeyPem: privateKey, publicKeyPem: publicKey, passphrase: 'atomic-write-fail' })).toThrow();

    expect(fs.existsSync(`${storePath}.tmp`)).toBe(false); // cleaned up, not left behind
    expect(fs.statSync(storePath).isDirectory()).toBe(true); // destination untouched (still the directory, not a partial file)
  });
});

// Phase 4 audit fix C-4: the KDF parameters embedded in a store file are honored on unlock,
// not silently overridden by this module's current SCRYPT_PARAMS constant.
describe('unlockKeyStore — honors the kdfParams stored in the file, not the current constant (Phase 4, C-4)', () => {
  it('decrypts correctly even when the file was encrypted with DIFFERENT (but internally consistent) scrypt params than the module\'s current default', () => {
    const { publicKey, privateKey } = makeTestKeyPair();
    const passphrase = 'different-kdf-params-passphrase';

    // Hand-construct a store file exactly like createKeyStore would, but with deliberately
    // different scrypt params (N=4096 instead of the module's current 16384) — proving
    // unlockKeyStore reads and uses whatever is actually in the file, not a hardcoded value.
    const altParams = { N: 4096, r: 8, p: 1, keyLen: 32 };
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const derivedKey = crypto.scryptSync(passphrase, salt, altParams.keyLen, { N: altParams.N, r: altParams.r, p: altParams.p });
    const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
    const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const store = {
      v: 1, kdf: 'scrypt', kdfParams: altParams,
      salt: salt.toString('base64'), iv: iv.toString('base64'), authTag: authTag.toString('base64'), ciphertext: ciphertext.toString('base64'),
      publicKeyPem: publicKey, keyFingerprint: computeFingerprint(publicKey), createdAt: Date.now(),
    };
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');

    const unlocked = unlockKeyStore({ filePath: storePath, passphrase });
    expect(unlocked.privateKeyPem).toBe(privateKey);
  });
});
