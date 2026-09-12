// backend/src/lib/studentCode.js
// نُقلت من admissionActivation.js (Phase 3B-13B) لتصبح قابلة لإعادة الاستخدام من مسار
// إنشاء الطالب المباشر أيضاً (POST /api/students) — نفس الخوارزمية بالضبط، مصدر واحد.
// يقبل db (prisma الرئيسي أو tx داخل معاملة) — MAX+1 حقيقي من كل أكواد الطلاب الحالية،
// لا عدّاد محلي/frontend قد يكون قديماً (يحلّ خطر تعارض students.code UNIQUE).
export async function computeNextStudentCode(db) {
  const year = new Date().getFullYear();
  const rows = await db.students.findMany({ select: { code: true } });
  let max = 0;
  const re = /-(\d+)$/;
  for (const { code } of rows) {
    const m = re.exec(code || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `TC-${year}-${String(max + 1).padStart(4, '0')}`;
}
