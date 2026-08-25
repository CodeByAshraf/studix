// src/reportEngine/index.js
// ═══════════════════════════════════════════════════════════════════════════
// نقطة التصدير الموحّدة لمحرّك التقارير — كل التقارير تستورد من هنا.
// ═══════════════════════════════════════════════════════════════════════════

export { THEME, STATUS_COLORS } from './theme';
export { esc, fmtDate, fmtDateShort, fmtDateTime, fmtMoney, fmtPct, initials } from './helpers';
export {
  ReportHeader, ReportFooter, SectionHeader,
  KPICard, KPIRow, InfoCard, DataTable,
  StatusBadge, ProgressBar, Timeline, SummaryBox, SignatureArea, Toolbar,
} from './components';
export { LineChart, BarChart, DonutChart, GaugeChart } from './charts';
export { buildPage, renderReport } from './renderer';
export {
  Grid, Row, Column, Stack, Card, Spacer, PageBreak, KeepTogether,
} from './layout';
export {
  buildReportMeta, buildReportConfig, DEFAULT_REPORT_CONFIG,
} from './reportMeta';
