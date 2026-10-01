# Implementation Plan: Studix Chat Assistant — V1 Help Assistant

**Branch**: `005-chat-assistant-help` (spec directory; no git branch created) | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-chat-assistant-help/spec.md`

## Summary

Add an in-app, help-only chat assistant that answers Studix "how do I…" and error-message questions in Arabic, Egyptian colloquial Arabic and English, grounded in a curated knowledge base.

- **Architecture**: `Topbar button → drawer (AppLayout) → POST /api/assistant/chat → assistant service (fixed prompt + knowledge base + validated chat turns) → provider adapter → cloud provider`.
- **Availability**: the assistant is **off by default**. An administrator enables it in Settings only after acknowledging a data-egress disclosure and supplying a credential.
- **Credential storage**: the credential lives only in `%ProgramData%\Studix\config\assistant.json` (admin-only ACL, not in PostgreSQL, therefore never in backups).
- **What V1 does not do**: no database access, no data tools, no persistence, no mutations.
- **V2 seam**: V2's read-only tool registry is documented as a future seam only ([research R11](./research.md)).

## Technical Context

**Language/Version**: JavaScript (ESM). Node.js 24.14 (bundled runtime, global `fetch`). React 18.3.

**Primary Dependencies**: Existing: Express 4, Prisma 5 (`activity_logs` only), `express-rate-limit` 8 (already installed), React Router 6, Vitest 2 plus Testing Library. **New**: at most one: the chosen provider's official SDK, imported only inside its adapter. Zero if the owner prefers plain `fetch` ([research R2](./research.md)).

**Storage**: A new settings file, `%ProgramData%\Studix\config\assistant.json`. New `activity_logs` rows (`module='assistant'`). **No new tables, columns or migrations.** Chats are not stored.

**Testing**: Vitest (backend `backend/vitest.config.js`, frontend root config), Testing Library. A recording `fakeProvider`, so tests make no network calls.

**Target Platform**: The Windows 10/11 single-machine installation (backend bound to 127.0.0.1:4000, served UI).

**Project Type**: Web application: `backend/` (Express API) plus `src/` (React SPA served by the backend).

**Performance Goals**: An answer or a clear failure within 20 s for ≥ 95% of questions (SC-004). No measurable impact on other endpoints.

**Constraints**:
- Offline-first: the assistant is additive and its failures are isolated.
- Data egress is limited to FR-021/FR-022.
- The API key never leaves the backend (FR-025).
- **Backend-enforced limits (FR-018)**:
  - request ≤ 32 KB (413);
  - message ≤ 2,000 characters (400, never cut);
  - the latest 10 messages and ≤ 12,000 characters are forwarded (oldest dropped first);
  - output ≤ 1,024 tokens and ≤ 8,000 characters (`truncated`);
  - 20 requests per 5 minutes per user and 60 per 5 minutes per IP;
  - 1 request in flight per user;
  - 20 s provider budget, including at most one retry for `unavailable`.

**Scale/Scope**: One tutoring center per installation (a handful of concurrent staff). Knowledge base of about 15–25 articles plus the error catalog.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Assessment | Status |
|---|---|---|
| **I. Fail-Closed Security** | Missing, malformed, unknown-version or credential-less settings resolve to *disabled*. Chat re-reads the enabled state on every request. Settings are admin-only (`requireRole('admin')`), and the credential is write-only. No signing keys are involved. | ✅ Pass |
| **II. Offline-First** | The only network-dependent feature is additive and **off by default**. Every failure maps to a clear message, and no core flow depends on it (FR-019, SC-006). The runbook's "Internet has no role" statement is updated to describe this opt-in exception. | ✅ Pass |
| **III. Deterministic DB Provisioning** | No schema change, no migration. The settings live in the config directory the installer already provisions and ACL-protects. | ✅ Pass |
| **IV. Test-First (security/money paths)** | Access control, the admin-only settings, the egress guard and the XSS-inert rendering are written test-first. Failure paths (401/402/403/400/429/5xx) are covered. No money paths are touched. | ✅ Pass |
| **V. Docs reflect reality** | The runbook (and README "current state") are updated **in the same change** that makes the feature usable. Until then nothing documents it as available. | ✅ Pass |
| **VI. Simplicity & YAGNI** | No retrieval or vector store, no Markdown renderer, no DPAPI, no DB table. It reuses `express-rate-limit`, `logger`, `activity_logs`, `requireAuth`/`requireRole` and `lib/config.js` path logic. The one abstraction (provider adapter) is justified below. | ✅ Pass (justified) |
| Tech constraints | Frontend React/Vite, backend Node/Express: matches. *(Note: the constitution lists Zustand/Tailwind. The code actually uses React context and inline styles/CSS. This plan follows the actual code and does not amend the constitution.)* Owner-only tools are not bundled (the knowledge-base guard enforces this). | ✅ Pass |

**Post-design re-check (after Phase 1)**: unchanged. All pass; there are no new violations.

## Project Structure

### Documentation (this feature)

```text
specs/005-chat-assistant-help/
├── spec.md              # Feature specification (V1 scope, egress rules)
├── plan.md              # This file
├── research.md          # Phase 0 decisions R1–R12
├── data-model.md        # Settings file, transient chat shapes, KB, activity log
├── quickstart.md        # Validation scenarios
├── evaluation.md        # 40 Help + 15 Out-of-Scope items with criteria (release gate)
├── contracts/
│   └── assistant-api.md # /api/assistant/{status,chat,settings,settings/test}
├── checklists/
│   └── requirements.md  # Spec quality checklist (passed)
└── tasks.md             # NOT created yet — produced by /speckit-tasks after plan approval
```

### Source Code (repository root)

```text
backend/src/
├── assistant/                          # NEW — all V1 assistant logic
│   ├── settingsStore.js                # R1/R13: read/validate/atomic-write assistant.json, toPublic(), cache
│   ├── limits.js                       # R4/R7: limit constants, validation, oldest-first trimming, reply cap
│   ├── disclosure.js                   # FR-020: versioned Arabic data-egress disclosure text (CURRENT_DISCLOSURE_VERSION)
│   ├── errors.js                       # R8: normalized provider kinds → {status, code, fixed Arabic text}
│   ├── redact.js                       # R14: best-effort phone / national-ID masking
│   ├── prompt.js                       # R3: deterministic system text from knowledge/, KB_VERSION
│   ├── assistantService.js             # orchestrates: validate → prompt → adapter → map errors
│   ├── providers/
│   │   ├── index.js                    # adapter registry: { fake, <chosen provider> }
│   │   ├── fakeProvider.js             # deterministic + recording (tests only)
│   │   └── <provider>Provider.js       # Phase F, after provider decision
│   └── knowledge/                      # curated .md articles + errors.md (shipped automatically)
├── routes/assistant.js                 # NEW — status, chat, settings, settings/test
├── middleware/rateLimit.js             # MODIFIED — add assistantUserLimiter / assistantIpLimiter
└── server.js                           # MODIFIED — one mount line

src/
├── modules/assistant/AssistantPanel.jsx        # NEW — drawer UI, plain-text rendering, egress notice
├── modules/settings/AssistantSettingsSection.jsx  # NEW — admin enable/credential/disclosure
├── modules/settings/SettingsPage.jsx           # MODIFIED — render section when isAdmin
├── layouts/Topbar.jsx                          # MODIFIED — assistant button (when status.enabled)
├── layouts/AppLayout.jsx                       # MODIFIED — host the drawer
└── services/api.js                             # MODIFIED — pgAssistantStatus / pgAssistantChat / settings wrappers

docs/PRODUCTION-RUNBOOK.md, README.md           # MODIFIED at release phase (Principle V)
```

**Structure Decision**: This is the existing web-application layout (`backend/` plus `src/`). All new backend logic is isolated under `backend/src/assistant/`, so V2 can add `assistant/tools/` beside it without touching V1 files. Tests sit next to their sources (`*.test.js` / `*.test.jsx`), matching the repository's convention.

## Architecture & Data Flow (V1)

1. **Status check**: the UI calls `GET /api/assistant/status` after login and when Settings changes. The button renders only if `enabled`.
2. **Sending a question**: the user types a question, and the panel sends `{messages (≤10 turns), page}` to `POST /api/assistant/chat`.
3. **Backend pipeline**:
   1. `requireActivation` (global)
   2. `requireAuth`
   3. IP and user limiters
   4. `settingsStore.isEnabled()` (fail closed)
   5. in-flight guard
   6. `limits.validate()`
   7. `prompt.build()` (static, cached; KB plus error catalog)
   8. `adapter.generateReply({system, messages, maxOutputTokens, signal: timeout(20s)})`
   9. map to `{reply}` or a coded error
   10. log metadata only
4. **Response**: the UI appends the reply as a text node. The transcript lives only in component state.

**Authorization boundary**: The assistant sees **only** static help text and the user's own typed turns. It has no handle to Prisma, no configuration secrets and no request identity. The `assistant/` modules (other than `settingsStore.js`) do not import `prisma`, and a test enforces this.

**V2 seam (not built)**: see [research R11](./research.md). In V2, the adapter gains an optional `tools` parameter and `assistant/tools/` hosts permission-checked, read-only tools over existing scoped services. V1 code must not add any of it.

## Security & Privacy Model (summary)

| Concern | Control |
|---|---|
| API key exposure (FR-025) | Stored only in the admin-ACL config file, and only the backend reads it. Write-only through the API. `toPublic()` (the only response serializer) has no key, hint or length. Never logged, never in `activity_logs`, never in error text, never in `pg_dump` or the in-app export (not in the DB). Wiped by Mode B. A sentinel-key test covers every artifact. |
| Unauthorized use | Global activation gate, `requireAuth`, admin-only settings, enabled flag re-checked per request. The interface only mirrors backend state. |
| Data egress (FR-021/022) | A server-built payload with only the fixed help text, the kept and masked user turns, the allowlisted page id, and a language hint. No DB reads. `assistant/` has no Prisma imports (enforced by test). A recording-fake egress test covers the payload. Best-effort phone/ID masking. A persistent UI notice. The admin disclosure is versioned, acknowledged and audited. |
| Provider failures (FR-029/030) | The adapter normalizes to six kinds. Fixed Arabic texts come from one table. Raw provider text is never returned or logged. At most one retry for `unavailable` only. Admin `lastError` holds a category only. |
| Limits (FR-018) | All limits live in `limits.js` and are enforced on the server. Direct-request tests bypass the UI (SC-010). |
| Injection / XSS | Replies are rendered as React text nodes only, with no HTML path. A test covers script and `onerror` payloads. |
| Prompt injection | There is nothing to exfiltrate in V1 (no data, no secrets, no tools). The system prompt instructs the model to decline data or action requests. It's evaluated with SC-003's prompt set. |
| Abuse / cost | Per-user and per-IP rate limits, one request in flight per user, input size caps, output token cap, 20 s timeout. |
| Availability | Every assistant failure is contained in its route and panel, and other routes are unaffected (the regression suite runs with the assistant failing). |

## Implementation Phases (small, independently testable commits)

Each phase is **exactly one independent commit** and is completed as:

**Audit → Implement → Tests → Review → `git diff --check` → independent Git commit → clean `git status` → next phase.**

Tests are written first (Red → Green). Unrelated phases are never combined. Every phase leaves the app shippable, with the assistant invisible until Phase E.

| Phase | Commit scope | Tests (written first) | Depends on |
|---|---|---|---|
| **A** | `assistant/settingsStore.js` + `assistant/limits.js` (pure modules, not wired) | Default disabled; malformed/unknown-version → disabled; atomic write; `toPublic()` exposes no key/hint/length; enable requires key + current disclosure; cache invalidation. Limits: every FR-018 rule, including oldest-first trimming, latest message kept, 400 over 2,000 characters, reply cap and `truncated` | — |
| **B** | `routes/assistant.js` with **status + settings (+test)** only; `server.js` mount; activity-log writes | 401/402; 403 for non-admin on settings; settings round-trip; key write-only; disclosure gate; activity rows without key or chat content; sentinel-key absence in every response and error body | A |
| **C** | `providers/` interface + `ProviderError{kind}` + `fakeProvider`; `errors.js`; `prompt.js` + seed knowledge (3–4 articles + a few error entries) | Prompt determinism; owner-only marker guard; size budget; `errors.js` maps all six kinds to exactly one code/text; no Prisma and no provider-SDK import outside allowed files | A |
| **D** | `POST /chat` + `assistantService.js` + `redact.js` + limiters in `rateLimit.js` | Full chat contract table with the fake provider in every failure mode; single retry only for `unavailable` within budget; raw provider text/stack/path/secret never in responses or logs (SC-009); **egress guard** (recording fake asserts no FR-022 category, SC-005); masking; direct-request limit tests (SC-010); metadata-only logging | B, C |
| **E** | Frontend: `api.js` wrappers, `AssistantPanel`, Topbar button, AppLayout drawer, `AssistantSettingsSection` in Settings | Entry point only when backend says enabled; hidden on 403 `ASSISTANT_DISABLED`; send/receive; persistent egress notice; XSS-inert rendering; `truncated` notice; transcript cleared on close/logout; disclosure acknowledgment before enable; key input write-only (never pre-filled, never re-displayed) | D |
| **F** | Real provider adapter (**provider chosen at the start of this phase**); an official SDK may be added **only inside the adapter** | Adapter unit tests with a mocked transport: each provider failure → the correct normalized kind; SDK import confined to the adapter; then manual quickstart 10–11 | C |
| **G** | Full knowledge base (15–25 articles, professional Arabic, Egyptian-friendly with aliases) + complete error catalog; pin evaluation criteria to article ids; **run the evaluation gate** | Automated: marker guard, `reviewed` present, valid `pages`, aliases present. **Release gate (owner-graded, not a unit test)**: [evaluation.md](./evaluation.md) Help ≥ 36/40 with 40/40 language match, Out-of-Scope 15/15 | C, F |
| **H** | Docs: `PRODUCTION-RUNBOOK.md` (opt-in cloud assistant, data egress, BYOK, `config\assistant.json` in the Mode A/B tables, the offline statement) + README current-state section | `git diff --check`; manual review | E, F, G |

**Release gate for V1**: all automated suites green; quickstart scenarios 1–13 pass; the evaluation gate recorded as passed by the owner/reviewer. Only then does Phase H document the feature as available (Principle V).

## Files Expected to Change in the First Implementation Phase (Phase A)

| File | Change |
|---|---|
| `backend/src/assistant/settingsStore.js` | **New** |
| `backend/src/assistant/settingsStore.test.js` | **New** (written first) |
| `backend/src/assistant/limits.js` | **New** |
| `backend/src/assistant/limits.test.js` | **New** (written first) |

Phase A touches **no existing file**. `server.js` is first modified in Phase B (a single mount line).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Provider adapter interface (one real adapter + one fake) | Explicit product decision (FR-027). Also the only way to test the chat route, egress guard and error mapping without network access. | A direct provider call in the route would be untestable offline, and would hard-wire one vendor into user-facing code. |
| Separate settings file instead of reusing `config\.env` | A hot enable/disable is required (FR-005), and the credential must stay out of DB backups (FR-024). | `.env` is loaded once at startup and owned by `firstInstall.js`; a DB table ends up in `pg_dump` backups and needs a migration. |

## Recorded Owner Decisions (2026-09-27)

1. **Provider selection is deferred until Phase F.** Phases A–E are provider-independent.
2. **BYOK**: each center's administrator supplies its own provider API key.
3. **Audience**: once enabled, all authenticated users may use the V1 assistant. **No new assistant permission** in V1.
4. **Knowledge base style**: professional/formal Arabic with Egyptian-friendly phrasing and common colloquial aliases.
5. **Review**: the owner/reviewer reviews the knowledge base before release (Phase G exit).
6. **SDK**: an official provider SDK may be used in Phase F if appropriate, **only inside the provider adapter**. The core architecture stays provider-independent (FR-027/028).

## Remaining Open Items

- **Provider and model** to be chosen at the start of Phase F (by decision 1). Nothing earlier depends on it.
