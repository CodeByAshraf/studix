-- backend/migrations/005_student_group_enrollments.sql
-- Studix — migration 005: Multi-Group Enrollment, Phase 0 (schema + backfill only).
--
-- Adds `student_group_enrollments`, the join table between students and groups that
-- the Multi-Group Enrollment redesign (see the two approved architecture reviews)
-- introduces to support: one Primary Group per student, any number of Additional
-- Groups, and an optional per-enrollment day-of-week override (`attend_days`) so
-- group membership and a student's actual attendance schedule can differ (a student
-- enrolled in a Saturday+Wednesday group who only ever attends Saturday).
--
-- Table/column/FK definitions live in schema.prisma (source of truth), same split as
-- every other table in this project — the CREATE TABLE below is guarded with IF NOT
-- EXISTS purely so it is a no-op wherever `prisma db push` already created the table
-- from schema.prisma (every scratch/test database), while still being the actual real
-- table-creation statement for existing production installations, where db push never
-- runs. The two CHECK constraints and both partial unique indexes are genuinely new
-- DDL not representable in schema.prisma at all (same as every CHECK/partial-unique
-- index in 001_baseline.sql) — added via separate statements below so they are applied
-- for real even when the CREATE TABLE itself no-ops against a db-push-created table.
--
-- `students.group_id` is NOT touched by this migration and keeps meaning "Primary
-- Group" permanently — this phase only adds the new table and backfills it; no
-- existing student row, column value, or application code path changes.
--
-- Backfill: every existing student with a non-null group_id gets exactly one
-- role='primary', status='active' enrollment row, attend_days=NULL. NULL attend_days
-- intentionally means "attends every day the group meets" — exactly today's implicit,
-- unstated behavior for every current single-group student, so this backfill changes
-- no observable behavior anywhere in the app. Students with group_id IS NULL receive
-- zero enrollment rows. The backfill's WHERE NOT EXISTS guard makes it safe to run
-- more than once (defense in depth — migrationRunner.js's own _studix_migrations
-- tracking already prevents normal re-execution; this guards the case of someone
-- re-running this file by hand, e.g. via psql, outside the runner) — a second run
-- finds every eligible student already has an active primary enrollment and inserts
-- nothing further. The partial unique index below is a second, DB-enforced layer of
-- the same guarantee.
--
-- On a FRESH install this file is never executed directly — the installer applies
-- backend/prisma/studix-schema.sql (which reproduces this table's structure/CHECK/
-- indexes/trigger but, being a --schema-only dump, not this file's backfill INSERT — a
-- fresh install has no pre-existing students to backfill in the first place).
-- migrationRunner.js stamps this version as applied without re-running it.
-- On an EXISTING installation, migrationRunner.js executes this file for real, inside
-- one transaction — every existing student with a group keeps that group as their
-- Primary Group, now backed by a real enrollment row instead of only the scalar column.
--
-- Out of scope for this phase (tracked separately, not implemented here): enrollment
-- create/withdraw/transfer services, groups.status/archive lifecycle, any UI, any
-- attendance/homework/exam/payment/report code change.

CREATE TABLE IF NOT EXISTS public.student_group_enrollments (
  id           TEXT NOT NULL,
  student_id   TEXT NOT NULL REFERENCES public.students(id),
  group_id     TEXT NOT NULL REFERENCES public.groups(id),
  role         TEXT NOT NULL,
  status       TEXT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE,
  attend_days  JSONB,
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT student_group_enrollments_pkey PRIMARY KEY (id)
);

ALTER TABLE public.student_group_enrollments
  ADD CONSTRAINT chk_enrollment_role CHECK (role IN ('primary', 'additional'));

ALTER TABLE public.student_group_enrollments
  ADD CONSTRAINT chk_enrollment_status CHECK (status IN ('active', 'withdrawn', 'transferred'));

-- Prevent duplicate active membership in the same group.
CREATE UNIQUE INDEX uq_student_group_enrollments_student_group_active
  ON public.student_group_enrollments (student_id, group_id)
  WHERE (status = 'active');

-- Guarantee at most one active Primary Group per student.
CREATE UNIQUE INDEX uq_student_group_enrollments_student_primary_active
  ON public.student_group_enrollments (student_id)
  WHERE (status = 'active' AND role = 'primary');

CREATE TRIGGER trg_student_group_enrollments_updated
BEFORE UPDATE ON public.student_group_enrollments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Backfill: one active primary enrollment per existing students.group_id.
-- Idempotent — see header comment above.
INSERT INTO public.student_group_enrollments
  (id, student_id, group_id, role, status, start_date, end_date, attend_days, created_at, updated_at)
SELECT
  gen_random_uuid()::text,
  s.id,
  s.group_id,
  'primary',
  'active',
  s.enroll_date,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM public.students s
WHERE s.group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.student_group_enrollments e
    WHERE e.student_id = s.id AND e.role = 'primary' AND e.status = 'active'
  );
