// backend/src/db/startupOrchestrator.integration.test.js
// Phase 2C-3C Part 5B-3 — the ONE real, disposable-PostgreSQL proof that waitForPostgresReady's
// connection-attempt-based readiness signal actually works end to end: a real successful
// connection reports ready:true immediately, and a real, genuinely-unreachable address (a
// closed TCP port on localhost — never a real Studix instance, never the dev database itself)
// reports ready:false/timedOut:true within a short, bounded window. Every other behavior of
// this module (polling, ordering, error redaction, StudixApp start-gating) is already fully
// covered by pure/mocked unit tests in startupOrchestrator.test.js — this file exists only to
// prove the ONE piece those mocks cannot: that a genuine PostgreSQL connection attempt is what
// is actually happening under the hood, not merely a well-shaped fake.
import { describe, it, expect } from 'vitest';
import { checkPostgresReachable } from '../test-helpers/scratchDb.js';
import { waitForPostgresReady } from './startupOrchestrator.js';

const dbCheck = await checkPostgresReachable();

describe.skipIf(!dbCheck.reachable)('waitForPostgresReady — real PostgreSQL connection proof', () => {
  it(`SKIPPED if not reachable: ${dbCheck.reachable ? '' : dbCheck.reason}`, () => {
    expect(true).toBe(true);
  });

  it('reports ready:true on the first attempt against a real, already-running PostgreSQL instance', async () => {
    const result = await waitForPostgresReady({
      readAdminCredentialFn: () => process.env.DATABASE_URL,
      timeoutMs: 5000,
      pollIntervalMs: 100,
    });
    expect(result).toEqual({ ready: true, timedOut: false, error: null });
  });

  it('reports ready:false, timedOut:true within the bounded window against a genuinely unreachable address', async () => {
    // Port 1 on localhost: reserved, never listening — a real TCP-level refusal, not a mock.
    const unreachableUrl = 'postgresql://nouser:nopass@127.0.0.1:1/postgres?connect_timeout=1';
    const start = Date.now();
    const result = await waitForPostgresReady({
      readAdminCredentialFn: () => unreachableUrl,
      timeoutMs: 2000,
      pollIntervalMs: 300,
    });
    const elapsed = Date.now() - start;
    expect(result.ready).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(elapsed).toBeLessThan(10_000); // bounded — never hangs indefinitely
  });
});
