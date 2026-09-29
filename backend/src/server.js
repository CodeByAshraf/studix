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
// Phase 6b — MUST stay the very first import in this file. lib/config.js's job is to load
// environment variables (production config path if present, else backend/.env as before) —
// its side effect must run before anything else in this file's import graph, because
// lib/session.js and lib/supportSession.js (imported transitively below, via
// middleware/auth.js) read process.env.SESSION_SECRET at their own module top level. ES
// module imports fully evaluate a module before the importing module's own subsequent
// statements run, so the previous `dotenv.config()` call further down this file (after those
// imports) always ran too late for those two modules — verified and fixed here, see
// lib/config.js's own header comment for the full explanation. No signing/verification logic
// changed anywhere; only when the secret becomes available.
import './lib/config.js';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import healthRouter from './routes/health.js';
import sessionRouter from './routes/session.js';
import setupRouter from './routes/setup.js';
import { makeCrudRouter } from './routes/crud.js';
import attendanceSessionsRouter from './routes/attendanceSessions.js';
import attendanceRouter from './routes/attendance.js';
import recitationsRouter from './routes/recitations.js';
import examDeleteRouter from './routes/examDelete.js';
import examStartRouter from './routes/examStart.js';
import examGradesRouter from './routes/examGrades.js';
import gradesRouter from './routes/grades.js';
import homeworkDeleteRouter from './routes/homeworkDelete.js';
import groupDeleteRouter from './routes/groupDelete.js';
import studentDeleteRouter from './routes/studentDelete.js';
import hwSubmissionsRouter from './routes/hwSubmissions.js';
import hwSubmissionsScopedGetRouter from './routes/hwSubmissionsScopedGet.js';
import homeworksScopedGetRouter from './routes/homeworksScopedGet.js';
import centerProfileRouter from './routes/centerProfile.js';
import materialDistributionRouter from './routes/materialDistribution.js';
import inventoryTxnRouter from './routes/inventoryTxn.js';
import studentReportRouter from './routes/studentReport.js';
import { studentEnrollmentsRouter, enrollmentRouter } from './routes/enrollments.js';
import communicationsRouter from './routes/communications.js';
import admissionActivationRouter from './routes/admissionActivation.js';
import studentCreateRouter from './routes/studentCreate.js';
import treasuryTxnRouter from './routes/treasuryTxn.js';
import waReportLogRouter from './routes/waReportLog.js';
import cashboxBalanceRouter from './routes/cashboxBalance.js';
import cashboxOptionsRouter, { CASHBOX_OPTION_PERMISSIONS } from './routes/cashboxOptions.js';
import groupOptionsRouter, { GROUP_OPTION_PERMISSIONS } from './routes/groupOptions.js';
import paymentsRouter from './routes/payments.js';
import admissionPaymentsRouter from './routes/admissionPayments.js';
import admissionCancellationRouter from './routes/admissionCancellation.js';
import activityLogsRouter, { activityLogsGuard } from './routes/activityLogs.js';
import usersRouter from './routes/users.js';
import rolesRouter from './routes/roles.js';
import supportAccessRouter from './routes/supportAccess.js';
import licenseRouter from './routes/license.js';
import dbSwitchRouter from './routes/dbSwitch.js';
import dbIdentityRouter from './routes/dbIdentity.js';
import backupStatusRouter from './routes/backupStatus.js';
import { COLLECTION_MODELS } from './routes/collections.js';
import { CRUD_POLICIES } from './routes/crudPolicies.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { requireAuth, requireRole } from './middleware/auth.js';
import { requirePermission, requireAnyPermission } from './middleware/permissions.js';
import { requireActivation } from './middleware/activation.js';
import { prisma, checkDbConnection } from './prisma.js';
import { checkMigrationsUpToDate } from './db/migrationRunner.js';
import logger from './lib/logger.js';
import { validateDatabaseUrl, describeStartupFailure } from './lib/startupErrors.js';
import { createGracefulShutdown, registerShutdownHandlers, registerFatalErrorHandlers } from './lib/shutdown.js';

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

// ── Phase 5b: Licensing enforcement — عالمياً، مبكراً، قبل أي شيء آخر تحت /api/ ──
// (الشرح الكامل + القائمة البيضاء في middleware/activation.js). يستثني تلقائياً أي طلب
// ليس تحت /api/ (الملفات الثابتة أدناه، مسارات SPA، /health) — لا يؤثّر على تحميل
// الصفحة نفسها إطلاقاً، فقط على استدعاءات API الفعلية. لا يعتمد على requireAuth، فترتيبه
// بالنسبة له غير مهمّ.
app.use(requireActivation);

// ── تقديم الفرونت-إند المبنيّ (dist/) كملفات ثابتة — يشمل / تلقائياً (index.html) ──
// الرد السابق هنا (JSON "معلومات خدمة") أصبح دون فائدة عمداً — لا واجهة/اختبار كان
// يعتمد عليه (تحقّقنا)، وأي طلب GET / يجب أن يُعيد الفرونت-إند الفعلي الآن، لا JSON.
app.use(express.static(DIST_DIR));

app.use('/health', healthRouter);

// ── مصادقة (Phase 3A) — لا تتطلّب جلسة سابقة بطبيعتها ──
app.use('/api/session', sessionRouter);
// أداة ترحيل حساب المدير الأول: أُزيلت في Phase 3B-1 بعد اكتمال الترحيل
// (users=1 فعلياً، ولا كود frontend/production يستخدمها — انظر تقرير Phase 3B-1).

// ── INSTALL-04: الإعداد الأولي (First-Run Setup) — لا تتطلّب جلسة سابقة بطبيعتها، ولا
// requireAuth/requirePermission: db/firstAdmin.js يفرض قفله الخاص (صفر مدير نشط) داخلياً،
// مستقلاً تماماً عن أي حارس هنا. مُستثنًى من requireActivation أعلاه صراحة (middleware/
// activation.js) لنفس سبب استثناء /api/license بالضبط.
app.use('/api/setup', setupRouter);

// ── Phase 3B-4 (تحضيري): استبدال جلسة حضور كاملة بمعاملة ذرّية واحدة ──
// مسار منفصل عن /api/attendance العام (makeCrudRouter) لأن SessionMarking يحفظ
// حضور مجموعة كاملة كعملية منطقية واحدة، لا سجلاً واحداً. لا يغيّر READ_ONLY_COLLECTIONS
// ولا سلوك أي مسار مالي.
app.use('/api/attendance-sessions', requireAuth, requirePermission('attendance'), attendanceSessionsRouter);

// ── Recitation Assessment Phase 2 — تقييم تسميع لكل طالب حاضر ضمن جلسة حضور مكتملة
// موجودة بالفعل. صلاحية مخصَّصة ومنفصلة تماماً عن 'attendance' (قرار منتج صريح) —
// لا تُمنَح تلقائياً لأي دور/مستخدم موجود، فتفشل مغلقة (403) لكل مستخدم حتى يُمنَحها
// مدير صراحةً عبر شاشة الأدوار — نفس آلية requirePermission العامة، بلا أي استثناء هنا.
app.use('/api/recitation-sessions', requireAuth, requirePermission('recitation'), recitationsRouter);

// ── C4 Attendance migration Phase 1 — scoped GET /api/attendance?studentId=&groupId=&
// date=&status= + GET /api/attendance/aggregate?groupBy= ──
// مسار مخصَّص، مُركَّب قبل الحلقة الديناميكية (نفس نمط communications.js/payments.js
// بالضبط)، نفس صلاحية 'attendance' الحالية (COLLECTION_PERMISSIONS.attendance). يعرِّف
// فقط GET / وGET /aggregate — أي POST/PUT/PATCH/DELETE على /api/attendance يمرّ دون أي
// تغيير للحلقة الديناميكية أدناه (makeCrudRouter)، تماماً كما هو اليوم؛ لا تغيير على
// سلوك الكتابة إطلاقاً. لا مستهلك أمامي بعد يستخدم أياً من المسارين (Phase 1 هو الأساس
// الخلفي فقط — هجرة المستهلكين ومسألة PG_COLLECTIONS مؤجَّلتان لمراحل لاحقة).
app.use('/api/attendance', requireAuth, requirePermission('attendance'), attendanceRouter);

// ── Phase 3B-5: حذف امتحان مع كل درجاته بمعاملة ذرّية واحدة ──
// يُعترَض هنا فقط DELETE /api/exams/:id — نفس تقنية الاعتراض حسب method+path المستخدَمة
// في Phase 3B-4 (attendance)، بفارق أنه هنا نفس المسار العام /api/exams، مركَّب قبل
// الـ CRUD العام في الحلقة أدناه. أي GET/POST/PUT على /api/exams لا يطابق أي route هنا
// (الراوتر يعرّف DELETE فقط) فيمرّ تلقائياً للـ CRUD العام كما هو دون أي تغيير.
app.use('/api/exams', requireAuth, requirePermission('exams'), examDeleteRouter);

// ── Exams Phase 3D: بدء الامتحان (مؤقّت إداري فقط) ──
// يُعترَض هنا فقط POST /api/exams/:id/start — نفس تقنية الاعتراض حسب method+path أعلاه.
// GET/POST /api/exams (بلا id)/PUT/DELETE /api/exams/:id لا تطابق هذا الراوتر (يعرّف
// POST /:id/start فقط) فتمرّ تلقائياً كما هي.
app.use('/api/exams', requireAuth, requirePermission('exams'), examStartRouter);

// ── Phase 3B-5: استبدال درجات امتحان كامل بمعاملة ذرّية واحدة ──
// مسار منفصل عن /api/grades العام لنفس سبب /api/attendance-sessions — GradeEntry
// يحفظ درجات roster كامل كعملية منطقية واحدة، لا سجلاً واحداً.
app.use('/api/exam-grades', requireAuth, requirePermission('exams'), examGradesRouter);

// ── Phase 3B-6: حذف واجب مع كل سجلات تسليمه بمعاملة ذرّية واحدة ──
// نفس تقنية /api/exams أعلاه: يُعترَض هنا فقط DELETE /api/homeworks/:id، بقية الأفعال
// تمرّ للـ CRUD العام دون تغيير.
app.use('/api/homeworks', requireAuth, requirePermission('homework'), homeworkDeleteRouter);

// ── M2 (Group Options): GET /api/groups/options — id/name/grade/max/price/activeCount only,
// for the Admissions and Attendance group pickers. Mounted BEFORE every other /api/groups
// mount: the group-delete guard below applies requirePermission('groups') to all
// /api/groups/* requests, which would otherwise reject admissions/attendance users here.
// Any non-GET request falls through to those mounts, unchanged. ──
app.use('/api/groups/options', requireAuth, requireAnyPermission(...GROUP_OPTION_PERMISSIONS), groupOptionsRouter);

// ── Phase 2.1 (Homework behavioral cleanup): حارس الواجبات لحذف مجموعة، على الخادم ──
// يُعترَض هنا فقط DELETE /api/groups/:id — يرفض (409) لو كان لصفّ المجموعة واجبات، وإلا
// next() للـ CRUD العام كما هو. نفس صلاحية 'groups' التي تحرس الحذف العام نفسه — لا يتطلّب
// صلاحية 'homework' (انظر groupDelete.js).
app.use('/api/groups', requireAuth, requirePermission('groups'), groupDeleteRouter);

// M2/F3 — same guard for DELETE /api/students/:id: the related-record checks run on the server
// under the 'students' permission that already guards the delete (409 when anything is linked,
// otherwise next() to the generic CRUD delete, unchanged). See studentDelete.js.
app.use('/api/students', requireAuth, requirePermission('students'), studentDeleteRouter);

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

// ── State Synchronization Audit fix — POST يدوي لحركة مخزون (InventoryPage.jsx) ──
// مركَّب هنا، قبل الحلقة الديناميكية أدناه، فيُعالِج POST /api/inventoryTxn حصراً (توليد
// number الفريد بقفل استشاري — الـ CRUD العام لا يملك هذا المنطق). GET/PUT/PATCH/DELETE
// لنفس المسار تبقى دون أي تغيير — تُعالَج كما هي بالحلقة الديناميكية (makeCrudRouter)
// لأن هذا الـ router لا يُعرِّف أي معالج آخر غير POST /. نفس صلاحية 'materials' الحالية.
app.use('/api/inventoryTxn', requireAuth, requirePermission('materials'), inventoryTxnRouter);

// ── Scalability Architecture Phase 2: تقرير طالب واحد مُجمَّع من الخادم ──
// مسار مخصَّص GET /api/students/:studentId/report-data، مُركَّب قبل الحلقة الديناميكية
// (نفس نمط payments.js/materialDistribution.js) — لا يتقاطع مع /api/students العام
// (يبقى كما هو تماماً لقائمة/سجل الطلاب). نفس صلاحية 'students' المستخدَمة بالفعل لمسار
// /api/students وcollection communications.
app.use('/api/students', requireAuth, requirePermission('students'), studentReportRouter);

// ── Phase 3A (Multi-Group Enrollment — Enrollment API): dedicated, restricted route for
// student_group_enrollments — never exposed through the generic dynamic CRUD loop below
// (see enrollments.js's own header). Same mount pattern/permission as studentReportRouter
// immediately above (enrollments are a sub-resource of students, same 'students' permission
// key already gating /api/students itself).
//   - GET/POST /api/students/:studentId/enrollments (list active enrollments / add an
//     Additional Group) — two-segment path, no collision with the generic CRUD's single-
//     segment /api/students/:id.
//   - DELETE/PATCH /api/enrollments/:enrollmentId (withdraw an Additional Group / update its
//     attend_days-start_date-end_date) — a new top-level path, entirely separate from
//     /api/students.
//   - GET /api/enrollments?groupId= (active enrollments, optionally per group — the Groups
//     screen's membership source, same table as the attendance roster).
app.use('/api/students', requireAuth, requirePermission('students'), studentEnrollmentsRouter);
app.use('/api/enrollments', requireAuth, requirePermission('students'), enrollmentRouter);

// ── Scalability Architecture Phase 4 — scoped GET /api/communications?studentId=&groupId=
// ──
// مسار مخصَّص، مُركَّب قبل الحلقة الديناميكية (نفس نمط payments.js/studentReport.js)، نفس
// صلاحية collection communications الحالية (COLLECTION_PERMISSIONS.communications='students').
app.use('/api/communications', requireAuth, requirePermission('students'), communicationsRouter);

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

// ── Production hardening pass: إنشاء طالب مباشر بكود خادم-authoritative ──
// يُعترَض هنا فقط POST /api/students (segment واحد فقط) — نفس تقنية الاعتراض حسب
// method+path المستخدَمة أعلاه لـ exams/homeworks. GET/PUT/DELETE /api/students تمرّ
// دون أي تغيير للحلقة الديناميكية أدناه، التي تتولّاها كما هي اليوم (preserveClientId
// لا يزال مفعَّلاً هناك لـ GET/PUT). نفس حراسة students الحالية (requireAuth +
// requirePermission('students')).
app.use('/api/students', requireAuth, requirePermission('students'), studentCreateRouter);

// ── M2/F1: GET /api/cashboxes/options — id/name/active only, for the payment-flow cashbox
// pickers (payments, admission deposits, material payments). Mounted BEFORE the 'treasury'-
// guarded /api/cashboxes mounts below so this one path is reachable without Treasury access;
// any non-GET request here falls through to those mounts, unchanged. ──
app.use('/api/cashboxes/options', requireAuth, requireAnyPermission(...CASHBOX_OPTION_PERMISSIONS), cashboxOptionsRouter);

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

// ── Scalability Architecture Phase 3 (Treasury Safety Gate) — GET /api/cashboxes/:id/
// balance?asOf= ──
// مسار قراءة فقط مستقل تماماً عن TreasuryPage.jsx (لا يُستهلَك من أي واجهة بعد) — يحسب
// الرصيد من SQL aggregate بدل تحميل كل تاريخ الخزنة للمتصفح؛ لا تغيير على أي معاملة كتابة
// مالية قائمة (createPayment/refundPayment/reverseTreasuryTxn/transferBetweenCashboxes).
app.use('/api/cashboxes', requireAuth, requirePermission('treasury'), cashboxBalanceRouter);

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

// ── wa_report_log — author is server-derived (req.user.id), never client-supplied ──
// Same interceptor technique as treasuryTxn above: replaces/strips created_by, then next()
// to the generic CRUD below. Same 'students' permission as COLLECTION_PERMISSIONS.waReportLog.
app.use('/api/waReportLog', requireAuth, requirePermission('students'), waReportLogRouter);

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
// Scalability Architecture Phase 4 (activityLogs): GET / أصبحت مسار Router حقيقي (ترتيب
// timestamp DESC حتمي + عدّ كلي حقيقي)، مُركَّب هنا قبل الحلقة الديناميكية — نفس نمط
// payments.js/communications.js بالضبط، يستبدل GET العام غير المُرتَّب الذي كانت
// makeCrudRouter العامة تخدمه لهذا المسار سابقاً. POST/PUT/PATCH/DELETE كما كانت بالضبط
// (المنطق الكامل في backend/src/routes/activityLogs.js، مُصدَّر منفصلاً، قابل للاختبار
// مباشرة).
// M2/F2: activityLogsGuard — POST / (writing one's own audit entry) needs only a valid,
// current session; everything else still requires 'activity-log'. The generic CRUD mount
// for this path (loop below) uses the same guard, since it performs the actual insert.
app.use('/api/activityLogs', requireAuth, activityLogsGuard, activityLogsRouter);

// ── Stabilization phase: أول مسارات خلفية حقيقية لـ users/roles ──
// إدارية بحتة، 'users' هي الصلاحية الوحيدة التي يملكها admin فقط في نموذج الأدوار
// الأربعة الحالي — لا Teachers domain migration هنا، جدول teachers يبقى فارغاً.
app.use('/api/users', requireAuth, requirePermission('users'), usersRouter);
app.use('/api/roles', requireAuth, requirePermission('users'), rolesRouter);

// ── Phase 4b: Support Access — backend core (schema من Phase 4a) ──
// حارس أقوى عمداً من requirePermission العام: role === 'admin' حرفياً، لا مصفوفة
// صلاحيات قابلة للتفويض عبر شاشة الأدوار (على عكس users/roles أعلاه). هذه القدرة حسّاسة
// جداً (منح وصول دعم عن بُعد) بحيث لا يجوز أن تصبح قابلة للتفويض لدور غير admin بمجرّد
// تعديل صلاحيات ذلك الدور — requireRole (middleware/auth.js، غير مُعدَّلة) موجودة بالفعل
// وتخدم هذا الغرض تماماً. لا صفحة/واجهة أمامية بعد تستخدم هذا المسار (Phase 4b
// backend-only) — لا تأثير على أي مستخدم حتى الآن.
app.use('/api/support-access', requireAuth, requireRole('admin'), supportAccessRouter);

// ── Phase 5b: Licensing — backend core (schema من Phase 5a) ──
// نفس حارس Support Access بالضبط (role === 'admin' حرفياً، لا requirePermission
// القابلة للتفويض) — قدرة حسّاسة بنفس درجة حساسية Support Access على الأقل. مُستثنًى من
// requireActivation أعلاه صراحة (بادئة '/api/license' في القائمة البيضاء) — بديهياً: لا
// يمكن أن يتطلّب الوصول لمسار التفعيل نفسه تفعيلاً مسبقاً.
app.use('/api/license', requireAuth, requireRole('admin'), licenseRouter);

// ── Phase 2C-3C Part 2: Database Switch/Rollback — authenticated HTTP trigger ──
// نفس حارس Support Access/License بالضبط (role === 'admin' حرفياً) — قدرة حسّاسة أخطر منها:
// تشغّل عملية استبدال قاعدة البيانات الفعلية عبر تشغيل عملية CLI منفصلة (databaseSwitch.js)
// — هذا المسار نفسه لا يستورد databaseSwitch.js ولا يتصل بـ PostgreSQL مباشرة إطلاقاً (انظر
// تعليق dbSwitch.js الخاص به). لا واجهة أمامية بعد تستخدم هذا المسار.
app.use('/api/db-switch', requireAuth, requireRole('admin'), dbSwitchRouter);

// ── Phase 2C-3C Part 3: Database Identity — authenticated read-only marker endpoint ──
// نفس حارس db-switch/support-access/license بالضبط (role === 'admin' حرفياً) — قرار صريح لهذه
// المرحلة (تصميم مستقبلي محتمل: requireAuth فقط بلا admin، بما أن كل مستخدم مسجَّل دخول يحتاج
// هذا الفحص عند كل إقلاع لا الإداريون فقط — متروك عمداً لمرحلة ربط الواجهة الأمامية اللاحقة،
// خارج نطاق هذه المرحلة). لا اتصال PostgreSQL من هذا المسار إطلاقاً — قراءة ملف فقط (انظر
// dbIdentity.js). لا واجهة أمامية بعد تستخدم هذا المسار.
app.use('/api/db-identity', requireAuth, requireRole('admin'), dbIdentityRouter);

// ── P1-1: Routine database backup — read-only status (admin only, same guard as db-switch) ──
// يقرأ ملف حالة النسخ الاحتياطي الدوري وقائمة ملفات النسخ فقط — لا يأخذ نسخة ولا يحذف شيئاً
// ولا يتصل بـ PostgreSQL ولا يقرأ admin.env (انظر routes/backupStatus.js).
app.use('/api/backup-status', requireAuth, requireRole('admin'), backupStatusRouter);

// ── Grades + Homework Submissions Backend Read Foundation (spec 003) — scoped
// GET /api/grades?studentId=&examId= + GET /api/hwSubmissions?studentId=&homeworkId= +
// GET /api/hwSubmissions/aggregate?groupBy=status|homework ──
// مسارات مخصَّصة، مُركَّبة قبل الحلقة الديناميكية (نفس نمط attendance.js بالضبط)، نفس
// صلاحيتي 'exams'/'homework' الحاليتين (COLLECTION_PERMISSIONS.grades/hwSubmissions). كل
// راوتر يعرِّف GET فقط (و/aggregate لـ hwSubmissions) — أي POST/PUT/PATCH/DELETE يمرّ دون أي
// تغيير للحلقة الديناميكية أدناه (makeCrudRouter)، ولا تغيير على /api/exam-grades أو
// /api/hw-submissions (الراوترات الذرّية الحالية للكتابة). لا مستهلك أمامي بعد يستخدم أياً من
// هذه المسارات (Backend Read Foundation فقط — هجرة المستهلكين مؤجَّلة لمراحل لاحقة).
app.use('/api/grades', requireAuth, requirePermission('exams'), gradesRouter);
app.use('/api/hwSubmissions', requireAuth, requirePermission('homework'), hwSubmissionsScopedGetRouter);
// Phase 2 (Homework global-read migration) — GET /api/homeworks?grade= (GET / only; GET /:id,
// POST/PUT/PATCH → CRUD العام، DELETE /:id → homeworkDeleteRouter أعلاه، كما كانت تماماً).
app.use('/api/homeworks', requireAuth, requirePermission('homework'), homeworksScopedGetRouter);

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
    const guards = apiPath === 'activityLogs'
      ? [requireAuth, activityLogsGuard] // M2/F2 — same guard as the dedicated mount above
      : pageId ? [requireAuth, requirePermission(pageId)] : [requireAuth];
    // P2-1 — domain-rule policy (crudPolicies.js): generic CRUD never bypasses a dedicated API.
    const policy = CRUD_POLICIES[apiPath];
    app.use(`/api/${apiPath}`, ...guards, makeCrudRouter(modelName, { writable, preserveClientId, policy }));
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

// ── Phase 6b — فحص إعداد مبكر وواضح قبل أي محاولة اتصال بقاعدة البيانات: DATABASE_URL
// غائب أو تالف الشكل كان يُنتج سابقاً استثناء Node/URL خام غير مفهوم من داخل
// migrationRunner.js (new URL(undefined))؛ الآن يُرفَض هنا فوراً برسالة تشغيلية واضحة، دون
// طباعة قيمة DATABASE_URL نفسها (قد تحتوي كلمة مرور) في أي مكان. لا تغيير على منطق
// migrationRunner.js نفسه أو سلوك fail-closed الحالي — هذا فحص إضافي قبله فقط. ──
try {
  validateDatabaseUrl(process.env.DATABASE_URL);
} catch (err) {
  logger.error(describeStartupFailure(err));
  logger.error('تم إيقاف بدء التشغيل — لم يُشغَّل الخادم.');
  process.exit(1);
}

// ── Database migration freshness check (INSTALL-10) — يُشغَّل قبل app.listen() مباشرة، دائماً،
// كل إقلاع. الخادم لا يُطبِّق أي ترحيل بنفسه بعد الآن — تطبيق الترحيلات أصبح حصراً مسؤولية
// وقت التثبيت/التحديث (backend/src/installer/firstInstall.js، عبر اتصال studix_admin
// الإداري المنفصل) — هذا الفحص للقراءة فقط (SELECT من _studix_migrations عبر اتصال
// studix_app المحدود نفسه)، لا يكتب ولا يُطبِّق أي شيء إطلاقاً. لو وُجدت ترحيلات معلَّقة أو
// لم يُشغَّل التثبيت إطلاقاً (الجدول غائب)، نتوقّف بوضوح بدل خدمة طلبات فوق schema غير
// متوقَّعة — سلوك fail-closed مطابق تماماً لما كان عليه الحال مع runMigrations سابقاً، فقط
// بلا أي محاولة تطبيق. أي فشل اتصال حقيقي (غير "ترحيلات معلَّقة") يصعد ليُصنَّف عبر
// describeStartupFailure كما هو الحال في الفحص الذي يسبقه أعلاه. ──
try {
  const { upToDate } = await checkMigrationsUpToDate(prisma);
  if (!upToDate) {
    logger.error(
      'قاعدة البيانات تحتوي ترحيلات معلَّقة لم تُطبَّق بعد (أو لم يُشغَّل التثبيت الأول إطلاقاً). ' +
      'أعد تشغيل مثبِّت/محدِّث Studix لتطبيق ترحيلات قاعدة البيانات المطلوبة قبل تشغيل التطبيق.'
    );
    logger.error('تم إيقاف بدء التشغيل — لم يُشغَّل الخادم.');
    process.exit(1);
  }
} catch (err) {
  logger.error(`فشل التحقّق من حالة ترحيلات قاعدة البيانات: ${describeStartupFailure(err)}`, { rawError: err.message });
  logger.error('تم إيقاف بدء التشغيل — لم يُشغَّل الخادم.');
  process.exit(1);
}

// Desktop runtime preparation — ربط صريح بـ 127.0.0.1 فقط (لا 0.0.0.0 الافتراضي) —
// تطبيق محلي بحت لكل جهاز معلّم، لا وصول شبكي من أي جهاز آخر مطلوباً أو مرغوباً إطلاقاً.
const server = app.listen(PORT, '127.0.0.1', async () => {
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

// Phase 6b — أخطاء الاستماع نفسها (مثل EADDRINUSE) تصل عبر حدث 'error' على كائن الخادم، لا
// عبر رجوع callback النجاح أعلاه ولا عبر استثناء عادي — بلا هذا المُستمِع كانت Node ستطبع
// stack trace خام غير مفهوم لعميل غير تقني وتُسقِط العملية بصمت نسبي. الرسالة التشغيلية
// الواضحة (describeStartupFailure) تُسجَّل أولاً، ثم إنهاء نظيف بنفس رمز الخروج المعتمَد
// لفشل بدء التشغيل (1) — لا محاولة إعادة استماع تلقائية.
server.on('error', (err) => {
  logger.error(describeStartupFailure(err), { port: PORT, code: err.code });
  process.exit(1);
});

// Phase 6b — إيقاف تشغيل آمن (Phase 6a §9): يوقف قبول اتصالات جديدة، يسمح للطلبات الجارية
// بالانتهاء، يُغلق اتصال Prisma بنظافة، ثم يُنهي العملية — لازم لتشغيل هذا كـ Windows
// Service مستقبلاً (لا نافذة طرفية لإغلاقها يدوياً، وإعادة تشغيل الخدمة/الجهاز تُرسِل
// SIGTERM/SIGINT، لا Ctrl+C تفاعلياً). idempotent بالتصميم (createGracefulShutdown) — إشارة
// ثانية أثناء إيقاف جارٍ بالفعل تُسجَّل وتُتجاهَل، لا تُعيد المحاولة.
const shutdown = createGracefulShutdown({ server, prisma, logger });
registerShutdownHandlers(shutdown);

// أي خطأ يهرب خارج نطاق طلب HTTP (وعد غير مُنتظَر، استثناء داخل مُستمِع/مؤقّت) لا يلتقطه
// asyncHandler/errorHandler.js إطلاقاً — بلا هذا المُستمِع كانت Node ستُنهي العملية بأكملها
// فوراً وبصمت نسبي (لا console مرئية أثناء تشغيل كـ Windows Service)، فتُقطَع كل الجلسات
// النشطة بلا أي أثر تشخيصي. نفس آلية shutdown الآمنة أعلاه بالضبط — idempotent بالفعل.
registerFatalErrorHandlers(shutdown, logger);
