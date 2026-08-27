// backend/src/routes/admissionCancellation.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3B-14D — إلغاء حجز + استرداد كل دفعاته غير المستردة، كمعاملة ذرّية واحدة لا
// تنقسم (قرار صريح، Decision 4): تحوّل حالة سجل القبول + تحديد الدفعات القابلة
// للاسترداد + إنشاء حركات الاسترداد كلها — إما تنجح كلها معاً أو تفشل كلها معاً. لا
// نقطتا نهاية منفصلتان (كان يمكن أن يُترَك سجل القبول ملغياً بلا استرداد فعلي، أو العكس).
//
// الحارس الذرّي (وهو نفسه آلية القفل — انظر التعليق داخل الدالة): تحديث مشروط واحد على
// admissions (WHERE reservation_status IN ('reserved','waiting')) — نفس أسلوب الإصلاح
// المُثبَت في إغلاق Phase 3B-14B لسباق عكس treasury_txn، مُطبَّق هنا من البداية على مشكلة
// تزامن مختلفة تماماً (إلغاء مزدوج، لا تجاوز مبلغ)، بنفس المبدأ: الشرط يعيش داخل جملة
// الكتابة نفسها، لا فحصاً منفصلاً قبلها.
//
// ملف منفصل تماماً عن admissionActivation.js (غير مُعدَّل، مسؤولية واحدة لكل ملف).
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import crypto from 'crypto';
import { runInTransaction } from '../lib/transaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth.
export async function cancelAdmissionWithRefund({ admissionId, reason } = {}, { userId = null } = {}) {
  if (typeof admissionId !== 'string' || !admissionId.trim()) throw badRequest('admissionId مطلوب.');

  const result = await runInTransaction(async (tx) => {
    // ── الحارس الذرّي = القفل ──────────────────────────────────────────────
    // شرط الحالة الحالية يعيش داخل UPDATE نفسه، لا فحصاً منفصلاً (findUnique) قبله —
    // محاولة إلغاء ثانية متزامنة لنفس السجل تُحجَب خلف قفل الصف الذي يفرضه هذا الـ
    // UPDATE، ثم تُعاد تقييم الشرط بعد أن تُثبَّت (commit) المعاملة الأولى — فتُطابِق
    // صفراً من الصفوف (الحالة أصبحت 'cancelled' فعلاً) وتُرفَض بدل أن تُكرِّر الاسترداد.
    const guard = await tx.admissions.updateMany({
      where: { id: admissionId, reservation_status: { in: ['reserved', 'waiting'] } },
      data:  { reservation_status: 'cancelled', stage: 'lead' },
    });
    if (guard.count !== 1) {
      throw badRequest('لا يمكن إلغاء هذا السجل — قد يكون ملغياً بالفعل أو في حالة غير قابلة للإلغاء.');
    }

    const admission = await tx.admissions.findUnique({ where: { id: admissionId } });

    // الدفعات القابلة للاسترداد = كل دفعات هذا القبول التي لا تملك حركة استرداد نشطة
    // مرتبطة بها بعد — مُشتَقّة من treasury_txn دائماً، لا حقل refunded (لا يوجد عمود
    // كهذا على admission_payments إطلاقاً — تحقّق فعلي حيّ، تقرير التفتيش §3).
    const allPayments = await tx.admission_payments.findMany({ where: { admission_id: admissionId } });
    const existingRefunds = await tx.treasury_txn.findMany({
      where: { ref_type: 'admissionRefund', ref_id: { in: allPayments.map(p => p.id) }, status: 'active' },
      select: { ref_id: true },
    });
    const alreadyRefundedIds = new Set(existingRefunds.map(r => r.ref_id));
    const refundable = allPayments.filter(p => !alreadyRefundedIds.has(p.id));

    const refundTxns = [];
    for (const payment of refundable) {
      const originalTxn = await tx.treasury_txn.findUnique({ where: { id: payment.treasury_txn_id } });
      if (!originalTxn) {
        throw badRequest(`دفعة القبول ${payment.id} غير مرتبطة بحركة خزنة صحيحة — يتطلّب مراجعة يدوية.`);
      }

      // رصيد الخزنة الحيّ — مُعاد حسابه من صفوف treasury_txn الفعلية لهذه الخزنة تحديداً
      // (قد تختلف من دفعة لأخرى)، لا من قيمة يرسلها العميل. فشل أي واحدة منها يُسقِط
      // المعاملة بأكملها — لا استرداد جزئي أبداً (قرار صريح: "تنجح كلها أو تفشل كلها").
      const cashbox = await tx.cashboxes.findUnique({ where: { id: originalTxn.cashbox_id } });
      const incomeAgg  = await tx.treasury_txn.aggregate({
        where: { cashbox_id: originalTxn.cashbox_id, type: 'income',  status: 'active' }, _sum: { amount: true },
      });
      const expenseAgg = await tx.treasury_txn.aggregate({
        where: { cashbox_id: originalTxn.cashbox_id, type: 'expense', status: 'active' }, _sum: { amount: true },
      });
      const balance = Number(cashbox?.opening_balance ?? 0)
        + Number(incomeAgg._sum.amount ?? 0)
        - Number(expenseAgg._sum.amount ?? 0);
      const refundAmount = Number(payment.amount);
      if (refundAmount > balance) {
        throw badRequest(`رصيد الخزنة (${balance} ج.م) لا يكفي لاسترداد دفعة بقيمة ${refundAmount} ج.م — أُلغيت العملية بأكملها.`);
      }

      const refundTxn = await tx.treasury_txn.create({
        data: {
          id:          crypto.randomUUID(),
          cashbox_id:  originalTxn.cashbox_id, // نفس خزنة الدفعة الأصلية دائماً — لا إعادة اختيار
          date:        new Date(),
          type:        'expense',
          category:    'refund',
          amount:      refundAmount,
          method:      originalTxn.method,
          party:       admission.name,
          notes:       `استرداد إلغاء حجز — ${admission.name}${reason ? ` (${reason})` : ''}`,
          ref_type:    'admissionRefund',
          ref_id:      payment.id,
          admission_id: admissionId,
          created_by:  userId,
        },
      });
      refundTxns.push(refundTxn);
    }

    // سجل النشاط النظامي — نفس حدثي CANCELLED/REFUND_ISSUED الحاليين، الآن داخل نفس
    // المعاملة الذرّية (كانا يُسجَّلان محلياً كخطوة منفصلة best-effort بعد الحقيقة).
    const logs = [];
    logs.push(await tx.admission_system_log.create({
      data: { id: crypto.randomUUID(), admission_id: admissionId, activity_type: 'cancelled', timestamp: new Date(), by_user: userId, details: reason || '' },
    }));
    if (refundTxns.length > 0) {
      logs.push(await tx.admission_system_log.create({
        data: { id: crypto.randomUUID(), admission_id: admissionId, activity_type: 'refundIssued', timestamp: new Date(), by_user: userId, details: `${refundTxns.length} دفعة` },
      }));
    }

    return { admission, refundTxns, logs };
  });

  return {
    admission:  snakeToCamel(result.admission),
    refundTxns: result.refundTxns.map(snakeToCamel),
    logs:       result.logs.map(snakeToCamel),
  };
}

const router = Router();

// PUT /api/admissions/:id/cancel-with-refund — segment ثالث، لا يتعارض مع أي مسار
// admissions آخر (الـ CRUD العام PUT /api/admissions/:id، وactivate في ملف منفصل).
router.put('/:id/cancel-with-refund', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  const data = await cancelAdmissionWithRefund({ admissionId: id, reason }, { userId: req.user?.id ?? null });
  res.json({ ok: true, data });
}));

export default router;
