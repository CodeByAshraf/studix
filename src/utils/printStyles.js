// src/utils/printStyles.js
// ─────────────────────────────────────────────────────────────────────────────
// نظام طباعة موحّد لكل تقارير البرنامج.
// ألوان فاتحة واضحة واحترافية — نفس هوية تقرير الطالب.
// أي تقرير يستورد من هنا يضمن التناسق، وأي تعديل مستقبلي يطبَّق على الكل.
// ─────────────────────────────────────────────────────────────────────────────

// ── لوحة الألوان (فاتحة) ──────────────────────────────────────────────────────
export const PALETTE = {
  primary:    '#0d9488',  // تركوازي أساسي
  primaryDark:'#0f766e',
  primarySoft:'#0d948810',
  text:       '#1e293b',  // نص أساسي (رمادي غامق مريح، مش أسود قاسٍ)
  textSoft:   '#64748b',  // نص ثانوي
  textFaint:  '#94a3b8',  // نص خافت
  border:     '#e2e8f0',  // حدود فاتحة
  surface:    '#f8fafc',  // خلفية عناصر فاتحة جداً
  white:      '#ffffff',
  green:      '#10b981',
  amber:      '#f59e0b',
  red:        '#ef4444',
  blue:       '#3b82f6',
  purple:     '#8b5cf6',
};

// ── تهريب HTML — يمنع كسر التقرير أو حقن HTML ────────────────────────────────
export function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── تنسيقات مساعدة ───────────────────────────────────────────────────────────
export function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' });
  } catch { return String(d); }
}

export function fmtDateShort(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ar-EG', { year:'2-digit', month:'short', day:'numeric' });
  } catch { return String(d); }
}

export function fmtMoney(n) {
  return (Number(n) || 0).toLocaleString('ar-EG') + ' ج.م';
}

export function initials(name) {
  return (name || '').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
}

// ── CSS الأساسي المشترك (ورقة A4، ألوان فاتحة، خط Cairo) ─────────────────────
// orientation: 'portrait' | 'landscape'
export function basePrintCSS({ orientation = 'portrait' } = {}) {
  return `
    @page { size: A4 ${orientation}; margin: 12mm; }
    * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    body {
      font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
      direction: rtl; text-align: right;
      color: ${PALETTE.text}; background: ${PALETTE.white};
      line-height: 1.5; font-size: 12px;
      width: 100%; overflow-x: hidden;
    }
    .page { width: 100%; max-width: 186mm; margin: 0 auto; padding: 0; }

    /* رأس رسمي */
    .report-header {
      display:flex; justify-content:space-between; align-items:center;
      padding-bottom:14px; margin-bottom:18px; border-bottom:3px solid ${PALETTE.primary};
    }
    .rh-right { display:flex; align-items:center; gap:12px; }
    .rh-logo { width:56px; height:56px; object-fit:contain; border-radius:10px; }
    .rh-logo-ph { background:${PALETTE.primary}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:20px; }
    .rh-name { font-size:20px; font-weight:900; color:${PALETTE.primaryDark}; }
    .rh-slogan { font-size:12px; color:${PALETTE.textSoft}; margin-top:2px; }
    .rh-left { font-size:11px; color:${PALETTE.textSoft}; text-align:left; line-height:1.9; }

    /* عنوان التقرير */
    .report-title { text-align:center; font-size:16px; font-weight:800; color:${PALETTE.primaryDark}; margin-bottom:16px; padding:8px; background:${PALETTE.primarySoft}; border-radius:8px; }

    /* KPIs */
    .kpi-row { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:20px; }
    .mini-kpis { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
    .mini-kpis .kpi { flex:1; min-width:80px; }
    .kpi { padding:10px 12px; border:1px solid ${PALETTE.border}; border-radius:10px; text-align:center; background:${PALETTE.white}; }
    .kpi-val { font-size:20px; font-weight:900; line-height:1.2; }
    .kpi-label { font-size:10px; color:${PALETTE.textSoft}; margin-top:3px; font-weight:700; }
    .kpi-sub { font-size:9px; color:${PALETTE.textFaint}; margin-top:2px; }

    /* الأقسام */
    .section { margin-bottom:22px; }
    .sec-title { display:flex; align-items:center; gap:8px; font-size:15px; font-weight:800; color:${PALETTE.primaryDark}; margin-bottom:12px; padding-bottom:6px; border-bottom:2px solid ${PALETTE.border}; }
    .sec-icon { font-size:16px; }
    .sec-count { margin-right:auto; font-size:11px; font-weight:700; color:${PALETTE.textSoft}; background:#f1f5f9; padding:2px 10px; border-radius:99px; }

    /* الجداول */
    .report-table { width:100%; border-collapse:collapse; font-size:11px; table-layout:fixed; word-break:break-word; }
    .report-table th { background:#f1f5f9; color:#475569; font-weight:800; padding:8px 10px; text-align:right; border-bottom:2px solid ${PALETTE.border}; }
    .report-table td { padding:7px 10px; border-bottom:1px solid #f1f5f9; }
    .report-table tr:nth-child(even) td { background:${PALETTE.surface}; }
    .report-table .num { text-align:center; }

    /* Badges */
    .badge { display:inline-block; font-size:10px; font-weight:700; padding:2px 9px; border-radius:99px; border:1px solid; }

    /* الفوتر */
    .report-footer { margin-top:24px; padding-top:12px; border-top:1px solid ${PALETTE.border}; display:flex; justify-content:space-between; font-size:10px; color:${PALETTE.textFaint}; }

    .avoid-break { page-break-inside: avoid; }

    /* شريط الأدوات — يختفي عند الطباعة */
    .toolbar { position:fixed; top:0; left:0; right:0; background:${PALETTE.primaryDark}; color:#fff; padding:12px 20px; display:flex; justify-content:center; gap:12px; z-index:99; box-shadow:0 2px 12px rgba(0,0,0,.2); }
    .toolbar button { font-family:'Cairo',sans-serif; font-size:14px; font-weight:700; padding:9px 24px; border:none; border-radius:8px; cursor:pointer; }
    .tb-print { background:#fff; color:${PALETTE.primaryDark}; }
    .tb-close { background:#ffffff33; color:#fff; }
    .spacer { height:60px; }
    @media print { .toolbar, .spacer { display:none !important; } }
  `;
}

// ── مكوّنات HTML جاهزة ────────────────────────────────────────────────────────

// رأس رسمي موحّد (لوجو/اسم/سلوجان/تواصل)
export function reportHeaderHTML(profile) {
  const hasLogo = profile && profile.logoUrl;
  const name = (profile && profile.name) || 'مركز التعليم';
  return `
    <div class="report-header">
      <div class="rh-right">
        ${hasLogo
          ? `<img class="rh-logo" src="${esc(profile.logoUrl)}" alt="logo"/>`
          : `<div class="rh-logo rh-logo-ph">${esc(initials(name))}</div>`}
        <div>
          <div class="rh-name">${esc(name)}</div>
          ${profile && profile.slogan ? `<div class="rh-slogan">${esc(profile.slogan)}</div>` : ''}
        </div>
      </div>
      <div class="rh-left">
        ${profile && profile.phone1 ? `<div>📞 ${esc(profile.phone1)}</div>` : ''}
        ${profile && profile.phone2 ? `<div>📞 ${esc(profile.phone2)}</div>` : ''}
        ${profile && profile.address ? `<div>📍 ${esc(profile.address)}</div>` : ''}
      </div>
    </div>`;
}

// فوتر موحّد
export function reportFooterHTML(profile) {
  return `
    <div class="report-footer">
      <span>${esc((profile && profile.name) || 'مركز التعليم')}</span>
      <span>تاريخ الإصدار: ${fmtDate(new Date())}</span>
    </div>`;
}

// بطاقة إحصائية
export function kpiHTML(label, value, color = PALETTE.primary, sub = '') {
  return `
    <div class="kpi">
      <div class="kpi-val" style="color:${color}">${esc(value)}</div>
      <div class="kpi-label">${esc(label)}</div>
      ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}
    </div>`;
}

// عنوان قسم
export function sectionTitleHTML(icon, title, count) {
  return `
    <div class="sec-title">
      <span class="sec-icon">${icon}</span>
      <span>${esc(title)}</span>
      ${count != null ? `<span class="sec-count">${esc(count)}</span>` : ''}
    </div>`;
}

// شارة ملونة
export function badgeHTML(text, color) {
  return `<span class="badge" style="color:${color};border-color:${color}55;background:${color}12">${esc(text)}</span>`;
}

// شريط أدوات (طباعة/إغلاق)
export function toolbarHTML() {
  return `
    <div class="toolbar">
      <button class="tb-print" onclick="window.print()">🖨 طباعة / حفظ PDF</button>
      <button class="tb-close" onclick="window.close()">إغلاق</button>
    </div>
    <div class="spacer"></div>`;
}

// ── فتح نافذة طباعة موحّدة ────────────────────────────────────────────────────
// يبني مستند HTML كامل بالنمط الموحّد ويفتحه في نافذة جديدة.
export function openPrintWindow({ title, bodyHTML, orientation = 'portrait', width = 900, height = 1000 }) {
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${esc(title)}</title>
  <style>
    /* Cairo — محلي بالكامل (بلا إنترنت). نفس الملفات الثلاثة المُجمَّعة فعلاً تحت
       public/fonts/cairo/ للتطبيق الرئيسي (src/styles/styles.css) — نافذة الطباعة هذه
       مفتوحة بـ window.open('', ...) من نفس الأصل (origin) للتطبيق، فتحلّ روابط
       الجذر النسبية /fonts/... بشكل صحيح تماماً كأي مسار ثابت آخر يخدمه express.static. */
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
  <style>${basePrintCSS({ orientation })}</style>
</head>
<body>
  ${toolbarHTML()}
  <div class="page">
    ${bodyHTML}
  </div>
  <script>window.focus();</script>
</body>
</html>`;

  const win = window.open('', '_blank', `width=${width},height=${height}`);
  if (!win) {
    alert('يرجى السماح بالنوافذ المنبثقة (pop-ups) لطباعة التقرير.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
