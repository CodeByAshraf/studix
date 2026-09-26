// src/modules/settings/DatabaseBackupSection.jsx
// P1-1 — read-only view of the routine database backup (admin only). The backup itself runs
// on the server as a Windows Scheduled Task (backend/src/db/routineBackup.js), independent of
// this page; this section only reports what GET /api/backup-status says: whether the daily
// schedule is registered, the last run and last successful (verified) backup, and how many
// verified backups are kept. It never starts a backup or a restore.
import { useCallback, useEffect, useState } from 'react';
import { pgGetBackupStatus } from '../../services/api';
import { backupWarnings } from './backupStatusWarnings';

const RUN_STATUS_LABEL = {
  success: 'نجح ✓',
  warning: 'نجح مع تحذير',
  failed:  'فشل',
  skipped: 'تم التخطّي',
};

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.8 }}>
      <div style={{ minWidth: 150, color: 'var(--text3)', fontWeight: 700 }}>{label}</div>
      <div style={{ color: 'var(--text)', wordBreak: 'break-all' }}>{children}</div>
    </div>
  );
}

export default function DatabaseBackupSection() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await pgGetBackupStatus());
    } catch (err) {
      setStatus(null);
      setError(err.message || 'تعذّر قراءة حالة النسخ الاحتياطي.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const warnings = status ? backupWarnings(status) : [];

  return (
    <div data-testid="database-backup-status" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontWeight: 700, color: 'var(--text)' }}>🗄 النسخ الاحتياطي التلقائي لقاعدة البيانات</div>
      <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, margin: 0 }}>
        نسخة كاملة لقاعدة البيانات تُؤخذ تلقائياً كل يوم على هذا الجهاز (حتى بدون فتح البرنامج)،
        ويُتحقَّق من صلاحيتها قبل حفظها. هذه هي النسخة التي تُستخدم لاستعادة النظام.
      </p>

      {loading && <div style={{ fontSize: 13, color: 'var(--text3)' }}>جارِ قراءة حالة النسخ الاحتياطي...</div>}

      {!loading && error && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--red)' }}>
          تعذّر قراءة حالة النسخ الاحتياطي: {error}
        </div>
      )}

      {!loading && status && (
        <>
          {warnings.length > 0 && (
            <div role="alert" style={{ padding: '10px 14px', borderRadius: 9, border: '1px solid var(--red)', background: 'rgba(239,68,68,.06)', color: 'var(--red)', fontSize: 13, lineHeight: 1.8 }}>
              {warnings.map((w) => <div key={w}>⚠ {w}</div>)}
            </div>
          )}
          <Row label="الجدولة">
            يومياً الساعة {status.schedule?.dailyAt} (أو عند أول تشغيل للجهاز بعدها){' '}
            {status.schedule?.registered === true ? '— مسجَّلة ✓' : status.schedule?.registered === false ? '— غير مسجَّلة' : ''}
          </Row>
          <Row label="آخر نسخة ناجحة">
            {status.lastSuccess
              ? `${formatDateTime(status.lastSuccess.finishedAt)} — ${status.lastSuccess.backup?.fileName ?? ''} (${formatSize(status.lastSuccess.backup?.sizeBytes)}، مُتحقَّق منها)`
              : 'لا يوجد'}
          </Row>
          <Row label="آخر محاولة">
            {status.lastRun
              ? `${formatDateTime(status.lastRun.finishedAt)} — ${RUN_STATUS_LABEL[status.lastRun.status] ?? status.lastRun.status}`
              : 'لم تُشغَّل بعد'}
          </Row>
          <Row label="النسخ المحفوظة">
            {status.count} نسخة ({formatSize(status.totalSizeBytes)}) — يُحتفَظ بكل نسخ آخر {status.retention?.days} يوماً
            وبآخر {status.retention?.minKeep} نسخ دائماً
          </Row>
          <Row label="مكان الحفظ">{status.backupDir}</Row>
          <p style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.7, margin: 0 }}>
            النسخ محفوظة على هذا الجهاز فقط — انسخها دورياً إلى قرص خارجي أو جهاز آخر لحمايتها من تلف القرص أو فقدان الجهاز.
            الاستعادة تتمّ عبر مدير النظام (دليل التشغيل، القسم 11): استعادة النسخة إلى قاعدة مُرشَّحة ثم «تبديل قاعدة البيانات» أدناه.
          </p>
        </>
      )}

      <div>
        <button className="btn" onClick={load} disabled={loading} style={{ fontSize: 12 }}>
          ↻ تحديث الحالة
        </button>
      </div>
    </div>
  );
}
