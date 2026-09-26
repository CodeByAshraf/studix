// backend/src/routes/studentReport.integration.test.js
// Scalability Architecture Phase 2 — real PostgreSQL integration (scratch database only).
// Proves getStudentReportData's scoped queries reproduce exactly the same matching rules
// gatherStudentData (src/modules/student-report/reportData.js) currently applies on the
// full, unscoped arrays — attendance/grades/hw_submissions/payments by student_id,
// communications by student_id OR (phone OR student_name) (Pre-Installer Audit D1 —
// this WHERE is deliberately inclusive of all three; gatherStudentData itself makes the
// exclusive per-row decision: student_id wins alone when present, phone/name is only a
// fallback for rows with none), inventory_txn (booklet deliveries) by (student_id OR
// legacy recipient-name substring), and refund treasury_txn scoped to only this student's
// payment ids with ref_type='refund' AND status='active' (matches getRefundedAmount
// exactly). Also proves the Decimal→Number / date normalizations match db.middleware.js's
// COLLECTION_FIXUPS for the same fields exactly.
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
    expect(data.parents).toEqual([]); // no parent_id set
    expect(data.enrollments).toEqual([]); // no student_group_enrollments rows
    expect(data.admissions).toEqual([]); // no linked admission
    expect(data.recitations).toEqual([]);
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

  it('C. communications match by student_id (Pre-Installer Audit D1) OR (phone === parentPhone) OR (studentName === name)', async () => {
    const student = await seedStudent({ parent_phone: '01011112222' });

    // مطابقة بالهاتف فقط (لا اسم مطابق، لا student_id)
    await client.communications.create({
      data: { id: nextId('c'), number: nextId('CN'), type: 'call', result: 'ok', phone: '01011112222', student_name: 'اسم مختلف تماماً' },
    });
    // مطابقة بالاسم فقط (لا هاتف مطابق، لا student_id)
    await client.communications.create({
      data: { id: nextId('c'), number: nextId('CN'), type: 'call', result: 'ok', phone: '09999999999', student_name: 'أشرف محمد' },
    });
    // لا تطابق إطلاقاً
    await client.communications.create({
      data: { id: nextId('c'), number: nextId('CN'), type: 'call', result: 'ok', phone: '08888888888', student_name: 'طالب آخر' },
    });
    // student_id حقيقي يشير لهذا الطالب لكن بلا تطابق هاتف/اسم — يجب أن يُطابَق الآن
    // (D1: هذا بالضبط هو السجل الذي كان يختفي صامتاً من التقرير قبل الإصلاح، رغم كونه
    // مرتبطاً بالطالب فعلياً عبر student_id).
    await client.communications.create({
      data: { id: nextId('c'), number: nextId('CN'), type: 'call', result: 'ok', phone: '07777777777', student_name: 'اسم غير مطابق', student_id: student.id },
    });

    const data = await getStudentReportData(student.id);
    expect(data.communications).toHaveLength(3);
    expect(data.communications.some((c) => c.studentId === student.id && c.phone === '07777777777')).toBe(true);
  });

  it("C2. a communication's student_id belonging to a DIFFERENT student is still included in this student's bundle when it also matches the phone (the bundle stays inclusive; gatherStudentData makes the exclusive final call)", async () => {
    const student = await seedStudent({ parent_phone: '01033334444', name: 'طالب فريد C2 الأول' });
    const otherStudent = await seedStudent({ parent_phone: '01033334444', name: 'طالب فريد C2 الثاني' });

    // student_id لطالب آخر، لكن الهاتف يطابق ولي أمر هذا الطالب (مثال: أشقّاء بنفس الهاتف).
    await client.communications.create({
      data: { id: nextId('c'), number: nextId('CN'), type: 'call', result: 'ok', phone: '01033334444', student_name: 'اسم لا يطابق أحداً', student_id: otherStudent.id },
    });

    const data = await getStudentReportData(student.id);
    expect(data.communications).toHaveLength(1);
    expect(data.communications[0].studentId).toBe(otherStudent.id);
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

  // Professional Report audit fix (Phase 1, item 2) — parent name.
  it('G. parent: resolved via the real parentId FK, not duplicated onto students; absent when unlinked', async () => {
    const parent = await client.parents.create({ data: { full_name: 'أحمد حسن', phone: nextId('phone') } });
    const student = await seedStudent({ parent_id: parent.id });

    const data = await getStudentReportData(student.id);
    expect(data.parents).toHaveLength(1);
    expect(data.parents[0].fullName).toBe('أحمد حسن');
    expect(data.parents[0].id).toBe(String(parent.id)); // BigInt -> serialized string (serializeBigInt)

    const unlinked = await seedStudent(); // no parent_id at all
    const data2 = await getStudentReportData(unlinked.id);
    expect(data2.parents).toEqual([]);
  });

  // Professional Report audit fix (Phase 1, item 5) — Additional Groups.
  it('H. enrollments: ALL of this student\'s rows returned (active AND historical/withdrawn), scoped strictly by student_id, referenced groups included in bundle.groups', async () => {
    const primaryGroup = await seedGroup({ name: 'المجموعة الرئيسية' });
    const additionalGroup = await seedGroup({ name: 'مجموعة إضافية', teacher_name: 'أ. سارة' });
    const oldGroup = await seedGroup({ name: 'مجموعة قديمة' });
    const student = await seedStudent({ group_id: primaryGroup.id });
    const otherStudent = await seedStudent({ group_id: primaryGroup.id });

    await client.student_group_enrollments.create({
      data: {
        id: nextId('en'), student_id: student.id, group_id: additionalGroup.id,
        role: 'additional', status: 'active', start_date: new Date('2026-01-10'),
      },
    });
    await client.student_group_enrollments.create({
      data: {
        id: nextId('en'), student_id: student.id, group_id: oldGroup.id,
        role: 'additional', status: 'withdrawn',
        start_date: new Date('2025-01-01'), end_date: new Date('2025-06-01'),
      },
    });
    // إن كانت لطالب آخر — يجب ألا تظهر إطلاقاً هنا (نفس مبدأ عزل student_id في الاختبار B)
    await client.student_group_enrollments.create({
      data: {
        id: nextId('en'), student_id: otherStudent.id, group_id: additionalGroup.id,
        role: 'additional', status: 'active', start_date: new Date('2026-01-10'),
      },
    });

    const data = await getStudentReportData(student.id);
    expect(data.enrollments).toHaveLength(2); // النشط + التاريخي معاً، لا النشط فقط
    const byStatus = Object.fromEntries(data.enrollments.map((e) => [e.status, e]));
    expect(byStatus.active.groupId).toBe(additionalGroup.id);
    expect(byStatus.withdrawn.groupId).toBe(oldGroup.id);
    expect(byStatus.withdrawn.endDate).toBe('2025-06-01'); // تُعاد كنص "YYYY-MM-DD"، لا Date كامل

    // bundle.groups يشمل المجموعة الرئيسية + كل مجموعة أشار إليها تسجيل إضافي (وإلا فشل
    // البحث عنها في additionalGroupsSection صامتاً بجهة الفرونت-إند)
    const groupIds = data.groups.map((g) => g.id);
    expect(groupIds).toContain(primaryGroup.id);
    expect(groupIds).toContain(additionalGroup.id);
    expect(groupIds).toContain(oldGroup.id);
    const additionalGroupRow = data.groups.find((g) => g.id === additionalGroup.id);
    expect(additionalGroupRow.teacherName).toBe('أ. سارة');
  });

  it('I. a student with no enrollments/parent at all: empty arrays, not an error', async () => {
    const student = await seedStudent();
    const data = await getStudentReportData(student.id);
    expect(data.enrollments).toEqual([]);
    expect(data.parents).toEqual([]);
  });

  // Student Report Phase 2 — Admissions Summary.
  it('J. admission: resolved via the real studentId FK (admissions.student_id), never by name/phone matching', async () => {
    const student = await seedStudent();
    const admission = await client.admissions.create({
      data: {
        id: nextId('adm'), number: nextId('A'), name: 'اسم مختلف عن الطالب تماماً',
        student_id: student.id, stage: 'active', source: 'فيسبوك',
        reservation_date: new Date('2025-12-01'),
      },
    });

    const data = await getStudentReportData(student.id);
    expect(data.admissions).toHaveLength(1);
    expect(data.admissions[0].id).toBe(admission.id);
    expect(data.admissions[0].stage).toBe('active');
    expect(data.admissions[0].source).toBe('فيسبوك');
    expect(data.admissions[0].reservationDate).toBe('2025-12-01'); // date-only string, not a full Date
  });

  it('K. admission scoping: another student\'s admission never leaks in, matched strictly by student_id', async () => {
    const student = await seedStudent();
    const otherStudent = await seedStudent();
    await client.admissions.create({
      data: { id: nextId('adm'), number: nextId('A'), name: 'قبول طالب آخر', student_id: otherStudent.id, stage: 'active' },
    });

    const data = await getStudentReportData(student.id);
    expect(data.admissions).toEqual([]);
  });

  it('L. a student with no linked admission at all: empty array, not an error', async () => {
    const student = await seedStudent();
    const data = await getStudentReportData(student.id);
    expect(data.admissions).toEqual([]);
  });

  it('M. multiple admissions for the same student (re-admission): only the most recent one is returned', async () => {
    const student = await seedStudent();
    await client.admissions.create({
      data: { id: nextId('adm'), number: nextId('A'), name: 'قبول أول', student_id: student.id, stage: 'active', created_at: new Date('2024-01-01') },
    });
    const latest = await client.admissions.create({
      data: { id: nextId('adm'), number: nextId('A'), name: 'قبول أحدث', student_id: student.id, stage: 'active', created_at: new Date('2026-01-01') },
    });

    const data = await getStudentReportData(student.id);
    expect(data.admissions).toHaveLength(1);
    expect(data.admissions[0].id).toBe(latest.id);
  });

  it('N. recitations: scoped strictly by student_id, group name included, Decimal/date normalized, sorted newest-first, multiple sessions stay separate rows', async () => {
    const group = await seedGroup({ name: 'مجموعة التسميع' });
    const student = await seedStudent();
    const other = await seedStudent();

    const session1 = await client.attendance_sessions.create({
      data: { id: nextId('sess'), group_id: group.id, date: new Date('2026-01-03'), session_time: '09:00', status: 'completed', max_score: 10 },
    });
    const session2 = await client.attendance_sessions.create({
      data: { id: nextId('sess'), group_id: group.id, date: new Date('2026-01-10'), session_time: '10:00', status: 'completed', max_score: 20 },
    });

    await client.recitations.create({
      data: { id: nextId('rec'), session_id: session1.id, student_id: student.id, group_id: group.id, date: session1.date, score: 7, max_score: 10, note: 'جيد جداً' },
    });
    await client.recitations.create({
      data: { id: nextId('rec'), session_id: session2.id, student_id: student.id, group_id: group.id, date: session2.date, score: 18, max_score: 20 },
    });
    // another student's recitation in the same session — must never leak into `student`'s bundle
    await client.recitations.create({
      data: { id: nextId('rec'), session_id: session1.id, student_id: other.id, group_id: group.id, date: session1.date, score: 5, max_score: 10 },
    });

    const data = await getStudentReportData(student.id);

    expect(data.recitations).toHaveLength(2); // both of this student's sessions, not merged/aggregated
    // newest first
    expect(data.recitations[0].date).toBe('2026-01-10');
    expect(data.recitations[1].date).toBe('2026-01-03');
    // Decimal -> real number, not a string
    expect(data.recitations[0].score).toBe(18);
    expect(data.recitations[0].maxScore).toBe(20);
    expect(typeof data.recitations[0].score).toBe('number');
    // group name available without a separate query
    expect(data.recitations[1].groupName).toBe('مجموعة التسميع');
    expect(data.recitations[1].note).toBe('جيد جداً');
    // sessionTime available via the attendance_sessions relationship
    expect(data.recitations[0].sessionTime).toBe('10:00');
    expect(data.recitations[1].sessionTime).toBe('09:00');
    // no cross-student leakage
    expect(data.recitations.some((r) => r.studentId === other.id)).toBe(false);
  });
});
