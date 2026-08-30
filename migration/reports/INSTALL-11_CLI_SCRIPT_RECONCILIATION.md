# INSTALL-11 — Packaged CLI Script Reconciliation with INSTALL-10: Design/Implementation Report

## Scope

One regression, discovered (not pre-documented) by this phase's own architecture audit: re-inspecting
`backend/scripts/provisionPostgres.js` — a packaged, `npm run postgres:provision`-aliased "manual/
future-installer entry point" — against INSTALL-10's committed two-role architecture showed it still
wrote `provisionPostgres()`'s returned connection string (the `studix_admin` superuser connection, on
a fresh cluster init) directly into the runtime production config as `DATABASE_URL`, via
`ensureProductionConfig`. If ever run manually against a fresh, uninitialized cluster — exactly the
scenario its own header comment described — this silently reintroduced the single-superuser-role
architecture INSTALL-10 exists to close, reporting success throughout. No other packaged/manual entry
point can do this (see the audit trace below).

## Approved decisions

- **Choice 1 (a) — Minimal fix.** Removed the `ensureProductionConfig(...)` call (and its now-unused
  imports) from `backend/scripts/provisionPostgres.js` entirely. The script no longer writes any
  config file or credential, ever. Not redirected to `provisioningAdminConfig.js`; not retired. The
  underlying `provisionPostgres()` function (`backend/src/db/postgresProvisioning.js`) was not touched.
- **Choice 2 (b) — Comment-only correction.** `backend/scripts/bootstrapDatabase.js` and
  `backend/scripts/runMigrations.js` had zero behavioral changes — only header comments, correcting
  `runMigrations.js`'s stale claim of an `npm run migrate` alias (no such script exists in
  `package.json`) and documenting that both scripts' fail-closed behavior against a real INSTALL-10
  install's restricted `DATABASE_URL` is expected, not a defect.

## Audit trace (performed before implementation, re-confirmed immediately before editing)

Traced all 7 packaged scripts (`scripts/build-windows-runtime.ps1`'s whitelist) and every
`package.json` npm alias:

| Script | Can write/derive `DATABASE_URL`? |
|---|---|
| `provisionPostgres.js` | **Yes (the regression)** — fixed here |
| `bootstrapDatabase.js` (scripts/) | No — only reads the ambient value |
| `runMigrations.js` | No — only reads the ambient value |
| `adminCreate.js` | No — pure DML (`users` table INSERT/UPDATE) regardless of role |
| `generateProductionConfig.js` | Only writes a value the operator explicitly supplies via the
  distinctly-named `STUDIX_INSTALL_DATABASE_URL` override — never auto-derives or propagates an
  admin-level value |
| `manageWindowsServices.js` | Not applicable (service management only) |
| `firstInstall.js` (the real installer's own entry point) | Already correct (INSTALL-10) |

Re-confirmed immediately before implementing: `grep -rln "ensureProductionConfig\b" scripts/*.js`
returned exactly `generateProductionConfig.js` (already safe by design) and `provisionPostgres.js`
(the one being fixed) — no other script calls it.

## What was explicitly NOT done

- No change to `backend/src/db/postgresProvisioning.js`, `backend/src/installer/firstInstall.js`,
  `backend/src/server.js`, `installer/studix.iss`, or any INSTALL-10 privilege/grant logic.
- No behavioral change to `bootstrapDatabase.js`/`runMigrations.js` — comments only, verified by
  `git diff` containing no non-comment line changes in either file (see verification below).
- No redirect of `provisionPostgres.js`'s (now-removed) write to the admin-only config file — it
  simply no longer writes anything.
- No retirement/deletion of any script — all three remain available for their narrower, legitimate
  original purposes (status check; developer-local full-privilege bootstrap/migration).
- No code-signing work scoped in (kept as a separate, later procurement item per your instruction).

## Testing / verification performed

- `node --check` on all three edited scripts — syntactically valid.
- Full default suite (`npx vitest run`) — **315/315 passed**, unchanged from before this phase (none
  of these three thin CLI wrappers have their own test files; their underlying library functions —
  `provisionPostgres()`, `bootstrapDatabase()`, `runMigrations()` — are unchanged and remain covered
  by their own existing suites).
- Manual code review confirms `provisionPostgres.js` no longer imports or calls
  `ensureProductionConfig`/`resolveProductionConfigPath` at all, and its two console-output paths
  (already-initialized / freshly-initialized) never print `result.databaseUrl` or any credential —
  matching its pre-existing "never print the password" discipline, now extended to never printing
  or writing the connection string at all.

## Files changed

- `backend/scripts/provisionPostgres.js` — modified (regression fix).
- `backend/scripts/bootstrapDatabase.js` — modified (comment-only).
- `backend/scripts/runMigrations.js` — modified (comment-only).
- `migration/reports/INSTALL-11_CLI_SCRIPT_RECONCILIATION.md` — new (this report).

No other file touched.
