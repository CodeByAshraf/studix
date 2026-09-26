// src/components/ErrorBoundary.test.jsx
// Pre-Installer Audit D2 — logError() used `require('../store/app.store')` inside a
// Vite/ESM browser bundle. require() doesn't exist there, so it threw a ReferenceError on
// every single crash, silently swallowed by the surrounding try/catch — activity-log crash
// reporting never actually ran, though localStorage crash logging (unaffected) made it look
// like the whole thing worked. This test proves the fixed dynamic-import path really calls
// the store's addLog on a caught crash, and that the boundary's own fallback UI still
// renders regardless (best-effort — a store failure must never break the boundary itself).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ErrorBoundary, { SectionBoundary } from './ErrorBoundary';

const addLogMock = vi.fn(() => Promise.resolve());

vi.mock('../store/app.store', () => ({
  useAppStore: { getState: () => ({ addLog: addLogMock }) },
}));

function Boom() {
  throw new Error('اختبار انهيار متعمّد');
}

beforeEach(() => {
  addLogMock.mockClear();
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('ErrorBoundary — crash logging (D2 fix)', () => {
  it('shows the page-level fallback and calls the activity-log store via a real ESM import, not require()', async () => {
    render(
      <ErrorBoundary label="اختبار">
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText(/حدث خطأ في اختبار/)).toBeInTheDocument();

    await waitFor(() => expect(addLogMock).toHaveBeenCalledTimes(1));
    expect(addLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'error',
      module: 'اختبار',
    }));

    // localStorage crash logging still works unchanged.
    const stored = JSON.parse(localStorage.getItem('tc_error_log') || '[]');
    expect(stored.length).toBe(1);
    expect(stored[0].msg).toContain('اختبار انهيار متعمّد');
  });

  it('section-level boundary still renders its fallback even though the store write is best-effort/async', async () => {
    render(
      <SectionBoundary label="قسم">
        <Boom />
      </SectionBoundary>
    );
    expect(screen.getByText(/تعذّر تحميل قسم/)).toBeInTheDocument();
    await waitFor(() => expect(addLogMock).toHaveBeenCalledTimes(1));
  });
});
