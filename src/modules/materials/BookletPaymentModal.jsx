// src/modules/materials/BookletPaymentModal.jsx
// نافذة تأكيد دفعة مذكرة (كاملة/جزئية) من شاشة "تتبّع التسليم" — تُفتح فقط عند اختيار
// "مدفوع" أو "مدفوع جزئياً". "غير مدفوع" لا يفتح هذه النافذة إطلاقاً (لا حركة مالية).
// عند التأكيد: نداء واحد لنقطة نهاية ذرّية على الخادم (pgConfirmMaterialPayment) تُنشئ
// دفعة+حركة خزنة حقيقيتين معاً مع تحديث سجل الاستلام — لا كتابة محلية متفائلة هنا إطلاقاً؛
// الطرف المستدعي هو من يُحدِّث الحالة بعد نجاح الخادم (نفس مبدأ "server-truth-first"
// المُتَّبَع في handleSave أعلاه).
import { useEffect, useMemo, useState } from 'react';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';

export default function BookletPaymentModal({ isOpen, onClose, student, material, remaining, targetStatus, initialAmount, cashboxes, onConfirm }) {
  const [amount, setAmount] = useState('');
  const [cashboxId, setCashboxId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isFull = targetStatus === 'paid';

  useEffect(() => {
    if (!isOpen) return;
    const suggested = Number(initialAmount) > 0 ? Math.min(Number(initialAmount), remaining) : remaining;
    setAmount(isFull ? String(remaining) : String(suggested));
    setCashboxId('');
    setSubmitting(false);
    setError('');
  }, [isOpen, isFull, remaining, initialAmount]);

  const amt = Number(amount);
  const amountValid = isFull ? amt === remaining : Number.isFinite(amt) && amt > 0 && amt <= remaining;
  const canConfirm = amountValid && !!cashboxId && !submitting;

  const activeCashboxes = useMemo(() => (cashboxes || []).filter((c) => c.active), [cashboxes]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setError('');
    try {
      await onConfirm({ amount: isFull ? remaining : amt, cashboxId });
    } catch (err) {
      setError(err.message || 'فشل تسجيل الدفعة — حاول مرة أخرى');
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={submitting ? undefined : onClose}
      title={isFull ? 'تأكيد دفع مذكرة' : 'تأكيد دفع جزئي — مذكرة'}
      size="sm"
      closeOnBackdrop={!submitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>إلغاء</Button>
          <Button variant="primary" loading={submitting} disabled={!canConfirm} onClick={handleConfirm}>
            💰 تأكيد الدفع
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 4 }}>{student?.name}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>{material?.name}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text3)', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' }}>سعر المذكرة</div>
            <div style={{ fontWeight: 800, fontFamily: 'Cairo,sans-serif' }}>{material?.price} ج.م</div>
          </div>
          <div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text3)', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' }}>المتبقي حالياً</div>
            <div style={{ fontWeight: 800, fontFamily: 'Cairo,sans-serif', color: '#ef4444' }}>{remaining} ج.م</div>
          </div>
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            المبلغ المدفوع (ج.م) <span style={{ color: 'var(--red)' }}>*</span>
          </label>
          <input
            type="number"
            min="1"
            max={remaining}
            value={amount}
            disabled={isFull}
            onChange={(e) => setAmount(e.target.value)}
            style={{
              width: '100%', marginTop: 5, padding: '9px 12px', textAlign: 'center',
              background: isFull ? 'var(--surface3)' : 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 9, color: 'var(--text)', fontFamily: 'Cairo,sans-serif', fontSize: '0.9rem',
              fontWeight: 700, outline: 'none', direction: 'rtl',
            }}
          />
          {!isFull && !amountValid && amount !== '' && (
            <div style={{ fontSize: '0.7rem', color: 'var(--red)', marginTop: 4 }}>
              المبلغ يجب أن يكون أكبر من صفر ولا يتجاوز المتبقي ({remaining} ج.م).
            </div>
          )}
        </div>

        <div>
          <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            الخزنة <span style={{ color: 'var(--red)' }}>*</span>
          </label>
          <select
            value={cashboxId}
            onChange={(e) => setCashboxId(e.target.value)}
            style={{
              width: '100%', marginTop: 5, padding: '9px 12px', background: 'var(--surface2)',
              border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text)',
              fontFamily: 'Cairo,sans-serif', fontSize: '0.85rem', outline: 'none', cursor: 'pointer', direction: 'rtl',
            }}
          >
            <option value="">اختر الخزنة...</option>
            {activeCashboxes.map((cb) => <option key={cb.id} value={cb.id}>{cb.name}</option>)}
          </select>
          {activeCashboxes.length === 0 && (
            <div style={{ fontSize: '0.7rem', color: 'var(--red)', marginTop: 4 }}>
              لا توجد خزنة نشطة — لا يمكن تأكيد الدفع بدونها.
            </div>
          )}
        </div>

        {error && (
          <div style={{ padding: '9px 12px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, fontSize: '0.8rem', color: '#dc2626' }}>
            ⚠ {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
