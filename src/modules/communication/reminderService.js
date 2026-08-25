// src/modules/communication/reminderService.js
// ═══════════════════════════════════════════════════════════════════════════
// مركز التذكيرات الذكي — يولّد التذكيرات تلقائياً من بيانات التواصل والمهام.
// لا إنشاء يدوي. كل شيء محسوب. SQL-ready.
// ═══════════════════════════════════════════════════════════════════════════

import { CommResult, CommReason, CommStatus, TaskStatus, Priority } from './constants';
import { parentKey } from './parentService';

function todayStr() { return new Date().toISOString().split('T')[0]; }
function tomorrowStr() { return new Date(Date.now() + 86400000).toISOString().split('T')[0]; }
function dateOnly(d) { return d ? d.split('T')[0] : null; }

const NO_ANSWER_THRESHOLD = 3;

// ─────────────────────────────────────────────────────────────────────────────
// توليد كل التذكيرات الذكية
// ─────────────────────────────────────────────────────────────────────────────
export function generateReminders(records = [], tasks = []) {
  const today = todayStr();
  const tomorrow = tomorrowStr();

  // ── متابعات من السجلات (حسب followupDate) ──
  const activeRecords = records.filter((r) => r.status !== CommStatus.ARCHIVED && r.followupDate);
  const todayFollowups = activeRecords.filter((r) => dateOnly(r.followupDate) === today);
  const overdueFollowups = activeRecords.filter((r) => dateOnly(r.followupDate) < today);
  const tomorrowFollowups = activeRecords.filter((r) => dateOnly(r.followupDate) === tomorrow);

  // ── مهام ذات أولوية عالية/عاجلة (معلّقة) ──
  const priorityTasks = tasks.filter((t) =>
    t.status === TaskStatus.PENDING &&
    (t.priority === Priority.HIGH || t.priority === Priority.URGENT)
  );

  // ── أولياء أمور بعدم رد أكثر من 3 مرات ──
  const noAnswerByParent = new Map();
  for (const r of records) {
    if (r.result !== CommResult.NO_ANSWER) continue;
    const key = parentKey(r);
    if (!key) continue;
    if (!noAnswerByParent.has(key)) noAnswerByParent.set(key, { key, parentName: r.parentName, phone: r.phone, count: 0 });
    noAnswerByParent.get(key).count++;
  }
  const repeatedNoAnswer = Array.from(noAnswerByParent.values()).filter((p) => p.count >= NO_ANSWER_THRESHOLD);

  // ── وعود دفع مستحقة اليوم (نتيجة = وعد بالدفع + متابعة اليوم) ──
  const paymentPromisesDue = activeRecords.filter((r) =>
    r.result === CommResult.PROMISE_TO_PAY && dateOnly(r.followupDate) === today
  );

  return {
    todayFollowups,
    overdueFollowups,
    tomorrowFollowups,
    priorityTasks,
    repeatedNoAnswer,
    paymentPromisesDue,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// مؤشرات الإنبوكس (لوحة علوية قابلة للنقر)
// ─────────────────────────────────────────────────────────────────────────────
export function getInboxCounts(records = [], tasks = [], { CommType } = {}) {
  const today = todayStr();
  const isToday = (iso) => iso && iso.split('T')[0] === today;
  const active = records.filter((r) => r.status !== CommStatus.ARCHIVED);

  const reminders = generateReminders(records, tasks);
  const todayRecords = active.filter((r) => isToday(r.createdAt));

  // يحتاج إجراء = متأخرة + عدم رد متكرر + وعود اليوم
  const needsAction = reminders.overdueFollowups.length + reminders.repeatedNoAnswer.length;

  return {
    needsAction,
    dueToday: reminders.todayFollowups.length,
    completedToday: active.filter((r) => isToday(r.updatedAt) && r.status === CommStatus.COMPLETED).length,
    callsToday: CommType ? todayRecords.filter((r) => r.type === CommType.PHONE_CALL).length : 0,
    whatsappToday: CommType ? todayRecords.filter((r) => r.type === CommType.WHATSAPP).length : 0,
    overdue: reminders.overdueFollowups.length,
    parentsWaiting: reminders.repeatedNoAnswer.length,
  };
}
