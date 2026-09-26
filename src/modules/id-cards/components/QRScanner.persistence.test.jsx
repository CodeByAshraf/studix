// src/modules/id-cards/components/QRScanner.persistence.test.jsx
// P1-2 (QR attendance persistence) — a QR check-in used to only append a locally-generated
// record to the Zustand store while showing "تم تسجيل الحضور", so nothing reached PostgreSQL.
// It now persists through POST /api/attendance-sessions/:groupId/:date/check-in
// (pgCheckInAttendance) and only updates local state / shows success after the server confirms.
// The server-side rules (lock, eligibility, duplicates) are proven against real PostgreSQL in
// backend/src/routes/attendanceSessions.checkIn.integration.test.js.
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
const NO_GROUP = { id: 's2', name: 'منى حسن', code: 'C002', groupId: null, status: 'active' };
const today = new Date().toISOString().split('T')[0];
const SERVER_RECORD = { id: 'att-srv-1', studentId: 's1', groupId: 'g1', date: today, status: 'present', sessionTime: '10:30' };

let addLog;

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

describe('QRScanner — check-in is persisted to PostgreSQL (P1-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addLog = vi.fn().mockResolvedValue({ id: 'log1' });
    useAppStore.setState({
      students: [S1, NO_GROUP], groups: [{ id: 'g1', name: 'مجموعة أ' }], attendance: [], addLog,
    });
    pgGetAttendance.mockResolvedValue([]);
  });

  it('calls the check-in API with the student\'s group, today\'s date and the selected status', async () => {
    pgCheckInAttendance.mockResolvedValue(SERVER_RECORD);
    renderScanner();
    scan('C001');

    await waitFor(() => expect(pgCheckInAttendance).toHaveBeenCalledTimes(1));
    expect(pgCheckInAttendance).toHaveBeenCalledWith('g1', today, expect.objectContaining({ studentId: 's1', status: 'present' }));
  });

  it('on success: stores the SERVER record (not a local att_qr_ id), logs the activity, shows success', async () => {
    pgCheckInAttendance.mockResolvedValue(SERVER_RECORD);
    renderScanner();
    scan('C001');

    expect(await screen.findByText(/تم تسجيل الحضور/)).toBeInTheDocument();
    expect(useAppStore.getState().attendance).toEqual([SERVER_RECORD]);
    expect(useAppStore.getState().attendance.some((r) => String(r.id).startsWith('att_qr_'))).toBe(false);
    expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', module: 'attendance', entityId: 'att-srv-1' }));
  });

  it('on API failure: shows the real error, no success message, and nothing is added locally', async () => {
    pgCheckInAttendance.mockRejectedValue(new Error('الجلسة مكتملة — لا يمكن تعديل الحضور بعد اكتمالها.'));
    renderScanner();
    scan('C001');

    expect(await screen.findByText(/الجلسة مكتملة/)).toBeInTheDocument();
    expect(screen.queryByText(/تم تسجيل الحضور/)).not.toBeInTheDocument();
    expect(useAppStore.getState().attendance).toEqual([]);
    expect(addLog).not.toHaveBeenCalled();
  });

  it('a server-side duplicate (409 ATTENDANCE_EXISTS) shows "already recorded", no success, nothing added', async () => {
    pgCheckInAttendance.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'ATTENDANCE_EXISTS' }));
    renderScanner();
    scan('C001');

    expect(await screen.findByText(/تم تسجيله مسبقاً اليوم/)).toBeInTheDocument();
    expect(screen.queryByText(/تم تسجيل الحضور/)).not.toBeInTheDocument();
    expect(useAppStore.getState().attendance).toEqual([]);
  });

  it('an existing record found by the pre-check never reaches the check-in API (existing duplicate behavior kept)', async () => {
    pgGetAttendance.mockResolvedValue([{ id: 'a1', studentId: 's1', date: today, status: 'present' }]);
    renderScanner();
    scan('C001');

    expect(await screen.findByText(/تم تسجيله مسبقاً اليوم/)).toBeInTheDocument();
    expect(pgCheckInAttendance).not.toHaveBeenCalled();
  });

  it('a student with no group is rejected clearly and nothing is sent or stored', async () => {
    renderScanner();
    scan('C002');

    expect(await screen.findByText(/غير مسجَّل في مجموعة/)).toBeInTheDocument();
    expect(pgCheckInAttendance).not.toHaveBeenCalled();
    expect(useAppStore.getState().attendance).toEqual([]);
  });
});
