// backend/src/server.js
// ═══════════════════════════════════════════════════════════════════════════
// Studix Backend — Express + Prisma فوق PostgreSQL (studix).
// Phase 2: يفعّل GET دائماً لكل الجداول الـ 25، ويفعّل الكتابة
// (POST/PUT/PATCH/DELETE) فقط للـ 21 collection غير المالية. الـ 4 المالية/الدفعات
// (payments, treasuryTxn, cashboxes, admissionPayments) تبقى read-only (405 للكتابة)
// — لا معاملات ذرّية مالية بعد. لا تعديل قاعدة البيانات، لا migration.
// Phase 3B-14A: cashboxes أصبحت writable عبر الـ CRUD العام (لا FK لها، لا trigger،
// لا تعارض مفردات CHECK) — أول collection مالية تُفعَّل. DELETE محظور صراحةً لها فقط
// (انظر الاعتراض أسفل، قبل الحلقة الديناميكية) لأن makeCrudRouter لا يفصل بين الأفعال.
// Phase 3B-14B: treasuryTxn أصبحت writable — POST (إدخال يدوي) عبر الـ CRUD العام بعد
// حقن created_by؛ العكس/التحويل عبر مسارين ذرّيين مخصّصين (treasuryTxn.js). payments/
// admissionPayments تبقيان read-only — خارج نطاق 3B-14B، مرحلتا 3B-14C/D القادمتان.
// ═══════════════════════════════════════════════════════════════════════════
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import healthRouter from './routes/health.js';
import sessionRouter from './routes/session.js';
import { makeCrudRouter } from './routes/crud.js';
import attendanceSessionsRouter from './routes/attendanceSessions.js';
import examDeleteRouter from './routes/examDelete.js';
import examGradesRouter from './routes/examGrades.js';
import homeworkDeleteRouter from './routes/homeworkDelete.js';
import hwSubmissionsRouter from './routes/hwSubmissions.js';
import centerProfileRouter from './routes/centerProfile.js';
import materialDistributionRouter from './routes/materialDistribution.js';
import admissionActivationRouter from './routes/admissionActivation.js';
import treasuryTxnRouter from './routes/treasuryTxn.js';
import paymentsRouter from './routes/payments.js';
import admissionPaymentsRouter from './routes/admissionPayments.js';
import admissionCancellationRouter from './routes/admissionCancellation.js';
import activityLogsInterceptor from './routes/activityLogs.js';
import usersRouter from './routes/users.js';
import rolesRouter from './routes/roles.js';
import { COLLECTION_MODELS } from './routes/collections.js';
import { notFound, errorHandler, asyncHandler } from './middleware/errorHandler.js';
import { requireAuth } from './middleware/auth.js';
import { requirePermission } from './middleware/permissions.js';
import { prisma, checkDbConnection } from './prisma.js';
import { runMigrations } from './db/migrationRunner.js';
import { createPreMigrationBackup } from './db/backup.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Desktop runtime preparation — تطبيق سطح مكتب محلي لكل معلّم (لا reverse proxy، لا
// نشر سحابي): الباك-إند يخدم الفرونت-إند المبنيّ (dist/) مباشرة بدل الاعتماد على Vite
// dev server منفصل — عملية واحدة، منفذ واحد، أصل واحد (لا CORS/كوكي عابر للأصل إطلاقاً).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', '..', 'dist');

// الـ 2 collections المالية/دفعات القبول المتبقية — تبقى read-only حتى إشعار آخر (خارج
// نطاق Phase 2). Phase 3B-14A: أزيلت cashboxes. Phase 3B-14B: أزيلت treasuryTxn —
// POST (إدخال يدوي بسيط، صفّ واحد) يمرّ عبر الـ CRUD العام بعد اعتراض حقن created_by
// (انظر treasuryTxn.js)؛ العكس والتحويل (كتابات مركّبة متعدّدة الصفوف) لهما مساران
// ذرّيان مخصّصان في treasuryTxn.js، مركَّبان قبل الحلقة الديناميكية أدناه. payments/
// admissionPayments تبقيان بلا أي تغيير — خارج نطاق Phase 3B-14B تماماً.
const READ_ONLY_COLLECTIONS = new Set(['payments', 'admissionPayments']);

// Stabilization phase (Authorization & Identity contract) — كل collection مربوطة
// بمفتاح صلاحية واحد (pageId) يطابق تماماً نموذج INITIAL_ROLES/roles.permissions
// المُدقَّق في migration/reports/POST_MIGRATION_STABILIZATION_AUTH_CONTRACT.md، وليس
// بمصفوفة "admin فقط" ثنائية كما كان سابقاً. requirePermission (middleware/
// permissions.js) يقرأ الصلاحيات من Postgres حصراً (عبر الكاش) — fail-closed، لا
// "null = وصول كامل" لأي دور بما في ذلك admin (admin له صلاحياته الصريحة الآن أيضاً).
// parents لا صفحة مخصّصة لها — تُربَط بصلاحية 'students' (القرار المعتمَد رقم 1)، وهي
// الوحيدة هنا التي لا يطابق مفتاحها اسم الـ collection نفسه.
const COLLECTION_PERMISSIONS = {
  parents: 'students',
  students: 'students',
  groups: 'groups',
  teachers: 'users',
  exams: 'exams',
  homeworks: 'homework',
  centerProfile: 'settings',
  cashboxes: 'treasury',
  treasuryTxn: 'treasury',
  payments: 'payments',
  attendance: 'attendance',
  absenceFollowup: 'attendance',
  grades: 'exams',
  hwSubmissions: 'homework',
  invMaterials: 'materials',
  inventoryTxn: 'materials',
  inventorySettings: 'materials',
  admissions: 'admissions',
  admissionPayments: 'admissions',
  admissionFollowups: 'admissions',
  admissionSystemLog: 'admissions',
  communications: 'students',
  commTasks: 'students',
  activityLogs: 'activity-log',
  waReportLog: 'students',
};

// Phase 3B-2A/3B-3: students و groups فقط يحتفظان بـ id الذي يُرسله العميل عند الإنشاء
// (بدل UUID دائماً) — يمنع فقدان الربط مع سجلات محلية أخرى (attendance/payments/exams/
// homeworks/communications/admissions) ما زالت تشير لنفس الـ id القديم لهذا الطالب/المجموعة.
// Phase 3B-13A: نفس السبب بالضبط لـ admissions — admissionFollowups/admissionSystemLog
// المحليان (وadmissionPaymentsLocal المحلي البحت) يُنشَآن أحياناً مرتبطين بـ id القبول
// المحلي (adm_${Date.now()}) قبل أي تأكيد من الخادم؛ الاحتفاظ به يمنع فقدان هذا الربط.
// لا يُغيَّر سلوك أي collection أخرى.
// Phase 3B-14A: cashboxes أُضيفت — يحتفظ بالـ id المحلي (خاصة الخزنة الافتراضية المزروعة
// cb_main) بدل UUID دائماً، بقرار صريح: تجنّب أي تسوية/ترحيل لمرة واحدة لهذا الصف.
const PRESERVE_CLIENT_ID_COLLECTIONS = new Set(['students', 'groups', 'admissions', 'cashboxes']);

// أصل الفرونت-إند المحلي فقط — credentials:true مطلوب لإرسال/استقبال كوكي الجلسة HttpOnly
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: '5mb' }));

// ── تقديم الفرونت-إند المبنيّ (dist/) كملفات ثابتة — يشمل / تلقائياً (index.html) ──
// الرد السابق هنا (JSON "معلومات خدمة") أصبح دون فائدة عمداً — لا واجهة/اختبار كان
// يعتمد عليه (تحقّقنا)، وأي طلب GET / يجب أن يُعيد الفرونت-إند الفعلي الآن، لا JSON.
app.use(express.static(DIST_DIR));

app.use('/health', healthRouter);

// ── مصادقة (Phase 3A) — لا تتطلّب جلسة سابقة بطبيعتها ──
app.use('/api/session', sessionRouter);
// أداة ترحيل حساب المدير الأول: أُزيلت في Phase 3B-1 بعد اكتمال الترحيل
// (users=1 فعلياً، ولا كود frontend/production يستخدمها — انظر تقرير Phase 3B-1).

// ── Phase 3B-4 (تحضيري): استبدال جلسة حضور كاملة بمعاملة ذرّية واحدة ──
// مسار منفصل عن /api/attendance العام (makeCrudRouter) لأن SessionMarking يحفظ
// حضور مجموعة كاملة كعملية منطقية واحدة، لا سجلاً واحداً. لا يغيّر READ_ONLY_COLLECTIONS
// ولا سلوك أي مسار مالي.
app.use('/api/attendance-sessions', requireAuth, requirePermission('attendance'), attendanceSessionsRouter);

// ── Phase 3B-5: حذف امتحان مع كل درجاته بمعاملة ذرّية واحدة ──
// يُعترَض هنا فقط DELETE /api/exams/:id — نفس تقنية الاعتراض حسب method+path المستخدَمة
// في Phase 3B-4 (attendance)، بفارق أنه هنا نفس المسار العام /api/exams، مركَّب قبل
// الـ CRUD العام في الحلقة أدناه. أي GET/POST/PUT على /api/exams لا يطابق أي route هنا
// (الراوتر يعرّف DELETE فقط) فيمرّ تلقائياً للـ CRUD العام كما هو دون أي تغيير.
app.use('/api/exams', requireAuth, requirePermission('exams'), examDeleteRouter);

// ── Phase 3B-5: استبدال درجات امتحان كامل بمعاملة ذرّية واحدة ──
// مسار منفصل عن /api/grades العام لنفس سبب /api/attendance-sessions — GradeEntry
// يحفظ درجات roster كامل كعملية منطقية واحدة، لا سجلاً واحداً.
app.use('/api/exam-grades', requireAuth, requirePermission('exams'), examGradesRouter);

// ── Phase 3B-6: حذف واجب مع كل سجلات تسليمه بمعاملة ذرّية واحدة ──
// نفس تقنية /api/exams أعلاه: يُعترَض هنا فقط DELETE /api/homeworks/:id، بقية الأفعال
// تمرّ للـ CRUD العام دون تغيير.
app.use('/api/homeworks', requireAuth, requirePermission('homework'), homeworkDeleteRouter);

// ── Phase 3B-6: استبدال حالات تسليم واجب كامل بمعاملة ذرّية واحدة ──
// مسار منفصل عن /api/hwSubmissions العام لنفس سبب /api/exam-grades.
app.use('/api/hw-submissions', requireAuth, requirePermission('homework'), hwSubmissionsRouter);

// ── Phase 3B-10: تحديث centerProfile (سجل وحيد id=1) عبر مسار مخصّص ──
// يُعترَض هنا فقط PUT /api/centerProfile (بلا :id) — الـ CRUD العام لا يعرّف PUT على
// الجذر (فقط PUT /:id)، فلا تعارض؛ GET /api/centerProfile (قائمة) يمرّ كما هو للـ CRUD
// العام أدناه دون أي تغيير، بنفس تقنية الاعتراض حسب method+path المستخدَمة أعلاه.
// نفس حراسة centerProfile الحالية في ADMIN_ONLY_COLLECTIONS (requireAuth + admin).
app.use('/api/centerProfile', requireAuth, requirePermission('settings'), centerProfileRouter);

// ── Phase 3B-12: تسوية توزيع مذكرة كامل (roster) بمعاملة ذرّية واحدة ──
// مسار جديد كلياً /api/material-distributions — لا يتقاطع مع /api/inventoryTxn العام
// (يبقى كما هو، دون تغيير، لقراءة GET فقط). requireAuth فقط — نفس حراسة invMaterials
// الحالية، بلا دور إضافي.
app.use('/api/material-distributions', requireAuth, requirePermission('materials'), materialDistributionRouter);

// ── Phase 3B-13B (Stage ii): تفعيل سجل قبول (طالب + admissions + سجل نظامي) بمعاملة
// ذرّية واحدة ──
// يُعترَض هنا فقط PUT /api/admissions/:id/activate (segmentان بعد /api/admissions) —
// الـ CRUD العام يعرّف فقط PUT /api/admissions/:id (segment واحد)، فلا تعارض إطلاقاً؛
// أي مسار آخر على /api/admissions (GET/POST/PUT /:id العادي) يمرّ دون أي تغيير للحلقة
// الديناميكية أدناه. نفس حراسة admissions الحالية (requireAuth فقط، بلا دور إضافي).
app.use('/api/admissions', requireAuth, requirePermission('admissions'), admissionActivationRouter);

// ── Phase 3B-14D: إلغاء حجز + استرداد كل دفعاته، بمعاملة ذرّية واحدة ──
// يُعترَض هنا فقط PUT /api/admissions/:id/cancel-with-refund (segmentان بعد الـ id) —
// لا تعارض مع admissionActivationRouter أعلاه (/:id/activate) ولا مع الـ CRUD العام
// (PUT /:id، segment واحد). ملف منفصل عمداً عن admissionActivation.js — مسؤولية واحدة
// لكل ملف (نفس نمط examDelete.js/examGrades.js الحالي).
app.use('/api/admissions', requireAuth, requirePermission('admissions'), admissionCancellationRouter);

// ── Phase 3B-14A: منع DELETE عن cashboxes فقط، بلا التأثير على أي فعل آخر ──
// قرار تفتيش/قرار Phase 3B-14A الصريح: لا واجهة مستخدم فعلية تحذف خزنة اليوم
// (removeCashbox معرَّف في الفرونت-إند لكن غير مستدعى إطلاقاً)، ولا يجوز أن يصبح حذف
// بيانات مالية أساسية متاحاً بمجرّد تفعيل الكتابة على هذه الـ collection. makeCrudRouter
// (crud.js) لا يفصل بين الأفعال — writable=true يفعّل POST/PUT/PATCH/DELETE معاً بلا
// تفريق، وتعديل crud.js نفسه ممنوع صراحةً بقرار هذا التقرير. نفس تقنية الاعتراض حسب
// method+path المستخدَمة أعلاه لـ exams/homeworks، بفارق أنها هنا تمنع فعلاً واحداً فقط
// (DELETE) بدل توجيه كامل — GET/POST/PUT/PATCH على /api/cashboxes تمرّ دون أي تغيير
// للحلقة الديناميكية أدناه، التي تتولّى تفعيلها فعلياً عبر الـ CRUD العام كالمعتاد.
app.use('/api/cashboxes', requireAuth, requirePermission('treasury'), (req, res, next) => {
  if (req.method === 'DELETE') {
    return res.status(405).json({ ok: false, error: 'حذف الخزن غير متاح حالياً.' });
  }
  next();
});

// ── Phase 3B-14B: treasury_txn — عكس/تحويل ذرّيان مخصّصان + حقن created_by + حظر
// PUT/PATCH/DELETE على /:id ──
// treasuryTxn.js يتولّى كل شيء تحتاجه هذه الـ collection غير القابل للـ CRUD العام
// وحده: PUT /:id/reverse وPOST /transfer (كتابات مركّبة متعدّدة الصفوف تحتاج معاملة
// واحدة)، اعتراض POST / لحقن created_by=req.user.id (crud.js لا يملك أي آلية لحقن
// قيمة من الجلسة، وتعديله ممنوع صراحةً)، وحظر PUT/PATCH/DELETE على /:id (لا مسار
// تعديل حقول حيّ اليوم — updateTreasuryTxn المحلي غير مستخدَم إطلاقاً؛ الحذف محظور
// مضاعفاً: trg_no_delete_treasury في القاعدة أصلاً بلا استثناء، هذا الحارس يضيف 405
// واضحاً عند حدود الـ API بدل استثناء القاعدة الخام). GET وPOST / (بعد الاعتراض) يمرّان
// دون تغيير للحلقة الديناميكية أدناه، التي تتولّى POST / فعلياً عبر الـ CRUD العام —
// treasuryTxn ليست في PRESERVE_CLIENT_ID_COLLECTIONS، فتولّد UUID خادمياً دائماً.
app.use('/api/treasuryTxn', requireAuth, requirePermission('treasury'), treasuryTxnRouter);

// ── Phase 3B-14C: payments — إنشاء/استرداد ذرّيان مخصّصان + حظر PUT/PATCH/DELETE ──
// payments.js يتولّى كل كتابة حقيقية لهذه الـ collection: POST / (إنشاء دفعة + حركة
// treasury_txn المرتبطة معاً، معاملة واحدة)، POST /:id/refund (استرداد ذرّي، الدفعة
// نفسها لا تُعدَّل أبداً)، وحظر PUT/PATCH/DELETE على /:id (405 — الدفعات سجلات ثابتة،
// والحذف محظور مضاعفاً: trg_no_delete_payments في القاعدة الآن أيضاً بلا استثناء، نفس
// نمط treasury_txn). payments تبقى عمداً ضمن READ_ONLY_COLLECTIONS أدناه — دفاعٌ في
// العمق تحت هذا الملف فقط؛ الـ CRUD العام لا يكتب لها من أي مسار آخر مطلقاً. GET يمرّ
// دون تغيير للحلقة الديناميكية أدناه كالمعتاد (READ_ONLY_COLLECTIONS يحجب غير GET فقط).
app.use('/api/payments', requireAuth, requirePermission('payments'), paymentsRouter);

// ── Phase 3B-14D: admissionPayments — إنشاء ذرّي (خطوتان فقط، لا رابط عكسي على
// treasury_txn) + حظر PUT/PATCH/DELETE ──
// admissionPayments تبقى عمداً ضمن READ_ONLY_COLLECTIONS أدناه (دفاعٌ في العمق تحت هذا
// الملف فقط) — نفس منطق payments في 3B-14C بالضبط.
app.use('/api/admissionPayments', requireAuth, requirePermission('admissions'), admissionPaymentsRouter);

// ── Phase 3B-15: activity_logs — حقن user_id/user_name من الجلسة + حظر PUT/PATCH/DELETE ──
// لا مسار ذرّي مخصّص هنا (بعكس كل ما سبق في 3B-14): سجل نشاط واحد مستقل، لا كتابة
// مركّبة تمسّ أكثر من جدول تحتاج معاملة واحدة. المنطق في backend/src/routes/
// activityLogs.js (مُصدَّر منفصلاً، قابل للاختبار مباشرة).
app.use('/api/activityLogs', requireAuth, requirePermission('activity-log'), asyncHandler(activityLogsInterceptor));

// ── Stabilization phase: أول مسارات خلفية حقيقية لـ users/roles ──
// إدارية بحتة، 'users' هي الصلاحية الوحيدة التي يملكها admin فقط في نموذج الأدوار
// الأربعة الحالي — لا Teachers domain migration هنا، جدول teachers يبقى فارغاً.
app.use('/api/users', requireAuth, requirePermission('users'), usersRouter);
app.use('/api/roles', requireAuth, requirePermission('users'), rolesRouter);

// ── تفعيل routes ديناميكياً (يتخطّى أي model ناقص بأمان) ──
// كل /api/<collection> يتطلّب جلسة مصادَق عليها (requireAuth) — GET شاملاً — بالإضافة
// إلى requirePermission(pageId) المشتقّ من COLLECTION_PERMISSIONS أعلاه (Stabilization
// phase). الدور/الصلاحيات تُقرأ حصراً من Postgres عبر الكاش (authCache.js)، لا من
// body/query/headers الطلب أبداً.
const activated = [];
const skipped = [];
for (const [apiPath, modelName] of Object.entries(COLLECTION_MODELS)) {
  if (prisma[modelName]) {
    const writable = !READ_ONLY_COLLECTIONS.has(apiPath);
    const preserveClientId = PRESERVE_CLIENT_ID_COLLECTIONS.has(apiPath);
    const pageId = COLLECTION_PERMISSIONS[apiPath];
    const guards = pageId ? [requireAuth, requirePermission(pageId)] : [requireAuth];
    app.use(`/api/${apiPath}`, ...guards, makeCrudRouter(modelName, { writable, preserveClientId }));
    activated.push(`${apiPath}${writable ? '' : ' (read-only)'}${pageId ? ` (permission: ${pageId})` : ' (⚠ no permission mapped)'}`);
  } else {
    skipped.push(apiPath);
  }
}

// ── SPA fallback: أي GET لا يطابق ملفاً ثابتاً (express.static أعلاه) ولا مساراً حقيقياً
// تحت /api أو /health يُعاد له index.html — يسمح لـ React Router (BrowserRouter، مسارات
// حقيقية مثل /students) أن يتولّى التوجيه من جهة العميل عند تحديث الصفحة أو فتح رابط
// مباشر. يستثني /api/* و/health صراحة (next()) — تُعاد لمعالج notFound الحقيقي أدناه
// لو لم تطابق أي مسار API حقيقي، بدل أن تُبتلَع وتُعاد كـ HTML خطأً.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/health') return next();
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// ── معالجة الأخطاء ──
app.use(notFound);
app.use(errorHandler);

// ── Database Update/Migration System (Phase 1) — يُشغَّل قبل app.listen() مباشرة، دائماً،
// كل إقلاع (idempotent — no-op سريع لو لا ترحيلات معلَّقة). runMigrations يرمي استثناءً
// عند أي فشل (نسخة احتياطية فاشلة، checksum متعارض، ترحيل فشل ورجع بالكامل) — الخادم لا
// يستدعي app.listen() أبداً في هذه الحالة، فلا يخدم أي طلب فوق قاعدة في حالة غير معروفة. ──
try {
  const migrationResult = await runMigrations(prisma, { backup: createPreMigrationBackup });
  if (migrationResult.action === 'stamped') {
    console.log(`✅ تثبيت جديد — سُجِّلت الإصدارات [${migrationResult.versions.join(', ')}] كمُطبَّقة (بلا تنفيذ SQL).`);
  } else if (migrationResult.action === 'migrated') {
    console.log(`✅ تم تطبيق ترحيلات جديدة: [${migrationResult.versions.join(', ')}] (نسخة احتياطية: ${migrationResult.backupPath})`);
  } else {
    console.log('✅ قاعدة البيانات محدَّثة بالفعل — لا ترحيلات معلَّقة.');
  }
} catch (err) {
  console.error(`\n❌ فشل نظام الترحيل: ${err.message}`);
  console.error('تم إيقاف بدء التشغيل — لم يُشغَّل الخادم.\n');
  process.exit(1);
}

// Desktop runtime preparation — ربط صريح بـ 127.0.0.1 فقط (لا 0.0.0.0 الافتراضي) —
// تطبيق محلي بحت لكل جهاز معلّم، لا وصول شبكي من أي جهاز آخر مطلوباً أو مرغوباً إطلاقاً.
app.listen(PORT, '127.0.0.1', async () => {
  console.log(`\n🚀 Studix backend (Phase 2 — ${activated.filter((a) => !a.includes('read-only')).length} writable + ${activated.filter((a) => a.includes('read-only')).length} read-only) على http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   ✅ routes مفعّلة (${activated.length}): ${activated.join(', ')}`);
  if (skipped.length) {
    console.log(`   ⚠️  models غير موجودة (${skipped.length}): ${skipped.join(', ')}`);
    console.log(`      (عدّل أسماءها في src/routes/collections.js لو مختلفة بعد db pull)`);
  }

  const db = await checkDbConnection();
  console.log(db.connected
    ? '✅ الاتصال بقاعدة PostgreSQL (studix) ناجح.\n'
    : `⚠️  تعذّر الاتصال بقاعدة البيانات: ${db.error}\n`);
});
