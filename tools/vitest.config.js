// tools/vitest.config.js
// Standalone Vitest config for the owner-side tools/ tree — separate from the frontend's
// root config (scoped to src/**) and the backend's own configs (scoped to backend/src/**,
// require a real/scratch Postgres). tools/ has zero external dependencies of its own (plain
// Node crypto/fs/os/readline), so this reuses the vitest binary already installed at the
// repo root — no new dependency added. Run via `npm run test:tools` from the repo root.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

// root pinned explicitly to the repo root (this file's parent directory) regardless of the
// current working directory the command is invoked from — Vite/Vitest's root inference from
// CWD alone is not reliable enough here since this config is meant to be invoked via
// `--config tools/vitest.config.js` from the repo root by convention, but should still work
// if invoked from within tools/ itself.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: repoRoot,
  test: {
    globals: true,
    environment: 'node',
    include: ['tools/**/*.test.js'],
  },
});
