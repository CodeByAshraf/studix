// src/modules/support-access/SupportAccessPage.jsx
// Phase 4c — Support Access frontend. UI only: consumes the four Phase 4b endpoints as-is
// (challenge/verify/status/revoke), never invents crypto/signing logic client-side. This
// component never persists the challenge or the response code to localStorage/sessionStorage
// — every piece of state here lives only in React state, gone the moment the page unmounts
// or the tab closes.
//
// Contract gap (reported, not silently worked around): Phase 4b's GET /status returns only
// the CURRENT state ({active, session}), not a list of past events — there is no history/list
// endpoint. Per Phase 4c's explicit instructions ("do not add unnecessary backend changes"),
// this page does not fabricate a history view. See the Phase 4c completion report for detail.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../store/auth.context';
import { useToast } from '../../components/Toast';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import PageHeader from '../../components/shared/PageHeader';
import Card from '../../components/shared/Card';
import Button from '../../components/ui/Button';
import { ConfirmModal } from '../../components/ui/Modal';
import { qrToSVG } from '../../utils/qrcode';
import {
  pgGenerateSupportChallenge, pgVerifySupportChallenge,
  pgGetSupportAccessStatus, pgRevokeSupportAccess,
} from '../../services/api';

const STATUS_POLL_MS = 20_000;

function formatRemaining(ms) {
  if (!ms || ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function SupportAccessPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { loading, run } = useErrorHandler(toast);

  const [status, setStatus] = useState(null); // { active, session }
  const [statusLoading, setStatusLoading] = useState(true);
  const [challenge, setChallenge] = useState(null); // { challenge, installationId, expiresAt, ttlMs }
  const [responseInput, setResponseInput] = useState('');
  const [now, setNow] = useState(Date.now());
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [copied, setCopied] = useState(false);

  // deps = [] عمداً (لا [toast]): كائن toast من useToast() يُعاد إنشاؤه بالكامل في كل
  // render لـ ToastProvider (بلا useMemo هناك — كل ظهور/زوال أي toast في أي مكان بالتطبيق
  // يُعيد render له)، فلو اعتمدت عليه هذه الدالة كانت ستتغيّر هويتها باستمرار وتُعيد
  // تشغيل useEffect أدناه (ومعه طلب GET إضافي) في كل مرة يظهر توست — بما فيها التوست
  // الناتج عن نجاح هذه الصفحة نفسها. آمن تماماً رغم "القِدَم" الظاهري: toast.error/.info
  // كلاهما يُفوِّض دائماً لنفس add() المُثبَّتة (useCallback بلا deps في Toast.jsx) بصرف
  // النظر عن جيل الكائن الذي أُغلِق عليه هنا — لا فرق سلوكي إطلاقاً.
  const refreshStatus = useCallback(async ({ silent = false } = {}) => {
    try {
      const result = await pgGetSupportAccessStatus();
      setStatus(result);
    } catch (err) {
      if (!silent) toast.error(err.message || 'تعذّر تحميل حالة وصول الدعم.');
    } finally {
      setStatusLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // تحميل أولي — مرّة واحدة عند فتح الصفحة (refreshStatus مستقرّة الآن، فهذا لا يُعاد أبداً).
  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  // نبضة كل ثانية — تُحرّك كلا العدّادين (رمز التحدّي + الجلسة الفعّالة).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // رمز التحدّي منتهي محلياً → يُمسَح من الواجهة فوراً (الخادم يرفضه بغضّ النظر أصلاً).
  // toast مُستبعَدة من deps عمداً — نفس سبب refreshStatus أعلاه بالضبط.
  useEffect(() => {
    if (challenge && now >= challenge.expiresAt) {
      setChallenge(null);
      toast.info('انتهت صلاحية رمز الدعم — وَلِّد رمزاً جديداً.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge, now]);

  // العدّاد المحلي للجلسة وصل صفراً لكن الحالة المحفوظة لا تزال "فعّالة" (لقطة قديمة)
  // → إعادة مزامنة صامتة مع الخادم بدل الوثوق بالعدّاد المحلي وحده (يلتقط أيضاً إلغاءً
  // حدث من مكان آخر، لا فقط الانتهاء الطبيعي).
  useEffect(() => {
    if (status?.active && status.session && status.session.expiresAt <= now) {
      refreshStatus({ silent: true });
    }
  }, [now, status, refreshStatus]);

  // فحص دوري صامت أثناء وجود جلسة فعّالة — يلتقط إلغاءً حدث من مكان آخر بلا إزعاج
  // المستخدم بأي toast لو فشل طلب واحد عابر (يُعاد المحاولة تلقائياً في الدورة التالية).
  useEffect(() => {
    if (!status?.active) return undefined;
    const id = setInterval(() => refreshStatus({ silent: true }), STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [status?.active, refreshStatus]);

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="وصول الدعم الفني" subtitle="هذه الصفحة متاحة لمدير النظام فقط." />
      </div>
    );
  }

  const handleGenerateChallenge = () => run(async () => {
    const result = await pgGenerateSupportChallenge();
    setChallenge(result);
    setResponseInput('');
    setCopied(false);
    return result;
  }, { successMsg: 'تم توليد رمز الدعم — شاركه مع مزوّد الدعم عبر قناة موثوقة (هاتف أو واتساب).' });

  const handleCopyChallenge = async () => {
    if (!challenge) return;
    try {
      await navigator.clipboard.writeText(challenge.challenge);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('تعذّر النسخ التلقائي — انسخ الرمز يدوياً.');
    }
  };

  const handleVerify = () => run(async () => {
    if (!challenge) throw new Error('لا يوجد رمز دعم نشط — وَلِّد رمزاً جديداً أولاً.');
    if (!responseInput.trim()) throw new Error('أدخل رمز الرد المُستلَم من مزوّد الدعم.');
    const result = await pgVerifySupportChallenge(challenge.challenge, responseInput.trim());
    setChallenge(null);
    setResponseInput('');
    await refreshStatus();
    return result;
  }, { successMsg: 'تم منح وصول الدعم بنجاح — الجلسة نشطة الآن.' });

  const handleRevoke = () => run(async () => {
    const result = await pgRevokeSupportAccess();
    await refreshStatus();
    setConfirmRevoke(false);
    return result;
  }, { successMsg: 'تم إلغاء وصول الدعم.' });

  const challengeRemainingMs = challenge ? challenge.expiresAt - now : 0;
  const sessionRemainingMs = status?.session ? status.session.expiresAt - now : 0;
  const qrSvg = challenge ? qrToSVG(challenge.challenge, { size: 160 }) : '';

  return (
    <div>
      <PageHeader
        title="وصول الدعم الفني"
        subtitle="منح مزوّد الدعم وصولاً مؤقتاً ومُدقَّقاً لهذا التثبيت — بلا كلمة مرور ثابتة، بلا حساب مخفي."
      />

      <div style={{ padding: '0 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── حالة الوصول الحالية ── */}
        <Card title="حالة الوصول الحالية">
          {statusLoading ? (
            <div style={{ color: 'var(--text3)', fontSize: 13 }}>جاري التحميل...</div>
          ) : status?.active ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                  <strong style={{ fontSize: 14 }}>جلسة دعم فعّالة الآن</strong>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                  الوقت المتبقي:{' '}
                  <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{formatRemaining(sessionRemainingMs)}</span>
                </div>
              </div>
              <Button variant="danger" loading={loading} onClick={() => setConfirmRevoke(true)}>
                إلغاء وصول الدعم
              </Button>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>لا توجد جلسة دعم فعّالة حالياً.</div>
          )}
        </Card>

        {/* ── توليد رمز دعم ── */}
        <Card
          title="توليد رمز دعم"
          subtitle="شارك الرمز الناتج مع مزوّد الدعم عبر الهاتف أو واتساب فقط — لا ترسله عبر البريد الإلكتروني لهذا الحساب."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <Button variant="primary" loading={loading} onClick={handleGenerateChallenge}>
                توليد رمز دعم جديد
              </Button>
            </div>

            {challenge && (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>
                    رمز الدعم — ينتهي خلال <span style={{ fontFamily: 'monospace' }}>{formatRemaining(challengeRemainingMs)}</span>
                  </div>
                  <div
                    data-testid="challenge-code"
                    style={{
                      background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9,
                      padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all',
                      userSelect: 'all',
                    }}
                  >
                    {challenge.challenge}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <Button variant="secondary" size="sm" onClick={handleCopyChallenge}>
                      {copied ? 'تم النسخ ✓' : 'نسخ الرمز'}
                    </Button>
                  </div>
                </div>
                {qrSvg && (
                  <div
                    role="img"
                    aria-label="رمز QR لرمز الدعم"
                    style={{ flexShrink: 0, background: '#fff', padding: 8, borderRadius: 9, border: '1px solid var(--border)' }}
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                )}
              </div>
            )}
          </div>
        </Card>

        {/* ── إدخال رمز الرد ── */}
        <Card title="إدخال رمز الرد" subtitle="أدخل الرمز الذي استلمته من مزوّد الدعم بعد إرسال رمز الدعم أعلاه له.">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              type="text"
              value={responseInput}
              onChange={(e) => setResponseInput(e.target.value)}
              placeholder="الصق رمز الرد هنا"
              disabled={!challenge}
              aria-label="رمز الرد"
              style={{
                flex: 1, minWidth: 220, background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontFamily: 'monospace',
                fontSize: 13, outline: 'none',
              }}
            />
            <Button
              variant="primary"
              loading={loading}
              disabled={!challenge || !responseInput.trim()}
              onClick={handleVerify}
            >
              تحقّق ومنح الوصول
            </Button>
          </div>
          {!challenge && (
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>
              وَلِّد رمز دعم أولاً قبل إدخال الرد.
            </div>
          )}
        </Card>

      </div>

      <ConfirmModal
        isOpen={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        onConfirm={handleRevoke}
        title="إلغاء وصول الدعم"
        message="سيتم إبطال جلسة الدعم الفعّالة فوراً. لن يستطيع مزوّد الدعم استخدامها بعد ذلك."
        confirmLabel="إلغاء الوصول"
        loading={loading}
      />
    </div>
  );
}
