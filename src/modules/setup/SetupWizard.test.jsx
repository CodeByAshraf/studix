// src/modules/setup/SetupWizard.test.jsx
// INSTALL-04 — UI tests for the first-run setup wizard. Mocks the global fetch directly (this
// component intentionally does not go through services/api.js's exported pg* functions — see
// the component's own header comment for why) — no real network calls, no real backend.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SetupWizard from './SetupWizard';
import { AuthProvider } from '../../store/auth.context';

function jsonResponse(body, { ok = true, status = ok ? 200 : 400 } = {}) {
  return Promise.resolve({ ok, status, json: async () => body });
}

function mockFetch({ statusOpen = true, statusFails = false, postResult = { ok: true } } = {}) {
  return vi.fn((url, options = {}) => {
    const u = String(url);
    if (u.includes('/api/setup/status')) {
      if (statusFails) return Promise.reject(new Error('network down'));
      return jsonResponse({ ok: true, open: statusOpen });
    }
    if (u.includes('/api/setup') && options.method === 'POST') {
      if (postResult.ok) return jsonResponse({ ok: true, user: { id: 'admin', name: 'Admin', role: 'admin', active: true, permissions: ['dashboard'] } }, { status: 201 });
      return jsonResponse({ ok: false, error: postResult.error || 'فشل' }, { ok: false, status: postResult.status || 400 });
    }
    if (u.includes('/api/session') && options.method === 'POST') {
      return jsonResponse({ ok: true, user: { id: 'admin', name: 'Admin', role: 'admin', active: true, permissions: ['dashboard'] } });
    }
    // كل شيء آخر (loadFromPostgres وغيره بعد تسجيل الدخول) — فشل صامت غير هدّام، best-effort
    return jsonResponse({ ok: false }, { ok: false, status: 404 });
  });
}

function renderWizard({ initialPath = '/setup', fetchImpl } = {}) {
  global.fetch = fetchImpl || mockFetch();
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/setup" element={<SetupWizard />} />
          <Route path="/login" element={<div>LOGIN SCREEN</div>} />
          <Route path="/" element={<div>APP HOME</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('SetupWizard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it('is publicly reachable and renders the form when setup is open', async () => {
    renderWizard();
    expect(await screen.findByText('إنشاء حساب المدير الأول')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('مدير النظام')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('admin')).toBeInTheDocument();
  });

  it('shows a loading state before the status check resolves', async () => {
    let resolveStatus;
    const fetchImpl = vi.fn((url) => {
      if (String(url).includes('/api/setup/status')) {
        return new Promise((resolve) => { resolveStatus = resolve; });
      }
      return jsonResponse({ ok: false }, { ok: false, status: 404 });
    });
    renderWizard({ fetchImpl });
    expect(screen.getByText('جاري التحقّق من حالة الإعداد...')).toBeInTheDocument();
    resolveStatus({ ok: true, json: async () => ({ ok: true, open: true }) });
    await screen.findByText('إنشاء حساب المدير الأول');
  });

  it('closed setup redirects to /login without rendering the form', async () => {
    renderWizard({ fetchImpl: mockFetch({ statusOpen: false }) });
    expect(await screen.findByText('LOGIN SCREEN')).toBeInTheDocument();
    expect(screen.queryByText('إنشاء حساب المدير الأول')).not.toBeInTheDocument();
  });

  it('an unreachable status check shows a retry option, not the form', async () => {
    renderWizard({ fetchImpl: mockFetch({ statusFails: true }) });
    expect(await screen.findByText('تعذّر الاتصال بالخادم')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeInTheDocument();
    expect(screen.queryByText('إنشاء حساب المدير الأول')).not.toBeInTheDocument();
  });

  it('client-side validation: rejects submission with empty required fields', async () => {
    renderWizard();
    await screen.findByText('إنشاء حساب المدير الأول');
    fireEvent.click(screen.getByRole('button', { name: /إنشاء الحساب والمتابعة/ }));
    expect(await screen.findByText(/يرجى تعبئة جميع الحقول المطلوبة/)).toBeInTheDocument();
  });

  it('client-side validation: rejects a password shorter than the minimum', async () => {
    renderWizard();
    await screen.findByText('إنشاء حساب المدير الأول');
    fireEvent.change(screen.getByPlaceholderText('مدير النظام'), { target: { value: 'Admin' } });
    fireEvent.change(screen.getByPlaceholderText('admin'), { target: { value: 'admin' } });
    const [pw, confirm] = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(pw, { target: { value: 'short1' } });
    fireEvent.change(confirm, { target: { value: 'short1' } });
    fireEvent.click(screen.getByRole('button', { name: /إنشاء الحساب والمتابعة/ }));
    expect(await screen.findByText(/8 أحرف على الأقل/)).toBeInTheDocument();
  });

  it('client-side validation: rejects mismatched password confirmation', async () => {
    renderWizard();
    await screen.findByText('إنشاء حساب المدير الأول');
    fireEvent.change(screen.getByPlaceholderText('مدير النظام'), { target: { value: 'Admin' } });
    fireEvent.change(screen.getByPlaceholderText('admin'), { target: { value: 'admin' } });
    const [pw, confirm] = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(pw, { target: { value: 'longenough1' } });
    fireEvent.change(confirm, { target: { value: 'different1' } });
    fireEvent.click(screen.getByRole('button', { name: /إنشاء الحساب والمتابعة/ }));
    expect(await screen.findByText(/كلمتا المرور غير متطابقتين/)).toBeInTheDocument();
  });

  it('password visibility toggle switches the input type', async () => {
    renderWizard();
    await screen.findByText('إنشاء حساب المدير الأول');
    const [pw] = screen.getAllByPlaceholderText('••••••••');
    expect(pw).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getAllByRole('button', { name: 'إظهار كلمة المرور' })[0]);
    expect(pw).toHaveAttribute('type', 'text');
  });

  it('shows the loading state and disables submit while submitting', async () => {
    let resolvePost;
    const fetchImpl = vi.fn((url, options = {}) => {
      const u = String(url);
      if (u.includes('/api/setup/status')) return jsonResponse({ ok: true, open: true });
      if (u.includes('/api/setup') && options.method === 'POST') {
        return new Promise((resolve) => { resolvePost = resolve; });
      }
      if (u.includes('/api/session') && options.method === 'POST') {
        return jsonResponse({ ok: true, user: { id: 'admin', name: 'Admin', role: 'admin', active: true, permissions: ['dashboard'] } });
      }
      return jsonResponse({ ok: false }, { ok: false, status: 404 });
    });
    renderWizard({ fetchImpl });
    await screen.findByText('إنشاء حساب المدير الأول');
    fireEvent.change(screen.getByPlaceholderText('مدير النظام'), { target: { value: 'Admin' } });
    fireEvent.change(screen.getByPlaceholderText('admin'), { target: { value: 'admin' } });
    const [pw, confirm] = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(pw, { target: { value: 'longenough1' } });
    fireEvent.change(confirm, { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /إنشاء الحساب والمتابعة/ }));

    expect(await screen.findByText('جارٍ الإنشاء...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /جارٍ الإنشاء/ })).toBeDisabled();

    resolvePost({ ok: true, status: 201, json: async () => ({ ok: true, user: { id: 'admin', name: 'Admin', role: 'admin', active: true, permissions: ['dashboard'] } }) });
    await screen.findByText('APP HOME');
  });

  it('successful creation transitions into the normal authenticated app (auto-login)', async () => {
    renderWizard();
    await screen.findByText('إنشاء حساب المدير الأول');
    fireEvent.change(screen.getByPlaceholderText('مدير النظام'), { target: { value: 'مدير النظام' } });
    fireEvent.change(screen.getByPlaceholderText('admin'), { target: { value: 'admin' } });
    const [pw, confirm] = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(pw, { target: { value: 'correct-horse-battery-staple' } });
    fireEvent.change(confirm, { target: { value: 'correct-horse-battery-staple' } });
    fireEvent.click(screen.getByRole('button', { name: /إنشاء الحساب والمتابعة/ }));

    expect(await screen.findByText('APP HOME')).toBeInTheDocument();
  });

  it('a server-side rejection (e.g. race lost, already closed) shows the returned error, stays on the form', async () => {
    renderWizard({ fetchImpl: mockFetch({ postResult: { ok: false, status: 404, error: 'الإعداد الأولي غير متاح.' } }) });
    await screen.findByText('إنشاء حساب المدير الأول');
    fireEvent.change(screen.getByPlaceholderText('مدير النظام'), { target: { value: 'Admin' } });
    fireEvent.change(screen.getByPlaceholderText('admin'), { target: { value: 'admin' } });
    const [pw, confirm] = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(pw, { target: { value: 'longenough1' } });
    fireEvent.change(confirm, { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /إنشاء الحساب والمتابعة/ }));

    expect(await screen.findByText(/الإعداد الأولي غير متاح/)).toBeInTheDocument();
    expect(screen.getByText('إنشاء حساب المدير الأول')).toBeInTheDocument(); // still on the form
  });

  it('never displays the password value anywhere as plain visible confirmation text', async () => {
    renderWizard();
    await screen.findByText('إنشاء حساب المدير الأول');
    fireEvent.change(screen.getByPlaceholderText('مدير النظام'), { target: { value: 'Admin' } });
    fireEvent.change(screen.getByPlaceholderText('admin'), { target: { value: 'admin' } });
    const [pw, confirm] = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(pw, { target: { value: 'super-secret-value-123' } });
    fireEvent.change(confirm, { target: { value: 'super-secret-value-123' } });
    expect(screen.queryByText('super-secret-value-123')).not.toBeInTheDocument();
  });
});
