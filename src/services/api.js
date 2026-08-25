// src/services/api.js
// ═══════════════════════════════════════════════════════════════════════════
// PostgreSQL read/write layer (عبر backend في backend/src).
//
// Phase 4A: عميل json-server القديم (API_BASE=localhost:3001، request/apiGet/apiPost/
// apiPut/apiPatch/apiDel، collection()، كل الـ *API exports، profileAPI، checkServer)
// أُزيل بالكامل — تحقّقنا أن لا مستهلك حي له بقي في التطبيق (كان محصوراً في
// db.middleware.js القديم، وهو نفسه أُزيل في نفس المرحلة). لا صفحة أو مكوّن استوردته
// مباشرة إطلاقاً.
// ═══════════════════════════════════════════════════════════════════════════
// Production Readiness Fix — Finding 1: كان PG_API_BASE ثابتاً بلا أي غطاء تهيئة —
// يعمل فقط لو الفرونت-إند والباك-إند على نفس الجهاز حرفياً. الآن يُقرأ من
// VITE_API_URL (مُضمَّن وقت البناء عبر Vite، انظر .env/.env.example) — القيمة
// الافتراضية عند غياب المتغيّر تبقى localhost:4000 عمداً: التوبولوجي المعتمَد لهذا
// التطبيق (تطبيق سطح مكتب/محلي لكل معلّم على جهازه الخاص، الباك-إند وPostgreSQL على
// نفس الجهاز، بلا reverse proxy) يجعل localhost:4000 هي القيمة الصحيحة فعلياً في
// كل من التطوير المحلي والإنتاج معاً — لا حاجة لقيمة إنتاج مختلفة افتراضياً، لكن
// يبقى المتغيّر قابلاً للتغيير لو شُغِّل الباك-إند على منفذ مختلف على جهاز ما.
// إزالة أي / زائدة في النهاية يمنع مسارات مزدوجة (//api/...) لو أُدخلت القيمة بخطأ
// بشرطة مائلة زائدة.
const rawApiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000';
export const PG_API_BASE = rawApiBase.replace(/\/+$/, '');

// قراءة collection من PostgreSQL backend (يرجّع camelCase جاهز)
// credentials: 'include' مطلوب لإرسال كوكي الجلسة HttpOnly (المسارات محمية بـ requireAuth)
// Phase 4A: استجابة بلا data كمصفوفة حقيقية (شكل غير متوقَّع) تُعامَل كفشل الآن (تُرمى)،
// لا كـ "فارغة فعلاً" — كانتا مبهَمتين معاً سابقاً (data || []).
export async function pgGetCollection(name) {
  const res = await fetch(`${PG_API_BASE}/api/${name}`, {
    credentials: 'include',
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`PG GET /${name} → ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json?.data)) throw new Error(`PG GET /${name} → استجابة غير صالحة (data ليست مصفوفة)`);
  return json.data;
}

// يُرمى فقط عند تعذّر الوصول للـ backend (شبكة/timeout) — يُميَّز عن رفض بيانات الدخول (401)
export class BackendUnreachableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackendUnreachableError';
  }
}

// pgLogin: يرسل id + كلمة المرور كنص خام فقط (أبداً لا يُرسَل الهاش المخزَّن) إلى
// POST /api/session. الـ backend هو المسؤول الوحيد عن التحقق من password_hash.
// عند نجاح الاستجابة يُنشئ الـ backend كوكي الجلسة HttpOnly تلقائياً (credentials: 'include').
export async function pgLogin(id, password) {
  let res;
  try {
    res = await fetch(`${PG_API_BASE}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id, password }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new BackendUnreachableError('PG backend unreachable');
  }

  let json = null;
  try { json = await res.json(); } catch { /* استجابة بدون body */ }

  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, user: json?.user || null };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-2 — Students CRUD عبر PostgreSQL (المصدر الوحيد للحقيقة لهذه العملية).
// كل الطلبات credentials:'include' (تتطلّب جلسة موقّعة — requireAuth بالخادم).
// ═══════════════════════════════════════════════════════════════════════════

// pgCreateStudent: POST /api/students. الخادم يتجاهل أي id يُرسَل من العميل
// ويولّد UUID جديداً دائماً (حقل id بلا default في الـ schema) — استخدم دائماً
// id السجل المُعاد من الاستجابة، وليس أي id مُولَّد محلياً قبل الإرسال.
export async function pgCreateStudent(data) {
  const res = await fetch(`${PG_API_BASE}/api/students`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /students → ${res.status}`);
  return json.data;
}

// pgUpdateStudent: PUT /api/students/:id
export async function pgUpdateStudent(id, data) {
  const res = await fetch(`${PG_API_BASE}/api/students/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /students/${id} → ${res.status}`);
  return json.data;
}

// pgDeleteStudent: DELETE /api/students/:id
export async function pgDeleteStudent(id) {
  const res = await fetch(`${PG_API_BASE}/api/students/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG DELETE /students/${id} → ${res.status}`);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-3 — Groups CRUD عبر PostgreSQL (المصدر الوحيد للحقيقة لهذه العملية).
// كل الطلبات credentials:'include'. الحقل المحلي "teacher" (اسم حر) يُرسَل كـ
// "teacherName" — يطابق عمود teacher_name، بعكس تحويل camelCase→snake_case
// التلقائي الذي يُبقي "teacher" كما هو (لا يوجد عمود بهذا الاسم فيُتجاهَل).
// ═══════════════════════════════════════════════════════════════════════════

// pgCreateGroup: POST /api/groups. groups ضمن PRESERVE_CLIENT_ID_COLLECTIONS
// بالخادم — أي id يُرسَل هنا (لو موجوداً وغير فارغ) يُحفَظ كما هو، لا UUID.
export async function pgCreateGroup(data) {
  const body = { ...data, teacherName: data.teacher };
  const res = await fetch(`${PG_API_BASE}/api/groups`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /groups → ${res.status}`);
  return json.data;
}

// pgUpdateGroup: PUT /api/groups/:id
export async function pgUpdateGroup(id, data) {
  const body = { ...data, teacherName: data.teacher };
  const res = await fetch(`${PG_API_BASE}/api/groups/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /groups/${id} → ${res.status}`);
  return json.data;
}

// pgDeleteGroup: DELETE /api/groups/:id — الـ backend يرفض الحذف تلقائياً (409) لو
// كانت هناك students تشير لهذه المجموعة (FK NO ACTION على students.group_id).
export async function pgDeleteGroup(id) {
  const res = await fetch(`${PG_API_BASE}/api/groups/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG DELETE /groups/${id} → ${res.status}`);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-14A — Cashboxes CRUD عبر PostgreSQL (المصدر الوحيد للحقيقة لهذه العملية).
// أول collection مالية تُفعَّل — لا FK لها، لا trigger، فعبر الـ CRUD العام مباشرة (لا
// مسار ذرّي مخصّص، بخلاف treasury_txn/payments/admission_payments لاحقاً). cashboxes
// ضمن PRESERVE_CLIENT_ID_COLLECTIONS بالخادم الآن — أي id يُرسَل هنا (خاصة cb_main
// المزروعة محلياً) يُحفَظ كما هو، لا UUID. لا pgDeleteCashbox عمداً: الحذف محظور صراحةً
// بالخادم (تقرير قرار Phase 3B-14A، البند 3)؛ removeCashbox المحلي يبقى بلا استدعاء فعلي.
// ═══════════════════════════════════════════════════════════════════════════

// opening_balance يصل كـ Decimal من Prisma — يُطبَّع لرقم JS عادي هنا، بنفس مبدأ
// normalizeAdmissionResponse لـ courseFee، حتى لا يعتمد شكل السجل على مصدره (كتابة أم
// مزامنة قراءة — انظر COLLECTION_FIXUPS.cashboxes في db.middleware.js للمسار الآخر).
function normalizeCashboxResponse(data) {
  return {
    ...data,
    openingBalance: data.openingBalance !== undefined && data.openingBalance !== null
      ? Number(data.openingBalance)
      : data.openingBalance,
  };
}

// pgCreateCashbox: POST /api/cashboxes
export async function pgCreateCashbox(data) {
  const res = await fetch(`${PG_API_BASE}/api/cashboxes`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /cashboxes → ${res.status}`);
  return normalizeCashboxResponse(json.data);
}

// pgUpdateCashbox: PUT /api/cashboxes/:id. لا تسوية/fallback من أي نوع — لو لم يكن
// الصف موجوداً على الخادم (404)، يفشل التحديث بخطأ عادي مثل أي فشل آخر (قرار Phase
// 3B-14A الصريح: الاحتفاظ بمعرّفات العميل بلا أي آلية تسوية أو إنشاء ضمني).
export async function pgUpdateCashbox(id, data) {
  const res = await fetch(`${PG_API_BASE}/api/cashboxes/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /cashboxes/${id} → ${res.status}`);
  return normalizeCashboxResponse(json.data);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-14B — treasury_txn عبر PostgreSQL (المصدر الوحيد للحقيقة لهذه العملية).
// إدخال يدوي بسيط (صفّ واحد) عبر الـ CRUD العام (POST /api/treasuryTxn) — الخادم يحقن
// created_by من الجلسة ويولّد UUID دائماً (treasuryTxn ليست ضمن
// PRESERVE_CLIENT_ID_COLLECTIONS — لا id محلي يُرسَل هنا إطلاقاً، قرار صريح). العكس
// والتحويل (كتابات مركّبة متعدّدة الصفوف) لهما مساران ذرّيان مخصّصان منفصلان تماماً
// (backend/src/routes/treasuryTxn.js)، لا علاقة لهما بالـ CRUD العام. لا
// pgUpdateTreasuryTxn/pgDeleteTreasuryTxn عمداً — كلاهما محظور صراحةً بالخادم.
// ═══════════════════════════════════════════════════════════════════════════

// amount يصل كـ Decimal من Prisma، وdate كـ ISO كامل — يُطبَّعان هنا (toResponseDateOrNull
// مُعرَّفة أسفل هذا الملف لقسم admissions، لكنها مُتاحة بالـ hoisting العادي لدوال function).
//
// treasury_txn لا عمود description لها إطلاقاً في القاعدة الحيّة — اكتُشف هذا فعلياً
// أثناء التحقّق من قاعدة البيانات لهذه المرحلة (Phase 3B-14B)، لا افتراضاً مسبقاً؛ انظر
// تقرير الإغلاق للتفاصيل الكاملة. notes هو العمود الحرّ الوحيد المتاح، فيُستخدَم لحمل
// النص الوصفي فعلياً على الخادم (انظر pgCreateTreasuryTxn أدناه للاتجاه المعاكس عند
// الكتابة). هنا، عند القراءة: notes الخادم يُعاد تسميته description محلياً (تتوقّعه كل
// الواجهة الحالية — LedgerTable/TxnForm/reverseModal) — notes المحلي يبقى فارغاً بعد أي
// جولة خادم كاملة، تجنّباً لعرض نفس النص مرّتين.
function normalizeTreasuryTxnResponse(data) {
  const { notes, ...rest } = data;
  return {
    ...rest,
    description: notes ?? '',
    notes: null,
    amount: data.amount !== undefined && data.amount !== null ? Number(data.amount) : data.amount,
    date:   toResponseDateOrNull(data.date),
  };
}

// pgCreateTreasuryTxn: POST /api/treasuryTxn — إدخال يدوي (إيراد/مصروف)، صفّ واحد.
// description (مطلوب محلياً) وnotes (اختياري محلياً) يُدمَجان هنا في notes الخادم الوحيد
// المتاح قبل الإرسال — لولا هذا الدمج، الـ CRUD العام (crud.js) كان سيُسقط description
// بصمت (لا عمود مطابق له في المخطّط)، فيُفقَد النص الذي كتبه المستخدم فعلياً دون أي خطأ
// ظاهر. اكتُشفت هذه الحالة عبر سكريبت التحقّق مضمون التراجع قبل أي كتابة حقيقية.
export async function pgCreateTreasuryTxn(data) {
  const { description, notes, ...rest } = data;
  const body = { ...rest, notes: notes ? `${description} — ${notes}` : description };
  const res = await fetch(`${PG_API_BASE}/api/treasuryTxn`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /treasuryTxn → ${res.status}`);
  return normalizeTreasuryTxnResponse(json.data);
}

// pgReverseTreasuryTxn: PUT /api/treasuryTxn/:id/reverse — عكس ذرّي، يُعيد
// { original, reversal } معاً (الأصل بعد تحديث status فقط، والحركة المعاكسة الجديدة).
export async function pgReverseTreasuryTxn(id, reason) {
  const res = await fetch(`${PG_API_BASE}/api/treasuryTxn/${encodeURIComponent(id)}/reverse`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /treasuryTxn/${id}/reverse → ${res.status}`);
  return {
    original: normalizeTreasuryTxnResponse(json.data.original),
    reversal: normalizeTreasuryTxnResponse(json.data.reversal),
  };
}

// pgTransferBetweenCashboxes: POST /api/treasuryTxn/transfer — تحويل ذرّي، يُعيد
// { outTxn, inTxn } معاً — كلاهما أو لا شيء أبداً.
export async function pgTransferBetweenCashboxes(data) {
  const res = await fetch(`${PG_API_BASE}/api/treasuryTxn/transfer`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /treasuryTxn/transfer → ${res.status}`);
  return {
    outTxn: normalizeTreasuryTxnResponse(json.data.outTxn),
    inTxn:  normalizeTreasuryTxnResponse(json.data.inTxn),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-14C — payments عبر PostgreSQL (المصدر الوحيد للحقيقة لهذه العملية).
// إنشاء دفعة + حركة treasury_txn المرتبطة معاً (ذرّي)؛ استرداد (ذرّي، الدفعة نفسها لا
// تُعدَّل أبداً). كلاهما مساران مخصّصان تماماً (backend/src/routes/payments.js)، لا
// علاقة لهما بالـ CRUD العام — payments تبقى read-only هناك دفاعاً في العمق. لا
// pgUpdatePayment/pgDeletePayment عمداً — كلاهما محظور صراحةً بالخادم (405)، والحذف
// أيضاً على مستوى القاعدة (trg_no_delete_payments، بلا استثناء — نفس نمط treasury_txn).
// ═══════════════════════════════════════════════════════════════════════════

// amount يصل كـ Decimal، date كـ ISO كامل، materialId كنص (BigInt مُسلسَل من الخادم) —
// نفس مبدأ normalizeTreasuryTxnResponse أعلاه. materialId الفارغ (null) يبقى null.
function normalizePaymentResponse(data) {
  return {
    ...data,
    amount: data.amount !== undefined && data.amount !== null ? Number(data.amount) : data.amount,
    date:   toResponseDateOrNull(data.date),
  };
}

// pgCreatePayment: POST /api/payments — إنشاء ذرّي (دفعة + حركة خزنة مرتبطة معاً).
// cashboxId مطلوب دائماً — لا اختيار ضمني لخزنة افتراضية (قرار Phase 3B-14C الصريح:
// غياب/عدم نشاط الخزنة المُرسَلة = فشل واضح من الخادم، لا افتراض صامت). id/status/
// createdBy تُتجاهَل حتى لو أُرسلت — الخادم يولّد id دائماً ويحسب status من رسوم
// الطالب/المجموعة الحقيقية داخل نفس المعاملة، وcreatedBy يُشتَقّ من الجلسة حصراً لحركة
// الخزنة المرتبطة (payments نفسها لا عمود created_by لها إطلاقاً).
export async function pgCreatePayment(data) {
  const res = await fetch(`${PG_API_BASE}/api/payments`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /payments → ${res.status}`);
  return {
    payment:     normalizePaymentResponse(json.data.payment),
    treasuryTxn: normalizeTreasuryTxnResponse(json.data.treasuryTxn),
  };
}

// pgRefundPayment: POST /api/payments/:id/refund — استرداد ذرّي. يستخدم دائماً نفس
// خزنة الدفعة الأصلية (مُشتقّة من treasury_txn المرتبط بها على الخادم) — لا cashboxId
// يُرسَل هنا إطلاقاً (قرار Phase 3B-14C الصريح: لا إعادة اختيار خزنة عند الاسترداد).
// الدفعة نفسها لا تتغيّر أبداً — الاستجابة تعيدها فقط للتذكير (immutable)، والحركة
// الجديدة (refundTxn) هي الأثر المالي الوحيد لهذه العملية.
export async function pgRefundPayment(id, amount, reason) {
  const res = await fetch(`${PG_API_BASE}/api/payments/${encodeURIComponent(id)}/refund`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, reason }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /payments/${id}/refund → ${res.status}`);
  return {
    refundTxn:     normalizeTreasuryTxnResponse(json.data.refundTxn),
    payment:       normalizePaymentResponse(json.data.payment),
    totalRefunded: json.data.totalRefunded,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-4 (تحضيري) — استبدال جلسة حضور كاملة عبر PostgreSQL بمعاملة ذرّية واحدة.
// SessionMarking يستخدم هذه بدل الكتابة المباشرة لـ Zustand — الخادم هو مصدر
// الحقيقة لكل سجلات الجلسة معاً (نفس مبدأ pgCreateStudent/pgCreateGroup).
// ═══════════════════════════════════════════════════════════════════════════

// pgSaveAttendanceSession: PUT /api/attendance-sessions/:groupId/:date
// records: [{ studentId, status }]. records=[] يعني "امسح كل سجلات هذه الجلسة".
export async function pgSaveAttendanceSession(groupId, date, sessionTime, records) {
  const res = await fetch(`${PG_API_BASE}/api/attendance-sessions/${encodeURIComponent(groupId)}/${encodeURIComponent(date)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionTime, records }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /attendance-sessions/${groupId}/${date} → ${res.status}`);
  return json.data; // { groupId, date, sessionTime, records: [...] }
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-5 — Exams/Grades CRUD عبر PostgreSQL.
// exams create/update تبقى عبر الـ CRUD العام (POST/PUT /api/exams) — سجل واحد
// بسيط، بلا حاجة لنقطة نهاية مخصّصة. الحذف والدرجات الجماعية فقط لهما نقاط نهاية
// مخصّصة (معاملات ذرّية)، بنفس مبدأ Phase 3B-4.
// ═══════════════════════════════════════════════════════════════════════════

// exams.date هو @db.Date — يرجع من أي نقطة تمر بالـ CRUD العام كطابع زمني كامل
// (JSON.stringify على Date كامل)، بعكس attendance/exam-grades المخصَّصَين اللذين
// يُطبِّعان date/لا يحتويان date من جهة الخادم. exams.total/pass أعمدة Decimal —
// caseMapper.js (غير مُعدَّل) يُعيدها كنص لا رقم (نفس مشكلة grades.score المُطبَّعة
// في examGrades.js). بما أن exams create/update يبقيان على الـ CRUD العام عمداً
// (بلا نقطة نهاية مخصّصة)، التطبيع هنا فقط، على مستوى الفرونت-إند، مباشرة بعد
// استقبال الاستجابة.
function normalizeExamResponse(data) {
  return {
    ...data,
    date:  data.date ? String(data.date).slice(0, 10) : data.date,
    total: data.total !== undefined && data.total !== null ? Number(data.total) : data.total,
    pass:  data.pass  !== undefined && data.pass  !== null ? Number(data.pass)  : data.pass,
  };
}

// الـ CRUD العام (crud.js، غير مُعدَّل عمداً) يمرّر date كما وصلت مباشرة لـ Prisma —
// وعمود exams.date هو @db.Date، يرفض Prisma له نصاً بصيغة "YYYY-MM-DD" وحدها (يتوقّع
// ISO-8601 DateTime كاملاً أو Date object). attendance-sessions.js يبني هذا التحويل
// من جهة الخادم لأنه مسار مخصّص؛ هنا exams يبقى عمداً على الـ CRUD العام (بلا نقطة
// نهاية مخصّصة)، فالتحويل يحدث هنا فقط، من جهة الفرونت-إند، قبل الإرسال.
function toRequestDate(date) {
  if (!date) return date;
  return `${String(date).slice(0, 10)}T00:00:00.000Z`;
}

// pgCreateExam: POST /api/exams. exams ليست ضمن PRESERVE_CLIENT_ID_COLLECTIONS —
// الخادم يولّد UUID دائماً، استخدم دائماً id الاستجابة.
export async function pgCreateExam(data) {
  const res = await fetch(`${PG_API_BASE}/api/exams`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, date: toRequestDate(data.date) }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /exams → ${res.status}`);
  return normalizeExamResponse(json.data);
}

// pgUpdateExam: PUT /api/exams/:id
export async function pgUpdateExam(id, data) {
  const res = await fetch(`${PG_API_BASE}/api/exams/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, date: toRequestDate(data.date) }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /exams/${id} → ${res.status}`);
  return normalizeExamResponse(json.data);
}

// pgDeleteExam: DELETE /api/exams/:id — معاملة ذرّية على الخادم: تحذف كل درجات
// الامتحان ثم الامتحان نفسه معاً، أو لا شيء عند أي فشل (backend/src/routes/examDelete.js).
export async function pgDeleteExam(id) {
  const res = await fetch(`${PG_API_BASE}/api/exams/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG DELETE /exams/${id} → ${res.status}`);
  return json.data; // { deletedGrades: N }
}

// pgSaveExamGrades: PUT /api/exam-grades/:examId
// records: [{ studentId, score, absent }]. records=[] يعني "امسح كل درجات هذا الامتحان".
export async function pgSaveExamGrades(examId, records) {
  const res = await fetch(`${PG_API_BASE}/api/exam-grades/${encodeURIComponent(examId)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /exam-grades/${examId} → ${res.status}`);
  return json.data; // { examId, records: [...] }
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-6 — Homeworks/hw_submissions CRUD عبر PostgreSQL.
// homeworks create/update تبقى عبر الـ CRUD العام (POST/PUT /api/homeworks) — سجل
// واحد بسيط، بلا حاجة لنقطة نهاية مخصّصة. الحذف والحالات الجماعية فقط لهما نقاط
// نهاية مخصّصة (معاملات ذرّية)، بنفس مبدأ Phase 3B-5.
// ═══════════════════════════════════════════════════════════════════════════

// homeworks.due_date و assigned_date كلاهما @db.Date — يرجعان من الـ CRUD العام
// كطابع زمني كامل. homeworks.total_score عمود Decimal — يرجع كنص لا رقم. بما أن
// create/update يبقيان على الـ CRUD العام عمداً، التطبيع هنا فقط، على مستوى
// الفرونت-إند. الحقل المحلي "createdAt" (تاريخ الإنشاء الذي يُدخله المستخدم) يُرسَل
// كـ "assignedDate" — يطابق عمود assigned_date، ولا يُرسَل أبداً كـ createdAt/created_at
// (created_at عمود مُدار من الخادم بالكامل، مُدرَج في SERVER_MANAGED_FIELDS بـ crud.js).
function toRequestDateOnly(date) {
  if (!date) return date;
  return `${String(date).slice(0, 10)}T00:00:00.000Z`;
}

function normalizeHomeworkResponse(data) {
  const { assignedDate, ...rest } = data;
  return {
    ...rest,
    dueDate:    data.dueDate    ? String(data.dueDate).slice(0, 10)    : data.dueDate,
    createdAt:  assignedDate    ? String(assignedDate).slice(0, 10)    : data.createdAt,
    totalScore: data.totalScore !== undefined && data.totalScore !== null ? Number(data.totalScore) : data.totalScore,
  };
}

// pgCreateHomework: POST /api/homeworks. homeworks ليست ضمن PRESERVE_CLIENT_ID_COLLECTIONS —
// الخادم يولّد UUID دائماً، استخدم دائماً id الاستجابة.
export async function pgCreateHomework(data) {
  const { createdAt, ...rest } = data;
  const body = { ...rest, dueDate: toRequestDateOnly(data.dueDate), assignedDate: toRequestDateOnly(createdAt) };
  const res = await fetch(`${PG_API_BASE}/api/homeworks`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /homeworks → ${res.status}`);
  return normalizeHomeworkResponse(json.data);
}

// pgUpdateHomework: PUT /api/homeworks/:id
export async function pgUpdateHomework(id, data) {
  const { createdAt, ...rest } = data;
  const body = { ...rest, dueDate: toRequestDateOnly(data.dueDate), assignedDate: toRequestDateOnly(createdAt) };
  const res = await fetch(`${PG_API_BASE}/api/homeworks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /homeworks/${id} → ${res.status}`);
  return normalizeHomeworkResponse(json.data);
}

// pgDeleteHomework: DELETE /api/homeworks/:id — معاملة ذرّية على الخادم: تحذف كل
// سجلات تسليم الواجب ثم الواجب نفسه معاً (backend/src/routes/homeworkDelete.js).
export async function pgDeleteHomework(id) {
  const res = await fetch(`${PG_API_BASE}/api/homeworks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG DELETE /homeworks/${id} → ${res.status}`);
  return json.data; // { deletedSubmissions: N }
}

// pgSaveHwSubmissions: PUT /api/hw-submissions/:homeworkId
// records: [{ studentId, status, submittedAt, score, notes }]. records=[] يعني
// "امسح كل سجلات تسليم هذا الواجب". الحقل المحلي "hwId" لا يُرسَل أبداً — homeworkId
// يأتي من الـ URL فقط (camelToSnake('hwId') لا يطابق عمود homework_id). الاستجابة
// تُعيد كل سجل بحقل "homeworkId" (snakeToCamel لـ homework_id) — يُعاد تسميته هنا
// لـ "hwId" حتى تطابق بقية التطبيق (HomeworkPage, StudentReportPage, هذا الملف نفسه)
// الذي يقرأ hwId فقط، وليس homeworkId، إطلاقاً.
export async function pgSaveHwSubmissions(homeworkId, records) {
  const res = await fetch(`${PG_API_BASE}/api/hw-submissions/${encodeURIComponent(homeworkId)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /hw-submissions/${homeworkId} → ${res.status}`);
  const data = json.data || {};
  return {
    ...data,
    records: (data.records || []).map(({ homeworkId: _drop, ...rest }) => ({ ...rest, hwId: homeworkId })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-7 — Communications/commTasks CRUD عبر PostgreSQL.
// كلاهما يبقيان على الـ CRUD العام (POST/PUT /api/communications، POST/PUT /api/commTasks) —
// سجل واحد بسيط في كل مرة، بلا roster جماعي، فلا حاجة لنقطة نهاية مخصّصة (بعكس
// attendance/exams/homeworks).
// Product Completion Phase 2 — Finding 3: pgUpdateCommunication/pgUpdateCommTask
// أُضيفتا (كانتا مُتعمَّداً غير مُفعَّلتين — لا واجهة كانت تستدعيهما وقتها؛ الآن
// CommunicationPage.jsx's handleCompleteComm/handleCompleteTask يستدعيانهما لإكمال
// سجل/مهمة). لا نقطة نهاية جديدة — PUT العام كان موجوداً بالفعل بلا استخدام.
// ═══════════════════════════════════════════════════════════════════════════

// followup_date/due_date كلاهما @db.Date — نفس مشكلة exams.date/homeworks.due_date.
function toRequestDateOrNull(date) {
  if (!date) return null;
  return `${String(date).slice(0, 10)}T00:00:00.000Z`;
}
function toResponseDateOrNull(value) {
  if (!value) return value;
  return String(value).slice(0, 10);
}

// communications.parent_name غير موجود إطلاقاً — العمود الفعلي legacy_parent_name.
// camelToSnake التلقائي لا يعرف هذا، فنُرسله صراحةً كـ legacyParentName.
// id/createdAt/updatedAt مُدارة من الخادم بالكامل (SERVER_MANAGED_FIELDS بـ crud.js) —
// لا تُرسَل إطلاقاً، بعكس homeworks.createdAt التي كانت قيمة مستخدم مميّزة تحتاج عموداً
// مخصّصاً؛ هنا createdAt/updatedAt الفعليان في الواجهة هما "الآن" فقط، فلا فقد بيانات.
function buildCommunicationRequestBody(data) {
  return {
    number:        data.number,
    type:          data.type,
    reason:        data.reason ?? null,
    result:        data.result,
    employee:      data.employee ?? null,
    legacyParentName: data.parentName ?? null,
    studentName:   data.studentName ?? null,
    phone:         data.phone ?? null,
    notes:         data.notes ?? null,
    priority:      data.priority,
    status:        data.status,
    followupDate:  toRequestDateOrNull(data.followupDate),
    followupTime:  data.followupTime ?? null,
    admissionId:   data.admissionId ?? null,
    studentId:     data.studentId ?? null,
    parentId:      data.parentId ?? null,
    paymentId:     data.paymentId ?? null,
    groupId:       data.groupId ?? null,
    createdBy:     data.createdBy ?? null,
  };
}

function normalizeCommunicationResponse(data) {
  const { legacyParentName, ...rest } = data;
  return {
    ...rest,
    parentName:   legacyParentName ?? null,
    followupDate: toResponseDateOrNull(data.followupDate),
  };
}

// pgCreateCommunication: POST /api/communications، مع إعادة محاولة واحدة مضبوطة عند
// تعارض communications.number (UNIQUE) فقط:
//   - options.computeNextNumber (اختيارية): async () => string — تُستدعى مرة واحدة
//     فقط لو رفض الخادم تحديداً بسبب تعارض number (409، field يتضمّن "number").
//     المنطق الفعلي لحساب الرقم التالي (nextCommNumber + جلب أحدث حقيقة من الخادم)
//     يبقى في CommunicationPage.jsx — هذه الدالة هنا عامة، لا تعرف صيغة "COM-000001".
//   - أي خطأ آخر (شبكة، 500، تعارض غير متعلّق بـ number) يُرمى فوراً بلا إعادة محاولة.
export async function pgCreateCommunication(data, { computeNextNumber } = {}) {
  const attempt = async (body) => {
    const res = await fetch(`${PG_API_BASE}/api/communications`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { res, json };
  };

  const firstBody = buildCommunicationRequestBody(data);
  let { res, json } = await attempt(firstBody);

  const isNumberConflict = !res.ok && res.status === 409 && Array.isArray(json?.field) && json.field.includes('number');
  if (isNumberConflict && typeof computeNextNumber === 'function') {
    const newNumber = await computeNextNumber();
    ({ res, json } = await attempt({ ...firstBody, number: newNumber }));
  }

  if (!res.ok) throw new Error(json?.error || `PG POST /communications → ${res.status}`);
  return normalizeCommunicationResponse(json.data);
}

// pgUpdateCommunication: PUT /api/communications/:id — نفس منطق pgCreateCommunication
// (build/normalize) بلا إعادة محاولة تعارض number (لا تغيير على number هنا).
export async function pgUpdateCommunication(id, data) {
  const res = await fetch(`${PG_API_BASE}/api/communications/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCommunicationRequestBody(data)),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /communications/${id} → ${res.status}`);
  return normalizeCommunicationResponse(json.data);
}

// comm_tasks.communication_id هو العمود الفعلي — الحقل المحلي اسمه "commId"، و
// camelToSnake('commId') ينتج comm_id (غير موجود)، فيُتجاهَل صامتاً لو أُرسل كما هو.
function buildCommTaskRequestBody(data) {
  return {
    communicationId: data.commId ?? null,
    title:    data.title,
    dueDate:  toRequestDateOrNull(data.dueDate),
    dueTime:  data.dueTime ?? null,
    priority: data.priority,
    employee: data.employee ?? null,
    status:   data.status,
  };
}

function normalizeCommTaskResponse(data) {
  const { communicationId, ...rest } = data;
  return {
    ...rest,
    commId:  communicationId ?? null,
    dueDate: toResponseDateOrNull(data.dueDate),
  };
}

// pgCreateCommTask: POST /api/commTasks — سجل واحد بسيط، لا تعارض تفرّد ممكن (لا
// unique constraint على comm_tasks غير id)، فلا حاجة لإعادة محاولة هنا.
export async function pgCreateCommTask(data) {
  const res = await fetch(`${PG_API_BASE}/api/commTasks`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCommTaskRequestBody(data)),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /commTasks → ${res.status}`);
  return normalizeCommTaskResponse(json.data);
}

// pgUpdateCommTask: PUT /api/commTasks/:id
export async function pgUpdateCommTask(id, data) {
  const res = await fetch(`${PG_API_BASE}/api/commTasks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCommTaskRequestBody(data)),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /commTasks/${id} → ${res.status}`);
  return normalizeCommTaskResponse(json.data);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-16 — parents (بيانات ولي الأمر الإضافية: هاتف بديل/تفضيلات/ملاحظات) CRUD
// عبر الـ CRUD العام. لا نقطة نهاية "بحث بالهاتف" على الخادم (GET / لا تدعم where) —
// المطابقة تتم في parentService.js (deriveParents) بالكامل من الـ collection المُزامَنة
// محلياً بالفعل (state.parents، PG_COLLECTIONS)، لا استدعاء شبكة إضافي لكل بحث.
// full_name/phone يُرسَلان فقط عند الإنشاء (find-or-create) — ParentEditModal.jsx لا
// يُعدّل الاسم/الهاتف إطلاقاً، فـ updateParent لا تشملهما أبداً (نفس نمط code في
// pgCreateMaterial/pgUpdateMaterial — مُرسَل عند التوفّر فقط عبر `data.field !== undefined`).
// ═══════════════════════════════════════════════════════════════════════════

function buildParentRequestBody(data) {
  const body = {
    altPhone:        data.altPhone        ?? null,
    preferredMethod: data.preferredMethod ?? null,
    preferredTime:   data.preferredTime   ?? null,
    notes:           data.notes           ?? null,
  };
  if (data.phone !== undefined)    body.phone    = data.phone;
  if (data.fullName !== undefined) body.fullName = data.fullName;
  return body;
}

// pgCreateParent: POST /api/parents، مع إعادة محاولة واحدة مضبوطة عند تعارض
// parents.phone (UNIQUE) فقط — سباق بين متصفّحين ينشئان نفس الهاتف تقريباً في نفس
// اللحظة. onPhoneConflict يُستدعى مرة واحدة فقط لإيجاد id الصف الحقيقي الذي فاز
// بالسباق (عبر GET /api/parents كاملة، لا نقطة بحث مخصّصة)، ثم يُعاد المحاولة كـ
// PUT على ذلك الـ id مباشرة من طرف الاستدعاء (لا من هنا — نفس فصل المسؤوليات
// المستخدَم في pgCreateMaterial/computeNextCode بالضبط).
export async function pgCreateParent(data, { onPhoneConflict } = {}) {
  const res = await fetch(`${PG_API_BASE}/api/parents`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildParentRequestBody(data)),
  });
  const json = await res.json().catch(() => null);
  const isPhoneConflict = !res.ok && res.status === 409 && Array.isArray(json?.field) && json.field.includes('phone');
  if (isPhoneConflict && typeof onPhoneConflict === 'function') {
    return { conflict: true, existingId: await onPhoneConflict() };
  }
  if (!res.ok) throw new Error(json?.error || `PG POST /parents → ${res.status}`);
  return { conflict: false, data: json.data };
}

// pgUpdateParent: PUT /api/parents/:id
export async function pgUpdateParent(id, data) {
  const res = await fetch(`${PG_API_BASE}/api/parents/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildParentRequestBody(data)),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /parents/${id} → ${res.status}`);
  return json.data;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-8 — absenceFollowup CRUD عبر الـ CRUD العام (لا نقطة نهاية مخصّصة —
// سجل واحد بسيط دائماً، upsert بمفتاح attendanceId محلياً، لا roster جماعي —
// انظر تقرير تفتيش Phase 3B-8).
// ═══════════════════════════════════════════════════════════════════════════

// absence_followup.followed_at هو @db.Timestamptz(6) — يقبل ISO string كاملة مباشرة
// (بعكس أعمدة @db.Date في exams/homeworks/communications)، فلا حاجة لأي تحويل هنا.
// attendanceId/absenceReason/followedBy/followedAt/followStatus/notes/parentContactedUs
// كلها camelCase↔snake_case مباشر (تطابق تام، بلا أي تسمية بديلة). studentId/date
// حقلان محليان فقط (لا عمود لهما في الجدول، ولا يُقرآن أبداً من أي followup — تحقّق
// عبر grep شامل في تقرير التفتيش) ولا id — لا يُرسَلون أبداً؛ id يأتي من الخادم فقط.
function buildAbsenceFollowupRequestBody(data) {
  return {
    attendanceId:      data.attendanceId,
    absenceReason:     data.absenceReason ?? null,
    followedBy:        data.followedBy ?? null,
    followedAt:        data.followedAt ?? null,
    followStatus:      data.followStatus,
    notes:             data.notes ?? null,
    parentContactedUs: data.parentContactedUs ?? false,
  };
}

// pgCreateAbsenceFollowup: POST /api/absenceFollowup. absenceFollowup ليست ضمن
// PRESERVE_CLIENT_ID_COLLECTIONS بالخادم — الخادم يولّد UUID دائماً، استخدم دائماً
// id الاستجابة.
export async function pgCreateAbsenceFollowup(data) {
  const res = await fetch(`${PG_API_BASE}/api/absenceFollowup`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildAbsenceFollowupRequestBody(data)),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /absenceFollowup → ${res.status}`);
  return json.data;
}

// pgUpdateAbsenceFollowup: PUT /api/absenceFollowup/:id
export async function pgUpdateAbsenceFollowup(id, data) {
  const res = await fetch(`${PG_API_BASE}/api/absenceFollowup/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildAbsenceFollowupRequestBody(data)),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /absenceFollowup/${id} → ${res.status}`);
  return json.data;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-9 — waReportLog CREATE عبر الـ CRUD العام (لا نقطة نهاية مخصّصة —
// سجل واحد بسيط، إضافة فقط، بلا تحديث/حذف من أي واجهة — انظر تقرير تفتيش Phase 3B-9).
// ═══════════════════════════════════════════════════════════════════════════

// studentId/parentPhone/reportType/messageType/status/createdBy كلها camelCase↔
// snake_case مباشر (تطابق تام). id/createdAt مُدارة من الخادم بالكامل (SERVER_MANAGED_FIELDS
// بـ crud.js) — لا تُرسَلان أبداً؛ id يأتي من الخادم فقط. created_by عمود له FK حقيقي
// إلى users.id (بعكس communications.created_by الذي لا قيد عليه) — المستدعي مسؤول عن
// إرسال معرّف مستخدم حقيقي (أو null)، لا اسماً نصياً.
function buildWaReportLogRequestBody(data) {
  return {
    studentId:   data.studentId ?? null,
    parentPhone: data.parentPhone ?? null,
    reportType:  data.reportType ?? null,
    messageType: data.messageType ?? null,
    status:      data.status ?? 'prepared',
    createdBy:   data.createdBy ?? null,
  };
}

// pgCreateWaReportLog: POST /api/waReportLog. waReportLog ليست ضمن
// PRESERVE_CLIENT_ID_COLLECTIONS بالخادم — الخادم يولّد UUID دائماً، استخدم دائماً
// id الاستجابة.
export async function pgCreateWaReportLog(data) {
  const res = await fetch(`${PG_API_BASE}/api/waReportLog`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildWaReportLogRequestBody(data)),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /waReportLog → ${res.status}`);
  return json.data;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-10 — centerProfile UPDATE عبر مسار مخصّص (PUT /api/centerProfile، بلا :id —
// سجل وحيد id=1 دائماً على الخادم، انظر backend/src/routes/centerProfile.js وتقرير
// تفتيش Phase 3B-10). لا POST/DELETE — غير منطقيَين لسجل وحيد.
// ═══════════════════════════════════════════════════════════════════════════

// فقط الحقول التي تديرها SettingsPage.jsx فعلياً. slogan ليس له عمود إطلاقاً (قرار نطاق
// متعمَّد لهذه المرحلة — يبقى محلياً فقط)، وid/updatedAt مُدارَان من الخادم بالكامل،
// وteacherName/subject/academicYear أعمدة موجودة لكن لا تُدار من أي واجهة حالياً —
// لا شيء من هذه الخمسة يُرسَل أبداً.
function buildCenterProfileRequestBody(data) {
  return {
    name:     data.name ?? null,
    address:  data.address ?? null,
    phone1:   data.phone1 ?? null,
    phone2:   data.phone2 ?? null,
    logoUrl:  data.logoUrl ?? null,
  };
}

// pgUpdateCenterProfile: PUT /api/centerProfile (بلا :id)
export async function pgUpdateCenterProfile(data) {
  const res = await fetch(`${PG_API_BASE}/api/centerProfile`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCenterProfileRequestBody(data)),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /centerProfile → ${res.status}`);
  return json.data;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-11 — inv_materials (كتالوج المذكرات) CRUD عبر الـ CRUD العام. matDist/
// inventory_txn خارج نطاق هذه المرحلة تماماً — يبقيان محليَّين كما هما بلا أي تغيير.
// ═══════════════════════════════════════════════════════════════════════════

// الحقول التي تديرها الواجهة الحالية (MaterialsPage + InventoryPage، بعد توحيد
// materials/invMaterials على inv_materials — انظر MATERIALS_DOMAIN_DECISION_AUDIT.md).
// teacher/description/addedAt أُضيفت كأعمدة حقيقية nullable على inv_materials — الادّعاء
// السابق هنا بأن استبعادها كان "قراراً مقصوداً" في migration/mapping/fieldMaps.js لم يكن
// دقيقاً: ذلك الملف لم يذكرها إطلاقاً (لا استبعاد صريح ولا تضمين) — انظر
// MATERIALS_FIELD_OWNERSHIP_DECISION.md §5-6. id/createdAt يبقيان مُدارَين من الخادم
// بالكامل. cost/minStock/status/barcode أعمدة موجودة لكن لا تديرها أي واجهة حالياً —
// تُترَك على قيمها الافتراضية في القاعدة (لا تُرسَل؛ قرار محدود النطاق، غير مُعاد فتحه هنا).
// code (UNIQUE + NOT NULL) يُرسَل فقط عند توفّره في data — عند الإنشاء (MaterialsPage/
// InventoryPage يحسبانه محلياً قبل الاستدعاء)، وليس عند التعديل (updateMaterial لا يُنتج
// code إطلاقاً، فيبقى غائباً عن الحمولة، والخادم يبقيه كما هو دون لمسه — تحديث جزئي عادي).
// teacher/description/addedAt: هذه الدالة مشتركة بين MaterialsPage (يملأ الثلاثة دائماً
// عبر materialService.js) وInventoryPage (لا يملك مدخلات لها إطلاقاً — data.teacher/
// description/addedAt تبقى undefined دائماً من هذا الاستدعاء). لو أُرسلت هذه الحقول
// دائماً (حتى كـ null صريحة)، كان تعديل مادة من InventoryPage سيمحو صامتاً أي قيمة
// وضعتها MaterialsPage على نفس الصف (Prisma تعامل null صريحة كـ "امسح العمود"، بعكس
// غياب المفتاح كلياً الذي يعني "لا تلمسه" — نفس مبدأ code أعلاه بالضبط). فتُرسَل فقط
// عند توفّرها فعلياً في data (undefined !== undefined فقط لو المستدعي مرّرها).
function buildMaterialRequestBody(data) {
  const body = {
    name:    data.name,
    subject: data.subject ?? null,
    grade:   data.grade   ?? null,
    price:   data.price   ?? 0,
  };
  if (data.code !== undefined)        body.code        = data.code;
  if (data.teacher !== undefined)     body.teacher     = data.teacher;
  if (data.description !== undefined) body.description = data.description;
  if (data.addedAt !== undefined)     body.addedAt     = data.addedAt;
  return body;
}

// price/cost/minStock أعمدة Decimal — تصل من الـ CRUD العام كنص لا رقم (نفس مشكلة
// exams.total/pass المُطبَّعة في normalizeExamResponse). material.price يُستخدَم حسابياً
// في MaterialDistribution.jsx/MaterialReports.jsx (ضرب/مقارنة) — نص هنا يعني NaN أو
// مقارنة نصّية خاطئة، فالتطبيع هنا ضروري فعلاً لا احترازي فقط. addedAt عمود @db.Date —
// نفس مشكلة exams.date (يصل كطابع زمني كامل)، نفس التطبيع المستخدَم في normalizeExamResponse.
function normalizeMaterialResponse(data) {
  return {
    ...data,
    price:    data.price    !== undefined && data.price    !== null ? Number(data.price)    : data.price,
    cost:     data.cost     !== undefined && data.cost     !== null ? Number(data.cost)     : data.cost,
    minStock: data.minStock !== undefined && data.minStock !== null ? Number(data.minStock) : data.minStock,
    addedAt:  data.addedAt ? String(data.addedAt).slice(0, 10) : data.addedAt,
  };
}

// pgCreateMaterial: POST /api/invMaterials، مع إعادة محاولة واحدة مضبوطة عند تعارض
// inv_materials.code (UNIQUE) فقط — نفس نمط pgCreateCommunication بالضبط:
//   - options.computeNextCode (اختيارية): async () => string — تُستدعى مرة واحدة فقط
//     لو رفض الخادم تحديداً بسبب تعارض code (409، field يتضمّن "code"). حساب الرقم
//     التالي الفعلي (nextMatCode + جلب أحدث حقيقة من الخادم) يبقى في MaterialsPage.jsx.
//   - أي خطأ آخر (شبكة، 500، تعارض غير متعلّق بـ code) يُرمى فوراً بلا إعادة محاولة.
// invMaterials ليست ضمن PRESERVE_CLIENT_ID_COLLECTIONS بالخادم — id (BigInt) يولّده
// الخادم دائماً عبر autoincrement، استخدم دائماً id الاستجابة، لا mat${Date.now()} المحلي.
export async function pgCreateMaterial(data, { computeNextCode } = {}) {
  const attempt = async (body) => {
    const res = await fetch(`${PG_API_BASE}/api/invMaterials`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { res, json };
  };

  const firstBody = buildMaterialRequestBody(data);
  let { res, json } = await attempt(firstBody);

  const isCodeConflict = !res.ok && res.status === 409 && Array.isArray(json?.field) && json.field.includes('code');
  if (isCodeConflict && typeof computeNextCode === 'function') {
    const newCode = await computeNextCode();
    ({ res, json } = await attempt({ ...firstBody, code: newCode }));
  }

  if (!res.ok) throw new Error(json?.error || `PG POST /invMaterials → ${res.status}`);
  return normalizeMaterialResponse(json.data);
}

// pgUpdateMaterial: PUT /api/invMaterials/:id
export async function pgUpdateMaterial(id, data) {
  const res = await fetch(`${PG_API_BASE}/api/invMaterials/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildMaterialRequestBody(data)),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /invMaterials/${id} → ${res.status}`);
  return normalizeMaterialResponse(json.data);
}

// pgDeleteMaterial: DELETE /api/invMaterials/:id — الخادم يرفض الحذف تلقائياً (409) لو
// كانت هناك inventory_txn تشير لهذه المادة (FK NO ACTION). inventory_txn فارغ تماماً
// اليوم (خارج نطاق هذه المرحلة)، فالحذف ينجح دائماً حالياً؛ هذا يتغيّر تلقائياً بلا أي
// كود إضافي هنا فور ترحيل inventory_txn لاحقاً.
export async function pgDeleteMaterial(id) {
  const res = await fetch(`${PG_API_BASE}/api/invMaterials/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG DELETE /invMaterials/${id} → ${res.status}`);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-12 — تسوية توزيع مذكرة (roster كامل) عبر نقطة نهاية مخصّصة واحدة (معاملة
// ذرّية على الخادم) — لا نداءات CRUD منفصلة لكل طالب. انظر backend/src/routes/
// materialDistribution.js وتقرير قرار Phase 3B-12 (النوع/legacy_metadata/idempotency).
// ═══════════════════════════════════════════════════════════════════════════

// pgSaveMaterialDistribution: PUT /api/material-distributions/:materialId
// records: [{ studentId, received, payStatus, paidAmount, receivedAt }]. الخادم يُسوّي
// (reconcile) كل طالب مقابل تاريخه الفعلي — لا يُرسَل أي رقم/id من هنا، ولا يُحسَب أي
// شيء محلياً؛ الاستجابة (records) بنفس شكل matDist الحالي تماماً، جاهزة للتبنّي مباشرة.
export async function pgSaveMaterialDistribution(materialId, records) {
  const res = await fetch(`${PG_API_BASE}/api/material-distributions/${encodeURIComponent(materialId)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /material-distributions/${materialId} → ${res.status}`);
  return json.data; // { materialId, records: [...] }
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-13A — admissions (السجل الأساسي فقط) + admissionFollowups/
// admissionSystemLog (جداول ابن علائقية حقيقية) عبر الـ CRUD العام. admission_payments
// يبقى خارج النطاق تماماً (محلي بحت، مسدود بانتظار هجرة النطاق المالي — انظر تقرير
// قرار Phase 3B-13A). لا نقطة نهاية مخصّصة هنا — كل عملية سجل واحد بسيط.
// ═══════════════════════════════════════════════════════════════════════════

// admissions.reservation_date هو @db.Date — نفس مشكلة exams.date بالضبط (الـ CRUD
// العام يمرّر التاريخ كما وصل مباشرة لـ Prisma، الذي يرفض "YYYY-MM-DD" وحدها لعمود
// @db.Date). نُعيد استخدام toRequestDate/toResponseDateOrNull الموجودتين أعلاه بالفعل
// لنفس السبب (exams/communications) — لا حاجة لتحويل جديد.

// confirmedGroupId/linkedStudentId اسمان محليان فقط (AdmissionsPage.jsx) لأعمدة حقيقية
// اسمها الفعلي group_id/student_id — نُسمّيهما صراحةً هنا حتى لا يفشل camelToSnake
// التلقائي بالخادم بصمت (confirmedGroupId → confirmed_group_id غير موجود). admissionNo
// كذلك اسم محلي فقط لعمود number الفريد الحقيقي.
// createdBy/lastModifiedBy مقصودان خارج هذه الدالة عمداً (بعكس بقية الحقول): بعكس
// communications.created_by (بلا أي قيد)، admissions لهما قيد مفتاح خارجي حقيقي على
// users.id. لو أُدرِجا هنا بقيمة data.createdBy الغائبة عادة عند التحديث، سيُرسَلان
// null صراحةً فيمسحان created_by الحقيقي في كل تحديث (تحديث جزئي عادي يعني: المفتاح
// غائب = لا لمس؛ المفتاح موجود بقيمة null = امسح). كل من pgCreateAdmission/
// pgUpdateAdmission يضيف الحقل الصحيح له فقط أدناه.
function buildAdmissionRequestBody(data) {
  return {
    name:              data.name,
    parentName:        data.parentName ?? null,
    phone:             data.phone ?? null,
    parentPhone:       data.parentPhone ?? null,
    grade:             data.grade ?? null,
    school:            data.school ?? null,
    source:            data.source ?? null,
    notes:             data.notes ?? null,
    stage:             data.stage,
    leadStatus:        data.leadStatus ?? null,
    reservationStatus: data.reservationStatus ?? null,
    reservationDate:   toRequestDate(data.reservationDate),
    groupId:           data.confirmedGroupId ?? data.groupId ?? null,
    studentId:         data.linkedStudentId ?? data.studentId ?? null,
    courseFee:         data.courseFee === '' || data.courseFee === undefined || data.courseFee === null
                          ? null
                          : Number(data.courseFee),
  };
}

// number/reservationDate/courseFee فقط تحتاج تطبيعاً؛ studentId/groupId يُعادان أيضاً
// باسميهما المحليين (linkedStudentId/confirmedGroupId) حتى تبقى AdmissionsPage.jsx كما
// هي بلا أي تعديل في أسماء الحقول التي تقرأها.
function normalizeAdmissionResponse(data) {
  const { number, studentId, groupId, ...rest } = data;
  return {
    ...rest,
    admissionNo:      number ?? null,
    linkedStudentId:  studentId ?? null,
    confirmedGroupId: groupId ?? null,
    reservationDate:  toResponseDateOrNull(data.reservationDate),
    courseFee:        data.courseFee !== undefined && data.courseFee !== null ? Number(data.courseFee) : data.courseFee,
  };
}

// pgCreateAdmission: POST /api/admissions، مع إعادة محاولة واحدة مضبوطة عند تعارض
// admissions.number (UNIQUE) فقط — نفس نمط pgCreateCommunication/pgCreateMaterial
// بالضبط: العميل يحسب الرقم الأولي محلياً (nextAdmissionNumber في AdmissionsPage.jsx)،
// ولا "توليد من جهة الخادم" حقيقياً (لا نقطة نهاية مخصّصة هنا تسمح بذلك — القرار
// المصحَّح لتقرير Phase 3B-13A). options.computeNextNumber (اختيارية): async () =>
// string — تُستدعى مرة واحدة فقط لو رفض الخادم تحديداً بسبب تعارض number (409).
// admissions ضمن PRESERVE_CLIENT_ID_COLLECTIONS بالخادم (server.js) — id المحلي
// (adm_${Date.now()}) يبقى كما هو، لا UUID بديل.
export async function pgCreateAdmission(data, { computeNextNumber } = {}) {
  const attempt = async (body) => {
    const res = await fetch(`${PG_API_BASE}/api/admissions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { res, json };
  };

  const firstBody = {
    id: data.id, number: data.admissionNo, createdBy: data.createdBy ?? null,
    ...buildAdmissionRequestBody(data),
  };
  let { res, json } = await attempt(firstBody);

  const isNumberConflict = !res.ok && res.status === 409 && Array.isArray(json?.field) && json.field.includes('number');
  if (isNumberConflict && typeof computeNextNumber === 'function') {
    const newNumber = await computeNextNumber();
    ({ res, json } = await attempt({ ...firstBody, number: newNumber }));
  }

  if (!res.ok) throw new Error(json?.error || `PG POST /admissions → ${res.status}`);
  return normalizeAdmissionResponse(json.data);
}

// pgUpdateAdmission: PUT /api/admissions/:id. لا number ولا createdBy في الحمولة أبداً
// — رقم القبول ومنشئه ثابتان منذ الإنشاء (تحديث جزئي عادي، الخادم يبقيهما كما هما دون
// لمسهما). lastModifiedBy يُرسَل دائماً (معرّف المستخدم الحقيقي — مسؤولية المستدعي).
// last_modified_at بلا أي trigger على الخادم (بعكس updated_at بجداول أخرى تُدار عبر
// set_updated_at()) — يجب إرساله صراحةً من هنا، لا اعتماداً على أي تعيين تلقائي.
export async function pgUpdateAdmission(id, data) {
  const res = await fetch(`${PG_API_BASE}/api/admissions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...buildAdmissionRequestBody(data),
      lastModifiedBy: data.lastModifiedBy ?? null,
      lastModifiedAt: new Date().toISOString(),
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /admissions/${id} → ${res.status}`);
  return normalizeAdmissionResponse(json.data);
}

// pgActivateAdmission: PUT /api/admissions/:id/activate — Phase 3B-13B (Stage ii).
// معاملة ذرّية واحدة على الخادم (backend/src/routes/admissionActivation.js): تُنشئ
// الطالب، تحدّث سجل القبول (stage=active + student_id)، وتُسجّل حدثي firstLesson/
// activated النظاميين معاً — تحلّ محلّ تنسيق Stage (i) اليدوي عبر 4 طلبات منفصلة
// (pgCreateStudent + pgUpdateAdmission + logEvent×2، بلا أي ذرّية بينها).
// student: {name, phone, parentPhone, grade, groupId, school, notes, status} — لا id
// (يولّده الخادم داخل المعاملة، UUID دائماً — ليس ضمن PRESERVE_CLIENT_ID_COLLECTIONS،
// بعكس students العادي، لأنه يُنشأ ويُربَط في نفس الاستدعاء الذري، فلا حاجة للاحتفاظ
// بأي id محلي سابق). idempotent: إعادة الاستدعاء لسجل مفعَّل بالفعل تُعيد نفس الطالب
// المرتبط دون إنشاء طالب ثانٍ — آمن لإعادة المحاولة بعد انقطاع شبكة أو نقر مزدوج.
export async function pgActivateAdmission(admissionId, student) {
  const res = await fetch(`${PG_API_BASE}/api/admissions/${encodeURIComponent(admissionId)}/activate`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /admissions/${admissionId}/activate → ${res.status}`);
  return {
    admission:        normalizeAdmissionResponse(json.data.admission),
    student:          json.data.student,
    systemLogEntries: (json.data.systemLogEntries || []).map(normalizeAdmissionSystemLogResponse),
  };
}

// admission_followups.date هو @db.Date أيضاً — نفس التطبيع. employee عمود نصّي حرّ
// بلا أي قيد مفتاح خارجي (بعكس admissions.created_by) — اسم موظف نصي آمن هنا فعلاً.
function buildAdmissionFollowupRequestBody(data) {
  return {
    admissionId: data.admissionId,
    type:        data.type,
    note:        data.notes ?? data.note ?? null,
    employee:    data.by ?? data.employee ?? null,
    date:        toRequestDate(data.date ?? data.at),
  };
}

function normalizeAdmissionFollowupResponse(data) {
  const { note, employee, date, ...rest } = data;
  return { ...rest, notes: note ?? null, by: employee ?? null, at: toResponseDateOrNull(date) };
}

// pgCreateAdmissionFollowup: POST /api/admissionFollowups. سجل واحد بسيط دائماً — لا
// تحديث/حذف من أي واجهة حالياً. admissionFollowups ليست ضمن PRESERVE_CLIENT_ID_COLLECTIONS
// — الخادم يولّد UUID دائماً، استخدم دائماً id الاستجابة.
export async function pgCreateAdmissionFollowup(data) {
  const res = await fetch(`${PG_API_BASE}/api/admissionFollowups`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildAdmissionFollowupRequestBody(data)),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /admissionFollowups → ${res.status}`);
  return normalizeAdmissionFollowupResponse(json.data);
}

// admission_system_log.timestamp هو @db.Timestamptz(6) (بعكس followup.date) — يقبل ISO
// string كاملة مباشرة، فلا حاجة لأي تحويل هنا (نفس مبدأ absence_followup.followed_at).
// لا نرسل timestamp أبداً — للعمود @default(now())، الخادم يملؤه دائماً. by_user عمود
// نصّي حرّ بلا أي قيد مفتاح خارجي (بعكس admissions.created_by) — اسم موظف نصي آمن هنا.
function buildAdmissionSystemLogRequestBody(data) {
  return {
    admissionId:  data.admissionId,
    activityType: data.type ?? data.activityType,
    byUser:       data.by ?? data.byUser ?? null,
    details:      data.detail ?? data.details ?? null,
  };
}

// type/by/at/detail هي أسماء الحقول التي تقرأها AdmissionsPage.jsx فعلياً (DetailsPanel:
// ev.type/ev.detail/ev.at) — يجب إعادة تسميتها من activityType/byUser/timestamp/details.
function normalizeAdmissionSystemLogResponse(data) {
  const { activityType, byUser, timestamp, details, ...rest } = data;
  return { ...rest, type: activityType, by: byUser ?? null, at: timestamp, detail: details ?? null };
}

// pgCreateAdmissionSystemLog: POST /api/admissionSystemLog. سجل تدقيق تلقائي، إضافة
// فقط — الخادم يولّد UUID دائماً، ومحمي بـ trg_no_delete_admlog (لا حذف أبداً من أي
// واجهة، ولا نحاول).
export async function pgCreateAdmissionSystemLog(data) {
  const res = await fetch(`${PG_API_BASE}/api/admissionSystemLog`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildAdmissionSystemLogRequestBody(data)),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /admissionSystemLog → ${res.status}`);
  return normalizeAdmissionSystemLogResponse(json.data);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-14D — admission_payments عبر PostgreSQL (المصدر الوحيد للحقيقة). إنشاء
// دفعة قبول + حركة treasury_txn المرتبطة معاً (ذرّي، خطوتان فقط — لا رابط عكسي على
// treasury_txn يحتاج تحديثاً لاحقاً، بعكس payments في 3B-14C). إلغاء الحجز + استرداد كل
// دفعاته غير المستردة معاً في معاملة ذرّية واحدة منفصلة (backend/src/routes/
// admissionCancellation.js) — لا pgUpdateAdmissionPayment/pgDeleteAdmissionPayment
// عمداً، كلاهما محظور صراحةً بالخادم (405)، والحذف أيضاً على مستوى القاعدة
// (trg_no_delete_admission_payments، بلا استثناء).
// ═══════════════════════════════════════════════════════════════════════════

function normalizeAdmissionPaymentResponse(data) {
  return {
    ...data,
    amount: data.amount !== undefined && data.amount !== null ? Number(data.amount) : data.amount,
    date:   toResponseDateOrNull(data.date),
  };
}

// pgCreateAdmissionPayment: POST /api/admissionPayments — إنشاء ذرّي (دفعة قبول +
// حركة خزنة مرتبطة معاً). cashboxId مطلوب دائماً — لا اختيار ضمني لخزنة افتراضية (قرار
// صريح، مطابق لـ payments في 3B-14C). يعيد logs (سجلات النشاط النظامي التي أنشأها
// الخادم داخل نفس المعاملة) مطبَّعة بنفس شكل normalizeAdmissionSystemLogResponse —
// ليتبنّاها العميل فوراً في admissionSystemLog المحلي، بلا تغيير في السلوك الحالي.
export async function pgCreateAdmissionPayment(data) {
  const res = await fetch(`${PG_API_BASE}/api/admissionPayments`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /admissionPayments → ${res.status}`);
  return {
    payment:     normalizeAdmissionPaymentResponse(json.data.payment),
    treasuryTxn: normalizeTreasuryTxnResponse(json.data.treasuryTxn),
    logs:        (json.data.logs || []).map(normalizeAdmissionSystemLogResponse),
  };
}

// pgCancelAdmissionWithRefund: PUT /api/admissions/:id/cancel-with-refund — إلغاء
// الحجز + استرداد كل دفعاته غير المستردة، معاملة ذرّية واحدة لا تنقسم (Phase 3B-14D،
// Decision 4). يعيد { admission, refundTxns, logs } معاً — إما كلها أو لا شيء.
export async function pgCancelAdmissionWithRefund(admissionId, reason) {
  const res = await fetch(`${PG_API_BASE}/api/admissions/${encodeURIComponent(admissionId)}/cancel-with-refund`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /admissions/${admissionId}/cancel-with-refund → ${res.status}`);
  return {
    admission:  normalizeAdmissionResponse(json.data.admission),
    refundTxns: (json.data.refundTxns || []).map(normalizeTreasuryTxnResponse),
    logs:       (json.data.logs || []).map(normalizeAdmissionSystemLogResponse),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3B-15 — activity_logs عبر PostgreSQL (المصدر الوحيد للحقيقة الآن). لا
// pgUpdateActivityLog/pgDeleteActivityLog عمداً — كلاهما محظور صراحةً بالخادم (405)،
// والحذف أيضاً على مستوى القاعدة (trg_no_delete_activity، موجود من قبل هذه المرحلة).
// لا userId/userName يُرسَلان من هنا في الجسم كسلطة — الخادم يشتقّهما من الجلسة دائماً
// (انظر server.js)، وأي قيمة تُرسَل هنا لهما تُتجاهَل. الشكل المحلي (ts/description/user)
// يبقى كما هو تماماً — normalizeActivityLogResponse تُطبِّعه هنا، وCOLLECTION_FIXUPS
// تُطبِّق نفس التطبيع على مسار المزامنة (db.middleware.js) — لا تغيير في أي مستهلك قراءة.
function normalizeActivityLogResponse(data) {
  return {
    ...data,
    ts: data.timestamp,
    user: data.userName || 'النظام',
    description: data.details ?? '',
  };
}

// pgCreateActivityLog: POST /api/activityLogs. entry: {action, module, description,
// entityType?, entityId?} — description تُرسَل كـ details (لا عمود description على
// الجدول إطلاقاً، نفس نمط treasury_txn/notes).
export async function pgCreateActivityLog(entry) {
  const { description, ...rest } = entry;
  const res = await fetch(`${PG_API_BASE}/api/activityLogs`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...rest, details: description }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /activityLogs → ${res.status}`);
  return normalizeActivityLogResponse(json.data);
}

// pgLogout: يمسح كوكي الجلسة على الـ backend — best-effort، لا يُوقِف تسجيل الخروج المحلي لو فشل
export async function pgLogout() {
  try {
    await fetch(`${PG_API_BASE}/api/session`, {
      method: 'DELETE',
      credentials: 'include',
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* best-effort */ }
}

// فحص صحة الـ backend (متصل + قاعدة بيانات)
// يميّز بين: الـ backend غير متاح أصلاً، أو متاح لكن قاعدة البيانات غير متصلة
export async function pgCheckHealth() {
  let res;
  try {
    res = await fetch(`${PG_API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    return { ok: false, tableCount: null, connection: null, error: 'backend-unreachable' };
  }
  try {
    const json = await res.json();
    return {
      ok: !!json?.database?.connected,
      tableCount: json?.database?.tableCount ?? null,
      connection: json?.database?.connection ?? null,
      error: json?.database?.error ?? null,
    };
  } catch {
    return { ok: false, tableCount: null, connection: null, error: 'backend-unreachable' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Stabilization phase — Users/Roles CRUD عبر PostgreSQL (المصدر الوحيد للحقيقة).
// مسارات مخصّصة (users.js/roles.js بالخادم)، admin-only (requirePermission('users')).
// كلمة المرور تُرسَل خاماً (plain) فقط عند الإنشاء/التعديل — الخادم يُجزّئها، لا
// تُحسَب أبداً على المتصفح، ولا يُعاد password/passwordHash في أي استجابة.
// ═══════════════════════════════════════════════════════════════════════════

export async function pgGetUsers() {
  const res = await fetch(`${PG_API_BASE}/api/users`, { credentials: 'include' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG GET /users → ${res.status}`);
  return json.users;
}

export async function pgCreateUser(data) {
  const res = await fetch(`${PG_API_BASE}/api/users`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /users → ${res.status}`);
  return json.user;
}

export async function pgUpdateUser(id, data) {
  const res = await fetch(`${PG_API_BASE}/api/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /users/${id} → ${res.status}`);
  return json.user;
}

export async function pgDeleteUser(id) {
  const res = await fetch(`${PG_API_BASE}/api/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG DELETE /users/${id} → ${res.status}`);
  return true;
}

export async function pgGetRoles() {
  const res = await fetch(`${PG_API_BASE}/api/roles`, { credentials: 'include' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG GET /roles → ${res.status}`);
  return json.roles;
}

export async function pgCreateRole(data) {
  const res = await fetch(`${PG_API_BASE}/api/roles`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /roles → ${res.status}`);
  return json.role;
}

export async function pgUpdateRole(id, data) {
  const res = await fetch(`${PG_API_BASE}/api/roles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG PUT /roles/${id} → ${res.status}`);
  return json.role;
}

export async function pgDeleteRole(id) {
  const res = await fetch(`${PG_API_BASE}/api/roles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG DELETE /roles/${id} → ${res.status}`);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 4c — Support Access (يستهلك مسارات Phase 4b الأربعة كما هي، بلا أي تعديل عليها).
// admin-only حصراً بالخادم (requireRole('admin') — أعمق من requirePermission العادي،
// انظر backend/src/server.js) — لا فحص صلاحية إضافي هنا، الخادم هو المصدر المُعتمَد
// الوحيد. لا يُرسَل/يُخزَّن أي مفتاح خاص أو سرّ توقيع من هذا الملف أو أي مكان آخر في
// الفرونت-إند — فقط استدعاءات HTTP رقيقة، تماماً كبقية دوال pg* في هذا الملف.
// ═══════════════════════════════════════════════════════════════════════════

export async function pgGenerateSupportChallenge() {
  const res = await fetch(`${PG_API_BASE}/api/support-access/challenge`, {
    method: 'POST',
    credentials: 'include',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /support-access/challenge → ${res.status}`);
  return json; // { ok, challenge, installationId, expiresAt, ttlMs }
}

export async function pgVerifySupportChallenge(challenge, response) {
  const res = await fetch(`${PG_API_BASE}/api/support-access/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge, response }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /support-access/verify → ${res.status}`);
  return json; // { ok, sessionId, issuedAt, expiresAt }
}

export async function pgGetSupportAccessStatus() {
  const res = await fetch(`${PG_API_BASE}/api/support-access/status`, { credentials: 'include' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG GET /support-access/status → ${res.status}`);
  return json; // { ok, active, session }
}

export async function pgRevokeSupportAccess() {
  const res = await fetch(`${PG_API_BASE}/api/support-access/revoke`, {
    method: 'POST',
    credentials: 'include',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /support-access/revoke → ${res.status}`);
  return json; // { ok, revokedChallenge, revokedSession }
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 5c — Licensing/Activation (يستهلك مسارات Phase 5b الثلاثة كما هي، بلا أي تعديل
// عليها). /api/license/status و/api/license/request-code admin-only حصراً بالخادم
// (requireRole('admin') — نفس حارس Support Access بالضبط، انظر backend/src/server.js).
// لا فحص/توليد توقيع من هذا الملف أو أي مكان آخر في الفرونت-إند — فقط استدعاءات HTTP
// رقيقة، الخادم هو المرجع الوحيد المُعتمَد لحالة التفعيل دائماً.
// ═══════════════════════════════════════════════════════════════════════════

export async function pgGetLicenseStatus() {
  const res = await fetch(`${PG_API_BASE}/api/license/status`, { credentials: 'include' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG GET /license/status → ${res.status}`);
  return json; // { ok, activated, reason, licenseId, product, expiresAt, features }
}

export async function pgRequestLicenseActivationCode() {
  const res = await fetch(`${PG_API_BASE}/api/license/request-code`, {
    method: 'POST',
    credentials: 'include',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /license/request-code → ${res.status}`);
  return json; // { ok, code, installationId, product }
}

export async function pgActivateLicense(artifact) {
  const res = await fetch(`${PG_API_BASE}/api/license/activate`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artifact }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG POST /license/activate → ${res.status}`);
  return json; // { ok, licenseId, product, expiresAt, features }
}

// pgProbeActivation: للمستخدمين غير المديرين حصراً — /api/license/status محمي بـ
// requireRole('admin')، فيرفض أي غير مدير بـ 403 بصرف النظر عن حالة التفعيل (غير مفيد
// للكشف هنا، لا نستطيع تمييز "غير مدير" عن "غير مفعَّل" من رمز 403 وحده). نستكشف بدلاً
// منه عبر أي مسار عادي غير مُستثنى من requireActivation — centerProfile هنا: بسيط وخفيف
// وGET فقط. الترتيب الفعلي في server.js (requireActivation عالمياً، قبل أي فحص صلاحية
// خاص بالمسار المُستهدَف) يضمن أن استجابة 402 منه صحيحة دائماً بصرف النظر عمّا إذا كان
// هذا المستخدم يملك صلاحية 'settings' أصلاً أم لا — أي مسار API آخر غير مُستثنى كان
// سيعطي نفس النتيجة، هذا الاختيار تحديداً بلا أي أهمية أمنية خاصة.
export async function pgProbeActivation() {
  try {
    const res = await fetch(`${PG_API_BASE}/api/centerProfile`, {
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 402) return { blocked: true };
    return { blocked: false }; // 200 (مُفعَّل) أو 403 (مُفعَّل لكن بلا صلاحية 'settings') — كلاهما "غير محجوب بالترخيص"
  } catch {
    return { blocked: null }; // تعذّر الوصول للخادم أصلاً — حالة مختلفة عن "محجوب"، تُعامَل بشكل منفصل
  }
}
