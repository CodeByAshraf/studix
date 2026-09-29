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
import { invalidateUser, getAuthState } from '../lib/authCache.js';
import { snakeToCamel } from '../lib/caseMapper.js';

const router = Router();

// ── Administrator protection (pre-installer security review, findings 1 + 2) ──
// The real administrator is users.is_admin = true AND active = true (db/firstAdmin.js: the
// setup-created owner has role_id = null). The old guards here counted role_id === 'admin'
// and so never protected the owner: deactivating the last is_admin reopened /api/setup
// (isSetupOpen) to anyone at the machine.
//
// RESERVED_ADMIN_ROLE: assigning this role id sets is_admin (below), so only a live, active
// is_admin requester may assign it or manage the role itself (roles.js) — the 'users'
// permission alone must not be a path to is_admin.
export const RESERVED_ADMIN_ROLE = 'admin';

// Whether the requester is an active real administrator, from the live auth state (the same
// source requireRole/requirePermission use), never from token claims.
export async function isActiveAdminRequester(req) {
  if (!req.user?.id) return false;
  const state = await getAuthState(req.user.id);
  return state?.active === true && state?.isAdmin === true;
}

// Serializes every change that could remove an active administrator, so two concurrent
// requests cannot each see "another admin remains" and together leave none.
const ADMIN_SET_LOCK_KEY = 7_316_200_000_000_001n;

// Runs `write(tx)` only if, afterwards, at least one OTHER active is_admin user remains;
// the count and the write share one transaction under ADMIN_SET_LOCK_KEY. Returns null when
// the change would leave the system without an active administrator.
async function withAnotherActiveAdmin(id, write) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_SET_LOCK_KEY})`;
    const others = await tx.users.count({ where: { is_admin: true, active: true, NOT: { id } } });
    if (others === 0) return null;
    return write(tx);
  });
}

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
  if (roleId === RESERVED_ADMIN_ROLE && !(await isActiveAdminRequester(req))) {
    return res.status(403).json({ ok: false, error: 'تعيين دور مدير النظام متاح لمدير النظام فقط.' });
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
  const { name, roleId: requestedRoleId, active, email, password, permissions } = req.body || {};

  const existing = await prisma.users.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ ok: false, error: 'المستخدم غير موجود.' });

  // An empty/null roleId on an administrator's account means "no role change": a profile edit
  // must never silently clear is_admin (the setup-created owner has role_id NULL, so the form
  // has no role to resend). Demoting an administrator takes an explicit non-admin roleId, and
  // still obeys the last-active-administrator guard below.
  const roleId = existing.is_admin && (requestedRoleId === '' || requestedRoleId === null)
    ? undefined
    : requestedRoleId;

  // Assigning the reserved admin role sets is_admin — only an active real administrator may.
  if (roleId === RESERVED_ADMIN_ROLE && existing.role_id !== RESERVED_ADMIN_ROLE
      && !(await isActiveAdminRequester(req))) {
    return res.status(403).json({ ok: false, error: 'تعيين دور مدير النظام متاح لمدير النظام فقط.' });
  }

  if (roleId) {
    const role = await prisma.roles.findUnique({ where: { id: roleId } });
    if (!role) return res.status(400).json({ ok: false, error: 'الدور المحدَّد غير موجود.' });
  }

  const authAffecting =
    (roleId !== undefined && roleId !== existing.role_id) ||
    (permissions !== undefined) ||
    (active !== undefined && active !== existing.active);

  // An active administrator can never deactivate their own account (it would lock them out
  // and, as the last admin, reopen /api/setup).
  const isActiveAdmin = existing.is_admin && existing.active;
  const willBeActive = active !== undefined ? !!active : existing.active;
  const willBeAdmin = roleId !== undefined ? roleId === RESERVED_ADMIN_ROLE : existing.is_admin;
  if (isActiveAdmin && req.user?.id === id && !willBeActive) {
    return res.status(409).json({ ok: false, error: 'لا يمكنك تعطيل حسابك وأنت مدير النظام.' });
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

  // حارس أمان أدنى: لا يجوز أن تُنتج هذه العملية صفر مديرين نشطين (is_admin AND active).
  // Removing an active admin (deactivation or losing the admin role) only proceeds if another
  // active admin remains — checked and written atomically (withAnotherActiveAdmin).
  const removesActiveAdmin = isActiveAdmin && !(willBeAdmin && willBeActive);
  const updated = removesActiveAdmin
    ? await withAnotherActiveAdmin(id, (tx) => tx.users.update({ where: { id }, data, select: PUBLIC_FIELDS }))
    : await prisma.users.update({ where: { id }, data, select: PUBLIC_FIELDS });
  if (!updated) {
    return res.status(409).json({ ok: false, error: 'لا يمكن ترك النظام بلا مدير نشط واحد على الأقل.' });
  }
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

  // Postgres يرفض الحذف عبر FK (NoAction) لو لهذا المستخدم سجلات مرتبطة (activity_logs،
  // admissions.created_by/last_modified_by، treasury_txn، inventory_txn) — نفس نمط الحماية
  // الموجود لكل جدول آخر في هذا المخطط، يظهر عبر معالج الأخطاء الحالي دون أي تغيير هنا.
  // The last active administrator (is_admin AND active — not role_id) can never be deleted;
  // the check and the delete are atomic (withAnotherActiveAdmin).
  if (existing.is_admin && existing.active) {
    const deleted = await withAnotherActiveAdmin(id, (tx) => tx.users.delete({ where: { id } }));
    if (!deleted) {
      return res.status(409).json({ ok: false, error: 'لا يمكن حذف آخر مدير نشط في النظام.' });
    }
  } else {
    await prisma.users.delete({ where: { id } });
  }
  invalidateUser(id);
  res.json({ ok: true });
}));

export default router;
