// src/modules/admissions/AdmissionsPage.groups.test.jsx
// M-03 — Admissions must never show fictional groups. The only real group relationship is
// admissions.group_id (confirmedGroupId on the client), assigned by the existing confirm-with-
// group flow. So:
//   * the reservation form has no group selector and sends no group value;
//   * the page filter lists the real groups (GET /api/groups/options, already loaded by the page)
//     and filters by confirmedGroupId;
//   * cards / details show the real group name resolved from confirmedGroupId, with the existing
//     fallback ("—" / hidden section) when there is none.
// fetch is mocked directly (not api.js), same technique as AdmissionsPage.activation.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdmissionsPage from './AdmissionsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

const FAKE_GROUP_NAMES = /مجموعة السبت والثلاثاء|مجموعة الأحد والأربعاء|مجموعة الجمعة/;
const GROUPS = [
  { id: 'g1', name: 'مجموعة أ', grade: 'الصف الأول الثانوي' },
  { id: 'g2', name: 'مجموعة ب', grade: 'الصف الأول الثانوي' },
];

let fetchMock;

function okJson(data, status = 200) {
  return { ok: true, status, json: async () => ({ ok: true, data }) };
}

const base = {
  phone: '01012345678', parentPhone: '01198765432', parentName: '', grade: 'الصف الأول الثانوي',
  school: '', notes: '', source: '', reservationStatus: 'reserved', reservationDate: '2026-01-05',
  createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'admin', lastModifiedAt: '2026-01-01T00:00:00.000Z', lastModifiedBy: 'admin',
};
const ADMISSIONS = [
  { ...base, id: 'adm_a', admissionNo: 'ADM-000001', name: 'سجل أول', stage: 'confirmed', confirmedGroupId: 'g1' },
  { ...base, id: 'adm_b', admissionNo: 'ADM-000002', name: 'سجل ثاني', stage: 'confirmed', confirmedGroupId: 'g2' },
  { ...base, id: 'adm_c', admissionNo: 'ADM-000003', name: 'سجل ثالث', stage: 'reserved', confirmedGroupId: null },
  { ...base, id: 'adm_d', admissionNo: 'ADM-000004', name: 'سجل نشط', stage: 'active', confirmedGroupId: 'g2', linkedStudentId: 's1' },
];

beforeEach(() => {
  fetchMock = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u.includes('/api/admissionPayments') && method === 'GET') return Promise.resolve(okJson([]));
    if (u.endsWith('/api/cashboxes/options') && method === 'GET') return Promise.resolve(okJson([]));
    if (u.endsWith('/api/groups/options') && method === 'GET') {
      return Promise.resolve(okJson(GROUPS.map((g) => ({ ...g, max: null, price: 0, activeCount: 0 }))));
    }
    if (u.endsWith('/api/admissions') && method === 'POST') {
      const body = JSON.parse(opts.body);
      return Promise.resolve(okJson({ ...body, id: body.id || 'adm_new', number: body.number, studentId: null }, 201));
    }
    if (u.endsWith('/api/admissionSystemLog') && method === 'POST') {
      return Promise.resolve(okJson({ id: `sl-${Math.random()}`, admissionId: 'adm_new', activityType: 'created', byUser: 'u1', details: '', timestamp: '2026-01-10T00:00:00.000Z' }, 201));
    }
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u}`));
  });
  globalThis.fetch = fetchMock;
  useAppStore.setState({
    admissions: ADMISSIONS, admissionFollowups: [], admissionSystemLog: [], admissionPayments: [],
    groups: [], students: [], invMaterials: [], treasuryTxn: [], cashboxes: [],
  });
});
afterEach(() => { vi.restoreAllMocks(); });

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <AdmissionsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

const groupOptionsLoaded = () => waitFor(() =>
  expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/groups/options'))).toBe(true));
// Visible (non-<option>) occurrences of a text — the filter's <option>s carry group names too.
const shown = (text) => screen.queryAllByText(text).filter((el) => el.tagName !== 'OPTION');
const groupFilter = () => screen.getByRole('option', { name: 'كل المجموعات' }).closest('select');

describe('AdmissionsPage — no fictional groups, real confirmed groups only (M-03)', () => {
  it('the reservation form has no group selector, no fictional group names appear, and the request carries no group', async () => {
    renderPage();
    await groupOptionsLoaded();
    fireEvent.click(screen.getByText('📋 الحجز'));
    fireEvent.click(screen.getByText('+ إضافة حجز'));

    const form = screen.getByText('بيانات الحجز').parentElement;
    expect(within(form).queryByText('المجموعة')).not.toBeInTheDocument();
    expect(screen.queryAllByText(FAKE_GROUP_NAMES)).toHaveLength(0);

    const [nameInput, , phoneInput] = within(form).getAllByRole('textbox');
    fireEvent.change(nameInput, { target: { value: 'طالب جديد' } });
    fireEvent.change(phoneInput, { target: { value: '01055555555' } });
    fireEvent.click(within(form).getByText('حفظ الحجز'));

    await waitFor(() => expect(fetchMock.mock.calls.some(([u, o]) => String(u).endsWith('/api/admissions') && o?.method === 'POST')).toBe(true));
    const [, opts] = fetchMock.mock.calls.find(([u, o]) => String(u).endsWith('/api/admissions') && o?.method === 'POST');
    const body = JSON.parse(opts.body);
    expect(body).not.toHaveProperty('group');
    expect(body.groupId).toBeNull();
    expect(opts.body).not.toMatch(FAKE_GROUP_NAMES);
  });

  it('the group filter lists the real groups and filters by confirmedGroupId', async () => {
    renderPage();
    await groupOptionsLoaded();
    fireEvent.click(screen.getByText('📋 الحجز'));

    const select = await waitFor(() => {
      const s = groupFilter();
      expect(within(s).getByRole('option', { name: 'مجموعة أ' })).toBeInTheDocument();
      return s;
    });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['كل المجموعات', 'مجموعة أ', 'مجموعة ب']);
    expect(within(select).queryByText(FAKE_GROUP_NAMES)).not.toBeInTheDocument();
    expect(screen.getByText('سجل أول')).toBeInTheDocument();
    expect(screen.getByText('سجل ثاني')).toBeInTheDocument();
    expect(screen.getByText('سجل ثالث')).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'g1' } });
    expect(screen.getByText('سجل أول')).toBeInTheDocument();
    expect(screen.queryByText('سجل ثاني')).not.toBeInTheDocument();
    expect(screen.queryByText('سجل ثالث')).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'g2' } });
    expect(screen.queryByText('سجل أول')).not.toBeInTheDocument();
    expect(screen.getByText('سجل ثاني')).toBeInTheDocument();
  });

  it('confirmed admissions show the real group name; unconfirmed ones keep the existing fallback', async () => {
    renderPage();
    await groupOptionsLoaded();
    fireEvent.click(screen.getByText('📋 الحجز'));

    // Reserved-tab cards: g1 and g2 resolved by id.
    await waitFor(() => expect(shown('مجموعة أ').length).toBeGreaterThan(0));
    expect(shown('مجموعة ب').length).toBeGreaterThan(0);

    // Details panel: confirmed -> "المجموعة الحالية" with the real name; unconfirmed -> no section.
    fireEvent.click(screen.getByText('سجل أول'));
    const section = (await screen.findByText('المجموعة الحالية')).parentElement;
    expect(within(section).getByText('مجموعة أ')).toBeInTheDocument();

    fireEvent.click(screen.getByText('سجل ثالث'));
    await waitFor(() => expect(screen.queryByText('المجموعة الحالية')).not.toBeInTheDocument());

    // Active tab card shows the real group under the name.
    fireEvent.click(screen.getByText('✅ الطلاب النشطون'));
    expect(within(screen.getByText('سجل نشط').parentElement).getByText('مجموعة ب')).toBeInTheDocument();
  });
});
