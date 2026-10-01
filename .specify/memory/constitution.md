<!--
Sync Impact Report
- Version change: [unratified template] → 1.0.0 (initial ratification)
- Rationale: MAJOR — no prior ratified constitution existed; all placeholder tokens replaced
  with concrete, project-derived governance. Treated as v1.0.0 per semantic versioning rules
  for constitutions (first ratified version).
- Principles established (derived from existing repo invariants, not restated boilerplate):
  1. Fail-Closed Security (NON-NEGOTIABLE)
  2. Offline-First, Single-Installation Model
  3. Deterministic, Idempotent Database Provisioning
  4. Test-First for Security- and Money-Critical Paths
  5. Documentation Reflects Current Reality Only
  6. Simplicity & YAGNI
- Added sections: Technology & Architecture Constraints (Section 2), Development Workflow &
  Quality Gates (Section 3), Governance
- Removed sections: none (first fill of the template scaffold)
- Deferred / TODO items: RATIFICATION_DATE set to the date this constitution was first
  drafted from repo context (2026-09-21) since no earlier ratified version or date exists
  in repo history to recover. If an earlier informal adoption date is known, amend this file
  to correct it (PATCH bump).
- Source basis: README.md (Support Access / Licensing architecture, offline/local deployment
  model, deterministic schema provisioning, fail-closed verification), package.json (test/lint/
  format tooling, existing *.test.js and *.integration.test.js coverage patterns), and the
  user's global CLAUDE.md solution-efficiency guidance (skip → reuse → stdlib → native →
  dep → one-line → minimum code).
- This report is scratch material for human review of the amendment and should be removed
  before/when the next amendment is made, per the template's own instructions.
-->

# Studix Constitution

## Core Principles

### I. Fail-Closed Security (NON-NEGOTIABLE)
Every verification of a signature, license, installation binding, or expiry MUST resolve to
"invalid" on any ambiguity, error, or failure — there is no silent fallback to "allowed."
Private keys (Licensing, Support Access, or any future signing key) MUST NEVER be committed to
this repository, shipped to a client installation, or printed/logged by any tool; only public
keys and signed artifacts (License Artifacts, Response Codes) may leave the owner's machine.
Each key pair (e.g., Licensing vs. Support Access) MUST remain fully independent — a leak or
rotation of one MUST NOT affect the other.
**Rationale**: Studix ships as an offline, self-hosted product activated per installation.
There is no server-side authority to fall back on at the customer site, so the client-side
verification code is the last line of defense; any "fail open" path is a licensing bypass.

### II. Offline-First, Single-Installation Model
The application MUST function with frontend, backend, and database co-located on one machine
per tutoring center, with no assumed internet connectivity for core operation, licensing
activation, or support access. Any network-dependent feature (e.g., future online activation)
MUST be additive and MUST NOT become a hard requirement for existing offline flows. Backend
connection details (e.g., `VITE_API_URL`) MUST have safe local defaults (`http://localhost:4000`).
**Rationale**: The product is deployed one installation at a time to individual centers;
assuming connectivity would break the deployment model documented in README.md and the
offline license/support signing tools in `tools/`.

### III. Deterministic, Idempotent Database Provisioning
A brand-new installation MUST be creatable from a single deterministic SQL schema artifact
without requiring the Prisma CLI or network access at install time. Server startup MUST run an
automatic migration step that is idempotent — running it with no pending migrations MUST be a
safe no-op. Schema-artifact generation tooling is a developer-time concern only and MUST NOT be
required at customer install time.
**Rationale**: Matches the existing `backend/src/db/migrationRunner.js` +
`backend/prisma/studix-schema.sql` design; customers install and upgrade without DBA involvement
or internet access.

### IV. Test-First for Security- and Money-Critical Paths
Licensing, activation, support-access, payments, and any other logic touching money or access
control MUST have unit and/or integration test coverage (`*.test.js`, `*.integration.test.js`)
written alongside — not after — the change, following Red-Green-Refactor. Coverage MUST include
the failure/rejection paths (expired license, bad signature, clock rollback, invalid payment),
not only the happy path.
**Rationale**: The existing test suite already encodes this expectation (e.g.,
`licenseClockGuard.integration.test.js`, `licenseBackupRestore.integration.test.js`,
`admissionPayments.integration.test.js`); regressions in these areas are high-cost.

### V. Documentation Reflects Current Reality Only
Operational documentation (README and equivalent docs) MUST describe only what is actually
implemented today. Any unimplemented or partially implemented feature MUST be explicitly
labeled as not implemented (e.g., "`[يحتاج تنفيذ]`" / "غير منفَّذ حاليًا") rather than described
as if complete, and roadmap/aspirational content MUST NOT be mixed into current-state
documentation.
**Rationale**: This is an existing, explicit rule stated at the top of README.md; violating it
has previously caused ambiguity about what actually works.

### VI. Simplicity & YAGNI
Prefer, in order: skipping the abstraction entirely → reusing existing codebase utilities →
language/stdlib → native platform features → an already-installed dependency → a one-line
solution → the minimum code that solves the stated problem. Do not add configurability,
abstractions, or error handling for scenarios that cannot occur. Validation, security checks,
and error handling for real boundaries (user input, external APIs, license/payment data) are
never skipped under this principle.
**Rationale**: Keeps a small, single-developer-maintained codebase auditable, which matters
especially given the security-sensitive licensing/support subsystems.

## Technology & Architecture Constraints

- Frontend: React (Vite), default port 5173. Backend: Node.js + Express, default port 4000.
  Database: PostgreSQL via Prisma, migrated through the generated deterministic schema artifact.
- State management: Zustand. Styling: Tailwind CSS. Linting/formatting: ESLint + Prettier, run
  via `npm run lint` / `npm run format` before merging.
- Signing primitive for licensing and support access MUST be asymmetric (Ed25519 or a
  successor with equivalent guarantees); symmetric shared-secret schemes MUST NOT be used for
  these subsystems, since the client must be able to verify without ever holding a secret that
  could be extracted and used to forge artifacts.
- Owner-only tooling (`tools/license-keygen.js`, `tools/license-issuer.js`,
  `tools/support-keygen.js`, `tools/support-signer.js`) MUST NOT be bundled into the client
  build or shipped to customer installations.

## Development Workflow & Quality Gates

- Tests (`npm run test`) and lint (`npm run lint`) MUST pass before a change affecting
  `backend/src` or `src/` is considered done.
- Changes to licensing, support-access, payments, or database provisioning code MUST include
  or update corresponding tests in the same change, per Principle IV.
- Code review (via the project's `code-review` workflow) SHOULD be used before merging
  non-trivial changes to the security-critical subsystems named above.
- New or changed behavior in Support Access, Licensing, payments, or provisioning MUST be
  reflected in README.md in the same change, per Principle V — not deferred to a follow-up.

## Governance

This constitution supersedes ad hoc practice for anything it explicitly governs. Amendments
are made by editing `.specify/memory/constitution.md` directly, following the same
Sync Impact Report process used to create this version.

**Versioning policy** (semantic versioning for this document):
- MAJOR: Backward-incompatible removal or redefinition of a principle or governance rule.
- MINOR: A new principle or materially expanded section is added.
- PATCH: Wording clarifications, typo fixes, or non-semantic corrections (e.g., fixing a date).

**Compliance review**: Pull requests / code reviews touching the areas named in Development
Workflow & Quality Gates SHOULD verify compliance with the relevant principle(s) above.
Any deviation MUST be justified in the change description; unjustified complexity or a
fail-open security path is grounds for requesting changes.

**Version**: 1.0.0 | **Ratified**: 2026-09-21 | **Last Amended**: 2026-09-21
