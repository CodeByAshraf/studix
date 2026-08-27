// backend/src/routes/admissionActivation.integration.test.js
// BUG-05 — real PostgreSQL integration (scratch database only, never the real studix
// database). activateAdmission's final write used to be a plain `tx.admissions.update({
// where: { id: admissionId }, ... })` with no guard on the current state inside the WHERE
// clause. Two genuinely concurrent activation requests for the same admission could each
// create a real, distinct `students` row, then both race to write `admission.student_id`
// — the second writer's unconditional UPDATE always won regardless of ordering, silently
// overwriting the first writer's student_id and permanently orphaning that first student
// (fully created, given a group and a real TC-YYYY-#### code, but referenced by no
// admission at all).
//
// Fixed via the same proven pattern already used by reverseTreasuryTxn (treasuryTxn.js)
// and cancelAdmissionWithRefund (admissionCancellation.js): the state guard now lives
// inside `tx.admissions.updateMany({ where: { id, student_id: null }, ... })`, count-
// checked. The loser's WHERE matches zero rows once the winner has committed, so it
// throws — which rolls back its ENTIRE interactive transaction (including its own
// `tx.students.create`), so no orphan student is ever actually persisted.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('admissionActivation.js — real PostgreSQL integration (BUG-05)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let activateAdmission;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('admission_activation');
    client = scratch.client;
    ({ activateAdmission } = await import('./admissionActivation.js'));
    await client.groups.create({ data: { id: 'g1', name: 'مجموعة اختبار', price: 100 } });
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedAdmission(overrides = {}) {
    const id = nextId('adm');
    return client.admissions.create({
      data: { id, number: nextId('NUM'), name: 'طالب اختبار السباق', stage: 'reserved', ...overrides },
    });
  }

  function studentInput(name = 'طالب جديد') {
    return { name, groupId: 'g1', phone: '201000000000' };
  }

  it('a normal (non-concurrent) activation still succeeds exactly as before: creates a real student, sets stage/student_id, logs firstLesson+activated', async () => {
    const admission = await seedAdmission();

    const result = await activateAdmission({ admissionId: admission.id, student: studentInput() }, { userId: null });

    expect(result.admission.stage).toBe('active');
    expect(result.admission.studentId).toBe(result.student.id);
    expect(result.systemLogEntries).toHaveLength(2);
    expect(result.systemLogEntries.map((l) => l.activityType).sort()).toEqual(['activated', 'firstLesson']);

    const dbAdmission = await client.admissions.findUnique({ where: { id: admission.id } });
    expect(dbAdmission.stage).toBe('active');
    expect(dbAdmission.student_id).toBe(result.student.id);

    const dbStudent = await client.students.findUnique({ where: { id: result.student.id } });
    expect(dbStudent).not.toBeNull();
    expect(dbStudent.name).toBe('طالب جديد');
  });

  it('re-activating an already-active admission stays idempotent: no second student, no new log entries', async () => {
    const admission = await seedAdmission();
    const first = await activateAdmission({ admissionId: admission.id, student: studentInput() }, { userId: null });

    const second = await activateAdmission({ admissionId: admission.id, student: studentInput('طالب آخر') }, { userId: null });

    expect(second.student.id).toBe(first.student.id);
    expect(second.systemLogEntries).toEqual([]);
    expect(await client.students.count({ where: { name: 'طالب آخر' } })).toBe(0);
  });

  // Deterministic proof, not statistical — mirrors treasuryTxn.integration.test.js's
  // "two genuinely concurrent reversal requests" test exactly, applied to activation.
  // ملاحظة على نمط الاختبار: على عكس reverseTreasuryTxn (لا مسار نجاح idempotent فيها —
  // أي طلب ثانٍ بعد التثبيت يُرفَض دائماً)، activateAdmission تملك مساراً شرعياً لنجاح
  // الطلب الثاني أيضاً: لو بدأت قراءته الأولى بعد أن ثبَّتت معاملة الفائز بالفعل، يرى
  // الحالة النشطة فوراً ويُعيد نفس طالب الفائز (idempotent) بلا خطأ إطلاقاً — بينما لو
  // تداخلت القراءتان قبل أن يكتب أيّهما شيئاً، يُرفَض الخاسر عبر الحارس الذرّي الجديد.
  // كلا المسارين نتيجتان صحيحتان بالتصميم؛ التوزيع الفعلي بينهما غير حتمي (يعتمد على
  // توقيت الشبكة/القاعدة الحقيقي) — لذا هذا الاختبار يُثبِت الثابت الحتمي الذي يهمّ
  // فعلياً (المطلوب صراحة: لا طالبان لتفعيل ناجح واحد، لا طالب يتيم، لا استبدال
  // student_id، لا سجلّا تفعيل مكرَّران) بدل افتراض توزيع fulfilled/rejected مُحدَّد سلفاً.
  it('two genuinely concurrent activation requests on the same admission: never produce two students, an orphan, an overwritten student_id, or duplicate activation logs', async () => {
    const admission = await seedAdmission();

    const results = await Promise.allSettled([
      activateAdmission({ admissionId: admission.id, student: studentInput('طالب أ') }, { userId: null }),
      activateAdmission({ admissionId: admission.id, student: studentInput('طالب ب') }, { userId: null }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // على الأقل طلب واحد ينجح دائماً (لا يفشل كلاهما)، وأي رفض يحمل رسالة السباق المتوقّعة
    // تحديداً (لا فشل غامض/غير متعلّق).
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) {
      expect(r.reason.message).toMatch(/تفعيله للتو من طلب آخر متزامن/);
    }

    // كل الطلبات الناجحة يجب أن تُشير لنفس الطالب الواحد بالضبط — لا طالبان مختلفان
    // لتفعيل واحد ناجح (سواء عبر مسار الفوز الحقيقي أو مسار النجاح الـ idempotent).
    const distinctWinnerIds = new Set(fulfilled.map((r) => r.value.student.id));
    expect(distinctWinnerIds.size).toBe(1);
    const winnerId = [...distinctWinnerIds][0];

    // لا طالب يتيم على الإطلاق: بالضبط طالب واحد حقيقي أُنشئ لهذا القبول، وهو نفسه
    // المرتبط الآن بـ admission.student_id — لا استبدال.
    const createdStudents = await client.students.findMany({ where: { name: { in: ['طالب أ', 'طالب ب'] } } });
    expect(createdStudents).toHaveLength(1);
    expect(createdStudents[0].id).toBe(winnerId);

    const dbAdmission = await client.admissions.findUnique({ where: { id: admission.id } });
    expect(dbAdmission.student_id).toBe(winnerId);
    expect(dbAdmission.stage).toBe('active');

    // سجلّا نشاط واحدان فقط (activated + firstLesson) — لا تكرار من أي معاملة خاسرة
    // (تراجعت بالكامل تلقائياً عند رفض الحارس الذرّي).
    const logs = await client.admission_system_log.findMany({ where: { admission_id: admission.id } });
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => l.activity_type).sort()).toEqual(['activated', 'firstLesson']);
  });
});
