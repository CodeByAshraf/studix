# Research: Studix Chat Assistant — V1 Help Assistant

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-27

Every decision below is grounded in the current code (commit `8e4429e`). File references are to real, existing files.

---

## R1 — Where the assistant setting and credential live

**Decision**: Store the setting and credential in a new file, `%ProgramData%\Studix\config\assistant.json`. The directory is resolved the same way `backend/src/lib/config.js` resolves `.env` (via `STUDIX_CONFIG_PATH` or `ProgramData`). The file is:
- read through a small in-process cache that is invalidated on every write, so enable/disable takes effect immediately (FR-005);
- written atomically (temporary file, then rename), with the backend running as SYSTEM;
- never returned to the browser in raw form.

**Rationale**:
- `config\` already holds `SESSION_SECRET` and database URLs, protected by the installer's Administrators+SYSTEM-only ACL (`backend/src/installer/dataDirAcl.js`). The credential gets the same, already-validated protection.
- It is **not in PostgreSQL**, so it can never appear in `pg_dump` backups (`backups\*.dump`), which satisfies FR-024 and SC-008.
- No database migration is needed (Constitution III is untouched).
- The lifecycle matches expectations:
  - upgrade and Mode A uninstall keep `config\`, so an admin's choice survives;
  - Mode B uninstall deletes `config\`, so the credential is wiped;
  - a fresh install has no file, which means disabled (FR-001).

**Alternatives considered**:
- *New DB table or column*: rejected. It lands in every backup dump (credential leak), and needs a migration.
- *`config\.env`*: rejected. It is loaded once at startup via `dotenv` (no hot toggle), and `firstInstall.js`'s `ensureProductionConfig` owns that file's lifecycle.
- *Windows DPAPI encryption at rest*: rejected for V1. The backend runs as SYSTEM, so anyone able to read the ACL-protected file is already an administrator on the machine. It adds native complexity for no real gain, and is inconsistent with how `SESSION_SECRET` is stored. It can be revisited if the threat model changes.

**Fail-closed rule** (Constitution I): a missing, unreadable, or malformed file, an unknown `version`, or a missing credential all resolve to **disabled**.

## R2 — Provider adapter and first provider

**Decision**: A single backend interface, `generateReply({ system, messages, maxOutputTokens, signal }) → { text, stopReason: 'end'|'length', usage }`. It throws only a normalized `ProviderError{kind}` (R8). It has:
- `fakeProvider`: deterministic and recording, used by all automated tests;
- **one** real cloud adapter, selected by `provider` in the settings file.

The rest of the system (routes, prompt assembly, limits, egress guard) depends only on the interface.

**Owner decision (recorded)**: **provider selection is deferred to Phase F.** Phases A–E and G are fully provider-neutral and testable with `fakeProvider`.

- **Transport (owner decision)**: an official provider SDK **may** be used in Phase F if appropriate, **only inside the adapter file** (FR-028). Otherwise Node 24's built-in `fetch`. A test asserts that no module outside `assistant/providers/<provider>Provider.js` imports the SDK.
- **If the provider is Anthropic**: use `@anthropic-ai/sdk` on the backend. Mark the static system prompt plus knowledge base for prompt caching (stable prefix, R3). Handle `stop_reason` values, including `refusal`.

**Rationale**: The provider abstraction is an explicit product decision. A fake is needed for tests anyway, so the interface adds no speculative complexity (recorded in Complexity Tracking).

**Alternatives considered**: calling a provider directly from the route (rejected: untestable without network, violates the "replaceable provider" requirement FR-027); an owner-run relay now (deferred: it is simply another adapter later).

## R3 — Knowledge base and prompt assembly

**Decision**:
- **Storage**: curated Markdown files in `backend/src/assistant/knowledge/` (articles) plus `errors.md` (error catalog). Each file has a small header block: `id`, `title`, `pages` (route ids), `audience` (`all` | `admin`), `reviewed` (date).
- **Loading**: loaded once at startup into **one deterministic system text**, with a stable file order and no timestamps, which enables provider-side prompt caching. A `KB_VERSION` hash is computed from the content and logged with each request.
- **No retrieval, embeddings, or vector store in V1.** The expected corpus (15–25 short articles plus the error catalog) fits comfortably in one prompt (YAGNI, Constitution VI).
- **Shipping**: `scripts/build-windows-runtime.ps1`'s `Copy-ExcludingTests` copies **every non-test file** under `backend/src`, so `.md` files ship with no build change.

**Style (owner decision)**: professional/formal Arabic with Egyptian-friendly phrasing. Each article lists **common colloquial aliases** for its feature/action (for example "تحصيل / أدفّع / أسجل دفعة" → payments), so colloquial questions map to the right page. The owner/reviewer reviews every article before release.

**Source material**: `docs/PRODUCTION-RUNBOOK.md`, the customer-facing parts of `tools/LICENSING.md`, the `src/constants/nav.js` labels, module UIs, and backend Arabic error strings, all rewritten as end-user guides. **Excluded**: owner-only README sections (license issuing, private keys, support signing) and `migration/reports/*`.

**Static guard**: a test fails if any knowledge file contains owner-only markers (`PRIVATE KEY`, `license-issuer`, `license-keygen`, `support-signer`, `STUDIX_LICENSE`, `admin.env`, `DATABASE_URL`, …).

## R4 — Conversation handling and backend-enforced limits (FR-018)

**Decision**:
- **Client**: the browser holds the transcript in React state only (FR-014). It pre-trims to the last 10 messages as a courtesy, but **the server is the only enforcement point**.
- **Server pipeline, in order** (all limits are named constants in `assistant/limits.js`):
  1. **Request size**: after the global `express.json` (5 MB app-wide cap, unchanged), the route rejects a body whose `Content-Length` header **or** serialized size exceeds **32 KB**. Result: `413 ASSISTANT_REQUEST_TOO_LARGE`.
  2. **Shape**:
     - `messages` must be a non-empty array of `{role:'user'|'assistant', text:string}`;
     - the last item must be `role:'user'`;
     - unknown fields are ignored;
     - client-supplied system/instruction roles are **rejected**.

     Result: `400 ASSISTANT_INVALID_REQUEST`.
  3. **Per-message length**: any message > **2,000** characters (after trim) is **rejected**, never silently cut. Result: `400 ASSISTANT_MESSAGE_TOO_LONG`. Empty messages give `400`.
  4. **Turn window**: keep only the most recent **10** messages; drop the oldest first.
  5. **History budget**: while the kept messages exceed **12,000** characters in total, drop the oldest. The latest user message is never dropped; if it alone exceeds the budget, step 3 has already rejected it, because 2,000 < 12,000.
  6. After trimming, the first kept message must be `user`. A leading `assistant` message is dropped, keeping provider turn rules valid.
- **Output limits**: the adapter requests at most **1,024 output tokens**. The service truncates the reply to **8,000 characters** and sets `truncated: true` when the provider stopped for its length limit **or** the character cap applied. The UI then shows a "the answer was shortened — ask a narrower question" line.
- **Units**: limits are enforced in **characters**, which are deterministic and provider-independent. Tokens are used only for the provider's output cap.
- **Storage**: nothing is written to the database or disk (logs carry metadata only, FR-026).

## R5 — Page context

**Decision**: The client may send `page`. The server accepts it only if it is one of the route ids in `src/constants/routes.js` (a server-side copy of the allowlist). Anything else is dropped silently. This keeps free text out of this field, so it is never an egress channel (FR-021c).

## R6 — Rendering model output safely

**Decision**:
- Render replies as **React text nodes** inside a container with `white-space: pre-wrap`, so line breaks and "1." / "-" list markers display naturally.
- **No Markdown library, no `dangerouslySetInnerHTML`, no link auto-execution.**

React escapes text by default, so `<script>`/`<img onerror>` in a reply is shown as literal text (FR-017, SC-007). A frontend test asserts this. `src/utils/sanitize.js` exists but is unnecessary when nothing is rendered as HTML.

## R7 — Limits and rate limiting

**Decision**:
- **Rate limiting**: reuse the already-installed `express-rate-limit` (as `backend/src/middleware/rateLimit.js` does) with:
  - `assistantUserLimiter`: **20 requests / 5 min per user id**;
  - `assistantIpLimiter`: **60 / 5 min per IP**.
- **Other limits**: at most **1 in-flight request per user**, which returns 429 `ASSISTANT_BUSY`. Provider output is capped at **1,024 tokens** and **8,000 displayed characters** (R4). The provider call has a **20 s** overall budget (`AbortSignal.timeout`), including any single retry (R8), meeting SC-004.
- **Tuning**: the numbers are named constants in one module.

## R8 — Provider failure isolation and error mapping (FR-029, FR-030)

**Decision**:
- **Response shape**: `{ ok:false, error:<fixed Arabic text>, code:<MACHINE_CODE> }`. Every `error` string comes from **one constant table** in `assistant/errors.js`. The response never interpolates provider text, `err.message`, a stack, an endpoint, a request id, a path or a secret.
- **Adapter contract**: each adapter must translate *every* provider or transport failure into one of these **normalized kinds** before it leaves the adapter: `timeout`, `unavailable`, `auth`, `quota`, `rate_limited`, `bad_response`. Anything unrecognized becomes `unavailable`. The route only ever sees these kinds.
- **Mapping**:

  | Normalized kind | HTTP | `code` | Admin `lastError.category` | Retry |
  |---|---|---|---|---|
  | `timeout` (20 s budget elapsed) | 504 | `ASSISTANT_TIMEOUT` | — | none |
  | `unavailable` (network/DNS/offline/provider 5xx/unknown) | 503 | `ASSISTANT_UNAVAILABLE` | — | ≤ 1 retry, only if time remains in the 20 s budget |
  | `auth` (invalid/revoked key) | 503 | `ASSISTANT_NOT_CONFIGURED` | `auth` | none |
  | `quota` (billing/credit/quota exhausted) | 503 | `ASSISTANT_NOT_CONFIGURED` | `quota` | none |
  | `rate_limited` (provider-side rate limit) | 429 | `ASSISTANT_PROVIDER_BUSY` | — | none |
  | `bad_response` (malformed/empty/refused/unparseable) | 502 | `ASSISTANT_BAD_RESPONSE` | — | none |

- **Logging**: `logger.warn('assistant_provider_failure', { kind, httpStatus? })`. Only the normalized kind and the provider's numeric HTTP status are logged. No provider message body is logged, because provider errors can echo request details.
- **Admin state**: `lastError = { category, at }` is written for `auth`/`quota` only, and cleared by the next successful chat or a successful connection test.
- **Authentication and activation**: failures keep today's responses (401 from `requireAuth`, 402 from the global `requireActivation`), because the route is mounted like every other protected route.
- **Unexpected exceptions** inside the assistant route are caught by the route and returned as `503 ASSISTANT_UNAVAILABLE`. They are logged by the existing `errorHandler` style *without* request body content. They never reach the generic 500 path with a stack in the response. (The existing `errorHandler` already returns only a generic message; this keeps the assistant's messages uniform.)

## R9 — Logging and audit

**Decision**:
- **Per chat request**: one `logger.info('assistant_chat', {...})` line with `outcome`, `code`, `durationMs`, `inputChars`, `usage` tokens, `kbVersion` and `page`. There is **no question/answer text and no user identity text**; the user id is omitted from the log, since `activity_logs` covers accountability for settings.
- **Settings changes**: enable, disable, credential set/cleared and disclosure acknowledgment each write an `activity_logs` row with `module:'assistant'`, via the existing `resolveActivityLogActor` + `prisma.activity_logs.create` pattern (see `backend/src/routes/license.js`). `activity_logs.module` is free text, so no migration is needed. `details` never contains the credential.

## R10 — Access control

**Decision**:
- **Mounting**: `app.use('/api/assistant', requireAuth, assistantRouter)` in `backend/src/server.js`, after the global `requireActivation`, so an unlicensed installation is refused automatically.
- **Endpoints**:
  - `GET /status`: any logged-in user.
  - `POST /chat`: any logged-in user, **only when enabled**; the enabled flag is re-read per request (fail closed).
  - `GET|PUT /settings` and `POST /settings/test`: `requireRole('admin')`, the same literal-admin guard as `/api/license` and `/api/backup-status`.
- **CSRF posture**: unchanged from every other JSON route (HttpOnly `SameSite=lax` cookie plus JSON body plus CORS allowlist).

## R13 — API key protection (FR-025)

**Decision**:
- **Write-only**: the key is write-only through `PUT /api/assistant/settings`. `settingsStore.toPublic()` is the **only** serializer used by any response. It emits `{ enabled, configured, provider, model, disclosure{…}, lastError{category, at} }`: **no key, no hint, no prefix/suffix, no length**.
- **Validation errors**: validation on the settings PUT never echoes submitted values.
- **Activity log**: `details` carry only `provider`, `model` and `disclosureVersion`.
- **Where the key lives**: it is kept in a file outside PostgreSQL, so it is never in `pg_dump` backups or the in-app JSON data export (which reads collections from the database).
- **Tests**:
  - store a sentinel key (e.g. `sk-TEST-SENTINEL-…`);
  - then assert that the sentinel is absent from every endpoint response, every log line written during the test, every `activity_logs` row, every error body, and a `pg_dump`-equivalent export of test data (SC-008).

## R14 — Best-effort masking of personal data typed by users (FR-024)

**Decision**: Before building the provider payload, `assistant/redact.js` masks the following in user-typed text:
- Egyptian mobile numbers (`01[0125]` + 8 digits, allowing spaces/dashes and Arabic-Indic digits);
- international forms (`+20…`, `0020…`);
- 14-digit national-ID numbers;

each replaced with `[رقم محجوب]`. It is documented as **best-effort** defense in depth, complementary to the persistent notice (FR-023), and not a guarantee for arbitrary free text (addresses and names cannot be reliably detected). Assistant replies echoed back in history are masked the same way.

## R15 — Evaluation gate (SC-002/003)

**Decision**: The 40-item Help set and 15-item Out-of-Scope set, with per-item criteria, live in [evaluation.md](./evaluation.md).
- They are graded by the owner/reviewer against the release provider/model.
- They are a **release gate** (Phase G exit criterion), not a unit test.
- Automated tests verify only deterministic behavior: limits, egress, key protection, error mapping and rendering.

## R11 — V2 seam (documentation only, no code in V1)

In V2, the adapter interface gains an optional `tools` parameter, and a `toolRegistry` module lists read-only tools. Each tool:
1. declares its `pageId`;
2. is **offered to the model only if** `resolveEffectivePermissions` (exported from `backend/src/middleware/permissions.js`) includes it for the current user;
3. re-checks that permission when executed;
4. calls an existing scoped service in-process (`getPaymentAggregates`, `getAttendanceAggregates`, the grades aggregates);
5. returns a whitelisted projection.

Generic CRUD `GET` endpoints are never used as tools. **None of this is built in V1.** The V1 adapter signature deliberately has no `tools` parameter.

## R12 — Test strategy

**Decision**: Tests are written before implementation, as Red-Green (Constitution IV applies to the access-control and egress paths). **No test calls a real provider.**

| Layer | What | Tool / pattern |
|---|---|---|
| Settings store | Default disabled; malformed → disabled; atomic write; credential never in `toPublic()`; cache invalidation | Vitest, temporary directory via `STUDIX_CONFIG_PATH` |
| Prompt / KB | Deterministic output (same bytes twice); owner-only marker guard; size budget | Vitest |
| Egress guard | A recording fake provider captures the exact payload across a scripted conversation. Assert that none of the FR-022 categories appear: session cookie value, `SESSION_SECRET`, DB URL, admin user id/name, license id, installation/machine id, file paths | Vitest (unit + route) |
| Limits (direct requests, SC-010) | 413 over 32 KB; 400 message > 2,000; oldest-first trimming to 10 messages and 12,000 characters; latest question never dropped; reply truncated to 8,000 characters with `truncated:true`; all enforced with the UI bypassed | Vitest (unit + route) |
| Masking | Egyptian mobile / `+20` / Arabic-Indic digits / 14-digit IDs masked; ordinary numbers such as "18" or years untouched | Vitest |
| Key protection (SC-008) | A sentinel key is absent from every response, error body, log line and `activity_logs` row | Vitest (route + store) |
| Failure isolation (SC-009) | Each normalized kind maps to exactly one code and message; a raw provider message containing a fake secret/path/stack never appears in the response or log; single retry only for `unavailable` within budget | Vitest with fake provider in failure modes |
| Routes | 401 no session; 402 unactivated; 403 disabled; 403 non-admin on settings; happy path; settings GET/PUT responses contain only public metadata | Existing backend route-test pattern (`backupStatus.test.js`) |
| Frontend | Button hidden when disabled or not logged in; panel send/receive; persistent egress notice; **`<script>` / `<img onerror>` reply rendered inertly**; transcript cleared on close/logout; admin section requires acknowledgment before enabling; credential input is write-only | Vitest + Testing Library (existing) |
| Regression | Full `npm test` (backend and frontend) with the assistant absent, disabled, and failing (SC-006) | Existing suites |
| Quality (**release gate**, not a unit test) | The 40-item Help set + 15-item Out-of-Scope set with per-item criteria, graded by the owner (SC-002/003) | [evaluation.md](./evaluation.md) |
