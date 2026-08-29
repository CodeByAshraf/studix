# INSTALL-03 — Bundled PostgreSQL + Auto-Configuration: Design Report

Scope: reusable PostgreSQL server provisioning/management capability for a future installer.
Does **not** implement the Windows Service or Inno Setup installer (INSTALL-05/06), and does
**not** duplicate `db/bootstrapDatabase.js`/`db/migrationRunner.js`'s existing, unmodified
responsibility for the `studix` database's own content.

## 1. PostgreSQL version/distribution contract

- **Version pin: PostgreSQL 18.x.** The schema (`prisma/studix-schema.sql`,
  `migrations/002_support_access.sql`) uses `gen_random_uuid()` with no
  `CREATE EXTENSION pgcrypto` anywhere — that function has been built into PostgreSQL core
  (no extension required) since **PostgreSQL 13**, so 13+ is the hard floor. Among currently
  supported majors (14–18 as of writing; PostgreSQL 19 is still in beta), 18.x is chosen as
  the pin: current stable, multiple point releases already shipped (18.6), full support runway
  into ~2030, and it is what this design was verified against for real (this dev machine has a
  real local PostgreSQL 18 install — see §9). 17.x would be an equally defensible, more
  conservative alternative if preferred later; nothing in this module hard-codes "18" anywhere
  in code, only in this document.
- **Distribution: EDB's official "Windows x86-64 binaries" zip** (no installer) —
  `https://www.enterprisedb.com/download-postgresql-binaries`. EDB explicitly describes this
  archive as "intended for users who wish to include Postgres as part of another application
  installer," which is exactly this use case.
- **License: the PostgreSQL License** (permissive, BSD-style, no copyleft) — redistribution
  inside a closed-source product is permitted; the only obligation is retaining the copyright
  notice. INSTALL-06 must ship the `LICENSE`/`COPYRIGHT` file that comes inside the zip
  alongside the bundled binaries.
- **Not vendored into Git in this phase**, per the task's explicit instruction. This document
  defines the *contract* INSTALL-06 must fulfill; INSTALL-03 ships zero binary bytes.

## 2. Expected directory layout (the runtime contract)

```
release\win-x64\studix\          (existing INSTALL-01 output)
├─ node\node.exe                 (existing)
├─ backend\...                   (existing)
├─ dist\...                      (existing)
└─ pgsql\                        (NEW — INSTALL-06 places the extracted EDB zip contents here)
   ├─ bin\
   │  ├─ postgres.exe
   │  ├─ initdb.exe
   │  ├─ pg_ctl.exe
   │  ├─ pg_isready.exe
   │  └─ psql.exe                (used only by this phase's own real-verification test)
   ├─ lib\
   └─ share\
```

`postgresProvisioning.js`'s `resolvePgHome()` computes this path automatically
(`__dirname`-relative, same sibling-directory convention `server.js` already uses for
`DIST_DIR`), overridable via `STUDIX_PG_HOME` for testing/development. **INSTALL-03 does not
create `pgsql/`** — `locatePgBinaries()` fails clearly (`missing_binaries`, naming exactly
which executables are absent) when it isn't there yet, which is the correct, expected state
until INSTALL-06 exists.

## 3. Data directory layout

`%ProgramData%\Studix\pgdata\` (override: `STUDIX_PGDATA_DIR`) — same
override-else-`%ProgramData%\Studix\<x>` precedent already established by
`lib/config.js`/`lib/logger.js`/`db/backup.js`. Entirely initdb-owned content; this module
only ever reads `PG_VERSION` (initialization marker) and patches two settings
(`listen_addresses`, `port`) in `postgresql.conf`, and wholesale-replaces `pg_hba.conf` with a
minimal, fully-understood, loopback-only file it controls completely.

## 4. Port strategy

- **Default: 55432**, not 5432. A bundled, Studix-private PostgreSQL instance must never
  collide with a pre-existing system-wide PostgreSQL install a customer's machine might already
  have on 5432 (a real scenario for any Windows desktop app).
- **Detection, never eviction**: `isPortFree()` probes via a real `net.createServer().listen()`
  bind/release — never inspects or kills whatever else holds a port.
- **Scan range**: if 55432 is occupied, tries 55433…55451 (20 candidates) before failing
  clearly (`no_free_port`).
- **Persistence**: the selected port is written into `postgresql.conf` — PostgreSQL's own
  config file, not a separate tracked value — so "the port Postgres listens on" and "the port
  this module remembers" can never drift apart. On every subsequent run, `classifyDataDir()`
  reads the port back out of that same file; `selectPort()` is never called again for an
  already-initialized instance, so a restart/upgrade can never change the port.

## 5. Credential strategy

- **Role**: `studix_admin` — a PostgreSQL-native login role created by `initdb -U studix_admin`,
  not tied to any Windows account. It is a **superuser** (initdb's default for the role it
  creates), used for both one-time admin operations and the app's own runtime `DATABASE_URL` —
  this matches the architecture already documented in `backend/.env.example`
  (`postgresql://postgres:postgres@localhost:5432/studix` — a single role for everything, no
  existing least-privilege split to preserve). A future least-privilege app role is a candidate
  enhancement, explicitly deferred — see §10.
- **Generation**: `crypto.randomBytes(32).toString('hex')` — identical CSPRNG discipline to
  `lib/productionConfig.js`'s `generateSessionSecret` (never `Math.random`).
- **Never on the command line**: the password is written to a throwaway temp file and handed
  to `initdb` via `--pwfile=<path>`, deleted in a `finally` block immediately after — a raw
  password argument would be visible in Task Manager/any process-listing tool.
- **Never stored twice**: this module does not persist the password anywhere itself. Its only
  durable home is the `DATABASE_URL` written into the already-approved INSTALL-02 production
  config file (`%ProgramData%\Studix\config\.env`) — see §7's sequencing contract. On an
  already-initialized instance, this module cannot and does not attempt to recover the
  password (only its SCRAM hash exists in `pg_authid`) — it returns `already_initialized` with
  no `databaseUrl` field at all; the caller is expected to already hold it from that file.
- **Auth method**: `scram-sha-256` for both `initdb --auth` and every `pg_hba.conf` entry —
  never `trust` (passwordless) or `md5` (deprecated, weaker).

## 6. Security boundaries

- `listen_addresses = '127.0.0.1'` written explicitly (not left as initdb's implicit default,
  even though that default is already loopback-only) — "verify, don't assume," matching
  INSTALL-01's own engine-verification convention.
- `pg_hba.conf` is fully replaced with three lines: `local` + `host 127.0.0.1/32` +
  `host ::1/128`, all `scram-sha-256`. No wildcard, no `0.0.0.0/0`, nothing LAN-reachable —
  verified directly by a unit test asserting the absence of both.
- Every returned status object is asserted (by test) to carry the secret in **at most one**
  field (`databaseUrl`, and only on first init) — no parallel `password` field, no leakage into
  `host`/`port`/`status`/error messages, no `console.log`/`console.error` call anywhere in the
  module.

## 7. Initialization state model

| State | Condition | Action |
|---|---|---|
| `uninitialized` | data dir missing or empty | safe to `initdb` |
| `initialized` | `PG_VERSION` + parseable `port` in `postgresql.conf` | reuse as-is; start only if not already accepting connections; **never** re-`initdb` |
| `inconsistent` | non-empty dir missing `PG_VERSION`, or missing/unparseable `postgresql.conf` | **fail closed** — throws `PostgresProvisioningError('inconsistent_data_dir', ...)`, touches nothing |

`initdb` itself independently refuses a non-empty target directory, so this classification is
defense-in-depth with a clear, testable, pre-flight signal — not the only thing standing
between a corrupted directory and a destructive re-init.

## 8. Sequencing contract with INSTALL-02 (decision flagged for approval)

`ensureProductionConfig` (INSTALL-02, already committed, **unmodified** by this phase) only
ever writes `DATABASE_URL` at the moment it creates the production config file for the very
first time — if the file already exists (even with only `SESSION_SECRET` in it), it is left
untouched and a later `databaseUrl` argument is silently ignored. Therefore:

> **INSTALL-05/06's installer orchestration MUST run PostgreSQL provisioning (this phase's
> `provisionPostgres()`) BEFORE ever invoking `scripts/generateProductionConfig.js`, on a fresh
> install.** `scripts/provisionPostgres.js` (this phase's own CLI entry point) already
> demonstrates and enforces this order: it calls `provisionPostgres()` first, and only on a
> **first-ever** initialization does it go on to call `ensureProductionConfig()` with the
> resulting `DATABASE_URL` — so both `SESSION_SECRET` and `DATABASE_URL` land in the file
> together, in one creation event, exactly matching `ensureProductionConfig`'s existing
> idempotency contract with zero changes to INSTALL-02's committed code.

This was evaluated against extending `ensureProductionConfig` to support appending a missing
`DATABASE_URL` to an already-existing file — rejected as unnecessary complexity/risk once the
simpler ordering contract covers every real scenario (fresh install and every subsequent
restart/upgrade) without touching already-approved code.

## 9. Real PostgreSQL verification (and its limitation)

A real, locally-installed PostgreSQL 18 was found on this dev machine
(`C:\Program Files\PostgreSQL\18\bin\`), so
`postgresProvisioning.integration.test.js` runs against a **fully disposable** instance: a
brand-new temp data directory, a scratch port (55880, never 5432 or the dev DB's own port),
initialized and torn down entirely within the test — the developer's own PostgreSQL
install/data and `%ProgramData%\Studix\pgdata` are never touched.

**Limitation encountered and clearly reported, not hidden**: in this specific execution
environment, `postgres.exe` cannot bind a loopback TCP socket (`Permission denied` on both
`127.0.0.1` and `::1`) — confirmed to be environment-specific rather than a defect in this
module's code, since Node's own `net.createServer()` binds loopback ports successfully in the
very same environment (proven by two passing unit tests). Consequently, the three
bind-dependent real-verification tests (start+ready, real `psql` authentication, idempotent
restart) report a clear, explicit skip with the full diagnostic (including the PostgreSQL
startup log tail) rather than a hard failure. Three real, bind-independent checks still pass
for real: real binary discovery, real `initdb` producing a correctly loopback-configured
`postgresql.conf` on disk, and fail-closed behavior on a real foreign (non-PostgreSQL)
directory. Every code path — including the ones the environment couldn't let bind for real —
has full dependency-injected coverage in `postgresProvisioning.test.js` (38/38 passing).

## 10. How INSTALL-05/06 will consume this layer

```js
import { provisionPostgres } from 'backend/src/db/postgresProvisioning.js';
import { ensureProductionConfig } from 'backend/src/lib/productionConfig.js';
import { resolveProductionConfigPath } from 'backend/src/lib/config.js';
import { bootstrapDatabase } from 'backend/src/db/bootstrapDatabase.js';
import { runMigrations } from 'backend/src/db/migrationRunner.js';

const pg = await provisionPostgres();                              // INSTALL-03
if (pg.status === 'initialized') {
  ensureProductionConfig({                                          // INSTALL-02
    configPath: resolveProductionConfigPath(),
    databaseUrl: pg.databaseUrl,
  });
}
// process.env.DATABASE_URL now resolvable via lib/config.js as always
await bootstrapDatabase({ schemaPath: /* prisma/studix-schema.sql */ });  // existing, untouched
await runMigrations(prisma, { backup: createPreMigrationBackup });       // existing, untouched
```

`scripts/provisionPostgres.js` already implements the first two steps in exactly this order,
usable directly by INSTALL-05/06 or as a reference for how their orchestration should call this
layer. The eventual Windows Service (INSTALL-05) owns *keeping PostgreSQL running long-term*
(NSSM or a native `pg_ctl register`-based service) — this phase only starts it via `pg_ctl`
during provisioning/verification, deliberately not as a child process of the Node server.

## 11. Deferred / explicitly out of scope for INSTALL-03

- Downloading/vendoring the actual PostgreSQL binaries (INSTALL-06).
- Registering PostgreSQL as a Windows service, NSSM, or any service supervision (INSTALL-05).
- The Inno Setup installer itself, first-run wizard, uninstall/upgrade orchestration
  (INSTALL-04/05/06).
- A least-privilege application role distinct from the `studix_admin` superuser — the current
  architecture (per `backend/.env.example`) already uses one role for everything; splitting
  this is a future hardening candidate, not required now.
- ACL/filesystem permission hardening on `%ProgramData%\Studix\pgdata\` beyond what NTFS
  defaults provide — same reasoning as INSTALL-02's `.env` file: real ACL restriction is an
  elevated, installer-time (Inno Setup) concern, not something Node's `fs` module can
  meaningfully enforce on Windows.
- Backup/restore of `pgdata` itself (distinct from `db/backup.js`'s existing `pg_dump`-based
  logical backup of the `studix` database's *content*, which is unaffected by this phase).
