-- backend/migrations/002_support_access.sql
-- Studix — migration 002: Support Access — schema only (Phase 4a).
--
-- Adds `support_access_config`, a dedicated singleton table (separate from
-- center_profile) holding this installation's stable installation_id and,
-- eventually — Phase 4b+, not yet implemented — the embedded Support Access
-- public key. No private key, master secret, password, or signing secret is
-- ever stored here or anywhere in the application: only a public key is
-- ever embedded, later, and it belongs to a keypair kept separate from the
-- future Licensing/Serial Activation system's own keypair (Phase 4a scope:
-- schema only — no routes, UI, support login, or support session logic
-- exist yet).
--
-- Table/column definitions (types, nullability, the @unique on
-- installation_id, its gen_random_uuid()::text default) live in
-- schema.prisma, same split used by every other table in this project —
-- the CREATE TABLE below is guarded with IF NOT EXISTS purely so it is a
-- no-op wherever `prisma db push` already created the table from
-- schema.prisma (every scratch/test database, and any future fresh install
-- built the same way this artifact already is), while still being the
-- actual, real table-creation statement for existing production
-- installations, where db push never runs. Column defs are written out in
-- full (not just referenced) so that real-world case is correct on its own,
-- not merely a fallback. The single-row CHECK, the immutability trigger,
-- and the seed row are genuinely new DDL/DML not representable in
-- schema.prisma at all — same pattern as center_profile_single_row /
-- inv_settings_single_row in 001_baseline.sql.
--
-- On a FRESH install this file is never executed directly — the installer
-- applies backend/prisma/studix-schema.sql (a --schema-only pg_dump — see
-- backend/scripts/generateSchemaArtifact.js), which reproduces this table's
-- structure/CHECK/trigger but NOT this file's seed INSERT (schema-only
-- dumps exclude data). A fresh install therefore ends up with an empty
-- support_access_config table; migrationRunner.js stamps this version as
-- applied without re-running it. Seeding the row for a fresh install is
-- Phase 4b's responsibility (not yet implemented).
-- On an EXISTING installation, migrationRunner.js executes this file for
-- real, inside one transaction — every existing installation gets a
-- stable installation_id the moment this migration runs.

CREATE TABLE IF NOT EXISTS public.support_access_config (
  id                 SMALLINT NOT NULL DEFAULT 1,
  installation_id    TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  support_public_key TEXT,
  created_at         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT support_access_config_pkey PRIMARY KEY (id),
  CONSTRAINT support_access_config_installation_id_key UNIQUE (installation_id)
);

ALTER TABLE public.support_access_config
  ADD CONSTRAINT support_access_config_single_row CHECK (id = 1);

CREATE OR REPLACE FUNCTION public.prevent_installation_id_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.installation_id IS DISTINCT FROM OLD.installation_id THEN
    RAISE EXCEPTION 'installation_id ثابت لهذا التثبيت — لا يمكن تعديله بعد إنشائه.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_support_config_installation_immutable
BEFORE UPDATE ON public.support_access_config
FOR EACH ROW EXECUTE FUNCTION prevent_installation_id_change();

INSERT INTO public.support_access_config (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;
