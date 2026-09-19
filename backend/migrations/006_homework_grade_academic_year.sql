-- backend/migrations/006_homework_grade_academic_year.sql
-- Studix — migration 006: Homework 2.0 Phase 2 (schema-only). Homework's academic
-- targeting mechanism moves from `Group` to `Academic Year + Grade` — see Homework 2.0
-- Phase 1's audit report for the full reasoning. This migration only adds the two new
-- columns and backfills what can be safely, unambiguously derived; it does not touch any
-- application code path.
--
-- `homeworks.group_id` is kept (never dropped — matches this project's own precedent of
-- keeping `students.group_id` as a mirror rather than removing it during the Multi-Group
-- Enrollment work) but becomes nullable: new homework created after this phase is targeted
-- by grade, not by a required group. Existing rows are untouched beyond the backfill below.
--
-- `homeworks.grade` — 100% safely backfillable for every existing row: every existing
-- homework has a non-null `group_id` with a real FK to `groups`, and `groups.grade` is the
-- exact grade that group's members share — this is the same information the OLD
-- group-based eligibility filter (`student.groupId === homework.groupId`, itself implying
-- `student.grade === group.grade` for every actual member) already relied on implicitly.
-- No ambiguity, no guessing.
--
-- `homeworks.academic_year` — deliberately NOT backfilled here. There is no historical
-- record of what academic year applied when an old homework was created (the app has only
-- ever tracked a single *current* value on center_profile.academic_year, overwritten over
-- time, never snapshotted per-record) — backfilling it with today's current value would be
-- fabricating history, not recovering it. Left NULL for every pre-existing row; only
-- homework created going forward stamps it from center_profile.academic_year at creation
-- time (application-level, not this migration).
--
-- Column/relation definitions live in schema.prisma (source of truth), same split as every
-- other table in this project — ADD COLUMN IF NOT EXISTS / DROP NOT NULL below are no-ops
-- wherever `prisma db push` already applied schema.prisma (every scratch/test database and
-- fresh dev environment), while still being the real statements for existing production
-- installations, where db push never runs. The backfill UPDATE is genuinely new data
-- movement, not representable in schema.prisma at all, and is idempotent (WHERE grade IS
-- NULL) — safe to run more than once.

ALTER TABLE public.homeworks
  ADD COLUMN IF NOT EXISTS grade TEXT;

ALTER TABLE public.homeworks
  ADD COLUMN IF NOT EXISTS academic_year TEXT;

ALTER TABLE public.homeworks
  ALTER COLUMN group_id DROP NOT NULL;

-- Backfill: derive grade from the existing group_id -> groups.grade link, for every
-- historical row that doesn't already have one set.
UPDATE public.homeworks h
SET grade = g.grade
FROM public.groups g
WHERE h.group_id = g.id
  AND h.grade IS NULL;
