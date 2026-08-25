// src/modules/student-report/studentWhatsappService.js
// ═══════════════════════════════════════════════════════════════════════════
// خدمة رسائل واتساب لأولياء الأمور — خاصة بتقرير الطالب فقط.
// رسائل ذكية ديناميكية من بيانات حقيقية (لا اختراع). واجهة الـ UI:
// generateMessage() · copyMessage() · openWhatsapp().
// مصمّمة لتوسّع مستقبلي (أنواع رسائل متعددة) دون تعديل الصفحة.
// ═══════════════════════════════════════════════════════════════════════════

import { gatherStudentData, determineOverallStatus } from './reportData';

// ── أنواع الرسائل (enum — للتوسّع المستقبلي) ──────────────────────────────
export const MessageType = Object.freeze({
  FOLLOWUP_SUMMARY: 'followupSummary',
  MONTHLY_REPORT:   'monthlyReport',
  WEEKLY_REPORT:    'weeklyReport',
  ATTENDANCE_ALERT: 'attendanceAlert',
  EXAM_ALERT:       'examAlert',
  PAYMENT_REMINDER: 'paymentReminder',
  HOMEWORK_REMINDER:'homeworkReminder',
  BEHAVIOR_REPORT:  'behaviorReport',
});

export const MESSAGE_TYPE_LABELS = Object.freeze({
  [MessageType.FOLLOWUP_SUMMARY]: 'ملخص متابعة',
  [MessageType.MONTHLY_REPORT]:   'تقرير شهري',
  [MessageType.WEEKLY_REPORT]:    'تقرير أسبوعي',
  [MessageType.ATTENDANCE_ALERT]: 'تنبيه حضور',
  [MessageType.EXAM_ALERT]:       'تنبيه امتحان',
  [MessageType.PAYMENT_REMINDER]: 'تذكير دفع',
  [MessageType.HOMEWORK_REMINDER]:'تذكير واجب',
  [MessageType.BEHAVIOR_REPORT]:  'تقرير سلوك',
});

// ─────────────────────────────────────────────────────────────────────────────
// أدوات مساعدة
// ─────────────────────────────────────────────────────────────────────────────
function fmtMoney(n) {
  const num = Number(n) || 0;
  return `${num.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م`;
}

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return ''; }
}

// تنظيف رقم الهاتف لصيغة واتساب الدولية (مصر +20)
function normalizePhone(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('00')) p = p.slice(2);
  // رقم مصري محلي 01xxxxxxxxx → 201xxxxxxxxx
  if (/^01[0-9]{9}$/.test(p)) return '20' + p.slice(1);
  // رقم مصري بصيغة دولية بالفعل 201xxxxxxxxx (12 رقماً)
  if (/^201[0-9]{9}$/.test(p)) return p;
  // أي صيغة أخرى غير مدعومة → مرفوضة
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// أقسام الرسالة — كل دالة تُرجع نصاً (أو فارغاً إذا لا داعي لها)
// ─────────────────────────────────────────────────────────────────────────────

// التحية
export function buildGreeting() {
  return 'السلام عليكم ورحمة الله وبركاته';
}

// الرأس الاحترافي (اسم السنتر + عنوان + مقدمة + بيانات الطالب)
export function buildHeader(data, profile) {
  const { student, group } = data;
  const teacher = student.teacherName || group?.teacherName || profile?.teacherName || '';
  const lines = [];
  if (profile?.name) lines.push(`🏫 ${profile.name}`);
  lines.push('تقرير متابعة الطالب');
  lines.push('');
  lines.push('نودّ إطلاعكم على آخر مستجدات الطالب:');
  lines.push('');
  lines.push(`👤 الطالب: ${student.name}`);
  if (student.grade) lines.push(`📚 الصف: ${student.grade}`);
  if (group?.name) lines.push(`👥 المجموعة: ${group.name}`);
  if (teacher) lines.push(`🧑‍🏫 المدرّس: ${teacher}`);
  return lines.join('\n');
}

// الحضور — يظهر فقط لو فيه حصص
export function buildAttendanceMessage(data) {
  const { attendance } = data;
  if (!attendance || attendance.total === 0) return '';
  const lines = ['📅 الحضور:'];
  lines.push(`• حضور: ${attendance.present}`);
  lines.push(`• غياب: ${attendance.absent}`);
  if (attendance.pct != null) lines.push(`• نسبة الحضور: ${attendance.pct}%`);
  return lines.join('\n');
}

// الامتحانات — يظهر فقط لو فيه امتحانات
export function buildExamMessage(data) {
  const { exams, examAvg, examHighest, failedCount } = data;
  if (!exams || exams.length === 0) return '';
  const lines = ['📝 الامتحانات:'];
  if (examAvg != null) lines.push(`• المعدل: ${examAvg}%`);
  if (examHighest != null) lines.push(`• أعلى درجة: ${examHighest}%`);
  const latest = exams[exams.length - 1];
  if (latest) lines.push(`• آخر امتحان: ${latest.examName} (${latest.pct}%)`);
  if (failedCount > 0) lines.push(`• يوجد ${failedCount} امتحان يحتاج تحسيناً.`);
  return lines.join('\n');
}

// المالية — يظهر فقط لو فيه رسوم
export function buildFinanceMessage(data) {
  const { monthlyFee, netPaid } = data;
  if (!monthlyFee || monthlyFee <= 0) return '';
  const remaining = Math.max(0, monthlyFee - netPaid);
  const lines = ['💰 الوضع المالي:'];
  lines.push(`• المدفوع: ${fmtMoney(netPaid)}`);
  if (remaining > 0) lines.push(`• المتبقّي: ${fmtMoney(remaining)}`);
  else lines.push('• السداد مكتمل ✓');
  return lines.join('\n');
}

// المذكرات — يظهر فقط لو فيه مذكرات مستلمة
export function buildBookletMessage(data) {
  const { bookletDeliveries } = data;
  if (!bookletDeliveries || bookletDeliveries.length === 0) return '';
  const lines = ['📚 المذكرات المستلمة:'];
  bookletDeliveries.forEach((b) => {
    const name = b.materialName || b.reason || (b.date ? fmtDate(b.date) : 'مذكرة');
    lines.push(`✓ ${name}`);
  });
  return lines.join('\n');
}

// ملاحظات المدرّس — يظهر فقط لو فيه ملاحظات
export function buildTeacherNotes(data) {
  const notes = data.student?.notes;
  if (!notes || !notes.trim()) return '';
  return `🗒️ ملاحظات المدرّس:\n${notes.trim()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// التوصيات الذكية — جُمل تتبدّل حسب البيانات الحقيقية (لا اختراع)
// ─────────────────────────────────────────────────────────────────────────────
export function buildRecommendations(data) {
  const { attendance, examAvg, failedCount, monthlyFee, netPaid, bookletDeliveries } = data;
  const recs = [];
  const status = determineOverallStatus(data);

  // حضور
  const attPct = attendance?.pct;
  const attExcellent = attPct != null && attPct >= 90;
  const attLow = attPct != null && attPct < 75;

  // امتحانات
  const examExcellent = examAvg != null && examAvg >= 85;
  const examLow = examAvg != null && examAvg < 60;

  // حالة متميّزة (حضور + درجات) → تهنئة
  if (attExcellent && examExcellent) {
    recs.push('🌟 نبارك لكم تميّز الطالب في الحضور والدرجات، ونتمنى استمرار هذا المستوى الرائع.');
  } else if (examExcellent) {
    recs.push('🌟 أداء أكاديمي متميّز، نشكر لكم متابعتكم ونتمنى الاستمرار.');
  } else if (attExcellent) {
    recs.push('👏 حضور ممتاز ومنتظم، نشكر لكم حرصكم على مواظبة الطالب.');
  }

  // حضور منخفض → طلب مهذّب
  if (attLow) {
    recs.push('🔔 نلاحظ انخفاضاً في نسبة الحضور، ونرجو متابعة انتظام الطالب في الحصص.');
  }

  // درجات منخفضة → توصية
  if (examLow) {
    recs.push('📖 ننصح بتخصيص وقت إضافي للمراجعة والمذاكرة لتحسين المستوى.');
  } else if (failedCount > 0) {
    recs.push('📖 يُرجى متابعة الطالب في المواد التي تحتاج إلى تحسين.');
  }

  // رصيد متبقٍّ → تذكير مهذّب
  if (monthlyFee > 0 && (monthlyFee - netPaid) > 0) {
    recs.push('💳 نودّ تذكيركم بوجود رصيد متبقٍّ، ونشكر لكم تعاونكم.');
  }

  // حالة حرجة بدون توصيات محددة
  if (recs.length === 0 && status === 'critical') {
    recs.push('🔔 نرجو التواصل مع الإدارة لمتابعة وضع الطالب.');
  }

  if (recs.length === 0) return '';
  return recs.join('\n');
}

// الخاتمة (مع الحالة العامة)
export function buildClosing(data) {
  const status = determineOverallStatus(data);
  const map = {
    excellent:      '🟢 التقييم العام: ممتاز',
    good:           '🟢 التقييم العام: جيد',
    needsAttention: '🟡 التقييم العام: يحتاج متابعة',
    critical:       '🔴 التقييم العام: يحتاج اهتماماً عاجلاً',
  };
  return `${map[status] || map.good}\n\nمع تحيات إدارة السنتر 🌟`;
}

// ─────────────────────────────────────────────────────────────────────────────
// توليد الرسالة الكاملة (الواجهة الرئيسية للـ UI)
// ─────────────────────────────────────────────────────────────────────────────
export function generateMessage(studentId, store, { profile = {}, type = MessageType.FOLLOWUP_SUMMARY } = {}) {
  const data = gatherStudentData(studentId, store);
  if (!data) return null;

  // تجميع الأقسام — الفارغة تُستبعد تلقائياً (لا أقسام فارغة)
  const sections = [
    buildGreeting(),
    buildHeader(data, profile),
    buildAttendanceMessage(data),
    buildExamMessage(data),
    buildFinanceMessage(data),
    buildBookletMessage(data),
    buildTeacherNotes(data),
    buildRecommendations(data),
    buildClosing(data),
  ].filter((s) => s && s.trim());

  const message = sections.join('\n\n');
  const phone = data.student.parentPhone || '';

  return {
    message,
    studentId,
    studentName: data.student.name,
    parentPhone: phone,
    reportType: type,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// بناء رابط واتساب (رسمي فقط — wa.me)
// ─────────────────────────────────────────────────────────────────────────────
export function buildWhatsappUrl(phone, message) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// نسخ الرسالة (يرجع النص — الـ UI ينفّذ النسخ الفعلي)
// ─────────────────────────────────────────────────────────────────────────────
export function copyMessage(message) {
  if (navigator?.clipboard?.writeText) {
    return navigator.clipboard.writeText(message).then(() => true).catch(() => false);
  }
  return Promise.resolve(false);
}

// ─────────────────────────────────────────────────────────────────────────────
// فتح واتساب بالرسالة الجاهزة (لا إرسال تلقائي)
// يرجع { ok, error, url }
// ─────────────────────────────────────────────────────────────────────────────
export function openWhatsapp(phone, message) {
  if (!phone) return { ok: false, error: 'لا يوجد رقم هاتف لولي الأمر.' };
  const url = buildWhatsappUrl(phone, message);
  if (!url) return { ok: false, error: 'رقم هاتف ولي الأمر غير صالح.' };
  const opened = window.open(url, '_blank');
  if (!opened) {
    return { ok: false, error: 'تعذّر فتح واتساب. يرجى السماح بالنوافذ المنبثقة.' };
  }
  return { ok: true, url };
}
