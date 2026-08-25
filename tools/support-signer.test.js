// tools/support-signer.test.js
// Pure, offline unit tests for the Support Access signer tool — no database, no network,
// no scratch Postgres (see backend/src/routes/supportSigner.e2e.integration.test.js for the
// full challenge → signer → verify → support session proof against a real scratch DB).
import { describe, it, expect } from 'vitest';
import { Writable, Readable } from 'stream';
import crypto from 'crypto';
import { buildChallengeString, verifyChallengeSignature } from '../backend/src/lib/supportChallengeFormat.js';
import { validateChallengeLocally, signChallenge } from './lib/challengeSigning.js';
import { runInteractive } from './support-signer.js';

function makeOwnerKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function makeChallenge(overrides = {}) {
  const now = Date.now();
  return buildChallengeString({
    installationId: 'inst-1', nonce: crypto.randomBytes(8).toString('base64url'),
    iat: now, exp: now + 15 * 60 * 1000, ...overrides,
  });
}

describe('signChallenge — produces a response the real backend verifier accepts', () => {
  it('1. a valid challenge produces a valid response', () => {
    const { privateKey } = makeOwnerKeyPair();
    const challenge = makeChallenge();
    const result = signChallenge(challenge, privateKey);
    expect(typeof result.response).toBe('string');
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.installationId).toBe('inst-1');
  });

  it('2. the response is accepted by the real Phase 4b verification logic (verifyChallengeSignature)', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const challenge = makeChallenge();
    const { response } = signChallenge(challenge, privateKey);

    const check = verifyChallengeSignature({ challenge, response, installationId: 'inst-1', publicKeyPem: publicKey });
    expect(check.ok).toBe(true);
  });

  it('3. tampering with the challenge after signing causes the real verifier to reject it', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const challenge = makeChallenge();
    const { response } = signChallenge(challenge, privateKey);

    const tampered = challenge.slice(0, -2) + (challenge.slice(-2) === 'AA' ? 'BB' : 'AA');
    const check = verifyChallengeSignature({ challenge: tampered, response, installationId: 'inst-1', publicKeyPem: publicKey });
    expect(check.ok).toBe(false);
  });

  it('4. signing two different challenges produces two different responses', () => {
    const { privateKey } = makeOwnerKeyPair();
    const a = signChallenge(makeChallenge(), privateKey);
    const b = signChallenge(makeChallenge(), privateKey);
    expect(a.response).not.toBe(b.response);
  });

  it('5. an already-expired challenge is rejected locally, before ever touching the private key', () => {
    const { privateKey } = makeOwnerKeyPair();
    const expired = makeChallenge({ iat: Date.now() - 20 * 60 * 1000, exp: Date.now() - 1 });
    expect(() => signChallenge(expired, privateKey)).toThrow(/expired/i);
  });

  it('6a. a malformed challenge is rejected with a clear error, never reaches crypto.sign', () => {
    const { privateKey } = makeOwnerKeyPair();
    expect(() => signChallenge('not a real challenge', privateKey)).toThrow(/not a valid/i);
  });

  it('6b. an empty challenge is rejected', () => {
    const { privateKey } = makeOwnerKeyPair();
    expect(() => signChallenge('   ', privateKey)).toThrow(/empty/i);
  });

  it('6c. a malformed private key file is rejected with a clear error', () => {
    const challenge = makeChallenge();
    expect(() => signChallenge(challenge, 'not a real PEM key')).toThrow(/private key/i);
  });

  it('validateChallengeLocally mirrors the real parser exactly (no protocol re-implementation)', () => {
    const challenge = makeChallenge();
    const result = validateChallengeLocally(challenge);
    expect(result.ok).toBe(true);
    expect(result.parsed.installationId).toBe('inst-1');
  });
});

describe('9. structural proof the signer output cannot be used as a normal login credential', () => {
  it('the signed result never contains an id/password/role — only response/installationId/nonce/expiresAt', () => {
    const { privateKey } = makeOwnerKeyPair();
    const result = signChallenge(makeChallenge(), privateKey);
    expect(Object.keys(result).sort()).toEqual(['expiresAt', 'installationId', 'nonce', 'response'].sort());
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('role');
  });
});

describe('7. the signer never exposes the private key through its normal CLI output', () => {
  function collectOutput() {
    const chunks = [];
    const output = new Writable({
      write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); },
    });
    return { output, text: () => chunks.join('') };
  }

  // Pushes one line per tick (setImmediate) and never signals EOF (no push(null)) — pushing
  // multiple lines synchronously (or ending the stream right after the last one) races
  // ahead of readline's own line-by-line processing and makes it close itself before the
  // consumer's second rl.question() call ("readline was closed"). The consumer
  // (runInteractive) closes the interface explicitly once it sees the blank exit line, which
  // is sufficient — the input stream itself doesn't need to end too.
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

  it('signing a real challenge never prints the PEM private key content', async () => {
    const { privateKey } = makeOwnerKeyPair();
    const challenge = makeChallenge();
    const { output, text } = collectOutput();
    const input = scriptedInput([challenge, '']); // one challenge, then blank line to exit

    await runInteractive({ input, output, privateKeyPem: privateKey });

    const printed = text();
    expect(printed).toContain('Response Code:');
    // the exact private key PEM text must never appear anywhere in stdout
    expect(printed).not.toContain(privateKey);
    expect(printed).not.toContain('BEGIN PRIVATE KEY');
  });

  it('a malformed challenge produces a clear error without ever touching/printing the key', async () => {
    const { privateKey } = makeOwnerKeyPair();
    const { output, text } = collectOutput();
    const input = scriptedInput(['garbage-not-a-challenge', '']);

    await runInteractive({ input, output, privateKeyPem: privateKey });

    const printed = text();
    expect(printed).toMatch(/error/i);
    expect(printed).not.toContain(privateKey);
    expect(printed).not.toContain('BEGIN PRIVATE KEY');
  });
});
