# Identity Reconciliation Audit

**Status: READ-ONLY. No code, schema, database, or localStorage was modified to produce this report.** Postgres facts below come from direct, read-only `SELECT`-equivalent Prisma queries this session. No plaintext password, password hash value, session token, or other secret appears anywhere below — only format/status descriptions (e.g., "well-formed pbkdf2 hash" vs. the literal value).

**Important scope limitation, stated up front:** this audit can only directly verify **PostgreSQL**. The three `localStorage` keys (`studix-auth-users`, `studix-auth-roles`, `studix-auth-teachers`) live in a browser, not in this filesystem or database — and no live browser session was available this session (the Chrome extension used for browser automation was not connected, and no dev server was running to load the app into a fresh tab). See §7 for exactly what this means and how to close the gap safely before the eventual migration proceeds.

---

## 1–8: PostgreSQL — directly verified

### `users` table

| id | role_id | is_admin | active | teacher_id | permissions | email | last_login | password_hash status |
|---|---|---|---|---|---|---|---|---|
| `admin` | `admin` | true | true | NULL | NULL (no per-user override) | `admin@center.com` | 2026-08-19T12:27:18Z | **well-formed `pbkdf2:` hash (4 parts)** — not plaintext, not the `admin123` literal |

**Count: 1 user.** No other rows exist.

**[FACT]** The real login on 2026-08-19 (3 days before this audit) confirms this account has been actively used recently through the real backend — it is not an untouched, never-logged-into stub.

**[FACT]** The stored `password_hash` is already a properly formatted PBKDF2 hash (matching the `pbkdf2:<iterations>:<salt>:<hash>` shape used by both the frontend's `hashPassword()` and the backend's `verifyPbkdf2()`). **It is not the plaintext `admin123` string** — that literal exists only in frontend source (`initialData.js`), never in this Postgres row. Whatever the real password for this account is, it was set through a real hashing path at some point, not left as the seed literal.

### `roles` table

| id | label | is_system | permissions |
|---|---|---|---|
| `admin` | مدير النظام | true | NULL |
| `teacher` | مدرس | false | NULL |
| `accountant` | محاسب | false | NULL |
| `reception` | موظف استقبال | false | NULL |

**Count: 4 roles**, ids and labels matching `INITIAL_ROLES` (frontend) exactly. **All four have `permissions = NULL`** — the column exists and is schema-ready but has never been populated server-side (consistent with the prior audits' findings).

### `teachers` table

**Count: 0 rows.** Empty. Confirms the earlier finding that this real, Postgres-backed, `PG_COLLECTIONS`-synced collection has no data and (per the prior contract) no consumers anywhere in the UI.

### User ↔ teacher relationships (Postgres)

**None exist** — the single `users` row has `teacher_id: NULL`, and `teachers` is empty, so there is nothing to link.

### Password storage format / hash compatibility (item 13–14)

**[FACT]** The one existing Postgres password hash is in the well-formed `pbkdf2:iterations:salt:hash` format, directly verifiable by the backend's `verifyPbkdf2()` (format is checked structurally — 4 colon-separated parts, numeric iteration count — without exposing the value itself). **Every password hash currently in Postgres (i.e., this one) is already compatible with backend verification.** There are zero incompatible/malformed hashes in Postgres today, because there is only the one row and it is already correct.

### Duplicate/conflicting identities (item 15) — Postgres side

**None possible today** — with a single row, there is nothing to conflict with. Worth noting for the future: the schema has **no unique constraint on `users.email`** (confirmed via `schema.prisma` — only `id` is a primary key on `users`; no `@unique` on `email`), so Postgres itself would not prevent two future rows from sharing an email address. This is a latent schema gap, not a currently-manifested conflict.

---

## PostgreSQL summary table

| Metric | Value |
|---|---|
| Users in Postgres | 1 (`admin`) |
| Roles in Postgres | 4 (all seeded, all with `permissions = NULL`) |
| Teachers in Postgres | 0 |
| User↔teacher links | 0 |
| Hashes in incompatible format | 0 (of 1) |
| Duplicate/conflicting identities | 0 (of 1) |

---

## 9–16: `localStorage` (`studix-auth-users` / `studix-auth-roles` / `studix-auth-teachers`) — what could and could not be verified

**[FACT — the central limitation of this report]** These three keys are browser `localStorage`, populated and mutated only by `auth.context.jsx` running inside an actual browser tab. This audit had no live browser session available: the Chrome browser-automation extension reported as not connected, and no dev server was running on this machine to load a fresh tab against. **There is no code path, file, or database that mirrors these keys' actual runtime content** — by design, they are local-only and were deliberately excluded from server-side sync (§2 of the prior contract). This audit therefore cannot state what is *actually* stored in any real, already-used browser's copies of these three keys.

What **can** be established without a live browser:

### Seed/default baseline (item 11 — what a *never-modified* browser would contain)

| Key | Seed source | Seed content |
|---|---|---|
| `studix-auth-users` | `INITIAL_USERS_V2` (`src/data/initialData.js:109`) | 1 entry: `admin` (plaintext `admin123` literal, `isAdmin:true`, `active:true`, `permissions:null`) |
| `studix-auth-roles` | `INITIAL_ROLES` (`src/data/initialData.js:84-105`) | 4 entries (`admin`/`teacher`/`accountant`/`reception`), each with a real, non-null `permissions` array (unlike Postgres's NULL values) |
| `studix-auth-teachers` | `INITIAL_TEACHERS` (`src/data/initialData.js:80-81`) | 0 entries (empty array) |

This is the **floor**, not necessarily the current state — any browser where an operator actually used `UsersPage.jsx` to add/edit/delete a user, role, or teacher would have runtime-created records layered on top of this seed, and this audit cannot see those.

### A pre-existing tool for exactly this purpose was found (item 9/10/16)

**[FACT]** `migration/export-localstorage.js` already exists in this repository — built in an earlier phase specifically to solve this exact problem. It is genuinely read-only (its own header states "لا يكتب لـ localStorage ولا يحذف منه — قراءة فقط" — "does not write to or delete from localStorage — read only"). It exports **exactly** the three keys this audit needs (plus `studix-v1` and any other `studix*` key, as a safety net), as a downloadable JSON file, via a snippet meant to be pasted into a real browser's console while the app is open.

**No exported file (`studix-localstorage-backup.json`) currently exists anywhere in this repository** — confirmed via a filesystem search. This means the tool was either never run, or was run and its output was never saved into the repo. Either way, **no snapshot of real browser data is available to this audit right now.**

### What items 9, 10, 12, 15, 16 require to answer definitively

- **9. Records that exist only locally** — cannot be determined without the export above (Postgres has 1 user/4 roles/0 teachers; whether any browser's local copy has *more* than that seed is unknown).
- **10. Records that exist only in Postgres** — the reverse comparison is at least partially answerable: the Postgres `admin` row's id matches the seed `studix-auth-users`' `admin` entry by id, so at minimum, **no Postgres record is definitely absent from every possible local copy** (assuming no browser has ever deleted its local `admin` entry) — but this can't be fully confirmed without the export either.
- **12. Records that appear user-created** — cannot be assessed without the export; the seed itself contains only demo/bootstrap data (`admin` only, empty teachers).
- **15. Duplicate/conflicting identities across sources** — cannot be fully assessed without the export; the only thing confirmable today is that the `admin` id is consistent between Postgres and the seed default.
- **16. Data that cannot be safely reconciled automatically** — **provisionally, the single highest-risk known case is the plaintext `admin123` value in the `studix-auth-users` seed itself** (§below) — this cannot be inserted as-is into Postgres `password_hash` (would fail `verifyPbkdf2`'s format check and lock that identity out), and requires explicit remediation (Decision 8's bootstrap mechanism is the natural vehicle for the `admin` case specifically; any other locally-created account still holding an unhashed value would need the same treatment). No other reconciliation conflict can be identified without first seeing real exported data.

### Safe next step to close this gap (not executed — offered, not run)

To get a real answer for items 9/10/12/15/16, the existing `migration/export-localstorage.js` tool should be run **by a human, in a real browser where the app has actually been used** (if such a browser exists) — it produces only a JSON export of exactly these keys, with no plaintext-password redaction built in today (the export includes whatever the local `password` field holds — hashed or not), so the resulting file must be treated as sensitive and **must not be pasted into chat or committed to source control**; if produced, it should be handed to a future read-only reconciliation pass for inspection (counts/ids/roles/format only, never printing password fields), exactly as this report has done for the Postgres side.

If no such browser exists (i.e., this application has only ever been run in fresh/dev-seed states, with no operator having used `UsersPage.jsx` to create real accounts), then the seed-baseline table above already **is** the complete picture, and reconciliation reduces to the single known case: replacing the `admin123` plaintext seed value per Decision 8, with nothing else to migrate.

---

## 17. Security note on this report itself

Per the requirement, this report contains no plaintext passwords, no password hash values, no session tokens, and no other secret — only counts, ids, role names, active-state booleans, and hash-format status (e.g., "well-formed pbkdf2 hash") were recorded, both for Postgres (queried directly, values discarded after format-checking) and for the seed defaults (which are already public in source, but are still described only by shape here, not reproduced as literal credential material beyond the single already-known-public `admin123` label, which is unavoidable to name since it is itself the subject of Decision 8).

---

## Summary for the pending migration decision (Decision 6)

- **Postgres side is fully known**: 1 user (`admin`, real pbkdf2 hash, actively used), 4 roles (seeded, unpopulated permissions), 0 teachers, 0 relationships, 0 hash incompatibilities, 0 duplicates.
- **Local-store side has a known floor (the seed defaults) but an unknown ceiling** (whatever has been created at runtime in any real browser) — this audit cannot see past the floor without either live browser access (unavailable this session) or a human running the existing `export-localstorage.js` tool and handing back its (sensitive, non-committable) output for a follow-up read-only pass.
- **The one certain, already-actionable finding regardless of that gap**: the plaintext `admin123` seed value cannot be migrated as-is under any circumstance (Decision 6's "do not migrate plaintext passwords" rule) and must go through Decision 8's bootstrap-replacement path instead of a data copy.

No files were modified. No schema was changed. No database write occurred. No localStorage was read, written, or cleared (no live browser was accessed). Awaiting your review before any implementation proceeds.
