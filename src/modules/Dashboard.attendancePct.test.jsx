// src/modules/Dashboard.attendancePct.test.jsx
// Pre-installer defect audit (F-Dash1): stats.attPct (the "متوسط آخر 50 سجل" KPI) reads the
// full `attendance` selector and must reflect the 50 records with the most recent `date`,
// not merely the last 50 elements in array/insertion order — saveAttendanceSession always
// appends to the end of the store array regardless of the session date it records, so an
// attendance record entered retroactively for an old session would otherwise land at the
// end of the array and skew a raw `.slice(-50)`. Dashboard.jsx now sorts by `date` (desc)
// before slicing to 50 (see stats useMemo). This test seeds attendance with exactly that
// out-of-order-insertion shape and asserts the KPI reflects the chronologically-latest 50
// records, not the last-50-by-insertion-order.
//
// students/visible-attendance are left empty so StudentRow's own per-student heat percentages
// (a separate, already-covered feature — see Dashboard.attendanceHeat.test.jsx) never render
// and cannot collide with the attPct assertion below.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dashboard from './Dashboard';
import { useAppStore } from '../store/app.store';
import { UIProvider } from '../store/ui.context';
import { ToastProvider } from '../components/Toast';

function renderDashboard() {
  return render(
    <ToastProvider>
      <UIProvider>
        <Dashboard />
      </UIProvider>
    </ToastProvider>
  );
}

function buildAttendance() {
  // 50 recent, ordered-first "absent" records (dates 2026-02-01..2026-03-22), then ONE
  // "present" record with an old date (2020-01-01) appended LAST — simulating a session
  // recorded retroactively after the fact. Array length is 51.
  const recent = Array.from({ length: 50 }, (_, i) => ({
    id: `recent-${i}`,
    studentId: 's1',
    groupId: 'g1',
    date: `2026-02-${String((i % 27) + 1).padStart(2, '0')}`,
    status: 'absent',
  }));
  const retroactiveOld = {
    id: 'old-retroactive',
    studentId: 's1',
    groupId: 'g1',
    date: '2020-01-01',
    status: 'present',
  };
  return [...recent, retroactiveOld];
}

describe('Dashboard — attPct KPI reflects the 50 chronologically-latest attendance records (F-Dash1)', () => {
  it('excludes an old record appended last and keeps the 50 recent ones, even though raw slice(-50) would not', async () => {
    useAppStore.setState({
      students: [], groups: [], treasuryTxn: [],
      attendance: buildAttendance(),
      activityLogs: [], communications: [], commTasks: [],
    });

    renderDashboard();

    // Correct (date-sorted) behavior: the 50 most recent-by-date records are all the
    // "absent" ones; the old retroactive "present" record is excluded -> 0% present.
    // A buggy raw `.slice(-50)` on insertion order would instead drop the very first
    // inserted "absent" record and keep the old "present" one, yielding 2% (1/50) present.
    expect(await screen.findByText('0%')).toBeInTheDocument();
    expect(screen.queryByText('2%')).not.toBeInTheDocument();
  });
});
