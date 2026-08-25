// src/modules/admissions/buildAdmissionReport.js
// ─────────────────────────────────────────────────────────────────────────────
// بيان قبول احترافي — يعرض رحلة الطالب الكاملة من أول اتصال:
// البيانات، الحجز، المتابعات، المدفوعات، المذكرات.
// يستخدم النظام الموحّد للطباعة (printStyles) — نفس هوية تقرير الطالب.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PALETTE, esc, fmtDate, fmtDateShort, fmtMoney,
  basePrintCSS, reportHeaderHTML, reportFooterHTML,
  kpiHTML, sectionTitleHTML, badgeHTML, toolbarHTML,
} from '../../utils/printStyles';

import { STAGES, LEAD_STATUS, FOLLOWUP_TYPES, ADMISSION_PAYMENT_TYPES } from './mockData';

export function openAdmissionReport({ record, profile }) {
  if (!record) return;

  const stage = STAGES[record.stage] || STAGES.lead;
  const leadSt = LEAD_STATUS[record.leadStatus];
  const payments = record.payments || [];
  const followups = (record.followups || []).slice().sort((a, b) => new Date(a.at) - new Date(b.at));
  const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  // جدول المدفوعات
  const payRows = payments.map(p => {
    const meta = ADMISSION_PAYMENT_TYPES[p.type] || { label: p.type, color: PALETTE.textFaint };
    return `
      <tr>
        <td>${fmtDateShort(p.at)}</td>
        <td>${badgeHTML(meta.label, meta.color)}</td>
        <td class="num" style="font-weight:700;color:${PALETTE.green}">${fmtMoney(p.amount)}</td>
        <td class="num">${esc(p.by || '—')}</td>
      </tr>`;
  }).join('');

  // خط زمني للمتابعات
  const followupRows = followups.map(f => {
    const meta = FOLLOWUP_TYPES[f.type] || { label: f.type, icon: '•', color: PALETTE.textFaint };
    return `
      <tr>
        <td>${esc(f.at)}</td>
        <td>${badgeHTML(`${meta.icon} ${meta.label}`, meta.color)}</td>
        <td>${esc(f.notes || '—')}</td>
        <td class="num">${esc(f.by || '—')}</td>
      </tr>`;
  }).join('');

  const bodyHTML = `
    ${reportHeaderHTML(profile)}
    <div class="report-title">بيان قبول الطالب — ${esc(record.name)}</div>

    <div style="text-align:center;margin-bottom:16px">
      ${badgeHTML(`${stage.icon} ${stage.label}`, stage.color)}
      ${leadSt ? badgeHTML(leadSt.label, leadSt.color) : ''}
    </div>

    <div class="kpi-row">
      ${kpiHTML('المرحلة', stage.label, stage.color)}
      ${kpiHTML('إجمالي المدفوع', fmtMoney(totalPaid), PALETTE.green)}
      ${kpiHTML('عدد المتابعات', followups.length, PALETTE.blue)}
      ${kpiHTML('تاريخ التسجيل', fmtDateShort(record.createdAt), PALETTE.purple)}
    </div>

    <div class="section avoid-break">
      ${sectionTitleHTML('👤', 'البيانات الأساسية', null)}
      <table class="report-table">
        <tbody>
          <tr><th style="width:35%">اسم الطالب</th><td>${esc(record.name)}</td></tr>
          <tr><th>ولي الأمر</th><td>${esc(record.parentName || '—')}</td></tr>
          <tr><th>رقم الطالب</th><td dir="ltr" style="text-align:right">${esc(record.phone || '—')}</td></tr>
          <tr><th>رقم ولي الأمر</th><td dir="ltr" style="text-align:right">${esc(record.parentPhone || '—')}</td></tr>
          <tr><th>الصف الدراسي</th><td>${esc(record.grade || '—')}</td></tr>
          <tr><th>المدرسة</th><td>${esc(record.school || '—')}</td></tr>
          <tr><th>مصدر التعارف</th><td>${esc(record.source || '—')}</td></tr>
          ${record.group ? `<tr><th>المجموعة</th><td>${esc(record.group)}</td></tr>` : ''}
          ${record.reservationDate ? `<tr><th>تاريخ الحجز</th><td>${fmtDate(record.reservationDate)}</td></tr>` : ''}
          ${record.activatedAt ? `<tr><th>تاريخ التفعيل</th><td>${fmtDate(record.activatedAt)}</td></tr>` : ''}
          <tr><th>الموظف المسؤول</th><td>${esc(record.secretary || '—')}</td></tr>
        </tbody>
      </table>
    </div>

    ${payments.length > 0 ? `
    <div class="section avoid-break">
      ${sectionTitleHTML('💰', 'سجل المدفوعات', payments.length)}
      <table class="report-table">
        <thead><tr><th>التاريخ</th><th>النوع</th><th class="num">المبلغ</th><th class="num">الموظف</th></tr></thead>
        <tbody>
          ${payRows}
          <tr style="background:${PALETTE.surface}">
            <td colspan="2" style="font-weight:800">الإجمالي</td>
            <td class="num" style="font-weight:800;color:${PALETTE.green}">${fmtMoney(totalPaid)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>` : ''}

    ${record.booklets && record.booklets.delivered ? `
    <div class="section avoid-break">
      ${sectionTitleHTML('📚', 'المذكرات', null)}
      <table class="report-table">
        <tbody>
          <tr><th style="width:35%">حالة التسليم</th><td>✅ تم التسليم</td></tr>
          <tr><th>الكمية</th><td>${esc(String(record.booklets.qty))}</td></tr>
          <tr><th>الإصدار</th><td>${esc(record.booklets.version || '—')}</td></tr>
          <tr><th>تاريخ التسليم</th><td>${fmtDateShort(record.booklets.date)}</td></tr>
        </tbody>
      </table>
    </div>` : ''}

    ${followups.length > 0 ? `
    <div class="section avoid-break">
      ${sectionTitleHTML('🔄', 'سجل المتابعات', followups.length)}
      <table class="report-table">
        <thead><tr><th>التاريخ والوقت</th><th>النوع</th><th>الملاحظات</th><th class="num">الموظف</th></tr></thead>
        <tbody>${followupRows}</tbody>
      </table>
    </div>` : ''}

    ${record.notes ? `
    <div class="section avoid-break">
      ${sectionTitleHTML('📝', 'ملاحظات', null)}
      <div style="padding:12px 14px;background:${PALETTE.surface};border:1px solid ${PALETTE.border};border-radius:10px;font-size:12px;line-height:1.7">${esc(record.notes)}</div>
    </div>` : ''}

    ${reportFooterHTML(profile)}
  `;

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <title>بيان قبول ${esc(record.name)}</title>
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
  if (!win) { alert('يرجى السماح بالنوافذ المنبثقة لطباعة البيان.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
