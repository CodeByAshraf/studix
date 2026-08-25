// src/modules/communication/components/crmParts.jsx
// ─────────────────────────────────────────────────────────────────────────────
// مكوّنات CRM: مركز التذكيرات + لوحة الإنبوكس + ملف ولي الأمر.
// كل الحسابات تأتي جاهزة من الخدمات (لا حسابات هنا).
// ─────────────────────────────────────────────────────────────────────────────

import {
  COMM_TYPE_META, COMM_RESULT_META, COMM_REASON_META,
  PREFERRED_METHOD_META, fmtDateTime, fmtDate,
} from '../displayMeta';

// ═══════════════════════════════════════════════════════════════════════════
// لوحة الإنبوكس (علوية، قابلة للنقر)
// ═══════════════════════════════════════════════════════════════════════════
export function InboxDashboard({ counts, activeFilter, onFilter }) {
  const cells = [
    { id: 'needsAction', label: 'يحتاج إجراء', value: counts.needsAction, icon: '🔴', color: '#ef4444' },
    { id: 'dueToday', label: 'مستحق اليوم', value: counts.dueToday, icon: '🟡', color: '#f59e0b' },
    { id: 'completedToday', label: 'اكتمل اليوم', value: counts.completedToday, icon: '🟢', color: '#10b981' },
    { id: 'callsToday', label: 'مكالمات اليوم', value: counts.callsToday, icon: '📞', color: '#3b82f6' },
    { id: 'whatsappToday', label: 'واتساب اليوم', value: counts.whatsappToday, icon: '📲', color: '#10b981' },
    { id: 'overdue', label: 'متأخر', value: counts.overdue, icon: '⚠️', color: '#ef4444' },
    { id: 'parentsWaiting', label: 'أولياء ينتظرون', value: counts.parentsWaiting, icon: '👪', color: '#8b5cf6' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
      {cells.map((c) => {
        const active = activeFilter === c.id;
        return (
          <button
            key={c.id}
            onClick={() => onFilter(active ? null : c.id)}
            style={{
              textAlign: 'right', cursor: 'pointer',
              background: active ? `${c.color}18` : 'var(--surface)',
              border: `1px solid ${active ? c.color : 'var(--border)'}`,
              borderRadius: 12, padding: '14px 16px', fontFamily: 'Cairo, sans-serif',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 16 }}>{c.icon}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>{c.label}</span>
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: c.color }}>{c.value}</div>
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// مركز التذكيرات (يسار)
// ═══════════════════════════════════════════════════════════════════════════
export function ReminderCenter({ reminders, onSelectParent, onCompleteTask }) {
  const groups = [
    { key: 'overdueFollowups', title: '⚠️ متأخرة', color: '#ef4444', items: reminders.overdueFollowups, kind: 'record' },
    { key: 'todayFollowups', title: '📅 متابعات اليوم', color: '#f59e0b', items: reminders.todayFollowups, kind: 'record' },
    { key: 'paymentPromisesDue', title: '💰 وعود دفع اليوم', color: '#8b5cf6', items: reminders.paymentPromisesDue, kind: 'record' },
    { key: 'tomorrowFollowups', title: '🔜 متابعات الغد', color: '#06b6d4', items: reminders.tomorrowFollowups, kind: 'record' },
    { key: 'repeatedNoAnswer', title: '📵 عدم رد متكرر', color: '#ef4444', items: reminders.repeatedNoAnswer, kind: 'parent' },
    { key: 'priorityTasks', title: '🔥 مهام هامة', color: '#f59e0b', items: reminders.priorityTasks, kind: 'task' },
  ];

  const total = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: '0.9rem', marginBottom: 12 }}>🔔 مركز التذكيرات</div>
      {total === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: '0.8rem', padding: 20 }}>لا توجد تذكيرات حالياً 🎉</div>
      ) : groups.map((g) => g.items.length > 0 && (
        <div key={g.key} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: g.color, marginBottom: 6 }}>{g.title} ({g.items.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {g.items.slice(0, 5).map((it, i) => (
              <ReminderItem key={it.id || it.key || i} item={it} kind={g.kind} onClick={() => {
                const key = g.kind === 'parent' ? it.key : (it.phone || it.parentName);
                if (key && onSelectParent) onSelectParent(key);
              }}
                onComplete={g.kind === 'task' && onCompleteTask ? () => onCompleteTask(it) : null}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReminderItem({ item, kind, onClick, onComplete }) {
  let title, sub;
  if (kind === 'parent') {
    title = item.parentName || item.phone;
    sub = `عدم رد ${item.count} مرات`;
  } else if (kind === 'task') {
    title = item.title;
    sub = `${fmtDate(item.dueDate)} · ${item.employee}`;
  } else {
    title = item.studentName || item.parentName || item.phone || 'سجل';
    sub = `${fmtDate(item.followupDate)}`;
  }
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 8, cursor: onClick ? 'pointer' : 'default', fontSize: '0.75rem' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ fontSize: '0.65rem', color: 'var(--text3)' }}>{sub}</div>
      </div>
      {onComplete && (
        <button
          onClick={(e) => { e.stopPropagation(); onComplete(); }}
          title="إكمال"
          style={{ flexShrink: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, color: 'var(--green)' }}
        >✓</button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ملف ولي الأمر (يمين)
// ═══════════════════════════════════════════════════════════════════════════
export function ParentProfile({ parent, stats, nextAction, history, onEdit, onCompleteRecord }) {
  if (!parent) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: '0.82rem', padding: 40 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>👤</div>
        اختر ولي أمر لعرض ملفه
      </div>
    );
  }

  const method = parent.preferredMethod ? PREFERRED_METHOD_META[parent.preferredMethod] : null;

  return (
    <div>
      {/* رأس */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: '1rem' }}>👤 {parent.parentName || 'ولي أمر'}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text3)', direction: 'ltr', textAlign: 'right' }}>{parent.phone}</div>
        </div>
        <button onClick={onEdit} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', fontFamily: 'Cairo, sans-serif', fontSize: '0.72rem', cursor: 'pointer' }}>تعديل</button>
      </div>

      {/* الإجراء التالي */}
      {nextAction && (
        <div style={{ padding: '10px 12px', background: 'rgba(99,102,241,.1)', border: '1px solid var(--accent)', borderRadius: 10, marginBottom: 14 }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text3)', marginBottom: 2 }}>⭐ الإجراء التالي</div>
          <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>
            {COMM_REASON_META[nextAction.reason]?.label || 'متابعة'} · {fmtDate(nextAction.followupDate)}
            {nextAction.followupTime ? ` · ${nextAction.followupTime}` : ''}
          </div>
        </div>
      )}

      {/* بيانات إضافية */}
      {(parent.altPhone || method || parent.preferredTime || parent.studentNames.length > 0) && (
        <div style={{ fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
          {parent.altPhone && <PRow label="هاتف بديل" value={parent.altPhone} ltr />}
          {method && <PRow label="التواصل المفضّل" value={`${method.icon} ${method.label}`} />}
          {parent.preferredTime && <PRow label="الوقت المفضّل" value={parent.preferredTime} />}
          {parent.studentNames.length > 0 && <PRow label="الطلاب" value={parent.studentNames.join('، ')} />}
        </div>
      )}

      {/* إحصائيات محاولات الاتصال */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 12 }}>
        <MiniStat label="إجمالي" value={stats.total} color="var(--accent)" />
        <MiniStat label="مكالمات" value={stats.calls} />
        <MiniStat label="واتساب" value={stats.whatsapp} />
        <MiniStat label="تم الرد" value={stats.answered} color="var(--green)" />
        <MiniStat label="لم يرد" value={stats.noAnswer} color="var(--red)" />
        <MiniStat label="مشغول" value={stats.busy} />
        <MiniStat label="مغلق" value={stats.phoneOff} />
        <MiniStat label="رقم خطأ" value={stats.wrongNumber} />
        <MiniStat label="زيارات" value={stats.visits} />
      </div>

      {/* آخر تواصل */}
      <div style={{ fontSize: '0.7rem', color: 'var(--text3)', marginBottom: 14, lineHeight: 1.8 }}>
        {stats.lastComm && <div>آخر تواصل: {fmtDateTime(stats.lastComm.createdAt)}</div>}
        {stats.lastSuccess && <div>آخر تواصل ناجح: {fmtDate(stats.lastSuccess.createdAt)}</div>}
        {stats.lastNoAnswer && <div>آخر عدم رد: {fmtDate(stats.lastNoAnswer.createdAt)}</div>}
      </div>

      {/* سجل التواصل الكامل */}
      <div style={{ fontWeight: 800, fontSize: '0.82rem', marginBottom: 8 }}>سجل التواصل ({history.length})</div>
      <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {history.map((r) => {
          const tt = COMM_TYPE_META[r.type] || {};
          const tr = COMM_RESULT_META[r.result] || {};
          const isOpen = r.status !== 'completed' && r.status !== 'archived' && r.status !== 'cancelled';
          return (
            <div key={r.id} style={{ padding: '8px 10px', background: 'var(--surface2)', borderRadius: 8, fontSize: '0.74rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                <span style={{ fontWeight: 600 }}>{tt.icon} {tt.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {tr.label && <span style={{ color: tr.color, fontSize: '0.66rem', fontWeight: 700 }}>{tr.label}</span>}
                  {isOpen && onCompleteRecord && (
                    <button
                      onClick={() => onCompleteRecord(r)}
                      title="إكمال"
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--green)' }}
                    >✓</button>
                  )}
                </div>
              </div>
              <div style={{ fontSize: '0.64rem', color: 'var(--text3)', marginTop: 2 }}>
                {fmtDateTime(r.createdAt)} · {r.employee}
                {r.reason ? ` · ${COMM_REASON_META[r.reason]?.label || ''}` : ''}
              </div>
              {r.notes && <div style={{ color: 'var(--text2)', marginTop: 2 }}>{r.notes}</div>}
              {r.followupDate && <div style={{ color: 'var(--accent)', fontSize: '0.64rem', marginTop: 2 }}>متابعة: {fmtDate(r.followupDate)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PRow({ label, value, ltr }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--text3)' }}>{label}</span>
      <span style={{ fontWeight: 600, direction: ltr ? 'ltr' : 'rtl' }}>{value}</span>
    </div>
  );
}

function MiniStat({ label, value, color = 'var(--text)' }) {
  return (
    <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '6px 8px', textAlign: 'center' }}>
      <div style={{ fontSize: '0.6rem', color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontSize: '0.9rem', fontWeight: 800, color }}>{value}</div>
    </div>
  );
}
