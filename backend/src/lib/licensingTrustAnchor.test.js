// backend/src/lib/licensingTrustAnchor.test.js
// P1-3 — unit tests for the release licensing trust anchor. Pure (no database); the
// provisioning + runtime pin behavior against real PostgreSQL lives in
// licensingTrustAnchor.integration.test.js.
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  EXPECTED_LICENSING_PUBLIC_KEY_PEM, EXPECTED_LICENSING_PUBLIC_KEY_SHA256,
  getExpectedLicensingPublicKeyPem, publicKeyFingerprint, isSamePublicKey,
} from './licensingTrustAnchor.js';

const newKey = () => crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

describe('licensingTrustAnchor — embedded release key', () => {
  it('is a parseable Ed25519 PUBLIC key whose SPKI sha256 equals the recorded fingerprint (guards accidental edits)', () => {
    const key = crypto.createPublicKey(EXPECTED_LICENSING_PUBLIC_KEY_PEM);
    expect(key.type).toBe('public');
    expect(key.asymmetricKeyType).toBe('ed25519');
    expect(publicKeyFingerprint(EXPECTED_LICENSING_PUBLIC_KEY_PEM)).toBe(EXPECTED_LICENSING_PUBLIC_KEY_SHA256);
  });

  it('getExpectedLicensingPublicKeyPem() returns the embedded key', () => {
    expect(getExpectedLicensingPublicKeyPem()).toBe(EXPECTED_LICENSING_PUBLIC_KEY_PEM);
  });

  it('the module never contains private key material', () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'licensingTrustAnchor.js'), 'utf8');
    expect(src).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
  });
});

describe('licensingTrustAnchor — key comparison', () => {
  it('treats the same key as equal regardless of line endings / surrounding whitespace', () => {
    const crlf = EXPECTED_LICENSING_PUBLIC_KEY_PEM.replace(/\n/g, '\r\n');
    expect(isSamePublicKey(`  ${crlf}\n\n`, EXPECTED_LICENSING_PUBLIC_KEY_PEM)).toBe(true);
  });

  it('a different key is not equal', () => {
    expect(isSamePublicKey(newKey().publicKey, EXPECTED_LICENSING_PUBLIC_KEY_PEM)).toBe(false);
  });

  it('null / empty / garbage values never match (fail closed)', () => {
    for (const bad of [null, undefined, '', '   ', 'not a key', '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----']) {
      expect(isSamePublicKey(bad, EXPECTED_LICENSING_PUBLIC_KEY_PEM)).toBe(false);
      expect(publicKeyFingerprint(bad)).toBeNull();
    }
    expect(isSamePublicKey(null, null)).toBe(false);
  });
});
