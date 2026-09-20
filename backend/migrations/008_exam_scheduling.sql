-- backend/migrations/008_exam_scheduling.sql
-- Studix — migration 008: Exams Phase 3B (schema-only). Adds the three fields needed for
-- exam scheduling and the future administrative countdown display — see Exams Phase 3A's
-- architecture audit for the full reasoning. This migration only adds nullable columns; it
-- does not touch any application code path and does not modify a single existing row.
--
-- Studix exams are physical/offline exams (see Phase 3A audit) — these fields are purely
-- informational/administrative. No student-facing online session, attempt, or answer table
-- is introduced here or planned.
--
-- `scheduled_time` — follows the exact existing convention already used by
-- `groups.time` / `attendance.session_time`: a plain nullable "HH:MM" string, not a DB TIME
-- type. No new time-storage pattern introduced.
--
-- `duration_minutes` — planned duration in minutes. End time is never stored as its own
-- column — always derived later as `actual_started_at + duration_minutes`, avoiding a
-- second source of truth that could drift from the other two.
--
-- `actual_started_at` — set once, server-side, only when an administrative "Start" action
-- is later implemented (not in this phase). Deliberately no `actual_ended_at`: "time's up"
-- is a derived display state, not a persisted event, since nothing auto-submits or
-- auto-locks (see Phase 3A audit's explicit no-auto-submit business rule).
--
-- All three columns are nullable and NOT backfilled — every existing exam (historical or
-- current) simply has NULL for all three, which is a fully valid, unremarkable state, not
-- an error. No existing row is modified in any way by this migration.
--
-- Idempotent: safe to re-run (IF NOT EXISTS on every ADD COLUMN).

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS scheduled_time TEXT;

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS actual_started_at TIMESTAMPTZ;
