// src/modules/materials/buildMaterialsReport.test.js
// New feature — printable materials/booklets receipt report. Reuses printStyles.js (the
// same unified print system already proven by buildPaymentsReport.js/buildExamReport.js)
// and deriveMatDist (materialService.js) — no new print engine, no new financial formula,
// no new eligibility model. Eligibility stays grade-first (student.grade === material.grade),
// with group as a purely optional secondary narrowing filter, exactly as
// MaterialDistribution.jsx already establishes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openMaterialReportPrint } from './buildMaterialsReport';
import { fmtMoney } from '../../utils/printStyles';

let writtenHtml;
function mockWindow() {
  writtenHtml = '';
  const win = { document: { open: vi.fn(), write: vi.fn((html) => { writtenHtml += html; }), close: vi.fn() }, focus: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(win);
  return win;
}

const MATERIAL = { id: 'm1', name: 'مذكرة الجبر', subject: 'رياضيات', grade: 'الأول الثانوي', price: 100, teacher: 'أ. محمد' };
const GROUP_A  = { id: 'g1', name: 'مجموعة أ' };
const GROUP_B  = { id: 'g2', name: 'مجموعة ب' };

// s1: group A, received+paid in full. s2: group A, received but only partially paid.
// s3: group B, same grade, never received/unpaid. s4: different grade entirely — must never
// appear regardless of group, proving grade-eligibility is the primary rule.
const STUDENTS = [
  { id: 's1', name: 'أحمد علي',  code: 'C001', groupId: 'g1', status: 'active', grade: 'الأول الثانوي' },
  { id: 's2', name: 'سارة محمد', code: 'C002', groupId: 'g1', status: 'active', grade: 'الأول الثانوي' },
  { id: 's3', name: 'خالد سعيد', code: 'C003', groupId: 'g2', status: 'active', grade: 'الأول الثانوي' },
  { id: 's4', name: 'منى فتحي',  code: 'C004', groupId: 'g1', status: 'active', grade: 'الثاني الثانوي' },
];

function txn(id, studentId, overrides = {}) {
  return {
    id, materialId: 'm1', studentId, type: 'studentDelivery', status: 'active',
    createdAt: '2026-01-05T10:00:00Z', quantity: 1,
    legacyMetadata: { receivedAt: '2026-01-05', payStatus: 'unpaid', paidAmount: 0, ...overrides },
  };
}

const INVENTORY_TXN = [
  txn('t1', 's1', { payStatus: 'paid', paidAmount: 100 }),
  txn('t2', 's2', { payStatus: 'partial', paidAmount: 40 }),
  // s3/s4: no transaction at all -> untouched default (لم يستلم/غير مدفوع)
];

describe('openMaterialReportPrint — eligibility, distribution/payment data, and print header', () => {
  beforeEach(() => { mockWindow(); });

  it('with no group filter: includes every active student matching the material grade, across groups', () => {
    openMaterialReportPrint({ material: MATERIAL, students: STUDENTS, inventoryTxn: INVENTORY_TXN, profile: {} });
    expect(writtenHtml).toContain('أحمد علي');
    expect(writtenHtml).toContain('سارة محمد');
    expect(writtenHtml).toContain('خالد سعيد'); // مجموعة أخرى لكن نفس الصف — مؤهَّل
    expect(writtenHtml).not.toContain('منى فتحي'); // صف مختلف — غير مؤهَّلة رغم نفس المجموعة
  });

  it('with a group filter: narrows to that group only, without changing the underlying grade eligibility rule', () => {
    openMaterialReportPrint({ material: MATERIAL, group: GROUP_A, students: STUDENTS, inventoryTxn: INVENTORY_TXN, profile: {} });
    expect(writtenHtml).toContain('أحمد علي');
    expect(writtenHtml).toContain('سارة محمد');
    expect(writtenHtml).not.toContain('خالد سعيد'); // مجموعة ب مستبعدة بالفلتر الاختياري
    expect(writtenHtml).not.toContain('منى فتحي');  // صف مختلف — يبقى مستبعداً دائماً
  });

  it('a different group filter (group B) still applies the same grade rule, showing only that group\'s eligible student', () => {
    openMaterialReportPrint({ material: MATERIAL, group: GROUP_B, students: STUDENTS, inventoryTxn: INVENTORY_TXN, profile: {} });
    expect(writtenHtml).toContain('خالد سعيد');
    expect(writtenHtml).not.toContain('أحمد علي');
    expect(writtenHtml).not.toContain('سارة محمد');
  });

  it('received/not-received states render correctly per student', () => {
    openMaterialReportPrint({ material: MATERIAL, students: STUDENTS, inventoryTxn: INVENTORY_TXN, profile: {} });
    // s1/s2 استلموا (لهما حركة studentDelivery)، s3 لم يستلم (بلا أي حركة)
    const rows = writtenHtml.split('<tr>').slice(1);
    const s1Row = rows.find(r => r.includes('أحمد علي'));
    const s3Row = rows.find(r => r.includes('خالد سعيد'));
    expect(s1Row).toContain('استلم');
    expect(s3Row).toContain('لم يستلم');
  });

  it('paid/partial/unpaid calculations: charged = material.price, paid = dist.paidAmount, remaining = price - paid', () => {
    openMaterialReportPrint({ material: MATERIAL, students: STUDENTS, inventoryTxn: INVENTORY_TXN, profile: {} });
    const rows = writtenHtml.split('<tr>').slice(1);

    const s1Row = rows.find(r => r.includes('أحمد علي')); // paid in full: 100/100, remaining 0
    expect(s1Row).toContain(fmtMoney(100));
    expect(s1Row).toContain('مدفوع');

    const s2Row = rows.find(r => r.includes('سارة محمد')); // partial: paid 40, remaining 60
    expect(s2Row).toContain(fmtMoney(40));
    expect(s2Row).toContain(fmtMoney(60));
    expect(s2Row).toContain('مدفوع جزئياً');

    const s3Row = rows.find(r => r.includes('خالد سعيد')); // never touched: unpaid, remaining = full price
    expect(s3Row).toContain('غير مدفوع');
    expect(s3Row).toContain(fmtMoney(100));
  });

  it('KPI "collected" sums exactly the paid amounts (100 + 40 = 140), matching per-row figures', () => {
    openMaterialReportPrint({ material: MATERIAL, students: STUDENTS, inventoryTxn: INVENTORY_TXN, profile: {} });
    expect(writtenHtml).toContain(fmtMoney(140));
  });

  it('centerProfile.name renders exactly as entered in the report header (no derived initials)', () => {
    openMaterialReportPrint({ material: MATERIAL, students: STUDENTS, inventoryTxn: INVENTORY_TXN, profile: { name: 'م خالد جمعه' } });
    expect(writtenHtml).toContain('م خالد جمعه');
    expect(writtenHtml).not.toContain('مخ خالد جمعه');
    expect(writtenHtml).not.toContain('class="rh-logo rh-logo-ph"');
  });

  it('shows material metadata (name, subject, grade) and an honest empty state with zero eligible students', () => {
    openMaterialReportPrint({ material: MATERIAL, students: [], inventoryTxn: [], profile: {} });
    expect(writtenHtml).toContain('مذكرة الجبر');
    expect(writtenHtml).toContain('رياضيات');
    expect(writtenHtml).toContain('الأول الثانوي');
    expect(writtenHtml).toContain('لا يوجد طلاب مؤهَّلون لهذه المذكرة');
  });

  it('does nothing (no window opened) when no material is given', () => {
    openMaterialReportPrint({ material: null, students: STUDENTS, inventoryTxn: INVENTORY_TXN, profile: {} });
    expect(window.open).not.toHaveBeenCalled();
  });
});
