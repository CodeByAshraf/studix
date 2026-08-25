// backend/src/routes/activityLogs.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3B-15 — activity_logs. لا مسار ذرّي مخصّص هنا (بعكس كل شيء في 3B-14): سجل
// نشاط واحد مستقل، لا كتابة مركّبة تمسّ أكثر من جدول تحتاج معاملة واحدة. هذا اعتراض
// حسب method+path فقط (middleware رقيق)، ثم POST يمرّ فعلياً للـ CRUD العام — بنفس
// أسلوب POST / في treasuryTxn.js بالضبط.
//
// لا نثق أبداً بـ userId/userName يُرسَلهما العميل: user_id يُشتَقّ حصراً من
// req.user.id (الجلسة الموقّعة)، وuser_name يُشتَقّ من سجل users الحقيقي المطابق —
// لا اسم يُرسله العميل يصبح القيمة المعتمَدة أبداً. سجل النشاط append-only فعلاً منذ
// قبل هذه المرحلة (trg_no_delete_activity، بلا استثناء) — PUT/PATCH محظوران أيضاً هنا
// امتداداً لنفس مبدأ "سجل تدقيق ثابت"، لا فقط DELETE.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from '../prisma.js';

// يُصدَّر منفصلاً ليكون قابلاً للاختبار مباشرة بلا HTTP كامل — نفس مبدأ كل دالة
// مُصدَّرة أخرى في هذه المرحلة (createPayment، cancelAdmissionWithRefund، ...).
// userId=null (لا جلسة، أو جلسة بلا id لأي سبب) → userName يبقى null أيضاً؛ لا يُخترَع
// مستخدم، ولا نص عربي يصبح user_id إطلاقاً (قرار Phase 3B-15 الصريح).
export async function resolveActivityLogActor(userId) {
  if (!userId) return { userId: null, userName: null };
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { name: true } });
  return { userId, userName: user?.name ?? null };
}

export default async function activityLogsInterceptor(req, res, next) {
  if (req.method === 'POST') {
    const { userId, userName } = await resolveActivityLogActor(req.user?.id ?? null);
    req.body = { ...req.body, userId, userName };
    return next();
  }
  if (req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
    return res.status(405).json({ ok: false, error: 'سجل النشاط append-only — لا تعديل ولا حذف.' });
  }
  next();
}
