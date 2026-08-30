# INSTALL-10 — Least-Privilege PostgreSQL Application Role: Design/Implementation Report

## Scope

Exactly one deferred item, traced from already-committed text and selected explicitly from three
traced candidates (code-signing; a least-privilege PostgreSQL role; the normal-uninstall
service-orphaning gap, which became INSTALL-09): `migration/reports/INSTALL-03_POSTGRES_PROVISIONING_DESIGN.md:87-88, 204-206`:
*"A future least-privilege app role is a candidate enhancement, explicitly deferred"* / *"a
future hardening candidate, not required now."*

## Approved decisions (recorded verbatim in intent)

- **OD1 — Option 2, true two-role split.** `studix_admin` remains the provisioning/migration/
  admin role (superuser, unchanged from INSTALL-03). A genuinely restricted `studix_app` runtime
  role was created — DML only, never DDL, never ownership of anything. `DATABASE_URL` (the
  running application's own connection) points at `studix_app`.
- **OD2 — Migrations run on every installer invocation** (fresh install and every upgrade), not
  on every service restart. Explicitly accepted: dropping a new migration file and merely
  restarting the service no longer applies it automatically — re-running the installer/upgrade
  is now required. No new migration trigger was invented. Existing locking (advisory lock),
  checksum-tracking, and destructive-statement-protection guarantees in `migrationRunner.js` are
  completely unchanged — only the caller and the connection it supplies changed.
- **OD3 — Option A: separate admin-only file.** The `studix_admin` connection string is persisted
  in `%ProgramData%\Studix\config\admin.env` — a file physically separate from the runtime
  `%ProgramData%\Studix\config\.env` that `lib/config.js`'s `loadEnvConfig()`/`server.js` read.
  Only `backend/src/installer/firstInstall.js`'s short-lived orchestrator process ever reads it
  (`lib/provisioningAdminConfig.js`'s `readProvisioningAdminUrl`, which — unlike `loadEnvConfig`
  — never touches `process.env`). No password rotation, no PostgreSQL single-user mode, no other
  novel credential mechanism was introduced; the same ACL that already protects the whole
  `%ProgramData%\Studix\config\` tree (`installer/studix.iss`'s one tree-wide `[Dirs]` entry,
  NTFS-inherited) covers this new file automatically — `installer/studix.iss` was not touched.
- **R1 — Yes, add a read-only migration-freshness check at boot.** `server.js` no longer applies
  migrations itself; it calls a new, read-only `checkMigrationsUpToDate` (SELECT-only against
  `_studix_migrations`) through the restricted `studix_app` connection, and fails closed with a
  clear operator-facing message if migrations are pending or were never applied.

## Runtime SQL inventory (evidence, not assumption — see the audit transcript for the full trace)

Grepped every production route/lib file for raw SQL: **zero** raw SQL outside `migrationRunner.js`
and `bootstrapDatabase.js` — every runtime query goes through Prisma's generated ORM API
(`SELECT`/`INSERT`/`UPDATE`/`DELETE` only). Schema objects: 29 tables, 3 sequences
(`inv_materials_id_seq`, `parents_id_seq`, `teachers_id_seq`), 5 trigger functions (none
`SECURITY DEFINER`, none referencing anything outside the same table set `studix_app` already
has DML on — no `EXECUTE` grant needed, triggers fire automatically on the DML event).

**Derived minimum grant set for `studix_app`** (`backend/src/db/bootstrapDatabase.js`'s new
`ensureAppRole`):
```sql
CREATE ROLE "studix_app" LOGIN PASSWORD '<hex>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE "studix" TO "studix_app";
GRANT USAGE ON SCHEMA public TO "studix_app";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "studix_app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "studix_app";
REVOKE CONNECT ON DATABASE "studix" FROM PUBLIC;
```
Re-applied idempotently on every `firstInstall.js` run (never re-creates or rotates an existing
role's password) so tables added by later migrations are automatically covered.

## Architecture as implemented

```
provisionPostgres()                                                          (INSTALL-03, unchanged)
  -> resolve studix_admin connection: fresh (first init) or read back from admin.env (re-run)
  -> bootstrapDatabase({ databaseUrl: adminUrl, ... })         (unchanged internals, admin-fed now)
  -> runMigrations(adminPrismaClient, ...)               (moved here from server.js — INSTALL-10)
  -> ensureAppRole(adminUrl, { appPassword, port })                          (NEW — INSTALL-10)
  -> ensureProductionConfig({ databaseUrl: studix_app URL })    (only when the role was just created)
  -> stopPostgres() / register+start services / health poll / open browser  (unchanged)
```

`server.js` boot sequence: `validateDatabaseUrl` (unchanged) → **`checkMigrationsUpToDate` (NEW,
read-only, via the restricted `studix_app` connection)** → `app.listen()`. No migration
execution capability remains in `server.js`.

## Credential lifecycle (traced, per constraint to identify tradeoffs before implementing)

- First-ever init: `provisionPostgres()` returns the fresh `studix_admin` URL → persisted once to
  `admin.env` → used for bootstrap/migrate/`ensureAppRole` → `ensureAppRole` generates a fresh
  `studix_app` password (CSPRNG hex, `generatePostgresPassword` reused) and returns its URL →
  written once to the runtime `.env`.
- Every subsequent run (upgrade or reinstall): `provisionPostgres()` returns no URL (cluster
  already initialized, password not recoverable from pgdata — unchanged INSTALL-03 behavior) →
  the admin URL is read back from `admin.env` → bootstrap/migrate/`ensureAppRole` re-run
  idempotently → `ensureAppRole` finds the role already exists, never rotates its password, so
  the runtime `.env` is never touched.
- **No backward-compatibility path exists** for a cluster already initialized by a pre-INSTALL-10
  build (old single-role architecture, no `admin.env`). This installer has never shipped a real
  release (`installer/studix.iss`'s `AppId` is still the literal placeholder GUID), so no real
  installation in that shape can exist yet. If `admin.env` is ever missing against an
  already-initialized cluster, `firstInstall.js` fails closed with a clear `resolve_admin_connection`
  error rather than guessing which credential to use. This was a deliberate scope decision, not
  an oversight — flagged explicitly here per the "no silent scope decisions" instruction, not
  silently absorbed.
- INSTALL-08's existing opt-in data-wipe already `DelTree`s the entire `config\` directory
  wholesale — `admin.env` (living inside it) is therefore already correctly covered by that
  existing wipe with zero changes to `installer/studix.iss`.

## Password-in-SQL safety note

`CREATE ROLE ... PASSWORD` does not accept a bound query parameter (`$1`) in PostgreSQL's own
grammar, unlike every other raw SQL call in this codebase (which use Prisma's normal
`$queryRaw`/`$executeRaw` parameter binding). `ensureAppRole` instead verifies the password is
CSPRNG-hex-only (`/^[0-9a-f]+$/`, matching `generatePostgresPassword`'s own output shape exactly
— provably free of quotes/backslashes/`$`-signs by construction) before the one place it
interpolates it directly into raw SQL text — a regex guard, not an assumption, and independently
unit-tested.

## What was explicitly NOT done

- `installer/studix.iss` — untouched (ACL inheritance already covers the new file; no new
  Pascal Script hook needed since the new file is read by the same `node.exe` invocation
  `RunFirstInstall()` already triggers).
- INSTALL-06/07/08/09 install-time and uninstall-time logic — untouched.
- No password rotation, no PostgreSQL single-user mode (OD3's rejected alternative).
- No backward-compatibility migration path for a hypothetical pre-INSTALL-10 install (see above).
- `studix_admin`'s own superuser status — unchanged (Option 1 from the prior audit round, demoting
  it to `NOSUPERUSER`, was not selected; OD1 only concerned the new runtime role).

## Testing / verification performed

- **Unit (DI-based, no real DB)**: `provisioningAdminConfig.test.js` (new, 12 tests — write-once
  idempotency, `process.env` non-mutation on read, ACL-path resolution). `migrationRunner.test.js`
  — `checkMigrationsUpToDate` (new, 9 tests — no pending, some pending, empty tracking table,
  missing table treated as pending, genuine connectivity error propagates, never calls
  `$executeRaw`/`$executeRawUnsafe`). `firstInstall.test.js` — fully rewritten (30 tests) for the
  new step order, admin-connection resolution (fresh vs. re-run vs. missing-file fail-closed),
  migration-client construction/disconnection, `ensureAppRole` argument passing, and
  `ensureProductionConfig` now gated on `ensureAppRole`'s own result rather than
  `provisionPostgres()`'s status (covers the partial-failure-recovery case explicitly).
- **Real integration (`vitest run --config vitest.integration.config.js`, real local PostgreSQL,
  scratch databases/roles only, never the real `studix` database or a real `studix_app` role
  name)**: `bootstrapDatabase.integration.test.js` — 5 new tests, **all passed against a real
  server**: role creation + working connection string; the restricted role can genuinely
  `SELECT`/`INSERT`/`UPDATE`/`DELETE`, and — the same query shape `checkMigrationsUpToDate` uses
  — genuinely succeeds through that same restricted connection; the restricted role's `CREATE
  TABLE` attempt is genuinely rejected with Postgres `42501` (insufficient_privilege), proving the
  privilege boundary itself, not just an unused capability; the restricted role is confirmed never
  the owner of any table; idempotency confirmed — a second `ensureAppRole` call with a different
  candidate password does not rotate the original. Every scratch role/database is namespaced and
  cleaned up in `afterEach`, matching the file's existing safety conventions.
- **Full suite results**: default (`npx vitest run`) — 315/315 passed (up from 288; +27 new
  tests). Integration (`--config vitest.integration.config.js`) — 238/242 passed, 3 skipped
  (pre-existing, documented `postgres.exe` loopback-bind limitation in this environment,
  unrelated to this phase), 1 flaky failure (`bootstrap_in_progress` — `bootstrapDatabase.js`'s
  advisory lock key is cluster-wide, not per-database, so heavy parallel test-*file* execution
  against the one shared local dev PostgreSQL instance can collide; confirmed pre-existing and
  unrelated to this change by re-running the same files with less parallel contention, which
  passed cleanly both times, all-green, including every new INSTALL-10 test).
- **Not verified**: a real elevated installer run exercising the full fresh-install and upgrade
  paths end-to-end (same carried-forward limitation as every prior INSTALL-0X phase — `ISCC.exe`
  not installed, no real elevated Windows service registration in this environment).

## Files changed

- `backend/src/lib/provisioningAdminConfig.js` — new (admin-only credential file, separate from
  the runtime config).
- `backend/src/lib/provisioningAdminConfig.test.js` — new (12 unit tests).
- `backend/src/db/bootstrapDatabase.js` — modified (new `ensureAppRole` export; header/comment
  updates; imports `buildDatabaseUrl` from `postgresProvisioning.js`). Existing exported
  functions' internal logic unchanged.
- `backend/src/db/bootstrapDatabase.integration.test.js` — modified (5 new real-DB tests for
  `ensureAppRole`, section renumbered 18→19 for the pre-existing final structural-proof test).
- `backend/src/db/migrationRunner.js` — modified (new `checkMigrationsUpToDate` export). Existing
  exported functions unchanged.
- `backend/src/db/migrationRunner.test.js` — modified (9 new unit tests for
  `checkMigrationsUpToDate`).
- `backend/src/installer/firstInstall.js` — modified (new admin-connection resolution, migration
  execution, and `ensureAppRole` steps; `ensureProductionConfig` now writes the app URL, gated on
  `ensureAppRole`'s result).
- `backend/src/installer/firstInstall.test.js` — rewritten (30 tests) for the new step order.
- `backend/src/server.js` — modified (removed the `runMigrations` block and its `db/backup.js`
  import; added the read-only freshness-check block; import swapped to `checkMigrationsUpToDate`).
- `migration/reports/INSTALL-10_LEAST_PRIVILEGE_APP_ROLE.md` — new (this report).

**Not touched**: `installer/studix.iss`, `backend/scripts/firstInstall.js` (thin CLI wrapper —
no change needed, calls `runFirstInstall({schemaPath})` which uses all new defaults internally),
`backend/src/db/postgresProvisioning.js` (role creation deliberately lives in
`bootstrapDatabase.js`, which already had the admin-connection machinery — see the design trace),
`scripts/build-windows-runtime.ps1` (copies `backend/src/` wholesale, no per-file whitelist to
update), any INSTALL-06/07/08/09 install-time or uninstall-time Pascal Script.
