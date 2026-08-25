// backend/src/routes/roles.js
// ─────────────────────────────────────────────────────────────
// Stabilization phase — أول مسار خلفي حقيقي لـ roles. تعديل صلاحيات دور يزيد
// auth_version الخاص بذلك الدور ذرّياً + يُبطل كل مستخدم مخزَّن في الكاش مرتبط به
// (invalidateRole) فور نجاح الالتزام — أي جلسة قائمة بهذا الدور تُطالَب بإعادة تسجيل
// الدخول في أول طلب لاحق، بدل انتظار مدة صلاحية التوكن (12 ساعة).
// ─────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { invalidateRole } from '../lib/authCache.js';
import { snakeToCamel } from '../lib/caseMapper.js';

const router = Router();
const ID_PATTERN = /^[a-z_]+$/;

router.get('/', asyncHandler(async (req, res) => {
  const roles = await prisma.roles.findMany({ orderBy: { id: 'asc' } });
  res.json({ ok: true, roles: snakeToCamel(roles) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { id, label, color, description, permissions } = req.body || {};
  if (!id?.trim() || !ID_PATTERN.test(id.trim())) {
    return res.status(400).json({ ok: false, error: 'معرّف الدور: أحرف إنجليزية صغيرة وشرطات سفلية فقط.' });
  }
  if (!label?.trim()) return res.status(400).json({ ok: false, error: 'اسم الدور مطلوب.' });

  const existing = await prisma.roles.findUnique({ where: { id: id.trim() } });
  if (existing) return res.status(409).json({ ok: false, error: 'معرّف الدور مستخدم بالفعل.' });

  const created = await prisma.roles.create({
    data: {
      id: id.trim(),
      label: label.trim(),
      color: color || null,
      description: description?.trim() || null,
      is_system: false, // الأدوار المُنشأة عبر هذا المسار ليست أدوار نظام أبداً
      // فارغة صراحةً افتراضياً (فشل مغلَق) — لا صلاحيات حتى تُمنَح صراحةً، أبداً NULL
      permissions: Array.isArray(permissions) ? permissions : [],
    },
  });
  res.status(201).json({ ok: true, role: snakeToCamel(created) });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { label, color, description, permissions } = req.body || {};

  const existing = await prisma.roles.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ ok: false, error: 'الدور غير موجود.' });

  const data = {};
  if (label !== undefined) data.label = label.trim();
  if (color !== undefined) data.color = color || null;
  if (description !== undefined) data.description = description?.trim() || null;
  if (permissions !== undefined) {
    // لا NULL أبداً هنا — دور بلا صلاحيات محدَّدة = مصفوفة فارغة صريحة (فشل مغلَق).
    data.permissions = Array.isArray(permissions) ? permissions : [];
  }
  // كل تعديل مدعوم على دور يزيد auth_version — حرفياً كما ورد في العقد المعتمَد
  // (Correction 3: "every supported role mutation increments auth_version")، وليس
  // فقط تعديل الصلاحيات، حتى لا تبقى جلسات قائمة تفترض بيانات دور تغيّرت شكلياً.
  data.auth_version = { increment: 1 };

  const updated = await prisma.roles.update({ where: { id }, data });
  invalidateRole(id); // بعد نجاح الالتزام مباشرة
  res.json({ ok: true, role: snakeToCamel(updated) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.roles.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ ok: false, error: 'الدور غير موجود.' });
  if (existing.is_system) {
    return res.status(409).json({ ok: false, error: 'لا يمكن حذف دور نظام أساسي.' });
  }
  // Postgres يرفض الحذف عبر FK (NoAction) لو أي مستخدم لا يزال بهذا role_id.
  await prisma.roles.delete({ where: { id } });
  invalidateRole(id);
  res.json({ ok: true });
}));

export default router;
