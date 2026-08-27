// src/modules/payments/buildPaymentsReport.js
// ─────────────────────────────────────────────────────────────────────────────
// تقرير المدفوعات والمتأخرين — لمجموعة محددة وشهر محدد.
// يستخدم النظام الموحّد للطباعة (printStyles) لضمان مظهر احترافي فاتح متناسق.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PALETTE, esc, fmtDateShort, fmtMoney,
  basePrintCSS, reportHeaderHTML, reportFooterHTML,
  kpiHTML, sectionTitleHTML, badgeHTML, toolbarHTML,
} from '../../utils/printStyles';
import { PAYMENT_METHODS, PAYMENT_TYPES, getStudentFee, getRefundedAmount } from '../../services/paymentService';

const MONTHS_AR = ['', 'يناير','فبراير','مارس','أبريل','مايو','يونيو',
                   'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

// Phase 3B-14C (Decision 1 — توحيد مفردة الدفع): مصدر واحد فقط لتسميات الطريقة/النوع —
// paymentService.js's PAYMENT_METHODS/PAYMENT_TYPES — بدل قائمة مستقلة هنا كانت قد
// انحرفت عنها (كانت تحوي visa+check معاً، بينما نموذج الدفع الفعلي لا يعرض check).
const PAY_METHOD = Object.fromEntries(Object.entries(PAYMENT_METHODS).map(([k, v]) => [k, v.label]));
const STATUS_META = {
  paid:    { l:'مدفوع',      c:PALETTE.green },
  partial: { l:'دفع جزئي',   c:PALETTE.amber },
  unpaid:  { l:'غير مدفوع',  c:PALETTE.red },
};

/**
 * @param {object} args
 * @param {object} args.group     المجموعة المختارة
 * @param {number} args.month     رقم الشهر (1-12)
 * @param {number} args.year      السنة
 * @param {array}  args.students  كل الطلاب
 * @param {array}  args.payments  كل المدفوعات
 * @param {object} args.profile   بيانات المركز
 * @param {array}  args.treasuryTxn حركات الخزنة (لطرح أي استرداد فعّال من "المحصّل")
 */
export function openPaymentsReportPrint({ group, month, year, students, payments, profile, treasuryTxn = [] }) {
  if (!group) return;

  const monthName = MONTHS_AR[month] || `شهر ${month}`;
  const groupStudents = students.filter(s => s.groupId === group.id && s.status === 'active');

  // لكل طالب: نجمع مدفوعاته لهذا الشهر ونحدد حالته حسب رسومه الفردية.
  const rows = groupStudents.map(s => {
    const price = getStudentFee(s, group); // رسوم الطالب الفردية (أو سعر المجموعة احتياطياً)
    const studentPays = payments.filter(p =>
      p.studentId === s.id &&
      p.month === month &&
      (p.year === year || p.date?.startsWith(`${year}`)) &&
      (p.payType || 'subscription') === 'subscription'
    );
    // BUG-02: صافي بعد طرح أي استرداد فعّال — يقود هذا الرقم حالة كل طالب (مدفوع/جزئي/
    // غير مدفوع) وقائمة المتأخرين معاً، فيجب أن يُشتقّا كلاهما من نفس المبلغ الصافي.
    const totalPaid = studentPays.reduce((sum, p) => sum + (Number(p.amount) || 0) - getRefundedAmount(p.id, treasuryTxn), 0);
    let status = 'unpaid';
    if (totalPaid >= price && price > 0) status = 'paid';
    else if (totalPaid > 0)             status = 'partial';
    const lastPay = studentPays.sort((a,b) => new Date(b.date) - new Date(a.date))[0];
    return {
      student: s,
      totalPaid,
      remaining: Math.max(0, price - totalPaid),
      status,
      method: lastPay?.method,
      date: lastPay?.date,
    };
  });

  // إحصائيات
  const paidRows    = rows.filter(r => r.status === 'paid');
  const partialRows = rows.filter(r => r.status === 'partial');
  const unpaidRows  = rows.filter(r => r.status === 'unpaid');
  const collected   = rows.reduce((s, r) => s + r.totalPaid, 0);
  const expected    = groupStudents.reduce((sum, s) => sum + getStudentFee(s, group), 0);
  const collectRate = expected > 0 ? Math.round(collected / expected * 100) : 0;

  // جدول كل الطلاب
  const allRows = rows.map(r => {
    const st = STATUS_META[r.status];
    return `
      <tr>
        <td>${esc(r.student.name)}</td>
        <td>${esc(r.student.code)}</td>
        <td class="num">${fmtMoney(r.totalPaid)}</td>
        <td class="num">${r.remaining > 0 ? `<span style="color:${PALETTE.red};font-weight:700">${fmtMoney(r.remaining)}</span>` : '—'}</td>
        <td class="num">${r.method ? esc(PAY_METHOD[r.method] || r.method) : '—'}</td>
        <td class="num">${r.date ? fmtDateShort(r.date) : '—'}</td>
        <td class="num">${badgeHTML(st.l, st.c)}</td>
      </tr>`;
  }).join('');

  // جدول المتأخرين فقط (غير مدفوع + جزئي)
  const lateRows = [...unpaidRows, ...partialRows].map(r => {
    const st = STATUS_META[r.status];
    return `
      <tr>
        <td>${esc(r.student.name)}</td>
        <td>${esc(r.student.code)}</td>
        <td>${esc(r.student.phone || '—')}</td>
        <td>${esc(r.student.parentPhone || '—')}</td>
        <td class="num" style="color:${PALETTE.red};font-weight:700">${fmtMoney(r.remaining)}</td>
        <td class="num">${badgeHTML(st.l, st.c)}</td>
      </tr>`;
  }).join('');

  const bodyHTML = `
    ${reportHeaderHTML(profile)}
    <div class="report-title">تقرير المدفوعات — ${esc(group.name)} — ${esc(monthName)} ${esc(String(year))}</div>

    <div class="kpi-row">
      ${kpiHTML('المحصّل', fmtMoney(collected), PALETTE.green, `من ${fmtMoney(expected)}`)}
      ${kpiHTML('نسبة التحصيل', collectRate + '%', collectRate >= 80 ? PALETTE.green : collectRate >= 50 ? PALETTE.amber : PALETTE.red)}
      ${kpiHTML('دفعوا بالكامل', `${paidRows.length}/${groupStudents.length}`, PALETTE.green)}
      ${kpiHTML('متأخرون', unpaidRows.length + partialRows.length, PALETTE.red, `${unpaidRows.length} لم يدفع · ${partialRows.length} جزئي`)}
    </div>

    <div class="section avoid-break">
      ${sectionTitleHTML('💰', 'كل الطلاب', groupStudents.length)}
      <table class="report-table">
        <thead><tr>
          <th>الطالب</th><th>الكود</th><th class="num">المدفوع</th><th class="num">المتبقي</th>
          <th class="num">الطريقة</th><th class="num">التاريخ</th><th class="num">الحالة</th>
        </tr></thead>
        <tbody>${allRows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8">لا يوجد طلاب</td></tr>'}</tbody>
      </table>
    </div>

    ${(unpaidRows.length + partialRows.length) > 0 ? `
    <div class="section avoid-break">
      ${sectionTitleHTML('⚠️', 'المتأخرون عن الدفع', unpaidRows.length + partialRows.length)}
      <table class="report-table">
        <thead><tr>
          <th>الطالب</th><th>الكود</th><th>هاتف الطالب</th><th>هاتف ولي الأمر</th>
          <th class="num">المطلوب</th><th class="num">الحالة</th>
        </tr></thead>
        <tbody>${lateRows}</tbody>
      </table>
    </div>` : `
    <div class="section">
      ${sectionTitleHTML('✅', 'المتأخرون', 0)}
      <div style="text-align:center;color:${PALETTE.green};padding:16px;font-weight:700">كل الطلاب دفعوا اشتراك ${esc(monthName)} ✓</div>
    </div>`}

    ${reportFooterHTML(profile)}
  `;

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <title>تقرير مدفوعات ${esc(group.name)} — ${esc(monthName)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>
  <style>${basePrintCSS({ orientation: 'portrait' })}</style>
</head>
<body>
  ${toolbarHTML()}
  <div class="page">${bodyHTML}</div>
  <script>window.focus();</script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) { alert('يرجى السماح بالنوافذ المنبثقة لطباعة التقرير.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// تقرير بالطالب — كل مدفوعاته
// ═══════════════════════════════════════════════════════════════════════════
// نفس مبدأ PAY_METHOD أعلاه — مصدر واحد (paymentService.js's PAYMENT_TYPES).
const PAY_TYPE_L = PAYMENT_TYPES;

export function openStudentPaymentsReport({ student, group, payments, profile, treasuryTxn = [] }) {
  if (!student) return;

  const studentPays = payments
    .filter(p => p.studentId === student.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // NEEDS BUSINESS DECISION (المُغلق الآن): الجدول أدناه يعرض المبالغ الأصلية التاريخية
  // لكل معاملة (كما هي — بلا تعديل)، فـ"الإجمالي" الذي يجمعها مباشرة يجب أن يبقى إجمالياً
  // خاماً (Gross) حتى يستمر مطابقاً لمجموع الصفوف الظاهرة. الاسترداد يُعرَض كبند منفصل
  // (Refunded)، والصافي = الإجمالي − المسترد (Net = Gross − Refunded) — بدل استبدال
  // الإجمالي برقم صافٍ يناقض الجدول المطابق له تماماً تحته.
  const total = studentPays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const refunded = studentPays.reduce((s, p) => s + getRefundedAmount(p.id, treasuryTxn), 0);
  const net = total - refunded;
  const count = studentPays.length;

  // تجميع حسب النوع
  const byType = {};
  studentPays.forEach(p => {
    const t = p.payType || 'subscription';
    byType[t] = (byType[t] || 0) + (Number(p.amount) || 0);
  });

  const rows = studentPays.map(p => {
    const st = STATUS_META[p.status] || { l: p.status, c: PALETTE.textFaint };
    return `
      <tr>
        <td>${fmtDateShort(p.date)}</td>
        <td>${esc(PAY_TYPE_L[p.payType] || 'رسوم شهرية')}</td>
        <td>${p.month ? esc(MONTHS_AR[p.month] || '—') : '—'}</td>
        <td class="num">${fmtMoney(p.amount)}</td>
        <td class="num">${esc(PAY_METHOD[p.method] || p.method || '—')}</td>
        <td class="num">${badgeHTML(st.l, st.c)}</td>
      </tr>`;
  }).join('');

  // ملخص حسب النوع
  const typeChips = Object.entries(byType).map(([t, amt]) =>
    `<div style="display:inline-block;padding:6px 12px;margin:3px;background:${PALETTE.surface};border:1px solid ${PALETTE.border};border-radius:8px;font-size:11px">
      <span style="color:${PALETTE.textSoft}">${esc(PAY_TYPE_L[t] || t)}:</span>
      <strong style="color:${PALETTE.green}"> ${fmtMoney(amt)}</strong>
    </div>`
  ).join('');

  const bodyHTML = `
    ${reportHeaderHTML(profile)}
    <div class="report-title">سجل مدفوعات الطالب — ${esc(student.name)}</div>

    <div style="text-align:center;color:${PALETTE.textSoft};font-size:12px;margin-bottom:16px">
      ${esc(student.code || '')} · ${esc(group?.name || '')}${student.grade ? ` · ${esc(student.grade)}` : ''}
    </div>

    <div class="kpi-row">
      ${kpiHTML('إجمالي المدفوع', fmtMoney(total), PALETTE.green)}
      ${refunded > 0 ? kpiHTML('المسترد', fmtMoney(refunded), PALETTE.red) : ''}
      ${refunded > 0 ? kpiHTML('الصافي', fmtMoney(net), PALETTE.primary) : ''}
      ${kpiHTML('عدد الدفعات', count, PALETTE.primary)}
      ${kpiHTML('أنواع الدفع', Object.keys(byType).length, PALETTE.blue)}
      ${kpiHTML('آخر دفعة', studentPays[0] ? fmtDateShort(studentPays[0].date) : '—', PALETTE.purple)}
    </div>

    ${typeChips ? `
    <div class="section avoid-break">
      ${sectionTitleHTML('📊', 'المدفوع حسب النوع', null)}
      <div style="text-align:center">${typeChips}</div>
    </div>` : ''}

    <div class="section avoid-break">
      ${sectionTitleHTML('💰', 'كل الدفعات', count)}
      <table class="report-table">
        <thead><tr>
          <th>التاريخ</th><th>النوع</th><th>عن شهر</th>
          <th class="num">المبلغ</th><th class="num">الطريقة</th><th class="num">الحالة</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8">لا توجد مدفوعات مسجّلة</td></tr>'}</tbody>
      </table>
    </div>

    ${reportFooterHTML(profile)}
  `;

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <title>مدفوعات ${esc(student.name)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>
  <style>${basePrintCSS({ orientation: 'portrait' })}</style>
</head>
<body>
  ${toolbarHTML()}
  <div class="page">${bodyHTML}</div>
  <script>window.focus();</script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) { alert('يرجى السماح بالنوافذ المنبثقة لطباعة التقرير.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
