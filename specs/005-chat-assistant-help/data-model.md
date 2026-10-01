# Data Model: Studix Chat Assistant — V1 Help Assistant

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

V1 adds **no PostgreSQL tables or columns** and **no migrations**. The only new persisted artifacts are the settings file (R1) and new `activity_logs` rows, which use the existing table with `module = 'assistant'`.

## 1. AssistantSettings — `%ProgramData%\Studix\config\assistant.json`

| Field | Type | Rules |
|---|---|---|
| `version` | integer | Must be `1`. Any other value means the file is treated as absent, so the assistant is **disabled**. |
| `enabled` | boolean | Default `false`. Can only be `true` if `credential` is non-empty **and** `disclosure.version === CURRENT_DISCLOSURE_VERSION`. |
| `provider` | string \| null | Must be one of the adapter ids compiled into this release; unknown means disabled. |
| `model` | string \| null | Optional provider model id; the adapter default is used when null. |
| `credential` | string \| null | The provider API key (BYOK). **Backend-only**: never returned by any endpoint, never logged, never written to `activity_logs`, never in an error message. Trimmed, 1–512 characters. No hint, prefix, suffix or length of it is stored separately or exposed. |
| `disclosure.version` | integer \| null | The disclosure text version the admin acknowledged. |
| `disclosure.acknowledgedBy` | string \| null | Id of the admin user who acknowledged. |
| `disclosure.acknowledgedAt` | ISO string \| null | When they acknowledged. |
| `lastError` | `{category: 'auth'\|'quota', at}` \| null | The last provider configuration failure category (R8). No provider message is ever stored. Cleared by the next success. |
| `updatedBy` / `updatedAt` | string / ISO string | Who last changed the setting, and when. |

**Public projection** (`toPublic()`, the **only** serializer used by any response): `{ enabled, configured: boolean, provider, model, disclosure: {version, acknowledgedBy, acknowledgedAt, currentVersion}, lastError: {category, at} | null }`.

**Non-admin status projection** (`GET /status`): `{ enabled }` only.

### State transitions

```
            set credential                        acknowledge disclosure + enable
[Unconfigured] ─────────────▶ [Configured, disabled] ─────────────────────────────▶ [Enabled]
      ▲                              ▲    │                                             │
      │   clear credential           │    └──────────── disable ◀───────────────────────┘
      └──────────────────────────────┴── (clearing the credential from Enabled also disables)

Disclosure text changes (CURRENT_DISCLOSURE_VERSION++) → Enabled is treated as disabled until an admin re-acknowledges.
Missing / unreadable / malformed file → Unconfigured (fail closed).
```

- **Fresh install**: no file, so Unconfigured (FR-001).
- **Upgrade**: the file is untouched, so an admin's previous choice persists. An upgrade never turns the assistant on by itself.
- **Uninstall Mode A**: the file is kept.
- **Uninstall Mode B**: the file is deleted with `config\`.

## 2. ChatRequest (transient, request body)

| Field | Type | Rules (all enforced by the backend, research R4) |
|---|---|---|
| (whole body) | JSON | ≤ 32 KB, otherwise `413`. |
| `messages` | array of `{role, text}` | Non-empty. `role` is `user` or `assistant`; any other role gives `400`. The last item must be `user`. Each `text` is 1–2,000 characters after trim; longer gives `400` (never silently cut). The server then keeps the **most recent 10** messages and drops the oldest until the total is **≤ 12,000 characters**; the latest user message is always kept. |
| `page` | string (optional) | Kept only if it is in the server-side route-id allowlist (R5); otherwise dropped silently. Non-sensitive context only. |

Never persisted. User-typed text is masked for phone and ID patterns (R14) before it reaches the provider.

## 3. ChatReply (transient, response body)

`{ ok: true, data: { reply: string, truncated: boolean, kbVersion: string } }`.

- `reply` is plain text, produced from at most 1,024 output tokens and cut to at most 8,000 characters.
- `truncated` is `true` if either cap applied.
- The reply is never persisted by the server.

## 4. KnowledgeArticle — `backend/src/assistant/knowledge/*.md`

| Field (header block) | Rules |
|---|---|
| `id` | Unique slug. |
| `title` | Arabic title. |
| `pages` | Zero or more route ids from `src/constants/routes.js`. |
| `audience` | `all` \| `admin` (admin-only procedures such as backup/restore and activation are still *explained*; the text says an administrator must perform them). |
| `reviewed` | Date of the owner's review. The release checklist requires every article to have one. |

| `aliases` | Common colloquial phrasings users use for this feature or action (owner decision). |

Body: professional Arabic with Egyptian-friendly phrasing, using Studix's on-screen labels (`src/constants/nav.js`).

## 4b. EvaluationItem — [evaluation.md](./evaluation.md)

`id` (H01–H40, X01–X15), `topic`, `style` (F/E/N), `question`, `criteria` (general G1–G5 or O-a–O-e plus item-specific), `result` (Pass/Fail plus reason, recorded per release run). It is **not** executed by the automated test suite.

## 5. ErrorCatalogEntry — `backend/src/assistant/knowledge/errors.md`

`message` (the exact Arabic error text shown by Studix), `meaning`, `nextStep`, `needsAdmin` (boolean).

## 6. Activity log entries (existing `activity_logs` table)

`module = 'assistant'`, `entity_type = 'assistant_settings'`, with actions `assistant_enabled`, `assistant_disabled`, `assistant_credential_set`, `assistant_credential_cleared` and `assistant_disclosure_acknowledged`. `details` may contain `provider`, `model` and `disclosureVersion`, and **never** the API key (or any part of it) or any chat content. Chat requests themselves are **not** written to `activity_logs`.
