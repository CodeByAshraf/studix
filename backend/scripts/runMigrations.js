#!/usr/bin/env node
// backend/scripts/runMigrations.js
// ─────────────────────────────────────────────────────────────
// أداة تشغيل يدوية لمرة واحدة (npm run migrate) — يستدعي نفس migrationRunner.js الذي
// يستدعيه server.js تلقائياً عند الإقلاع، بلا أي فرق في المنطق. مفيدة للتطوير/الاختبار
// اليدوي (تشغيل الترحيلات بمعزل عن تشغيل الخادم كاملاً) وكخطوة تثبيت/تحديث اختيارية
// يستدعيها المثبِّت مستقبلاً صراحةً قبل بدء خدمة Windows، لو اقتُضي ذلك.
//
// يعمل على DATABASE_URL الحالي في .env كأي سكربت آخر في backend/scripts — لا فرق خاص.
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
