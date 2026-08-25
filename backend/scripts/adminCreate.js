#!/usr/bin/env node
// backend/scripts/adminCreate.js
// ─────────────────────────────────────────────────────────────
// أداة تشغيل يدوية لمرة واحدة (npm run admin:create) — تحلّ محل حرفياً admin123 المزروع
// في مصدر الفرونت-إند. لا كلمة مرور افتراضية هنا إطلاقاً، لا متغيّر بيئة دائم يحمل
// بيانات الدخول (Decision 8 المعتمَد): كلمة المرور تُدخَل تفاعلياً هنا فقط، تُجزَّأ
// بنفس تنسيق pbkdf2 المتوافق مع verifyPbkdf2/crypto.js، ولا تُطبَع ولا تُسجَّل أبداً.
//
// أمان تشغيلي:
//   - يرفض العمل لو يوجد بالفعل مستخدم بدور admin نشط، إلا بتمرير --reset صراحةً.
//   - --reset يطلب أيضاً تأكيداً كتابياً صريحاً (كتابة "RESET" حرفياً) قبل أي تعديل —
//     لا يُستبدَل حساب admin الحالي الصحيح صمتاً أبداً.
// ─────────────────────────────────────────────────────────────
import readline from 'readline';
import dotenv from 'dotenv';
import { prisma } from '../src/prisma.js';
import { hashPbkdf2 } from '../src/lib/passwordVerify.js';

dotenv.config();

const args = process.argv.slice(2);
const RESET = args.includes('--reset');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

// إدخال كلمة مرور بلا عرضها على الشاشة (masking حرف بحرف) — بلا أي مكتبة خارجية.
// المقارنة بكود الحرف (charCode) بدل نص حرفي، لتجنّب أي التباس في محارف التحكّم.
const CHARCODE_ENTER = 13;
const CHARCODE_NEWLINE = 10;
const CHARCODE_CTRL_C = 3;
const CHARCODE_BACKSPACE_BS = 8;
const CHARCODE_BACKSPACE_DEL = 127;

function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let input = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      const str = chunk.toString();
      const code = str.charCodeAt(0);
      if (code === CHARCODE_ENTER || code === CHARCODE_NEWLINE) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
      } else if (code === CHARCODE_CTRL_C) {
        process.stdout.write('\n');
        process.exit(1);
      } else if (code === CHARCODE_BACKSPACE_BS || code === CHARCODE_BACKSPACE_DEL) {
        if (input.length > 0) { input = input.slice(0, -1); process.stdout.write(' '); }
      } else {
        input += str;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  console.log('\n=== Studix - إنشاء/إعادة ضبط حساب المدير الأول ===\n');

  const existingAdmins = await prisma.users.findMany({ where: { role_id: 'admin', active: true } });

  if (existingAdmins.length > 0 && !RESET) {
    console.log(`يوجد بالفعل ${existingAdmins.length} حساب مدير نشط (${existingAdmins.map((u) => u.id).join(', ')}).`);
    console.log('لن يُستبدَل صمتاً. لإعادة ضبط حساب موجود صراحةً، شغّل:');
    console.log('npm run admin:create -- --reset\n');
    await prisma.$disconnect();
    process.exit(1);
  }

  if (RESET && existingAdmins.length > 0) {
    console.log(`الحسابات الإدارية الحالية: ${existingAdmins.map((u) => u.id).join(', ')}`);
    const confirm = await ask('اكتب RESET حرفياً للتأكيد أنك تريد استبدال كلمة مرور أحد هذه الحسابات: ');
    if (confirm !== 'RESET') {
      console.log('لم يُؤكَّد. لا تغيير.');
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  const defaultId = existingAdmins[0]?.id || 'admin';
  const idInput = await ask(`معرّف المستخدم [${defaultId}]: `);
  const id = idInput.trim() || defaultId;

  const name = (await ask('الاسم الظاهر [مدير النظام]: ')).trim() || 'مدير النظام';

  const password = await askHidden('كلمة المرور الجديدة (لن تُعرَض): ');
  if (!password || password.length < 8) {
    console.log('\nكلمة المرور قصيرة جداً (8 أحرف على الأقل).');
    await prisma.$disconnect();
    process.exit(1);
  }
  const confirmPassword = await askHidden('تأكيد كلمة المرور: ');
  if (password !== confirmPassword) {
    console.log('\nكلمتا المرور غير متطابقتين.');
    await prisma.$disconnect();
    process.exit(1);
  }

  const passwordHash = hashPbkdf2(password);
  const existing = await prisma.users.findUnique({ where: { id } });

  if (existing) {
    await prisma.users.update({
      where: { id },
      data: {
        name,
        role_id: 'admin',
        is_admin: true,
        active: true,
        password_hash: passwordHash,
        auth_version: { increment: 1 }, // يُبطل أي جلسة قائمة لهذا الحساب فوراً
      },
    });
    console.log(`\nتم تحديث حساب "${id}" بكلمة مرور جديدة. الجلسات القائمة لهذا الحساب أصبحت غير صالحة.`);
  } else {
    await prisma.users.create({
      data: { id, name, role_id: 'admin', is_admin: true, active: true, password_hash: passwordHash },
    });
    console.log(`\nتم إنشاء حساب المدير "${id}".`);
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('خطأ:', err.message);
  await prisma.$disconnect();
  process.exit(1);
});
