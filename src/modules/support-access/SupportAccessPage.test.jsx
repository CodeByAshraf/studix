// src/modules/support-access/SupportAccessPage.test.jsx
// Phase 4c — UI tests for the Support Access page. Mocks services/api.js exactly like
// HomeworkPage.test.jsx/ExamsPage.test.jsx (this codebase's established convention for
// server-truth write paths) — no real network calls, no real backend involved.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SupportAccessPage from './SupportAccessPage';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return {
    ...actual,
    pgGenerateSupportChallenge: vi.fn(),
    pgVerifySupportChallenge: vi.fn(),
    pgGetSupportAccessStatus: vi.fn(),
    pgRevokeSupportAccess: vi.fn(),
  };
});
import {
  pgGenerateSupportChallenge, pgVerifySupportChallenge,
  pgGetSupportAccessStatus, pgRevokeSupportAccess,
} from '../../services/api';

function loginSession(user) {
  sessionStorage.setItem('tc_session', JSON.stringify(user));
}

const ADMIN = { id: 'admin1', name: 'مدير الاختبار', role: 'admin', active: true, permissions: ['dashboard'], isAdmin: true };
const TEACHER = { id: 'u2', name: 'مستخدم عادي', role: 'teacher', active: true, permissions: ['dashboard'] };

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <SupportAccessPage />
      </ToastProvider>
    </AuthProvider>
  );
}

const INACTIVE_STATUS = { ok: true, active: false, session: null };

describe('SupportAccessPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    pgGetSupportAccessStatus.mockResolvedValue(INACTIVE_STATUS);
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('an admin can access the page', async () => {
    loginSession(ADMIN);
    renderPage();
    expect(await screen.findByText('وصول الدعم الفني')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'توليد رمز دعم جديد' })).toBeInTheDocument();
  });

  it('a non-admin sees the restricted message instead of the working page', async () => {
    loginSession(TEACHER);
    renderPage();
    expect(await screen.findByText('هذه الصفحة متاحة لمدير النظام فقط.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'توليد رمز دعم جديد' })).not.toBeInTheDocument();
  });

  it('loads and displays inactive status on mount', async () => {
    loginSession(ADMIN);
    renderPage();
    await waitFor(() => expect(pgGetSupportAccessStatus).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('لا توجد جلسة دعم فعّالة حالياً.')).toBeInTheDocument();
  });

  it('challenge generation works: displays the code, expiry countdown, copy button, and QR', async () => {
    loginSession(ADMIN);
    const expiresAt = Date.now() + 15 * 60 * 1000;
    pgGenerateSupportChallenge.mockResolvedValue({
      ok: true, challenge: 'chal_ABC123xyz', installationId: 'inst-1', expiresAt, ttlMs: 15 * 60 * 1000,
    });

    renderPage();
    await screen.findByText('وصول الدعم الفني');
    fireEvent.click(screen.getByRole('button', { name: 'توليد رمز دعم جديد' }));

    expect(await screen.findByTestId('challenge-code')).toHaveTextContent('chal_ABC123xyz');
    expect(screen.getByRole('button', { name: 'نسخ الرمز' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'رمز QR لرمز الدعم' })).toBeInTheDocument();
    expect(screen.getByText(/ينتهي خلال/)).toBeInTheDocument();
  });

  it('never invents/adds a private key or signing UI — only a code field and a submit action', async () => {
    loginSession(ADMIN);
    pgGenerateSupportChallenge.mockResolvedValue({
      ok: true, challenge: 'chal_ABC123xyz', installationId: 'inst-1', expiresAt: Date.now() + 900000, ttlMs: 900000,
    });
    renderPage();
    await screen.findByText('وصول الدعم الفني');
    fireEvent.click(screen.getByRole('button', { name: 'توليد رمز دعم جديد' }));
    await screen.findByTestId('challenge-code');

    expect(screen.queryByText(/مفتاح خاص/)).not.toBeInTheDocument();
    expect(screen.queryByText(/كلمة مرور رئيسية/)).not.toBeInTheDocument();
    expect(screen.queryByText(/private key/i)).not.toBeInTheDocument();
  });

  it('copy button copies the exact challenge code to the clipboard', async () => {
    loginSession(ADMIN);
    const writeText = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText } });
    pgGenerateSupportChallenge.mockResolvedValue({
      ok: true, challenge: 'chal_COPYME', installationId: 'inst-1', expiresAt: Date.now() + 900000, ttlMs: 900000,
    });

    renderPage();
    await screen.findByText('وصول الدعم الفني');
    fireEvent.click(screen.getByRole('button', { name: 'توليد رمز دعم جديد' }));
    await screen.findByTestId('challenge-code');

    fireEvent.click(screen.getByRole('button', { name: 'نسخ الرمز' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('chal_COPYME'));
    expect(await screen.findByText('تم النسخ ✓')).toBeInTheDocument();
  });

  it('challenge expiration is displayed and handled: the code disappears once its TTL elapses', async () => {
    // Real timers, real (short) TTL — avoids the flakiness/instability of mixing vitest's
    // fake interval timers with this component's own overlapping setInterval calls; a
    // sub-2-second real TTL lets the component's genuine 1s tick detect real expiry well
    // within the default test timeout, exercising the actual code path end-to-end.
    loginSession(ADMIN);
    pgGenerateSupportChallenge.mockResolvedValue({
      ok: true, challenge: 'chal_SHORTLIVED', installationId: 'inst-1',
      expiresAt: Date.now() + 1500, ttlMs: 1500,
    });

    renderPage();
    await screen.findByText('وصول الدعم الفني');
    fireEvent.click(screen.getByRole('button', { name: 'توليد رمز دعم جديد' }));
    await screen.findByTestId('challenge-code');

    await waitFor(() => {
      expect(screen.queryByTestId('challenge-code')).not.toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it('response verification success: grants access, refreshes status, shows the active session', async () => {
    loginSession(ADMIN);
    const expiresAt = Date.now() + 900000;
    pgGenerateSupportChallenge.mockResolvedValue({
      ok: true, challenge: 'chal_ABC', installationId: 'inst-1', expiresAt, ttlMs: 900000,
    });
    pgVerifySupportChallenge.mockResolvedValue({ ok: true, sessionId: 'sess-1', issuedAt: Date.now(), expiresAt: Date.now() + 1800000 });
    pgGetSupportAccessStatus
      .mockResolvedValueOnce(INACTIVE_STATUS) // initial load
      .mockResolvedValueOnce({ ok: true, active: true, session: { id: 'sess-1', issuedAt: Date.now(), expiresAt: Date.now() + 1800000 } });

    renderPage();
    await screen.findByText('لا توجد جلسة دعم فعّالة حالياً.');
    fireEvent.click(screen.getByRole('button', { name: 'توليد رمز دعم جديد' }));
    await screen.findByTestId('challenge-code');

    fireEvent.change(screen.getByLabelText('رمز الرد'), { target: { value: 'resp_XYZ' } });
    fireEvent.click(screen.getByRole('button', { name: 'تحقّق ومنح الوصول' }));

    await waitFor(() => expect(pgVerifySupportChallenge).toHaveBeenCalledWith('chal_ABC', 'resp_XYZ'));
    expect(await screen.findByText('جلسة دعم فعّالة الآن')).toBeInTheDocument();
    expect(screen.queryByTestId('challenge-code')).not.toBeInTheDocument();
  });

  it('invalid response shows a clear error and keeps the challenge visible for retry', async () => {
    loginSession(ADMIN);
    pgGenerateSupportChallenge.mockResolvedValue({
      ok: true, challenge: 'chal_ABC', installationId: 'inst-1', expiresAt: Date.now() + 900000, ttlMs: 900000,
    });
    pgVerifySupportChallenge.mockRejectedValue(new Error('فشل التحقق من رمز الدعم.'));

    renderPage();
    await screen.findByText('وصول الدعم الفني');
    fireEvent.click(screen.getByRole('button', { name: 'توليد رمز دعم جديد' }));
    await screen.findByTestId('challenge-code');

    fireEvent.change(screen.getByLabelText('رمز الرد'), { target: { value: 'wrong_resp' } });
    fireEvent.click(screen.getByRole('button', { name: 'تحقّق ومنح الوصول' }));

    expect(await screen.findByText('فشل التحقق من رمز الدعم.')).toBeInTheDocument();
    expect(screen.getByTestId('challenge-code')).toBeInTheDocument(); // still there for retry
  });

  it('displays an active session with its remaining time and a revoke button', async () => {
    loginSession(ADMIN);
    pgGetSupportAccessStatus.mockResolvedValue({
      ok: true, active: true, session: { id: 'sess-1', issuedAt: Date.now(), expiresAt: Date.now() + 600000 },
    });

    renderPage();
    expect(await screen.findByText('جلسة دعم فعّالة الآن')).toBeInTheDocument();
    expect(screen.getByText(/الوقت المتبقي/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إلغاء وصول الدعم' })).toBeInTheDocument();
  });

  it('session expiration handling: a locally-elapsed session triggers a silent re-sync with the server', async () => {
    // Real timers, real (short) remaining time — see the note on the challenge-expiration
    // test above for why fake interval timers are avoided here.
    loginSession(ADMIN);
    pgGetSupportAccessStatus
      .mockResolvedValueOnce({ ok: true, active: true, session: { id: 'sess-1', issuedAt: Date.now(), expiresAt: Date.now() + 1500 } })
      .mockResolvedValue(INACTIVE_STATUS);

    renderPage();
    expect(await screen.findByText('جلسة دعم فعّالة الآن')).toBeInTheDocument();

    await waitFor(() => expect(pgGetSupportAccessStatus).toHaveBeenCalledTimes(2), { timeout: 4000 });
    expect(await screen.findByText('لا توجد جلسة دعم فعّالة حالياً.')).toBeInTheDocument();
  });

  it('manual revoke: confirm modal, calls the revoke endpoint, and refreshes to inactive', async () => {
    loginSession(ADMIN);
    pgGetSupportAccessStatus
      .mockResolvedValueOnce({ ok: true, active: true, session: { id: 'sess-1', issuedAt: Date.now(), expiresAt: Date.now() + 600000 } })
      .mockResolvedValueOnce(INACTIVE_STATUS);
    pgRevokeSupportAccess.mockResolvedValue({ ok: true, revokedChallenge: null, revokedSession: true });

    renderPage();
    await screen.findByText('جلسة دعم فعّالة الآن');
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء وصول الدعم' }));

    fireEvent.click(await screen.findByRole('button', { name: 'إلغاء الوصول' }));

    await waitFor(() => expect(pgRevokeSupportAccess).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('لا توجد جلسة دعم فعّالة حالياً.')).toBeInTheDocument();
  });

  it('backend 401/403 on status load shows a clear error without crashing the page', async () => {
    loginSession(ADMIN);
    pgGetSupportAccessStatus.mockRejectedValue(new Error('يجب تسجيل الدخول للوصول لهذا المسار.'));

    renderPage();
    expect(await screen.findByText('يجب تسجيل الدخول للوصول لهذا المسار.')).toBeInTheDocument();
    // page shell itself still rendered — did not crash
    expect(screen.getByText('وصول الدعم الفني')).toBeInTheDocument();
  });

  it('backend error on challenge generation (e.g. no public key configured / 403) is surfaced clearly', async () => {
    loginSession(ADMIN);
    pgGenerateSupportChallenge.mockRejectedValue(new Error('دعم الوصول غير مُهيَّأ على هذا التثبيت.'));

    renderPage();
    await screen.findByText('وصول الدعم الفني');
    fireEvent.click(screen.getByRole('button', { name: 'توليد رمز دعم جديد' }));

    expect(await screen.findByText('دعم الوصول غير مُهيَّأ على هذا التثبيت.')).toBeInTheDocument();
    expect(screen.queryByTestId('challenge-code')).not.toBeInTheDocument();
  });

  it('never persists the challenge code or the response code to localStorage/sessionStorage', async () => {
    loginSession(ADMIN);
    pgGenerateSupportChallenge.mockResolvedValue({
      ok: true, challenge: 'chal_SECRET_LOOKING_VALUE', installationId: 'inst-1',
      expiresAt: Date.now() + 900000, ttlMs: 900000,
    });

    renderPage();
    await screen.findByText('وصول الدعم الفني');
    fireEvent.click(screen.getByRole('button', { name: 'توليد رمز دعم جديد' }));
    await screen.findByTestId('challenge-code');

    fireEvent.change(screen.getByLabelText('رمز الرد'), { target: { value: 'resp_ALSO_SECRET_LOOKING' } });

    const allStoredValues = [
      ...Object.keys(localStorage).map((k) => localStorage.getItem(k)),
      ...Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k)),
    ].join('\n');

    expect(allStoredValues).not.toContain('chal_SECRET_LOOKING_VALUE');
    expect(allStoredValues).not.toContain('resp_ALSO_SECRET_LOOKING');
  });
});
