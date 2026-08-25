// migration/export-localstorage.js
// ═══════════════════════════════════════════════════════════════════════════
// تصدير بيانات localStorage إلى نسخة JSON آمنة — دون لمس الأصل.
//
// الاستخدام (طريقتان):
//
// (أ) في المتصفح (الأضمن — البيانات الحقيقية هناك):
//     1. افتح التطبيق في المتصفح.
//     2. افتح Console (F12).
//     3. الصق محتوى الدالة browserExport() ونفّذها.
//     4. سيُنزّل ملف studix-localstorage-backup.json — احفظه في migration/.
//
// (ب) لو عندك ملف JSON مُصدّر بالفعل، مرّره لـ import-postgres.js مباشرة.
//
// هذا السكربت لا يكتب لـ localStorage ولا يحذف منه — قراءة فقط.
// ═══════════════════════════════════════════════════════════════════════════

// ─── دالة تُنفّذ في console المتصفح ───
export function browserExportSource() {
  return `
// ── الصق هذا في console المتصفح (F12) وهو مفتوح على تطبيق Studix ──
(function exportStudix() {
  const backup = { exportedAt: new Date().toISOString(), keys: {} };

  // المفتاح الرئيسي (Zustand persist)
  const main = localStorage.getItem('studix-v1');
  if (main) backup.keys['studix-v1'] = JSON.parse(main);

  // مفاتيح المصادقة المنفصلة
  for (const k of ['studix-auth-users', 'studix-auth-teachers', 'studix-auth-roles']) {
    const v = localStorage.getItem(k);
    if (v) { try { backup.keys[k] = JSON.parse(v); } catch { backup.keys[k] = v; } }
  }

  // أي مفتاح studix-* آخر (احتياطاً — لا نفقد شيئاً)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('studix') && !backup.keys[key]) {
      const v = localStorage.getItem(key);
      try { backup.keys[key] = JSON.parse(v); } catch { backup.keys[key] = v; }
    }
  }

  // تنزيل الملف
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'studix-localstorage-backup.json';
  a.click();
  URL.revokeObjectURL(url);

  console.log('✅ تم تصدير النسخة الاحتياطية. عدد المفاتيح:', Object.keys(backup.keys).length);
  console.log('   احفظ الملف في مجلد migration/ ثم شغّل الـ dry-run.');
  return backup;
})();
`.trim();
}

// عند تشغيله بـ node: يطبع تعليمات التصدير
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\n═══ تصدير localStorage — تعليمات ═══\n');
  console.log('انسخ الكود التالي والصقه في console المتصفح (F12) وأنت على تطبيق Studix:\n');
  console.log(browserExportSource());
  console.log('\nثم احفظ الملف المُنزّل باسم studix-localstorage-backup.json داخل مجلد migration/\n');
}
