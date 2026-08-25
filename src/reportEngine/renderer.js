// src/reportEngine/renderer.js
// ═══════════════════════════════════════════════════════════════════════════
// مشغّل التقارير — يركّب الصفحات ويفتح نافذة الطباعة/التصدير.
// كل تقرير = مجموعة صفحات؛ كل صفحة تحتوي رأساً وتذييلاً موحّدين.
// ═══════════════════════════════════════════════════════════════════════════

import { THEME } from './theme';
import { baseCSS } from './baseCSS';
import { ReportHeader, ReportFooter, Toolbar } from './components';

// بناء صفحة واحدة (رأس + محتوى + تذييل)
// يقبل إما (profile,title,reportNo,generatedBy) أو meta كامل
export function buildPage({ profile, title, reportNo, generatedBy, meta, content, pageLabel, showHeader = true }) {
  // لو مُرّر meta، استخرج منه القيم
  const t = title || meta?.title;
  const rn = reportNo || meta?.reportNumber;
  const gb = generatedBy || meta?.generatedBy;
  return `
  <div class="page">
    ${showHeader ? ReportHeader({ profile, title: t, reportNo: rn, generatedBy: gb }) : ''}
    <div style="flex:1">${content}</div>
    ${ReportFooter({ profile, pageLabel })}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// تشغيل التقرير: يفتح نافذة جديدة بكل الصفحات جاهزة للطباعة/الحفظ PDF
// pages: مصفوفة HTML strings (كل عنصر = صفحة)
// ─────────────────────────────────────────────────────────────────────────────
export function renderReport({ title = 'تقرير', pages = [], orientation = 'portrait', meta = null }) {
  if (meta) {
    title = meta.title || title;
    orientation = meta.orientation || orientation;
  }
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet"/>
  <style>${baseCSS({ orientation })}</style>
</head>
<body>
  ${Toolbar()}
  ${pages.join('\n')}
  <script>window.focus();</script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=920,height=1040');
  if (!win) {
    alert('يرجى السماح بالنوافذ المنبثقة لعرض التقرير.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
