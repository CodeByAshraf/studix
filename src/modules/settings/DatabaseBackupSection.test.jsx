// src/modules/settings/DatabaseBackupSection.test.jsx
// P1-1 — the admin-only routine database backup status view: shows the last verified backup and
// the schedule, and never hides a failed, missing, stale, or unscheduled backup.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../../services/api', () => ({ pgGetBackupStatus: vi.fn() }));
import { pgGetBackupStatus } from '../../services/api';
import DatabaseBackupSection from './DatabaseBackupSection';
import { backupWarnings } from './backupStatusWarnings';

const NOW = Date.parse('2026-09-26T12:00:00.000Z');

function run(overrides = {}) {
  return {
    status: 'success', reason: null,
    startedAt: '2026-09-26T03:00:00.000Z', finishedAt: '2026-09-26T03:00:05.000Z', error: null,
    backup: { fileName: 'studix-backup-2026-09-26T03-00-00-000Z.dump', sizeBytes: 2 * 1024 * 1024, verified: true },
    retentionErrors: 0, retentionDeleted: 0,
    ...overrides,
  };
}

function statusFixture(overrides = {}) {
  return {
    ok: true,
    backupDir: 'C:\\ProgramData\\Studix\\backups',
    schedule: { taskName: 'StudixDailyBackup', dailyAt: '03:00', registered: true },
    retention: { days: 14, minKeep: 7 },
    statusReadable: true,
    lastRun: run(),
    lastSuccess: run(),
    listError: null,
    count: 3,
    totalSizeBytes: 6 * 1024 * 1024,
    backups: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('backupWarnings', () => {
  it('a recent verified backup with a registered schedule produces no warning', () => {
    expect(backupWarnings(statusFixture(), NOW)).toEqual([]);
  });

  it('warns when no backup has ever succeeded', () => {
    const w = backupWarnings(statusFixture({ lastRun: null, lastSuccess: null }), NOW);
    expect(w.join(' ')).toContain('لا توجد أي نسخة احتياطية ناجحة');
  });

  it('warns when the last success is older than two days', () => {
    const old = run({ finishedAt: '2026-09-23T03:00:05.000Z' });
    const w = backupWarnings(statusFixture({ lastSuccess: old, lastRun: old }), NOW);
    expect(w.join(' ')).toContain('أقدم من يومين');
  });

  it('warns about a failed last run, with its (server-redacted) error', () => {
    const w = backupWarnings(statusFixture({ lastRun: run({ status: 'failed', reason: 'postgres_unavailable', error: 'PostgreSQL غير متاح', backup: null }) }), NOW);
    expect(w.join(' ')).toContain('فشلت آخر محاولة نسخ احتياطي: PostgreSQL غير متاح');
  });

  it('warns when retention cleanup failed (warning status) — never shown as plain success', () => {
    const w = backupWarnings(statusFixture({ lastRun: run({ status: 'warning', reason: 'retention_failed' }) }), NOW);
    expect(w.join(' ')).toContain('حذف النسخ القديمة');
  });

  it('warns when the scheduled task is not registered', () => {
    const w = backupWarnings(statusFixture({ schedule: { taskName: 'StudixDailyBackup', dailyAt: '03:00', registered: false } }), NOW);
    expect(w.join(' ')).toContain('غير مسجَّلة');
  });
});

describe('DatabaseBackupSection', () => {
  it('shows the last verified backup, schedule, count, and location', async () => {
    pgGetBackupStatus.mockResolvedValue(statusFixture());
    render(<DatabaseBackupSection />);
    expect(await screen.findByText(/studix-backup-2026-09-26T03-00-00-000Z\.dump/)).toBeInTheDocument();
    expect(screen.getByText(/مُتحقَّق منها/)).toBeInTheDocument();
    expect(screen.getByText(/يومياً الساعة 03:00/)).toBeInTheDocument();
    expect(screen.getByText(/3 نسخة/)).toBeInTheDocument();
    expect(screen.getByText('C:\\ProgramData\\Studix\\backups')).toBeInTheDocument();
  });

  it('shows a visible alert for a failed last run', async () => {
    pgGetBackupStatus.mockResolvedValue(statusFixture({
      lastRun: run({ status: 'failed', reason: 'dump_failed', error: 'pg_dump فشل', backup: null }),
    }));
    render(<DatabaseBackupSection />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('فشلت آخر محاولة نسخ احتياطي: pg_dump فشل');
  });

  it('a status request failure is shown, not swallowed, and can be retried', async () => {
    pgGetBackupStatus.mockRejectedValueOnce(new Error('PG GET /backup-status → 500'));
    render(<DatabaseBackupSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('تعذّر قراءة حالة النسخ الاحتياطي');

    pgGetBackupStatus.mockResolvedValueOnce(statusFixture());
    fireEvent.click(screen.getByText('↻ تحديث الحالة'));
    await waitFor(() => expect(pgGetBackupStatus).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/يومياً الساعة 03:00/)).toBeInTheDocument();
  });
});
