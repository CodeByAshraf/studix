// backend/src/routes/collections.js
// ─────────────────────────────────────────────────────────────
// خريطة صريحة: مسار الـ API (كما يتوقّعه التطبيق، camelCase) → اسم property
// فعلي في الـ Prisma Client المولَّد بعد `db pull` (تحقّقنا منه عبر DMMF، وليس تخميناً).
//
// schema.prisma الآن مُستَورَد (introspected) من قاعدة studix الفعلية (27 model).
// أسماء الـ models طابقت أسماء الجداول حرفياً (snake_case)، فـ property الـ
// Prisma Client لكل واحد منها هو نفس اسم الـ model (لا تحويل PascalCase).
// كل الـ 25 مساراً غير الخاصة بالـ auth (users/roles) لها الآن model حقيقي.
// ─────────────────────────────────────────────────────────────

// apiPath : prismaModelProperty
export const COLLECTION_MODELS = {
  // Core
  parents:            'parents',
  students:           'students',
  groups:             'groups',
  teachers:           'teachers',
  exams:              'exams',
  homeworks:          'homeworks',
  centerProfile:      'center_profile',

  // Financial
  cashboxes:          'cashboxes',
  treasuryTxn:        'treasury_txn',
  payments:           'payments',

  // Academic
  attendance:         'attendance',
  absenceFollowup:    'absence_followup',
  grades:             'grades',
  hwSubmissions:      'hw_submissions',

  // Inventory
  invMaterials:       'inv_materials',
  inventoryTxn:       'inventory_txn',
  inventorySettings:  'inventory_settings',

  // Admissions
  admissions:         'admissions',
  admissionPayments:  'admission_payments',
  admissionFollowups: 'admission_followups',
  admissionSystemLog: 'admission_system_log',

  // Communication
  communications:     'communications',
  commTasks:          'comm_tasks',

  // Audit
  activityLogs:       'activity_logs',
  waReportLog:        'wa_report_log',

  // ملاحظة: users/roles مقصودة الاستبعاد في Phase 1 (auth خارج النطاق).
};
