-- backend/migrations/007_exam_grade_academic_year.sql
-- Studix — migration 007: Exams Phase 2 (schema-only). Exam's academic targeting
-- mechanism moves from `Group` to `Academic Year + Grade`, mirroring migration 006
-- (Homework 2.0 Phase 2) exactly — see Exams Phase 1's audit report for the full
-- reasoning. This migration only adds the two new columns and backfills what can be
-- safely, unambiguously derived; it does not touch any application code path.
--
-- `exams.group_id` is kept (never dropped — same precedent as `homeworks.group_id`)
-- but becomes nullable: new exams created after this phase are targeted by grade, not
-- by a required group. Existing rows are untouched beyond the backfill below.
--
-- `exams.grade` — 100% safely backfillable for every existing row: every existing exam
-- has a non-null `group_id` with a real FK to `groups`, and `groups.grade` is the exact
-- grade that group's members share — this is the same information the OLD group-based
-- eligibility filter (`student.groupId === exam.groupId`) already relied on implicitly.
-- No ambiguity, no guessing.
--
-- `exams.academic_year` — deliberately NOT backfilled here, for the same reason as
-- migration 006: there is no historical snapshot of academic year ever recorded per
-- exam, only one overwritten global `center_profile.academic_year` value. Fabricating
-- history here would be actively wrong, not just incomplete.
--
-- Idempotent: safe to re-run (IF NOT EXISTS / re-runnable UPDATE).

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS grade TEXT;

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS academic_year TEXT;

ALTER TABLE public.exams
  ALTER COLUMN group_id DROP NOT NULL;

UPDATE public.exams e
SET grade = g.grade
FROM public.groups g
WHERE e.group_id = g.id
  AND e.grade IS NULL;
