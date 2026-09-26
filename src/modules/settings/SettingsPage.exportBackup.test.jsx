// src/modules/settings/SettingsPage.exportBackup.test.jsx
// Scalability Architecture Phase 4 — exportBackup() became async (fetches payments fresh
// from the server instead of reading the store). This proves the real "⬇ تصدير البيانات
// (JSON)" button in Settings (P1-1: relabeled — it is a partial data export, not a
// restorable backup) still works end-to-end with the new async implementation:
// it awaits the export, disables itself while in flight, and surfaces a toast instead of
// crashing if the fetch fails — none of which existed as a concern with the old synchronous
// version.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SettingsPage from './SettingsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { UIProvider } from '../../store/ui.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetPayments: vi.fn(), pgGetGrades: vi.fn(), pgGetHomeworks: vi.fn(), pgGetHwSubmissions: vi.fn() };
});
import { pgGetPayments, pgGetGrades, pgGetHomeworks, pgGetHwSubmissions } from '../../services/api';

function renderPage() {
  return render(
    <AuthProvider>
      <UIProvider>
        <ToastProvider>
          <SettingsPage />
        </ToastProvider>
      </UIProvider>
    </AuthProvider>
  );
}

function seedStore() {
  useAppStore.setState({
    centerProfile: { name: '', slogan: '', address: '', phone1: '', phone2: '', logoUrl: '' },
    students: [], groups: [], payments: [], attendance: [], exams: [], grades: [],
    homeworks: [], hwSubmissions: [],
  });
}

let blobParts;
const RealBlob = globalThis.Blob;
beforeEach(() => {
  vi.clearAllMocks();
  seedStore();
  // Grades + Homework cutover (Phase 3): exportBackup also fetches these three fresh.
  pgGetGrades.mockResolvedValue([]); pgGetHomeworks.mockResolvedValue([]); pgGetHwSubmissions.mockResolvedValue([]);
  blobParts = [];
  // نفس تقنية app.store.backup.test.js — Blob مموَّه لالتقاط النص الخام مباشرة، أوثق من
  // محاولة قراءته لاحقاً عبر .text()/Response() في بيئة jsdom هنا.
  vi.stubGlobal('Blob', vi.fn().mockImplementation((parts, opts) => {
    blobParts.push(parts[0]);
    return new RealBlob(parts, opts);
  }));
  // jsdom لا يُطبِّق createObjectURL/revokeObjectURL إطلاقاً — تُعرَّفان مباشرة.
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  // handleTestConnection (admin-only, on mount) يستدعي /health — نتيجة صحية بسيطة تكفي
  // كي لا يفشل mount الصفحة نفسه بغضّ النظر عن دور المستخدم الحالي في هذا الاختبار.
  const realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn((url, opts = {}) => {
    if (String(url).includes('/health')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, database: { connected: true, tableCount: 27, error: null } }) });
    }
    if (String(url).includes('/api/backup-status')) {
      return Promise.resolve({ ok: false, status: 403, json: async () => ({ ok: false, error: 'forbidden' }) });
    }
    if (String(url).includes('/api/activityLogs')) {
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ ok: true, data: { id: 'log1' } }) });
    }
    return realFetch ? realFetch(url, opts) : Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
});

describe('SettingsPage — JSON data export is not presented as a backup (P1-1)', () => {
  it('the button is labeled as a data export and the card says it is not a complete, restorable backup', () => {
    renderPage();
    expect(screen.getByText('⬇ تصدير البيانات (JSON)')).toBeInTheDocument();
    expect(screen.queryByText('⬇ تصدير نسخة احتياطية')).not.toBeInTheDocument();
    expect(screen.getByText('هذا ليس نسخة احتياطية كاملة ولا يمكن استعادة النظام منه')).toBeInTheDocument();
  });

  it('the downloaded file is named as a data export, not a backup', async () => {
    pgGetPayments.mockResolvedValue([]);
    let downloadName = null;
    HTMLAnchorElement.prototype.click.mockImplementation(function click() { downloadName = this.download; });
    renderPage();
    fireEvent.click(screen.getByText('⬇ تصدير البيانات (JSON)'));
    await waitFor(() => expect(downloadName).not.toBeNull());
    expect(downloadName).toMatch(/^studix-data-export-\d+\.json$/);
  });
});

describe('SettingsPage — Export Backup (async, fetches payments fresh)', () => {
  it('a successful export downloads a file containing the fresh API payments and re-enables the button', async () => {
    const payments = [{ id: 'p1', studentId: 's1', amount: 300, status: 'paid' }];
    pgGetPayments.mockResolvedValue(payments);

    renderPage();
    const btn = screen.getByText('⬇ تصدير البيانات (JSON)');
    fireEvent.click(btn);

    await waitFor(() => expect(pgGetPayments).toHaveBeenCalledWith({}));
    await waitFor(() => expect(screen.getByText('⬇ تصدير البيانات (JSON)')).not.toBeDisabled());

    expect(blobParts).toHaveLength(1);
    const exported = JSON.parse(blobParts[0]);
    expect(exported.payments).toEqual(payments);
  });

  it('the button disables and shows a busy label while the export is in flight', async () => {
    let resolveFetch;
    pgGetPayments.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    renderPage();
    fireEvent.click(screen.getByText('⬇ تصدير البيانات (JSON)'));

    expect(await screen.findByText('...جارِ التصدير')).toBeInTheDocument();
    expect(screen.getByText('...جارِ التصدير')).toBeDisabled();

    resolveFetch([]);
    await waitFor(() => expect(screen.getByText('⬇ تصدير البيانات (JSON)')).toBeInTheDocument());
  });

  it('export failure shows an error toast, downloads nothing, and leaves the button usable again', async () => {
    pgGetPayments.mockRejectedValue(new Error('تعذّر الاتصال بالخادم'));

    renderPage();
    fireEvent.click(screen.getByText('⬇ تصدير البيانات (JSON)'));

    expect(await screen.findByText('تعذّر الاتصال بالخادم')).toBeInTheDocument(); // toast
    expect(blobParts).toHaveLength(0);
    await waitFor(() => expect(screen.getByText('⬇ تصدير البيانات (JSON)')).not.toBeDisabled());
  });
});
