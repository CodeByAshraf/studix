// src/modules/exams/ExamTimer.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Exams Phase 3D — administrative Start action + countdown. Studix exams are
// physical/offline exams: this widget only lets the secretary record when the physical
// exam started and see how much time remains on screen. It never submits, locks, or
// grades anything — grading (GradeEntry.jsx) is completely unaffected and untouched.
//
// Server is authoritative for actual_started_at (set once, server-side, in
// backend/src/routes/examStart.js — the client can never supply or override it).
// remainingSeconds is computed HERE, client-side, from that server-set anchor + the
// browser's own clock — reusing the exact same pure calculation
// (examService.js's computeExamTimerState) the backend uses internally. This is
// legitimate, not a shortcut: Studix's backend and frontend run on the SAME Windows
// machine (see Phase 3A's architecture audit), so there is no independently trusted
// external clock — "server authoritative" here means the START time can't be forged by
// the client, not that every tick must round-trip to the network. Deliberately NOT
// implementing the license module's high-water-mark clock-rollback deterrent
// (backend/src/lib/license.js) — that exists for a real activation/DRM stake; this is a
// non-enforcing administrative display, so that complexity is disproportionate here.
//
// Ticking/re-sync pattern reused from src/modules/support-access/SupportAccessPage.jsx
// (already proven in this codebase): a local 1-second tick for a smooth display, plus a
// periodic server re-sync (~20s) and re-sync on window focus / tab visibility — so a
// stale local tick (browser refresh, computer sleep/wake) self-corrects at the next sync
// instead of drifting indefinitely, without depending on the local tick alone.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/app.store';
import { useToast } from '../../components/Toast';
import Button from '../../components/ui/Button';
import { computeExamTimerState, formatRemainingSeconds } from '../../services/examService';
import { pgStartExam, pgGetExam } from '../../services/api';

const RESYNC_MS = 20_000; // matches SupportAccessPage.jsx's STATUS_POLL_MS order of magnitude

const PHASE_META = {
  not_scheduled:   { label: 'لا يوجد جدولة',   color: 'var(--text3)', bg: 'var(--surface2)',      border: 'var(--border)' },
  ready_to_start:  { label: 'جاهز للبدء',       color: '#3b82f6',      bg: 'rgba(59,130,246,.1)',  border: 'rgba(59,130,246,.25)' },
  in_progress:     { label: 'جارٍ الآن',         color: '#10b981',      bg: 'rgba(16,185,129,.1)',  border: 'rgba(16,185,129,.25)' },
  time_finished:   { label: 'انتهى الوقت',       color: '#ef4444',      bg: 'rgba(239,68,68,.1)',   border: 'rgba(239,68,68,.25)' },
};

export default function ExamTimer({ exam }) {
  const setExams = useAppStore((s) => s.setExams);
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(Date.now());

  // محلي فقط للعرض السلس بين كل مزامنة — الحساب الفعلي (remainingSeconds/phase) دائماً
  // من computeExamTimerState باستخدام exam.actualStartedAt القادم من الخادم.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const examRef = useRef(exam);
  examRef.current = exam;

  // إعادة مزامنة دورية + عند التركيز/عودة ظهور التبويب — يبدأ فقط بعد أن يبدأ الامتحان
  // فعلياً (لا داعي لمزامنة امتحان لم يُبدَأ بعد؛ أي تغيير بياناته الأخرى يأتي عبر
  // المزامنة العامة الموجودة أصلاً للمتجر). يعيد بناء المؤقّت بالكامل من بيانات الخادم في
  // كل مرة — هذا هو ما يُصحّح تلقائياً بعد تحديث الصفحة أو نوم/استيقاظ الجهاز.
  useEffect(() => {
    if (!exam.actualStartedAt) return undefined;
    let cancelled = false;

    const resync = async () => {
      try {
        const fresh = await pgGetExam(examRef.current.id);
        if (cancelled) return;
        setExams((prev) => prev.map((e) => (e.id === fresh.id ? { ...e, ...fresh } : e)));
      } catch {
        // best-effort: يبقى آخر حالة معروفة معروضة، وتُصحَّح تلقائياً في أول مزامنة ناجحة لاحقة
      }
    };

    const intervalId = setInterval(resync, RESYNC_MS);
    window.addEventListener('focus', resync);
    const onVisibility = () => { if (document.visibilityState === 'visible') resync(); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [exam.id, exam.actualStartedAt, setExams]);

  const handleStart = async () => {
    setStarting(true);
    try {
      const result = await pgStartExam(exam.id);
      setExams((prev) => prev.map((e) => (e.id === exam.id
        ? { ...e, actualStartedAt: result.actualStartedAt, durationMinutes: result.durationMinutes }
        : e)));
    } catch (err) {
      toast.error(err.message || 'تعذّر بدء الامتحان');
    } finally {
      setStarting(false);
    }
  };

  const { phase, remainingSeconds } = computeExamTimerState(exam, now);
  const meta = PHASE_META[phase];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99,
        fontSize: '0.68rem', fontWeight: 700, background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`,
      }}>
        {meta.label}
        {(phase === 'in_progress' || phase === 'time_finished') && (
          <span style={{ fontFamily: 'Cairo,sans-serif' }}>· {formatRemainingSeconds(remainingSeconds)}</span>
        )}
      </span>
      {phase === 'ready_to_start' && (
        <Button variant="secondary" size="sm" loading={starting} onClick={handleStart}>▶ بدء الامتحان</Button>
      )}
    </div>
  );
}
