// backend/src/routes/crudPolicies.js
// ─────────────────────────────────────────────────────────────
// P2-1 — domain-rule policies for the generic CRUD router (crud.js / makeCrudRouter). The
// generic router must never be a second path around a rule a dedicated domain API enforces.
// Each entry is keyed by the /api/<collection> path (collections.js) and may declare:
//
//   blockCreate / blockUpdate / blockDelete : string — that generic method answers 405 with
//       this message (the dedicated API named in it is the only write path).
//   createFields : string[] — snake_case columns a generic POST may write. Any other column
//       carrying a non-null value is rejected with 400 (nulls are dropped, so a client that
//       sends empty optional fields keeps working). Fields a route interceptor fills from the
//       session (created_by, user_id, user_name) are listed here because the interceptor has
//       already overwritten whatever the client sent.
//   createFixed : { column: value } — the only value a generic POST may store for that column
//       (absent/null -> the fixed value; anything else -> 400).
//   validateUpdate({ id, data, db }) : async — runs before a generic PUT/PATCH writes; may
//       remove no-op fields from `data`, or throw an HTTP error (status + expose).
//
// Collections not listed here keep their existing generic behavior unchanged.
// ─────────────────────────────────────────────────────────────
import { Prisma } from '@prisma/client';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

function hasField(data, field) {
  return Object.prototype.hasOwnProperty.call(data, field);
}

function toDecimalOrThrow(value, label) {
  try {
    const d = new Prisma.Decimal(value);
    if (!d.isFinite()) throw new Error('not finite');
    return d;
  } catch {
    throw httpError(400, `${label} غير صالح.`);
  }
}

// cashboxes.opening_balance is the base every historical balance of that cashbox is computed
// from — changing it after creation silently rewrites all past balances. The edit form re-sends
// the whole cashbox, so an UNCHANGED value is accepted (and dropped from the write); a changed
// value is refused. Corrections go through a treasury transaction instead.
async function validateCashboxUpdate({ id, data, db }) {
  if (!hasField(data, 'opening_balance')) return;
  const current = await db.cashboxes.findUnique({ where: { id }, select: { opening_balance: true } });
  if (!current) throw httpError(404, 'السجل غير موجود.');
  const requested = toDecimalOrThrow(data.opening_balance, 'الرصيد الافتتاحي');
  if (!requested.equals(current.opening_balance)) {
    throw httpError(409, 'لا يمكن تعديل الرصيد الافتتاحي للخزنة بعد إنشائها — سجّل حركة إيراد/مصروف (تسوية) بدلاً من ذلك.');
  }
  delete data.opening_balance;
}

// exams.total / homeworks.total_score are the upper bound /api/exam-grades and
// /api/hw-submissions enforce on every score. Lowering the total below a score that is already
// saved would make that score exceed its total without ever touching the score itself.
function validateTotalNotBelowScores({ totalField, scoreModel, fkField, label }) {
  return async ({ id, data, db }) => {
    if (!hasField(data, totalField) || data[totalField] === null) return;
    const requested = toDecimalOrThrow(data[totalField], label);
    const agg = await db[scoreModel].aggregate({ where: { [fkField]: id }, _max: { score: true } });
    const maxScore = agg._max.score;
    if (maxScore !== null && maxScore !== undefined && requested.lessThan(maxScore)) {
      throw httpError(
        409,
        `لا يمكن جعل ${label} (${requested}) أقل من أعلى درجة مسجَّلة بالفعل (${maxScore}) — عدّل الدرجات أولاً.`
      );
    }
  };
}

export const CRUD_POLICIES = Object.freeze({
  // Attendance rows are written only by /api/attendance-sessions (completed-session lock,
  // enrollment eligibility, one transaction per session).
  attendance: {
    blockCreate: 'تسجيل الحضور يتمّ عبر /api/attendance-sessions فقط (يحترم قفل الجلسات المكتملة).',
    blockUpdate: 'تعديل الحضور يتمّ عبر /api/attendance-sessions فقط (يحترم قفل الجلسات المكتملة).',
    blockDelete: 'حذف سجلات الحضور مباشرةً غير متاح — استخدم /api/attendance-sessions.',
  },
  // Grades are written only by /api/exam-grades (score ≤ exam total, eligibility).
  grades: {
    blockCreate: 'الدرجات تُحفَظ عبر /api/exam-grades فقط (تتحقّق من ألّا تتجاوز الدرجة الكلية).',
    blockUpdate: 'الدرجات تُعدَّل عبر /api/exam-grades فقط (تتحقّق من ألّا تتجاوز الدرجة الكلية).',
    blockDelete: 'حذف الدرجات مباشرةً غير متاح — استخدم /api/exam-grades.',
  },
  // Homework submissions are written only by /api/hw-submissions (score ≤ total_score).
  hwSubmissions: {
    blockCreate: 'تسليمات الواجبات تُحفَظ عبر /api/hw-submissions فقط (تتحقّق من ألّا تتجاوز الدرجة الكلية).',
    blockUpdate: 'تسليمات الواجبات تُعدَّل عبر /api/hw-submissions فقط (تتحقّق من ألّا تتجاوز الدرجة الكلية).',
    blockDelete: 'حذف تسليمات الواجبات مباشرةً غير متاح — استخدم /api/hw-submissions.',
  },
  exams: {
    validateUpdate: validateTotalNotBelowScores({ totalField: 'total', scoreModel: 'grades', fkField: 'exam_id', label: 'الدرجة الكلية للامتحان' }),
  },
  homeworks: {
    validateUpdate: validateTotalNotBelowScores({ totalField: 'total_score', scoreModel: 'hw_submissions', fkField: 'homework_id', label: 'الدرجة الكلية للواجب' }),
  },
  // Inventory ledger: created only by /api/inventoryTxn (dedicated POST) and
  // /api/material-distributions; history is append-only.
  inventoryTxn: {
    blockUpdate: 'حركات المخزون سجلات ثابتة — لا يمكن تعديلها. سجّل حركة تسوية جديدة بدلاً من ذلك.',
    blockDelete: 'حذف حركات المخزون غير متاح — الدفتر append-only.',
  },
  // Admissions audit trail: append-only; the timestamp is always the server's.
  admissionSystemLog: {
    createFields: ['admission_id', 'activity_type', 'by_user', 'details'],
    blockUpdate: 'سجل نظام القبول append-only — لا تعديل.',
    blockDelete: 'سجل نظام القبول append-only — لا حذف.',
  },
  cashboxes: {
    validateUpdate: validateCashboxUpdate,
  },
  // Manual treasury entry (income/expense) — the only generic write left on the ledger.
  // Reversals, transfers, payment- and admission-linked entries are created exclusively by
  // their dedicated atomic APIs, so their link/state columns are never client-writable here.
  treasuryTxn: {
    createFields: ['cashbox_id', 'date', 'type', 'category', 'amount', 'method', 'party', 'notes', 'status', 'created_by'],
    createFixed: { status: 'active' },
  },
  // Activity log: append-only; actor fields come from the session (activityLogs.js), the
  // timestamp from the database.
  activityLogs: {
    createFields: ['action', 'module', 'entity_type', 'entity_id', 'details', 'user_id', 'user_name'],
  },
  // Financial records: never writable through the generic router (also read-only in
  // server.js and blocked again by their dedicated routers).
  payments: {
    blockCreate: 'الدفعات تُنشأ عبر POST /api/payments المخصّص فقط.',
    blockUpdate: 'الدفعات سجلات ثابتة — استخدم الاسترداد.',
    blockDelete: 'الدفعات append-only — استخدم الاسترداد.',
  },
  admissionPayments: {
    blockCreate: 'دفعات القبول تُنشأ عبر POST /api/admissionPayments المخصّص فقط.',
    blockUpdate: 'دفعات القبول سجلات ثابتة — استخدم إلغاء الحجز مع الاسترداد.',
    blockDelete: 'دفعات القبول append-only — استخدم إلغاء الحجز مع الاسترداد.',
  },
});

// enforceCreatePolicy: applied to the prepared (snake_case, known-columns-only) POST data.
export function enforceCreatePolicy(policy, data) {
  if (!policy) return data;
  if (policy.createFields) {
    const allowed = new Set(policy.createFields);
    for (const [key, value] of Object.entries(data)) {
      if (allowed.has(key)) continue;
      if (value === null || value === undefined) {
        delete data[key];
        continue;
      }
      throw httpError(400, `الحقل "${key}" غير قابل للكتابة عبر هذا المسار.`);
    }
  }
  for (const [key, fixed] of Object.entries(policy.createFixed || {})) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== fixed) {
      throw httpError(400, `القيمة "${data[key]}" غير مسموحة للحقل "${key}" عبر هذا المسار.`);
    }
    data[key] = fixed;
  }
  return data;
}
