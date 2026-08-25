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
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>
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
