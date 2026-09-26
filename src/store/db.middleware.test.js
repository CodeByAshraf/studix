// src/store/db.middleware.test.js
// Phase 3B-4 (تحضيري) — اختبار غير هدّام لخوارزمية الدمج بالـ id في loadFromPostgres.
// لا يلمس أي قاعدة بيانات — دالة نقية فقط.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeById, normalizeCollectionForMerge, loadFromPostgres } from './db.middleware';

vi.mock('../services/api', () => ({
  pgCheckHealth:   vi.fn(),
  pgGetCollection: vi.fn(),
}));
import { pgCheckHealth, pgGetCollection } from '../services/api';

describe('mergeById', () => {
  it('keeps local-only records and adds PG-only records', () => {
    const local = [{ id: 'a1', v: 'local' }, { id: 'a2', v: 'local' }];
    const pg    = [{ id: 'b1', v: 'pg' }];
    expect(mergeById(local, pg)).toEqual([
      { id: 'a1', v: 'local' },
      { id: 'a2', v: 'local' },
      { id: 'b1', v: 'pg' },
    ]);
  });

  it('lets PG win on a shared id while preserving other local-only records', () => {
    const local = [{ id: 'x', v: 'local-stale' }, { id: 'y', v: 'local-only' }];
    const pg    = [{ id: 'x', v: 'pg-fresh' }];
    expect(mergeById(local, pg)).toEqual([
      { id: 'y', v: 'local-only' },
      { id: 'x', v: 'pg-fresh' },
    ]);
  });

  it('never drops local data when PG returns fewer rows than local holds', () => {
    // هذا هو صلب الإصلاح: PG فيه أول سجلات فقط لا يعني محو باقي التاريخ المحلي
    const local = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, v: 'local' }));
    const pg    = [{ id: 's0', v: 'pg' }];
    const merged = mergeById(local, pg);
    expect(merged).toHaveLength(50);
    expect(merged.find(r => r.id === 's0')).toEqual({ id: 's0', v: 'pg' });
    expect(merged.filter(r => r.v === 'local')).toHaveLength(49);
  });

  it('returns PG data unchanged when local is empty', () => {
    const pg = [{ id: '1' }, { id: '2' }];
    expect(mergeById([], pg)).toEqual(pg);
  });

  it('returns local data unchanged when PG is empty', () => {
    const local = [{ id: '1' }, { id: '2' }];
    expect(mergeById(local, [])).toEqual(local);
  });

  it('treats non-array inputs defensively as empty', () => {
    expect(mergeById(undefined, [{ id: '1' }])).toEqual([{ id: '1' }]);
    expect(mergeById([{ id: '1' }], undefined)).toEqual([{ id: '1' }]);
    expect(mergeById(undefined, undefined)).toEqual([]);
  });

  it('compares ids as strings (BigInt-id collections arrive as strings from the API)', () => {
    const local = [{ id: 5, v: 'local' }];
    const pg    = [{ id: '5', v: 'pg' }];
    expect(mergeById(local, pg)).toEqual([{ id: '5', v: 'pg' }]);
  });
});

describe('normalizeCollectionForMerge', () => {
  it('trims attendance.date from a full ISO timestamp down to YYYY-MM-DD', () => {
    const data = [{ id: '1', date: '2000-01-01T00:00:00.000Z', status: 'present' }];
    expect(normalizeCollectionForMerge('attendance', data)).toEqual([
      { id: '1', date: '2000-01-01', status: 'present' },
    ]);
  });

  it('leaves an already-plain date untouched (idempotent)', () => {
    const data = [{ id: '1', date: '2000-01-01', status: 'present' }];
    expect(normalizeCollectionForMerge('attendance', data)).toEqual(data);
  });

  it('leaves every other collection completely untouched', () => {
    const data = [{ id: '1', date: '2000-01-01T00:00:00.000Z', name: 'x' }];
    expect(normalizeCollectionForMerge('students', data)).toBe(data);
  });

  it('trims exams.date and coerces total/pass (Decimal-as-string) to numbers', () => {
    const data = [{ id: '1', date: '2000-01-01T00:00:00.000Z', total: '100', pass: '50' }];
    expect(normalizeCollectionForMerge('exams', data)).toEqual([
      { id: '1', date: '2000-01-01', total: 100, pass: 50 },
    ]);
  });

  // Grades + Homework global-read migration, Phase 3: the grades/homeworks/hwSubmissions fixups
  // were removed along with their bootstrap load (their normalization cases moved to
  // services/api.test.js, on the pgGet* read path). No fixup entry → passed through untouched.
  it('grades/homeworks/hwSubmissions have no bootstrap fixup any more (pass through unchanged)', () => {
    for (const name of ['grades', 'homeworks', 'hwSubmissions']) {
      const data = [{ id: 'x', score: '1' }];
      expect(normalizeCollectionForMerge(name, data)).toBe(data);
    }
  });

  it('communications: trims followupDate and renames legacyParentName to parentName', () => {
    const data = [
      { id: 'c1', followupDate: '2026-04-01T00:00:00.000Z', legacyParentName: 'Ahmed', type: 'phoneCall' },
      { id: 'c2', followupDate: null, legacyParentName: null, type: 'whatsapp' },
    ];
    expect(normalizeCollectionForMerge('communications', data)).toEqual([
      { id: 'c1', followupDate: '2026-04-01', parentName: 'Ahmed', type: 'phoneCall' },
      { id: 'c2', followupDate: null, parentName: null, type: 'whatsapp' },
    ]);
  });

  it('commTasks: trims dueDate and renames communicationId to commId', () => {
    const data = [
      { id: 't1', communicationId: 'c1', dueDate: '2026-04-05T00:00:00.000Z', title: 'x' },
      { id: 't2', communicationId: null, dueDate: null, title: 'y' },
    ];
    expect(normalizeCollectionForMerge('commTasks', data)).toEqual([
      { id: 't1', commId: 'c1', dueDate: '2026-04-05', title: 'x' },
      { id: 't2', commId: null, dueDate: null, title: 'y' },
    ]);
  });

  // Pre-installer defect audit — groups.teacher_name arrives from PostgreSQL as
  // "teacherName" (raw snakeToCamel), but GroupForm.jsx/GroupsPage.jsx/GroupCard.jsx
  // read "teacher" exclusively. Before this fixup, a real PostgreSQL-shaped group row
  // had no "teacher" field at all, so the edit form silently rendered it empty and
  // saving without retyping it erased the real teacher_name in the database. This
  // proves the actual normalization path (normalizeCollectionForMerge, the same
  // function the real sync loop calls) now protects the real production data shape —
  // not a bypass or a mock of it.
  it('groups: renames teacherName to teacher, preserving the rest of the row untouched', () => {
    const data = [
      { id: 'g1', name: 'مجموعة أ', teacherName: 'أحمد محمد', grade: 'الأول الثانوي' },
    ];
    const [group] = normalizeCollectionForMerge('groups', data);
    expect(group.teacher).toBe('أحمد محمد');
    expect(group).toEqual({
      id: 'g1', name: 'مجموعة أ', teacherName: 'أحمد محمد', grade: 'الأول الثانوي', teacher: 'أحمد محمد',
    });
  });

  it('groups: falls back to an empty string (never undefined/null) when teacherName is absent', () => {
    const data = [{ id: 'g2', name: 'مجموعة ب', teacherName: null }];
    expect(normalizeCollectionForMerge('groups', data)[0].teacher).toBe('');
  });
});

// Phase 3B-10 — centerProfile هو الاستثناء الوحيد في PG_COLLECTIONS: سجل مفرد (object)
// في المخزن، لا مصفوفة كباقي الـ collections. mergeById العام كان يحوّله بصمت إلى
// [{...}] (Array.isArray على object يُرجع false داخل mergeById). هذا القسم يختبر
// loadFromPostgres فعلياً (لا mergeById مباشرة) لأن الإصلاح في نقطة التفرّع داخل حلقة
// الدمج نفسها، لا في mergeById — انظر تقرير تفتيش Phase 3B-10.
describe('loadFromPostgres — centerProfile singleton (Phase 3B-10 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // يحاكي استدعاء useDB.jsx الحقيقي (set هو updater دالّي يُطبَّق على الحالة الحالية)
  // بلا لمس useAppStore/Zustand الحقيقي — نفس فلسفة "لا يلمس أي قاعدة بيانات" بالملف.
  async function runLoadFromPostgres(initialState) {
    // set() لا يُستدعى إطلاقاً لو كل الـ collections فاضية (loadFromPostgres سطر
    // "appliedNames.length > 0") — نفس المعنى دلالياً لـ "الحالة بقيت كما هي بلا لمس"،
    // فنُرجع initialState افتراضياً بدل null لو لم يُستدعَ set إطلاقاً.
    let nextState = initialState;
    const set = (updater) => {
      nextState = typeof updater === 'function' ? updater(initialState) : updater;
    };
    await loadFromPostgres(set);
    return nextState;
  }

  const SERVER_ROW = {
    id: 1, name: 'مركز ستوديكس', address: 'القاهرة', phone1: '0100000000', phone2: null,
    logoUrl: 'data:image/png;base64,abc', teacherName: 'أ. محمد', subject: 'رياضيات',
    academicYear: '2025/2026', updatedAt: '2026-08-20T10:00:00.000Z',
  };
  const DEFAULT_PROFILE = { name: '', slogan: '', address: '', phone1: '', phone2: '', logoUrl: '' };

  function mockHealthAndCollections(centerProfileResponse) {
    pgCheckHealth.mockResolvedValue({ ok: true });
    // كل الـ collections الأخرى فاضية عمداً — نعزل الاختبار على centerProfile فقط
    pgGetCollection.mockImplementation((name) =>
      Promise.resolve(name === 'centerProfile' ? centerProfileResponse : [])
    );
  }

  it('Test 1 — unwraps the single-row array into a plain object, never an array', async () => {
    mockHealthAndCollections([SERVER_ROW]);
    const next = await runLoadFromPostgres({ centerProfile: DEFAULT_PROFILE });

    expect(Array.isArray(next.centerProfile)).toBe(false);
    expect(next.centerProfile).toEqual({ ...SERVER_ROW, slogan: '' });
  });

  it('Test 2 — server fields (logoUrl/teacherName/academicYear/updatedAt) are populated correctly', async () => {
    mockHealthAndCollections([SERVER_ROW]);
    const next = await runLoadFromPostgres({ centerProfile: DEFAULT_PROFILE });

    expect(next.centerProfile.logoUrl).toBe('data:image/png;base64,abc');
    expect(next.centerProfile.teacherName).toBe('أ. محمد');
    expect(next.centerProfile.academicYear).toBe('2025/2026');
    expect(next.centerProfile.updatedAt).toBe('2026-08-20T10:00:00.000Z');
  });

  it('Test 3 — preserves the local-only slogan; the server never overwrites it', async () => {
    mockHealthAndCollections([SERVER_ROW]);
    const next = await runLoadFromPostgres({
      centerProfile: { ...DEFAULT_PROFILE, name: 'قديم', slogan: 'Existing Local Slogan' },
    });

    expect(next.centerProfile.slogan).toBe('Existing Local Slogan');
  });

  it('Test 4 — never lets state.centerProfile become [serverRow] (the original regression)', async () => {
    mockHealthAndCollections([SERVER_ROW]);
    const next = await runLoadFromPostgres({ centerProfile: DEFAULT_PROFILE });

    expect(next.centerProfile).not.toEqual([SERVER_ROW]);
    expect(Array.isArray(next.centerProfile)).toBe(false);
  });

  it('Test 5 — starting from the default local profile still yields a valid singleton object', async () => {
    const allNullRow = { ...SERVER_ROW, name: null, address: null, phone1: null, phone2: null, logoUrl: null, teacherName: null, subject: null, academicYear: null };
    mockHealthAndCollections([allNullRow]);
    const next = await runLoadFromPostgres({ centerProfile: DEFAULT_PROFILE });

    expect(Array.isArray(next.centerProfile)).toBe(false);
    expect(next.centerProfile.slogan).toBe('');
    expect(next.centerProfile.id).toBe(1);
  });

  it('leaves centerProfile completely untouched when PostgreSQL has no row yet (empty array, not an array corruption)', async () => {
    mockHealthAndCollections([]); // نفس سلوك كل الـ collections الفارغة الأخرى — لا لمس إطلاقاً
    const localProfile = { ...DEFAULT_PROFILE, name: 'Local Only', slogan: 'Local Slogan' };
    const next = await runLoadFromPostgres({ centerProfile: localProfile });

    expect(next.centerProfile).toBe(localProfile); // نفس الـ reference — لم تُلمَس إطلاقاً
    expect(Array.isArray(next.centerProfile)).toBe(false);
  });
});

// Phase 3B-11 — inventorySettings استثناء ثانٍ في PG_COLLECTIONS بنفس سبب centerProfile
// بالضبط (سجل مفرد/object، لا مصفوفة) — mergeById كان سيحوّله بصمت لنفس نمط الفساد. هذا
// القسم يختبر loadFromPostgres فعلياً (نفس أسلوب قسم centerProfile أعلاه)، ويتحقّق أيضاً
// أن إصلاح Phase 3B-10 لم يتأثّر — انظر تقرير تفتيش Phase 3B-11.
describe('loadFromPostgres — inventorySettings singleton (Phase 3B-11 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function runLoadFromPostgres(initialState) {
    let nextState = initialState;
    const set = (updater) => {
      nextState = typeof updater === 'function' ? updater(initialState) : updater;
    };
    await loadFromPostgres(set);
    return nextState;
  }

  const DEFAULT_SETTINGS = { defaultMinStock: 10, allowNegativeStock: false, reservationExpiryDays: 7 };
  const DEFAULT_PROFILE  = { name: '', slogan: '', address: '', phone1: '', phone2: '', logoUrl: '' };

  function mockHealthAndCollections(inventorySettingsResponse) {
    pgCheckHealth.mockResolvedValue({ ok: true });
    // كل الـ collections الأخرى فاضية عمداً (بما فيها centerProfile) — نعزل الاختبار
    pgGetCollection.mockImplementation((name) =>
      Promise.resolve(name === 'inventorySettings' ? inventorySettingsResponse : [])
    );
  }

  it('Test 1 — unwraps the single-row array into a plain object, never an array', async () => {
    mockHealthAndCollections([{ id: 1, defaultMinStock: '10', allowNegativeStock: false, reservationExpiryDays: 7 }]);
    const next = await runLoadFromPostgres({ inventorySettings: DEFAULT_SETTINGS });

    expect(Array.isArray(next.inventorySettings)).toBe(false);
    expect(next.inventorySettings).toEqual({ defaultMinStock: 10, allowNegativeStock: false, reservationExpiryDays: 7 });
  });

  it('Test 2 — correct field mapping (defaultMinStock/allowNegativeStock/reservationExpiryDays)', async () => {
    mockHealthAndCollections([{ id: 1, defaultMinStock: '25', allowNegativeStock: true, reservationExpiryDays: 14 }]);
    const next = await runLoadFromPostgres({ inventorySettings: DEFAULT_SETTINGS });

    expect(next.inventorySettings.defaultMinStock).toBe(25);
    expect(next.inventorySettings.allowNegativeStock).toBe(true);
    expect(next.inventorySettings.reservationExpiryDays).toBe(14);
  });

  it('Test 3 — normalizes the Decimal-as-string defaultMinStock to a real number', async () => {
    mockHealthAndCollections([{ id: 1, defaultMinStock: '10', allowNegativeStock: false, reservationExpiryDays: 7 }]);
    const next = await runLoadFromPostgres({ inventorySettings: DEFAULT_SETTINGS });

    expect(next.inventorySettings.defaultMinStock).toBe(10);
    expect(typeof next.inventorySettings.defaultMinStock).toBe('number');
  });

  it('Test 4 — never lets state.inventorySettings become [serverRow] (the original regression)', async () => {
    const serverRow = { id: 1, defaultMinStock: '10', allowNegativeStock: false, reservationExpiryDays: 7 };
    mockHealthAndCollections([serverRow]);
    const next = await runLoadFromPostgres({ inventorySettings: DEFAULT_SETTINGS });

    expect(next.inventorySettings).not.toEqual([serverRow]);
    expect(Array.isArray(next.inventorySettings)).toBe(false);
  });

  it('Test 5 — starting from the existing default settings still yields a valid singleton object', async () => {
    mockHealthAndCollections([{ id: 1, defaultMinStock: '10', allowNegativeStock: false, reservationExpiryDays: 7 }]);
    const next = await runLoadFromPostgres({ inventorySettings: DEFAULT_SETTINGS });

    expect(Array.isArray(next.inventorySettings)).toBe(false);
    expect(next.inventorySettings).toEqual(DEFAULT_SETTINGS);
  });

  it('does not include an id field — the established local shape has none and no consumer reads it', async () => {
    mockHealthAndCollections([{ id: 1, defaultMinStock: '10', allowNegativeStock: false, reservationExpiryDays: 7 }]);
    const next = await runLoadFromPostgres({ inventorySettings: DEFAULT_SETTINGS });

    expect(next.inventorySettings.id).toBeUndefined();
  });

  it('leaves inventorySettings completely untouched when PostgreSQL has no row yet (empty array)', async () => {
    mockHealthAndCollections([]);
    const localSettings = { defaultMinStock: 20, allowNegativeStock: true, reservationExpiryDays: 3 };
    const next = await runLoadFromPostgres({ inventorySettings: localSettings });

    expect(next.inventorySettings).toBe(localSettings); // نفس الـ reference — لم تُلمَس إطلاقاً
  });

  it('Test 6 — handles both known singletons in the same sync without interference (Phase 3B-10 regression still protected)', async () => {
    pgCheckHealth.mockResolvedValue({ ok: true });
    const centerProfileRow  = { id: 1, name: 'مركز ستوديكس', address: 'القاهرة', phone1: '0100000000', phone2: null, logoUrl: null };
    const inventoryRow      = { id: 1, defaultMinStock: '30', allowNegativeStock: true, reservationExpiryDays: 5 };
    pgGetCollection.mockImplementation((name) => {
      if (name === 'centerProfile') return Promise.resolve([centerProfileRow]);
      if (name === 'inventorySettings') return Promise.resolve([inventoryRow]);
      return Promise.resolve([]);
    });

    const next = await runLoadFromPostgres({
      centerProfile:     { ...DEFAULT_PROFILE, slogan: 'Existing Local Slogan' },
      inventorySettings: DEFAULT_SETTINGS,
    });

    // centerProfile: نفس سلوك Phase 3B-10 بالضبط — object، وslogan المحلي محفوظ
    expect(Array.isArray(next.centerProfile)).toBe(false);
    expect(next.centerProfile.name).toBe('مركز ستوديكس');
    expect(next.centerProfile.slogan).toBe('Existing Local Slogan');

    // inventorySettings: object، والقيم مُطبَّعة بشكل صحيح، بلا تداخل مع centerProfile
    expect(Array.isArray(next.inventorySettings)).toBe(false);
    expect(next.inventorySettings).toEqual({ defaultMinStock: 30, allowNegativeStock: true, reservationExpiryDays: 5 });
  });
});

// Grades + Homework global-read migration, Phase 3 (final cutover) — the central success
// criterion: loadFromPostgres (used by BOTH initial boot — useDB.jsx — and post-login re-sync —
// auth.context.jsx) must never issue a global GET for grades/homeworks/hwSubmissions, while
// still loading every other collection exactly as before.
describe('loadFromPostgres — Grades/Homework cutover (bootstrap exclusion)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pgCheckHealth.mockResolvedValue({ ok: true });
    pgGetCollection.mockResolvedValue([]);
  });

  it('never requests grades, homeworks or hwSubmissions', async () => {
    await loadFromPostgres(() => {});
    const requested = pgGetCollection.mock.calls.map(([name]) => name);
    expect(requested).not.toContain('grades');
    expect(requested).not.toContain('homeworks');
    expect(requested).not.toContain('hwSubmissions');
  });

  it('still requests exactly the remaining bootstrap collections, each once', async () => {
    await loadFromPostgres(() => {});
    const requested = pgGetCollection.mock.calls.map(([name]) => name);
    expect(requested.sort()).toEqual([
      'parents', 'students', 'groups', 'teachers', 'exams', 'centerProfile',
      'cashboxes', 'treasuryTxn', 'attendance', 'absenceFollowup',
      'invMaterials', 'inventoryTxn', 'inventorySettings',
      'admissions', 'admissionFollowups', 'admissionSystemLog',
      'waReportLog',
    ].sort());
  });

  it('leaves any existing grades/homeworks/hwSubmissions snapshot state untouched', async () => {
    pgGetCollection.mockImplementation((name) =>
      Promise.resolve(name === 'students' ? [{ id: 's1' }] : []));
    const initial = { students: [], grades: [{ id: 'g' }], homeworks: [{ id: 'h' }], hwSubmissions: [{ id: 'x' }] };
    let next = initial;
    await loadFromPostgres((updater) => { next = typeof updater === 'function' ? updater(initial) : updater; });
    expect(next.students).toEqual([{ id: 's1' }]);
    expect(next.grades).toBe(initial.grades);
    expect(next.homeworks).toBe(initial.homeworks);
    expect(next.hwSubmissions).toBe(initial.hwSubmissions);
  });
});
