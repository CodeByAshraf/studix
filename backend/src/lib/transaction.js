// backend/src/lib/transaction.js
// ─────────────────────────────────────────────────────────────
// بنية المعاملات الذرّية (transaction infrastructure).
// Phase 0: البنية فقط — تُستخدم لاحقاً للعمليات المركّبة مثل
//   (payment + treasury_txn) معاً في معاملة واحدة لا تنقسم.
// المبدأ: إما تنجح كل الخطوات أو تفشل كلها (لا مال ناقص، لا سجل يتيم).
// ─────────────────────────────────────────────────────────────
import { prisma } from '../prisma.js';

/**
 * تنفيذ مجموعة عمليات داخل معاملة ذرّية واحدة.
 * @param {(tx) => Promise<any>} work - دالة تستقبل tx client وتنفّذ العمليات.
 * @returns نتيجة العمل، أو يُلقي خطأ (فتُلغى كل العمليات تلقائياً).
 *
 * مثال مستقبلي (Phase 3):
 *   await runInTransaction(async (tx) => {
 *     const pay = await tx.payments.create({ data: {...} });
 *     await tx.treasury_txn.create({ data: { ref_type:'payment', ref_id: pay.id, ... } });
 *     return pay;
 *   });
 */
export async function runInTransaction(work) {
  return prisma.$transaction(async (tx) => work(tx));
}

/**
 * تنفيذ عدة عمليات Prisma دفعة واحدة (batch atomic).
 * @param {Array} operations - مصفوفة من prisma promises.
 */
export async function runBatch(operations) {
  return prisma.$transaction(operations);
}
