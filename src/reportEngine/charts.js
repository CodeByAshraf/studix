// src/reportEngine/charts.js
// ═══════════════════════════════════════════════════════════════════════════
// رسوم بيانية SVG لمحرّك التقارير — تُطبع بجودة عالية (لا مكتبات، لا صور نقطية).
// ═══════════════════════════════════════════════════════════════════════════

import { THEME } from './theme';
import { esc } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// رسم خطي — للاتجاهات (حضور، أداء عبر الوقت)
// data: [{ label, value }]  (value: 0..max)
// ─────────────────────────────────────────────────────────────────────────────
export function LineChart({ data = [], max = 100, color = THEME.accent, height = 130, unit = '' }) {
  if (data.length === 0) return emptyChart();
  const W = 480, H = height, padX = 34, padY = 18;
  const plotW = W - padX * 2, plotH = H - padY * 2;
  const stepX = data.length > 1 ? plotW / (data.length - 1) : 0;

  const pts = data.map((d, i) => {
    const x = padX + i * stepX;
    const y = padY + plotH - (Math.max(0, Math.min(max, d.value)) / max) * plotH;
    return { x, y, d };
  });

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${padY + plotH} L ${pts[0].x.toFixed(1)} ${padY + plotH} Z`;

  // خطوط شبكية أفقية
  const grid = [0, 0.5, 1].map((f) => {
    const y = padY + plotH - f * plotH;
    return `<line x1="${padX}" y1="${y}" x2="${W - padX}" y2="${y}" stroke="${THEME.border}" stroke-width="1"/>
            <text x="${W - padX + 4}" y="${y + 3}" font-size="8" fill="${THEME.faint}">${Math.round(f * max)}${unit}</text>`;
  }).join('');

  const dots = pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${color}"/>`).join('');
  const labels = pts.map((p) => `<text x="${p.x.toFixed(1)}" y="${H - 4}" font-size="7.5" fill="${THEME.muted}" text-anchor="middle">${esc(p.d.label)}</text>`).join('');

  return `
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" xmlns="http://www.w3.org/2000/svg">
    ${grid}
    <path d="${area}" fill="${color}15"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    ${dots}
    ${labels}
  </svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// رسم أعمدة — للمقارنات (أداء شهري، درجات امتحانات)
// data: [{ label, value }]
// ─────────────────────────────────────────────────────────────────────────────
export function BarChart({ data = [], max = 100, color = THEME.accent, height = 130, unit = '' }) {
  if (data.length === 0) return emptyChart();
  const W = 480, H = height, padX = 30, padY = 16;
  const plotW = W - padX * 2, plotH = H - padY * 2;
  const bw = plotW / data.length;
  const barW = Math.min(38, bw * 0.6);

  const grid = [0, 0.5, 1].map((f) => {
    const y = padY + plotH - f * plotH;
    return `<line x1="${padX}" y1="${y}" x2="${W - padX}" y2="${y}" stroke="${THEME.border}" stroke-width="1"/>
            <text x="${W - padX + 4}" y="${y + 3}" font-size="8" fill="${THEME.faint}">${Math.round(f * max)}${unit}</text>`;
  }).join('');

  const bars = data.map((d, i) => {
    const h = (Math.max(0, Math.min(max, d.value)) / max) * plotH;
    const x = padX + i * bw + (bw - barW) / 2;
    const y = padY + plotH - h;
    const c = d.color || color;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${c}"/>
            <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" font-size="8" fill="${THEME.ink}" text-anchor="middle" font-weight="700">${Math.round(d.value)}</text>
            <text x="${(x + barW / 2).toFixed(1)}" y="${H - 4}" font-size="7.5" fill="${THEME.muted}" text-anchor="middle">${esc(d.label)}</text>`;
  }).join('');

  return `
  <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" xmlns="http://www.w3.org/2000/svg">
    ${grid}
    ${bars}
  </svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// حلقة نسبة (donut) — لنسبة واحدة (حضور مثلاً)
// ─────────────────────────────────────────────────────────────────────────────
export function DonutChart({ value = 0, color = THEME.accent, label = '', size = 110 }) {
  const pct = Math.max(0, Math.min(100, value));
  const r = 38, cx = 55, cy = 55, circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return `
  <svg viewBox="0 0 110 110" style="width:${size}px;height:${size}px" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${THEME.surface}" stroke-width="11"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="11"
            stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" stroke-linecap="round"
            transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy - 2}" font-size="19" font-weight="800" fill="${THEME.ink}" text-anchor="middle">${Math.round(pct)}%</text>
    ${label ? `<text x="${cx}" y="${cy + 16}" font-size="8.5" fill="${THEME.muted}" text-anchor="middle">${esc(label)}</text>` : ''}
  </svg>`;
}

function emptyChart() {
  return `<div style="color:${THEME.faint};font-size:9pt;text-align:center;padding:20px">لا توجد بيانات كافية للرسم</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// عدّاد نصف دائري (gauge) — لدرجة من 100 (Academic Health Score)
// ─────────────────────────────────────────────────────────────────────────────
export function GaugeChart({ value = 0, max = 100, label = '', size = 200 }) {
  const pct = Math.max(0, Math.min(max, value)) / max;
  const cx = 100, cy = 100, r = 78;
  // قوس نصف دائري من اليسار (180°) لليمين (0°)
  const startAngle = Math.PI, endAngle = Math.PI - pct * Math.PI;
  const x1 = cx + r * Math.cos(startAngle), y1 = cy - r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle), y2 = cy - r * Math.sin(endAngle);
  const largeArc = pct > 0.5 ? 1 : 0;

  // لون حسب الدرجة
  const color = value >= 85 ? THEME.green : value >= 70 ? THEME.accent : value >= 50 ? THEME.amber : THEME.red;
  // خلفية القوس الكامل
  const bx2 = cx + r * Math.cos(0), by2 = cy - r * Math.sin(0);

  return `
  <svg viewBox="0 0 200 130" style="width:${size}px;height:auto;max-width:100%" xmlns="http://www.w3.org/2000/svg">
    <path d="M ${(cx - r)} ${cy} A ${r} ${r} 0 0 1 ${bx2.toFixed(1)} ${by2.toFixed(1)}" fill="none" stroke="${THEME.surface}" stroke-width="14" stroke-linecap="round"/>
    <path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"/>
    <text x="${cx}" y="${cy - 8}" font-size="30" font-weight="800" fill="${THEME.ink}" text-anchor="middle">${Math.round(value)}</text>
    <text x="${cx}" y="${cy + 12}" font-size="11" fill="${THEME.muted}" text-anchor="middle">من ${max}</text>
    ${label ? `<text x="${cx}" y="${cy + 26}" font-size="10" font-weight="700" fill="${color}" text-anchor="middle">${esc(label)}</text>` : ''}
  </svg>`;
}
