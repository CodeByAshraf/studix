// src/modules/recitation/RecitationPage.jsx
// Recitation Assessment — Phase 3 teacher UI. A separate screen (not part of Attendance
// marking): pick a recently-completed attendance session, score its present/late
// students, save partial progress freely, then explicitly lock ("Save & Complete").
// The backend is the sole source of truth throughout — nothing here fakes a locked
// state locally; every lock/unlock reflects a real server response.
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { SectionBoundary } from '../../components/ErrorBoundary';
import { useToast } from '../../components/Toast';
import { Button, Badge, ConfirmModal, KpiCard, KpiGrid, Tabs } from '../../components/ui';
import { useAsyncData } from '../../hooks/useAsyncData';
import {
  pgListRecitationSessions, pgGetRecitationSession, pgSaveRecitations, pgCompleteRecitationSession,
} from '../../services/api';
import { scorePercent, scoreColor } from '../../services/examService';
import {
  openRecitationSessionReport, openRecitationNotEvaluatedReport, openRecitationSummaryReport,
} from './buildRecitationReport';
import { getRecitationContactPhone, buildRecitationMessage, openWhatsapp } from './recitationWhatsappService';

const RECITATION_STATUS_META = {
  not_started: { label: 'لم يبدأ', color: 'gray' },
  in_progress: { label: 'قيد التنفيذ', color: 'orange' },
  completed:   { label: 'مكتمل ومقفل', color: 'green' },
};

const ATTENDANCE_STATUS_LABEL = { present: 'حاضر', late: 'متأخر' };

export default function RecitationPage() {
  // null = session picker; {groupId, date} = a session is open for scoring
  const [selected, setSelected] = useState(null);

  return (
    <SectionBoundary label="RecitationPage">
      {selected
        ? <SessionDetail groupId={selected.groupId} date={selected.date} onBack={() => setSelected(null)} />
        : <SessionPicker onSelect={setSelected} />}
    </SectionBoundary>
  );
}

// ── Step 1-2: recent completed attendance sessions ──────────────────────────
function SessionPicker({ onSelect }) {
  const toast = useToast();
  const { data: sessions = [], loading, error } = useAsyncData(
    () => pgListRecitationSessions({ limit: 30 }), [], []);

  if (error) toast.error(error.message || 'فشل تحميل الجلسات');

  return (
    <div style={{ padding: '20px 24px' }}>
      <h1 style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: 4 }}>التسميع</h1>
      <p style={{ fontSize: '0.8rem', color: 'var(--text3)', marginBottom: 18 }}>
        اختر حصة حضور مكتملة لبدء أو متابعة التسميع.
      </p>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text3)' }}>جارِ التحميل...</div>
      ) : sessions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text3)' }}>
          لا توجد حصص حضور مكتملة بعد.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sessions.map((s) => {
            const meta = RECITATION_STATUS_META[s.recitationStatus] || RECITATION_STATUS_META.not_started;
            return (
              <button
                key={s.id}
                onClick={() => onSelect({ groupId: s.groupId, date: s.date })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14, textAlign: 'right',
                  padding: '14px 18px', borderRadius: 12, border: '1px solid var(--border)',
                  background: 'var(--surface)', cursor: 'pointer', fontFamily: 'Cairo,sans-serif',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{s.groupName || s.groupId}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text3)', marginTop: 2 }}>
                    {s.date}{s.sessionTime ? ` · الحصة ${s.sessionTime}` : ''}
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text2)', textAlign: 'center', minWidth: 90 }}>
                  تم التسميع: <span style={{ fontWeight: 700 }}>{s.evaluatedCount} / {s.attendeeCount}</span>
                </div>
                <Badge label={meta.label} color={meta.color} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Step 3-13: one session's scoring workflow ────────────────────────────────
function SessionDetail({ groupId, date, onBack }) {
  const toast = useToast();
  const { data, loading, error } = useAsyncData(
    () => pgGetRecitationSession(groupId, date), [groupId, date], null);

  if (error) toast.error(error.message || 'فشل تحميل الجلسة');

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text3)' }}>جارِ التحميل...</div>;
  }
  if (!data) return null;

  return <SessionDetailForm groupId={groupId} date={date} initial={data} onBack={onBack} />;
}

function SessionDetailForm({ groupId, date, initial, onBack }) {
  const toast = useToast();
  const centerProfile = useAppStore((s) => s.centerProfile);
  const [session, setSession] = useState(initial.session);
  const [group, setGroup] = useState(initial.group); // already returned by the API, just unused before printing needed it
  const [roster, setRoster] = useState(initial.roster); // authoritative server view (post-save)
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | evaluated | not_evaluated

  const locked = session.recitationStatus === 'completed';
  const maxScoreEstablished = session.maxScore !== null && session.maxScore !== undefined;

  // Local draft: a sensible default only ("UI convenience") — never sent until Save.
  const [maxScoreInput, setMaxScoreInput] = useState(() => (maxScoreEstablished ? String(session.maxScore) : '10'));
  const effectiveMaxScore = maxScoreEstablished ? session.maxScore : Number(maxScoreInput);

  // Local draft scores, seeded from whatever the server already had.
  const [localScores, setLocalScores] = useState(() => {
    const map = {};
    initial.roster.forEach((r) => { map[r.studentId] = { score: r.score, note: r.note || '' }; });
    return map;
  });

  const updateScore = useCallback((studentId, patch) => {
    setLocalScores((prev) => ({ ...prev, [studentId]: { ...prev[studentId], ...patch } }));
  }, []);

  const filtered = useMemo(() => {
    let list = roster;
    if (filter === 'evaluated') list = list.filter((r) => localScores[r.studentId]?.score !== null && localScores[r.studentId]?.score !== undefined);
    if (filter === 'not_evaluated') list = list.filter((r) => localScores[r.studentId]?.score === null || localScores[r.studentId]?.score === undefined);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => (r.studentName || '').toLowerCase().includes(q));
    return list;
  }, [roster, filter, search, localScores]);

  // Live progress — reflects the current draft, not just the last successful save.
  const evaluatedCount = useMemo(
    () => roster.filter((r) => localScores[r.studentId]?.score !== null && localScores[r.studentId]?.score !== undefined).length,
    [roster, localScores]
  );

  const fillAll = () => {
    if (!Number.isFinite(effectiveMaxScore) || effectiveMaxScore <= 0) return;
    setLocalScores((prev) => {
      const next = { ...prev };
      roster.forEach((r) => { next[r.studentId] = { ...next[r.studentId], score: effectiveMaxScore }; });
      return next;
    });
  };

  // Builds the records payload from every locally-entered (non-null) score.
  function buildRecords() {
    return roster
      .map((r) => ({ studentId: r.studentId, ...localScores[r.studentId] }))
      .filter((r) => r.score !== null && r.score !== undefined)
      .map((r) => ({ studentId: r.studentId, score: r.score, note: r.note || undefined }));
  }

  // Save-only. Returns the saved session/records on success so callers (Save, and
  // Save & Complete) can reconcile the same way.
  const doSave = async () => {
    const records = buildRecords();
    const max = Number(maxScoreInput);
    const saved = await pgSaveRecitations(groupId, date, max, records);
    setSession(saved.session);
    setRoster((prev) => prev.map((r) => {
      const savedRecord = saved.records.find((sr) => sr.studentId === r.studentId);
      return savedRecord ? { ...r, score: savedRecord.score, maxScore: savedRecord.maxScore, note: savedRecord.note } : r;
    }));
    setLocalScores((prev) => {
      const next = { ...prev };
      saved.records.forEach((sr) => { next[sr.studentId] = { score: sr.score, note: sr.note || '' }; });
      return next;
    });
    return saved;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await doSave();
      toast.success(`تم الحفظ (${saved.records.length} طالب) ✓`);
    } catch (err) {
      toast.error(err.message || 'فشل الحفظ — حاول مرة أخرى');
      // Reconcile with the server in case the failure was a lock we didn't know about
      // yet (e.g. someone else completed this session in the meantime).
      pgGetRecitationSession(groupId, date).then((fresh) => { setSession(fresh.session); setRoster(fresh.roster); }).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmComplete = async () => {
    setCompleting(true);
    try {
      const hasUnsavedWork = evaluatedCount > 0;
      if (hasUnsavedWork) await doSave();
      const updatedSession = await pgCompleteRecitationSession(groupId, date);
      setSession(updatedSession);
      setConfirmOpen(false);
      toast.success('تم اعتماد التسميع وقفله ✓');
    } catch (err) {
      toast.error(err.message || 'فشل اعتماد التسميع — حاول مرة أخرى');
      pgGetRecitationSession(groupId, date).then((fresh) => { setSession(fresh.session); setRoster(fresh.roster); }).catch(() => {});
    } finally {
      setCompleting(false);
    }
  };

  // Recitation WhatsApp — one explicit click per parent (no window.open loop, no "send to
  // all"), same constraint already documented/solved in AbsenceFollowup.jsx's
  // handleWhatsapp: a loop of window.open() calls not each tied to a genuine user gesture
  // gets blocked by the browser. Reads only the server-reconciled `row` (roster state,
  // updated exclusively from API responses) — never `localScores` — and never writes
  // anything (no pgSaveRecitations call here).
  const handleWhatsapp = (row) => {
    const phone = getRecitationContactPhone(row);
    const pct = row.score !== null && row.score !== undefined && row.maxScore
      ? scorePercent(row.score, row.maxScore)
      : null;
    const message = buildRecitationMessage({
      studentName: row.studentName,
      groupName: group?.name,
      date: session.date,
      score: row.score,
      maxScore: row.maxScore,
      percentage: pct,
      note: row.note,
    });
    const res = openWhatsapp(phone, message);
    if (!res.ok) toast.error(res.error);
  };

  return (
    <div style={{ padding: '20px 24px' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: 'Cairo,sans-serif', fontSize: '0.8rem', marginBottom: 10, padding: 0 }}>
        ← الجلسات
      </button>

      {/* Session header */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem' }}>{group?.name || session.groupId}{date ? ` — ${date}` : ''}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text3)', marginTop: 2 }}>
            {session.sessionTime ? `الحصة ${session.sessionTime} · ` : ''}{roster.length} طالب حاضر/متأخر
          </div>
        </div>
        <Badge {...(RECITATION_STATUS_META[session.recitationStatus] || RECITATION_STATUS_META.not_started)} />
      </div>

      {locked && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(16,185,129,.08)', color: '#10b981', fontSize: '0.8rem', fontWeight: 600, marginBottom: 14 }}>
          🔒 التسميع مكتمل ومقفول — للعرض فقط.
        </div>
      )}

      <KpiGrid>
        <KpiCard icon="👥" label="عدد الحاضرين" value={roster.length} />
        <KpiCard icon="✅" label="تم التسميع" value={`${evaluatedCount} / ${roster.length}`} color="#10b981" />
        <KpiCard icon="🎯" label="الدرجة من" value={maxScoreEstablished ? session.maxScore : '—'} />
      </KpiGrid>

      {/* Max score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
        <span style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>الدرجة من:</span>
        {maxScoreEstablished ? (
          <span style={{ fontWeight: 800, fontSize: '0.95rem', fontFamily: 'Cairo,sans-serif' }}>{session.maxScore}</span>
        ) : (
          <input
            type="number" min="1" value={maxScoreInput}
            disabled={locked}
            onChange={(e) => setMaxScoreInput(e.target.value)}
            style={{ width: 72, padding: '6px 10px', textAlign: 'center', background: 'var(--surface2)', border: '1.5px solid var(--border)', borderRadius: 9, color: 'var(--text)', fontFamily: 'Cairo,sans-serif', fontWeight: 700 }}
          />
        )}
        {!locked && (
          <Button variant="secondary" size="sm" onClick={fillAll}>تعبئة الكل بالدرجة الكاملة</Button>
        )}
      </div>

      {/* Filters + search */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
        <Tabs
          tabs={[
            { id: 'all', label: 'الكل' },
            { id: 'not_evaluated', label: 'لم يُسمَّع' },
            { id: 'evaluated', label: 'تم التسميع' },
          ]}
          defaultTab="all"
          onChange={setFilter}
        />
        <input
          value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث عن طالب..."
          style={{ flex: 1, minWidth: 180, padding: '8px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text)', fontFamily: 'Cairo,sans-serif', fontSize: '0.82rem', outline: 'none', direction: 'rtl' }}
        />
      </div>

      {/* Roster */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', margin: '12px 0 16px' }}>
        {filtered.map((r) => (
          <RecitationRow
            key={r.studentId}
            row={r}
            draft={localScores[r.studentId]}
            maxScore={effectiveMaxScore}
            locked={locked}
            onChange={(patch) => updateScore(r.studentId, patch)}
            onWhatsapp={handleWhatsapp}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text3)', fontSize: '0.82rem' }}>لا يوجد طلاب مطابقون</div>
        )}
      </div>

      {/* Actions — print stays available in both draft and locked states; it always reads
          the server-reconciled `session`/`group`/`roster` above, never `localScores`, so a
          printed record can never show an unsaved score. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" onClick={() => openRecitationSessionReport({ session, group, roster, profile: centerProfile })}>🖨 طباعة التسميع</Button>
          <Button variant="secondary" size="sm" onClick={() => openRecitationNotEvaluatedReport({ session, group, roster, profile: centerProfile })}>🖨 طباعة غير المقيّمين</Button>
          <Button variant="secondary" size="sm" onClick={() => openRecitationSummaryReport({ session, group, roster, profile: centerProfile })}>🖨 طباعة الملخص</Button>
        </div>
        {!locked && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" loading={saving} onClick={handleSave}>💾 حفظ</Button>
            <Button variant="primary" onClick={() => setConfirmOpen(true)}>✔ حفظ واعتماد نهائي</Button>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirmComplete}
        loading={completing}
        title="اعتماد التسميع نهائياً"
        confirmLabel="اعتماد وقفل"
        message={`سيُصبح تسميع هذه الجلسة دائماً وللقراءة فقط بعد الاعتماد — لن يمكن تعديل الدرجات أو الملاحظات بعده. التقييم الجزئي مسموح (${evaluatedCount} / ${roster.length} تم تسميعهم الآن).`}
      />
    </div>
  );
}

function RecitationRow({ row, draft, maxScore, locked, onChange, onWhatsapp }) {
  const score = draft?.score ?? null;
  const note = draft?.note ?? '';
  const pct = score !== null && Number.isFinite(maxScore) && maxScore > 0 ? scorePercent(score, maxScore) : null;

  // Recitation WhatsApp eligibility: locked session + an actual saved (server-side) score
  // for this student + a usable contact phone — reads `row` (server-reconciled), never the
  // local `score`/`draft` above (those are draft-entry state, irrelevant once locked).
  const whatsappEligible = locked && row.score !== null && row.score !== undefined;
  const contactPhone = whatsappEligible ? getRecitationContactPhone(row) : '';
  const hasPhone = !!contactPhone;

  const handleScoreChange = (e) => {
    const raw = e.target.value;
    if (raw === '') { onChange({ score: null }); return; }
    const bound = Number.isFinite(maxScore) && maxScore > 0 ? maxScore : Number(raw);
    const n = Math.min(Math.max(0, Number(raw)), bound);
    onChange({ score: n });
  };

  return (
    <div data-testid={`recitation-row-${row.studentId}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.86rem' }}>{row.studentName}</div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text3)' }}>{ATTENDANCE_STATUS_LABEL[row.attendanceStatus] || row.attendanceStatus}</div>
      </div>

      <input
        type="number" min="0" max={maxScore || undefined}
        value={score === null ? '' : score}
        onChange={handleScoreChange}
        disabled={locked}
        placeholder="—"
        style={{ width: 64, padding: '6px 8px', textAlign: 'center', background: 'var(--surface2)', border: '1.5px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontFamily: 'Cairo,sans-serif', fontWeight: 700 }}
      />

      <div style={{ width: 46, textAlign: 'center', fontSize: '0.78rem', fontWeight: 700, color: pct !== null ? scoreColor(pct) : 'var(--text3)' }}>
        {pct !== null ? `${pct}%` : '—'}
      </div>

      <input
        value={note} onChange={(e) => onChange({ note: e.target.value })}
        disabled={locked}
        placeholder="ملاحظة (اختياري)"
        style={{ flex: 1, minWidth: 100, padding: '6px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontFamily: 'Cairo,sans-serif', fontSize: '0.76rem', direction: 'rtl' }}
      />

      <span style={{ fontSize: '0.68rem', color: score !== null ? '#10b981' : 'var(--text3)', minWidth: 60, textAlign: 'center' }}>
        {score !== null ? 'تم التسميع' : 'لم يُسمَّع'}
      </span>

      {whatsappEligible && (
        <button
          onClick={() => onWhatsapp(row)}
          disabled={!hasPhone}
          title={hasPhone ? '' : 'لا يوجد رقم هاتف لولي الأمر'}
          style={{
            padding: '4px 12px', borderRadius: 7, fontSize: '0.72rem', fontWeight: 700, fontFamily: 'Cairo,sans-serif', transition: 'all .12s',
            cursor: hasPhone ? 'pointer' : 'not-allowed',
            opacity: hasPhone ? 1 : 0.5,
            border: '1px solid rgba(37,211,102,.35)',
            background: hasPhone ? '#25D366' : 'var(--surface2)',
            color: hasPhone ? '#fff' : 'var(--text3)',
          }}
        >
          {hasPhone ? '📲 واتساب' : '📲 لا يوجد رقم ولي أمر'}
        </button>
      )}
    </div>
  );
}
