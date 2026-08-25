// src/reportEngine/theme.js
// ═══════════════════════════════════════════════════════════════════════════
// الهوية البصرية الموحّدة لمحرّك التقارير (design tokens).
// كل التقارير تشترك في نفس الألوان والمسافات والخطوط — هوية enterprise واحدة.
// ═══════════════════════════════════════════════════════════════════════════

export const THEME = Object.freeze({
  // ── الألوان ──
  accent:      '#2563eb',   // أزرق احترافي (اللون المميّز)
  accentDark:  '#1d4ed8',
  accentSoft:  '#eff6ff',
  accentLine:  '#bfdbfe',

  ink:         '#0f172a',   // نص أساسي (غامق مريح)
  text:        '#334155',   // نص عادي
  muted:       '#64748b',   // نص ثانوي
  faint:       '#94a3b8',   // نص خافت

  border:      '#e2e8f0',   // حدود رمادية ناعمة
  borderSoft:  '#f1f5f9',
  surface:     '#f8fafc',   // خلفية عناصر خفيفة
  white:       '#ffffff',

  // ألوان دلالية (KPIs والحالات)
  green:       '#059669',
  greenSoft:   '#ecfdf5',
  amber:       '#d97706',
  amberSoft:   '#fffbeb',
  red:         '#dc2626',
  redSoft:     '#fef2f2',
  purple:      '#7c3aed',
  purpleSoft:  '#f5f3ff',
  cyan:        '#0891b2',
  cyanSoft:    '#ecfeff',

  // ── الخط ──
  font: "'Cairo', 'Segoe UI', Tahoma, sans-serif",

  // ── قياسات A4 ──
  pageWidth:   '210mm',
  pageHeight:  '297mm',
  margin:      '14mm',
});

// حالة التقييم العام → لون
export const STATUS_COLORS = Object.freeze({
  excellent:      { label: 'ممتاز',        color: THEME.green,  soft: THEME.greenSoft },
  good:           { label: 'جيد',          color: THEME.accent, soft: THEME.accentSoft },
  needsAttention: { label: 'يحتاج متابعة', color: THEME.amber,  soft: THEME.amberSoft },
  critical:       { label: 'حرج',          color: THEME.red,    soft: THEME.redSoft },
});
