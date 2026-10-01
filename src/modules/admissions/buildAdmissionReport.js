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
import { getAdmissionTreasuryTotals } from '../../services/treasuryService';

// groupName (M-03): the admission's real confirmed group, resolved by the caller from
// confirmedGroupId — the record carries no persisted group-name field.
export function openAdmissionReport({ record, profile, treasuryTxn = [], groupName = null }) {
  if (!record) return;

  const stage = STAGES[record.stage] || STAGES.lead;
  const leadSt = LEAD_STATUS[record.leadStatus];
  const payments = record.payments || [];
  const followups = (record.followups || []).slice().sort((a, b) => new Date(a.at) - new Date(b.at));
  // NEEDS BUSINESS DECISION (المُغلق الآن) — بيان مطبوع: جدول المدفوعات أدناه يعرض
  // المبالغ الأصلية التاريخية لكل معاملة كما هي. totalPaid يبقى إجمالياً خاماً (Gross)
  // مطابقاً لمجموع تلك الصفوف؛ الاسترداد الفعلي (لو وُجد) يُشتقّ من treasury_txn عبر
  // admissionId — نفس مرجع الحقيقة المُستخدَم في لوحة تفاصيل القبول (DetailsPanel) —
  // ويظهر كبند منفصل، والصافي = الإجمالي − المسترد.
  const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const { refund: refundedTotal, net: netPaid } = getAdmissionTreasuryTotals(record.id, treasuryTxn);

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
      ${refundedTotal > 0 ? kpiHTML('المسترد', fmtMoney(refundedTotal), PALETTE.red) : ''}
      ${refundedTotal > 0 ? kpiHTML('الصافي', fmtMoney(netPaid), PALETTE.primary) : ''}
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
          ${groupName ? `<tr><th>المجموعة</th><td>${esc(groupName)}</td></tr>` : ''}
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
            <td colspan="2" style="font-weight:800">${refundedTotal > 0 ? 'الإجمالي (قبل الاسترداد)' : 'الإجمالي'}</td>
            <td class="num" style="font-weight:800;color:${PALETTE.green}">${fmtMoney(totalPaid)}</td>
            <td></td>
          </tr>
          ${refundedTotal > 0 ? `
          <tr style="background:${PALETTE.surface}">
            <td colspan="2" style="font-weight:800">المسترد</td>
            <td class="num" style="font-weight:800;color:${PALETTE.red}">${fmtMoney(refundedTotal)}</td>
            <td></td>
          </tr>
          <tr style="background:${PALETTE.surface}">
            <td colspan="2" style="font-weight:800">الصافي (بعد الاسترداد)</td>
            <td class="num" style="font-weight:800;color:${PALETTE.primary}">${fmtMoney(netPaid)}</td>
            <td></td>
          </tr>` : ''}
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
  <style>
    /* Cairo — محلي بالكامل (بلا إنترنت). نفس الملفات الثلاثة المُجمَّعة فعلاً تحت
       public/fonts/cairo/ (انظر src/styles/styles.css) — نافذة الطباعة هذه مفتوحة
       بـ window.open('', ...) من نفس الأصل (origin) للتطبيق، فتحلّ روابط الجذر
       النسبية /fonts/... بشكل صحيح تماماً كأي مسار ثابت آخر يخدمه express.static. */
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:400; font-display:swap; src:url(/fonts/cairo/cairo-arabic.woff2) format('woff2'); unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:400; font-display:swap; src:url(/fonts/cairo/cairo-latin-ext.woff2) format('woff2'); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:400; font-display:swap; src:url(/fonts/cairo/cairo-latin.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:500; font-display:swap; src:url(/fonts/cairo/cairo-arabic.woff2) format('woff2'); unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:500; font-display:swap; src:url(/fonts/cairo/cairo-latin-ext.woff2) format('woff2'); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:500; font-display:swap; src:url(/fonts/cairo/cairo-latin.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:600; font-display:swap; src:url(/fonts/cairo/cairo-arabic.woff2) format('woff2'); unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:600; font-display:swap; src:url(/fonts/cairo/cairo-latin-ext.woff2) format('woff2'); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:600; font-display:swap; src:url(/fonts/cairo/cairo-latin.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:700; font-display:swap; src:url(/fonts/cairo/cairo-arabic.woff2) format('woff2'); unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:700; font-display:swap; src:url(/fonts/cairo/cairo-latin-ext.woff2) format('woff2'); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:700; font-display:swap; src:url(/fonts/cairo/cairo-latin.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:800; font-display:swap; src:url(/fonts/cairo/cairo-arabic.woff2) format('woff2'); unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:800; font-display:swap; src:url(/fonts/cairo/cairo-latin-ext.woff2) format('woff2'); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:800; font-display:swap; src:url(/fonts/cairo/cairo-latin.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:900; font-display:swap; src:url(/fonts/cairo/cairo-arabic.woff2) format('woff2'); unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC,U+102E0-102FB,U+10E60-10E7E,U+10EC2-10EC4,U+10EFC-10EFF,U+1EE00-1EE03,U+1EE05-1EE1F,U+1EE21-1EE22,U+1EE24,U+1EE27,U+1EE29-1EE32,U+1EE34-1EE37,U+1EE39,U+1EE3B,U+1EE42,U+1EE47,U+1EE49,U+1EE4B,U+1EE4D-1EE4F,U+1EE51-1EE52,U+1EE54,U+1EE57,U+1EE59,U+1EE5B,U+1EE5D,U+1EE5F,U+1EE61-1EE62,U+1EE64,U+1EE67-1EE6A,U+1EE6C-1EE72,U+1EE74-1EE77,U+1EE79-1EE7C,U+1EE7E,U+1EE80-1EE89,U+1EE8B-1EE9B,U+1EEA1-1EEA3,U+1EEA5-1EEA9,U+1EEAB-1EEBB,U+1EEF0-1EEF1; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:900; font-display:swap; src:url(/fonts/cairo/cairo-latin-ext.woff2) format('woff2'); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
  @font-face { font-family:'Cairo'; font-style:normal; font-weight:900; font-display:swap; src:url(/fonts/cairo/cairo-latin.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  </style>
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
