// backend/src/routes/studentReport.integration.test.js
// Scalability Architecture Phase 2 — real PostgreSQL integration (scratch database only).
// Proves getStudentReportData's scoped queries reproduce exactly the same matching rules
// gatherStudentData (src/modules/student-report/reportData.js) currently applies on the
// full, unscoped arrays — attendance/grades/hw_submissions/payments by student_id,
// communications by (phone OR student_name) — NOT student_id (the existing frontend
// filter never uses that column, despite it existing — this test locks in the real,
// current matching rule, not an invented one), inventory_txn (booklet deliveries) by
// (student_id OR legacy recipient-name substring), and refund treasury_txn scoped to only
// this student's payment ids with ref_type='refund' AND status='active' (matches
// getRefundedAmount exactly). Also proves the Decimal→Number / date normalizations match
// db.middleware.js's COLLECTION_FIXUPS for the same fields exactly.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('studentReport.js — getStudentReportData (real PostgreSQL integration)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, getStudentReportData;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('student_report');
    client = scratch.client;
    ({ getStudentReportData } = await import('./studentReport.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedStudent(overrides = {}) {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'أشرف محمد', status: 'active', ...overrides } });
  }

  async function seedGroup(overrides = {}) {
    const id = nextId('g');
    return client.groups.create({ data: { id, name: 'مجموعة اختبار', price: 300, ...overrides } });
  }

  it('A. brand-new student with zero activity: every scoped array is empty, student/group still returned', async () => {
    const student = await seedStudent();
    const data = await getStudentReportData(student.id);

    expect(data.students).toHaveLength(1);
    expect(data.students[0].id).toBe(student.id);
    expect(data.groups).toEqual([]);
    expect(data.attendance).toEqual([]);
    expect(data.grades).toEqual([]);
    expect(data.exams).toEqual([]);
    expect(data.hwSubmissions).toEqual([]);
    expect(data.payments).toEqual([]);
    expect(data.treasuryTxn).toEqual([]);
    expect(data.communications).toEqual([]);
    expect(data.inventoryTxn).toEqual([]);
    expect(data.invMaterials).toEqual([]);
    expect(data.homeworks).toEqual([]); // no grade set — no query attempted, matches no homework
  });

  it('rejects a nonexistent student', async () => {
    await expect(getStudentReportData('nonexistent-student-id')).rejects.toThrow('الطالب غير موجود.');
  });

  it('B. attendance/grades/hwSubmissions/payments scope strictly by student_id — another student\'s rows never leak in', async () => {
    const group = await seedGroup();
    const student = await seedStudent({ group_id: group.id });
    const other = await seedStudent({ group_id: group.id });

    await client.attendance.create({ data: { id: nextId('att'), student_id: student.id, group_id: group.id, date: new Date('2026-01-05'), status: 'present' } });
    await client.attendance.create({ data: { id: nextId('att'), student_id: other.id, group_id: group.id, date: new Date('2026-01-05'), status: 'absent' } });

    const exam = await client.exams.create({ data: { id: nextId('ex'), name: 'اختبار', group_id: group.id, date: new Date('2026-01-10'), total: 100, pass: 50 } });
    await client.grades.create({ data: { id: nextId('gr'), exam_id: exam.id, student_id: student.id, score: 85 } });
    await client.grades.create({ data: { id: nextId('gr'), exam_id: exam.id, student_id: other.id, score: 40 } });

    const hw = await client.homeworks.create({ data: { id: nextId('hw'), title: 'واجب', group_id: group.id, due_date: new Date('2026-01-15') } });
    await client.hw_submissions.create({ data: { id: nextId('sub'), homework_id: hw.id, student_id: student.id, status: 'submitted' } });
    await client.hw_submissions.create({ data: { id: nextId('sub'), homework_id: hw.id, student_id: other.id, status: 'missing' } });

    const cashbox = await client.cashboxes.create({ data: { id: nextId('cb'), name: 'خزنة', active: true } });
    await client.payments.create({ data: { id: nextId('p'), student_id: student.id, month: 1, year: 2026, amount: 300, pay_type: 'subscription', date: new Date('2026-01-05'), status: 'paid' } });
    await client.payments.create({ data: { id: nextId('p'), student_id: other.id, month: 1, year: 2026, amount: 300, pay_type: 'subscription', date: new Date('2026-01-05'), status: 'paid' } });
    void cashbox;

    const data = await getStudentReportData(student.id);

    expect(data.attendance).toHaveLength(1);
    expect(data.attendance[0].studentId).toBe(student.id);
    expect(data.grades).toHaveLength(1);
    expect(data.grades[0].studentId).toBe(student.id);
    expect(Number(data.grades[0].score)).toBe(85); // Decimal→Number normalized
    expect(data.exams).toHaveLength(1); // only exams referenced by this student's grades
    expect(Number(data.exams[0].total)).toBe(100);
    expect(Number(data.exams[0].pass)).toBe(50);
    expect(data.hwSubmissions).toHaveLength(1);
    expect(data.hwSubmissions[0].studentId).toBe(student.id);
    expect(data.payments).toHaveLength(1);
    expect(Number(data.payments[0].amount)).toBe(300);
    expect(typeof data.payments[0].date).toBe('string');
    expect(data.payments[0].date).toBe('2026-01-05'); // plain YYYY-MM-DD, matches normalizeDateOnly
  });

  it('C. communications match by (phone === parentPhone) OR (studentName === name) — NOT student_id, matching the current frontend rule exactly', async () => {
    const student = await seedStudent({ parent_phone: '01011112222' });

    // مطابقة بالهاتف فقط (لا اسم مطابق)
    await client.communications.create({
      data: { id: nextId('c'), number: nextId('CN'), type: 'call', result: 'ok', phone: '01011112222', student_name: 'اسم مختلف تماماً' },
    });
    // مطابقة بالاسم فقط (لا هاتف مطابق)
    await client.communications.create({
      data: { id: nextId('c'), number: nextId('CN'), type: 'call', result: 'ok', phone: '09999999999', student_name: 'أشرف محمد' },
    });
    // لا تطابق إطلاقاً
    await client.communications.create({
      data: { id: nextId('c'), number: nextId('CN'), type: 'call', result: 'ok', phone: '08888888888', student_name: 'طالب آخر' },
    });
    // student_id حقيقي يشير لهذا الطالب لكن بلا تطابق هاتف/اسم — يجب ألا يُطابَق (نفس
    // القاعدة الحالية بالضبط، رغم وجود العمود)
    await client.communications.create({
      data: { id: nextId('c'), number: nextId('CN'), type: 'call', result: 'ok', phone: '07777777777', student_name: 'اسم غير مطابق', student_id: student.id },
    });

    const data = await getStudentReportData(student.id);
    expect(data.communications).toHaveLength(2);
  });

  it('D. booklet deliveries (inventory_txn) match by student_id OR legacy recipient-name substring, enriched with the referenced material', async () => {
    const student = await seedStudent();
    const material = await client.inv_materials.create({ data: { code: nextId('MAT'), name: 'مذكرة الرياضيات', price: 200 } });

    await client.inventory_txn.create({
      data: { id: nextId('inv'), number: nextId('INV'), material_id: material.id, type: 'studentDelivery', quantity: 1, student_id: student.id },
    });
    // حركة قديمة قبل ربط student_id — تُطابَق فقط عبر الاسم في recipient
    await client.inventory_txn.create({
      data: { id: nextId('inv'), number: nextId('INV'), material_id: material.id, type: 'studentDelivery', quantity: 1, student_id: null, recipient: 'استلم أشرف محمد نسخته' },
    });
    // Phase 4 (StudentReportPage التفاعلية): type يشمل الآن MATDIST_RELEVANT_TXN_TYPES
    // كاملة (studentDelivery/reservation/reservationRelease/return) لا studentDelivery
    // فقط — deriveMatDist (المُستهلِك الجديد لهذا الحقل في buildInteractiveReportData)
    // يحتاج الأنواع الأربعة ليحدّد آخر حالة نشطة فعلياً لكل (مذكرة،طالب)؛ إضافي بحت:
    // gatherStudentData's bookletDeliveries (المُستهلِك الحالي الوحيد سابقاً) يستبعد أي
    // صف type !== 'studentDelivery' بنفسها، فلا يتغيّر سلوكها إطلاقاً.
    await client.inventory_txn.create({
      data: { id: nextId('inv'), number: nextId('INV'), material_id: material.id, type: 'reservation', quantity: 1, student_id: student.id },
    });
    // نوع غير ذي صلة إطلاقاً (لا في MATDIST_RELEVANT_TXN_TYPES) — يبقى مستبعَداً
    await client.inventory_txn.create({
      data: { id: nextId('inv'), number: nextId('INV'), material_id: material.id, type: 'purchase', quantity: 1, student_id: student.id },
    });

    const data = await getStudentReportData(student.id);
    expect(data.inventoryTxn).toHaveLength(3); // studentDelivery×2 + reservation×1، لا purchase
    expect(data.inventoryTxn.every((t) => t.type !== 'purchase')).toBe(true);
    expect(data.invMaterials).toHaveLength(1);
    expect(data.invMaterials[0].id).toBe(String(material.id));
    expect(typeof data.invMaterials[0].price).toBe('number'); // Decimal→Number (COLLECTION_FIXUPS.invMaterials)
    expect(data.invMaterials[0].price).toBe(200);
  });

  it('F. homeworks: scoped to the student\'s own grade (Homework 2.0 — not Group), includes every matching-grade homework even with no submission, Decimal/date fields normalized', async () => {
    const GRADE = 'الصف الأول الثانوي';
    const OTHER_GRADE = 'الصف الثاني الثانوي';
    const student = await seedStudent({ grade: GRADE });

    const hw1 = await client.homeworks.create({ data: { id: nextId('hw'), title: 'واجب 1', grade: GRADE, due_date: new Date('2026-01-15'), total_score: 12.5 } });
    // واجب ثانٍ لنفس الصف، بلا أي تسليم لهذا الطالب إطلاقاً — يجب أن يظهر رغم ذلك
    const hw2 = await client.homeworks.create({ data: { id: nextId('hw'), title: 'واجب 2', grade: GRADE, due_date: new Date('2026-01-20') } });
    // واجب صف آخر — يجب استبعاده (لا علاقة بأي مجموعة — لاحظ: بلا group_id إطلاقاً هنا،
    // يثبت أن الفرز الآن بالصف فقط لا بالمجموعة التاريخية)
    await client.homeworks.create({ data: { id: nextId('hw'), title: 'واجب صف آخر', grade: OTHER_GRADE, due_date: new Date('2026-01-18') } });

    await client.hw_submissions.create({
      data: { id: nextId('sub'), homework_id: hw1.id, student_id: student.id, status: 'submitted', score: 9.5, submitted_at: new Date('2026-01-14') },
    });

    const data = await getStudentReportData(student.id);

    expect(data.homeworks).toHaveLength(2); // hw1 + hw2 فقط — لا واجب المجموعة الأخرى
    expect(data.homeworks.map((h) => h.id).sort()).toEqual([hw1.id, hw2.id].sort());
    const fixedHw1 = data.homeworks.find((h) => h.id === hw1.id);
    expect(typeof fixedHw1.totalScore).toBe('number'); // Decimal→Number
    expect(fixedHw1.totalScore).toBe(12.5);
    expect(fixedHw1.dueDate).toBe('2026-01-15'); // date-only، لا طابع زمني كامل

    expect(data.hwSubmissions).toHaveLength(1);
    expect(data.hwSubmissions[0].hwId).toBe(hw1.id); // homeworkId أُعيدَ تسميته hwId
    expect(typeof data.hwSubmissions[0].score).toBe('number');
    expect(data.hwSubmissions[0].score).toBe(9.5);
    expect(data.hwSubmissions[0].submittedAt).toBe('2026-01-14'); // date-only أيضاً
  });

  it('E. refund treasury_txn scoped to this student\'s payments only, ref_type=refund AND status=active — cancelled/other-ref rows excluded', async () => {
    const student = await seedStudent();
    const cashbox = await client.cashboxes.create({ data: { id: nextId('cb'), name: 'خزنة', active: true } });
    const treasuryTxn1 = await client.treasury_txn.create({
      data: { id: nextId('tx'), cashbox_id: cashbox.id, date: new Date('2026-01-05'), type: 'income', category: 'subscriptions', amount: 300, ref_type: 'payment' },
    });
    const payment = await client.payments.create({
      data: { id: nextId('p'), student_id: student.id, month: 1, year: 2026, amount: 300, pay_type: 'subscription', date: new Date('2026-01-05'), status: 'paid', treasury_txn_id: treasuryTxn1.id },
    });

    // استرداد فعّال حقيقي — يجب أن يُحتسَب
    await client.treasury_txn.create({
      data: { id: nextId('tx'), cashbox_id: cashbox.id, date: new Date('2026-01-10'), type: 'expense', category: 'refund', amount: 100, ref_type: 'refund', ref_id: payment.id, payment_id: payment.id, status: 'active' },
    });
    // استرداد مُلغى — يجب استبعاده
    await client.treasury_txn.create({
      data: { id: nextId('tx'), cashbox_id: cashbox.id, date: new Date('2026-01-11'), type: 'expense', category: 'refund', amount: 50, ref_type: 'refund', ref_id: payment.id, payment_id: payment.id, status: 'cancelled' },
    });
    // حركة دخل عادية لنفس الدفعة (ref_type='payment') — ليست استرداداً، يجب استبعادها
    // (هذه هي نفس treasuryTxn1 المرتبطة بالفعل عبر payment_id على الدفعة، غير ذات صلة هنا)

    const data = await getStudentReportData(student.id);
    expect(data.payments).toHaveLength(1);
    // فقط حركة الاسترداد الفعّالة (100) — لا حركة الدفع الأصلية (ref_type='payment')، ولا
    // حركة الاسترداد الملغاة
    expect(data.treasuryTxn).toHaveLength(1);
    expect(Number(data.treasuryTxn[0].amount)).toBe(100);
    expect(data.treasuryTxn[0].refType).toBe('refund');
    expect(data.treasuryTxn[0].status).toBe('active');
  });
});
