// backend/src/routes/activityLogs.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3B-15 — activity_logs. لا مسار ذرّي مخصّص هنا (بعكس كل شيء في 3B-14): سجل
// نشاط واحد مستقل، لا كتابة مركّبة تمسّ أكثر من جدول تحتاج معاملة واحدة. POST يمرّ
// فعلياً للـ CRUD العام (نفس أسلوب treasuryTxn.js) — بنفس أسلوب POST / في treasuryTxn.js
// بالضبط.
//
// لا نثق أبداً بـ userId/userName يُرسَلهما العميل: user_id يُشتَقّ حصراً من
// req.user.id (الجلسة الموقّعة)، وuser_name يُشتَقّ من سجل users الحقيقي المطابق —
// لا اسم يُرسله العميل يصبح القيمة المعتمَدة أبداً. سجل النشاط append-only فعلاً منذ
// قبل هذه المرحلة (trg_no_delete_activity، بلا استثناء) — PUT/PATCH محظوران أيضاً هنا
// امتداداً لنفس مبدأ "سجل تدقيق ثابت"، لا فقط DELETE.
//
// Scalability Architecture Phase 4 (activityLogs) — GET / أصبحت مسار Router حقيقي
// (نفس نمط payments.js/communications.js: مُركَّب قبل الحلقة الديناميكية على نفس
// /api/activityLogs التي كانت تخدمها makeCrudRouter العامة سابقاً بلا ترتيب ولا عدّ
// حقيقي) بدل middleware رقيق يُمرِّر كل GET للمسار العام. activityLogs لم تعد ضمن
// PG_COLLECTIONS (لا تحميل كامل عند الإقلاع) — هذا المسار هو المصدر الوحيد الآن لكل
// من ActivityLogPage.jsx (أحدث 200 + العدّ الكلي) وDashboard.jsx (أحدث 5)، بنفس تطبيع
// ts/user/description المُستخدَم سابقاً في القراءة/الدمج (db.middleware.js's
// COLLECTION_FIXUPS.activityLogs) ومسار الكتابة (normalizeActivityLogResponse في
// api.js) — لا تغيير في شكل السجل حسب مصدره.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requirePermission, requireActiveSession } from '../middleware/permissions.js';
import { snakeToCamel } from '../lib/caseMapper.js';
import { serializeBigInt } from './payments.js';

// M2/F2 — the permission guard for EVERY /api/activityLogs mount (this router and the generic
// CRUD mount in server.js that performs the actual insert). Writing an audit entry
// (POST /) needs only a valid, current session: every operational screen calls addLog(),
// and most operational roles don't hold 'activity-log' — their entries were being rejected
// with 403 and lost. Reading the log (and every other method/path) stays behind
// 'activity-log' exactly as before; PUT/PATCH/DELETE remain blocked below regardless.
const requireActivityLogPermission = requirePermission('activity-log');
export function activityLogsGuard(req, res, next) {
  const guard = req.method === 'POST' && req.path === '/' ? requireActiveSession : requireActivityLogPermission;
  return guard(req, res, next);
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// يُصدَّر منفصلاً ليكون قابلاً للاختبار مباشرة بلا HTTP كامل — نفس مبدأ كل دالة
// مُصدَّرة أخرى في هذه المرحلة (createPayment، cancelAdmissionWithRefund، ...).
// userId=null (لا جلسة، أو جلسة بلا id لأي سبب) → userName يبقى null أيضاً؛ لا يُخترَع
// مستخدم، ولا نص عربي يصبح user_id إطلاقاً (قرار Phase 3B-15 الصريح). مُستوردة أيضاً
// من license.js/supportAccess.js — لا تُغيَّر توقيعها/سلوكها هنا إطلاقاً.
export async function resolveActivityLogActor(userId) {
  if (!userId) return { userId: null, userName: null };
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { name: true } });
  return { userId, userName: user?.name ?? null };
}

function parsePaginationParam(value, { label, def, min, max }) {
  if (value === undefined || value === null || value === '') return def;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
    throw badRequest(`${label} غير صالح.`);
  }
  return n;
}

// نفس تطبيع COLLECTION_FIXUPS.activityLogs (db.middleware.js) وnormalizeActivityLogResponse
// (api.js) بالحرف — ts/user/description مُضافة فوق الحقول الخام (لا استبدال)، حتى لا
// يختلف شكل السجل بين مسار الكتابة (POST، عبر الاثنين أعلاه) ومسار القراءة هنا.
function normalizeActivityLog(row) {
  return {
    ...row,
    ts: row.timestamp,
    user: row.userName || 'النظام',
    description: row.details ?? '',
  };
}

const router = Router();

// GET / — أحدث سجلات النشاط أولاً (ترتيب حتمي)، مع العدّ الحقيقي لكامل الجدول — يخدم
// ActivityLogPage.jsx (limit=200) وDashboard.jsx (limit=5) معاً، نقطة نهاية واحدة فقط.
// timestamp DESC هو عمود التوقيت الحقيقي الوحيد على هذا الجدول (لا created_at منفصل)؛
// id (نص عشوائي مُولَّد من crypto.randomUUID عند الإنشاء — انظر crud.js، لا default على
// العمود في القاعدة) كاسِر تعادل حتمي بحت لحالة تطابق timestamp تماماً (نادرة جداً)، لا
// يحمل أي دلالة زمنية بنفسه.
// FOLLOW-UP (غير مُنفَّذ في هذه المرحلة — لا تعديل شيمة الآن): لا فهرس على activity_logs
// .timestamp حالياً (فهرس idx_activity_user على user_id فقط) — ORDER BY timestamp DESC
// LIMIT بلا فهرس يتطلّب فرز الجدول كاملاً؛ آمن على الحجم الحالي، لكن مع نمو هذا الجدول
// (الأسرع نمواً في النظام) سيصبح مكلفاً. يوصى بفهرس (timestamp DESC) عند اعتماد أي
// تعديل شيمة مستقبلاً.
router.get('/', asyncHandler(async (req, res) => {
  const limit = parsePaginationParam(req.query.limit, { label: 'limit', def: 50, min: 1, max: 500 });
  const offset = parsePaginationParam(req.query.offset, { label: 'offset', def: 0, min: 0 });

  const [total, rows] = await Promise.all([
    prisma.activity_logs.count(),
    prisma.activity_logs.findMany({
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: limit,
      skip: offset,
    }),
  ]);

  const items = serializeBigInt(snakeToCamel(rows)).map(normalizeActivityLog);
  res.json({ ok: true, data: { items, total } });
}));

// POST / — نفس الاعتراض الحالي بالحرف: يشتقّ userId/userName من الجلسة، ثم يُمرِّر
// للـ CRUD العام (مُركَّب لاحقاً على نفس المسار عبر الحلقة الديناميكية في server.js)
// الذي يتولّى الإنشاء الفعلي — لا تغيير في منطق الكتابة نفسه هنا إطلاقاً.
// Client-supplied actor fields (in either casing) are dropped first: the generic router's
// camelToSnake lets a later key win, so a client `user_id` placed after `userId` would
// otherwise override the session-derived author. There is no created_by column; it is
// dropped too rather than failing the insert.
const CLIENT_ACTOR_FIELDS = ['userId', 'user_id', 'userName', 'user_name', 'createdBy', 'created_by'];
router.post('/', asyncHandler(async (req, res, next) => {
  const { userId, userName } = await resolveActivityLogActor(req.user?.id ?? null);
  const body = { ...req.body };
  for (const field of CLIENT_ACTOR_FIELDS) delete body[field];
  req.body = { ...body, userId, userName };
  next();
}));

// PUT/PATCH/DELETE — محظورة صراحةً (سجل تدقيق append-only، نفس السلوك الحالي بالحرف).
function blocked(req, res) {
  return res.status(405).json({ ok: false, error: 'سجل النشاط append-only — لا تعديل ولا حذف.' });
}
router.put('/:id', blocked);
router.patch('/:id', blocked);
router.delete('/:id', blocked);

export default router;
