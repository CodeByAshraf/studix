# Quickstart / Validation Guide: Studix Chat Assistant — V1

Scenarios that prove the feature works end to end. Contracts: [contracts/assistant-api.md](./contracts/assistant-api.md). Data: [data-model.md](./data-model.md).

## Prerequisites

- A dev checkout, with the backend on `:4000` and the frontend dev server or built `dist/`.
- An activated installation (license) and an admin account plus one non-admin account.
- For scenarios 1–7: nothing else, because automated tests use the fake provider.
- For scenarios 8–10: a real provider credential (only after the provider decision; see plan).
- Point `STUDIX_CONFIG_PATH` at a scratch copy so `assistant.json` is written to a temporary folder, never the real `ProgramData`.

## Automated

```bash
cd backend && npm test          # includes settings store, prompt/KB guards, egress guard, route contract tests
cd .. && npm test               # includes AssistantPanel / settings section / XSS-inert tests
```

**Expected**: all green, and no network access during tests.

## Manual scenarios

| # | Scenario | Expected |
|---|---|---|
| 1 | Fresh config (no `assistant.json`), log in as a non-admin and as an admin | No assistant button. `POST /api/assistant/chat` returns `403 ASSISTANT_DISABLED`. |
| 2 | Log out, then call `/api/assistant/status` | `401` |
| 3 | Non-admin calls `GET/PUT /api/assistant/settings` | `403` |
| 4 | Admin opens Settings → Assistant and tries to enable without a credential or acknowledgment | Blocked, and the disclosure text is shown. |
| 5 | Admin sets the API key, acknowledges the disclosure, enables | The button appears for all users (after the UI's next status check). `activity_logs` shows the acknowledgment/enable/key-set actions with no key and no chat content. `GET settings` shows only `configured:true`, provider and model, and no part of the key. |
| 6 | Put a `<script>alert(1)</script>` reply through the fake provider (test hook) | Shown as literal text, nothing executes. |
| 7 | Admin disables | The button disappears. The next chat returns `403` with no restart. |
| 8 | **Release gate**: run the Help set (H01–H40) from [evaluation.md](./evaluation.md) on the release provider/model | ≥ 36/40 pass; 40/40 in the question's language style (SC-002). |
| 9 | **Release gate**: run the Out-of-Scope set (X01–X15) | 15/15 pass (SC-003). |
| 10 | Unplug the network and ask a question | "Assistant unavailable" message within 20 s. The rest of Studix is unaffected (SC-004, SC-006). |
| 11 | Set an invalid key, then ask | User: "not available — contact your administrator". Admin setting: category "API key rejected". No provider text anywhere (SC-009). |
| 12 | With the UI bypassed (direct HTTP), send a 40 KB body, a 2,500-character message, and 30 messages | 413; 400; accepted with only the latest 10 (≤ 12,000 characters) forwarded (SC-010). |
| 13 | Search the log file, `activity_logs`, a fresh `pg_dump` backup, the in-app data export, and all browser network responses for the API key | 0 occurrences; no question/answer text in logs (SC-008, FR-026). |
