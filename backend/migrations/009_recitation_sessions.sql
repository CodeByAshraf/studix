-- backend/migrations/009_recitation_sessions.sql
-- Studix — migration 009: Recitation Assessment, Phase 1 (data layer only).
--
-- Adds `attendance_sessions` and `recitations`. No existing table, column, trigger,
-- function, or CHECK constraint is touched — this is purely additive. No backfill (both
-- tables are brand new; there is no legacy data to migrate into them).
--
-- attendance_sessions gives the existing, previously-implicit (group_id, date)
-- attendance session a real persisted identity, so it can carry a lock/status — the
-- attendance table itself and its save/update code path are NOT modified by this
-- migration (Phase 1 is data-layer only; the guard that will make attendanceSessions.js
-- respect this table's `status` is out of scope here, added in a later phase).
--
-- Two independent lifecycles live on the SAME row (confirmed product decision — this is
-- one shared session identity, not two): `status` ('draft'|'completed') is Attendance's
-- own lock; `recitation_status` ('not_started'|'in_progress'|'completed') is a fully
-- separate lock for Recitation, because completing attendance must never require any
-- recitation coverage (partial coverage, e.g. 12/18, is an explicitly valid locked
-- state). `max_score` is nullable because it is chosen later, when a teacher opens the
-- separate Recitation screen for this session — not known at attendance-save time.
--
-- recitations is one historical row per (session, student) — `@@unique([session_id,
-- student_id])` below. A new session is always a new attendance_sessions row, so
-- re-saving one session's scores can only ever touch that session's own recitations
-- rows; a different session (different group and/or date) is structurally a different
-- session_id, so cross-session overwriting is impossible, not merely avoided by
-- convention. `group_id`/`date` are denormalized copies of the parent session's (same
-- precedent as attendance.group_id being stored directly rather than derived), and
-- `max_score` is a snapshot copied at write time — both exist so a later change to a
-- future session's max score can never alter the meaning of an already-recorded
-- historical row.
--
-- On a FRESH install this file is never executed directly — the installer applies
-- backend/prisma/studix-schema.sql (regenerated from this file via
-- scripts/generateSchemaArtifact.js, which reproduces this table's structure/CHECK/
-- triggers exactly). migrationRunner.js stamps this version as applied without
-- re-running it. On an EXISTING installation, migrationRunner.js executes this file for
-- real, inside one transaction.
--
-- Out of scope for this phase (tracked separately, not implemented here): the
-- attendanceSessions.js lock guard, the recitation save/complete API, any UI, printing,
-- Student Report integration, the dedicated `recitation` permission, and the
-- recitation-completion activity-log entry.

CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id                       TEXT NOT NULL,
  group_id                 TEXT NOT NULL REFERENCES public.groups(id),
  date                     DATE NOT NULL,
  session_time             TEXT,
  max_score                DECIMAL(6, 2),
  status                   TEXT NOT NULL DEFAULT 'draft',
  completed_at             TIMESTAMPTZ(6),
  completed_by             TEXT REFERENCES public.users(id),
  recitation_status        TEXT NOT NULL DEFAULT 'not_started',
  recitation_completed_at  TIMESTAMPTZ(6),
  recitation_completed_by  TEXT REFERENCES public.users(id),
  created_at               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT attendance_sessions_pkey PRIMARY KEY (id)
);

ALTER TABLE public.attendance_sessions
  ADD CONSTRAINT chk_attendance_sessions_status CHECK (status IN ('draft', 'completed'));

ALTER TABLE public.attendance_sessions
  ADD CONSTRAINT chk_attendance_sessions_recitation_status
    CHECK (recitation_status IN ('not_started', 'in_progress', 'completed'));

-- IF NOT EXISTS: uq_attendance_sessions_group_date IS representable in schema.prisma
-- (@@unique) and is therefore already created by `prisma db push` on every scratch/test
-- database (same reasoning as CREATE TABLE IF NOT EXISTS above) — a real, existing
-- production install never runs db push, so this statement is the actual index-creation
-- statement there.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_sessions_group_date
  ON public.attendance_sessions (group_id, date);

CREATE TRIGGER trg_attendance_sessions_updated
BEFORE UPDATE ON public.attendance_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.recitations (
  id           TEXT NOT NULL,
  session_id   TEXT NOT NULL REFERENCES public.attendance_sessions(id),
  student_id   TEXT NOT NULL REFERENCES public.students(id),
  group_id     TEXT NOT NULL REFERENCES public.groups(id),
  date         DATE NOT NULL,
  score        DECIMAL(6, 2) NOT NULL,
  max_score    DECIMAL(6, 2) NOT NULL,
  note         TEXT,
  created_by   TEXT REFERENCES public.users(id),
  created_at   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT recitations_pkey PRIMARY KEY (id)
);

ALTER TABLE public.recitations
  ADD CONSTRAINT chk_recitations_score CHECK (score >= 0);

ALTER TABLE public.recitations
  ADD CONSTRAINT chk_recitations_max_score CHECK (max_score > 0);

ALTER TABLE public.recitations
  ADD CONSTRAINT chk_recitations_score_le_max CHECK (score <= max_score);

-- IF NOT EXISTS on all three below: each is representable in schema.prisma (@@unique /
-- @@index) and therefore already created by `prisma db push` on every scratch/test
-- database — same reasoning as above.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recitations_session_student
  ON public.recitations (session_id, student_id);

CREATE INDEX IF NOT EXISTS idx_recitations_student
  ON public.recitations (student_id);

CREATE INDEX IF NOT EXISTS idx_recitations_group_date
  ON public.recitations (group_id, date);

CREATE TRIGGER trg_recitations_updated
BEFORE UPDATE ON public.recitations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
