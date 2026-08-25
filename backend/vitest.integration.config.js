// backend/vitest.integration.config.js
// MEDIUM-B1 — separate config for the real-PostgreSQL integration suite (see
// src/test-helpers/scratchDb.js). Kept out of the default vitest.config.js entirely so
// `npm run test` stays instant and dependency-free; only `npm run test:integration` uses
// this file. Each integration test file skips its own tests gracefully (with a clear
// SKIPPED reason) if Postgres isn't reachable — this config has no special requirement
// beyond the plain Node environment already used for the rest of the backend suite.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.test.js'],
    // Scratch-DB setup/teardown (CREATE DATABASE, prisma db push, DROP DATABASE) takes
    // real wall-clock time — the per-test default (5s) is too tight for beforeAll here.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
