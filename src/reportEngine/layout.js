// src/reportEngine/layout.js
// ═══════════════════════════════════════════════════════════════════════════
// نظام التخطيط (Layout Framework) — تخطيطات قابلة لإعادة الاستخدام.
// يمنع الـ inline styling المكرر ويضمن اتساقاً بصرياً في كل التقارير.
// كل دالة تُرجع HTML string. كلها تدعم التحكم في فواصل الصفحات.
// ═══════════════════════════════════════════════════════════════════════════

import { THEME } from './theme';

// فئة منع/سماح الكسر
function breakClass(canBreak) {
  return canBreak ? '' : 'no-break';
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid — شبكة بأعمدة متساوية (2/3/4...)
// children: مصفوفة HTML strings
// ─────────────────────────────────────────────────────────────────────────────
export function Grid(cols, children = [], { gap = 12, canBreak = true } = {}) {
  return `<div class="${breakClass(canBreak)}" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:${gap}px">${children.join('')}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row — صف أفقي مرن (flex)
// ─────────────────────────────────────────────────────────────────────────────
export function Row(children = [], { gap = 12, align = 'stretch', justify = 'flex-start', wrap = true, canBreak = true } = {}) {
  return `<div class="${breakClass(canBreak)}" style="display:flex;gap:${gap}px;align-items:${align};justify-content:${justify};flex-wrap:${wrap ? 'wrap' : 'nowrap'}">${children.join('')}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Column — عمود بوزن (flex)
// ─────────────────────────────────────────────────────────────────────────────
export function Column(content, { weight = 1, minWidth = 0 } = {}) {
  return `<div style="flex:${weight};min-width:${minWidth}px">${content}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stack — عناصر رأسية بمسافة بينها
// ─────────────────────────────────────────────────────────────────────────────
export function Stack(children = [], { gap = 10, canBreak = true } = {}) {
  return `<div class="${breakClass(canBreak)}" style="display:flex;flex-direction:column;gap:${gap}px">${children.join('')}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Card — حاوية بحدود وخلفية (تجمّع محتوى مترابط)
// ─────────────────────────────────────────────────────────────────────────────
export function Card(content, { padding = 16, bg = THEME.white, border = THEME.border, radius = 12, canBreak = false } = {}) {
  return `<div class="${breakClass(canBreak)}" style="background:${bg};border:1px solid ${border};border-radius:${radius}px;padding:${padding}px">${content}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spacer — مسافة رأسية
// ─────────────────────────────────────────────────────────────────────────────
export function Spacer(size = 14) {
  return `<div style="height:${size}px"></div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PageBreak — فاصل صفحة يدوي
// ─────────────────────────────────────────────────────────────────────────────
export function PageBreak() {
  return `<div class="page-break"></div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// KeepTogether — يمنع كسر مجموعة عناصر (عنوان + محتواه)
// ─────────────────────────────────────────────────────────────────────────────
export function KeepTogether(content) {
  return `<div class="no-break">${content}</div>`;
}
