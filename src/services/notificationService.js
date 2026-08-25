// src/services/notificationService.js
// Product Completion Phase 1 — Issue 4 (Option A, approved): derives Notifications
// entirely from reminderService.js's already-computed, already-tested output — no new
// notification architecture, no backend persistence, reminderService.js itself untouched
// (only its return value is read). Same "derive, don't duplicate" principle already
// proven for matDist (see deriveMatDist in materialService.js) — pure function, no
// independent state of its own. Read/dismissed state is layered on top by the caller
// (ui.context.jsx), not here — this function always returns freshly-derived items with
// read:false; ui.context.jsx overlays the persisted read-id set afterward.
//
// Approved signal set (per the user's Issue 4 decision — narrower than every reminder
// category reminderService.js computes): overdue follow-ups, due-today follow-ups,
// repeated no-answer parents, and payment promises due. tomorrowFollowups/priorityTasks
// are deliberately NOT included — out of the approved scope.
function fmtDate(d) {
  return d ? String(d).slice(0, 10) : '';
}

function recordLabel(r) {
  return r.studentName || r.parentName || r.phone || 'سجل';
}

export function deriveNotifications(reminders) {
  const { overdueFollowups = [], todayFollowups = [], repeatedNoAnswer = [], paymentPromisesDue = [] } = reminders || {};

  const overdue = overdueFollowups.map((r) => ({
    id:     `notif-overdue-${r.id}`,
    type:   'system',
    title:  'متابعة متأخرة',
    body:   `${recordLabel(r)} — متابعة متأخرة منذ ${fmtDate(r.followupDate)}`,
    time:   fmtDate(r.followupDate),
    read:   false,
    urgent: true,
  }));

  const today = todayFollowups.map((r) => ({
    id:     `notif-today-${r.id}`,
    type:   'system',
    title:  'متابعة اليوم',
    body:   `${recordLabel(r)} — موعد متابعة اليوم`,
    time:   fmtDate(r.followupDate),
    read:   false,
    urgent: false,
  }));

  const noAnswer = repeatedNoAnswer.map((p) => ({
    id:     `notif-noanswer-${p.key}`,
    type:   'system',
    title:  'عدم رد متكرر',
    body:   `${p.parentName || p.phone || 'ولي أمر'} — لم يُجب ${p.count} مرات متتالية`,
    time:   '',
    read:   false,
    urgent: true,
  }));

  const promises = paymentPromisesDue.map((r) => ({
    id:     `notif-promise-${r.id}`,
    type:   'payment',
    title:  'وعد دفع مستحق اليوم',
    body:   `${recordLabel(r)} — وعد بالدفع مستحق اليوم`,
    time:   fmtDate(r.followupDate),
    read:   false,
    urgent: true,
  }));

  // متأخرة أولاً، ثم عدم الرد، ثم وعود الدفع، ثم متابعات اليوم — نفس ترتيب الإلحاح
  // المستخدَم بالفعل في ReminderCenter (crmParts.jsx)
  return [...overdue, ...noAnswer, ...promises, ...today];
}
