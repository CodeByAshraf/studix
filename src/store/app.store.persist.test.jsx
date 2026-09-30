// src/store/app.store.persist.test.jsx
// P2 Fix A — localStorage['studix-v1'] holds ONLY local/client-owned state (reportConfig,
// treasuryMeta, materials, centerProfile.slogan). Server-owned collections stay in memory
// only; the old v0 full snapshot is discarded on first load; a failed localStorage write
// (QuotaExceededError) never throws out of a store update; and the obsolete
// 'studix_autobackup' key is removed by DataProvider.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useAppStore, pickLocalState, PERSIST_NAME, PERSIST_VERSION } from './app.store';
import { DataProvider } from './data.context';

const LEGACY_AUTOBACKUP_KEY = 'studix_autobackup';

const SERVER_OWNED = [
  'students', 'groups', 'payments', 'attendance', 'absenceFollowup', 'exams', 'grades',
  'homeworks', 'hwSubmissions', 'invMaterials', 'inventoryTxn', 'inventorySettings',
  'communications', 'commTasks', 'parents', 'waReportLog', 'cashboxes', 'treasuryTxn',
  'activityLogs', 'admissions', 'admissionFollowups', 'admissionSystemLog', 'admissionPayments',
];
const LOCAL_KEYS = ['centerProfile', 'materials', 'reportConfig', 'treasuryMeta'];

const readPersisted = () => JSON.parse(localStorage.getItem(PERSIST_NAME));

function seedServerOwned(tag) {
  const patch = {};
  for (const k of SERVER_OWNED) patch[k] = k === 'inventorySettings' ? { tag } : [{ id: `${k}-${tag}`, tag }];
  useAppStore.setState(patch);
  return patch;
}

// A v0 snapshot shaped exactly like the pre-fix partialize output, with large collections.
function makeLegacySnapshot(rowsPerCollection = 2000) {
  const state = {};
  for (const k of SERVER_OWNED) {
    state[k] = k === 'inventorySettings'
      ? { defaultMinStock: 5 }
      : Array.from({ length: rowsPerCollection }, (_, i) => ({ id: `old-${k}-${i}`, note: 'بيانات قديمة'.repeat(3) }));
  }
  state.centerProfile = { name: 'OLD NAME FROM CACHE', address: 'old addr', slogan: 'شعار محلي' };
  state.materials     = [{ id: 'm1', name: 'مذكرة محلية' }];
  state.treasuryMeta  = { legacy: 'kept' };
  state.reportConfig  = { ...useAppStore.getState().reportConfig, showCharts: false };
  return { state, version: 0 };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('A/B — partialize persists only local/client-owned state', () => {
  it('pickLocalState returns exactly the local-only keys, with centerProfile reduced to slogan', () => {
    const picked = pickLocalState({
      ...useAppStore.getState(),
      ...Object.fromEntries(SERVER_OWNED.map((k) => [k, [{ id: 1 }]])),
      centerProfile: { name: 'Server Name', phone1: '0100', logoUrl: 'data:…', slogan: 'S' },
    });
    expect(Object.keys(picked).sort()).toEqual(LOCAL_KEYS);
    expect(picked.centerProfile).toEqual({ slogan: 'S' });
  });

  it('a store update writes no server-owned collection to studix-v1', () => {
    seedServerOwned('SRVROW');
    useAppStore.setState({ materials: [{ id: 'm-live' }] });

    const saved = readPersisted();
    expect(saved.version).toBe(PERSIST_VERSION);
    expect(Object.keys(saved.state).sort()).toEqual(LOCAL_KEYS);
    for (const k of SERVER_OWNED) expect(saved.state).not.toHaveProperty(k);
    expect(JSON.stringify(saved)).not.toContain('SRVROW'); // no server row leaked anywhere
    expect(saved.state.materials).toEqual([{ id: 'm-live' }]);
  });

  it('only centerProfile.slogan is persisted — server-owned profile fields are not', () => {
    useAppStore.setState({ centerProfile: { name: 'Center', address: 'Addr', logoUrl: 'data:x', slogan: 'Motto' } });
    expect(readPersisted().state.centerProfile).toEqual({ slogan: 'Motto' });
  });
});

describe('C — old large v0 snapshot is migrated/discarded safely', () => {
  it('rehydrate keeps only local fields, never merges old server rows, and rewrites the key small', async () => {
    const legacy = makeLegacySnapshot();
    const legacyRaw = JSON.stringify(legacy);
    const live = seedServerOwned('live');
    useAppStore.setState({ centerProfile: { name: 'Server Name', address: 'Server Addr', slogan: '' } });
    // written after seeding (every setState persists), as it would be found on disk at boot
    localStorage.setItem(PERSIST_NAME, legacyRaw);

    await useAppStore.persist.rehydrate();

    const s = useAppStore.getState();
    // G — in-memory server-loaded collections are untouched by the old snapshot.
    for (const k of SERVER_OWNED) expect(s[k]).toEqual(live[k]);
    // local-only values carried over from the old snapshot
    expect(s.materials).toEqual(legacy.state.materials);
    expect(s.treasuryMeta).toEqual(legacy.state.treasuryMeta);
    expect(s.reportConfig.showCharts).toBe(false);
    // centerProfile: server fields stay in memory, only slogan restored from storage
    expect(s.centerProfile).toEqual({ name: 'Server Name', address: 'Server Addr', slogan: 'شعار محلي' });

    const raw = localStorage.getItem(PERSIST_NAME);
    const saved = JSON.parse(raw);
    expect(saved.version).toBe(PERSIST_VERSION);
    expect(Object.keys(saved.state).sort()).toEqual(LOCAL_KEYS);
    expect(raw).not.toContain('old-');
    expect(raw.length).toBeLessThan(legacyRaw.length / 100);
  });

  it('a fresh store instance (first app load) boots with empty server-owned collections from a v0 snapshot', async () => {
    localStorage.setItem(PERSIST_NAME, JSON.stringify(makeLegacySnapshot(50)));
    vi.resetModules();
    const fresh = await import('./app.store');

    const s = fresh.useAppStore.getState();
    for (const k of SERVER_OWNED.filter((k) => k !== 'inventorySettings')) {
      expect(s[k].some((r) => String(r.id).startsWith('old-'))).toBe(false);
    }
    expect(s.inventorySettings).not.toEqual({ defaultMinStock: 5 });
    expect(s.materials).toEqual([{ id: 'm1', name: 'مذكرة محلية' }]);
    expect(s.centerProfile.name).not.toBe('OLD NAME FROM CACHE');
    expect(s.centerProfile.slogan).toBe('شعار محلي');
    expect(JSON.parse(localStorage.getItem(PERSIST_NAME)).version).toBe(PERSIST_VERSION);
    expect(localStorage.getItem(PERSIST_NAME)).not.toContain('old-');
  });

  it('a snapshot without a numeric version (migrate skipped) is still filtered by merge', async () => {
    const legacy = makeLegacySnapshot(5);
    const live = seedServerOwned('live');
    localStorage.setItem(PERSIST_NAME, JSON.stringify({ state: legacy.state }));

    await useAppStore.persist.rehydrate();

    for (const k of SERVER_OWNED) expect(useAppStore.getState()[k]).toEqual(live[k]);
    expect(useAppStore.getState().materials).toEqual(legacy.state.materials);
  });
});

describe('D — obsolete studix_autobackup key', () => {
  it('DataProvider removes an existing studix_autobackup key on mount', () => {
    localStorage.setItem(LEGACY_AUTOBACKUP_KEY, JSON.stringify({ savedAt: 'x', data: { students: [{ id: 's' }] } }));
    localStorage.setItem('tc_center_profile', '{"name":"keep"}');
    localStorage.setItem('studix-db-identity', '"keep"');

    render(<DataProvider><span>child</span></DataProvider>);

    expect(localStorage.getItem(LEGACY_AUTOBACKUP_KEY)).toBeNull();
    // unrelated keys untouched
    expect(localStorage.getItem('tc_center_profile')).toBe('{"name":"keep"}');
    expect(localStorage.getItem('studix-db-identity')).toBe('"keep"');
  });

  it('DataProvider is safe when the key is absent', () => {
    const { getByText } = render(<DataProvider><span>child</span></DataProvider>);
    expect(getByText('child')).toBeTruthy();
    expect(localStorage.getItem(LEGACY_AUTOBACKUP_KEY)).toBeNull();
  });
});

describe('E — localStorage write failure never breaks a store update', () => {
  function quotaError() {
    return new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  }

  it('setState succeeds in memory and logs when setItem throws QuotaExceededError', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw quotaError(); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => useAppStore.setState({ students: [{ id: 'q1' }], materials: [{ id: 'mq' }] })).not.toThrow();

    expect(useAppStore.getState().students).toEqual([{ id: 'q1' }]);
    expect(useAppStore.getState().materials).toEqual([{ id: 'mq' }]);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('[persist] failed to write "studix-v1"'), 'QuotaExceededError', expect.any(String),
    );
  });

  it('a real slice action (setTreasuryMeta / setAttendance) does not throw on quota failure', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw quotaError(); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { setTreasuryMeta, setAttendance } = useAppStore.getState();

    expect(() => setTreasuryMeta({ note: 'after-quota' })).not.toThrow();
    expect(() => setAttendance([{ id: 'att-q' }])).not.toThrow();

    expect(useAppStore.getState().treasuryMeta).toEqual({ note: 'after-quota' });
    expect(useAppStore.getState().attendance).toEqual([{ id: 'att-q' }]);
  });
});

describe('F — legitimate local-only state survives reload', () => {
  it('reportConfig, treasuryMeta, materials and slogan round-trip through studix-v1', async () => {
    const reportConfig = { ...useAppStore.getState().reportConfig, showAttendance: false };
    useAppStore.setState({
      reportConfig,
      treasuryMeta:  { opening: 100 },
      materials:     [{ id: 'mat-1', name: 'كتاب' }],
      centerProfile: { ...useAppStore.getState().centerProfile, slogan: 'نحو التميز' },
    });

    // simulate a reload into a fresh store instance
    vi.resetModules();
    const fresh = await import('./app.store');
    const s = fresh.useAppStore.getState();

    expect(s.reportConfig).toEqual(reportConfig);
    expect(s.treasuryMeta).toEqual({ opening: 100 });
    expect(s.materials).toEqual([{ id: 'mat-1', name: 'كتاب' }]);
    expect(s.centerProfile.slogan).toBe('نحو التميز');
  });

  it('server-owned collections do NOT survive reload (re-fetched from the server instead)', async () => {
    seedServerOwned('before-reload');

    vi.resetModules();
    const fresh = await import('./app.store');
    const s = fresh.useAppStore.getState();

    expect(s.students).toEqual([]);
    expect(s.payments).toEqual([]);
    expect(s.attendance).toEqual([]);
    expect(s.treasuryTxn).toEqual([]);
  });
});
