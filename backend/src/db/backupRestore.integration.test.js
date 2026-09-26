// backend/src/db/backupRestore.integration.test.js
// Backup Reliability Phase 2A — the real end-to-end disaster-recovery proof: real
// createPreMigrationBackup() (Phase 1) → real restoreBackup() (Phase 2A) → representative
// business/financial data verified intact, using the REAL bundled pg_dump.exe/pg_restore.exe
// this machine's actual installed Studix service uses, against two entirely disposable
// PostgreSQL databases created and dropped by this test alone. The real "studix" database,
// real pgdata, real backups directory, and real Windows services are never touched anywhere
// in this file — every safety check below exists specifically to make that structurally hard
// to get wrong, not just a promise in a comment.
//
// Why not setupScratchDb() from test-helpers/scratchDb.js? That helper's own documented
// contract deliberately excludes triggers/CHECK constraints (`prisma db push`, no schema.sql
// applied) — accurate for the many tests that don't care about them, but wrong for THIS test,
// which specifically needs to prove triggers/constraints/ownership/grants survive a real
// backup+restore round trip. This file instead reuses bootstrapDatabase()/applyBaseSchema()/
// runMigrations() — the exact same functions firstInstall.js itself calls in production — to
// build a database that is a genuine, representative Studix database, not a simplified stand-in.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { checkPostgresReachable } from '../test-helpers/scratchDb.js';
import {
  createDatabaseIfMissing, ensureAppRole, bootstrapDatabase, classifySchemaState, extractDatabaseName,
} from './bootstrapDatabase.js';
import { buildDatabaseUrl } from './postgresProvisioning.js';
import { runMigrations } from './migrationRunner.js';
import { createPreMigrationBackup, restoreBackup } from './backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'prisma', 'studix-schema.sql');
const REAL_INSTALLED_PG_HOME = 'C:\\Program Files\\Studix\\pgsql';
const bundledBinariesExist =
  fs.existsSync(path.join(REAL_INSTALLED_PG_HOME, 'bin', 'pg_dump.exe')) &&
  fs.existsSync(path.join(REAL_INSTALLED_PG_HOME, 'bin', 'pg_restore.exe'));

const dbCheck = await checkPostgresReachable();

// ── إعدادات تحقّق أمان صريحة (Section 5 من التكليف) — تُنفَّذ فعلياً، لا مجرّد تعليق ──
const FORBIDDEN_DB_NAME = 'studix';
const SCRATCH_MARKER = '_phase2a_restore_test_';

function assertDisposableDbName(dbName) {
  if (dbName === FORBIDDEN_DB_NAME) {
    throw new Error(`رفض أمان: اسم قاعدة البيانات "${dbName}" هو قاعدة الإنتاج الحقيقية — ممنوع لمسها في هذا الاختبار.`);
  }
  if (!dbName.includes(SCRATCH_MARKER)) {
    throw new Error(`رفض أمان: اسم قاعدة البيانات "${dbName}" لا يحمل العلامة المُتوقَّعة لقاعدة اختبار مؤقتة ("${SCRATCH_MARKER}") — تم الإيقاف احترازاً.`);
  }
}

function assertNotProductionPath(p) {
  const normalized = String(p).toLowerCase();
  if (normalized.includes('programdata\\studix\\backups') || normalized.includes('programdata\\studix\\pgdata')) {
    throw new Error(`رفض أمان: المسار "${p}" يشير إلى مجلد إنتاج حقيقي — ممنوع الكتابة فيه من هذا الاختبار.`);
  }
}

describe('backup.js + restoreBackup() — REAL end-to-end disaster-recovery proof (Phase 2A)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }
  if (!bundledBinariesExist) {
    it.skip(
      `SKIPPED — the real installed Studix bundled pg_dump.exe/pg_restore.exe were not found ` +
      `at ${REAL_INSTALLED_PG_HOME}\\bin on this machine. This test deliberately proves the ` +
      `fix against the actual installed bundled binaries rather than any stand-in; re-run on ` +
      `a machine where Studix is genuinely installed to get this execution-level proof.`,
      () => {}
    );
    return;
  }

  // نفس نمط backup.integration.test.js بالضبط: STUDIX_BACKUP_DIR يُشير لمجلد مؤقت مخصّص لهذا
  // الاختبار فقط طوال مدّته — createPreMigrationBackup() الحقيقية تقرأ هذا المتغيّر لتقرّر
  // وجهة النسخة، ومن دونه تكتب إلى %ProgramData%\Studix\backups الحقيقي (يرفضه assertNotProductionPath).
  let tmpBackupDir;
  const originalBackupDirEnv = process.env.STUDIX_BACKUP_DIR;

  beforeAll(() => {
    tmpBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-restore-test-'));
    process.env.STUDIX_BACKUP_DIR = tmpBackupDir;
  });

  afterAll(() => {
    if (tmpBackupDir) fs.rmSync(tmpBackupDir, { recursive: true, force: true });
    if (originalBackupDirEnv === undefined) delete process.env.STUDIX_BACKUP_DIR;
    else process.env.STUDIX_BACKUP_DIR = originalBackupDirEnv;
  });

  it(
    'creates database A, seeds representative data, backs it up with the REAL pg_dump.exe, ' +
    'restores it into a completely separate database B with the REAL pg_restore.exe, and ' +
    'proves representative business/financial data + relationships + structure survive intact',
    async () => {
      const realUrl = process.env.DATABASE_URL;
      if (!realUrl) throw new Error('DATABASE_URL غير معرَّف في بيئة الاختبار.');
      const realDbName = extractDatabaseName(realUrl);
      const host = new URL(realUrl).hostname;
      const port = Number(new URL(realUrl).port);
      const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

      const dbNameA = `${realDbName}${SCRATCH_MARKER}a_${suffix}`;
      const dbNameB = `${realDbName}${SCRATCH_MARKER}b_${suffix}`;
      assertDisposableDbName(dbNameA);
      assertDisposableDbName(dbNameB);

      // ── حساب studix_admin (تحقّق فعلي: بيئة التطوير هذه لا تملكه بعد — نفس ما أثبته
      // تدقيق Phase 2 — نُنشئه هنا فقط، على نفس عنقود PostgreSQL التطويري، لا الإنتاجي.
      // SUPERUSER/CREATEDB مُبسَّطان عمداً هنا (لا يوجد "الإنتاج" على هذا العنقود التطويري
      // إطلاقاً) — الهدف الوحيد هو أن يكون studix_admin قادراً على إنشاء/امتلاك الكائنات
      // بنفس الروح التي يفعلها في العنقود الحزمي الحقيقي (initdb --username=studix_admin)،
      // لا إعادة بناء آلية initdb الكاملة هنا (خارج نطاق هذا الاختبار).
      const adminPassword = crypto.randomBytes(16).toString('hex');
      const appPassword = crypto.randomBytes(16).toString('hex');
      // اسم دور تطبيق خاص بهذا التشغيل تحديداً — لا "studix_app" الحقيقي: هذا العنقود
      // التطويري المشترك قد يملك بالفعل دور "studix_app" حقيقياً بكلمة مرور غير معروفة هنا
      // (لأغراض تطويرية أخرى)، وensureAppRole عن قصد لا يُدوِّر كلمة مرور دور موجود سلفاً —
      // فاستخدام الاسم الحقيقي هنا كان يُسبِّب فشل مصادقة كاذباً غير متعلّق بالكود المُختبَر.
      const appUser = `studix_app_p2a_${suffix}`;
      const postgresMaintenanceUrl = buildDatabaseUrl({ user: 'postgres', password: new URL(realUrl).password, host, port, database: 'postgres' });

      await ensureTestSuperuserRole(postgresMaintenanceUrl, 'studix_admin', adminPassword);

      const adminMaintenanceUrl = buildDatabaseUrl({ user: 'studix_admin', password: adminPassword, host, port, database: 'postgres' });

      let studixAppUrlA;
      let studixAppUrlB;
      let clientB;

      try {
        // ═══════════════ A. إنشاء قاعدة scratch A ═══════════════
        await createDatabaseIfMissing(adminMaintenanceUrl, dbNameA);
        const adminUrlA = buildDatabaseUrl({ user: 'studix_admin', password: adminPassword, host, port, database: dbNameA });

        // ═══════════════ B. توفير المتطلّبات (schema + migrations + أدوار) ═══════════════
        // نفس تسلسل firstInstall.js الحقيقي بالضبط: bootstrapDatabase (schema أساسي) ثم
        // runMigrations (الترحيلات التزايدية الحقيقية — تُنشئ _studix_migrations أيضاً) ثم
        // ensureAppRole (دور التطبيق المحدود) — لا اختصار/تبسيط لهذا التسلسل.
        await bootstrapDatabase({ databaseUrl: adminUrlA, schemaPath: SCHEMA_PATH });

        const migrationPrismaA = new PrismaClient({ datasources: { db: { url: adminUrlA } } });
        try {
          await runMigrations(migrationPrismaA, { databaseUrl: adminUrlA });
        } finally {
          await migrationPrismaA.$disconnect().catch(() => {});
        }

        const appRoleResult = await ensureAppRole(adminUrlA, { appUser, appPassword, host, port });
        studixAppUrlA = appRoleResult.databaseUrl
          || buildDatabaseUrl({ user: appUser, password: appPassword, host, port, database: dbNameA });

        // ═══════════════ C. زرع بيانات Studix تمثيلية ═══════════════
        const appPrismaA = new PrismaClient({ datasources: { db: { url: studixAppUrlA } } });
        let seeded;
        try {
          seeded = await seedRepresentativeData(appPrismaA);
        } finally {
          await appPrismaA.$disconnect().catch(() => {});
        }

        // ═══════════════ D. نسخة احتياطية حقيقية (pg_dump المُرفَق الحقيقي) ═══════════════
        const backupPath = await createPreMigrationBackup(adminUrlA, { pgHome: REAL_INSTALLED_PG_HOME });
        assertNotProductionPath(backupPath); // تأكيد أن الوجهة مؤقتة (STUDIX_BACKUP_DIR)، لا ProgramData الحقيقي

        // ═══════════════ E. تحقّق النسخة ═══════════════
        const dumpStat = fs.statSync(backupPath);
        expect(dumpStat.size).toBeGreaterThan(0);
        const header = Buffer.alloc(5);
        const fd = fs.openSync(backupPath, 'r');
        try { fs.readSync(fd, header, 0, 5, 0); } finally { fs.closeSync(fd); }
        expect(header.toString('ascii')).toBe('PGDMP');

        // ═══════════════ F/G. قاعدة B منفصلة تماماً + الأدوار موجودة فعلاً (نطاق عنقودي) ═══
        await createDatabaseIfMissing(adminMaintenanceUrl, dbNameB);
        const adminUrlB = buildDatabaseUrl({ user: 'studix_admin', password: adminPassword, host, port, database: dbNameB });
        const beforeRestoreState = await classifySchemaState(adminUrlB);
        expect(beforeRestoreState.state).toBe('uninitialized'); // هدف فارغ فعلاً قبل الاستعادة

        // ═══════════════ H. الاستعادة الحقيقية (pg_restore المُرفَق الحقيقي) — لا محاكاة ═══
        const restoreResult = await restoreBackup(backupPath, adminUrlB, { pgHome: REAL_INSTALLED_PG_HOME });
        expect(restoreResult.targetDatabaseUrl).toBe(adminUrlB);
        expect(restoreResult.durationMs).toBeGreaterThanOrEqual(0);

        studixAppUrlB = buildDatabaseUrl({ user: appUser, password: appPassword, host, port, database: dbNameB });

        // ═══════════════ I. اتصال جديد بقاعدة B، بنفس نمط اعتماد Studix الحقيقي (studix_app) ═
        clientB = new PrismaClient({ datasources: { db: { url: studixAppUrlB } } });

        // ═══════════════ J/K. التحقّق من البيانات التمثيلية + العلاقات ═══════════════
        await verifyRestoredData(clientB, seeded);

        // ═══════════════ L. بنية القاعدة (جداول/فهارس/قيود/triggers) ═══════════════
        await verifyDatabaseStructure(clientB);

        // ═══════════════ M. مطابقة _studix_migrations مع المصدر ═══════════════
        const migrationsA = await queryMigrations(adminUrlA);
        const migrationsB = await queryMigrations(adminUrlB);
        expect(migrationsB).toEqual(migrationsA);
        expect(migrationsB.length).toBeGreaterThan(0); // تأكيد أن الترحيلات فعلاً طُبِّقت وليست فارغة صامتة

        // ═══════════════ N. حالة الترحيل متوافقة مع الكود الحالي ═══════════════
        const { checkMigrationsUpToDate } = await import('./migrationRunner.js');
        const migrationPrismaB = new PrismaClient({ datasources: { db: { url: adminUrlB } } });
        try {
          const upToDate = await checkMigrationsUpToDate(migrationPrismaB);
          expect(upToDate.upToDate).toBe(true);
        } finally {
          await migrationPrismaB.$disconnect().catch(() => {});
        }
      } finally {
        // ═══════════════ O/P. لا تبديل حقيقي لأي شيء، وتنظيف كامل لكل ما أُنشئ هنا فقط ═══
        if (clientB) await clientB.$disconnect().catch(() => {});
        await dropTestDatabase(adminMaintenanceUrl, dbNameA);
        await dropTestDatabase(adminMaintenanceUrl, dbNameB);
        // دور appUser مُخصَّص لهذا التشغيل فقط (انظر تعليق إنشائه أعلاه) — يُحذَف دوماً هنا،
        // على عكس studix_admin الذي يُحاكي دوراً دائماً حقيقياً ويُترَك عمداً.
        await dropTestRole(postgresMaintenanceUrl, appUser);
        if (fs.existsSync(path.dirname(process.env.STUDIX_BACKUP_DIR || ''))) {
          // ينظّف نفسه عبر afterAll أدناه (مجلد مؤقت مخصّص لهذا الاختبار فقط)
        }
      }
    },
    120_000
  );
});

// ── مساعدات محلية لهذا الملف فقط ─────────────────────────────────────────────────────────

async function ensureTestSuperuserRole(maintenanceUrl, roleName, password) {
  const client = new PrismaClient({ datasources: { db: { url: maintenanceUrl } } });
  try {
    const existing = await client.$queryRawUnsafe(`SELECT 1 FROM pg_roles WHERE rolname = '${roleName}'`);
    if (existing.length === 0) {
      // SUPERUSER/CREATEDB — انظر التعليق في جسم الاختبار أعلاه لتبرير هذا التبسيط المتعمَّد.
      await client.$executeRawUnsafe(`CREATE ROLE "${roleName}" LOGIN SUPERUSER CREATEDB PASSWORD '${password}'`);
    } else {
      await client.$executeRawUnsafe(`ALTER ROLE "${roleName}" PASSWORD '${password}'`);
    }
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

// appUser هنا NOSUPERUSER/NOCREATEDB ولا يملك أي كائن (منح DML فقط، لا ملكية) — DROP ROLE
// يكفي وحده بلا REASSIGN OWNED، طالما استُدعيت بعد إسقاط قاعدتي A وB (حيث كانت مِنَحه قائمة).
async function dropTestRole(maintenanceUrl, roleName) {
  if (!/^[A-Za-z0-9_]+$/.test(roleName)) {
    throw new Error(`رفض أمان: اسم دور غير آمن لحذفه: "${roleName}".`);
  }
  const client = new PrismaClient({ datasources: { db: { url: maintenanceUrl } } });
  try {
    await client.$executeRawUnsafe(`DROP ROLE IF EXISTS "${roleName}"`);
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

async function dropTestDatabase(maintenanceUrl, dbName) {
  assertDisposableDbName(dbName);
  const client = new PrismaClient({ datasources: { db: { url: maintenanceUrl } } });
  try {
    await client.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`
    );
    await client.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

// seedRepresentativeData: الحد الأدنى التمثيلي المطلوب صراحةً (Section H من التكليف) — لا
// تعقيد إضافي بلا داعٍ. يُعيد المعرّفات/القيم المُدرَجة ليتحقّق الاختبار منها لاحقاً بعد
// الاستعادة، سطراً بسطر، لا مجرّد "عدد الصفوف تطابق".
async function seedRepresentativeData(prisma) {
  const teacher = await prisma.teachers.create({ data: { name: 'أ. اختبار المعلّم' } });
  const parent = await prisma.parents.create({ data: { full_name: 'ولي أمر الاختبار', phone: '01000000001' } });
  const group = await prisma.groups.create({
    data: { id: 'grp_p2a_1', name: 'مجموعة اختبار الاستعادة', subject: 'رياضيات', grade: 'الأول', time: '10:00', days: [], max: 20, color: '#000', teacher_name: teacher.name },
  });
  const student = await prisma.students.create({
    data: { id: 'stu_p2a_1', code: 'P2A-0001', name: 'طالب اختبار الاستعادة', phone: '01000000002', parent_id: parent.id, group_id: group.id, status: 'active', monthly_fee: 300 },
  });
  const cashbox = await prisma.cashboxes.create({ data: { id: 'cb_p2a_1', name: 'خزنة اختبار الاستعادة', active: true, opening_balance: 1000 } });

  const attendance = await prisma.attendance.create({
    data: { id: 'att_p2a_1', student_id: student.id, group_id: group.id, date: new Date('2026-01-05'), status: 'present' },
  });
  const exam = await prisma.exams.create({
    data: { id: 'exam_p2a_1', group_id: group.id, name: 'اختبار منتصف الفصل', date: new Date('2026-01-10'), total: 100, pass: 50 },
  });
  const grade = await prisma.grades.create({
    data: { id: 'grade_p2a_1', exam_id: exam.id, student_id: student.id, score: 88 },
  });

  // دفعة طالب + حركة خزنة مرتبطة — نفس النمط الذرّي الحقيقي (treasury_txn أولاً، ثم
  // payment يشير إليها) بلا حاجة لاستدعاء منطق العمل الكامل — بيانات ثابتة تكفي لإثبات
  // نجاة العلاقة/الإشارة بعد الاستعادة، لا إعادة اختبار الذرّية نفسها (مُثبَتة في ملفات أخرى).
  const treasuryTxn = await prisma.treasury_txn.create({
    data: { id: 'tx_p2a_1', cashbox_id: cashbox.id, date: new Date('2026-01-06'), type: 'income', category: 'subscriptions', amount: 300, method: 'cash', ref_type: 'payment' },
  });
  const payment = await prisma.payments.create({
    data: { id: 'pay_p2a_1', student_id: student.id, group_id: group.id, month: 1, year: 2026, amount: 300, method: 'cash', pay_type: 'subscription', date: new Date('2026-01-06'), status: 'paid', treasury_txn_id: treasuryTxn.id },
  });
  await prisma.treasury_txn.update({ where: { id: treasuryTxn.id }, data: { payment_id: payment.id } });

  const admission = await prisma.admissions.create({
    data: { id: 'adm_p2a_1', number: 'P2A-ADM-0001', name: 'قبول اختبار الاستعادة', stage: 'reserved', reservation_status: 'reserved' },
  });
  const admTreasuryTxn = await prisma.treasury_txn.create({
    data: { id: 'tx_p2a_2', cashbox_id: cashbox.id, date: new Date('2026-01-07'), type: 'income', category: 'revisions', amount: 150, method: 'cash', ref_type: 'admissionPayment', admission_id: admission.id },
  });
  const admissionPayment = await prisma.admission_payments.create({
    data: { id: 'admpay_p2a_1', admission_id: admission.id, type: 'deposit', amount: 150, date: new Date('2026-01-07'), method: 'cash', treasury_txn_id: admTreasuryTxn.id },
  });

  const material = await prisma.inv_materials.create({ data: { code: 'P2A-MAT-0001', name: 'مذكرة اختبار الاستعادة', price: 50 } });
  const inventoryTxn = await prisma.inventory_txn.create({
    data: { id: 'itx_p2a_1', number: 'INV-P2A0001', material_id: material.id, type: 'purchase', quantity: 10 },
  });

  const communication = await prisma.communications.create({
    data: { id: 'comm_p2a_1', number: 'P2A-COMM-0001', parent_id: parent.id, student_id: student.id, type: 'phoneCall', result: 'completed', notes: 'اتصال اختبار الاستعادة' },
  });
  const activityLog = await prisma.activity_logs.create({
    data: { id: 'act_p2a_1', action: 'create', module: 'students', entity_type: 'student', entity_id: student.id, details: 'إنشاء طالب اختبار الاستعادة', timestamp: new Date('2026-01-05') },
  });

  return {
    teacher, parent, group, student, cashbox, attendance, exam, grade,
    treasuryTxn, payment, admission, admTreasuryTxn, admissionPayment,
    material, inventoryTxn, communication, activityLog,
  };
}

async function verifyRestoredData(prisma, seeded) {
  const student = await prisma.students.findUnique({ where: { id: seeded.student.id } });
  expect(student?.name).toBe(seeded.student.name);
  expect(student?.parent_id).toBe(seeded.parent.id);
  expect(student?.group_id).toBe(seeded.group.id);

  const parent = await prisma.parents.findUnique({ where: { id: seeded.parent.id } });
  expect(parent?.full_name).toBe(seeded.parent.full_name);

  const group = await prisma.groups.findUnique({ where: { id: seeded.group.id } });
  expect(group?.name).toBe(seeded.group.name);

  const attendance = await prisma.attendance.findUnique({ where: { id: seeded.attendance.id } });
  expect(attendance?.student_id).toBe(seeded.student.id);
  expect(attendance?.status).toBe('present');

  const grade = await prisma.grades.findUnique({ where: { id: seeded.grade.id } });
  expect(Number(grade?.score)).toBe(88);
  expect(grade?.exam_id).toBe(seeded.exam.id);

  // K. العلاقات المالية — payment → treasury_txn، admission_payment → treasury_txn
  const payment = await prisma.payments.findUnique({ where: { id: seeded.payment.id } });
  expect(Number(payment?.amount)).toBe(300);
  expect(payment?.treasury_txn_id).toBe(seeded.treasuryTxn.id);
  const treasuryTxn = await prisma.treasury_txn.findUnique({ where: { id: seeded.treasuryTxn.id } });
  expect(treasuryTxn?.payment_id).toBe(seeded.payment.id);
  expect(Number(treasuryTxn?.amount)).toBe(300);

  const admissionPayment = await prisma.admission_payments.findUnique({ where: { id: seeded.admissionPayment.id } });
  expect(admissionPayment?.treasury_txn_id).toBe(seeded.admTreasuryTxn.id);
  const admTreasuryTxn = await prisma.treasury_txn.findUnique({ where: { id: seeded.admTreasuryTxn.id } });
  expect(admTreasuryTxn?.admission_id).toBe(seeded.admission.id);

  const cashbox = await prisma.cashboxes.findUnique({ where: { id: seeded.cashbox.id } });
  expect(Number(cashbox?.opening_balance)).toBe(1000);

  const inventoryTxn = await prisma.inventory_txn.findUnique({ where: { id: seeded.inventoryTxn.id } });
  expect(inventoryTxn?.material_id).toBe(seeded.material.id);
  expect(inventoryTxn?.number).toBe('INV-P2A0001');

  const communication = await prisma.communications.findUnique({ where: { id: seeded.communication.id } });
  expect(communication?.notes).toBe('اتصال اختبار الاستعادة');

  const activityLog = await prisma.activity_logs.findUnique({ where: { id: seeded.activityLog.id } });
  expect(activityLog?.entity_id).toBe(seeded.student.id);
}

async function verifyDatabaseStructure(prisma) {
  const tableRows = await prisma.$queryRaw`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  const tableNames = tableRows.map((r) => r.table_name);
  for (const expected of ['students', 'payments', 'treasury_txn', 'admission_payments', 'cashboxes', 'inventory_txn', '_studix_migrations']) {
    expect(tableNames).toContain(expected);
  }

  const indexRows = await prisma.$queryRaw`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%'
  `;
  expect(indexRows.length).toBeGreaterThan(0);

  const fkRows = await prisma.$queryRaw`
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND constraint_type = 'FOREIGN KEY'
  `;
  expect(fkRows.length).toBeGreaterThan(0);

  // إثبات نجاة triggers المناعة الحقيقية — لا افتراضاً، استعلام فعلي.
  const triggerRows = await prisma.$queryRaw`
    SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_no_delete_payments', 'trg_no_delete_treasury', 'trg_payment_needs_treasury')
  `;
  expect(triggerRows.map((r) => r.tgname).sort()).toEqual(['trg_no_delete_payments', 'trg_no_delete_treasury', 'trg_payment_needs_treasury']);
}

async function queryMigrations(databaseUrl) {
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    return await client.$queryRaw`SELECT version, name, checksum FROM _studix_migrations ORDER BY version`;
  } finally {
    await client.$disconnect().catch(() => {});
  }
}
