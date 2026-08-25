// src/reportEngine/components.js
// ═══════════════════════════════════════════════════════════════════════════
// مكوّنات التقارير القابلة لإعادة الاستخدام — تُركّب منها كل التقارير.
// كل مكوّن يُرجع HTML string بهوية بصرية موحّدة. لا تكرار للتخطيطات.
// ═══════════════════════════════════════════════════════════════════════════

import { THEME } from './theme';
import { esc, fmtDate, fmtDateTime, initials } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// رأس التقرير — شعار، اسم السنتر، بيانات المدرّس، عنوان التقرير، رقمه
// ─────────────────────────────────────────────────────────────────────────────
export function ReportHeader({ profile = {}, title, reportNo, generatedBy }) {
  const logo = profile.logoUrl
    ? `<img src="${esc(profile.logoUrl)}" style="width:56px;height:56px;object-fit:contain;border-radius:8px"/>`
    : `<div style="width:56px;height:56px;border-radius:10px;background:${THEME.accent};color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800">${esc(initials(profile.name || 'س'))}</div>`;

  return `
  <div class="rpt-header no-break" style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2.5px solid ${THEME.accent};margin-bottom:18px">
    <div style="display:flex;gap:14px;align-items:center">
      ${logo}
      <div>
        <div style="font-size:16pt;font-weight:800;color:${THEME.ink}">${esc(profile.name || 'السنتر التعليمي')}</div>
        <div style="font-size:9.5pt;color:${THEME.muted};margin-top:2px">
          ${profile.teacherName ? `أ/ ${esc(profile.teacherName)}` : ''}
          ${profile.subject ? ` · ${esc(profile.subject)}` : ''}
          ${profile.academicYear ? ` · ${esc(profile.academicYear)}` : ''}
        </div>
      </div>
    </div>
    <div style="text-align:left">
      <div style="font-size:13pt;font-weight:800;color:${THEME.accent}">${esc(title)}</div>
      ${reportNo ? `<div style="font-size:9pt;color:${THEME.muted};margin-top:3px">رقم التقرير: <span dir="ltr">${esc(reportNo)}</span></div>` : ''}
      <div style="font-size:8.5pt;color:${THEME.faint};margin-top:2px">${fmtDateTime(new Date().toISOString())}</div>
      ${generatedBy ? `<div style="font-size:8.5pt;color:${THEME.faint}">بواسطة: ${esc(generatedBy)}</div>` : ''}
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// تذييل — يظهر أسفل كل صفحة
// ─────────────────────────────────────────────────────────────────────────────
export function ReportFooter({ profile = {}, pageLabel = '' }) {
  return `
  <div class="rpt-footer" style="margin-top:auto;padding-top:10px;border-top:1px solid ${THEME.border};display:flex;justify-content:space-between;align-items:center;font-size:8pt;color:${THEME.faint}">
    <span>${esc(profile.name || '')}${profile.phone1 ? ` · ${esc(profile.phone1)}` : ''}</span>
    <span>${esc(pageLabel)}</span>
    <span>تم الإنشاء بواسطة نظام Studix</span>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// عنوان قسم
// ─────────────────────────────────────────────────────────────────────────────
export function SectionHeader({ icon = '', title, count }) {
  return `
  <div class="no-break" style="display:flex;align-items:center;gap:8px;margin:20px 0 12px;padding-bottom:7px;border-bottom:1.5px solid ${THEME.border}">
    <span style="font-size:13pt">${icon}</span>
    <span style="font-size:12pt;font-weight:800;color:${THEME.ink}">${esc(title)}</span>
    ${count != null ? `<span style="font-size:9pt;font-weight:700;color:${THEME.accent};background:${THEME.accentSoft};padding:2px 9px;border-radius:20px">${esc(count)}</span>` : ''}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// بطاقة KPI — عنوان/قيمة/عنوان فرعي/رمز/لون/اتجاه
// trend: { dir: 'up'|'down'|'flat', text } اختياري
// ─────────────────────────────────────────────────────────────────────────────
export function KPICard({ label, value, subtitle = '', color = THEME.accent, soft = THEME.accentSoft, icon = '', trend = null }) {
  let trendHtml = '';
  if (trend) {
    const arrow = trend.dir === 'up' ? '▲' : trend.dir === 'down' ? '▼' : '—';
    const tColor = trend.dir === 'up' ? THEME.green : trend.dir === 'down' ? THEME.red : THEME.faint;
    trendHtml = `<span style="font-size:8pt;font-weight:700;color:${tColor}">${arrow} ${esc(trend.text || '')}</span>`;
  }
  return `
  <div style="flex:1;min-width:0;background:${soft};border:1px solid ${color}22;border-radius:12px;padding:12px 14px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
      ${icon ? `<span style="font-size:12pt">${icon}</span>` : ''}
      <span style="font-size:8.5pt;color:${THEME.muted}">${esc(label)}</span>
    </div>
    <div style="font-size:15pt;font-weight:800;color:${color}">${esc(value)}</div>
    ${subtitle || trendHtml ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px">
      ${subtitle ? `<span style="font-size:8pt;color:${THEME.muted}">${esc(subtitle)}</span>` : '<span></span>'}
      ${trendHtml}
    </div>` : ''}
  </div>`;
}

// صف من بطاقات KPI
export function KPIRow(cards) {
  return `<div style="display:flex;gap:10px;flex-wrap:wrap">${cards.map(KPICard).join('')}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// بطاقة معلومات — صفوف label/value
// ─────────────────────────────────────────────────────────────────────────────
export function InfoCard({ title, rows = [] }) {
  const body = rows.map(([label, value]) => `
    <tr>
      <td style="padding:6px 0;color:${THEME.muted};font-size:9.5pt;width:38%">${esc(label)}</td>
      <td style="padding:6px 0;color:${THEME.ink};font-size:9.5pt;font-weight:600">${value == null ? '—' : esc(value)}</td>
    </tr>`).join('');
  return `
  <div class="no-break" style="border:1px solid ${THEME.border};border-radius:12px;padding:14px 16px">
    ${title ? `<div style="font-size:10.5pt;font-weight:800;color:${THEME.ink};margin-bottom:8px">${esc(title)}</div>` : ''}
    <table style="width:100%;border-collapse:collapse">${body}</table>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// جدول احترافي (أهم مكوّن) — يُستخدم في كل التقارير.
// يدعم: رؤوس متكررة عبر الصفحات، صفوف متناوبة الألوان، محاذاة عربية/رقمية،
// عرض أعمدة تلقائي، صف إجماليات، empty state، تمييز صفوف، وتعدد الصفحات.
//
// columns: [{ key, label, align, width, numeric, render }]
// rows:    مصفوفة كائنات
// totals:  كائن اختياري { colKey: value } لصف الإجماليات
// options: { alternate, emptyText, highlightFn, canBreak }
// ─────────────────────────────────────────────────────────────────────────────
export function DataTable({ columns = [], rows = [], totals = null, options = {} }) {
  const {
    alternate = true,
    emptyText = 'لا توجد بيانات',
    highlightFn = null,
    canBreak = true,
  } = options;

  const colAlign = (c) => c.align || (c.numeric ? 'center' : 'right');

  // Empty state
  if (rows.length === 0) {
    return `
    <div class="no-break" style="border:1px dashed ${THEME.border};border-radius:10px;padding:26px;text-align:center;color:${THEME.faint};font-size:9.5pt">
      ${esc(emptyText)}
    </div>`;
  }

  const head = columns.map((c) =>
    `<th style="text-align:${colAlign(c)};padding:9px 10px;background:${THEME.surface};color:${THEME.muted};font-size:8.5pt;font-weight:700;border-bottom:1.5px solid ${THEME.border}${c.width ? `;width:${c.width}` : ''}">${esc(c.label)}</th>`
  ).join('');

  const body = rows.map((row, i) => {
    const hl = highlightFn ? highlightFn(row) : null;
    const zebra = (alternate && i % 2 === 1) ? THEME.borderSoft : 'transparent';
    const bg = hl || zebra;
    const cells = columns.map((c) => {
      const val = c.render ? c.render(row) : row[c.key];
      const content = val == null ? '—' : (c.render ? val : esc(val));
      const numStyle = c.numeric ? 'font-variant-numeric:tabular-nums;font-weight:600' : '';
      return `<td style="text-align:${colAlign(c)};padding:8px 10px;font-size:9pt;border-bottom:1px solid ${THEME.borderSoft};color:${THEME.text};${numStyle}">${content}</td>`;
    }).join('');
    // كل صف يتجنّب الكسر داخلياً (لا صفوف مقسومة بين صفحتين)
    return `<tr class="no-break"${bg !== 'transparent' ? ` style="background:${bg}"` : ''}>${cells}</tr>`;
  }).join('');

  // صف الإجماليات
  let totalsRow = '';
  if (totals) {
    const cells = columns.map((c, i) => {
      const val = totals[c.key];
      const content = val != null ? (c.render ? c.render(totals) : esc(val)) : (i === 0 ? 'الإجمالي' : '');
      return `<td style="text-align:${colAlign(c)};padding:10px;font-size:9.5pt;font-weight:800;color:${THEME.ink};border-top:2px solid ${THEME.border};background:${THEME.surface}">${content}</td>`;
    }).join('');
    totalsRow = `<tr class="no-break">${cells}</tr>`;
  }

  return `
  <table class="${canBreak ? '' : 'no-break'}" style="width:100%;border-collapse:collapse;border:1px solid ${THEME.border};border-radius:8px;overflow:hidden">
    <thead><tr>${head}</tr></thead>
    <tbody>${body}${totalsRow}</tbody>
  </table>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// شارة حالة
// ─────────────────────────────────────────────────────────────────────────────
export function StatusBadge({ label, color = THEME.accent, soft }) {
  const bg = soft || `${color}18`;
  return `<span style="display:inline-block;font-size:8.5pt;font-weight:700;padding:3px 11px;border-radius:20px;background:${bg};color:${color}">${esc(label)}</span>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// شريط تقدّم
// ─────────────────────────────────────────────────────────────────────────────
export function ProgressBar({ value = 0, color = THEME.accent, label = '' }) {
  const pct = Math.max(0, Math.min(100, value));
  return `
  <div style="margin:4px 0">
    ${label ? `<div style="display:flex;justify-content:space-between;font-size:9pt;margin-bottom:4px"><span style="color:${THEME.muted}">${esc(label)}</span><span style="font-weight:700;color:${color}">${Math.round(pct)}%</span></div>` : ''}
    <div style="height:9px;background:${THEME.surface};border-radius:20px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${color};border-radius:20px"></div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// خط زمني — عناصر بترتيب زمني بحقول غنية.
// items: [{ icon, color, title, description, date, time, employee, note,
//           status: { label, color, soft } }]
// options: { canBreak } — الافتراضي لا يُكسر (خط زمني متماسك)
// يُستخدم في: تقرير الطالب، التواصل، القبول، الخزنة.
// ─────────────────────────────────────────────────────────────────────────────
export function Timeline(items = [], { canBreak = false } = {}) {
  if (items.length === 0) return `<div style="color:${THEME.faint};font-size:9.5pt;padding:8px">لا توجد بيانات</div>`;
  const body = items.map((it) => {
    const color = it.color || THEME.accent;
    // سطر التاريخ/الوقت/الموظف
    const metaParts = [];
    if (it.date) metaParts.push(esc(it.date));
    if (it.time) metaParts.push(esc(it.time));
    if (it.employee) metaParts.push(esc(it.employee));
    const meta = metaParts.join(' · ');
    const badge = it.status
      ? `<span style="font-size:7.5pt;font-weight:700;padding:2px 8px;border-radius:20px;background:${it.status.soft || (it.status.color + '18')};color:${it.status.color}">${esc(it.status.label)}</span>`
      : '';
    return `
    <div class="no-break" style="position:relative;padding-right:22px;padding-bottom:14px">
      <div style="position:absolute;right:5px;top:3px;bottom:0;width:2px;background:${THEME.border}"></div>
      <div style="position:absolute;right:0;top:2px;width:12px;height:12px;border-radius:50%;background:${color}22;border:2px solid ${color}"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span style="font-size:9.5pt;font-weight:700;color:${THEME.ink}">${it.icon ? it.icon + ' ' : ''}${esc(it.title)}</span>
        ${badge}
      </div>
      ${it.description ? `<div style="font-size:8.5pt;color:${THEME.text};margin-top:1px">${esc(it.description)}</div>` : ''}
      ${meta ? `<div style="font-size:8pt;color:${THEME.muted};margin-top:1px">${meta}</div>` : ''}
      ${it.note ? `<div style="font-size:8pt;color:${THEME.faint};margin-top:2px;font-style:italic">${esc(it.note)}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="${canBreak ? '' : 'no-break'}">${body}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// صندوق ملخّص — تقييم/ملاحظات
// ─────────────────────────────────────────────────────────────────────────────
export function SummaryBox({ title, items = [], color = THEME.accent, soft = THEME.accentSoft }) {
  const body = items.map((t) => `<li style="margin:4px 0;font-size:9.5pt;color:${THEME.text}">${esc(t)}</li>`).join('');
  return `
  <div class="no-break" style="background:${soft};border:1px solid ${color}33;border-radius:12px;padding:14px 18px;margin:8px 0">
    ${title ? `<div style="font-size:10.5pt;font-weight:800;color:${color};margin-bottom:6px">${esc(title)}</div>` : ''}
    <ul style="list-style:none;padding:0">${body}</ul>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// منطقة التوقيع
// ─────────────────────────────────────────────────────────────────────────────
export function SignatureArea({ labels = ['المدرّس', 'الإدارة'] }) {
  const cols = labels.map((l) => `
    <div style="text-align:center;flex:1">
      <div style="height:44px"></div>
      <div style="border-top:1px solid ${THEME.text};padding-top:6px;font-size:9pt;color:${THEME.muted}">${esc(l)}</div>
    </div>`).join('');
  return `<div class="no-break" style="display:flex;gap:40px;margin-top:30px;padding:0 20px">${cols}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// شريط الأدوات (طباعة/إغلاق) — لا يُطبع
// ─────────────────────────────────────────────────────────────────────────────
export function Toolbar() {
  return `
  <div class="toolbar">
    <button class="btn-print" onclick="window.print()">🖨 طباعة / حفظ PDF</button>
    <button class="btn-close" onclick="window.close()">إغلاق</button>
  </div>`;
}
