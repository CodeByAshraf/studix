// tools/license-manager-gui/main/keyImport.test.js
// Option C (external private-key file import) — Phase 3 required coverage: plain PEM import,
// passphrase-encrypted PEM import, wrong-passphrase rejection, non-Ed25519-key rejection, and
// the "never copies the source file anywhere" guarantee.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { importExternalKeyFile } from './keyImport.js';

function makeTestKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-lm-keyimport-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('importExternalKeyFile — plain PEM (matches tools/license-keygen.js output shape)', () => {
  it('imports a plain unencrypted Ed25519 PKCS8 PEM file', () => {
    const { publicKey, privateKey } = makeTestKeyPair();
    const filePath = path.join(tmpDir, 'license-private-key.pem');
    fs.writeFileSync(filePath, privateKey, 'utf8');

    const result = importExternalKeyFile({ filePath });
    expect(result.publicKeyPem.trim()).toBe(publicKey.trim());
    expect(crypto.createPrivateKey(result.privateKeyPem).asymmetricKeyType).toBe('ed25519');
  });

  it('never copies or moves the source file anywhere', () => {
    const { privateKey } = makeTestKeyPair();
    const filePath = path.join(tmpDir, 'license-private-key.pem');
    fs.writeFileSync(filePath, privateKey, 'utf8');
    const filesBefore = fs.readdirSync(tmpDir);

    importExternalKeyFile({ filePath });

    expect(fs.readdirSync(tmpDir)).toEqual(filesBefore); // still exactly one file, untouched, nothing new written
    expect(fs.readFileSync(filePath, 'utf8')).toBe(privateKey); // source file itself unmodified
  });
});

describe('importExternalKeyFile — passphrase-encrypted PEM', () => {
  it('imports a passphrase-encrypted PKCS8 PEM with the correct passphrase', () => {
    const { publicKey, privateKey: plainPrivateKey } = makeTestKeyPair();
    const keyObj = crypto.createPrivateKey(plainPrivateKey);
    const encryptedPem = keyObj.export({
      type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'my-file-passphrase',
    });
    const filePath = path.join(tmpDir, 'encrypted-key.pem');
    fs.writeFileSync(filePath, encryptedPem, 'utf8');

    const result = importExternalKeyFile({ filePath, passphrase: 'my-file-passphrase' });
    expect(result.publicKeyPem.trim()).toBe(publicKey.trim());
  });

  it('rejects the wrong passphrase for an encrypted PEM', () => {
    const { privateKey: plainPrivateKey } = makeTestKeyPair();
    const keyObj = crypto.createPrivateKey(plainPrivateKey);
    const encryptedPem = keyObj.export({
      type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'the-real-passphrase',
    });
    const filePath = path.join(tmpDir, 'encrypted-key.pem');
    fs.writeFileSync(filePath, encryptedPem, 'utf8');

    expect(() => importExternalKeyFile({ filePath, passphrase: 'wrong-passphrase' })).toThrow(/not a valid|wrong/i);
  });
});

describe('importExternalKeyFile — rejects non-Ed25519 keys and garbage input', () => {
  it('rejects an RSA key with a clear, distinct error', () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const filePath = path.join(tmpDir, 'rsa-key.pem');
    fs.writeFileSync(filePath, privateKey, 'utf8');

    expect(() => importExternalKeyFile({ filePath })).toThrow(/ed25519/i);
  });

  it('rejects a garbage file with a clear error, not a crash', () => {
    const filePath = path.join(tmpDir, 'garbage.pem');
    fs.writeFileSync(filePath, 'this is not a PEM file at all', 'utf8');
    expect(() => importExternalKeyFile({ filePath })).toThrow(/not a valid/i);
  });

  it('rejects a missing file with a clear error', () => {
    expect(() => importExternalKeyFile({ filePath: path.join(tmpDir, 'nope.pem') })).toThrow(/no file found/i);
  });
});
