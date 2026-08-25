-- backend/migrations/003_licensing.sql
-- Studix — migration 003: Licensing — schema only (Phase 5a).
--
-- Adds `license_config`, a dedicated singleton table holding this installation's
-- licensing state. Mirrors the Phase 4a support_access_config pattern in shape and
-- philosophy, but is a fully independent table with no relation to it beyond one
-- deliberate exception: installation_id is NOT duplicated here.
-- support_access_config.installation_id (Phase 4a, immutable, already the single
-- source of truth for this installation's identity) is the only installation_id this
-- application will ever have — a future license artifact is built/verified against it
-- by reading it directly wherever needed, never by storing a second copy that could
-- drift out of sync. See the Phase 5 investigation report's explicit design rule.
--
-- licensing_public_key is a SEPARATE key from support_access_config.support_public_key
-- — never the same keypair, never the same trust root. Compromise or rotation of one
-- must never affect the other (same reasoning as supportSession.js's domain separation
-- from session.js's signing key, one level up: two independent trust roots, not one
-- shared secret wearing two hats).
--
-- Phase 5a is schema only: no routes, no verification logic, no enforcement middleware,
-- no frontend, no key generator, and — deliberately, unlike 002_support_access.sql —
-- NO SEEDED ROW. support_access_config needed its installation_id to exist immediately
-- because other things (Support Access challenges) could reference it right away.
-- license_config has no equivalent urgency: nothing reads or writes it yet, so seeding
-- an all-NULL row now would be pure churn. A future Phase 5b bootstrap function
-- (ensureLicenseConfig, mirroring ensureInstallationConfig exactly) will lazily create
-- the singleton row the first time it's actually needed. licensing_public_key in
-- particular must stay NULL until Phase 5d (the owner-side license issuer) generates a
-- real keypair — seeding a placeholder value here would be worse than NULL, since a
-- placeholder key can never verify a real signature and would only mask the
-- "not configured yet" state that fail-closed verification logic needs to detect.
--
-- license_id/product/expires_at/features/activated_at are CACHED/DERIVED convenience
-- columns only, meant to be recomputed from license_artifact whenever it changes —
-- never, on their own, the authorization source for a future enforcement check (that
-- must always re-verify license_artifact's signature, exactly like
-- verifyChallengeSignature re-verifies a Support Access challenge rather than trusting
-- a cached flag). chk_license_activation_consistency below enforces the one invariant
-- meaningful at the schema level: activated_at and license_artifact are always both
-- NULL or both set together — no partial/inconsistent activation state is representable
-- even by a direct SQL write.
--
-- Table/column definitions live in schema.prisma (source of truth), same split as every
-- other table — the CREATE TABLE below is guarded with IF NOT EXISTS purely so it is a
-- no-op wherever `prisma db push` already created the table from schema.prisma (every
-- scratch/test database), while still being the actual, real table-creation statement
-- for existing production installations, where db push never runs. Column defs are
-- written out in full so that real-world case is correct on its own, not merely a
-- fallback — same pattern as 002_support_access.sql.
--
-- On a FRESH install this file is never executed directly — the installer applies
-- backend/prisma/studix-schema.sql (schema-only), which reproduces this table's
-- structure/CHECK/trigger but carries no data — there is no data to carry either way,
-- since this migration seeds nothing. On an EXISTING installation, migrationRunner.js
-- executes this file for real, inside one transaction.

CREATE TABLE IF NOT EXISTS public.license_config (
  id                    SMALLINT NOT NULL DEFAULT 1,
  licensing_public_key  TEXT,
  license_artifact      TEXT,
  license_id            TEXT,
  product               TEXT,
  expires_at            TIMESTAMPTZ(6),
  features              JSONB,
  activated_at          TIMESTAMPTZ(6),
  created_at            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT license_config_pkey PRIMARY KEY (id)
);

ALTER TABLE public.license_config
  ADD CONSTRAINT license_config_single_row CHECK (id = 1);

ALTER TABLE public.license_config
  ADD CONSTRAINT chk_license_activation_consistency
  CHECK ((license_artifact IS NULL) = (activated_at IS NULL));

-- set_updated_at() already exists (defined in 001_baseline.sql, applied before this file
-- always runs) — same function reused by trg_center_updated/trg_students_updated/
-- trg_parents_updated/trg_communications_updated. No new function needed.
CREATE TRIGGER trg_license_config_updated
BEFORE UPDATE ON public.license_config
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
