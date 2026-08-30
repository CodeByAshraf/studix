#!/usr/bin/env node
// backend/scripts/runMigrations.js
// ─────────────────────────────────────────────────────────────
// أداة تشغيل يدوية لمرة واحدة (node scripts/runMigrations.js — لا يوجد alias في package.json
// باسم "npm run migrate"، رغم أن تعليقاً سابقاً هنا ادّعى وجوده) — يستدعي نفس migrationRunner.js
// مباشرة. مفيدة للتطوير/الاختبار اليدوي (تشغيل الترحيلات بمعزل عن تشغيل الخادم كاملاً)، عادة
// مقابل قاعدة PostgreSQL محلية كاملة الصلاحية خاصة بالمطوّر.
//
// INSTALL-11 — التثبيتات الحقيقية (INSTALL-10+) لم تعد تُطبِّق الترحيلات عبر server.js أو عبر
// هذا السكربت إطلاقاً؛ ذلك أصبح حصراً مسؤولية backend/src/installer/firstInstall.js، عبر اتصال
// studix_admin الإداري المنفصل. هذا السكربت يعمل على DATABASE_URL الحالي في .env كما هو —
// في تثبيت حقيقي يكون هذا دور studix_app المحدود (بلا صلاحيات DDL)، فمن المتوقَّع أن يفشل هذا
// السكربت بوضوح (رفض صلاحية) لا أن يُطبِّق شيئاً بصمت — راجع
// migration/reports/INSTALL-10_LEAST_PRIVILEGE_APP_ROLE.md و
// migration/reports/INSTALL-11_CLI_SCRIPT_RECONCILIATION.md.
// ─────────────────────────────────────────────────────────────
import dotenv from 'dotenv';
import { prisma } from '../src/prisma.js';
import { runMigrations } from '../src/db/migrationRunner.js';
import { createPreMigrationBackup } from '../src/db/backup.js';

dotenv.config();

async function main() {
  console.log('\n=== Studix — تشغيل يدوي لنظام الترحيل ===\n');
  const maskedUrl = (process.env.DATABASE_URL || '').replace(/:[^:@]*@/, ':****@');
  console.log(`DATABASE_URL: ${maskedUrl}\n`);

  try {
    const result = await runMigrations(prisma, { backup: createPreMigrationBackup });
    console.log('النتيجة:', result);
    if (result.action === 'up-to-date') console.log('\nلا ترحيلات معلَّقة — القاعدة محدَّثة بالفعل.');
    if (result.action === 'stamped') console.log(`\nتثبيت جديد — تم تسجيل الإصدارات ${result.versions.join(', ')} كمُطبَّقة بلا تنفيذ.`);
    if (result.action === 'migrated') console.log(`\nتم تطبيق الإصدارات ${result.versions.join(', ')} فعلياً. النسخة الاحتياطية: ${result.backupPath}`);
  } catch (err) {
    console.error('\nفشل الترحيل:', err.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
