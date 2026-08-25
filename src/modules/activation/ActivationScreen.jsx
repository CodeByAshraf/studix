// src/modules/activation/ActivationScreen.jsx
// Phase 5c — the actual full-screen gate UI, rendered by ActivationGate when the backend
// reports the installation is not activated. Two variants: a plain restricted message for
// non-admins (they cannot generate a request code or submit an artifact — same admin-only
// boundary the backend already enforces on /api/license/request-code and /api/license/
// activate), and the interactive form for admins. Never implements any crypto/signature
// logic here — this screen only ever displays what the backend already computed and
// submits an opaque artifact string to the backend to verify.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import Card from '../../components/shared/Card';
import Button from '../../components/ui/Button';
import { pgRequestLicenseActivationCode, pgActivateLicense } from '../../services/api';

const REASON_MESSAGES = {
  not_configured: 'لم يُهيَّأ التفعيل على هذا التثبيت بعد — لا يوجد مفتاح ترخيص مسجَّل.',
  not_activated: 'لم يُفعَّل هذا التثبيت بعد.',
  expired: 'انتهت صلاحية الترخيص الحالي — يلزم تفعيل شهادة جديدة.',
  wrong_installation: 'شهادة الترخيص المخزَّنة غير مرتبطة بهذا التثبيت.',
  wrong_product: 'شهادة الترخيص المخزَّنة لمنتج مختلف.',
  invalid_signature: 'توقيع شهادة الترخيص المخزَّنة غير صالح.',
  malformed_artifact: 'شهادة الترخيص المخزَّنة تالفة أو غير صالحة.',
  bad_public_key: 'تعذّر التحقّق من الترخيص — خطأ في إعداد المفتاح العام لهذا التثبيت.',
};

function reasonMessage(reason) {
  return REASON_MESSAGES[reason] || 'هذا التثبيت غير مُفعَّل حالياً.';
}

function NonAdminGate({ onLogout }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: 'var(--bg)', fontFamily: 'Cairo, sans-serif', direction: 'rtl',
    }}>
      <div style={{ maxWidth: 440, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
          يتطلّب Studix تفعيلاً
        </div>
        <p style={{ fontSize: '0.9rem', color: 'var(--text2)', lineHeight: 1.8, marginBottom: 24 }}>
          هذا التثبيت غير مُفعَّل بعد. يُرجى التواصل مع مدير النظام لتفعيله.
        </p>
        <Button variant="secondary" onClick={onLogout}>تسجيل الخروج</Button>
      </div>
    </div>
  );
}

function AdminActivationForm({ status, onActivated }) {
  const toast = useToast();
  const { loading, run } = useErrorHandler(toast);

  const [requestCode, setRequestCode] = useState(null); // { code, installationId, product }
  const [copied, setCopied] = useState(false);
  const [artifactInput, setArtifactInput] = useState('');

  const handleRequestCode = () => run(async () => {
    const result = await pgRequestLicenseActivationCode();
    setRequestCode(result);
    setCopied(false);
    return result;
  }, { successMsg: 'تم توليد رمز طلب التفعيل — أرسله إلى مزوّد الترخيص.' });

  const handleCopyCode = async () => {
    if (!requestCode) return;
    try {
      await navigator.clipboard.writeText(requestCode.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('تعذّر النسخ التلقائي — انسخ الرمز يدوياً.');
    }
  };

  const handleActivate = () => run(async () => {
    const trimmed = artifactInput.trim();
    if (!trimmed) throw new Error('الصق شهادة الترخيص أولاً.');
    const result = await pgActivateLicense(trimmed);
    setArtifactInput('');
    setRequestCode(null);
    await onActivated();
    return result;
  }, { successMsg: 'تم تفعيل Studix بنجاح.' });

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: 'var(--bg)', fontFamily: 'Cairo, sans-serif', direction: 'rtl',
    }}>
      <div style={{ width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🔒</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)' }}>تفعيل Studix</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text3)', marginTop: 4 }}>
            {reasonMessage(status?.reason)}
          </div>
        </div>

        <Card title="رمز طلب التفعيل" subtitle="وَلِّد رمزاً وأرسله إلى مزوّد الترخيص للحصول على شهادة تفعيل.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <Button variant="primary" loading={loading} onClick={handleRequestCode}>
                الحصول على رمز التفعيل
              </Button>
            </div>
            {requestCode && (
              <div>
                <div
                  data-testid="activation-request-code"
                  style={{
                    background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9,
                    padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all',
                    userSelect: 'all',
                  }}
                >
                  {requestCode.code}
                </div>
                <div style={{ marginTop: 8 }}>
                  <Button variant="secondary" size="sm" onClick={handleCopyCode}>
                    {copied ? 'تم النسخ ✓' : 'نسخ الرمز'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card title="إدخال شهادة الترخيص" subtitle="الصق الشهادة التي استلمتها من مزوّد الترخيص.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <textarea
              value={artifactInput}
              onChange={(e) => setArtifactInput(e.target.value)}
              placeholder="الصق شهادة الترخيص هنا"
              aria-label="شهادة الترخيص"
              rows={4}
              style={{
                background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9,
                padding: '9px 12px', color: 'var(--text)', fontFamily: 'monospace', fontSize: 12,
                outline: 'none', resize: 'vertical',
              }}
            />
            <div>
              <Button variant="primary" loading={loading} disabled={!artifactInput.trim()} onClick={handleActivate}>
                تفعيل
              </Button>
            </div>
          </div>
        </Card>

        <div style={{ textAlign: 'center', fontSize: '0.78rem', color: 'var(--text3)' }}>
          بحاجة لمساعدة؟{' '}
          <Link to="/support-access" style={{ color: 'var(--accent)', fontWeight: 700 }}>
            وصول الدعم الفني
          </Link>{' '}
          يبقى متاحاً حتى قبل التفعيل.
        </div>
      </div>
    </div>
  );
}

export default function ActivationScreen({ isAdmin, status, onActivated, onLogout }) {
  if (!isAdmin) return <NonAdminGate onLogout={onLogout} />;
  return <AdminActivationForm status={status} onActivated={onActivated} />;
}
