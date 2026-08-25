// backend/src/routes/users.js
// ─────────────────────────────────────────────────────────────
// Stabilization phase — أول مسار خلفي حقيقي لـ users. مُصدَّر مركّب (requireAuth +
// requirePermission('users')) في server.js، وليس عبر الـ CRUD العام: هذه الـ
// collection تحتاج تجزئة كلمة مرور على الخادم (لا تُقبَل أبداً جاهزة من العميل)،
// واشتقاق is_admin من role_id (لا يُقبَل من العميل مباشرة — يمنع تصعيد صلاحيات)،
// وزيادة auth_version الذرّية عند أي تعديل يمسّ التفويض + إبطال الكاش فوراً بعدها.
// لا يظهر password_hash أبداً في أي استجابة. نفس اتفاقية camelCase<->snake_case
// المستخدَمة في بقية المسارات (caseMapper.js).
// ─────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { hashPbkdf2 } from '../lib/passwordVerify.js';
import { invalidateUser } from '../lib/authCache.js';
import { snakeToCamel } from '../lib/caseMapper.js';

const router = Router();

// نفس تطابق crud.js بالضبط: نتجاهَل Date/Decimal عمداً (لهما toJSON خاص بهما —
// تفكيكهما بـ Object.entries يُنتج {} فارغاً بدل القيمة الفعلية).
function serializeBigInt(input) {
  if (typeof input === 'bigint') return input.toString();
  if (Array.isArray(input)) return input.map(serializeBigInt);
  if (input !== null && typeof input === 'object' && typeof input.toJSON !== 'function') {
    const out = {};
    for (const [k, v] of Object.entries(input)) out[k] = serializeBigInt(v);
    return out;
  }
  return input;
}

const PUBLIC_FIELDS = {
  id: true, name: true, role_id: true, teacher_id: true, is_admin: true,
  active: true, permissions: true, email: true, last_login: true, created_at: true,
  auth_version: true,
};

function toClient(user) {
  return serializeBigInt(snakeToCamel(user));
}

router.get('/', asyncHandler(async (req, res) => {
  const users = await prisma.users.findMany({ select: PUBLIC_FIELDS, orderBy: { id: 'asc' } });
  res.json({ ok: true, users: users.map(toClient) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const user = await prisma.users.findUnique({ where: { id: req.params.id }, select: PUBLIC_FIELDS });
  if (!user) return res.status(404).json({ ok: false, error: 'المستخدم غير موجود.' });
  res.json({ ok: true, user: toClient(user) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { id, name, roleId, active, email, password, permissions } = req.body || {};
  if (!id?.trim() || !name?.trim()) {
    return res.status(400).json({ ok: false, error: 'المعرّف والاسم مطلوبان.' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ ok: false, error: 'كلمة المرور مطلوبة (6 أحرف على الأقل).' });
  }
  if (roleId) {
    const role = await prisma.roles.findUnique({ where: { id: roleId } });
    if (!role) return res.status(400).json({ ok: false, error: 'الدور المحدَّد غير موجود.' });
  }
  const existing = await prisma.users.findUnique({ where: { id: id.trim() } });
  if (existing) return res.status(409).json({ ok: false, error: 'اسم المستخدم مستخدم بالفعل.' });

  const created = await prisma.users.create({
    data: {
      id: id.trim(),
      name: name.trim(),
      role_id: roleId || null,
      is_admin: roleId === 'admin', // يُشتَقّ حصراً من roleId — لا يُقبَل من العميل مباشرة
      active: active !== false,
      email: email?.trim() || null,
      password_hash: hashPbkdf2(password), // يُجزَّأ هنا فقط، لا يُقبَل هاش جاهز من العميل
      permissions: Array.isArray(permissions) && permissions.length > 0 ? permissions : null,
    },
    select: PUBLIC_FIELDS,
  });
  res.status(201).json({ ok: true, user: toClient(created) });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, roleId, active, email, password, permissions } = req.body || {};

  const existing = await prisma.users.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ ok: false, error: 'المستخدم غير موجود.' });

  if (roleId) {
    const role = await prisma.roles.findUnique({ where: { id: roleId } });
    if (!role) return res.status(400).json({ ok: false, error: 'الدور المحدَّد غير موجود.' });
  }

  const authAffecting =
    (roleId !== undefined && roleId !== existing.role_id) ||
    (permissions !== undefined) ||
    (active !== undefined && active !== existing.active);

  // حارس أمان أدنى: لا يجوز أن تُنتج هذه العملية صفر مستخدمين نشطين بدور admin.
  if (authAffecting) {
    const willStayAdmin = (roleId !== undefined ? roleId : existing.role_id) === 'admin'
      && (active !== undefined ? active : existing.active);
    if (!willStayAdmin && existing.role_id === 'admin' && existing.active) {
      const otherActiveAdmins = await prisma.users.count({
        where: { role_id: 'admin', active: true, NOT: { id } },
      });
      if (otherActiveAdmins === 0) {
        return res.status(409).json({ ok: false, error: 'لا يمكن ترك النظام بلا مدير نشط واحد على الأقل.' });
      }
    }
  }

  const data = {};
  if (name !== undefined) data.name = name.trim();
  if (roleId !== undefined) { data.role_id = roleId || null; data.is_admin = roleId === 'admin'; }
  if (active !== undefined) data.active = !!active;
  if (email !== undefined) data.email = email?.trim() || null;
  if (permissions !== undefined) {
    data.permissions = Array.isArray(permissions) && permissions.length > 0 ? permissions : null;
  }
  if (password) {
    if (password.length < 6) return res.status(400).json({ ok: false, error: 'كلمة المرور قصيرة جداً.' });
    data.password_hash = hashPbkdf2(password);
  }
  if (authAffecting) data.auth_version = { increment: 1 };

  const updated = await prisma.users.update({ where: { id }, data, select: PUBLIC_FIELDS });
  if (authAffecting) invalidateUser(id); // بعد نجاح الالتزام مباشرة — لا كتابة كاش قبل تأكيد قاعدة البيانات
  res.json({ ok: true, user: toClient(updated) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (req.user?.id === id) {
    return res.status(409).json({ ok: false, error: 'لا يمكنك حذف حسابك الحالي.' });
  }
  const existing = await prisma.users.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ ok: false, error: 'المستخدم غير موجود.' });

  if (existing.role_id === 'admin' && existing.active) {
    const otherActiveAdmins = await prisma.users.count({ where: { role_id: 'admin', active: true, NOT: { id } } });
    if (otherActiveAdmins === 0) {
      return res.status(409).json({ ok: false, error: 'لا يمكن حذف آخر مدير نشط في النظام.' });
    }
  }

  // Postgres يرفض الحذف عبر FK (NoAction) لو لهذا المستخدم سجلات مرتبطة (activity_logs،
  // admissions.created_by/last_modified_by، treasury_txn، inventory_txn) — نفس نمط الحماية
  // الموجود لكل جدول آخر في هذا المخطط، يظهر عبر معالج الأخطاء الحالي دون أي تغيير هنا.
  await prisma.users.delete({ where: { id } });
  invalidateUser(id);
  res.json({ ok: true });
}));

export default router;
