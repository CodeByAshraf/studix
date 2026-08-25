// src/constants/routes.js
// كل مسارات التطبيق في مكان واحد

export const ROUTES = {
  DASHBOARD:     'dashboard',
  STUDENTS:      'students',
  ADMISSIONS:    'admissions',
  GROUPS:        'groups',
  ATTENDANCE:    'attendance',
  PAYMENTS:      'payments',
  EXAMS:         'exams',
  NOTIFICATIONS: 'notifications',
  REPORTS:       'reports',
  ID_CARDS:      'id-cards',
  SETTINGS:      'settings',
  ACTIVITY_LOG:  'activity-log',
  USERS:         'users',
  STUDENT_REPORT: 'student-report',
  TREASURY:      'treasury',
  HOMEWORK:      'homework',
  MATERIALS:     'materials',
  INVENTORY:     'inventory',
  COMMUNICATION: 'communication',
};

export const NAV_SECTIONS = [
  {
    id:    'overview',
    label: 'نظرة عامة',
    items: [
      { id: ROUTES.DASHBOARD, label: 'لوحة التحكم', icon: 'dashboard' },
    ],
  },
  {
    id:    'operations',
    label: 'العمليات اليومية',
    items: [
      { id: ROUTES.STUDENTS,   label: 'إدارة الطلاب',  icon: 'students'   },
      { id: ROUTES.GROUPS,     label: 'المجموعات',      icon: 'groups'     },
      { id: ROUTES.ATTENDANCE, label: 'الحضور',         icon: 'attendance' },
    ],
  },
  {
    id:    'finance',
    label: 'المالية',
    items: [
      { id: ROUTES.PAYMENTS,  label: 'المدفوعات',          icon: 'payments'  },
      { id: ROUTES.TREASURY,  label: 'الخزنة والمالية',     icon: 'treasury'  },
    ],
  },
  {
    id:    'academic',
    label: 'الأكاديمي',
    items: [
      { id: ROUTES.EXAMS,      label: 'الامتحانات',       icon: 'exams'      },
      { id: ROUTES.HOMEWORK,   label: 'الواجبات',           icon: 'homework'   },
      { id: ROUTES.MATERIALS,  label: 'المذكرات الدراسية', icon: 'materials'  },
    ],
  },
  {
    id:    'admin',
    label: 'الإدارة',
    items: [
      { id: ROUTES.NOTIFICATIONS, label: 'الإشعارات',        icon: 'notifications' },
      { id: ROUTES.REPORTS,       label: 'التقارير',           icon: 'reports'       },
      { id: ROUTES.ID_CARDS,      label: 'بطاقات الطلاب',     icon: 'id_cards'      },
      { id: ROUTES.ACTIVITY_LOG,  label: 'سجل النشاط',        icon: 'activitylog'   },
      { id: ROUTES.SETTINGS,      label: 'الإعدادات',          icon: 'settings'      },
      { id: ROUTES.USERS,         label: 'المستخدمون والصلاحيات', icon: 'users'         },
      { id: ROUTES.STUDENT_REPORT, label: 'تقرير الطالب الكامل',   icon: 'student_report'},
    ],
  },
];
