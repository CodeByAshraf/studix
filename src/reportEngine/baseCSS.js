// src/reportEngine/baseCSS.js
// ═══════════════════════════════════════════════════════════════════════════
// الـ CSS الأساسي لمحرّك التقارير — enterprise print-ready.
// يدير: صفحات A4، فواصل الصفحات التلقائية، تكرار رؤوس الجداول،
// منع كسر النص/الجداول، رأس وتذييل متكرر على كل صفحة.
// ═══════════════════════════════════════════════════════════════════════════

import { THEME } from './theme';

export function baseCSS({ orientation = 'portrait' } = {}) {
  const isPortrait = orientation === 'portrait';
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }

  @page {
    size: ${isPortrait ? '210mm 297mm' : '297mm 210mm'};
    margin: ${THEME.margin};
  }

  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  body {
    font-family: ${THEME.font};
    color: ${THEME.text};
    background: #e5e7eb;
    direction: rtl;
    font-size: 10.5pt;
    line-height: 1.5;
  }

  /* ── حاوية الصفحة (A4) ── */
  .page {
    width: ${isPortrait ? '210mm' : '297mm'};
    min-height: ${isPortrait ? '297mm' : '210mm'};
    background: ${THEME.white};
    margin: 8mm auto;
    padding: ${THEME.margin};
    position: relative;
    box-shadow: 0 2px 12px rgba(0,0,0,.12);
    display: flex;
    flex-direction: column;
  }

  /* فاصل صفحة يدوي */
  .page-break { page-break-before: always; break-before: page; }

  /* منع كسر العناصر بين الصفحات */
  .no-break { page-break-inside: avoid; break-inside: avoid; }

  /* ── الطباعة ── */
  @media print {
    body { background: ${THEME.white}; }
    .page {
      margin: 0;
      box-shadow: none;
      width: ${isPortrait ? '210mm' : '297mm'};
      min-height: ${isPortrait ? '297mm' : '210mm'};
      padding: ${THEME.margin};
    }
    .toolbar { display: none !important; }
    /* تكرار رؤوس الجداول عبر الصفحات */
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }

  /* ── الروابط والصور ── */
  img { max-width: 100%; }

  /* ── شريط الأدوات (لا يُطبع) ── */
  .toolbar {
    position: fixed;
    top: 12px; left: 12px;
    display: flex; gap: 8px;
    z-index: 1000;
  }
  .toolbar button {
    font-family: ${THEME.font};
    font-size: 10pt;
    font-weight: 700;
    padding: 9px 18px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,.15);
  }
  .toolbar .btn-print { background: ${THEME.accent}; color: #fff; }
  .toolbar .btn-close { background: ${THEME.white}; color: ${THEME.text}; border: 1px solid ${THEME.border}; }
  `;
}
