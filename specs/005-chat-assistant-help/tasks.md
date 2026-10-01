---

description: "Task list for Studix Chat Assistant — V1 Help Assistant"
---

# Tasks: Studix Chat Assistant — V1 Help Assistant

**Input**: Design documents from `/specs/005-chat-assistant-help/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/assistant-api.md](./contracts/assistant-api.md), [quickstart.md](./quickstart.md), [evaluation.md](./evaluation.md)

**Tests**: **Required.** The owner requested test-first delivery, and Constitution IV applies to the access-control, key-protection and egress paths. Within every phase, test tasks are written and seen to **fail** before the implementation tasks.

**Organization**: At the owner's instruction, tasks are grouped by the plan's **commit phases A–H**. **Each phase is exactly one independent commit**, and each phase runs:

**Audit → Implement → Tests (written first, Red→Green) → Review → `git diff --check` → independent Git commit → clean `git status` → next phase.**

Story labels ([US1]–[US4]) map each task to the spec's user stories for traceability:
- **US1**: ask how to do something (P1);
- **US2**: explain an error message (P1);
- **US3**: admin opt-in (P1);
- **US4**: safe failure behavior (P2).

Tasks that serve every story carry no label.

**Scope guard**: V1 only. **No V2 task exists in this file.** No tool registry, no `tools` parameter on the adapter, no database reads, no persistence, no permission changes.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task in the same phase)
- **[Story]**: US1–US4 from spec.md
- **Paths**: web app. The backend lives in `backend/src/` and the frontend in `src/` (the repository root SPA). Tests sit next to their sources (`*.test.js` / `*.test.jsx`), per the repository convention.

## Standard commit-gate steps (apply to the last tasks of every phase)

- **Review**: re-read the full diff against the phase scope. Confirm no out-of-scope file changed, no V2 code, and no secret or sentinel value committed.
- **Checks**: run `cd backend && npm test` and `npm test` (repository root). Both must be green, apart from the two pre-existing, known `ReportsPage.revenue.test.jsx` failures, which must stay unchanged in count.
- **`git diff --check`**: must be clean.
- **Commit**: exactly one commit for the phase, with a conventional message and the `Co-Authored-By` trailer.
- **Clean state**: `git status` afterwards shows only the 5 known untracked items (`.claude/`, `.specify/`, `docs/superpowers/`, `specs/`, `tools/license-manager-gui/main.js`).

---

## Phase A: Settings store & limits (Foundational — pure modules, not wired) — 1 commit

**Purpose**: The two blocking building blocks: the fail-closed settings store (R1, R13) and backend limits (R4, FR-018). No existing file is modified.

**Independent Test**: `cd backend && npx vitest run src/assistant/` is green; no route or UI exists yet.

- [ ] T001 Audit: read `backend/src/lib/config.js` (`resolveProductionConfigPath`), `backend/src/installer/dataDirAcl.js` (config directory ACL) and `backend/vitest.config.js`. Confirm that `backend/src/assistant/` does not exist, and record the current `git status` / HEAD.
- [ ] T002 [P] Write failing tests in `backend/src/assistant/settingsStore.test.js`, using a temporary directory through a `STUDIX_ASSISTANT_SETTINGS_PATH` override. The tests cover:
  - (a) a missing file → `isEnabled()` false, public `configured:false`;
  - (b) malformed JSON, `version` ≠ `1` ("Must be `1`. Any other value means the file is treated as absent"), or an unknown `provider` → disabled;
  - (c) `credential` "Trimmed, 1–512 characters": empty or 513 characters are rejected;
  - (d) enabling is rejected unless the credential is configured **and** `disclosure.version === CURRENT_DISCLOSURE_VERSION`;
  - (e) `clearCredential` forces `enabled:false`;
  - (f) `toPublic()` returns exactly `{ enabled, configured, provider, model, disclosure:{version, acknowledgedBy, acknowledgedAt, currentVersion}, lastError }`, and a sentinel credential `sk-TEST-SENTINEL-0000` is absent from `JSON.stringify(toPublic())`, with no hint or length field;
  - (g) writes are atomic (a temporary file plus rename leaves no partial file on a simulated failure);
  - (h) the cache is invalidated on write, so `isEnabled()` flips without re-import;
  - (i) a missing settings **directory** → reads report disabled and writes throw a typed `SettingsStorageUnavailable` without creating the directory;
  - (j) `setLastError({category:'auth'|'quota'})` / `clearLastError()`.
- [ ] T003 [P] Write failing tests in `backend/src/assistant/limits.test.js` for every FR-018 rule:
  - bodies > 32 KB (`32 * 1024` bytes, checked via `Content-Length` header or the serialized body) → `REQUEST_TOO_LARGE`;
  - a non-array/empty `messages`, a role other than `user`/`assistant`, or a last message not `user` → `INVALID_REQUEST`;
  - any message > 2,000 characters after trim → `MESSAGE_TOO_LONG` (never cut); an empty message → `INVALID_REQUEST`;
  - keep the latest 10 messages;
  - drop the oldest until the total is ≤ 12,000 characters, never dropping the latest user message;
  - drop a leading `assistant` message after trimming;
  - `page` kept only if it is in the allowlist copied from `src/constants/routes.js` values, else dropped;
  - `capReply(text, stopReason)` cuts to 8,000 characters and sets `truncated` when cut or when `stopReason==='length'`;
  - the exported constants `MAX_BODY_BYTES=32768`, `MAX_MESSAGE_CHARS=2000`, `MAX_TURNS=10`, `MAX_HISTORY_CHARS=12000`, `MAX_OUTPUT_TOKENS=1024`, `MAX_REPLY_CHARS=8000`, `PROVIDER_TIMEOUT_MS=20000`.
- [ ] T004 Implement `backend/src/assistant/settingsStore.js`:
  - the default path is `path.join(path.dirname(resolveProductionConfigPath()), 'assistant.json')`, overridable with `STUDIX_ASSISTANT_SETTINGS_PATH`;
  - fail-closed reads, a validated write API, an atomic write (temporary file in the same directory, then `fs.renameSync`), an in-process cache invalidated on write, `toPublic()`, `isEnabled()`, `getCredentialForAdapter()` (backend-internal only), and `setLastError`/`clearLastError`;
  - no directory creation.

  Make T002 pass.
- [ ] T005 Implement `backend/src/assistant/limits.js` (the constants, `checkSize(req)`, `validateAndTrim(body)` returning `{messages, page}` or a typed limit error, and `capReply(text, stopReason)`), with the page allowlist as a frozen array matching `src/constants/routes.js`. Make T003 pass.
- [ ] T006 Review, checks, `git diff --check`, **commit Phase A** (`feat(assistant): add fail-closed settings store and request limits`), clean `git status`.

**Checkpoint**: The foundation modules exist, are fully tested, and are unused.

---

## Phase B: Assistant status & admin settings API (US3 backend) — 1 commit

**Goal**: The backend is the source of truth for opt-in. Only an admin can enable after the disclosure is acknowledged, the key is write-only, and activity is logged without secrets.

**Independent Test**: The route tests pass. Scenarios 1–5 of [quickstart.md](./quickstart.md) can be exercised with direct HTTP (no UI yet).

- [ ] T007 [US3] Audit: read `backend/src/server.js` (mount order, the global `requireActivation`, where `/api/backup-status` is mounted), `backend/src/middleware/auth.js` (`requireAuth`, `requireRole`), `backend/src/routes/license.js` (the `resolveActivityLogActor` + `prisma.activity_logs.create` pattern), `backend/src/routes/activityLogs.js`, and `backend/src/routes/backupStatus.test.js` (the admin-route test pattern to copy).
- [ ] T008 [P] [US3] Write failing tests in `backend/src/assistant/disclosure.test.js`:
  - `CURRENT_DISCLOSURE_VERSION` is a positive integer;
  - `DISCLOSURE_TEXT_AR` is non-empty and mentions: questions and recent turns are sent to an external AI provider; the page name is sent; the provider's terms apply; Studix sends no center data.
- [ ] T009 [P] [US3] Write failing route tests in `backend/src/routes/assistant.settings.test.js`, following the `backupStatus.test.js` pattern:
  - `GET /api/assistant/status` → 401 without a session; `{enabled:false}` by default; `{enabled:true}` only when enabled; **no other fields**;
  - `GET/PUT /api/assistant/settings` → 403 for a non-admin session; 200 for an admin with the public shape from [contracts](./contracts/assistant-api.md);
  - PUT `enabled:true` without a key or acknowledgment → `400 ASSISTANT_DISCLOSURE_REQUIRED`;
  - PUT with `acknowledgeDisclosureVersion` ≠ current → 400;
  - PUT with an unknown provider → `400 ASSISTANT_INVALID_REQUEST`, and the error body does not echo any submitted value;
  - `clearCredential` → disabled;
  - disabling takes effect on the next status call without a restart;
  - each effective change writes exactly one `activity_logs` row with `module:'assistant'`, `entity_type:'assistant_settings'` and action `assistant_enabled|assistant_disabled|assistant_credential_set|assistant_credential_cleared|assistant_disclosure_acknowledged`;
  - **the sentinel key `sk-TEST-SENTINEL-0000` is absent from every response body, error body and `activity_logs.details`**;
  - an unactivated installation → 402 (global gate).
- [ ] T010 [US3] Implement `backend/src/assistant/disclosure.js` (the Arabic disclosure text and version constant). Make T008 pass.
- [ ] T011 [US3] Implement `backend/src/routes/assistant.js` with **only**:
  - `GET /status` (any authenticated user);
  - `GET /settings` and `PUT /settings` (each with `requireRole('admin')`);
  - `POST /settings/test` **stub** returning `503 ASSISTANT_NOT_CONFIGURED` (the real test comes in Phase D).

  It uses `settingsStore` and `toPublic()` as the only serializer, and writes activity-log rows via `resolveActivityLogActor(req.user.id)` + `prisma.activity_logs.create` with `details` limited to `{provider, model, disclosureVersion}`. `SettingsStorageUnavailable` maps to `503` with a fixed text.
- [ ] T012 [US3] Mount it in `backend/src/server.js` with a single line, `app.use('/api/assistant', requireAuth, assistantRouter)`, placed with the other protected `/api/*` routes (after the global `requireActivation`, before the generic CRUD loop and `notFound`). Make T009 pass.
- [ ] T013 [US3] Review, checks, `git diff --check`, **commit Phase B** (`feat(assistant): add admin opt-in settings and status API`), clean `git status`.

**Checkpoint**: An admin can configure and enable the assistant over HTTP; nothing can chat yet.

---

## Phase C: Provider interface, error table & prompt (Foundational) — 1 commit

**Purpose**: Provider-independent seams (FR-027/028), fixed safe errors (FR-029/030) and the deterministic knowledge-base prompt (R3).

**Independent Test**: `cd backend && npx vitest run src/assistant/` is green; no route change.

- [ ] T014 Audit: read `scripts/build-windows-runtime.ps1` (`Copy-ExcludingTests` ships `.md` files), `src/constants/nav.js` (labels), `docs/PRODUCTION-RUNBOOK.md` §11 and §14 (backup facts, error table), and collect the exact Arabic error strings from `backend/src/middleware/auth.js`, `backend/src/middleware/permissions.js` and `backend/src/middleware/activation.js` for the seed error catalog.
- [ ] T015 [P] Write failing tests in `backend/src/assistant/providers/providers.test.js`:
  - `ProviderError` accepts only `kind ∈ {timeout, unavailable, auth, quota, rate_limited, bad_response}`, and anything else normalizes to `unavailable`;
  - `fakeProvider` records the exact `{system, messages, maxOutputTokens}` it received, returns scripted `{text, stopReason, usage}`, and can be scripted to throw each kind;
  - the registry `getAdapter(id)` returns `fake` only when `NODE_ENV==='test'` and never in production;
  - the adapter signature has **no `tools` parameter** (V1 scope guard).
- [ ] T016 [P] Write failing tests in `backend/src/assistant/errors.test.js`:
  - every normalized kind and every limit or config code maps to exactly one `{status, code, message}` per the table in [contracts](./contracts/assistant-api.md);
  - every `message` is a fixed Arabic string containing no `http`, `/`, `\\`, `Error`, `at ` (stack) or `{`;
  - `toHttp(errOrKind)` never reads `err.message`.
- [ ] T017 [P] Write failing tests in `backend/src/assistant/prompt.test.js`:
  - `buildSystemPrompt()` returns byte-identical output on repeated calls (no timestamps);
  - `KB_VERSION` is a stable hash that changes when a knowledge file changes;
  - each knowledge file header has `id`, `title`, `pages` (valid route ids), `audience ∈ {all, admin}`, `reviewed` (allowed to be `pending` in seed files only) and `aliases`;
  - the prompt size stays under a documented budget;
  - an **owner-only marker guard** fails if any knowledge file contains `PRIVATE KEY`, `license-issuer`, `license-keygen`, `support-signer`, `support-keygen`, `admin.env`, `DATABASE_URL`, `SESSION_SECRET` or `STUDIX_LICENSE`;
  - the system prompt contains instructions to reply in the user's language style, stay within Studix help, decline data, action and secret requests, and never invent steps.
- [ ] T018 [P] Write a failing static-import guard in `backend/src/assistant/imports.test.js`:
  - no file under `backend/src/assistant/` imports `@prisma/client` or `../prisma.js`;
  - no file outside `backend/src/assistant/providers/*Provider.js` imports any provider SDK package.
- [ ] T019 Implement `backend/src/assistant/providers/providerError.js`, `backend/src/assistant/providers/fakeProvider.js` and `backend/src/assistant/providers/index.js`. Make T015 pass.
- [ ] T020 [P] Implement `backend/src/assistant/errors.js` (the single constant table plus `toHttp`). Make T016 pass.
- [ ] T021 [P] [US1] Create the seed knowledge in professional Arabic with Egyptian-friendly phrasing and aliases, each file with `reviewed: pending`:
  - `backend/src/assistant/knowledge/students-add.md` (the "إدارة الطلاب" add-student flow);
  - `backend/src/assistant/knowledge/payments-record-refund.md` (record a payment; payments are corrected by **refund**, never edited or deleted);
  - `backend/src/assistant/knowledge/backup-restore.md` (a daily verified backup at 03:00 or after the next boot; restore and manual backup are administrator procedures; copy backups off the machine).
- [ ] T022 [P] [US2] Create the seed error catalog `backend/src/assistant/knowledge/errors.md` with the four error strings used by evaluation items H37–H40, each with `meaning`, `nextStep` and `needsAdmin`.
- [ ] T023 Implement `backend/src/assistant/prompt.js` (a deterministic loader with a stable file order, header parsing, the system instructions and `KB_VERSION`). Make T017 and T018 pass.
- [ ] T024 Review, checks, `git diff --check`, **commit Phase C** (`feat(assistant): add provider interface, safe error table and knowledge prompt`), clean `git status`.

**Checkpoint**: Every provider-independent building block exists and is tested.

---

## Phase D: Chat endpoint, egress guard & failure isolation (US1/US2/US4 backend) — 1 commit

**Goal**: `POST /api/assistant/chat` behaves exactly per the contract with the fake provider. It enforces limits, masking and the egress boundary, and isolates provider failures.

**Independent Test**: The chat route tests pass. Quickstart scenarios 1, 6, 11 and 12 can be run over direct HTTP with the fake provider.

- [ ] T025 Audit: re-read `backend/src/middleware/rateLimit.js` (the existing `express-rate-limit` v8 usage and IPv6-safe key helpers), `backend/src/lib/logger.js` (redaction behavior) and Phase B's `backend/src/routes/assistant.js`.
- [ ] T026 [P] [US4] Write failing tests in `backend/src/assistant/redact.test.js`. The following are masked to `[رقم محجوب]`:
  - Egyptian mobiles `01[0125]` + 8 digits, including with spaces/dashes, Arabic-Indic digits (`٠١٠…`), `+20…` and `0020…`;
  - 14-digit national IDs.

  Ordinary numbers are untouched (`18`, `2026`, `500 جنيه`).
- [ ] T027 [P] [US1] Write failing route tests in `backend/src/routes/assistant.chat.test.js` (fake provider) for the happy path and access:
  - 401 no session; 402 unactivated; `403 ASSISTANT_DISABLED` when disabled or with an outdated disclosure;
  - 200 returns `{reply, truncated, kbVersion}`;
  - `truncated:true` when the fake returns `stopReason:'length'` or more than 8,000 characters;
  - a follow-up turn is forwarded with the prior turns.
- [ ] T028 [P] [US4] Write failing limit tests (UI bypassed, SC-010) in `backend/src/routes/assistant.chat.limits.test.js`:
  - a 40 KB body → `413 ASSISTANT_REQUEST_TOO_LARGE`;
  - a 2,500-character message → `400 ASSISTANT_MESSAGE_TOO_LONG`;
  - 30 messages → 200, and the fake received only the latest 10 within 12,000 characters, with the latest question intact;
  - `role:'system'` → 400;
  - more than 20 requests per 5 minutes per user → `429 ASSISTANT_RATE_LIMITED` with **no provider call recorded**;
  - a concurrent second request by the same user → `429 ASSISTANT_BUSY`.
- [ ] T029 [P] [US4] Write failing failure-isolation tests (SC-009) in `backend/src/routes/assistant.chat.failures.test.js`, with the fake scripted to throw each kind:
  - `timeout` → 504 `ASSISTANT_TIMEOUT`;
  - `unavailable` → 503 `ASSISTANT_UNAVAILABLE`, retried **once** only when budget remains;
  - `auth` → 503 `ASSISTANT_NOT_CONFIGURED` + admin `lastError.category:'auth'`;
  - `quota` → 503 `ASSISTANT_NOT_CONFIGURED` + `lastError.category:'quota'`;
  - `rate_limited` → 429 `ASSISTANT_PROVIDER_BUSY`;
  - `bad_response` → 502 `ASSISTANT_BAD_RESPONSE`;
  - an unexpected internal throw → 503 `ASSISTANT_UNAVAILABLE`;
  - a success clears `lastError`.

  In each case the raw thrown message, which embeds `sk-TEST-SENTINEL-0000`, `C:\\ProgramData\\Studix\\config`, `at Object.<anonymous>` and `https://api.example.invalid`, is **absent** from the response body **and** from every log line captured during the test. No other Studix route's response changes while the assistant fails.
- [ ] T030 [P] [US1] Write a failing **egress guard** test (SC-005) in `backend/src/routes/assistant.chat.egress.test.js`:
  - run a scripted multi-turn conversation as a real test user whose name, id and permissions are known;
  - inspect the recording fake's full payload;
  - assert that it contains only the system prompt, the kept masked turns, the allowlisted page id and a language hint;
  - assert the **absence** of: the session cookie value, `SESSION_SECRET`, `DATABASE_URL`, the admin/test user id, name, role and permissions, any license id, installation id or machine id, any filesystem path, typed phone numbers (masked) and any row data from seeded students or payments;
  - a non-allowlisted `page` value never appears.
- [ ] T031 [P] [US1] Write a failing logging test in `backend/src/routes/assistant.chat.logging.test.js`:
  - exactly one `assistant_chat` log line per request, with `{outcome, code, durationMs, inputChars, usage, kbVersion, page}`;
  - **no question or answer text, no user id or name, no key**;
  - no `activity_logs` row is written for chat requests.
- [ ] T032 [US4] Implement `backend/src/assistant/redact.js`. Make T026 pass.
- [ ] T033 [US4] Add `assistantUserLimiter` (20 per 5 minutes, keyed by `req.user.id`) and `assistantIpLimiter` (60 per 5 minutes, IPv6-safe IP key) to `backend/src/middleware/rateLimit.js`. The 429 body must be `{ok:false, error:<fixed text>, code:'ASSISTANT_RATE_LIMITED'}`.
- [ ] T034 [US1] Implement `backend/src/assistant/assistantService.js`:
  - an enabled check (fail closed), `limits.checkSize`/`validateAndTrim`, and an in-flight guard (an in-memory `Set` of user ids, released in `finally`);
  - `redact` applied to the kept turns;
  - `prompt.buildSystemPrompt()`;
  - `adapter.generateReply({system, messages, maxOutputTokens: MAX_OUTPUT_TOKENS, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)})`, with at most one retry for `unavailable` within the remaining budget;
  - `limits.capReply`, `settingsStore.setLastError`/`clearLastError`, and error mapping only via `errors.toHttp`;
  - the metadata-only `logger.info('assistant_chat', …)` / `logger.warn('assistant_provider_failure', {kind, httpStatus})`.
- [ ] T035 [US1] Add `POST /chat` to `backend/src/routes/assistant.js`, in order: `assistantIpLimiter` → `assistantUserLimiter` → service. Replace the Phase B `POST /settings/test` stub with a real call that sends one fixed, non-customer prompt through the service's adapter path (same limiters, same error mapping, updates or clears `lastError`). Make T027–T031 pass.
- [ ] T036 Review, checks, `git diff --check`, **commit Phase D** (`feat(assistant): add help chat endpoint with limits, egress guard and failure isolation`), clean `git status`.

**Checkpoint**: The V1 backend is complete, running against the fake provider.

---

## Phase E: Frontend: panel, entry point & admin settings (US1/US3/US4 UI) — 1 commit

**Goal**: The assistant UI mirrors backend state. Replies render inertly, and admins opt in through the disclosure.

**Independent Test**: The frontend tests pass. Quickstart scenarios 1, 4, 5, 6 and 7 pass in the browser with the backend's fake provider enabled for dev.

- [ ] T037 Audit: read `src/layouts/AppLayout.jsx`, `src/layouts/Topbar.jsx`, `src/services/api.js` (the `credentials:'include'` and `{ok,data,error}` conventions), `src/components/ui/Modal.jsx`, `src/components/Toast.jsx`, `src/hooks/useErrorHandler.js`, `src/modules/settings/SettingsPage.jsx` (the `isAdmin` section pattern, e.g. `DatabaseBackupSection`) and one existing component test using Testing Library.
- [ ] T038 [P] [US1] Write failing tests in `src/services/api.assistant.test.js` for `pgAssistantStatus`, `pgAssistantChat`, `pgGetAssistantSettings`, `pgUpdateAssistantSettings` and `pgTestAssistantConnection`:
  - correct method, URL and `credentials:'include'`;
  - errors surface the backend's fixed `error` text plus `code`;
  - `pgUpdateAssistantSettings` never logs its argument.
- [ ] T039 [P] [US1] Write failing tests in `src/modules/assistant/AssistantPanel.test.jsx`:
  - it sends the trimmed recent turns and the current page id;
  - it shows the reply;
  - a reply of `<script>window.__x=1</script><img src=x onerror="window.__y=1">` renders as **literal text**, with no `script`/`img` element created and no globals set (SC-007);
  - `truncated:true` shows the shortened-answer line;
  - the persistent egress notice is always visible;
  - each backend `code` shows its fixed message;
  - `403 ASSISTANT_DISABLED` calls `onDisabled()`;
  - the transcript is cleared when the panel unmounts or closes;
  - there is no `dangerouslySetInnerHTML` in the component source.
- [ ] T040 [P] [US3] Write failing tests in `src/layouts/Topbar.assistant.test.jsx`:
  - the assistant button renders only when `useAssistantStatus()` reports `enabled:true`;
  - it hides after `onDisabled()`;
  - it is absent when logged out, because the layout is not mounted.
- [ ] T041 [P] [US3] Write failing tests in `src/modules/settings/AssistantSettingsSection.test.jsx`:
  - it renders only for admins;
  - it shows the disclosure text from GET settings;
  - Enable stays disabled until the acknowledgment checkbox is ticked **and** a key is configured or entered;
  - the key input is `type="password"`, never pre-filled, and cleared after save;
  - the saved state shows only `configured`, `provider` and `model` (no key, hint or length);
  - `lastError.category` `auth`/`quota` shows the matching admin text;
  - the "test connection" button calls `pgTestAssistantConnection`.
- [ ] T042 [US1] Add the five wrappers to `src/services/api.js`. Make T038 pass.
- [ ] T043 [US3] Create `src/modules/assistant/useAssistantStatus.js`. It fetches `GET /api/assistant/status` on mount (post-login) and when the panel opens, and exposes `{enabled, refresh, markDisabled}`.
- [ ] T044 [US1] Create `src/modules/assistant/AssistantPanel.jsx`:
  - a right-to-left drawer;
  - messages rendered as React text nodes in a `white-space: pre-wrap` container;
  - the persistent notice (FR-023);
  - an input with a 2,000-character counter (a courtesy only; the backend enforces);
  - loading and error states via fixed messages;
  - the transcript held in component state only.

  Make T039 pass.
- [ ] T045 [US3] Modify `src/layouts/Topbar.jsx` (an assistant button next to notifications, shown only when `enabled`) and `src/layouts/AppLayout.jsx` (hosts `useAssistantStatus` and the drawer's open state, and passes `onOpenAssistant` to Topbar). Make T040 pass.
- [ ] T046 [US3] Create `src/modules/settings/AssistantSettingsSection.jsx` and render it in `src/modules/settings/SettingsPage.jsx` inside `{isAdmin && …}` with a `SectionBoundary`. Make T041 pass.
- [ ] T047 Review, checks (including `npm run lint`, with no *new* lint errors in the touched files), `git diff --check`, **commit Phase E** (`feat(assistant): add help assistant panel and admin opt-in settings UI`), clean `git status`.

**Checkpoint**: V1 is usable end to end with the fake provider (dev/test only), and is invisible until an admin enables it.

---

## Phase F: Real provider adapter (US1/US4) — 1 commit

**Goal**: Connect a real cloud provider behind the unchanged interface.

**Independent Test**: The adapter unit tests pass with a mocked transport. Quickstart scenarios 10 and 11 pass with a real BYOK key.

- [ ] T048 **Decision checkpoint (start of Phase F)**: the owner selects the provider and model (recorded decision: provider selection deferred to Phase F). Record the choice in `specs/005-chat-assistant-help/plan.md` → Recorded Owner Decisions, together with the provider's data-retention terms for the disclosure. If the terms require disclosure changes, bump `CURRENT_DISCLOSURE_VERSION` in `backend/src/assistant/disclosure.js` (this forces admins to re-acknowledge).
- [ ] T049 Audit: read the chosen provider's official documentation for authentication, messages, output-limit and stop reasons, and error statuses (auth, quota/billing, rate limit, 5xx), and decide between the official SDK and `fetch` (the SDK is allowed **only inside the adapter**). If an SDK is chosen, note the exact version to pin in `backend/package.json`.
- [ ] T050 [P] [US4] Write failing tests in `backend/src/assistant/providers/<provider>Provider.test.js` with a mocked transport:
  - the request carries the system text, the messages, `max output = MAX_OUTPUT_TOKENS` and the abort signal;
  - success → `{text, stopReason:'end'|'length', usage}`;
  - each provider failure maps to the right normalized kind: auth → `auth`, quota/billing → `quota`, provider rate limit → `rate_limited`, 5xx/network/DNS → `unavailable`, abort → `timeout`, empty/refused/unparseable → `bad_response`;
  - thrown `ProviderError`s never carry the provider's raw message;
  - the key is read only via `settingsStore.getCredentialForAdapter()` and never appears in an error or log.
- [ ] T051 [US4] Implement `backend/src/assistant/providers/<provider>Provider.js` and register it in `backend/src/assistant/providers/index.js`. If an SDK is used, add it to `backend/package.json` / `backend/package-lock.json`, imported only in this file. Make T050 and the Phase C import guard (T018) pass.
- [ ] T052 [US1] Manual smoke test with a real BYOK key in a scratch settings path (`STUDIX_ASSISTANT_SETTINGS_PATH`): run scenarios 10 (offline) and 11 (invalid key) of `specs/005-chat-assistant-help/quickstart.md`. Record the outcomes in the phase notes. **No key is committed.**
- [ ] T053 Review, checks, `git diff --check` (and confirm no key or sentinel appears in the diff), **commit Phase F** (`feat(assistant): add <provider> adapter behind provider interface`), clean `git status`.

**Checkpoint**: A real provider works behind the abstraction; the knowledge base is still seed-only.

---

## Phase G: Full knowledge base & evaluation release gate (US1/US2) — 1 commit

**Goal**: A complete, owner-reviewed knowledge base that passes the evaluation gate.

**Independent Test**: Automated knowledge-base guards pass, and the **owner-graded evaluation gate** in [evaluation.md](./evaluation.md) passes on the release provider and model.

- [ ] T054 [US1] Audit: walk each Studix page used by topics T01–T12 in [evaluation.md](./evaluation.md) (the running app and module sources under `src/modules/`), and list the exact on-screen labels, buttons and steps per topic.
- [ ] T055 [P] [US1] Extend `backend/src/assistant/prompt.test.js` (failing first):
  - every knowledge file must have `reviewed` set to a date (no `pending`) **except** when an explicit `ASSISTANT_KB_DRAFT` test flag is set;
  - every topic T01–T12 has at least one article whose `pages` include its route;
  - every article has non-empty `aliases`.
- [ ] T056 [P] [US1] Write the full knowledge base in `backend/src/assistant/knowledge/`, one file per topic T01–T12 (15–25 articles in total), in professional Arabic with Egyptian-friendly phrasing and common colloquial aliases, using the exact labels from T054. Owner-only material is excluded, as enforced by the marker guard.
- [ ] T057 [P] [US2] Complete `backend/src/assistant/knowledge/errors.md` with every user-facing Arabic error string from `backend/src/middleware/*.js` and the high-frequency route errors, each with `meaning`, `nextStep` and `needsAdmin`.
- [ ] T058 [US1] Pin the evaluation criteria: in `specs/005-chat-assistant-help/evaluation.md`, attach each topic T01–T12 to its article id(s), and copy the expected key steps from the reviewed articles.
- [ ] T059 [US1] **Owner review**: the owner/reviewer reviews every article in `backend/src/assistant/knowledge/*.md` and the error catalog `backend/src/assistant/knowledge/errors.md`, then sets `reviewed: <date>` in each file header. Make T055 pass.
- [ ] T060 [US1] **Release gate (owner-graded, not a unit test)**: run H01–H40 and X01–X15 from [evaluation.md](./evaluation.md) on the release provider and model, and record the date, provider, model, `kbVersion` and per-item Pass/Fail with reasons. **Gate**: Help ≥ 36/40 and 40/40 language-style match; Out-of-Scope 15/15. On failure, iterate on the knowledge base and system instructions (T056/T057/`prompt.js`) and re-run the whole gate.
- [ ] T061 Review, checks, `git diff --check`, **commit Phase G** (`feat(assistant): add reviewed Studix help knowledge base`). The commit message records the gate result and `kbVersion`. Then confirm a clean `git status`.

**Checkpoint**: V1 meets SC-002 and SC-003.

---

## Phase H: Documentation (Polish & cross-cutting) — 1 commit

**Purpose**: Constitution V: the docs describe the feature only once it is real and gated.

- [ ] T062 Audit: re-read `docs/PRODUCTION-RUNBOOK.md` (§3–§4 installer data, §10 daily operation, including "Internet has no role", §13 Mode A/B tables, §14 troubleshooting, §15 file map) and `README.md`'s current-state section.
- [ ] T063 [P] Update `docs/PRODUCTION-RUNBOOK.md`:
  - a new section on the optional cloud help assistant: off by default, admin opt-in, BYOK, what is and is never sent, and how to disable it;
  - amend the §10 "Internet" answer so it names this single opt-in exception;
  - add `config\assistant.json` to the §4 file list and to the §13 Mode A (kept) and Mode B (deleted) tables;
  - add troubleshooting rows for the assistant's user and admin messages.
- [ ] T064 [P] Update `README.md`'s current-state overview with a short, accurate description of V1 and an explicit "V2 data assistant: not implemented" label.
- [ ] T065 Run all of [quickstart.md](./quickstart.md) scenarios 1–13 and record the results. Confirm SC-006 by running the full backend and frontend suites with the assistant disabled.
- [ ] T066 Review, `git diff --check`, **commit Phase H** (`docs(assistant): document opt-in cloud help assistant`), clean `git status`.

---

## Dependencies & Execution Order

### Phase dependencies (strictly sequential commits)

- **A** → none
- **B** → A
- **C** → A
- **D** → B, C
- **E** → D
- **F** → C (starts with the provider decision T048)
- **G** → C, F (the evaluation gate needs the real provider)
- **H** → E, F, G

C may be done before B, but each is still its own commit. Phases are **never** merged.

### User story coverage

| Story | Delivered across |
|---|---|
| US1 Ask how | C (seed knowledge base), D (chat), E (panel), F (real provider), G (full knowledge base + gate) |
| US2 Explain errors | C (seed catalog), G (full catalog + H37–H40) |
| US3 Admin opt-in | B (API), E (UI) |
| US4 Safe failures | A (limits), D (limits, failure mapping, masking), E (messages), F (adapter mapping) |

### Within each phase

1. Audit task first.
2. Test tasks (Red): must fail for the right reason.
3. Implementation tasks (Green).
4. Review, checks, `git diff --check`, commit, clean status.

## Parallel Opportunities

- **Phase A**: T002 ∥ T003 (different test files), then T004 ∥ T005.
- **Phase B**: T008 ∥ T009.
- **Phase C**: T015 ∥ T016 ∥ T017 ∥ T018, then T020 ∥ T021 ∥ T022, with T019 and T023 sequential.
- **Phase D**: T026 ∥ T027 ∥ T028 ∥ T029 ∥ T030 ∥ T031 (separate test files).
- **Phase E**: T038 ∥ T039 ∥ T040 ∥ T041.
- **Phase G**: T055 ∥ T056 ∥ T057.
- **Phase H**: T063 ∥ T064.

### Parallel example: Phase D tests

```bash
Task: "Masking tests in backend/src/assistant/redact.test.js"
Task: "Chat happy-path/access tests in backend/src/routes/assistant.chat.test.js"
Task: "Direct-request limit tests in backend/src/routes/assistant.chat.limits.test.js"
Task: "Failure-isolation tests in backend/src/routes/assistant.chat.failures.test.js"
Task: "Egress guard test in backend/src/routes/assistant.chat.egress.test.js"
Task: "Metadata-only logging test in backend/src/routes/assistant.chat.logging.test.js"
```

## Implementation Strategy

- **Smallest useful increment**: A → B → C → D gives a complete, tested V1 backend against the fake provider. **E** makes it usable in the UI (still dev-only without a real provider).
- **First real release**: requires **F** (provider) and **G** (knowledge base plus the owner-graded gate), then **H** (docs).
- **Never ship partially**: the assistant stays disabled by default at every phase, so intermediate commits are safe on any installation.

## Notes

- `[P]` = different files, with no dependency on an incomplete task in the same phase.
- Every phase is one commit; **do not combine unrelated phases**.
- Never commit a real API key. Tests use the sentinel `sk-TEST-SENTINEL-0000`, which a test asserts never appears in any output.
- No V2 work: no tool registry, no `tools` parameter, no database access from `backend/src/assistant/`.
