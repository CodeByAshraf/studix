// backend/src/routes/studentCreate.js
// ─────────────────────────────────────────────────────────────────────────────
// Production hardening pass — إنشاء طالب مباشر (POST /api/students)، مسار مخصّص
// يُعترَض قبل الـ CRUD العام لنفس /api/students بنفس تقنية examDeleteRouter/
// admissionActivationRouter (اعتراض حسب method+path، مركَّب قبل الحلقة الديناميكية).
//
// السبب: العميل كان يحسب students.code محلياً (existingStudents.length + 1) — عدّاد
// غير موثوق (يتأثر بالحذف/الحالة القديمة/التزامن). students.code UNIQUE. الحل: نفس
// computeNextStudentCode المُستخدَمة بالفعل لتفعيل القبول (backend/src/lib/studentCode.js)،
// مع إعادة محاولة عند تعارض P2002 على code تحديداً — نفس نمط computeNextSeq/
// isP2002OnNumber في materialDistribution.js بالضبط (لا معاملة صريحة هنا: صفّ واحد،
// لا كتابة مركّبة تحتاج ذرّية عبر جداول — إعادة المحاولة عند التعارض كافية ومطابقة
// للسابقة الموجودة فعلاً لنمط مشابه).
//
// الحقول الأخرى (name/phone/parentId/parentPhone/grade/groupId/school/notes/status/
// monthlyFee/id) تمرّ عبر prepareWriteData (crud.js) — نفس منطق الـ CRUD العام
// بالضبط (camelCase→snake_case، إسقاط الحقول المُدارة، الاحتفاظ بـ id العميل)، بلا
// أي تكرار لتلك الخوارزمية هنا.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import crypto from 'crypto';
import { runInTransaction } from '../lib/transaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';
import { prepareWriteData } from './crud.js';
import { computeNextStudentCode } from '../lib/studentCode.js';

// نفس تسلسل BigInt→نص المكرَّر عمداً في crud.js/admissionActivation.js/payments.js —
// لا util مشترك في هذا المشروع (قرار سابق، غير مُعاد فتحه هنا).
function serializeBigInt(input) {
  if (typeof input === 'bigint') return input.toString();
  if (Array.isArray(input)) return input.map(serializeBigInt);
  if (input !== null && typeof input === 'object' && typeof input.toJSON !== 'function') {
    const out = {};
    for (const [k, v] of Object.entries(input)) out[k] = serializeBigInt(v);
    return out;
  }
  return input;
}

function isCodeConflict(err) {
  return err?.code === 'P2002' && Array.isArray(err?.meta?.target) && err.meta.target.includes('code');
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// students.enroll_date هو @db.Date — Prisma يرفض نصاً "YYYY-MM-DD" وحده (يتوقّع ISO-8601
// DateTime كاملاً)، ويُنتِج ذلك PrismaClientValidationError خام (بلا code) يصل كـ 500 عام
// عبر errorHandler.js. الفرونت-إند (src/services/api.js toRequestDate) يُطبِّع مسبقاً قبل
// الإرسال، لكن هذا مسار مخصّص (لا الـ CRUD العام) فيبقى التحقّق هنا أيضاً دفاعاً في العمق
// لأي مستدعٍ آخر (اختبار مباشر/عميل غير الواجهة) — نفس نمط تطبيع "YYYY-MM-DD" المستخدَم
// فعلاً في attendanceSessions.js (dateObj = new Date(`${date}T00:00:00.000Z`))، بمنتصف
// ليل UTC صراحةً حتى لا ينزاح التاريخ التقويمي المقصود بفعل توقيت الخادم المحلي.
function normalizeEnrollDate(value) {
  if (value === undefined || value === null || value === '') return value;
  const asIso = typeof value === 'string' && DATE_ONLY_RE.test(value) ? `${value}T00:00:00.000Z` : value;
  const parsed = asIso instanceof Date ? asIso : new Date(asIso);
  if (Number.isNaN(parsed.getTime())) throw badRequest('تاريخ التسجيل (enrollDate) غير صالح.');
  return parsed;
}

const MAX_CODE_ATTEMPTS = 3;

// مفتاح قفل استشاري (pg_advisory_xact_tx_lock) مخصّص لتخصيص students.code — يتبع نفس تسلسل
// الثوابت العشوائية بلا معنى خاص المستخدَمة فعلاً في db/migrationRunner.js (7727727)/
// db/bootstrapDatabase.js (7727728)/db/firstAdmin.js (7727729)، مفتاح مختلف هنا عمداً لتجنّب
// أي تصادم معها. نطاق-معاملة (xact) لا نطاق-جلسة (session) عمداً: يُحرَّر تلقائياً عند
// commit/rollback المعاملة، فلا حاجة لإلغاء قفل يدوي ولا خطر ارتباط بجلسة اتصال قد يُعاد
// تدويرها بشكل مختلف (خلافاً لـ pg_advisory_lock/pg_try_advisory_lock المستخدَمة في db/).
const STUDENT_CODE_ADVISORY_LOCK_KEY = 7727730;

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth، بنفس مبدأ
// activateAdmission/createPayment/reverseTreasuryTxn.
export async function createStudentDirect(body) {
  const { data, fields } = prepareWriteData('students', body);
  const idField = fields.find((f) => f.isId);
  // نفس منطق preserveClientId الحالي لـ students في crud.js بالضبط — لا نغيّره هنا.
  const clientId = idField && !idField.hasDefaultValue && typeof body?.id === 'string' ? body.id.trim() : '';
  data.id = clientId || crypto.randomUUID();
  if ('enroll_date' in data) data.enroll_date = normalizeEnrollDate(data.enroll_date);

  let lastErr;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    try {
      const row = await runInTransaction(async (tx) => {
        // جذر السباق الفعلي (تأكَّد بتشغيل اختبار التزامن الحقيقي): computeNextStudentCode
        // كانت تُقرَأ خارج أي قفل — طلبات متزامنة عديدة تقرأ نفس MAX(code) قبل أن يُثبِّت
        // أيٌّ منها شيئاً، فتحسب جميعها نفس الكود التالي وتتصادم على UNIQUE، وإعادة
        // المحاولة عند P2002 لا تحلّ ذلك لأن الخاسرين المتعدّدين يعيدون نفس السباق مع
        // بعضهم البعض عند كل محاولة تالية أيضاً (لا تقدُّم مضمون لكل محاولة تحت تزامن
        // كافٍ — رفع MAX_CODE_ATTEMPTS يقلّل الاحتمال فقط، لا يُصلح السبب). الإصلاح:
        // قفل استشاري على نطاق المعاملة يُسلسِل حساب الكود + الإدراج بالكامل بين كل
        // الطلبات المتزامنة — فقط حامل القفل يقرأ MAX ويكتب في كل مرة، والبقية تُحجَب
        // خلفه بدل أن تتسابق. نفس مبدأ تسليل UPDATE عبر WHERE في admissionActivation.js
        // (سطر 129 هناك) لكن بأداة مختلفة لأن هذا إدراج (لا صف موجود بعد لقفله بـ FOR UPDATE).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${STUDENT_CODE_ADVISORY_LOCK_KEY})`;
        // مصدر الحقيقة الوحيد لـ code: يُحسَب هنا من جهة الخادم دائماً، حتى لو أرسل
        // العميل قيمة (تُتجاهَل — لا نقرأها من body أعلاه إطلاقاً بعد هذا السطر).
        data.code = await computeNextStudentCode(tx);
        return tx.students.create({ data });
      });
      return serializeBigInt(snakeToCamel(row));
    } catch (err) {
      if (!isCodeConflict(err) || attempt === MAX_CODE_ATTEMPTS - 1) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

const router = Router();

router.post('/', asyncHandler(async (req, res) => {
  const data = await createStudentDirect(req.body);
  res.status(201).json({ ok: true, data });
}));

export default router;
