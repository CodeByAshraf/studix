// src/modules/student-report/buildPrintReport.js
// ─────────────────────────────────────────────────────────────────────────────
// مولّد تقرير الطالب للطباعة — نافذة مستقلة نظيفة (HTML كامل)
//
// لماذا نافذة مستقلة بدل window.print() للصفحة الحالية؟
//   - طباعة الصفحة الحالية تحمل معها الـ sidebar والقوائم والتخطيط المعقّد،
//     وتتلخبط في الـ RTL فيظهر النص معكوساً.
//   - نافذة مستقلة = HTML نظيف، direction:rtl صريح، خط Cairo، وتنسيق A4 مضبوط.
//     نفس الأسلوب الذي تطبع به بطاقات الطلاب بنجاح.
//
// كل الدوال هنا خالصة (pure): تأخذ بيانات وتُعيد HTML string. لا تلمس الـ DOM
// إلا في الدالة النهائية openStudentReportPrint.
//
// إعدادات أقسام التقرير (Settings ← أقسام تقرير الطالب، src/reportEngine/reportMeta.js)
// — كانت غير مقروءة هنا إطلاقاً قبل مراجعة توحيد الرؤية (تدقيق أثبت أن هذا المسار يعرض
// كل شيء دائماً بصرف النظر عن الإعداد، بخلاف "التقرير الاحترافي" الذي كان يقرأها بالفعل).
// config اختياري (افتراضي {} = كل الأقسام ظاهرة، نفس السلوك القديم تماماً) — isSectionVisible
// تُعيد true لأي مفتاح غائب، فطالب لم يمرَّر له config إطلاقاً (لو استُدعيت هذه الدالة من
// مكان آخر غير StudentReportPage.jsx مستقبلاً) لا ينكسر ولا يفقد أي قسم.
// ─────────────────────────────────────────────────────────────────────────────
import { isSectionVisible } from '../../reportEngine';

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                   'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

const HW_LABEL = { submitted:'سُلِّم', late:'متأخر', missing:'لم يُسلَّم' };
const HW_COLOR = { submitted:'#10b981', late:'#f59e0b', missing:'#ef4444' };
const PAY_METHOD = { cash:'كاش', transfer:'تحويل', instapay:'انستاباي', check:'شيك' };
const PAY_STATUS = {
  paid:    { l:'مدفوع',      c:'#10b981' },
  partial: { l:'جزئي',       c:'#f59e0b' },
  unpaid:  { l:'غير مدفوع',  c:'#ef4444' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

// تهريب HTML — يمنع كسر التقرير لو اسم فيه رموز، ويمنع حقن HTML.
function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ar-EG', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return String(d);
  }
}

function fmtDateShort(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ar-EG', {
      year: '2-digit', month: 'short', day: 'numeric',
    });
  } catch {
    return String(d);
  }
}

function fmtMoney(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('ar-EG') + ' ج.م';
}

function pctColor(p) {
  if (p == null) return '#94a3b8';
  if (p >= 80) return '#10b981';
  if (p >= 60) return '#f59e0b';
  return '#ef4444';
}

function grade(p) {
  if (p == null) return '—';
  if (p >= 90) return 'A+';
  if (p >= 80) return 'A';
  if (p >= 70) return 'B';
  if (p >= 60) return 'C';
  if (p >= 50) return 'D';
  return 'F';
}

function initials(name) {
  return (name || '').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
}

// ── مكوّنات صغيرة تُعيد HTML ──────────────────────────────────────────────────

// بطاقة إحصائية (KPI)
function kpi(label, value, color = '#0d9488', sub = '') {
  return `
    <div class="kpi">
      <div class="kpi-val" style="color:${color}">${esc(value)}</div>
      <div class="kpi-label">${esc(label)}</div>
      ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}
    </div>`;
}

// عنوان قسم
function sectionTitle(icon, title, count) {
  return `
    <div class="sec-title">
      <span class="sec-icon">${icon}</span>
      <span>${esc(title)}</span>
      ${count != null ? `<span class="sec-count">${esc(count)}</span>` : ''}
    </div>`;
}

// شريط تقدّم بسيط
function bar(pct, color) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return `<div class="bar"><div class="bar-fill" style="width:${p}%;background:${color}"></div></div>`;
}

// صف في جدول
function badge(text, color) {
  return `<span class="badge" style="color:${color};border-color:${color}55;background:${color}12">${esc(text)}</span>`;
}

// ── أقسام التقرير ─────────────────────────────────────────────────────────────

function headerHTML(profile) {
  const hasLogo = profile && profile.logoUrl;
  const name = (profile && profile.name) || 'مركز التعليم';
  return `
    <div class="report-header">
      <div class="rh-right">
        ${hasLogo ? `<img class="rh-logo" src="${esc(profile.logoUrl)}" alt="logo"/>` : ''}
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

function studentCardHTML(student, group) {
  const rows = [
    ['كود الطالب', student.code],
    ['السنة الدراسية', student.grade],
    ['المجموعة', group ? `${group.name}${group.subject ? ' — ' + group.subject : ''}` : '—'],
    ['المدرس', group && group.teacherName ? group.teacherName : '—'],
    ['رقم الهاتف', student.phone],
    ['رقم ولي الأمر', student.parentPhone],
    ['المدرسة', student.school],
    ['تاريخ التسجيل', fmtDate(student.enrollDate)],
  ];
  const statusMeta = {
    active:    { l:'نشط',   c:'#10b981' },
    inactive:  { l:'موقوف', c:'#ef4444' },
    graduated: { l:'متخرج', c:'#6366f1' },
  }[student.status] || { l:'—', c:'#94a3b8' };

  return `
    <div class="student-card">
      <div class="sc-avatar">${esc(initials(student.name))}</div>
      <div class="sc-main">
        <div class="sc-name-row">
          <div class="sc-name">${esc(student.name)}</div>
          ${badge(statusMeta.l, statusMeta.c)}
        </div>
        <div class="sc-grid">
          ${rows.map(([l, v]) => `
            <div class="sc-item">
              <span class="sc-item-l">${esc(l)}</span>
              <span class="sc-item-v">${esc(v || '—')}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

function summaryHTML(d, config) {
  // BUG-02 (بيان مطبوع — NEEDS BUSINESS DECISION مُغلَق): إجمالي المدفوع هنا يبقى خاماً
  // (Gross) مطابقاً لمجموع جدول المدفوعات أدناه؛ عند وجود استرداد فعلي، تُستبدَل هذه
  // الخانة بالصافي (Net) صراحةً بدل ترك رقم خام يُقرأ كأنه الوضع المالي الحالي.
  const moneyKpi = d.refundedTotal > 0
    ? kpi('صافي المدفوع', fmtMoney(d.netPaid), '#10b981', `${fmtMoney(d.totalPaid)} إجمالي − ${fmtMoney(d.refundedTotal)} مسترد`)
    : kpi('إجمالي المدفوع', fmtMoney(d.totalPaid), '#10b981', `${d.paidCount} دفعة`);

  // كل KPI مربوط بعلم قسمه — إخفاء "الملخّص المالي" مثلاً يُخفي خانة المبلغ هنا أيضاً، لا
  // تكفي تصفية summaryHTML نفسها لو استُدعيت مباشرة. عدد الأعمدة يتبع عدد الخانات الظاهرة
  // فعلياً (inline style يتفوّق على .kpi-row الثابتة في reportCSS) لتفادي فراغ الشبكة.
  const items = [
    { flag: 'showAttendance',       html: kpi('نسبة الحضور', d.attPct != null ? d.attPct + '%' : '—', pctColor(d.attPct), `${d.attPresent} من ${d.attAll.length} حصة`) },
    { flag: 'showExams',            html: kpi('متوسط الدرجات', d.avgExamPct != null ? d.avgExamPct + '%' : '—', pctColor(d.avgExamPct), `تقدير ${grade(d.avgExamPct)}`) },
    { flag: 'showFinancialSummary', html: moneyKpi },
    { flag: 'showHomework',         html: kpi('الواجبات المُسلَّمة', `${d.hwSubmitted}/${d.hwRows.length}`, '#8b5cf6', `${d.hwMissing} غير مُسلَّم`) },
  ].filter((k) => isSectionVisible(config, k.flag));

  if (!items.length) return '';
  return `
    <div class="kpi-row" style="grid-template-columns:repeat(${items.length},1fr)">
      ${items.map((k) => k.html).join('')}
    </div>`;
}

function attendanceHTML(d) {
  if (!d.attAll.length) return '';
  const trend = d.attTrend.length ? `
    <div class="trend">
      ${d.attTrend.map((t) => `
        <div class="trend-col">
          ${bar(t.val, pctColor(t.val))}
          <div class="trend-lbl">${esc(t.label)}</div>
          <div class="trend-val">${t.val}%</div>
        </div>`).join('')}
    </div>` : '';

  return `
    <div class="section avoid-break">
      ${sectionTitle('✓', 'سجل الحضور', d.attAll.length)}
      <div class="mini-kpis">
        ${kpi('حاضر', d.attPresent, '#10b981')}
        ${kpi('غائب', d.attAbsent, '#ef4444')}
        ${kpi('متأخر', d.attLate, '#f59e0b')}
        ${kpi('النسبة', d.attPct != null ? d.attPct + '%' : '—', pctColor(d.attPct))}
      </div>
      ${trend ? `<div class="sub-label">التطور الشهري لنسبة الحضور</div>${trend}` : ''}
    </div>`;
}

function examsHTML(d) {
  if (!d.examRows.length) return '';
  const rows = d.examRows.map((r) => `
    <tr>
      <td>${esc(r.exam.name)}</td>
      <td>${fmtDateShort(r.exam.date)}</td>
      <td class="num">${r.absent ? '—' : `${r.score}/${r.total}`}</td>
      <td class="num">${r.pct != null ? `<span style="color:${pctColor(r.pct)};font-weight:700">${r.pct}%</span>` : '—'}</td>
      <td class="num">${r.absent ? badge('غائب', '#94a3b8') : (r.score >= r.pass ? badge('ناجح', '#10b981') : badge('راسب', '#ef4444'))}</td>
    </tr>`).join('');

  return `
    <div class="section avoid-break">
      ${sectionTitle('📝', 'الامتحانات', d.examRows.length)}
      <div class="mini-kpis">
        ${kpi('المتوسط', d.avgExamPct != null ? d.avgExamPct + '%' : '—', pctColor(d.avgExamPct))}
        ${kpi('ناجح في', `${d.passedExams}/${d.validExams.length}`, '#10b981')}
        ${kpi('التقدير العام', grade(d.avgExamPct), pctColor(d.avgExamPct))}
      </div>
      <table class="report-table">
        <thead><tr><th>الامتحان</th><th>التاريخ</th><th class="num">الدرجة</th><th class="num">النسبة</th><th class="num">الحالة</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// نفس نمط examsHTML أعلاه بالضبط — تُعيد '' (لا قسم إطلاقاً) عند غياب أي سجل، بدل
// رسالة "لا توجد بيانات"، نفس سلوك examsHTML/homeworksHTML الحالي هنا تحديداً (يختلف
// عمداً عن سلوك تبويب الشاشة الحيّة الذي يعرض EmptySection دائماً).
function recitationHTML(d) {
  if (!d.recitationRows.length) return '';
  const rows = d.recitationRows.map((r) => `
    <tr>
      <td>${esc(r.groupName || '—')}</td>
      <td>${fmtDateShort(r.date)}</td>
      <td>${r.sessionTime ? esc(r.sessionTime) : '—'}</td>
      <td class="num">${r.pct != null ? `${esc(r.score)}/${esc(r.maxScore)}` : '—'}</td>
      <td class="num">${r.pct != null ? `<span style="color:${pctColor(r.pct)};font-weight:700">${r.pct}%</span>` : '—'}</td>
      <td>${r.note ? esc(r.note) : '—'}</td>
    </tr>`).join('');

  return `
    <div class="section avoid-break">
      ${sectionTitle('🎤', 'التسميع', d.recitationRows.length)}
      <div class="mini-kpis">
        ${kpi('إجمالي الجلسات', d.recitationRows.length, '#0d9488')}
        ${kpi('تم تقييمها', d.evaluatedRecitationCount, '#10b981')}
        ${kpi('المتوسط', d.avgRecitationPct != null ? d.avgRecitationPct + '%' : '—', pctColor(d.avgRecitationPct))}
      </div>
      <table class="report-table">
        <thead><tr><th>المجموعة</th><th>التاريخ</th><th>الحصة</th><th class="num">الدرجة</th><th class="num">النسبة</th><th>ملاحظة</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function homeworksHTML(d) {
  if (!d.hwRows.length) return '';
  const rows = d.hwRows.map((r) => `
    <tr>
      <td>${esc(r.hw.title)}</td>
      <td>${fmtDateShort(r.hw.dueDate)}</td>
      <td>${r.submittedAt ? fmtDateShort(r.submittedAt) : '—'}</td>
      <td class="num">${r.score != null ? esc(r.score) : '—'}</td>
      <td class="num">${badge(HW_LABEL[r.status] || r.status, HW_COLOR[r.status] || '#94a3b8')}</td>
    </tr>`).join('');

  return `
    <div class="section avoid-break">
      ${sectionTitle('📋', 'الواجبات', d.hwRows.length)}
      <div class="mini-kpis">
        ${kpi('سُلِّم', d.hwSubmitted, '#10b981')}
        ${kpi('متأخر', d.hwLate, '#f59e0b')}
        ${kpi('لم يُسلَّم', d.hwMissing, '#ef4444')}
      </div>
      <table class="report-table">
        <thead><tr><th>الواجب</th><th>موعد التسليم</th><th>تاريخ التسليم</th><th class="num">الدرجة</th><th class="num">الحالة</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function materialsHTML(d) {
  if (!d.matRows.length) return '';
  const rows = d.matRows.map((r) => `
    <tr>
      <td>${esc(r.mat.name)}</td>
      <td>${esc(r.mat.subject || '—')}</td>
      <td class="num">${r.received ? badge('مُستلَم', '#10b981') : badge('لم يُستلَم', '#94a3b8')}</td>
      <td class="num">${fmtMoney(r.paidAmount || 0)}</td>
    </tr>`).join('');

  return `
    <div class="section avoid-break">
      ${sectionTitle('📚', 'المذكرات والمواد', d.matRows.length)}
      <div class="mini-kpis">
        ${kpi('مُستلَم', d.matReceived, '#3b82f6')}
        ${kpi('مدفوع', d.matPaid, '#10b981')}
        ${kpi('إجمالي المدفوع', fmtMoney(d.matTotal), '#10b981')}
      </div>
      <table class="report-table">
        <thead><tr><th>المذكرة</th><th>المادة</th><th class="num">الاستلام</th><th class="num">المبلغ</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function paymentsHTML(d) {
  if (!d.payRows.length) return '';
  const rows = d.payRows.map((p) => {
    const st = PAY_STATUS[p.status] || { l: p.status, c: '#94a3b8' };
    return `
    <tr>
      <td>${fmtDateShort(p.date)}</td>
      <td>${esc(MONTHS_AR[(p.month || 1) - 1] || '—')}</td>
      <td class="num">${fmtMoney(p.amount)}</td>
      <td>${esc(PAY_METHOD[p.method] || p.method || '—')}</td>
      <td class="num">${badge(st.l, st.c)}</td>
    </tr>`;
  }).join('');

  // نفس مبدأ summaryHTML أعلاه: الجدول أدناه يعرض المبالغ الأصلية التاريخية كما هي —
  // "إجمالي المدفوع" يبقى خاماً مطابقاً له، والمسترد/الصافي يظهران كبندين منفصلين فقط
  // عند وجود استرداد فعلي (Net = Gross − Refunded).
  const moneyKpis = d.refundedTotal > 0
    ? `${kpi('إجمالي المدفوع', fmtMoney(d.totalPaid), '#10b981')}${kpi('المسترد', fmtMoney(d.refundedTotal), '#ef4444')}${kpi('الصافي', fmtMoney(d.netPaid), '#0d9488')}${kpi('عدد الدفعات', d.paidCount, '#0d9488')}`
    : `${kpi('إجمالي المدفوع', fmtMoney(d.totalPaid), '#10b981')}${kpi('عدد الدفعات', d.paidCount, '#0d9488')}`;
  return `
    <div class="section avoid-break">
      ${sectionTitle('💰', 'المدفوعات', d.payRows.length)}
      <div class="mini-kpis">
        ${moneyKpis}
      </div>
      <table class="report-table">
        <thead><tr><th>التاريخ</th><th>عن شهر</th><th class="num">المبلغ</th><th>الطريقة</th><th class="num">الحالة</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function timelineHTML(d) {
  if (!d.timeline || !d.timeline.length) return '';
  const items = d.timeline.slice(0, 40).map((t) => `
    <div class="tl-item">
      <div class="tl-dot" style="background:${t.color}"></div>
      <div class="tl-body">
        <div class="tl-title">${t.icon} ${esc(t.title)}</div>
        <div class="tl-meta">${fmtDateShort(t.date)}${t.sub ? ' · ' + esc(t.sub) : ''}</div>
      </div>
    </div>`).join('');

  return `
    <div class="section">
      ${sectionTitle('🕐', 'السجل الزمني', d.timeline.length)}
      <div class="timeline">${items}</div>
    </div>`;
}

// ── CSS للطباعة ───────────────────────────────────────────────────────────────
function reportCSS() {
  return `
    @page { size: A4 portrait; margin: 12mm; }
    * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    body {
      font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
      direction: rtl; text-align: right;
      color: #1e293b; background: #fff;
      line-height: 1.5; font-size: 12px;
      width: 100%; overflow-x: hidden;
    }
    .page { width: 100%; max-width: 186mm; margin: 0 auto; padding: 0; }

    /* رأس التقرير */
    .report-header {
      display:flex; justify-content:space-between; align-items:center;
      padding-bottom:14px; margin-bottom:18px; border-bottom:3px solid #0d9488;
    }
    .rh-right { display:flex; align-items:center; gap:12px; }
    .rh-logo { width:56px; height:56px; object-fit:contain; border-radius:10px; }
    .rh-logo-ph { background:#0d9488; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:20px; }
    .rh-name { font-size:20px; font-weight:900; color:#0f766e; }
    .rh-slogan { font-size:12px; color:#64748b; margin-top:2px; }
    .rh-left { font-size:11px; color:#64748b; text-align:left; line-height:1.9; }

    /* عنوان التقرير */
    .report-title { text-align:center; font-size:16px; font-weight:800; color:#0f766e; margin-bottom:16px; padding:8px; background:#0d948810; border-radius:8px; }

    /* بطاقة الطالب */
    .student-card { display:flex; gap:16px; padding:16px; border:1px solid #e2e8f0; border-radius:12px; margin-bottom:18px; background:#f8fafc; }
    .sc-avatar { width:64px; height:64px; flex-shrink:0; border-radius:14px; background:#0d9488; color:#fff; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:900; }
    .sc-main { flex:1; }
    .sc-name-row { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
    .sc-name { font-size:19px; font-weight:900; color:#0f172a; }
    .sc-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px 24px; }
    .sc-item { display:flex; justify-content:space-between; gap:8px; padding:3px 0; border-bottom:1px dotted #e2e8f0; }
    .sc-item-l { color:#64748b; font-size:11px; }
    .sc-item-v { color:#1e293b; font-weight:700; font-size:11px; }

    /* KPIs */
    .kpi-row { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:20px; }
    .mini-kpis { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
    .mini-kpis .kpi { flex:1; min-width:80px; }
    .kpi { padding:10px 12px; border:1px solid #e2e8f0; border-radius:10px; text-align:center; background:#fff; }
    .kpi-val { font-size:20px; font-weight:900; line-height:1.2; }
    .kpi-label { font-size:10px; color:#64748b; margin-top:3px; font-weight:700; }
    .kpi-sub { font-size:9px; color:#94a3b8; margin-top:2px; }

    /* الأقسام */
    .section { margin-bottom:22px; }
    .sec-title { display:flex; align-items:center; gap:8px; font-size:15px; font-weight:800; color:#0f766e; margin-bottom:12px; padding-bottom:6px; border-bottom:2px solid #e2e8f0; }
    .sec-icon { font-size:16px; }
    .sec-count { margin-right:auto; font-size:11px; font-weight:700; color:#64748b; background:#f1f5f9; padding:2px 10px; border-radius:99px; }
    .sub-label { font-size:11px; color:#64748b; font-weight:700; margin:10px 0 6px; }

    /* الجداول */
    .report-table { width:100%; border-collapse:collapse; font-size:11px; table-layout:fixed; word-break:break-word; }
    .report-table th { background:#f1f5f9; color:#475569; font-weight:800; padding:8px 10px; text-align:right; border-bottom:2px solid #e2e8f0; }
    .report-table td { padding:7px 10px; border-bottom:1px solid #f1f5f9; }
    .report-table tr:nth-child(even) td { background:#f8fafc; }
    .report-table .num { text-align:center; }

    /* Badges */
    .badge { display:inline-block; font-size:10px; font-weight:700; padding:2px 9px; border-radius:99px; border:1px solid; }

    /* الشريط */
    .bar { height:6px; background:#f1f5f9; border-radius:99px; overflow:hidden; }
    .bar-fill { height:100%; border-radius:99px; }

    /* التطور الشهري */
    .trend { display:flex; gap:6px; align-items:flex-end; }
    .trend-col { flex:1; text-align:center; }
    .trend-col .bar { height:auto; }
    .trend-lbl { font-size:9px; color:#94a3b8; margin-top:4px; }
    .trend-val { font-size:10px; font-weight:700; color:#475569; }

    /* التايم لاين */
    .timeline { display:flex; flex-direction:column; gap:2px; }
    .tl-item { display:flex; gap:10px; padding:6px 0; align-items:flex-start; }
    .tl-dot { width:9px; height:9px; border-radius:50%; margin-top:4px; flex-shrink:0; }
    .tl-title { font-size:11px; font-weight:700; color:#1e293b; }
    .tl-meta { font-size:10px; color:#94a3b8; margin-top:1px; }

    /* الفوتر */
    .report-footer { margin-top:24px; padding-top:12px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; font-size:10px; color:#94a3b8; }

    /* تجنّب قطع الأقسام عبر الصفحات */
    .avoid-break { page-break-inside: avoid; }

    /* شريط الأدوات — يختفي عند الطباعة */
    .toolbar { position:fixed; top:0; left:0; right:0; background:#0f766e; color:#fff; padding:12px 20px; display:flex; justify-content:center; gap:12px; z-index:99; box-shadow:0 2px 12px rgba(0,0,0,.2); }
    .toolbar button { font-family:'Cairo',sans-serif; font-size:14px; font-weight:700; padding:9px 24px; border:none; border-radius:8px; cursor:pointer; }
    .tb-print { background:#fff; color:#0f766e; }
    .tb-close { background:#ffffff33; color:#fff; }
    .spacer { height:60px; }
    @media print { .toolbar, .spacer { display:none !important; } }
  `;
}

// ── الدالة الرئيسية ───────────────────────────────────────────────────────────

/**
 * يفتح نافذة طباعة نظيفة بتقرير الطالب الكامل.
 * @param {object} args
 * @param {object} args.student  بيانات الطالب
 * @param {object} args.group    مجموعة الطالب (قد تكون null)
 * @param {object} args.data     كل البيانات المحسوبة (حضور، امتحانات...)
 * @param {object} args.profile  بيانات المركز (اسم، لوجو، هواتف)
 */
export function openStudentReportPrint({ student, group, data, profile, config = {} }) {
  if (!student || !data) return;

  const now = new Date();
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>تقرير: ${esc(student.name)}</title>
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
  <style>${reportCSS()}</style>
</head>
<body>
  <div class="toolbar">
    <button class="tb-print" onclick="window.print()">🖨 طباعة / حفظ PDF</button>
    <button class="tb-close" onclick="window.close()">إغلاق</button>
  </div>
  <div class="spacer"></div>

  <div class="page">
    ${headerHTML(profile)}
    <div class="report-title">تقرير الطالب الشامل — ${esc(student.name)}</div>
    ${isSectionVisible(config, 'showProfile') ? studentCardHTML(student, group) : ''}
    ${summaryHTML(data, config)}
    ${isSectionVisible(config, 'showAttendance')     ? attendanceHTML(data) : ''}
    ${isSectionVisible(config, 'showExams')          ? examsHTML(data)      : ''}
    ${isSectionVisible(config, 'showRecitation')     ? recitationHTML(data) : ''}
    ${isSectionVisible(config, 'showHomework')       ? homeworksHTML(data)  : ''}
    ${isSectionVisible(config, 'showBooklets')       ? materialsHTML(data)  : ''}
    ${isSectionVisible(config, 'showPaymentHistory') ? paymentsHTML(data)   : ''}
    ${isSectionVisible(config, 'showAcademicTimeline') ? timelineHTML(data) : ''}

    <div class="report-footer">
      <span>${esc((profile && profile.name) || 'مركز التعليم')}</span>
      <span>تاريخ الإصدار: ${fmtDate(now)}</span>
    </div>
  </div>

  <script>
    // تركيز تلقائي؛ يترك للمستخدم قرار الطباعة عبر الزر.
    window.focus();
  </script>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) {
    alert('يرجى السماح بالنوافذ المنبثقة (pop-ups) لطباعة التقرير.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
