// src/store/db.middleware.js
// ═══════════════════════════════════════════════════════════════════════════
// Phase 1 — تحميل القراءة من PostgreSQL (عبر backend).
// قاعدة حرجة: جدول فاضي في PostgreSQL لا يمسح/يستبدل localStorage الموجود.
// إن كان الـ backend غير متاح → لا تغيير (يبقى السلوك الحالي).
//
// Phase 4A: مسار json-server الاحتياطي القديم (loadFromDB/syncToDB/replaceCollection)
// أُزيل بالكامل — كان بلا أي مستهلك حي (syncToDB/replaceCollection) أو بمستهلك وحيد
// (loadFromDB، عبر useDB.jsx فقط عند فشل pgCheckHealth)، وكل الكتابة الفعلية تمرّ منذ
// 3B-2 عبر src/services/api.js (pgCreate*/pgUpdate*/...) لكل نطاق مُرحَّل، لا عبر هذا
// الملف إطلاقاً. لا تغيير في سلوك الدمج/القراءة نفسه.
// ═══════════════════════════════════════════════════════════════════════════
import { pgGetCollection, pgCheckHealth } from '../services/api';

// كل الـ collections المتاحة للقراءة من PostgreSQL (camelCase)
// Phase 3B-13A: admissionFollowups/admissionSystemLog أُضيفا هنا — كلاهما array حقيقي
// في المخزن (admissions.slice.js)، بلا أي شكل singleton، فـ mergeById العام يصلح لهما
// مباشرة بلا أي تعديل — تحقّقنا من هذا صراحةً قبل الإضافة (انظر تقرير قرار Phase 3B-13A).
// Phase 3B-14D: admissionPayments أُضيفت — مصدر الحقيقة PostgreSQL الآن (كانت
// admissionPaymentsLocal، محلية بحتة قبل هذه المرحلة، بلا أي مصدر PostgreSQL).
const PG_COLLECTIONS = [
  'parents', 'students', 'groups', 'teachers', 'exams', 'homeworks', 'centerProfile',
  'cashboxes', 'treasuryTxn', 'payments', 'attendance', 'absenceFollowup',
  'grades', 'hwSubmissions', 'invMaterials', 'inventoryTxn', 'inventorySettings',
  'admissions', 'admissionFollowups', 'admissionSystemLog', 'admissionPayments',
  'communications', 'commTasks', 'activityLogs', 'waReportLog',
];

// دمج آمن بالـ id: أي سجل محلي بـ id غير موجود في نسخة PostgreSQL يبقى كما هو،
// وأي id موجود في الاثنين تفوز به نسخة PostgreSQL (هي مصدر الحقيقة لما وصل إليها فعلاً).
// لا حذف أبداً بناءً على كون PostgreSQL أصغر من النسخة المحلية — هذا هو صلب الإصلاح:
// جدول PostgreSQL يحتوي فقط أول سجلات قليلة (مثلاً أول جلسة حضور بعد التفعيل) لا يعني
// أن باقي التاريخ المحلي "غير موجود" ويُمحى — كان هذا هو سلوك الاستبدال الشامل القديم.
// إصلاحات خاصة بكل collection قبل الدمج — لا يمسّ أي collection غير مذكور هنا صراحةً:
//
// - attendance.date / exams.date: يرجعان من الخادم كطابع زمني كامل
//   ("2000-01-01T00:00:00.000Z") لأن عمود @db.Date يُسلسَل عبر JSON.stringify كـ Date
//   كامل — بينما كل مكان آخر بالتطبيق (SessionMarking, ExamsPage, التقارير) يقارن date
//   كنص "YYYY-MM-DD" مباشرة.
// - exams.total/pass و grades.score: أعمدة Decimal في Prisma — caseMapper.js (غير
//   مُعدَّل عمداً) يحفظها كما هي، فتصل عبر المسار العام (GET /api/exams، /api/grades)
//   كنص وليس رقماً (لها toJSON خاص). حسابات examService.js (خصوصاً "+" في scores.reduce)
//   تتحوّل لدمج نصوص لا جمع أرقام لو بقيت نصاً — نفس المشكلة التي طُبِّعت فعلاً في نقطة
//   نهاية الدرجات المخصّصة (examGrades.js)، هنا فقط لمسار القراءة/الدمج العام.
// - homeworks.dueDate/assignedDate و hwSubmissions.submittedAt: نفس مشكلة التاريخ
//   أعلاه. assignedDate (عمود assigned_date) هو ما تعرضه الواجهة كـ "createdAt"
//   (تاريخ الإنشاء الذي يُدخله المستخدم) — نُعيد تسميته هنا أيضاً حتى تتطابق سجلات
//   القراءة/الدمج مع ما يُنتجه pgCreateHomework/pgUpdateHomework بالضبط، بدل ترك
//   createdAt الخام (طابع created_at الفعلي من الخادم) يظهر بالخطأ.
// - homeworks.totalScore و hwSubmissions.score: نفس مشكلة Decimal-كنص أعلاه.
// - hwSubmissions.homeworkId: المسار العام (GET /api/hwSubmissions → snakeToCamel)
//   يُعيد homeworkId (من عمود homework_id) — بينما كل التطبيق (HomeworkPage,
//   HomeworkTracking, StudentReportPage) يقرأ حصراً حقلاً اسمه "hwId". نُعيد تسميته
//   هنا أيضاً حتى تتطابق سجلات القراءة/الدمج مع ما يُنتجه pgSaveHwSubmissions بالضبط.
// - communications.followupDate / commTasks.dueDate: نفس مشكلة التاريخ أعلاه.
// - communications.legacyParentName: العمود الفعلي legacy_parent_name (لا parent_name) —
//   pgCreateCommunication (api.js) يُعيد تسميته لـ parentName في استجابته؛ نفس الشيء
//   هنا لمسار القراءة/الدمج حتى لا يختلف شكل السجل حسب مصدره (إنشاء الآن مقابل قراءة
//   لاحقة) — parentService.js/CommRecordCard يقرآن حصراً "parentName".
// - commTasks.communicationId: نفس نمط hwSubmissions.homeworkId أعلاه — يُعاد تسميته
//   لـ "commId" ليطابق ما يُنتجه pgCreateCommTask بالضبط.
const COLLECTION_FIXUPS = {
  // Phase 3B-14A: opening_balance يصل كـ Decimal من Prisma على مسار المزامنة أيضاً —
  // نفس تطبيع normalizeCashboxResponse في api.js على مسار الكتابة (pgCreateCashbox/
  // pgUpdateCashbox)، حتى لا يعتمد شكل السجل على مصدره.
  cashboxes: (r) => ({ ...r, openingBalance: toNum(r.openingBalance) }),
  // Phase 3B-14B: نفس مبدأ cashboxes أعلاه — amount Decimal→رقم، date→نص يوم بلا وقت.
  // لا عمود description في treasury_txn إطلاقاً (اكتُشف فعلياً أثناء هذه المرحلة) —
  // notes الخادم يُعاد تسميته description محلياً هنا أيضاً، بنفس normalizeTreasuryTxnResponse
  // تماماً في api.js على مسار الكتابة، حتى لا يعتمد شكل السجل على مصدره (كتابة أم مزامنة).
  treasuryTxn: (r) => {
    const { notes, ...rest } = r;
    return { ...rest, description: notes ?? '', notes: null, amount: toNum(r.amount), date: normalizeDateOnly(r.date) };
  },
  // Phase 3B-14C: نفس مبدأ cashboxes/treasuryTxn أعلاه — amount Decimal→رقم، date→نص
  // يوم بلا وقت. لا مشكلة description/notes هنا (بعكس treasury_txn) — payments لها
  // عمود notes حقيقي واحد فقط تُستخدمه الواجهة مباشرة، فلا حاجة لأي إعادة تسمية.
  payments: (r) => ({ ...r, amount: toNum(r.amount), date: normalizeDateOnly(r.date) }),
  // Phase 3B-14D: نفس مبدأ payments أعلاه تماماً. materialId (BigInt) يصل كنص بالفعل
  // (serializeBigInt في crud.js على مسار GET العام) — لا تطبيع إضافي له هنا مطلوب.
  admissionPayments: (r) => ({ ...r, amount: toNum(r.amount), date: normalizeDateOnly(r.date) }),
  // Phase 3B-15: نفس تطبيع normalizeActivityLogResponse في api.js على مسار الكتابة —
  // ts/description/user هي الأسماء التي تقرأها ActivityLogPage.jsx/Dashboard.jsx فعلياً،
  // لا timestamp/details/userName الخام من الخادم.
  activityLogs: (r) => ({ ...r, ts: r.timestamp, user: r.userName || 'النظام', description: r.details ?? '' }),
  attendance: (r) => ({ ...r, date: normalizeDateOnly(r.date) }),
  exams: (r) => ({ ...r, date: normalizeDateOnly(r.date), total: toNum(r.total), pass: toNum(r.pass) }),
  grades: (r) => ({ ...r, score: r.score === null || r.score === undefined ? null : toNum(r.score) }),
  homeworks: (r) => {
    const { assignedDate, ...rest } = r;
    return {
      ...rest,
      dueDate:    normalizeDateOnly(r.dueDate),
      createdAt:  assignedDate ? normalizeDateOnly(assignedDate) : r.createdAt,
      totalScore: toNum(r.totalScore),
    };
  },
  hwSubmissions: (r) => {
    const { homeworkId, ...rest } = r;
    return {
      ...rest,
      hwId:        homeworkId ?? r.hwId,
      score:       r.score === null || r.score === undefined ? null : toNum(r.score),
      submittedAt: r.submittedAt ? normalizeDateOnly(r.submittedAt) : r.submittedAt,
    };
  },
  communications: (r) => {
    const { legacyParentName, ...rest } = r;
    return {
      ...rest,
      parentName:   legacyParentName ?? r.parentName ?? null,
      followupDate: r.followupDate ? normalizeDateOnly(r.followupDate) : r.followupDate,
    };
  },
  commTasks: (r) => {
    const { communicationId, ...rest } = r;
    // communication_id عمود قابل للـ NULL فعلياً (مهمة بلا تواصل مرتبط) — "?? r.commId"
    // كانت ستستبدل null الصريحة بـ undefined خطأً (undefined فقط يعني "المفتاح غائب").
    return {
      ...rest,
      commId:  communicationId !== undefined ? communicationId : r.commId,
      dueDate: r.dueDate ? normalizeDateOnly(r.dueDate) : r.dueDate,
    };
  },
  // inv_materials.price/cost/min_stock أعمدة Decimal — نفس مشكلة exams.total/pass أعلاه.
  // material.price يُستخدَم حسابياً (ضرب/مقارنة) في MaterialDistribution.jsx/
  // MaterialReports.jsx، فنص هنا يعني NaN أو مقارنة نصّية خاطئة — التطبيع ضروري فعلاً.
  // addedAt عمود @db.Date جديد (added_at) — نفس مشكلة attendance.date/exams.date أعلاه
  // (يصل كطابع زمني كامل عبر المسار العام)، نفس normalizeDateOnly.
  invMaterials: (r) => ({
    ...r,
    price:    toNum(r.price),
    cost:     toNum(r.cost),
    minStock: toNum(r.minStock),
    addedAt:  normalizeDateOnly(r.addedAt),
  }),
  // inventory_txn.quantity/unit_cost أعمدة Decimal — نفس مشكلة invMaterials أعلاه.
  // Phase 3B-12 لا يستبدل GET العام (يبقى /api/inventoryTxn كما هو) — هذا التطبيع
  // فقط لمسار القراءة/الدمج؛ استجابة PUT /api/material-distributions/:id مطبَّعة
  // بالفعل من جهة الخادم (materialDistribution.js).
  inventoryTxn: (r) => ({
    ...r,
    quantity: toNum(r.quantity),
    unitCost: toNum(r.unitCost),
  }),
  // Phase 3B-13A — admissions.reservation_date @db.Date (نفس مشكلة exams.date أعلاه)
  // وcourse_fee Decimal (نفس مشكلة exams.total). number/studentId/groupId يُعاد تسميتها
  // أيضاً هنا (admissionNo/linkedStudentId/confirmedGroupId) — نفس المبدأ بالضبط
  // المستخدَم لـ communications.legacyParentName أعلاه: pgCreateAdmission/pgUpdateAdmission
  // (api.js) يعيدان تسميتها في استجابتيهما، فلا يجوز أن يختلف شكل السجل حسب مصدره
  // (إنشاء/تحديث الآن مقابل قراءة/دمج لاحقاً من هذا المسار العام).
  admissions: (r) => {
    const { number, studentId, groupId, ...rest } = r;
    return {
      ...rest,
      admissionNo:      number ?? null,
      linkedStudentId:  studentId ?? null,
      confirmedGroupId: groupId ?? null,
      reservationDate:  r.reservationDate ? normalizeDateOnly(r.reservationDate) : r.reservationDate,
      courseFee:        r.courseFee === null || r.courseFee === undefined ? r.courseFee : toNum(r.courseFee),
    };
  },
  // admission_followups.date @db.Date — نفس مشكلة attendance.date. note/employee/date
  // يُعاد تسميتها notes/by/at (نفس ما يفعله pgCreateAdmissionFollowup في استجابته) —
  // نفس مبدأ الاتساق بين مصادر السجل المُستخدَم لـ admissions أعلاه بالضبط.
  admissionFollowups: (r) => {
    const { note, employee, date, ...rest } = r;
    return { ...rest, notes: note ?? null, by: employee ?? null, at: date ? normalizeDateOnly(date) : date };
  },
  // admission_system_log.timestamp @db.Timestamptz(6) — يصل كـ ISO string كاملة، لا
  // تطبيع تاريخ لازم (نفس مبدأ absence_followup.followed_at). activityType/byUser/
  // timestamp/details يُعاد تسميتها type/by/at/detail — نفس ما يفعله
  // pgCreateAdmissionSystemLog في استجابته.
  admissionSystemLog: (r) => {
    const { activityType, byUser, timestamp, details, ...rest } = r;
    return { ...rest, type: activityType, by: byUser ?? null, at: timestamp, detail: details ?? null };
  },
};

function normalizeDateOnly(value) {
  return typeof value === 'string' ? value.slice(0, 10) : value;
}
function toNum(value) {
  if (value === null || value === undefined) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

export function normalizeCollectionForMerge(name, data) {
  const fixup = COLLECTION_FIXUPS[name];
  if (!fixup) return data;
  return data.map(fixup);
}

export function mergeById(localArr, pgArr) {
  const local = Array.isArray(localArr) ? localArr : [];
  const pg    = Array.isArray(pgArr)    ? pgArr    : [];
  const pgIds = new Set(pg.map((r) => String(r.id)));
  const localOnly = local.filter((r) => !pgIds.has(String(r.id)));
  return [...localOnly, ...pg];
}

// centerProfile هو الاستثناء الوحيد في PG_COLLECTIONS: سجل مفرد (object) في المخزن، لا
// مصفوفة كباقي الـ collections — mergeById يفترض شكل مصفوفة دائماً، فتطبيقه هنا كان يحوّل
// state.centerProfile من object إلى [{...}] بصمت (Array.isArray على object يُرجع false ←
// local=[] داخل mergeById ← الناتج مصفوفة من عنصر واحد). كل مستهلك (SettingsPage,
// StudentReportPage, PrintHeader, تقارير الحضور/الامتحانات/المدفوعات...) يقرأ
// centerProfile.name/.address/... مباشرة كـ object، فهذا يكسرها صامتاً — انظر تقرير
// تفتيش Phase 3B-10. slogan محلي فقط (بلا عمود DB إطلاقاً)، فيُحفَظ دائماً من النسخة
// المحلية، لا يُستبدَل أبداً بالخادم (حتى لو غاب محلياً، لا نُرسِل undefined/null صريحة).
function mergeCenterProfileSingleton(localValue, pgArr) {
  const localObj = (localValue && typeof localValue === 'object' && !Array.isArray(localValue))
    ? localValue
    : {};
  const serverRow = pgArr[0] || {};
  return { ...serverRow, slogan: localObj.slogan ?? '' };
}

// inventorySettings هو استثناء ثانٍ في PG_COLLECTIONS بنفس سبب centerProfile أعلاه (سجل
// مفرد/object في المخزن، لا مصفوفة — انظر تقرير تفتيش Phase 3B-11): mergeById كان سيحوّله
// بصمت إلى [{...}] بنفس الآلية بالضبط. بعكس centerProfile، لا حقل محلي فقط هنا (لا مقابل
// لـ slogan)، فاستبدال كامل من الخادم كافٍ — لا حاجة لدمج مع القيمة المحلية (localValue
// غير مُستخدَمة هنا، موجودة فقط لتوحيد التوقيع مع SINGLETON_MERGERS أدناه).
// default_min_stock عمود Decimal فيصل كنص من المسار العام (نفس مشكلة invMaterials.price/
// exams.total)، فيُطبَّع لرقم هنا. allow_negative_stock (Boolean) وreservation_expiry_days
// (SmallInt) يصلان بنوعهما الصحيح بالفعل — لا تطبيع لازم لهما. id غير مُدرَج عمداً: الشكل
// المحلي المُعتمَد (INITIAL_INVENTORY_SETTINGS) لا يضمّه، ولا يقرأه أي مستهلك حالي
// (InventoryPage.jsx) — إدراجه كان سيخترع حقلاً جديداً بلا داعٍ.
function mergeInventorySettingsSingleton(_localValue, pgArr) {
  const serverRow = pgArr[0] || {};
  return {
    defaultMinStock:       toNum(serverRow.defaultMinStock),
    allowNegativeStock:    serverRow.allowNegativeStock,
    reservationExpiryDays: serverRow.reservationExpiryDays,
  };
}

// جدول صريح لكل collection مفرد (object) في PG_COLLECTIONS — أي سجل مفرد مستقبلي آخر
// يُسجَّل هنا فقط، بدل ترك mergeById يحوّله بصمت لمصفوفة كما حدث في Phase 3B-10/3B-11.
const SINGLETON_MERGERS = {
  centerProfile:     mergeCenterProfileSingleton,
  inventorySettings: mergeInventorySettingsSingleton,
};

// Phase 4A: empty (نجح الطلب، الجدول فارغ فعلاً) وfailed (فشل الطلب نفسه — شبكة/مهلة/
// استجابة غير ناجحة) كانا يُعامَلان بنفس الأثر تماماً ("لا نلمس localStorage") ولا فرق
// بينهما إلا في نص console.warn/console.log — لا يصلان أبداً لقيمة الإرجاع، فلا طريقة
// للمستدعي (useDB.jsx) معرفة هل فشل جلب أي collection فعلياً رغم أن health check نجح.
// هذا التتبّع إضافي بحت (additive) — لا يغيّر سلوك الدمج/عدم اللمس نفسه إطلاقاً؛ فقط
// يجعل الفرق بين الحالتين ملحوظاً بدل أن يبتلعه console.warn وحده.
export async function loadFromPostgres(set) {
  // 1) تحقّق أن الـ backend متصل بقاعدة البيانات
  const health = await pgCheckHealth();
  if (!health.ok) {
    console.warn('[PG] backend غير متاح — يبقى السلوك الحالي (localStorage).');
    return { ok: false, reason: 'unavailable', applied: [], empty: [], failed: [] };
  }

  // 2) اجلب كل collection؛ طبّق فقط غير الفارغة (القاعدة الحرجة) — فشل الجلب لا يُعامَل
  // كـ "فارغ" أبداً بعد الآن، حتى لو كان الأثر المحلي متطابقاً (لا لمس) في كلتا الحالتين.
  const fetched = {};
  const empty = [];
  const failed = [];
  for (const name of PG_COLLECTIONS) {
    try {
      const data = await pgGetCollection(name);
      if (Array.isArray(data) && data.length > 0) {
        fetched[name] = normalizeCollectionForMerge(name, data); // فقط لو فيه بيانات فعلية
      } else {
        empty.push(name);                    // نجح الطلب، فاضي فعلاً → لا نلمس localStorage
      }
    } catch (err) {
      console.warn(`[PG] فشل جلب ${name}:`, err.message);
      failed.push(name);                      // فشل الطلب نفسه → لا نلمس هذا الـ collection
    }
  }

  // 3) طبّق فقط الـ collections غير الفارغة، وبالدمج بالـ id — لا استبدال شامل أبداً
  const appliedNames = Object.keys(fetched);
  if (appliedNames.length > 0) {
    set((state) => {
      const next = { ...state };
      for (const name of appliedNames) {
        const singletonMerge = SINGLETON_MERGERS[name];
        next[name] = singletonMerge
          ? singletonMerge(state[name], fetched[name])
          : mergeById(state[name], fetched[name]);
      }
      return next;
    });
    console.log('[PG] ✅ دُمجت من PostgreSQL (بالـ id، بلا حذف محلي):', appliedNames.join(', '));
  } else {
    console.log('[PG] ✅ متصل، لكن كل الجداول فارغة — localStorage محفوظ كما هو.');
  }
  if (empty.length) {
    console.log('[PG] (جداول فارغة فعلاً، لم تُمَس:', empty.length, 'collection)');
  }
  if (failed.length) {
    console.warn('[PG] (فشل جلب هذه الـ collections تحديداً رغم اتصال الـ backend — لم تُمَس:', failed.join(', '), ')');
  }

  return { ok: true, applied: appliedNames, empty, failed };
}
