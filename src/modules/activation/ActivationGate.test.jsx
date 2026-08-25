// src/modules/activation/ActivationGate.test.jsx
// Phase 5c — UI tests for the activation gate. Mocks services/api.js exactly like
// SupportAccessPage.test.jsx/HomeworkPage.test.jsx (this codebase's established convention)
// — no real network calls, no real backend involved.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import ActivationGate from './ActivationGate';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return {
    ...actual,
    pgGetLicenseStatus: vi.fn(),
    pgProbeActivation: vi.fn(),
    pgRequestLicenseActivationCode: vi.fn(),
    pgActivateLicense: vi.fn(),
  };
});
import {
  pgGetLicenseStatus, pgProbeActivation, pgRequestLicenseActivationCode, pgActivateLicense,
} from '../../services/api';

function loginSession(user) {
  sessionStorage.setItem('tc_session', JSON.stringify(user));
}

const ADMIN = { id: 'admin1', name: 'مدير الاختبار', role: 'admin', active: true, permissions: ['dashboard'], isAdmin: true };
const TEACHER = { id: 'u2', name: 'مستخدم عادي', role: 'teacher', active: true, permissions: ['dashboard'] };

function renderGate({ initialPath = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <ToastProvider>
          <ActivationGate>
            <div>APP CONTENT</div>
          </ActivationGate>
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

const ACTIVATED_STATUS = { ok: true, activated: true, reason: null, licenseId: 'lic_1', product: 'studix', expiresAt: null, features: null };
const NOT_ACTIVATED_STATUS = { ok: true, activated: false, reason: 'not_activated' };
const EXPIRED_STATUS = { ok: true, activated: false, reason: 'expired' };
const CLOCK_ROLLBACK_STATUS = { ok: true, activated: false, reason: 'clock_rollback_detected' };

describe('ActivationGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('does not gate the login screen — passes children through when not logged in', async () => {
    renderGate();
    expect(await screen.findByText('APP CONTENT')).toBeInTheDocument();
    expect(pgGetLicenseStatus).not.toHaveBeenCalled();
    expect(pgProbeActivation).not.toHaveBeenCalled();
  });

  it('shows a checking/loading state while the activation check is in flight', async () => {
    loginSession(ADMIN);
    let resolveStatus;
    pgGetLicenseStatus.mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve; }));
    renderGate();
    expect(await screen.findByText('جاري التحقّق من حالة التفعيل...')).toBeInTheDocument();
    resolveStatus(ACTIVATED_STATUS);
    await screen.findByText('APP CONTENT');
  });

  describe('unactivated installation shows the activation gate', () => {
    it('admin: shows the interactive activation gate with the not_activated reason', async () => {
      loginSession(ADMIN);
      pgGetLicenseStatus.mockResolvedValue(NOT_ACTIVATED_STATUS);
      renderGate();
      expect(await screen.findByText('تفعيل Studix')).toBeInTheDocument();
      expect(screen.getByText('لم يُفعَّل هذا التثبيت بعد.')).toBeInTheDocument();
      expect(screen.queryByText('APP CONTENT')).not.toBeInTheDocument();
    });

    it('expired license: shows the activation gate with the expired reason', async () => {
      loginSession(ADMIN);
      pgGetLicenseStatus.mockResolvedValue(EXPIRED_STATUS);
      renderGate();
      expect(await screen.findByText('تفعيل Studix')).toBeInTheDocument();
      expect(screen.getByText(/انتهت صلاحية الترخيص الحالي/)).toBeInTheDocument();
    });

    it('clock rollback detected: shows the activation gate with the clock_rollback_detected reason (Phase 5e)', async () => {
      loginSession(ADMIN);
      pgGetLicenseStatus.mockResolvedValue(CLOCK_ROLLBACK_STATUS);
      renderGate();
      expect(await screen.findByText('تفعيل Studix')).toBeInTheDocument();
      expect(screen.getByText(/تراجع واضح في ساعة النظام/)).toBeInTheDocument();
    });

    it('non-admin: shows the restricted message, not the interactive form', async () => {
      loginSession(TEACHER);
      pgProbeActivation.mockResolvedValue({ blocked: true });
      renderGate();
      expect(await screen.findByText('يتطلّب Studix تفعيلاً')).toBeInTheDocument();
      expect(screen.getByText(/يُرجى التواصل مع مدير النظام/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'الحصول على رمز التفعيل' })).not.toBeInTheDocument();
      expect(pgGetLicenseStatus).not.toHaveBeenCalled(); // never calls the admin-only endpoint for a non-admin
    });
  });

  describe('active license shows the normal application', () => {
    it('admin, activated:true', async () => {
      loginSession(ADMIN);
      pgGetLicenseStatus.mockResolvedValue(ACTIVATED_STATUS);
      renderGate();
      expect(await screen.findByText('APP CONTENT')).toBeInTheDocument();
    });

    it('non-admin, probe blocked:false', async () => {
      loginSession(TEACHER);
      pgProbeActivation.mockResolvedValue({ blocked: false });
      renderGate();
      expect(await screen.findByText('APP CONTENT')).toBeInTheDocument();
    });
  });

  describe('temporary API/backend failure', () => {
    it('admin: pgGetLicenseStatus throwing shows the unreachable state with a retry button', async () => {
      loginSession(ADMIN);
      pgGetLicenseStatus.mockRejectedValue(new Error('Failed to fetch'));
      renderGate();
      expect(await screen.findByText('تعذّر الاتصال بالخادم')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeInTheDocument();
    });

    it('non-admin: pgProbeActivation reporting blocked:null (unreachable) shows the unreachable state', async () => {
      loginSession(TEACHER);
      pgProbeActivation.mockResolvedValue({ blocked: null });
      renderGate();
      expect(await screen.findByText('تعذّر الاتصال بالخادم')).toBeInTheDocument();
    });

    it('retry button re-runs the check and can recover to the normal app', async () => {
      loginSession(ADMIN);
      pgGetLicenseStatus.mockRejectedValueOnce(new Error('Failed to fetch'));
      pgGetLicenseStatus.mockResolvedValueOnce(ACTIVATED_STATUS);
      renderGate();
      fireEvent.click(await screen.findByRole('button', { name: 'إعادة المحاولة' }));
      expect(await screen.findByText('APP CONTENT')).toBeInTheDocument();
    });
  });

  describe('admin activation controls', () => {
    it('displays the activation request code after generating it', async () => {
      loginSession(ADMIN);
      pgGetLicenseStatus.mockResolvedValue(NOT_ACTIVATED_STATUS);
      pgRequestLicenseActivationCode.mockResolvedValue({ ok: true, code: 'req_ABC123', installationId: 'inst-1', product: 'studix' });

      renderGate();
      fireEvent.click(await screen.findByRole('button', { name: 'الحصول على رمز التفعيل' }));

      expect(await screen.findByTestId('activation-request-code')).toHaveTextContent('req_ABC123');
    });

    it('artifact submission calls pgActivateLicense with the trimmed textarea value', async () => {
      loginSession(ADMIN);
      pgGetLicenseStatus.mockResolvedValue(NOT_ACTIVATED_STATUS);
      pgActivateLicense.mockResolvedValue({ ok: true, licenseId: 'lic_1', product: 'studix', expiresAt: null, features: null });

      renderGate();
      await screen.findByText('تفعيل Studix');
      fireEvent.change(screen.getByLabelText('شهادة الترخيص'), { target: { value: '  chal.sig  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'تفعيل' }));

      await waitFor(() => expect(pgActivateLicense).toHaveBeenCalledWith('chal.sig'));
    });

    it('successful activation re-checks status and unlocks the application', async () => {
      loginSession(ADMIN);
      pgGetLicenseStatus
        .mockResolvedValueOnce(NOT_ACTIVATED_STATUS) // initial check
        .mockResolvedValueOnce(ACTIVATED_STATUS); // re-check after activation
      pgActivateLicense.mockResolvedValue({ ok: true, licenseId: 'lic_1', product: 'studix', expiresAt: null, features: null });

      renderGate();
      await screen.findByText('تفعيل Studix');
      fireEvent.change(screen.getByLabelText('شهادة الترخيص'), { target: { value: 'valid.artifact' } });
      fireEvent.click(screen.getByRole('button', { name: 'تفعيل' }));

      expect(await screen.findByText('APP CONTENT')).toBeInTheDocument();
      expect(pgGetLicenseStatus).toHaveBeenCalledTimes(2);
    });

    it('a rejected artifact displays a clear error and keeps the gate up for retry', async () => {
      loginSession(ADMIN);
      pgGetLicenseStatus.mockResolvedValue(NOT_ACTIVATED_STATUS);
      pgActivateLicense.mockRejectedValue(new Error('فشل التحقق من الترخيص.'));

      renderGate();
      await screen.findByText('تفعيل Studix');
      fireEvent.change(screen.getByLabelText('شهادة الترخيص'), { target: { value: 'bad.artifact' } });
      fireEvent.click(screen.getByRole('button', { name: 'تفعيل' }));

      expect(await screen.findByText('فشل التحقق من الترخيص.')).toBeInTheDocument();
      expect(screen.getByText('تفعيل Studix')).toBeInTheDocument(); // still gated
    });

    it('malformed/empty input never reaches the API — the activate button is disabled with no input', async () => {
      loginSession(ADMIN);
      pgGetLicenseStatus.mockResolvedValue(NOT_ACTIVATED_STATUS);
      renderGate();
      await screen.findByText('تفعيل Studix');
      expect(screen.getByRole('button', { name: 'تفعيل' })).toBeDisabled();
      expect(pgActivateLicense).not.toHaveBeenCalled();
    });

    it('whitespace-only input is treated the same as empty — the button stays disabled, no API call possible', async () => {
      loginSession(ADMIN);
      pgGetLicenseStatus.mockResolvedValue(NOT_ACTIVATED_STATUS);
      renderGate();
      await screen.findByText('تفعيل Studix');
      const textarea = screen.getByLabelText('شهادة الترخيص');
      fireEvent.change(textarea, { target: { value: '   ' } });
      expect(screen.getByRole('button', { name: 'تفعيل' })).toBeDisabled();
      expect(pgActivateLicense).not.toHaveBeenCalled();
    });
  });

  it('refresh/reload behavior: an already-logged-in session (restored from sessionStorage) triggers the check automatically on mount', async () => {
    loginSession(ADMIN); // simulates a session already present before this component ever mounted
    pgGetLicenseStatus.mockResolvedValue(ACTIVATED_STATUS);
    renderGate();
    await waitFor(() => expect(pgGetLicenseStatus).toHaveBeenCalledTimes(1));
  });

  it('never persists the activation request code or the submitted artifact to localStorage/sessionStorage', async () => {
    loginSession(ADMIN);
    pgGetLicenseStatus.mockResolvedValue(NOT_ACTIVATED_STATUS);
    pgRequestLicenseActivationCode.mockResolvedValue({ ok: true, code: 'req_SECRET_LOOKING', installationId: 'inst-1', product: 'studix' });

    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'الحصول على رمز التفعيل' }));
    await screen.findByTestId('activation-request-code');
    fireEvent.change(screen.getByLabelText('شهادة الترخيص'), { target: { value: 'artifact_ALSO_SECRET_LOOKING' } });

    const allStoredValues = [
      ...Object.keys(localStorage).map((k) => localStorage.getItem(k)),
      ...Object.keys(sessionStorage).filter((k) => k !== 'tc_session').map((k) => sessionStorage.getItem(k)),
    ].join('\n');

    expect(allStoredValues).not.toContain('req_SECRET_LOOKING');
    expect(allStoredValues).not.toContain('artifact_ALSO_SECRET_LOOKING');
  });

  it('never mentions private-key/master-secret concepts anywhere in the gate UI', async () => {
    loginSession(ADMIN);
    pgGetLicenseStatus.mockResolvedValue(NOT_ACTIVATED_STATUS);
    pgRequestLicenseActivationCode.mockResolvedValue({ ok: true, code: 'req_1', installationId: 'inst-1', product: 'studix' });

    renderGate();
    await screen.findByText('تفعيل Studix');
    fireEvent.click(screen.getByRole('button', { name: 'الحصول على رمز التفعيل' }));
    await screen.findByTestId('activation-request-code');

    expect(screen.queryByText(/مفتاح خاص/)).not.toBeInTheDocument();
    expect(screen.queryByText(/كلمة مرور رئيسية/)).not.toBeInTheDocument();
    expect(screen.queryByText(/private key/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/master (key|secret|password)/i)).not.toBeInTheDocument();
  });

  it('Support Access remains reachable: the gate never blocks the /support-access path', async () => {
    loginSession(ADMIN);
    pgGetLicenseStatus.mockResolvedValue(NOT_ACTIVATED_STATUS); // installation is unactivated
    renderGate({ initialPath: '/support-access' });
    expect(await screen.findByText('APP CONTENT')).toBeInTheDocument();
    expect(screen.queryByText('تفعيل Studix')).not.toBeInTheDocument();
  });

  it('the admin gate screen links to /support-access as the repair path', async () => {
    loginSession(ADMIN);
    pgGetLicenseStatus.mockResolvedValue(NOT_ACTIVATED_STATUS);
    renderGate();
    const link = await screen.findByRole('link', { name: 'وصول الدعم الفني' });
    expect(link).toHaveAttribute('href', '/support-access');
  });
});
