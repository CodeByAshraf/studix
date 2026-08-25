// backend/src/routes/centerProfile.js
// ─────────────────────────────────────────────────────────────
// Phase 3B-10 — تحديث centerProfile (سجل واحد وحيد، id=1 دائماً) عبر مسار مخصّص.
//
// الـ CRUD العام (crud.js) لا يصلح هنا: عمود id لهذا الجدول Int/SmallInt، وparseIdParam
// بها تحوّل رقم الـ URL (نص) إلى BigInt فقط — أي نوع id آخر (بما فيه Int) يمرّ كنص خام
// كما هو لـ Prisma. تحقّقنا من هذا عبر معاملة Prisma مضبوطة على التراجع دائماً (rollback
// مضمون، لا كتابة فعلية على الإطلاق): prisma.center_profile.update({ where:{id:'1'}, ... })
// يفشل بـ PrismaClientValidationError: "Expected Int, provided String" — انظر تقرير
// تفتيش Phase 3B-10. هذا المسار يتجاوز المشكلة كلياً بعدم قراءة أي :id من الطلب إطلاقاً:
// id=1 مثبَّت هنا فقط كقيمة حرفية، لا يُستقبَل ولا يُستخدَم أي id من العميل.
//
// PUT فقط:
//   - لا POST — id له default=1 في القاعدة والصف الوحيد موجود بالفعل؛ أي POST سينتهك
//     PRIMARY KEY (نفس النتيجة لو استُخدم الـ CRUD العام أصلاً لهذا الجدول).
//   - لا DELETE — سجل وحيد (CHECK id=1) لا معنى لحذفه، ولا واجهة تطلبه.
//
// المصادقة/الصلاحية تُطبَّق عند التركيب في server.js (requireAuth +
// requirePermission('settings')) — بلا تكرار هنا.
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { camelToSnake, snakeToCamel } from '../lib/caseMapper.js';

const router = Router();

// الحقول التي تديرها واجهة الإعدادات الحالية فقط (SettingsPage.jsx). أي حقل آخر يُتجاهَل
// صامتاً حتى لو وصل — تحديداً slogan (بلا عمود إطلاقاً) وid/updatedAt (مُدارة هنا فقط)
// وteacherName/subject/academicYear (أعمدة موجودة لكن لا تُدار من أي واجهة حالياً).
const MANAGED_FIELDS = ['name', 'address', 'phone1', 'phone2', 'logoUrl'];

// PUT /api/centerProfile — تحديث السجل الوحيد (id=1) فقط.
router.put('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const filtered = {};
  for (const key of MANAGED_FIELDS) {
    if (key in body) filtered[key] = body[key];
  }
  const data = camelToSnake(filtered);
  data.updated_at = new Date();

  const row = await prisma.center_profile.update({ where: { id: 1 }, data });
  res.json({ ok: true, data: snakeToCamel(row) });
}));

export default router;
