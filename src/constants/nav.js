// src/constants/nav.js
// Single source of truth for sidebar navigation
// Mirrors routes.js exactly — no orphan entries

import { ROUTES } from './routes';

export const NAV_ITEMS = [
  // ── Top ──────────────────────────────────────────────
  { id: ROUTES.DASHBOARD,      label: 'لوحة التحكم',            section: null,            icon: 'dashboard',      badge: null },

  // ── العمليات اليومية ─────────────────────────────────
  { id: ROUTES.ADMISSIONS,     label: 'التسجيل والقبول',        section: 'العمليات',      icon: 'admissions',     badge: null },
  { id: ROUTES.COMMUNICATION,  label: 'مركز التواصل',           section: 'العمليات',      icon: 'communication',  badge: null },
  { id: ROUTES.STUDENTS,       label: 'إدارة الطلاب',           section: 'العمليات',      icon: 'students',       badge: null },
  { id: ROUTES.GROUPS,         label: 'المجموعات',               section: 'العمليات',      icon: 'groups',         badge: null },
  { id: ROUTES.ATTENDANCE,     label: 'الحضور',                  section: 'العمليات',      icon: 'attendance',     badge: null },

  // ── الأكاديمي ─────────────────────────────────────────
  { id: ROUTES.EXAMS,          label: 'الامتحانات',              section: 'الأكاديمي',     icon: 'exams',          badge: null },
  { id: ROUTES.HOMEWORK,       label: 'الواجبات',                section: 'الأكاديمي',     icon: 'homework',       badge: null },
  { id: ROUTES.MATERIALS,      label: 'المذكرات',                section: 'الأكاديمي',     icon: 'materials',      badge: null },
  { id: ROUTES.INVENTORY,      label: 'مخزون المواد',           section: 'الأكاديمي',     icon: 'inventory',      badge: null },

  // ── المالية ───────────────────────────────────────────
  { id: ROUTES.PAYMENTS,       label: 'المدفوعات',               section: 'المالية',       icon: 'payments',       badge: null },
  { id: ROUTES.TREASURY,       label: 'الخزنة والمالية',         section: 'المالية',       icon: 'treasury',       badge: null },

  // ── الإدارة ───────────────────────────────────────────
  { id: ROUTES.USERS,          label: 'المستخدمون',              section: 'الإدارة',       icon: 'users',          badge: null },
  { id: ROUTES.NOTIFICATIONS,  label: 'الإشعارات',               section: 'الإدارة',       icon: 'notifications',  badge: null },
  { id: ROUTES.REPORTS,        label: 'التقارير',                section: 'الإدارة',       icon: 'reports',        badge: null },
  { id: ROUTES.STUDENT_REPORT, label: 'تقرير الطالب',           section: 'الإدارة',       icon: 'student_report', badge: null },
  { id: ROUTES.ID_CARDS,       label: 'بطاقات الطلاب',          section: 'الإدارة',       icon: 'id_cards',       badge: null },
  { id: ROUTES.ACTIVITY_LOG,   label: 'سجل النشاط',             section: 'الإدارة',       icon: 'activitylog',    badge: null },
  { id: ROUTES.SETTINGS,       label: 'الإعدادات',               section: 'الإدارة',       icon: 'settings',       badge: null },
];

// Build sections map for sidebar rendering
export const NAV_SECTIONS = NAV_ITEMS.reduce((acc, item) => {
  const key = item.section || '__top__';
  if (!acc[key]) acc[key] = [];
  acc[key].push(item);
  return acc;
}, {});
