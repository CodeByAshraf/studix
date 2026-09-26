// src/modules/id-cards/components/QRScanner.duplicateCheck.test.jsx
// C4 Attendance Batch A — the same-day duplicate check now uses
// GET /api/attendance?studentId=&date= instead of scanning the full global attendance array.
// The write path is covered by QRScanner.persistence.test.jsx (P1-2); here pgCheckInAttendance
// is only mocked to succeed so a normal check-in can still be confirmed to proceed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import QRScanner from './QRScanner';
import { useAppStore } from '../../../store/app.store';
import { AuthProvider } from '../../../store/auth.context';
import { ToastProvider } from '../../../components/Toast';

vi.mock('../../../services/api', async () => {
  const actual = await vi.importActual('../../../services/api');
  return { ...actual, pgGetAttendance: vi.fn(), pgCheckInAttendance: vi.fn() };
});
import { pgGetAttendance, pgCheckInAttendance } from '../../../services/api';

const S1 = { id: 's1', name: 'أحمد علي', code: 'C001', groupId: 'g1', status: 'active' };

function renderScanner() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <QRScanner />
      </ToastProvider>
    </AuthProvider>,
  );
}

function scan(code) {
  const input = screen.getByPlaceholderText('TC-2026-0001');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('QRScanner — same-day duplicate check (C4 Attendance Batch A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      students: [S1], groups: [{ id: 'g1', name: 'مجموعة أ' }], attendance: [],
      addLog: vi.fn().mockResolvedValue({ id: 'log1' }),
    });
    pgCheckInAttendance.mockImplementation((groupId, date, { studentId, status }) =>
      Promise.resolve({ id: 'att-srv-1', studentId, groupId, date, status, sessionTime: null }));
  });

  it('calls GET /api/attendance?studentId=&date=<today> with the scanned student and today\'s date', async () => {
    pgGetAttendance.mockResolvedValue([]);
    renderScanner();
    scan('C001');

    const today = new Date().toISOString().split('T')[0];
    await waitFor(() => expect(pgGetAttendance).toHaveBeenCalledWith({ studentId: 's1', date: today }));
  });

  it('shows the existing-record warning when a row is already returned for today', async () => {
    pgGetAttendance.mockResolvedValue([{ id: 'a1', studentId: 's1', date: '2026-01-01', status: 'present' }]);
    renderScanner();
    scan('C001');

    expect(await screen.findByText(/تم تسجيله مسبقاً اليوم/)).toBeInTheDocument();
  });

  it('proceeds with a normal check-in when no existing record is returned', async () => {
    pgGetAttendance.mockResolvedValue([]);
    renderScanner();
    scan('C001');

    expect(await screen.findByText(/تم تسجيل الحضور/)).toBeInTheDocument();
  });

  it('shows a clear error toast when the check itself fails, not a silent/broken scan', async () => {
    pgGetAttendance.mockRejectedValue(new Error('PG GET /attendance → 500'));
    renderScanner();
    scan('C001');

    expect(await screen.findByText(/PG GET \/attendance/)).toBeInTheDocument();
  });
});
