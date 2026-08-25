// migration/mapping/fieldMaps.js
// ═══════════════════════════════════════════════════════════════════════════
// جداول تحويل الحقول: التطبيق (camelCase) → PostgreSQL (snake_case).
// كل خريطة مستخرجة من الكود الفعلي + الـ schema المُطبّق (27 جدول).
// المبدأ: لا اختراع حقول. الحقول غير المُعرّفة هنا تُدرج في unmappedFields.
// ═══════════════════════════════════════════════════════════════════════════

// خريطة بسيطة: مفتاح التطبيق → عمود قاعدة البيانات
// القيمة null = يُعالَج بمنطق خاص (لا نسخ مباشر) — مثل parentPhone → parent_id.

export const MAPS = {
  // ─── students ───
  students: {
    table: 'students',
    fields: {
      id: 'id',
      code: 'code',
      name: 'name',
      phone: 'phone',
      parentPhone: null,      // → parent_id عبر بناء parents
      grade: 'grade',
      groupId: 'group_id',
      school: 'school',
      notes: 'notes',
      status: 'status',
      monthlyFee: 'monthly_fee',
      enrollDate: 'enroll_date',
      createdAt: 'created_at',
    },
  },

  // ─── groups ───
  groups: {
    table: 'groups',
    fields: {
      id: 'id',
      name: 'name',
      subject: 'subject',
      grade: 'grade',
      teacherId: 'teacher_id',
      teacher: 'teacher_name',
      time: 'time',
      days: 'days',
      price: 'price',
      createdAt: 'created_at',
    },
  },

  // ─── teachers ───
  teachers: {
    table: 'teachers',
    fields: {
      id: 'id', name: 'name', phone: 'phone', subject: 'subject',
      active: 'active', createdAt: 'created_at',
    },
  },

  // ─── payments ───
  payments: {
    table: 'payments',
    fields: {
      id: 'id',
      studentId: 'student_id',
      groupId: 'group_id',
      materialId: 'material_id',
      month: 'month',
      year: 'year',
      amount: 'amount',
      method: 'method',
      payType: 'pay_type',
      date: 'date',
      status: 'status',
      notes: 'notes',
      createdAt: 'created_at',
      // treasury_txn_id يُملأ بالربط (refType='payment') — انظر import
    },
  },

  // ─── cashboxes ───
  cashboxes: {
    table: 'cashboxes',
    fields: {
      id: 'id', name: 'name', type: 'type', color: 'color', icon: 'icon',
      openingBalance: 'opening_balance', isDefault: 'is_default',
      active: 'active', notes: 'notes', createdAt: 'created_at',
    },
  },

  // ─── treasury_txn ───
  treasuryTxn: {
    table: 'treasury_txn',
    fields: {
      id: 'id',
      cashboxId: 'cashbox_id',
      date: 'date',
      type: 'type',
      category: 'category',
      amount: 'amount',
      method: 'method',
      party: 'party',
      notes: 'notes',
      status: 'status',
      refType: 'ref_type',
      refId: 'ref_id',
      admissionId: 'admission_id',
      sourceModule: 'source_module',
      sourceDocNo: 'source_doc_no',
      createdBy: 'created_by',       // قد يكون اسماً → معالجة خاصة
      createdAt: 'created_at',
      // balance مشتق — لا يُرحّل (عمود غير موجود)
    },
  },

  // ─── attendance ───
  attendance: {
    table: 'attendance',
    fields: {
      id: 'id', studentId: 'student_id', groupId: 'group_id',
      date: 'date', status: 'status', sessionTime: 'session_time',
      createdAt: 'created_at',
    },
  },

  // ─── absence_followup ───
  absenceFollowup: {
    table: 'absence_followup',
    fields: {
      id: 'id', attendanceId: 'attendance_id', absenceReason: 'absence_reason',
      followedBy: 'followed_by', followedAt: 'followed_at',
      followStatus: 'follow_status', notes: 'notes',
      // Phase 3B-4 (تحضيري): عمود إضافي مضاف صراحة (لا تعديل على أي عمود آخر).
      // studentId/date يبقيان بلا عمود مباشر — يُشتقّان عبر الربط بـ attendance_id.
      parentContactedUs: 'parent_contacted_us',
    },
  },

  // ─── exams ───
  exams: {
    table: 'exams',
    fields: {
      id: 'id', name: 'name', groupId: 'group_id', subject: 'subject',
      date: 'date', total: 'total', pass: 'pass', createdAt: 'created_at',
    },
  },

  // ─── grades ───
  grades: {
    table: 'grades',
    fields: {
      id: 'id', examId: 'exam_id', studentId: 'student_id',
      score: 'score', absent: 'absent', createdAt: 'created_at',
    },
  },

  // ─── homeworks ───
  homeworks: {
    table: 'homeworks',
    fields: {
      id: 'id', title: 'title', description: 'description', subject: 'subject',
      teacher: 'teacher', groupId: 'group_id', totalScore: 'total_score',
      dueDate: 'due_date', createdAt: 'created_at',
    },
  },

  // ─── hw_submissions ───
  hwSubmissions: {
    table: 'hw_submissions',
    fields: {
      id: 'id', hwId: 'homework_id', studentId: 'student_id',
      status: 'status', submittedAt: 'submitted_at', score: 'score', notes: 'notes',
    },
  },

  // ─── inv_materials (الكتالوج الجديد) ───
  invMaterials: {
    table: 'inv_materials',
    fields: {
      id: 'id', code: 'code', name: 'name', subject: 'subject', grade: 'grade',
      price: 'price', cost: 'cost', minStock: 'min_stock', status: 'status',
      barcode: 'barcode', createdAt: 'created_at',
    },
  },

  // ─── inventory_txn ───
  inventoryTxn: {
    table: 'inventory_txn',
    fields: {
      id: 'id', number: 'number', materialId: 'material_id', type: 'type',
      quantity: 'quantity', batchNo: 'batch_no', unitCost: 'unit_cost',
      recipient: 'recipient', studentId: 'student_id', admissionId: 'admission_id',
      paymentId: 'payment_id', status: 'status', createdBy: 'created_by',
      createdAt: 'created_at',
    },
  },

  // ─── inventory_settings ───
  inventorySettings: {
    table: 'inventory_settings',
    fields: {
      defaultMinStock: 'default_min_stock',
      allowNegativeStock: 'allow_negative_stock',
      reservationExpiryDays: 'reservation_expiry_days',
    },
  },

  // ─── admissions ───
  admissions: {
    table: 'admissions',
    fields: {
      id: 'id',
      number: 'number',
      name: 'name',
      studentName: 'name',          // بعض السجلات تستخدم studentName
      parentName: 'parent_name',
      phone: 'phone',
      parentPhone: 'parent_phone',
      grade: 'grade',
      school: 'school',
      source: 'source',
      notes: 'notes',
      stage: 'stage',
      leadStatus: 'lead_status',
      reservationStatus: 'reservation_status',
      reservationDate: 'reservation_date',
      groupId: 'group_id',
      studentId: 'student_id',
      courseFee: 'course_fee',
      createdAt: 'created_at',
      createdBy: 'created_by',
      lastModifiedAt: 'last_modified_at',
      lastModifiedBy: 'last_modified_by',
      // parent_id يُملأ بالربط
    },
  },

  // ─── communications ───
  communications: {
    table: 'communications',
    fields: {
      id: 'id', number: 'number', type: 'type', reason: 'reason', result: 'result',
      employee: 'employee', studentName: 'student_name', phone: 'phone',
      notes: 'notes', priority: 'priority', status: 'status',
      followupDate: 'followup_date', followupTime: 'followup_time',
      studentId: 'student_id', admissionId: 'admission_id', paymentId: 'payment_id',
      groupId: 'group_id', createdAt: 'created_at', createdBy: 'created_by',
      updatedAt: 'updated_at',
      // parentName/phone → parent_id عبر الربط؛ الاسم الحرّ → legacy_parent_name
    },
  },

  // ─── comm_tasks ───
  commTasks: {
    table: 'comm_tasks',
    fields: {
      id: 'id', commId: 'communication_id', title: 'title', dueDate: 'due_date',
      dueTime: 'due_time', priority: 'priority', employee: 'employee',
      status: 'status', createdAt: 'created_at',
    },
  },

  // ─── activity_logs ───
  activityLogs: {
    table: 'activity_logs',
    fields: {
      id: 'id', action: 'action', module: 'module', userId: 'user_id',
      userName: 'user_name', entityType: 'entity_type', entityId: 'entity_id',
      details: 'details', timestamp: 'timestamp',
    },
  },

  // ─── wa_report_log ───
  waReportLog: {
    table: 'wa_report_log',
    fields: {
      id: 'id', studentId: 'student_id', parentPhone: 'parent_phone',
      reportType: 'report_type', messageType: 'message_type', status: 'status',
      createdBy: 'created_by', createdAt: 'created_at',
    },
  },

  // ─── center_profile ───
  centerProfile: {
    table: 'center_profile',
    fields: {
      name: 'name', address: 'address', phone1: 'phone1', phone2: 'phone2',
      logoUrl: 'logo_url', teacherName: 'teacher_name', subject: 'subject',
      academicYear: 'academic_year',
    },
  },
};

// جداول تُبنى بمنطق خاص (لا خريطة مباشرة):
//  - parents: تُبنى من parentPhone الفريدة (students + admissions + communications)
//  - admission_payments / admission_followups / admission_system_log: من مصفوفات داخل admission
//  - users / roles: من مفاتيح auth المنفصلة
//  - matDist: يُدمج في inventory_txn + legacy_metadata

export const SPECIAL_HANDLING = [
  'parents', 'matDist', 'admissionChildren', 'auth',
];
