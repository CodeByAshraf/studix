// backend/vitest.config.js
// Minimal, backend-only Vitest config — the root config's `test.include` is scoped to
// `src/**/*.test.{js,jsx}` (frontend-only) and deliberately not touched here (cross-cutting
// change out of scope). Backend is plain Node/ESM, so no jsdom/plugins are needed; this
// reuses the vitest binary already installed at the repo root (no new dependency added).
//
// MEDIUM-B1: `*.integration.test.js` files (real PostgreSQL, no Prisma mocking — see
// backend/src/test-helpers/scratchDb.js) are deliberately excluded from this default
// config so `npm run test` stays instant and dependency-free exactly as before. They run
// only via `npm run test:integration` (vitest.integration.config.js).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.js'],
    // include already scopes to src/, so no need to re-list node_modules/dist/etc. here —
    // only the integration suite itself needs excluding from this default config.
    exclude: ['**/*.integration.test.js'],
  },
});
