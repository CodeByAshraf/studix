// src/modules/communication/components/parts.jsx
// ─────────────────────────────────────────────────────────────────────────────
// مكوّنات عرض صغيرة قابلة لإعادة الاستخدام لمركز التواصل.
// ─────────────────────────────────────────────────────────────────────────────

import {
  COMM_TYPE_META, COMM_RESULT_META, COMM_REASON_META,
  PRIORITY_META, COMM_STATUS_META, fmtDateTime, fmtDate,
} from '../displayMeta';

// ── لوحة المؤشرات ─────────────────────────────────────────────────────────
export function CommKpiRow({ kpis }) {
  const cards = [
    { label: 'مكالمات اليوم', value: kpis.todayCalls, icon: '📞', color: '#3b82f6' },
    { label: 'واتساب اليوم', value: kpis.todayWhatsapp, icon: '💬', color: '#10b981' },
    { label: 'متابعات اليوم', value: kpis.todayFollowups, icon: '📅', color: '#06b6d4' },
    { label: 'متابعات متأخرة', value: kpis.overdueFollowups, icon: '⚠️', color: '#ef4444' },
    { label: 'لم يرد', value: kpis.noAnswerCount, icon: '📵', color: '#f59e0b' },
    { label: 'مهام مكتملة', value: kpis.completedTasks, icon: '✅', color: '#10b981' },
    { label: 'مهام مفتوحة', value: kpis.openTasks, icon: '📋', color: '#8b5cf6' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
      {cards.map((c) => (
        <div key={c.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 18 }}>{c.icon}</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>{c.label}</span>
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: c.color }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// ── بطاقة سجل تواصل في القائمة ────────────────────────────────────────────
export function CommRecordCard({ record, selected, onClick }) {
  const type = COMM_TYPE_META[record.type] || { label: record.type, icon: '•', color: '#888' };
  const result = COMM_RESULT_META[record.result];
  return (
    <div
      onClick={onClick}
      style={{
        padding: '11px 12px', borderRadius: 10,
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        background: selected ? 'rgba(99,102,241,.08)' : 'var(--surface2)',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{type.icon}</span>
            <span style={{ fontWeight: 700, fontSize: '0.84rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {record.studentName || record.parentName || record.phone || 'بدون اسم'}
            </span>
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text3)', marginTop: 3 }}>
            {record.number} · {fmtDateTime(record.createdAt)}
          </div>
        </div>
        {result && (
          <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: `${result.color}18`, color: result.color, whiteSpace: 'nowrap' }}>
            {result.label}
          </span>
        )}
      </div>
    </div>
  );
}

// ── عنصر مهمة ─────────────────────────────────────────────────────────────
export function TaskItem({ task, onComplete }) {
  const pr = PRIORITY_META[task.priority] || PRIORITY_META.normal;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 8, fontSize: '0.76rem' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
        <div style={{ fontSize: '0.66rem', color: 'var(--text3)' }}>
          {fmtDate(task.dueDate)}{task.dueTime ? ` · ${task.dueTime}` : ''} · {task.employee}
        </div>
      </div>
      <span style={{ fontSize: '0.58rem', fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: `${pr.color}18`, color: pr.color }}>{pr.label}</span>
      <button onClick={onComplete} title="إكمال" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, color: 'var(--green)' }}>✓</button>
    </div>
  );
}

// ── تفاصيل سجل + خط زمني ──────────────────────────────────────────────────
export function CommDetails({ record, timeline, onArchive }) {
  const type = COMM_TYPE_META[record.type] || {};
  const result = COMM_RESULT_META[record.result] || {};
  const reason = COMM_REASON_META[record.reason];
  const status = COMM_STATUS_META[record.status] || {};

  return (
    <div>
      {/* رأس */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: '1rem' }}>{type.icon} {record.studentName || record.parentName || 'سجل تواصل'}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{record.number} · {fmtDateTime(record.createdAt)}</div>
        </div>
        {record.status !== 'archived' && (
          <button onClick={onArchive} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', fontFamily: 'Cairo, sans-serif', fontSize: '0.72rem', cursor: 'pointer' }}>أرشفة</button>
        )}
      </div>

      {/* بيانات */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.78rem', marginBottom: 16 }}>
        <Row label="النوع" value={type.label} />
        <Row label="النتيجة" value={result.label} color={result.color} />
        {reason && <Row label="السبب" value={reason.label} />}
        <Row label="الموظف" value={record.employee} />
        <Row label="ولي الأمر" value={record.parentName || '—'} />
        <Row label="الطالب" value={record.studentName || '—'} />
        <Row label="الهاتف" value={record.phone || '—'} />
        <Row label="الحالة" value={status.label} color={status.color} />
        {record.followupDate && <Row label="متابعة قادمة" value={`${fmtDate(record.followupDate)}${record.followupTime ? ` · ${record.followupTime}` : ''}`} />}
      </div>

      {record.notes && (
        <div style={{ padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: '0.78rem', marginBottom: 16, lineHeight: 1.6 }}>{record.notes}</div>
      )}

      {/* الخط الزمني */}
      <div style={{ fontWeight: 800, fontSize: '0.85rem', marginBottom: 10 }}>الخط الزمني ({timeline.length})</div>
      <div style={{ position: 'relative', paddingRight: 16, maxHeight: 300, overflowY: 'auto' }}>
        <div style={{ position: 'absolute', right: 4, top: 4, bottom: 4, width: 2, background: 'var(--border)' }} />
        {timeline.map((t) => {
          const tt = COMM_TYPE_META[t.type] || {};
          const tr = COMM_RESULT_META[t.result] || {};
          return (
            <div key={t.id} style={{ position: 'relative', marginBottom: 12, fontSize: '0.76rem' }}>
              <div style={{ position: 'absolute', right: -15, top: 2, width: 11, height: 11, borderRadius: '50%', background: `${tt.color || '#888'}22`, border: `2px solid ${tt.color || '#888'}` }} />
              <div style={{ fontWeight: 600 }}>{tt.icon} {tt.label} {tr.label ? `· ${tr.label}` : ''}</div>
              <div style={{ color: 'var(--text3)', fontSize: '0.66rem' }}>{fmtDateTime(t.createdAt)} · {t.employee}</div>
              {t.notes && <div style={{ color: 'var(--text2)', marginTop: 2 }}>{t.notes}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--text3)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: color || 'var(--text)' }}>{value || '—'}</span>
    </div>
  );
}
