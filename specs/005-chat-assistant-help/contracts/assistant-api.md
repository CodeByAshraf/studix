# Contract: Assistant API (V1)

**Mount**: `app.use('/api/assistant', requireAuth, assistantRouter)` in `backend/src/server.js`. The global `requireActivation` already runs first for every `/api/*` path.

**Common failures (existing behavior, unchanged)**:
- `402 { ok:false, error, licenseRequired:true }`: installation not activated.
- `401 { ok:false, error }`: no valid session.

**Error shape (new endpoints)**: `{ ok:false, error:<fixed Arabic text from assistant/errors.js>, code:<MACHINE_CODE> }`.
- `error` is always a fixed, provider-agnostic string.
- It **never** contains provider text, `err.message`, a stack, an endpoint, a request id, a filesystem path, a submitted value, or any secret (FR-029).

**API key rule (FR-025)**: no response of any endpoint below ever contains the API key or any part, hint, prefix, suffix or length of it.

---

## GET `/api/assistant/status` — any authenticated user

`200 { ok:true, data:{ enabled:boolean } }`

- `enabled` is `true` only when the backend settings resolve to Enabled (data-model state machine).
- The interface shows the entry point **only** when this says `true`. It re-checks when the panel opens, and hides the entry point on any `403 ASSISTANT_DISABLED`.

## POST `/api/assistant/chat` — any authenticated user; only when enabled

Guards (in order): `assistantIpLimiter` → `assistantUserLimiter` → enabled check (fail closed) → size check → shape/length validation → turn/history trimming → in-flight check → masking (R14) → provider.

**Request**

```json
{ "messages": [ { "role": "user", "text": "ازاي أسجل دفعة لطالب؟" } ], "page": "payments" }
```

Limits: [data-model §2](../data-model.md) / spec FR-018.

**200**

```json
{ "ok": true, "data": { "reply": "…plain text…", "truncated": false, "kbVersion": "a1b2c3d4" } }
```

| Status | `code` | When | User-facing meaning (fixed text) |
|---|---|---|---|
| 400 | `ASSISTANT_INVALID_REQUEST` | Bad shape, bad role, last message not `user`, empty message | "The request is invalid" |
| 400 | `ASSISTANT_MESSAGE_TOO_LONG` | A message is over 2,000 characters | "Please shorten your question" |
| 403 | `ASSISTANT_DISABLED` | Not enabled (includes a missing or malformed settings file, or an outdated disclosure acknowledgment) | "The assistant is turned off" |
| 413 | `ASSISTANT_REQUEST_TOO_LARGE` | Body over 32 KB | "The request is too large" |
| 429 | `ASSISTANT_RATE_LIMITED` | Over 20 per 5 min per user, or 60 per 5 min per IP (no provider call) | "Please wait a little before asking again" |
| 429 | `ASSISTANT_BUSY` | This user already has a question in progress | "Please wait for the current answer" |
| 429 | `ASSISTANT_PROVIDER_BUSY` | Provider-side rate limit | "The assistant is busy — try again in a minute" |
| 502 | `ASSISTANT_BAD_RESPONSE` | Malformed, empty or refused provider response | "The assistant could not answer — try rephrasing" |
| 503 | `ASSISTANT_UNAVAILABLE` | Offline, DNS/network error, provider outage, unknown provider failure, unexpected internal error | "The assistant is unavailable — check the connection or try later" |
| 503 | `ASSISTANT_NOT_CONFIGURED` | Provider rejected the key (`auth`) or quota exhausted (`quota`); sets `lastError` | "The assistant is not available — contact your administrator" |
| 504 | `ASSISTANT_TIMEOUT` | No answer within 20 s | "The assistant took too long — try again" |

**Sent to the provider (exhaustive, FR-021)**:
1. the fixed system instructions plus knowledge base plus error catalog;
2. the kept, masked `messages`;
3. the allowlisted `page` id;
4. a reply-language instruction.

**Never sent (FR-022)**: any database data (students, parents, payments/cashbox, attendance, grades/homework), phone numbers, addresses, user identity/roles/permissions, cookies/session data, logs, filesystem paths, license/installation/machine identifiers, secrets or credentials, password hashes, page content or on-screen data.

## GET `/api/assistant/settings` — admin only (`requireRole('admin')`)

`200`:

```json
{ "ok": true, "data": {
  "enabled": false, "configured": true, "provider": "<adapter id>", "model": null,
  "disclosure": { "version": 1, "acknowledgedBy": "admin", "acknowledgedAt": "2026-…", "currentVersion": 1 },
  "lastError": null,
  "disclosureText": "<Arabic disclosure, currentVersion>",
  "providers": ["<adapter ids available in this release>"]
} }
```

The response contains only non-secret metadata. There is never a key, hint or length.

## PUT `/api/assistant/settings` — admin only

**Request (every field optional; only the fields present are applied)**

```json
{
  "enabled": true,
  "provider": "<adapter id>",
  "model": null,
  "credential": "<API key — write-only, never echoed>",
  "clearCredential": false,
  "acknowledgeDisclosureVersion": 1
}
```

**Rules**
- `enabled:true` → `400 ASSISTANT_DISCLOSURE_REQUIRED` unless the key is configured **and** the current disclosure version is acknowledged (in this request or before).
- `acknowledgeDisclosureVersion` must equal `currentVersion`, otherwise `400`.
- `clearCredential:true` also forces `enabled:false`.
- An unknown `provider` → `400 ASSISTANT_INVALID_REQUEST`. The error never echoes submitted values, including the credential.
- Each effective change writes one `activity_logs` row (data-model §6), with no key and no chat content.

**Response**: `200` with the same public shape as GET.

## POST `/api/assistant/settings/test` — admin only

Sends one tiny, fixed, non-customer prompt through the configured provider.
- `200 { ok:true, data:{ reachable:true } }`, or one of the 429/502/503/504 codes above.
- It updates or clears `lastError`.
- It is subject to the per-user and per-IP assistant limiters.
