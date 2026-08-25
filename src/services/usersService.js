// src/services/usersService.js

// ── All system pages for permission matrix ───────────────────
import { hashPassword } from '../utils/crypto';
import { validate, userSchema, teacherSchema, hasErrors } from '../utils/validation';


export const SYSTEM_PAGES = [
  { id:'dashboard',     label:'لوحة التحكم',         icon:'🏠', group:'عام'        },
  { id:'admissions',    label:'التسجيل والقبول',     icon:'📝', group:'العمليات'   },
  { id:'students',      label:'إدارة الطلاب',        icon:'👥', group:'العمليات'   },
  { id:'groups',        label:'المجموعات',            icon:'◈',  group:'العمليات'   },
  { id:'attendance',    label:'الحضور',               icon:'✓',  group:'العمليات'   },
  { id:'payments',      label:'المدفوعات',            icon:'💳', group:'المالية'    },
  { id:'treasury',      label:'الخزنة والمالية',     icon:'🏦', group:'المالية'    },
  { id:'exams',         label:'الامتحانات',           icon:'📝', group:'الأكاديمي' },
  { id:'homework',      label:'الواجبات',             icon:'📋', group:'الأكاديمي' },
  { id:'materials',     label:'المذكرات الدراسية',   icon:'📚', group:'الأكاديمي' },
  { id:'notifications', label:'الإشعارات',            icon:'🔔', group:'إدارة'     },
  { id:'reports',       label:'التقارير',             icon:'📊', group:'إدارة'     },
  { id:'id-cards',      label:'بطاقات الطلاب',       icon:'🪪', group:'إدارة'     },
  { id:'activity-log',  label:'سجل النشاط',          icon:'📋', group:'إدارة'     },
  { id:'settings',      label:'الإعدادات',            icon:'⚙',  group:'إدارة'     },
  { id:'users',         label:'إدارة المستخدمين',    icon:'👤', group:'إدارة'     },
];

export const PAGE_GROUPS = ['عام','العمليات','المالية','الأكاديمي','إدارة'];

// ── Role colors ──────────────────────────────────────────────
export const ROLE_COLORS = ['#7c3aed','#0d9488','#10b981','#3b82f6','#f59e0b','#ef4444','#ec4899','#06b6d4'];

// ── Validate teacher ─────────────────────────────────────────
export function validateTeacher(data) {
  const errors = {};
  if (!data.name?.trim())     errors.name     = 'اسم المدرس مطلوب';
  if (!data.phone?.trim())    errors.phone    = 'رقم الهاتف مطلوب';
  if (!data.subject)          errors.subject  = 'اختر المادة';
  if (!data.hireDate)         errors.hireDate = 'تاريخ التعيين مطلوب';
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = 'بريد إلكتروني غير صحيح';
  return errors;
}

export function createTeacher(data) {
  const errors = validateTeacher(data);
  if (Object.keys(errors).length) throw { type:'VALIDATION', errors };
  return {
    id:       `tc${Date.now()}`,
    name:     data.name.trim(),
    phone:    data.phone.trim(),
    subject:  data.subject,
    address:  data.address?.trim() || '',
    email:    data.email?.trim()   || '',
    hireDate: data.hireDate,
    status:   data.status || 'active',
    userId:   null,
    notes:    data.notes?.trim()   || '',
  };
}

export function updateTeacher(id, data) {
  const errors = validateTeacher(data);
  if (Object.keys(errors).length) throw { type:'VALIDATION', errors };
  return { id, name:data.name.trim(), phone:data.phone.trim(), subject:data.subject, address:data.address?.trim()||'', email:data.email?.trim()||'', hireDate:data.hireDate, status:data.status||'active', notes:data.notes?.trim()||'', updatedAt:new Date().toISOString() };
}

// ── Validate user ─────────────────────────────────────────────
export function validateUser(data, users, editId = null) {
  const errors = {};
  if (!data.name?.trim())     errors.name     = 'الاسم مطلوب';
  if (!data.id?.trim())       errors.id       = 'اسم المستخدم مطلوب';
  if (!editId && !data.password?.trim()) errors.password = 'كلمة المرور مطلوبة';
  if (data.password && data.password.length < 6) errors.password = 'كلمة المرور 6 أحرف على الأقل';
  if (!data.roleId)           errors.roleId   = 'اختر الدور';
  // Check duplicate username (except self on edit)
  const exists = users.find(u => u.id === data.id?.trim() && u.id !== editId);
  if (exists) errors.id = 'اسم المستخدم مستخدم بالفعل';
  return errors;
}

// createUser: async لأن hashPassword تستخدم Web Crypto API.
// تُرجع نسخة من بيانات المستخدم بكلمة مرور مُجزّأة (PBKDF2) — لا تُخزَّن أبداً خام.
export async function createUser(data) {
  const hashed = data.password ? await hashPassword(data.password) : '';
  return {
    id:        data.id.trim(),
    name:      data.name.trim(),
    role:      data.role,
    password:  hashed,
    email:     data.email?.trim() || '',
    active:    data.active !== false,
    isAdmin:   data.role === 'admin',
    teacherId: data.teacherId || null,
    createdAt: new Date().toISOString(),
  };
}

// updateUserPassword: تُجزّئ كلمة المرور الجديدة قبل تخزينها.
export async function hashNewPassword(newPassword) {
  return hashPassword(newPassword);
}

// ── Validate role ─────────────────────────────────────────────
export function validateRole(data) {
  const errors = {};
  if (!data.id?.trim())    errors.id    = 'معرف الدور مطلوب';
  if (!data.label?.trim()) errors.label = 'اسم الدور مطلوب';
  if (!/^[a-z_]+$/.test(data.id?.trim()||'')) errors.id = 'المعرف: أحرف إنجليزية صغيرة وشرطات فقط';
  return errors;
}
