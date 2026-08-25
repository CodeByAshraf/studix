// src/utils/sanitize.js
// ─────────────────────────────────────────────────────────────────────────────
// SVG Sanitizer — بدون مكتبات خارجية
//
// المشكلة:
//   3 مكونات تستخدم dangerouslySetInnerHTML لعرض SVG مُولَّد من qrcode.js
//   الـ SVG نفسه آمن (مُولَّد برمجياً)، لكن بيانات الطالب تُضمَّن في
//   HTML strings يدوياً (IDCardsPage.jsx سطر 57) — هذا هو الخطر الحقيقي.
//
// الحل:
//   1. sanitizeSVG: يسمح فقط بـ SVG elements وattributes المعروفة آمنة
//      يمنع: <script>, on* attributes, javascript: URLs, data: URLs
//   2. escapeHTML: يهرّب أي نص مستخدم قبل إدراجه في HTML strings
//   3. sanitizeText: ينظف input المستخدم من characters خطيرة
//
// لماذا بدون DOMPurify؟
//   التطبيق حالياً offline-first بدون npm dependencies للـ security.
//   هذا الـ sanitizer يغطي الـ use case المحدد (SVG من QR + HTML cards).
//   في بيئة production مع backend: استخدم DOMPurify بدلاً من هذا.
// ─────────────────────────────────────────────────────────────────────────────

// ── SVG elements المسموح بها ──────────────────────────────────────────────────
const ALLOWED_SVG_TAGS = new Set([
  'svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'path', 'text', 'tspan', 'title', 'desc', 'defs', 'use', 'symbol',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask',
  'pattern', 'image', 'foreignObject',
]);

// ── SVG attributes المسموح بها ────────────────────────────────────────────────
const ALLOWED_SVG_ATTRS = new Set([
  'id', 'class', 'style', 'transform', 'clip-path', 'mask',
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'visibility', 'display', 'overflow',
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'viewBox', 'preserveAspectRatio',
  'd', 'points',
  'font-size', 'font-family', 'font-weight', 'text-anchor',
  'dominant-baseline', 'text-decoration',
  'href', 'xlink:href',
  'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'spreadMethod',
  'patternUnits', 'patternTransform',
  'marker-end', 'marker-start', 'marker-mid',
  'xmlns', 'xmlns:xlink',
  'data-theme',
]);

// ── Patterns خطيرة ────────────────────────────────────────────────────────────
const DANGEROUS_PATTERNS = [
  /javascript\s*:/gi,
  /vbscript\s*:/gi,
  /data\s*:/gi,
  /<\s*script/gi,
  /on\w+\s*=/gi,          // onclick=, onload=, onerror= ...
  /expression\s*\(/gi,    // CSS expression()
  /url\s*\(\s*['"]?\s*javascript/gi,
];

// ── escapeHTML ────────────────────────────────────────────────────────────────
// يُستخدم لأي نص مستخدم يُدمَج في HTML strings يدوياً
// مثال: `<div>${escapeHTML(student.name)}</div>`
export function escapeHTML(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// ── sanitizeText ──────────────────────────────────────────────────────────────
// ينظف نص المستخدم من أي patterns خطيرة
// يُستخدم قبل حفظ بيانات الطلاب
export function sanitizeText(str) {
  if (!str || typeof str !== 'string') return '';
  let clean = str;
  DANGEROUS_PATTERNS.forEach(pattern => {
    clean = clean.replace(pattern, '');
  });
  return clean.trim();
}

// ── sanitizeSVG ───────────────────────────────────────────────────────────────
// يُنظّف SVG string ويسمح فقط بالعناصر والـ attributes الآمنة
// يُستخدم قبل dangerouslySetInnerHTML
//
// استخدام:
//   <div dangerouslySetInnerHTML={{ __html: sanitizeSVG(svgString) }} />
export function sanitizeSVG(svgString) {
  if (!svgString || typeof svgString !== 'string') return '';

  // فحص سريع للـ patterns الخطيرة قبل الـ parsing
  const lowerSvg = svgString.toLowerCase();
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(lowerSvg)) {
      console.warn('[sanitizeSVG] Dangerous pattern detected — blocking SVG render');
      return '<!-- blocked: dangerous content -->';
    }
  }

  // إذا لم يكن DOM متاحاً (SSR) — نعيد الـ SVG كما هو (مُولَّد برمجياً)
  if (typeof document === 'undefined') return svgString;

  try {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(svgString, 'image/svg+xml');

    // تحقق من وجود parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      console.warn('[sanitizeSVG] SVG parse error — blocking render');
      return '<!-- blocked: invalid SVG -->';
    }

    // نظّف العناصر
    const allElements = doc.querySelectorAll('*');
    allElements.forEach(el => {
      const tagName = el.tagName.toLowerCase();

      // احذف العناصر غير المسموح بها
      if (!ALLOWED_SVG_TAGS.has(tagName)) {
        el.parentNode?.removeChild(el);
        return;
      }

      // احذف الـ attributes غير المسموح بها
      const attrs = Array.from(el.attributes);
      attrs.forEach(attr => {
        const name  = attr.name.toLowerCase();
        const value = attr.value;

        // احذف on* event handlers
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
          return;
        }

        // احذف attributes غير مسموح بها
        if (!ALLOWED_SVG_ATTRS.has(name)) {
          el.removeAttribute(attr.name);
          return;
        }

        // افحص قيم الـ attributes للـ patterns الخطيرة
        if (DANGEROUS_PATTERNS.some(p => p.test(value))) {
          el.removeAttribute(attr.name);
        }
      });
    });

    return new XMLSerializer().serializeToString(doc.documentElement);
  } catch (err) {
    console.warn('[sanitizeSVG] Sanitization failed:', err);
    return '<!-- blocked: sanitization error -->';
  }
}

// ── isSafeSVG ─────────────────────────────────────────────────────────────────
// فحص سريع بدون parsing — للـ SVGs المُولَّدة برمجياً من qrcode.js
// أسرع من sanitizeSVG لكن أقل شمولاً
export function isSafeSVG(svgString) {
  if (!svgString || typeof svgString !== 'string') return false;
  return !DANGEROUS_PATTERNS.some(pattern => pattern.test(svgString));
}
