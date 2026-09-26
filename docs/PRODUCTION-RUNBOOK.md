# Studix 1.0.0 — Production Installation, Activation, First-Run & Daily Operation Runbook

**Audience:** you, the Studix owner/operator. Not a developer document.

**Installer covered by this runbook:**
- File: `installer\Output\StudixSetup-1.0.0.exe`
- SHA256: `4A5FC7A0685EE0B6FB269A0AF5CCD8423459480F4A94172F1843A0657C6FD695`
- Validated: 400/400 backend tests, 414/414 frontend tests, 33/33 tools tests (847/847 total), full six-phase E2E PASS.
- Bundled: PostgreSQL 18.6, NSSM 2.24-101-g897c7ad, Node.js v24.14.0 — none of these need to exist on the customer's PC beforehand.

Everything in this document was verified directly against the current source code (`installer/studix.iss`, `backend/src/*`, `src/*`) and, where noted, against the real six-phase E2E test performed on this exact build. Where the code and any prior assumption disagreed, this document follows the code.

---

## 1. Before Installing Studix

| Requirement | Status | Detail |
|---|---|---|
| Windows 64-bit | **REQUIRED** | `installer/studix.iss` sets `ArchitecturesInstallIn64BitMode=x64compatible` — the installer refuses to run in 32-bit mode. |
| Administrator account | **REQUIRED** | `PrivilegesRequired=admin` — installing and uninstalling both need an administrator (Windows service registration). |
| Windows version | **NOT enforced by the installer** | The `.iss` script sets no `MinVersion` at all — Inno Setup itself imposes no floor. In practice, the bundled `node.exe` is Node.js v24, whose own published platform support requires **Windows 10 (64-bit) or later**. Treat Windows 10 64-bit as the practical minimum; nothing in Studix checks for this at install time, so installing on an unsupported OS will not be blocked by a friendly error — it may simply fail obscurely. |
| Free disk space | **NOT enforced by the installer** | No `DiskSpaceMB`/`DiskSpanning` directive exists in the script — it will not warn you if the disk is nearly full. **RECOMMENDED:** at least 3–5 GB free (installed footprint is ~1.1 GB on day one; `pgdata` grows with real customer data over time). |
| Open ports 4000 / 55432 to the network | **NOT REQUIRED — nothing to check** | The backend binds `127.0.0.1` only (`backend/src/server.js`: `app.listen(PORT, '127.0.0.1', ...)`), and Studix's bundled PostgreSQL also only accepts loopback connections (`writeLoopbackPgHba` in `backend/src/db/postgresProvisioning.js` writes `host all all 127.0.0.1/32` and `::1/128` only). Nothing Studix runs is ever reachable from the network, by design. |
| Firewall rule | **NOT REQUIRED** | Confirmed: nothing in `installer/studix.iss` or the backend calls `netsh`/adds a firewall rule. Because both services bind loopback-only, Windows Firewall does not normally even prompt for them. |
| Internet access on the customer's PC **during installation** | **NOT REQUIRED** | PostgreSQL and NSSM are fetched once, by *you*, when you build the runtime package (`scripts/build-windows-runtime.ps1`) — they are already embedded inside `StudixSetup-1.0.0.exe`. The customer's installer never makes a network call. |
| Internet access for daily use / activation | **NOT REQUIRED** | The app is a fully local desktop-per-machine product; license verification is pure offline Ed25519 signature checking against a key already stored in the local database (see §6–7). |
| Antivirus | **RECOMMENDED to whitelist, not required** | No special antivirus interaction is coded into the installer. Some antivirus products may flag an unsigned installer or a newly-installed background service heuristically — see the SmartScreen note below and §14. |
| Windows Defender SmartScreen | **WILL likely trigger a warning** | `installer/studix.iss` has no `SignTool` directive at all — the installer is **not digitally code-signed**. An unsigned, unrecognized executable downloaded/copied onto a fresh machine will typically show Windows' "Windows protected your PC" SmartScreen prompt on first run. This is expected, not a defect — see §2 and §14 for exactly what to tell the customer. |
| Existing PostgreSQL on the machine | **NOT a conflict — verified** | Studix's bundled PostgreSQL always uses port **55432**, deliberately never the standard 5432 (`DEFAULT_PORT = 55432` in `postgresProvisioning.js`, chosen specifically to avoid colliding with a pre-existing customer PostgreSQL). This was directly tested in the E2E run: a real, unrelated PostgreSQL instance on port 5432 was running on the test machine through the entire install/upgrade/uninstall/reinstall/wipe cycle and was never touched (verified by PID, listener PID, service state, and data directory staying identical throughout). |
| Existing Studix installation on the machine | **Supported — in-place upgrade** | Same `AppId` (`{BE518660-3EBF-4DFF-BDF0-87E8052CE2E6}`) across versions means re-running the installer on a machine that already has Studix performs an in-place upgrade, not a side-by-side install. See §12. |

---

## 2. Delivering the Installer

- **File to give the customer:** `installer\Output\StudixSetup-1.0.0.exe` — nothing else. Do not send `release\win-x64\studix\` (the raw, uncompressed build folder) or any file from `installer\Output\` other than this one `.exe`.
- **Verify its SHA256 yourself before sending it** (PowerShell):
  ```
  Get-FileHash "installer\Output\StudixSetup-1.0.0.exe" -Algorithm SHA256
  ```
  Expected value: `4A5FC7A0685EE0B6FB269A0AF5CCD8423459480F4A94172F1843A0657C6FD695`. If it does not match exactly, **do not send it** — the file was modified or corrupted since this validated build.
- **Should you rename it?** Not required by the installer (`OutputBaseFilename=StudixSetup-{#MyAppVersion}` only controls the name at build time — renaming the already-built `.exe` afterward has no effect on its behavior). You may rename it for clarity if you wish (e.g. add the customer's name) — this does not affect installation, licensing, or the SHA256 check above becoming invalid (hash is computed on file *content*, not name).
- **Should you digitally sign it?** Not currently done (confirmed: no `SignTool` directive anywhere in `installer/studix.iss`). This is a real, known gap — see §14/§18 for what it means operationally, and the "remaining operational risks" note at the end.
- **Windows SmartScreen will likely warn the customer** the first time they run it: *"Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting."* This is expected for any unsigned installer, not a sign of a corrupted file. Tell the customer (or do it yourself if you're on-site): click **More info**, then **Run anyway**. See §14 for the exact wording customers report seeing.
- **Internet needed to launch the installer?** No — see §1. The file is fully self-contained.

---

## 3. Fresh Installation — Exact GUI Steps

Walk through these in order. This is a standard Inno Setup wizard — you do not need to know Inno Setup, just follow each screen.

1. **Double-click `StudixSetup-1.0.0.exe`.**
2. **If Windows SmartScreen appears** ("Windows protected your PC"): click **More info**, then click the **Run anyway** button that appears. (If this button is missing, SmartScreen/antivirus policy is blocking it entirely — see §14.)
3. **User Account Control (UAC) prompt** appears: *"Do you want to allow this app to make changes to your device?"* — click **Yes**. (Studix requires Administrator; installing without an admin account is not possible — `PrivilegesRequired=admin`.)
4. **Language selection** (if shown by your Inno Setup build — Arabic and English are both packaged: `[Languages]` section lists `Arabic.isl` and `Default.isl`). Choose whichever the operator/customer prefers; it only affects installer wizard text, not the application itself (Studix's own UI is Arabic/RTL regardless).
5. **Welcome screen** — click **Next**.
6. **Destination folder screen** — defaults to `C:\Program Files\Studix` (`DefaultDirName={autopf}\Studix`). **Do not change this unless you have a specific reason to** — leave the default and click **Next**.
7. **Ready to Install screen** — click **Install**.
8. **Installation progress** — this step does two things in sequence, both automatic, no further input needed:
   - Copies all program files (visible progress bar).
   - Runs the first-install orchestrator (`backend\scripts\firstInstall.js`) which provisions the database, registers both Windows services, starts them, and waits for the backend to answer `/health` — see §4 for exactly what happens here. This second part can take **up to a minute or so** on a fresh machine (PostgreSQL initialization + npm-installed dependencies already bundled, no download). **Do not close the window or the installer during this step.**
   - On success it also opens `http://localhost:4000/` in the default browser automatically.
9. **If something fails at step 8:** a message box reports which step failed (e.g. `provision_postgres`, `start_postgres_service`) with an exit code. **Do not panic and do not click through repeatedly** — every step in this orchestrator is safely re-runnable (`backend/src/installer/firstInstall.js`'s own header: *"Idempotent by construction... Re-running this orchestrator on an existing installation is therefore always safe"*). Simply re-run `StudixSetup-1.0.0.exe` once; it will pick up from wherever it left off. If it fails the same way twice, go to §14.
10. **Finish screen** — click **Finish**.

There is **no separate "which components to install" screen** — Studix always installs the complete package (app, Node runtime, PostgreSQL, NSSM) as one unit; there is nothing optional to choose or deselect.

---

## 4. What the Installer Does Automatically

In plain terms, here is exactly what happens behind the scenes, with real paths from the current build.

**Files placed in `C:\Program Files\Studix\`** (the *program*, never customer data — safe to fully delete on uninstall, and is fully deleted):
- `node\node.exe` — the bundled, portable Node.js runtime (v24.14.0). No separate Node.js install needed or used.
- `backend\` — the application server source + its own `node_modules\` (Express backend, Prisma client with the Windows-native query engine).
- `dist\` — the built frontend (the web UI Studix serves itself; no separate web server).
- `pgsql\` — the bundled PostgreSQL 18.6 distribution (binaries only at this stage — no data yet).
- `tools\nssm.exe` — the Windows service wrapper used to run the Node app as a real Windows service.
- `unins000.exe` / `unins000.dat` — the uninstaller.

**Data and configuration placed in `C:\ProgramData\Studix\`** (customer data — never deleted except by the explicit, opt-in "delete all data" uninstall path, §13):
- `pgdata\` — the actual PostgreSQL data directory. This **is** the customer's database, on disk, as real files. Never touch these files directly.
- `config\.env` — the application's own runtime configuration: the restricted database connection (`studix_app` role), session secret, port. Read by the running app on every start.
- `config\admin.env` — a **separate**, more privileged database connection (`studix_admin` role), used only during installation/upgrade for schema/migration work. The running application itself never reads this file.
- `logs\` — `studix-YYYY-MM-DD.log` (daily application log), `studix-app-service-stdout.log` / `studix-app-service-stderr.log` (raw NSSM-captured console output).
- `backups\` — pre-migration database backups (`pre-migration-<timestamp>.dump`), created automatically only when an upgrade is about to apply a pending schema migration (see §11). **Never automatically deleted, by anyone, including a full data wipe uninstall.**
- `pg-startup.log` — PostgreSQL's own startup log from the very first, one-time ad-hoc initialization step (not written to again once the Windows service takes over — see §12 for why this matters on upgrades).

**Windows services registered and started:**
- `StudixPostgreSQL` — the native PostgreSQL Windows service (registered via `pg_ctl register`, runs as `LocalSystem`, `AUTO_START`), listening on `127.0.0.1:55432` only.
- `StudixApp` — the Node application, wrapped by NSSM as a Windows service (also `LocalSystem`, `AUTO_START`), listening on `127.0.0.1:4000` only, configured with `DependOnService = StudixPostgreSQL` so Windows always starts PostgreSQL first.

Both are set to **start automatically on every Windows boot** — no manual step, ever, for the customer (§10).

**Database initialization (fresh install only):**
1. `initdb` creates a brand-new PostgreSQL cluster in `pgdata\`, with a generated random password (never the customer's concern).
2. The `studix` database and its full base schema are created (`backend/prisma/studix-schema.sql`).
3. Any pending migrations are applied (`backend/migrations/*.sql` — currently `001_baseline.sql` through `004_licensing_clock_guard.sql`).
4. A restricted, least-privilege `studix_app` database role is created — this is the one the running application actually connects as day-to-day; the more powerful `studix_admin` role is only used for install/upgrade/migration.
5. The Windows services are registered and started, and the installer polls `http://127.0.0.1:4000/health` until it responds `200`, up to 60 seconds, before declaring success.

**No admin account and no license exist yet at this point** — those are separate, deliberate first-run steps (§5, §6, §7, §8).

---

## 5. First Launch

- **What the operator/customer opens:** there is no separate desktop "Studix.exe" application window — Studix is a locally-hosted web app. The Start Menu shortcut (`Studix` → `Studix`, created under `{group}\Studix`) simply opens `http://localhost:4000/` in the **default web browser**. This also happens automatically once at the end of a successful install (§3, step 8).
- **Services that should already be running** (no manual start needed): `StudixApp` and `StudixPostgreSQL`, both `AUTO_START`.
  - Verify from an elevated PowerShell: `sc.exe query StudixApp` and `sc.exe query StudixPostgreSQL` — both should show `STATE : 4  RUNNING`.
- **Verify backend health** directly: open `http://localhost:4000/health` in a browser, or `curl http://127.0.0.1:4000/health` — a healthy install returns `{"ok":true,"service":"studix-backend","database":{"connected":true,...}}`.
- **⚠️ Important, non-obvious step — the first screen is NOT a setup wizard automatically.** Verified directly in the frontend routing (`src/App.jsx`): the Start Menu shortcut opens `/`, which — since no one is logged in yet — redirects straight to the ordinary **login screen**. There is **no automatic redirect to first-run setup**. On the very first launch of a brand-new installation, **you must manually navigate the browser to:**
  ```
  http://localhost:4000/setup
  ```
  This shows "**إنشاء حساب المدير الأول**" (Create the first admin account) — see §8. Once that account is created, all future launches correctly land on the normal login screen, because `/setup` itself checks whether an admin already exists and auto-redirects to `/login` once it does (`src/modules/setup/SetupWizard.jsx`).
- **Is activation required before normal use?** Yes, for everything except logging in and managing the license itself. `backend/src/middleware/activation.js`'s allowlist exempts only `/api/session` (login), `/api/license` (activation), `/api/support-access`, and `/api/setup` — every other API route (students, payments, etc.) returns HTTP 402 with `licenseRequired: true` until activated. The admin can log in and reach the "Activate Studix" screen before activation; nothing else in the app works yet.
- **What the Activation screen shows** (`src/modules/activation/ActivationScreen.jsx`): a "**الحصول على رمز التفعيل**" (Get Activation Code) button that generates and displays an opaque, copyable **Activation Request Code** string (a monospace text block with its own "Copy" button). This code, once decoded by you the owner, contains the installation's `installationId`, `product`, and `machineId` — but note the screen itself only ever displays the raw code string, not those three fields separately; you'll see them broken out when *you* run the issuer tool (§6). Below that is a text box to paste back the License Artifact you send them, and an "**تفعيل**" (Activate) button.

---

## 6. License Issuing — OWNER SIDE

This is the section that determines what you personally have to do for every new customer. Based directly on `tools/license-issuer.js`, `tools/license-keygen.js`, `tools/lib/licenseIssuing.js`, and `tools/LICENSING.md`.

### One-time setup (do this once, ever — not per customer)

You need an Ed25519 signing keypair before you can issue any license at all.

```
node tools/license-keygen.js
```

- Generates a fresh Ed25519 keypair using Node's built-in `crypto` (no external library, no network).
- **Private key** is written **only** to your own machine, at `<your home directory>\StudixLicensing\license-private-key.pem` (default; override with `STUDIX_LICENSE_KEY_DIR` if you want a different, encrypted location). It is **never printed to the console**, never logged, never included in the installer build, and never leaves your machine through any tool in this project.
- **Public key** is printed to the console and saved alongside it as `license-public-key.pem` — this one is safe to share/copy.
- Refuses to run if a private key already exists there, unless you pass `--force` (deliberate — rotating the key requires a new Studix release that carries the new public key, and every customer then needs a newly issued license; see "Key rotation" below).
- **This is already done on the machine used for the E2E validation in this runbook's history** — do not run `license-keygen.js` again on that machine unless you specifically intend to rotate the key (it would invalidate the test license already issued).

### Public-key provisioning — automatic (no per-customer step)

Every Studix release carries your licensing **public** key built in — the release trust anchor (`backend/src/lib/licensingTrustAnchor.js`). The installer writes it into the installation's database (`license_config.licensing_public_key`) automatically: on a fresh install, and again on every upgrade or re-run of the installer. **No `psql` command and no per-customer preparation is needed** before a customer's first activation.

- The app verifies licenses against the key the release carries. The value in the database is only a copy of it, and it is trusted only when it is that same key — editing it by hand does not change who can sign licenses.
- If an installation's database holds a missing, unreadable, or different key, the Activate screen reports that the licensing key does not match this Studix version (reason `trust_anchor_mismatch`) and refuses activation. **Fix: re-run the same Studix installer on that machine** — it restores the release's key. Do not edit the key in the database yourself.
- Provisioning changes only that key value — an existing activation and all other data are left as they are.

### Key rotation (rare and deliberate)

Changing the signing keypair (`license-keygen.js --force`, e.g. after a suspected compromise) takes a **new Studix release** that carries the new public key. Installing that release updates each installation's key automatically — but a license signed with the old key no longer verifies after that upgrade, so every customer needs a newly issued license (fresh Activation Request Code → new artifact). Details: `tools/LICENSING.md`.

### Issuing a license (every time — per customer, per activation/renewal)

1. Customer logs in as admin, opens the Activate screen, generates their **Activation Request Code**, and sends it to you (any channel you trust — phone, WhatsApp, email).
2. On your own machine, run:
   ```
   node tools/license-issuer.js
   ```
3. Paste the request code when prompted. It decodes and shows you, for a sanity check:
   ```
   Installation: <installationId>
   Machine: <machineId>
   Product: studix
   ```
4. Answer the short interactive prompts:
   - **License ID** — leave blank to auto-generate (`lic_<uuid>`), or supply your own reference.
   - **Perpetual license?** — `Y` (default, no expiry) or `n` (asks for a number of days from today).
   - **Features** — optional, comma-separated (reserved for future use, safe to leave blank).
   - **Notes** — optional free text for your own records (e.g. the customer's business name) — never enforced or checked by the app.
5. The tool prints a single opaque **License Artifact** string. This is a signed document; it is safe to send over any channel — it proves nothing about your private key.
6. Send that string to the customer through the same trusted channel.

**Verifying it yourself before sending:** the tool signs with a real cryptographic key — there is no separate "verify" step needed on your side; a malformed or incorrectly-signed artifact simply will not activate on the customer's machine (fail-closed, confirmed by direct testing: a deliberately tampered artifact is rejected with the specific reason `invalid_signature`). If you want to double-check before sending, you can activate it against a disposable test installation yourself first.

**Never done automatically, by design, for every customer machine change:** motherboard/Windows reinstall/moving to new hardware — every one of these requires the customer to generate a fresh request code and you to issue a fresh artifact. There is no self-service or online activation path (deliberate — see `tools/LICENSING.md`'s "Known limitations").

**Fully offline:** `license-issuer.js` never makes a network call or opens a database connection.

---

## 7. Customer Activation

1. Customer logs in as admin (must be an admin — non-admin users see only a restricted "contact your administrator" screen, `ActivationScreen.jsx`'s `NonAdminGate`).
2. They open the Activation screen (shown automatically whenever the backend reports `activated: false` for any admin action — `ActivationGate.jsx` checks this fresh on every mount/login).
3. They click "**الحصول على رمز التفعيل**" (Get Activation Code) and copy the resulting code, sending it to you (§6).
4. Once you send back the License Artifact string, they paste it into the "**الصق شهادة الترخيص هنا**" text box and click "**تفعيل**" (Activate).
5. **Success:** the screen shows a success toast and the app immediately unlocks — no restart needed (`onActivated` callback re-checks status and lets the normal app shell render right away).
6. **Failure:** a generic "**فشل التحقق من الترخيص**" (License verification failed) message — the specific reason (wrong machine, tampered, expired, etc.) is intentionally **not** shown in the HTTP response (only logged server-side to `activity_logs` with `module='license'`), to avoid leaking verification internals. If a customer reports this, you'll need to ask them to check `activity_logs` (or re-issue and confirm you copied the artifact correctly — a single missing character breaks the signature).
7. **Internet required?** No — activation is pure local cryptographic verification against the licensing public key built into the installed Studix release, which the installer copies into that installation's database automatically (§6).
8. **Survives app restart?** Yes — verified directly in the E2E test: license status, `licenseId`, and full payload were identical after a real `StudixApp` service restart.
9. **Survives Windows restart?** Yes, for the same reason — the license lives in the PostgreSQL database on disk (`license_config` table), not in memory or any temp state.
10. **Survives an application upgrade (new installer version, same machine)?** Yes — verified directly: a real in-place upgrade (Phase 3 of the E2E test) preserved the exact same `licenseId` and activation payload, because upgrading never touches `pgdata` or its contents. (The one exception is a release that deliberately rotates the licensing key — see "Key rotation" in §6.)

---

## 8. First Admin/User Setup

- **Created during installation, or first launch?** **First launch**, not during installation. The installer never asks for or creates any admin credentials — that only happens when someone (you, on-site, or the customer) visits `http://localhost:4000/setup` for the very first time (§5) and fills in the "**إنشاء حساب المدير الأول**" form.
- **Username:** chosen freely at that moment (placeholder example shown is `admin`, but any value is accepted, must be unique — enforced server-side, `id_taken` error if reused).
- **Password:** chosen freely at that moment, **minimum 8 characters** (`MIN_PASSWORD_LENGTH = 8`, enforced identically on both frontend and backend — `backend/src/db/firstAdmin.js`). There is **no default password anywhere in the shipped product** — do not tell a customer "the default password is X"; there isn't one.
- **Role:** always `admin`, with the full permission set (`dashboard, admissions, students, groups, attendance, payments, treasury, exams, homework, materials, notifications, reports, id-cards, activity-log, settings, users`) — confirmed directly from a real setup call during the E2E test.
- **Where credentials are stored:** the password is hashed (never stored in plaintext) inside the `users` table in the customer's own PostgreSQL database (`pgdata\`) — nowhere else. It is not written to any config file, log, or the installer.
- **What you should give the customer:** whatever username/password you (or they) chose during the on-site `/setup` step — this is not something you generate in advance or send separately, since it's created live during first launch, ideally with the customer present or by you following their preference.
- **What the customer should change:** nothing is *forced* to change (no "must change password on first login" flow exists in the code) — but as standard practice, if you (the installer/operator) created the account on their behalf, recommend they change the password themselves afterward via **Settings → Users**.
- **If the password is forgotten:** there is no self-service "forgot password" flow in this product. Recovery requires direct database access (updating the `users` table's password hash) or creating a second admin account through the same means if any admin session is still available. This is an operational gap worth being aware of — see §17.
- **Fallback tool (legacy, not the recommended path):** `backend/scripts/adminCreate.js` (`npm run admin:create` from within `backend/`) exists as an older, interactive CLI alternative that predates the `/setup` web wizard — it explicitly refuses to run if an active admin already exists, unless you pass `--reset` (which additionally requires typing `RESET` to confirm). Use `/setup` normally; this script is a break-glass fallback only.

---

## 9. Production Verification Checklist

Run through this after every fresh install, upgrade, or reinstall, before considering the customer handoff complete.

```
[ ] StudixApp service is RUNNING              (sc.exe query StudixApp)
[ ] StudixPostgreSQL service is RUNNING       (sc.exe query StudixPostgreSQL)
[ ] Backend health check returns 200          (http://localhost:4000/health, "database":{"connected":true})
[ ] Application loads in the browser          (http://localhost:4000/)
[ ] First admin account exists and can log in (POST /api/session succeeds)
[ ] License shows activated                   (Activation screen does not appear for the admin)
[ ] Create one real test record               (e.g. a student) and confirm it saves
[ ] Restart StudixApp (sc.exe stop/start) and confirm the app comes back up automatically
[ ] Confirm the test record and license are still there after that restart
[ ] Confirm C:\ProgramData\Studix\backups\ exists (created automatically on the first pending migration — may be empty on a brand-new install with no migrations to run yet, which is normal)
[ ] Confirm C:\ProgramData\Studix\logs\ has today's studix-YYYY-MM-DD.log
[ ] If an existing customer PostgreSQL is on this machine, confirm its service/PID/port are unchanged
```

---

## 10. Daily Customer Operation

Designed to require **zero technical steps** from the customer:

| Question | Answer |
|---|---|
| Start PostgreSQL manually? | **No.** `StudixPostgreSQL` is `AUTO_START` — Windows starts it on every boot, before `StudixApp` (explicit service dependency). |
| Start Node manually? | **No.** `StudixApp` is also `AUTO_START`, wrapped by NSSM as a real Windows service. |
| Run any command? | **No**, for normal daily use. |
| Need Command Prompt? | **No.** |
| Need Administrator rights every time? | **No** — only the one-time install/uninstall/upgrade needs admin; using the app day-to-day (opening the browser, logging in, using the app) does not. |
| After a Windows restart? | Both services restart automatically; the customer just opens the Studix shortcut (or browser bookmark to `http://localhost:4000/`) as usual, no waiting required beyond normal Windows boot time. |
| If Studix (the browser tab) is closed? | Nothing happens to the services — they keep running in the background regardless of whether any browser window is open. Reopening `http://localhost:4000/` picks up exactly where it left off. |
| If the PC loses Internet? | No effect — everything (app, database, license verification) runs 100% locally. Internet has no role in Studix's daily operation at all. |
| Where is the data? | `C:\ProgramData\Studix\pgdata\` (never edit these files directly). |
| Where are backups? | `C:\ProgramData\Studix\backups\` — see §11; the customer does not need to interact with these day-to-day. |

The customer's entire normal workflow is: **turn on the PC → open the browser bookmark → log in.** Nothing else.

---

## 11. Backup and Recovery

Based directly on `backend/src/db/backup.js`.

- **Where stored:** `C:\ProgramData\Studix\backups\` (overridable only via the `STUDIX_BACKUP_DIR` environment variable, intended for development use, not customer machines).
- **How created:** a full `pg_dump` in PostgreSQL's compressed **custom format** (`-F c`), named `pre-migration-<ISO-timestamp>.dump`.
- **When created — automatically:** **only** immediately before an upgrade applies at least one pending database migration (`backend/src/db/migrationRunner.js` calls `createPreMigrationBackup` only when there is real migration work to do). A fresh install with no prior data has nothing to migrate, so it may create zero backups on day one — this is normal, not a bug.
- **When created — manually (owner/operator procedure, not customer-facing):** there is no customer-facing "click to back up now" button anywhere in the current UI. If you want an on-demand backup outside the automatic pre-migration trigger, you (the operator) run `pg_dump` yourself the same way the code does, e.g.:
  ```
  "C:\Program Files\Studix\pgsql\bin\pg_dump.exe" "postgresql://studix_admin:<password>@127.0.0.1:55432/studix" -F c -f "C:\ProgramData\Studix\backups\manual-backup.dump"
  ```
  (the admin password lives in `C:\ProgramData\Studix\config\admin.env` on that machine).
- **What they contain:** the complete `studix` database — schema and all data — at the moment of the backup. They do **not** contain `ProgramData\Studix\config\` (secrets/connection strings) or `logs\`.
- **How to copy safely:** the `.dump` files are static, self-contained files once written — safe to copy to a USB drive or another location at any time using normal Windows file copy; no need to stop any service first.
- **How to restore:** this is an **owner/operator procedure, not a customer procedure** — there is no restore button in the app. Use `pg_restore` against the target `studix` database, e.g.:
  ```
  "C:\Program Files\Studix\pgsql\bin\pg_restore.exe" -h 127.0.0.1 -p 55432 -U studix_admin -d studix --clean "C:\ProgramData\Studix\backups\pre-migration-<timestamp>.dump"
  ```
  Confirm you're restoring into the correct, intended database before running this — `--clean` drops existing objects first.
- **What NOT to delete:** never delete `C:\ProgramData\Studix\backups\` or its contents manually unless you are certain you no longer need any of them — the installer itself never deletes this folder under any circumstance, including a full data-wipe uninstall (§13).
- **During uninstall:** `backups\` is **always** preserved — both on a normal uninstall and on the explicit "delete all data" wipe path. This is a deliberate, tested guarantee (confirmed twice in the E2E run, including a hash comparison proving the backup file was byte-for-byte unchanged after a full destructive wipe).
- **During upgrade:** untouched — upgrades never delete anything in `ProgramData\Studix\`; they may *add* a new pre-migration backup if the upgrade includes new migrations.

---

## 12. Upgrade Procedure

Directly verified in Phase 3 of the E2E test (a real upgrade over a live, in-use installation with real data).

1. **What file to give them:** the new version's `StudixSetup-X.Y.Z.exe`, built and verified the same way as this one.
2. **Should the customer close Studix first?** Not strictly required — the installer's `PrepareToInstall` step (`installer/studix.iss`, INSTALL-07) automatically stops both `StudixApp` and `StudixPostgreSQL` before copying any files, and restarts them afterward as part of the normal install sequence. As a courtesy, closing their browser tab first avoids a mid-session interruption, but no data is at risk either way.
3. **Do you need to manually stop services first?** **No** — this is handled automatically and was directly verified working (Phase 3 diagnostic log shows the service correctly detected as already-owning the data directory and started through the SCM, never via a raw/ad-hoc process).
4. **What happens to existing data?** Fully preserved — `pgdata\` is never touched by an upgrade's file-copy step (only `Program Files\Studix\` is overwritten). Verified directly: all test records and the active license survived the real upgrade in the E2E run.
5. **What happens to the license?** Fully preserved — same `licenseId`, same payload, confirmed identical before and after.
6. **What happens to PostgreSQL?** The *service* is stopped, its binaries are replaced with the new version's bundled ones, then it is re-registered (idempotent — a no-op if already correctly registered) and started again **through the Windows Service Control Manager**, never via a raw ad-hoc process — this exact interaction was specifically re-verified with direct log evidence during the final E2E pass.
7. **What happens to configuration?** `ProgramData\Studix\config\.env` and `admin.env` are untouched by the upgrade's file copy (they live in `ProgramData`, not `Program Files`).
8. **What happens to backups?** Untouched, and a new one may be added automatically if the upgrade ships new database migrations (§11).
9. **What if the upgrade fails partway through?** Every step in the install orchestrator is independently idempotent and safely re-runnable — per its own design, there is **no custom rollback logic**; the fix for a failed upgrade is to simply re-run the same installer again (§3, step 9). This is a deliberate design decision documented directly in `backend/src/installer/firstInstall.js`'s own header comment.
10. **Is rollback to the previous version supported?** **No formal rollback mechanism exists.** If you need to revert to an older Studix version, you would need to keep that version's installer and re-run it — but be aware this does not automatically reverse any database migrations that were already applied by the newer version.

---

## 13. Uninstall Scenarios

There are exactly two paths, controlled entirely by how the operator answers the uninstaller's own confirmation dialogs. **These are easy to confuse — read carefully.**

### Normal uninstall (answer **No** to the first dialog)

The uninstaller shows: *"هل تريد أيضاً حذف جميع بيانات Studix نهائياً؟"* (Do you also want to permanently delete all Studix data?) — **click No.**

| Item | Result |
|---|---|
| `StudixApp` / `StudixPostgreSQL` services | **Removed** (unregistered) |
| `C:\Program Files\Studix\` | **Fully removed**, including files, tools, and the previously-known-defective leftover empty folders — this exact scenario was directly re-tested and confirmed fixed |
| `C:\ProgramData\Studix\pgdata\` | **Preserved** |
| `C:\ProgramData\Studix\config\` | **Preserved** |
| `C:\ProgramData\Studix\logs\` | **Preserved** |
| `C:\ProgramData\Studix\backups\` | **Preserved** |
| Orphan processes | None — verified |

Use this when: replacing the program files (e.g. as a manual pre-step before a clean reinstall) while intending to keep the customer's data intact.

### Full data wipe (answer **Yes** to both dialogs)

1. First dialog (same as above) → click **Yes**.
2. A second, stronger warning appears: *"تحذير: هذا الإجراء نهائي ولا يمكن التراجع عنه..."* (Warning: this action is final and cannot be undone...) → click **Yes** only if you are certain.
3. Standard Windows "Are you sure you want to completely remove Studix?" confirmation → click **Yes**.

| Item | Result |
|---|---|
| `StudixApp` / `StudixPostgreSQL` services | **Removed**, with a fail-closed safety guard: if either service cannot be *confirmed* safely stopped and unregistered, the **entire uninstall aborts before deleting anything** |
| `C:\Program Files\Studix\` | **Fully removed** |
| `C:\ProgramData\Studix\pgdata\` | **Permanently deleted** |
| `C:\ProgramData\Studix\config\` | **Permanently deleted** |
| `C:\ProgramData\Studix\logs\` | **Permanently deleted** |
| `C:\ProgramData\Studix\backups\` | **Always preserved — never deleted by this path either** |
| External/unrelated PostgreSQL on this machine | **Never touched**, under any circumstance — directly re-verified |

**This is irreversible for anything not covered by a backup.** Only ever choose Yes/Yes if you have already confirmed a recent, valid backup exists in `backups\` (or have deliberately copied it elsewhere first) and genuinely intend to erase the customer's database.

---

## 14. Troubleshooting

| Problem | What I see | Likely cause | Exact action |
|---|---|---|---|
| Installer will not start | Nothing happens on double-click | File blocked or corrupted | Verify SHA256 (§2); if it doesn't match, get a fresh copy |
| SmartScreen warning | "Windows protected your PC" | Installer is not code-signed (§1/§2) | Click **More info** → **Run anyway** |
| Antivirus removes/quarantines the installer | File disappears after download/copy | Heuristic flag on an unsigned installer bundling `nssm.exe`/`postgres.exe` | Restore from quarantine or whitelist the file; re-verify SHA256 afterward |
| Installation fails, message box with a step name | e.g. `[provision_postgres] ...` | Any transient issue during first-run provisioning | Simply re-run the installer — every step is safely re-runnable (§3, step 9) |
| PostgreSQL service won't start | `sc.exe query StudixPostgreSQL` shows `STOPPED` | Corrupted/incomplete `pgdata\`, or version mismatch after a manual file edit | `classifyDataDir`/`provisionPostgres` fail closed rather than guessing — check `C:\ProgramData\Studix\pg-startup.log` for the real PostgreSQL error; do not manually edit `pgdata\` files |
| Studix (app) service won't start | `sc.exe query StudixApp` shows `STOPPED` | `StudixPostgreSQL` isn't running yet (hard dependency) or `.env` is missing/corrupted | Confirm `StudixPostgreSQL` is `RUNNING` first; check `C:\ProgramData\Studix\logs\studix-app-service-stderr.log` |
| Port conflict | Health check fails, startup log mentions the port | Something else is already bound to `127.0.0.1:4000` or `:55432` (Studix's own bundled instances only — never 5432) | Free the conflicting port, or identify what else on the machine is using 4000/55432 |
| Database connection failure | `/health` shows `"connected": false` | `StudixPostgreSQL` not running, or `config\.env`'s connection string doesn't match reality | Verify the service first; do not hand-edit `.env` unless you know exactly what you're changing |
| App opens but shows "requires activation" | Activation screen appears for every action | Expected state before a license is activated | Follow §6/§7 — this is not an error |
| "Wrong machine" on activation | Rejected, generic failure message shown to customer; real reason is `wrong_machine` (only visible in `activity_logs`) | License artifact was issued for a different machine's `machineId`, or Windows was freshly reinstalled | Customer must generate a new Activation Request Code on **this** machine; you issue a fresh artifact against it (§6) |
| Expired license | Activation screen re-appears, `reason: expired` | The issued license had a fixed expiry date that passed | Issue a new artifact (§6) — no separate "renew" command exists, just issue again |
| Invalid/tampered license | Rejected, `invalid_signature` or `malformed_artifact` in `activity_logs` | Copy/paste error (missing characters), or the artifact was altered | Have the customer re-copy the exact string you sent; re-send if unsure |
| Admin login problem | "incorrect username/password" | Wrong credentials, or no admin exists yet | If no admin exists yet, go to `http://localhost:4000/setup` (§5/§8), not `/login` |
| App doesn't open after Windows restart | Browser shows "can't reach this page" | Services may still be starting, or failed to start | Wait ~30 seconds after boot; then check both services with `sc.exe query`; check `logs\` for errors |
| Upgrade problem | Message box names a failing step | See §12 | Re-run the same installer again — safe and expected to resolve most transient failures |
| Uninstall problem | Message box during removal | A service could not be confirmed stopped/unregistered | The fail-closed guard means **no data was deleted** — verify service state manually, resolve, then retry |
| Data appears missing | Students/payments not visible | Wrong install was reinstalled fresh instead of recovering existing `pgdata\` (a truly fresh install always starts empty), OR a full data wipe was performed by mistake (§13) | Check whether `C:\ProgramData\Studix\pgdata\` exists and has real content; if genuinely gone, only a backup in `backups\` (or one you copied elsewhere) can recover it |
| Backup problem | `pg_restore`/`pg_dump` errors | Wrong credentials (`admin.env`), or the target database already has conflicting data | Confirm you're using the exact `STUDIX_DB_ADMIN_URL` from that machine's own `admin.env`; use `--clean` deliberately, understanding it drops existing data first |

---

## 15. Exact Paths and Commands

| Path | Contains | Safe to modify/delete? |
|---|---|---|
| `C:\Program Files\Studix\` | Program binaries (Node, PostgreSQL binaries, NSSM, app code) | Never modify by hand. Fully replaced by upgrades, fully removed by any uninstall. |
| `C:\ProgramData\Studix\pgdata\` | The actual customer database | **Never** touch directly. Only removed by the explicit full-wipe uninstall path. |
| `C:\ProgramData\Studix\config\.env` | Runtime app config (restricted DB connection, session secret, port) | Do not hand-edit unless you know exactly what you're changing; deleting it will break the running app. |
| `C:\ProgramData\Studix\config\admin.env` | Privileged DB connection, used only for install/upgrade/migration | Never share this file or its contents with anyone outside your own operational team. |
| `C:\ProgramData\Studix\logs\` | Application + service logs | Safe to read/copy; safe to delete old log files if disk space is a concern (the app will just create new ones). |
| `C:\ProgramData\Studix\backups\` | Pre-migration `.dump` backups | **Never delete** unless you're certain you don't need them; the installer itself never touches this folder under any circumstance. |
| `C:\ProgramData\Studix\pg-startup.log` | One-time ad-hoc PostgreSQL startup log (fresh-init only) | Diagnostic only, safe to delete. |

| Command | When to use it |
|---|---|
| `sc.exe query StudixApp` / `StudixPostgreSQL` | Verify service state (§5, §9, §14) |
| `sc.exe stop StudixApp` / `sc.exe start StudixApp` | Manually restart the app service (troubleshooting, or persistence testing) — requires an elevated prompt |
| `Get-FileHash <file> -Algorithm SHA256` (PowerShell) | Verify the installer before sending it to a customer (§2) |
| `"C:\Program Files\Studix\pgsql\bin\psql.exe" -h 127.0.0.1 -p 55432 -U studix_admin -d studix` | Direct database access (owner-only — needs the password from `admin.env`) |
| `"C:\Program Files\Studix\pgsql\bin\pg_dump.exe" ... -F c -f <path>` | Manual on-demand backup (§11) |
| `"C:\Program Files\Studix\pgsql\bin\pg_restore.exe" ... --clean <dump file>` | Restore from a backup (owner-only, §11) |
| `node tools/license-keygen.js` | One-time (or deliberate rotation) — generate your signing keypair (§6) |
| `node tools/license-issuer.js` | Every time you issue/renew a customer license (§6) |

---

## 16. Owner vs Customer

| Task | Owner/Admin (you) | Customer |
|---|:---:|:---:|
| Install | ✅ (or walk the customer through §3) | Can do it themselves following §2–§3 |
| First admin account creation | Either | Either — whoever is at the keyboard for `/setup` |
| License generation (`license-issuer.js`) | ✅ Only you | ❌ Never — requires your private key, which never leaves your machine |
| Public-key provisioning into a new install | N/A — automatic, done by the installer (§6) | N/A — automatic |
| Activation (pasting the artifact) | Can do it if on-site | ✅ Normally the customer's admin, guided by you |
| Database management (backup/restore) | ✅ | ❌ Not exposed in the UI at all |
| Backup (automatic, pre-migration) | N/A — automatic | N/A — automatic, invisible to daily use |
| Backup (manual, on-demand) | ✅ | ❌ |
| Restore | ✅ Only | ❌ |
| Upgrade | ✅ (or walk the customer through §12) | Can run the new installer themselves if guided |
| Uninstall (normal) | Either | Either, but should understand §13's distinction first |
| Uninstall (full data wipe) | **Strongly recommend this is you, or done with your explicit direction** | Only with full understanding of §13 |
| Troubleshooting | ✅ Primary | Can follow simple steps in §14 with guidance |

---

## 17. "Do Not Do This"

- **Do not** answer "Yes" to the first uninstall dialog unless you genuinely intend a permanent data wipe — there is no "undo" (§13).
- **Do not** hand-edit files inside `C:\ProgramData\Studix\pgdata\` directly — this is a live PostgreSQL data directory; manual edits can corrupt it beyond automatic recovery (the code deliberately fails closed rather than trying to repair a directory it doesn't fully trust).
- **Do not** delete `C:\ProgramData\Studix\backups\` "to save space" — it is never regenerated on demand, and it's the only safety net for the full-wipe uninstall path.
- **Do not** copy `pgdata\` from one physical machine to another expecting the license to keep working — machine-bound licensing will correctly reject it (`wrong_machine`); this requires a fresh Activation Request Code and a fresh artifact from you (§6).
- **Do not** share, email, or store the licensing **private** key (`license-private-key.pem`) anywhere near the licensing **public** key or on any customer machine — losing control of it means anyone could issue valid licenses for every customer you have (§6).
- **Do not** run `license-keygen.js --force` casually — licenses you sign with the new key will not activate anywhere until you ship a new Studix release that carries the new public key, and after customers install that release their existing licenses must be re-issued (§6, "Key rotation").
- **Do not** edit `license_config.licensing_public_key` in a customer's database by hand — the app only trusts the key built into its release, so a hand-edited value just blocks activation; re-run the installer instead (§6).
- **Do not** assume an in-progress upgrade needs manual service stopping — doing so unnecessarily risks interrupting the installer's own automatic, tested stop/start sequencing (§12).
- **Do not** rely on any "renew license" or "self-service transfer" feature — none exists; every license event goes through you personally (§6).
- **Do not** tell a customer there's a default admin password — there isn't one; it's created live, per installation, during `/setup` (§8).

---

## 18. Studix — New Customer Deployment Checklist

*Print this page. Keep it next to you while installing Studix for a customer.*

```
BEFORE YOU ARRIVE
[ ] Installer file ready: StudixSetup-1.0.0.exe
[ ] SHA256 verified: 4A5FC7A0685EE0B6FB269A0AF5CCD8423459480F4A94172F1843A0657C6FD695
[ ] You have your license-issuer.js set up and your keypair (one-time, §6)

ON THE CUSTOMER'S PC
[ ] Confirm 64-bit Windows, admin account available
[ ] Confirm no conflicting Studix already present, or knowingly upgrading (§12)
[ ] Copy/run StudixSetup-1.0.0.exe
[ ] Click through SmartScreen ("More info" -> "Run anyway") if it appears
[ ] Approve the UAC prompt
[ ] Accept all installer defaults; click Install
[ ] Wait for the automatic provisioning step to finish (do not close the window)
[ ] Confirm browser opens automatically to http://localhost:4000/

FIRST-RUN SETUP
[ ] Manually go to http://localhost:4000/setup (NOT automatic!)
[ ] Create the first admin account (name, username, password >= 8 chars)
[ ] Confirm you land on the normal app after creation

ACTIVATION
[ ] Log in as the new admin
[ ] Click "Get Activation Code" on the Activate screen; copy it
[ ] Send the code to yourself (owner) through your usual channel
[ ] Run node tools/license-issuer.js on YOUR machine; paste the code
[ ] Send the resulting License Artifact back to the customer's admin
[ ] Paste it into the Activate screen; click Activate; confirm success

VERIFICATION (Section 9 checklist)
[ ] Both services RUNNING
[ ] /health returns 200
[ ] Create one real test record; confirm it saves
[ ] Restart StudixApp service; confirm everything (data + license) survives

HANDOFF TO CUSTOMER
[ ] Show them the Start Menu shortcut / browser bookmark
[ ] Confirm they understand: no manual start needed, ever (Section 10)
[ ] Confirm they know NOT to touch C:\ProgramData\Studix directly
[ ] Remind them backups live in C:\ProgramData\Studix\backups\ and are never auto-deleted
[ ] Leave them your contact for license renewal / machine changes (Section 6)
```
