// src/modules/student-report/reportData.js
// ═══════════════════════════════════════════════════════════════════════════
// تجميع بيانات تقرير الطالب + التقييم التلقائي (من البيانات الحقيقية فقط).
// لا يخترع أي معلومة — كل استنتاج مبني على أرقام فعلية.
// ═══════════════════════════════════════════════════════════════════════════

import { getAttendanceStats } from '../../services/attendanceService';
import { scorePercent, gradeStatus } from '../../services/examService';
import { getStudentFee, getRefundedAmount } from '../../services/paymentService';

// ─────────────────────────────────────────────────────────────────────────────
// تجميع كل بيانات الطالب من الـ store
// ─────────────────────────────────────────────────────────────────────────────
export function gatherStudentData(studentId, store) {
  const student = (store.students || []).find((s) => s.id === studentId);
  if (!student) return null;

  const group = (store.groups || []).find((g) => g.id === student.groupId) || null;

  // ── الحضور ──
  const attendance = getAttendanceStats(studentId, store.attendance || []);
  // سجلات الحضور مرتبة زمنياً (لحساب الغياب المتتالي والاتجاه الشهري)
  const attRecords = (store.attendance || [])
    .filter((r) => r.studentId === studentId)
    .slice()
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  // أطول سلسلة غياب متتالية
  let consecutiveAbsence = 0, curStreak = 0;
  for (const r of attRecords) {
    if (r.status === 'absent') { curStreak++; consecutiveAbsence = Math.max(consecutiveAbsence, curStreak); }
    else curStreak = 0;
  }
  // الحضور الشهري (نسبة الحضور لكل شهر)
  const monthlyMap = new Map();
  for (const r of attRecords) {
    if (!r.date) continue;
    const key = String(r.date).slice(0, 7); // YYYY-MM
    if (!monthlyMap.has(key)) monthlyMap.set(key, { present: 0, total: 0 });
    const m = monthlyMap.get(key);
    m.total++;
    if (r.status === 'present') m.present++;
  }
  const monthlyAttendance = Array.from(monthlyMap.entries()).map(([month, m]) => ({
    month,
    pct: m.total ? Math.round((m.present / m.total) * 100) : 0,
  }));
  // اتجاه الحضور: آخر شهر مقابل الذي قبله
  let attendanceTrend = null;
  if (monthlyAttendance.length >= 2) {
    const last = monthlyAttendance[monthlyAttendance.length - 1].pct;
    const prev = monthlyAttendance[monthlyAttendance.length - 2].pct;
    attendanceTrend = last - prev;
  }
  // الواجبات (إن وُجدت)
  const hwSubmissions = (store.hwSubmissions || []).filter((h) => h.studentId === studentId);
  const hwTotal = hwSubmissions.length;
  const hwDone = hwSubmissions.filter((h) => h.status === 'submitted').length;
  const hwRate = hwTotal ? Math.round((hwDone / hwTotal) * 100) : null;

  // ── الامتحانات ودرجاتها ──
  const grades = (store.grades || []).filter((g) => g.studentId === studentId);
  const exams = (store.exams || []);
  const examRows = grades.map((g) => {
    const exam = exams.find((e) => e.id === g.examId);
    if (!exam) return null;
    const pct = scorePercent(g.score, exam.total);
    const status = gradeStatus(g.score, exam.total, exam.pass);
    return {
      examName: exam.name,
      date: exam.date,
      total: exam.total,
      score: g.score,
      pct,
      passed: g.score >= (exam.pass || 0),
      status,
    };
  }).filter(Boolean).sort((a, b) => new Date(a.date) - new Date(b.date));

  const examAvg = examRows.length
    ? Math.round(examRows.reduce((s, e) => s + e.pct, 0) / examRows.length)
    : null;
  const failedCount = examRows.filter((e) => !e.passed).length;
  // تحليلات أعمق للامتحانات
  const examHighest = examRows.length ? Math.max(...examRows.map((e) => e.pct)) : null;
  const examLowest = examRows.length ? Math.min(...examRows.map((e) => e.pct)) : null;
  const examSuccessRate = examRows.length
    ? Math.round((examRows.filter((e) => e.passed).length / examRows.length) * 100)
    : null;
  // اتجاه الأداء: مقارنة أول نصف بآخر نصف
  let examTrend = null;
  if (examRows.length >= 2) {
    const mid = Math.floor(examRows.length / 2);
    const firstHalf = examRows.slice(0, mid);
    const secondHalf = examRows.slice(mid);
    const avgFirst = firstHalf.reduce((s, e) => s + e.pct, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, e) => s + e.pct, 0) / secondHalf.length;
    examTrend = Math.round(avgSecond - avgFirst); // موجب = تحسّن
  }

  // ── المدفوعات ──
  // BUG-02 (منطق كشف استرداد ميت): كان يبحث عن payment.type === 'refund' — لكن الدفعة لا
  // تحمل هذا الحقل بهذه القيمة إطلاقاً في نموذج البيانات الفعلي (immutable، لا نوع
  // "استرداد" عليها). الاسترداد الحقيقي الوحيد يُشتقّ من treasury_txn (ref_type:'refund'،
  // status:'active') عبر getRefundedAmount — نفس مصدر الحقيقة المُستخدَم في كل مكان آخر.
  const payments = (store.payments || []).filter((p) => p.studentId === studentId);
  const treasuryTxn = store.treasuryTxn || [];
  const paidTotal = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const refundTotal = payments.reduce((s, p) => s + getRefundedAmount(p.id, treasuryTxn), 0);
  const monthlyFee = getStudentFee(student, group);

  // ── التواصل (إن وُجد) ──
  const communications = (store.communications || []).filter(
    (c) => (student.parentPhone && c.phone === student.parentPhone) ||
           (student.name && c.studentName === student.name)
  ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // ── المذكرات المسلّمة (من المخزون) ──
  // Phase 3B-12 (إغلاق، Finding #3): نقطة نهاية التسوية (materialDistribution.js) تكتب
  // student_id (FK حقيقي) لكل حركة studentDelivery جديدة، ولا تملأ recipient إطلاقاً —
  // المطابقة القديمة بالاسم وحدها كانت تُفقِد كل تسليم مُهاجَر بصمت. student_id أولاً
  // (يطابق الهجرة)، وrecipient يبقى احتياطاً فقط لحركات ما قبل 3B-12 التي لا student_id
  // لها إطلاقاً — لا حذف لهذا المسار، حتى لا تختفي مذكرات قديمة مسجَّلة بهذا الشكل فقط.
  const bookletDeliveries = (store.inventoryTxn || []).filter((t) => {
    if (t.type !== 'studentDelivery') return false;
    if (t.studentId === studentId) return true;
    return !!(t.recipient && student.name && t.recipient.includes(student.name));
  });

  return {
    student, group,
    attendance,
    attRecords, consecutiveAbsence, monthlyAttendance, attendanceTrend,
    hwTotal, hwDone, hwRate,
    exams: examRows, examAvg, failedCount,
    examHighest, examLowest, examSuccessRate, examTrend,
    payments, paidTotal, refundTotal, monthlyFee,
    netPaid: paidTotal - refundTotal,
    communications,
    bookletDeliveries,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// التقييم التلقائي — جُمل من البيانات الحقيقية فقط
// ─────────────────────────────────────────────────────────────────────────────
export function buildEvaluation(data) {
  const notes = [];
  const { attendance, exams, examAvg, failedCount, payments, refundTotal } = data;

  // الحضور
  if (attendance.pct != null) {
    if (attendance.pct >= 90) notes.push('نسبة حضور ممتازة.');
    else if (attendance.pct >= 75) notes.push('نسبة حضور جيدة.');
    else if (attendance.pct >= 50) notes.push('نسبة الحضور تحتاج إلى تحسين.');
    else notes.push('نسبة حضور منخفضة تستدعي المتابعة.');
    if (attendance.absent >= 3) notes.push(`تغيّب ${attendance.absent} مرات.`);
  }

  // الامتحانات
  if (exams.length > 0) {
    if (examAvg >= 85) notes.push('أداء أكاديمي متميّز في الامتحانات.');
    else if (examAvg >= 65) notes.push('أداء أكاديمي جيد.');
    else notes.push('الأداء الأكاديمي يحتاج إلى دعم.');
    if (failedCount > 0) notes.push(`رسب في ${failedCount} امتحان.`);
  } else {
    notes.push('لا توجد نتائج امتحانات مسجّلة.');
  }

  // المالية
  if (refundTotal > 0) notes.push('يوجد مبلغ مسترد.');
  if (payments.length === 0) notes.push('لا توجد مدفوعات مسجّلة.');

  return notes;
}

// ─────────────────────────────────────────────────────────────────────────────
// الحالة العامة — من البيانات الحقيقية (excellent/good/needsAttention/critical)
// ─────────────────────────────────────────────────────────────────────────────
export function determineOverallStatus(data) {
  const { attendance, examAvg, failedCount } = data;
  let score = 0, factors = 0;

  if (attendance.pct != null) {
    factors++;
    if (attendance.pct >= 90) score += 3;
    else if (attendance.pct >= 75) score += 2;
    else if (attendance.pct >= 50) score += 1;
  }
  if (examAvg != null) {
    factors++;
    if (examAvg >= 85) score += 3;
    else if (examAvg >= 65) score += 2;
    else if (examAvg >= 50) score += 1;
  }

  if (factors === 0) return 'good'; // لا بيانات كافية → محايد
  const avg = score / factors;

  if (failedCount >= 2 || (attendance.pct != null && attendance.pct < 50)) return 'critical';
  if (avg >= 2.5) return 'excellent';
  if (avg >= 1.7) return 'good';
  if (avg >= 1) return 'needsAttention';
  return 'critical';
}

// ─────────────────────────────────────────────────────────────────────────────
// تنبيهات نشطة — من البيانات الحقيقية
// ─────────────────────────────────────────────────────────────────────────────
export function buildAlerts(data) {
  const alerts = [];
  const { attendance, failedCount, refundTotal, netPaid, monthlyFee } = data;

  if (attendance.pct != null && attendance.pct < 60) alerts.push('⚠ نسبة حضور منخفضة');
  if (attendance.absent >= 3) alerts.push(`⚠ ${attendance.absent} حالات غياب`);
  if (failedCount >= 2) alerts.push(`⚠ رسوب في ${failedCount} امتحانات`);
  if (refundTotal > 0) alerts.push('⚠ يوجد استرداد مالي');
  if (netPaid <= 0 && monthlyFee > 0) alerts.push('⚠ لا توجد مدفوعات');

  return alerts;
}

// ─────────────────────────────────────────────────────────────────────────────
// درجة الصحة الأكاديمية (من 100) — من عوامل حقيقية موزونة
// الحضور 30 · الامتحانات 35 · الواجبات 15 · الانضباط المالي 10 · التواصل 10
// ─────────────────────────────────────────────────────────────────────────────
export function computeHealthScore(data) {
  const { attendance, examAvg, hwRate, netPaid, monthlyFee, communications } = data;
  let score = 0;
  const breakdown = [];

  // الحضور (30)
  if (attendance.pct != null) {
    const s = Math.round((attendance.pct / 100) * 30);
    score += s;
    breakdown.push({ label: 'الحضور', score: s, max: 30 });
  } else {
    breakdown.push({ label: 'الحضور', score: 0, max: 30 });
  }

  // الامتحانات (35)
  if (examAvg != null) {
    const s = Math.round((examAvg / 100) * 35);
    score += s;
    breakdown.push({ label: 'الامتحانات', score: s, max: 35 });
  } else {
    breakdown.push({ label: 'الامتحانات', score: 0, max: 35 });
  }

  // الواجبات (15)
  if (hwRate != null) {
    const s = Math.round((hwRate / 100) * 15);
    score += s;
    breakdown.push({ label: 'الواجبات', score: s, max: 15 });
  } else {
    // بدون واجبات: توزيع محايد (نصف الدرجة) حتى لا يُعاقب الطالب
    score += 8;
    breakdown.push({ label: 'الواجبات', score: 8, max: 15 });
  }

  // الانضباط المالي (10)
  let finScore = 10;
  if (monthlyFee > 0) {
    const ratio = Math.max(0, Math.min(1, netPaid / monthlyFee));
    finScore = Math.round(ratio * 10);
  }
  score += finScore;
  breakdown.push({ label: 'الانضباط المالي', score: finScore, max: 10 });

  // التواصل (10)
  const commScore = communications.length > 0 ? 10 : 5;
  score += commScore;
  breakdown.push({ label: 'التواصل', score: commScore, max: 10 });

  score = Math.max(0, Math.min(100, score));

  let interpretation;
  if (score >= 85) interpretation = 'حالة أكاديمية ممتازة';
  else if (score >= 70) interpretation = 'حالة أكاديمية جيدة';
  else if (score >= 50) interpretation = 'تحتاج إلى متابعة';
  else interpretation = 'حالة حرجة تستدعي تدخّلاً';

  return { score, breakdown, interpretation };
}

// ─────────────────────────────────────────────────────────────────────────────
// ملخّص تنفيذي ذكي — جُمل من البيانات الحقيقية فقط (لا اختراع)
// ─────────────────────────────────────────────────────────────────────────────
export function buildAiSummary(data) {
  const notes = [];
  const {
    attendance, attendanceTrend, consecutiveAbsence,
    examAvg, examTrend, failedCount,
    netPaid, monthlyFee, communications,
  } = data;

  // اتجاه الحضور
  if (attendanceTrend != null) {
    if (attendanceTrend <= -15) notes.push(`انخفض الحضور بنسبة ${Math.abs(attendanceTrend)}% مقارنة بالشهر السابق.`);
    else if (attendanceTrend >= 15) notes.push(`تحسّن الحضور بنسبة ${attendanceTrend}% مقارنة بالشهر السابق.`);
  }
  if (attendance.pct != null && attendance.pct >= 95) notes.push('حضور شبه مثالي طوال الفترة.');
  if (consecutiveAbsence >= 3) notes.push(`سلسلة غياب متتالية بلغت ${consecutiveAbsence} حصص.`);

  // اتجاه الامتحانات
  if (examTrend != null) {
    if (examTrend >= 10) notes.push(`تحسّنت درجات الامتحانات بمقدار ${examTrend}%.`);
    else if (examTrend <= -10) notes.push(`تراجعت درجات الامتحانات بمقدار ${Math.abs(examTrend)}%.`);
  }
  if (examAvg != null && examAvg >= 90) notes.push('أداء أكاديمي متميّز باستمرار.');
  if (failedCount >= 2) notes.push(`رسوب في ${failedCount} امتحانات يستدعي المتابعة.`);

  // المالية
  if (monthlyFee > 0 && netPaid <= 0) notes.push('لا توجد مدفوعات مسجّلة حتى الآن.');
  else if (monthlyFee > 0 && netPaid < monthlyFee) notes.push(`يوجد رصيد متبقٍّ قدره ${monthlyFee - netPaid} ج.م.`);

  // التواصل
  if (communications.length === 0) notes.push('لا يوجد تواصل مسجّل مع ولي الأمر.');
  else {
    const lastComm = communications[0];
    const days = Math.floor((Date.now() - new Date(lastComm.createdAt)) / 86400000);
    if (days > 30) notes.push(`لم يتم التواصل مع ولي الأمر منذ ${days} يوماً.`);
  }

  if (notes.length === 0) notes.push('لا توجد ملاحظات جوهرية — الوضع مستقر.');
  return notes;
}
