// tools/license-issuer.test.js
// Pure, offline unit tests for the Licensing issuer tool — no database, no network, no
// scratch Postgres (see backend/src/routes/licenseIssuer.e2e.integration.test.js for the
// full request-code → issuer → verify → activate proof against a real scratch DB).
import { describe, it, expect } from 'vitest';
import { Writable, Readable } from 'stream';
import crypto from 'crypto';
import {
  PRODUCT_ID, buildActivationRequestCode, verifyLicenseArtifact,
} from '../backend/src/lib/licenseArtifactFormat.js';
import { parseCustomerRequestCode, issueLicense } from './lib/licenseIssuing.js';
import { runInteractive } from './license-issuer.js';

function makeOwnerKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('parseCustomerRequestCode', () => {
  it('decodes a real Activation Request Code', () => {
    const code = buildActivationRequestCode({ installationId: 'inst-1', product: PRODUCT_ID });
    const parsed = parseCustomerRequestCode(code);
    expect(parsed).toEqual({ v: 1, installationId: 'inst-1', product: PRODUCT_ID });
  });

  it('rejects a malformed/garbage code with a clear error, not a crash', () => {
    expect(() => parseCustomerRequestCode('not a real code')).toThrow(/not a valid/i);
  });

  it('rejects an empty code', () => {
    expect(() => parseCustomerRequestCode('')).toThrow();
  });
});

describe('issueLicense — produces an artifact the real backend verifier accepts', () => {
  it('1. a valid license request produces a valid artifact', () => {
    const { privateKey } = makeOwnerKeyPair();
    const result = issueLicense({ installationId: 'inst-1', product: PRODUCT_ID }, privateKey);
    expect(typeof result.artifact).toBe('string');
    expect(result.artifact.split('.')).toHaveLength(2);
    expect(result.installationId).toBe('inst-1');
    expect(typeof result.licenseId).toBe('string');
  });

  it('auto-generates a licenseId when none is supplied', () => {
    const { privateKey } = makeOwnerKeyPair();
    const a = issueLicense({ installationId: 'inst-1', product: PRODUCT_ID }, privateKey);
    const b = issueLicense({ installationId: 'inst-1', product: PRODUCT_ID }, privateKey);
    expect(a.licenseId).not.toBe(b.licenseId);
  });

  it('respects an explicitly supplied licenseId', () => {
    const { privateKey } = makeOwnerKeyPair();
    const result = issueLicense({ licenseId: 'lic_CUSTOM', installationId: 'inst-1', product: PRODUCT_ID }, privateKey);
    expect(result.licenseId).toBe('lic_CUSTOM');
  });

  it('2. the artifact is accepted by the real Phase 5b verification logic (verifyLicenseArtifact)', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const result = issueLicense({ installationId: 'inst-1', product: PRODUCT_ID }, privateKey);

    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey,
    });
    expect(check.ok).toBe(true);
    expect(check.payload.licenseId).toBe(result.licenseId);
  });

  it('3. tampering with the artifact after issuing causes the real verifier to reject it', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const result = issueLicense({ installationId: 'inst-1', product: PRODUCT_ID }, privateKey);
    const tampered = result.artifact.slice(0, -2) + (result.artifact.slice(-2) === 'AA' ? 'BB' : 'AA');

    const check = verifyLicenseArtifact({
      artifact: tampered, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey,
    });
    expect(check.ok).toBe(false);
  });

  it('4. issuing for a different installation produces an artifact rejected by that other installation\'s check', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const a = issueLicense({ installationId: 'inst-A', product: PRODUCT_ID }, privateKey);
    const b = issueLicense({ installationId: 'inst-B', product: PRODUCT_ID }, privateKey);
    expect(a.artifact).not.toBe(b.artifact);

    const wrongInstallCheck = verifyLicenseArtifact({
      artifact: a.artifact, installationId: 'inst-B', product: PRODUCT_ID, publicKeyPem: publicKey,
    });
    expect(wrongInstallCheck.ok).toBe(false);
    expect(wrongInstallCheck.reason).toBe('wrong_installation');
  });

  it('5a. an expiring license is rejected once its expiry has passed', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const result = issueLicense({
      installationId: 'inst-1', product: PRODUCT_ID, expiresAt: Date.now() + 1000,
    }, privateKey);

    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey,
      now: Date.now() + 2000,
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('expired');
  });

  it('5b. a perpetual license (expiresAt: null) verifies indefinitely', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const result = issueLicense({ installationId: 'inst-1', product: PRODUCT_ID, expiresAt: null }, privateKey);
    expect(result.expiresAt).toBeNull();

    const farFuture = Date.now() + 50 * 365 * 24 * 60 * 60 * 1000;
    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, now: farFuture,
    });
    expect(check.ok).toBe(true);
  });

  it('6. rejects a request with a missing installationId, never signs anything', () => {
    const { privateKey } = makeOwnerKeyPair();
    expect(() => issueLicense({ installationId: '', product: PRODUCT_ID }, privateKey)).toThrow(/installationId/i);
  });

  it('6b. rejects a malformed private key with a clear error', () => {
    expect(() => issueLicense({ installationId: 'inst-1', product: PRODUCT_ID }, 'not a real PEM key')).toThrow(/private key/i);
  });

  it('7. an artifact signed by the wrong (non-matching) keypair is rejected by the real verifier', () => {
    const owner = makeOwnerKeyPair();
    const impostor = makeOwnerKeyPair();
    const result = issueLicense({ installationId: 'inst-1', product: PRODUCT_ID }, impostor.privateKey);

    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: owner.publicKey,
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('invalid_signature');
  });

  it('features and notes round-trip through the real verifier', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const result = issueLicense({
      installationId: 'inst-1', product: PRODUCT_ID, features: ['reports', 'multi-branch'], notes: 'Al-Noor Tutoring Center',
    }, privateKey);

    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey,
    });
    expect(check.ok).toBe(true);
    expect(check.payload.features).toEqual(['reports', 'multi-branch']);
    expect(check.payload.notes).toBe('Al-Noor Tutoring Center');
  });
});

describe('structural proof the issuer output cannot be used as a normal login credential', () => {
  it('the issued result never contains an id/password/role — only license/installation metadata + the artifact', () => {
    const { privateKey } = makeOwnerKeyPair();
    const result = issueLicense({ installationId: 'inst-1', product: PRODUCT_ID }, privateKey);
    expect(Object.keys(result).sort()).toEqual(
      ['artifact', 'expiresAt', 'features', 'installationId', 'issuedAt', 'licenseId', 'notes', 'product'].sort()
    );
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('role');
  });
});

describe('the issuer never exposes the private key through its normal CLI output', () => {
  function collectOutput() {
    const chunks = [];
    const output = new Writable({
      write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); },
    });
    return { output, text: () => chunks.join('') };
  }

  // Pushes one line per tick and never signals EOF — see tools/support-signer.test.js's
  // own note on why (mixing fake/real timing with readline's own line-by-line processing).
  function scriptedInput(lines) {
    let i = 0;
    return new Readable({
      read() {
        if (i >= lines.length) return;
        const line = lines[i++];
        setImmediate(() => this.push(line + '\n'));
      },
    });
  }

  it('issuing a real perpetual license never prints the PEM private key content', async () => {
    const { privateKey } = makeOwnerKeyPair();
    const code = buildActivationRequestCode({ installationId: 'inst-1', product: PRODUCT_ID });
    const { output, text } = collectOutput();
    // code, licenseId(blank), perpetual(blank=yes), features(blank), notes(blank), then exit
    const input = scriptedInput([code, '', '', '', '', '']);

    await runInteractive({ input, output, privateKeyPem: privateKey });

    const printed = text();
    expect(printed).toContain('License Artifact:');
    expect(printed).not.toContain(privateKey);
    expect(printed).not.toContain('BEGIN PRIVATE KEY');
  });

  it('issuing a real expiring license never prints the private key either', async () => {
    const { privateKey } = makeOwnerKeyPair();
    const code = buildActivationRequestCode({ installationId: 'inst-1', product: PRODUCT_ID });
    const { output, text } = collectOutput();
    // code, licenseId(blank), perpetual=n, days=30, features(blank), notes(blank), then exit
    const input = scriptedInput([code, '', 'n', '30', '', '', '']);

    await runInteractive({ input, output, privateKeyPem: privateKey });

    const printed = text();
    expect(printed).toContain('Expires:');
    expect(printed).not.toContain(privateKey);
    expect(printed).not.toContain('BEGIN PRIVATE KEY');
  });

  it('a malformed request code produces a clear error without ever touching/printing the key', async () => {
    const { privateKey } = makeOwnerKeyPair();
    const { output, text } = collectOutput();
    const input = scriptedInput(['garbage-not-a-request-code', '']);

    await runInteractive({ input, output, privateKeyPem: privateKey });

    const printed = text();
    expect(printed).toMatch(/error/i);
    expect(printed).not.toContain(privateKey);
    expect(printed).not.toContain('BEGIN PRIVATE KEY');
  });
});
