// migration/import-postgres.js
// ═══════════════════════════════════════════════════════════════════════════
// استيراد بيانات localStorage إلى PostgreSQL — DRY-RUN افتراضياً.
//
// ⚠️  لا يُدرج أي شيء إلا بتمرير --execute صراحةً (خطوة لاحقة بعد موافقتك).
//     الوضع الافتراضي: يحلّل، يحوّل، يبني التقارير — بلا كتابة للقاعدة.
//
// المبدأ الحاكم: NO INVENTED MONEY · NO LOST DATA · NO INVENTED BUSINESS LOGIC.
//
// الاستخدام:
//   node import-postgres.js --file=studix-localstorage-backup.json            (dry-run)
//   node import-postgres.js --file=studix-localstorage-backup.json --execute  (تنفيذ فعلي — لاحقاً)
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MAPS } from './mapping/fieldMaps.js';
import { normalizePhone } from './mapping/normalizePhone.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── قراءة الوسائط ───
const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const fileArg = args.find((a) => a.startsWith('--file='));
const FILE = fileArg ? fileArg.split('=')[1] : 'studix-localstorage-backup.json';

// ─── حاويات التقارير ───
const summary = {};                 // لكل collection: عدّادات
const exceptions = [];              // سجلات لا تُرحّل بأمان
const financialReview = [];         // سجلات مالية تحتاج مراجعة يدوية
const duplicateCandidates = [];     // مرشّحو الدمج
const unmappedFields = {};          // حقول بلا mapping

function track(collection, key) {
  if (!summary[collection]) summary[collection] = { source: 0, mapped: 0, skipped: 0, exceptions: 0 };
  summary[collection][key]++;
}

// ─── تحويل سجل حسب الخريطة ───
function mapRecord(collection, rec) {
  const map = MAPS[collection];
  if (!map) return null;
  const out = {};
  const seen = new Set();
  for (const [appKey, dbCol] of Object.entries(map.fields)) {
    seen.add(appKey);
    if (dbCol === null) continue;      // معالجة خاصة (مثل parentPhone)
    if (rec[appKey] !== undefined) out[dbCol] = rec[appKey];
  }
  // رصد الحقول غير المُعرّفة (لا نفقدها صامتين)
  for (const k of Object.keys(rec)) {
    if (!seen.has(k)) {
      if (!unmappedFields[collection]) unmappedFields[collection] = new Set();
      unmappedFields[collection].add(k);
    }
  }
  return out;
}

// ═══════════════════ التحميل ═══════════════════
const filePath = path.isAbsolute(FILE) ? FILE : path.join(__dirname, FILE);
if (!fs.existsSync(filePath)) {
  console.error(`\n❌ ملف النسخة الاحتياطية غير موجود: ${filePath}`);
  console.error('   شغّل export-localstorage.js أولاً واحفظ الملف هنا.\n');
  process.exit(1);
}

const backup = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const main = backup.keys?.['studix-v1']?.state || backup.keys?.['studix-v1'] || {};
const authUsers = backup.keys?.['studix-auth-users'] || [];
const authRoles = backup.keys?.['studix-auth-roles'] || [];
const authTeachers = backup.keys?.['studix-auth-teachers'] || [];

console.log(`\n═══ Studix Migration — ${EXECUTE ? '⚠️ EXECUTE MODE' : '🔒 DRY-RUN (آمن)'} ═══\n`);
console.log(`المصدر: ${filePath}\n`);

// ═══════════════════ 1) بناء parents (deterministic) ═══════════════════
// من الأرقام المطبّعة الفريدة في students + admissions + communications.
const parentsByPhone = new Map();   // normalizedPhone → { id, ... }
let parentSeq = 1;

function ensureParent(rawPhone, name) {
  const norm = normalizePhone(rawPhone);
  if (!norm) return null;            // رقم غير صالح/فارغ → لا parent (student.parent_id=null)
  if (parentsByPhone.has(norm)) {
    // مرشّح دمج إن اختلف الاسم
    const existing = parentsByPhone.get(norm);
    if (name && existing.full_name && existing.full_name !== name) {
      duplicateCandidates.push({ type: 'parent', phone: norm, names: [existing.full_name, name] });
    }
    return existing;
  }
  const parent = { id: parentSeq++, full_name: name || null, phone: norm };
  parentsByPhone.set(norm, parent);
  return parent;
}

const students = main.students || [];
const admissions = main.admissions || [];
const communications = main.communications || [];

// نبني parents من الطلاب أولاً (أوثق مصدر)
for (const s of students) ensureParent(s.parentPhone, s.parentName || s.name);
for (const a of admissions) ensureParent(a.parentPhone || a.phone, a.parentName);
for (const c of communications) ensureParent(c.phone, c.parentName);

track('parents', 'source'); // رمزي
summary.parents = { source: parentsByPhone.size, mapped: parentsByPhone.size, skipped: 0, exceptions: 0 };

// ═══════════════════ 2) الكيانات المباشرة ═══════════════════
const OUTPUT = {};   // table → [rows]

function processCollection(collection) {
  const rows = main[collection] || [];
  const mapped = [];
  for (const rec of rows) {
    track(collection, 'source');
    const m = mapRecord(collection, rec);
    if (!m) { track(collection, 'skipped'); continue; }

    // ربط parent للطلاب
    if (collection === 'students') {
      const p = parentsByPhone.get(normalizePhone(rec.parentPhone));
      m.parent_id = p ? p.id : null;
    }

    mapped.push(m);
    track(collection, 'mapped');
  }
  OUTPUT[MAPS[collection]?.table || collection] = mapped;
}

// الترتيب يحترم الـ FKs
const DIRECT = [
  'groups', 'teachers', 'students', 'exams', 'grades', 'homeworks',
  'hwSubmissions', 'attendance', 'absenceFollowup', 'cashboxes',
  'invMaterials', 'inventoryTxn', 'inventorySettings', 'admissions',
  'communications', 'commTasks', 'activityLogs', 'waReportLog', 'centerProfile',
];
for (const c of DIRECT) processCollection(c);

// ═══════════════════ 3) treasury + payments (NO INVENTED MONEY) ═══════════════════
const treasuryTxns = main.treasuryTxn || [];
const payments = main.payments || [];

// خريطة: paymentId → treasury_txn (عبر refType='payment', refId)
const treasuryByPaymentId = new Map();
for (const t of treasuryTxns) {
  if (t.refType === 'payment' && t.refId) treasuryByPaymentId.set(t.refId, t.id);
}

// treasury_txn تُرحّل كما هي
OUTPUT['treasury_txn'] = treasuryTxns.map((t) => {
  track('treasuryTxn', 'source');
  const m = mapRecord('treasuryTxn', t);
  track('treasuryTxn', 'mapped');
  return m;
});

// payments: ربط بالخزنة إن وُجدت؛ وإلا → استثناء تاريخي (لا treasury وهمية)
OUTPUT['payments'] = payments.map((p) => {
  track('payments', 'source');
  const m = mapRecord('payments', p);
  const txId = treasuryByPaymentId.get(p.id);
  if (txId) {
    m.treasury_txn_id = txId;
  } else {
    m.treasury_txn_id = null;   // NO INVENTED MONEY
    financialReview.push({
      type: 'payment_without_treasury',
      paymentId: p.id, studentId: p.studentId, amount: p.amount, date: p.date,
      note: 'دفعة تاريخية بلا حركة خزنة — تُرحّل كما هي، لا treasury مخترعة.',
    });
  }
  track('payments', 'mapped');
  return m;
});

// ═══════════════════ 4) admission children (من المصفوفات المدمجة) ═══════════════════
const admPayments = [], admFollowups = [], admLogs = [];
for (const a of admissions) {
  for (const p of (a.payments || [])) {
    const txId = treasuryByPaymentId.get(p.id) ||
      (treasuryTxns.find((t) => t.admissionId === a.id && t.sourceDocNo === a.number)?.id) || null;
    if (!txId) {
      financialReview.push({
        type: 'admission_payment_without_treasury',
        admissionId: a.id, amount: p.amount,
        note: 'دفعة قبول بلا حركة خزنة — تُرحّل كما هي.',
      });
    }
    admPayments.push({
      id: p.id, admission_id: a.id, type: p.type, amount: p.amount,
      date: p.date, method: p.method || 'cash', notes: p.notes || null,
      treasury_txn_id: txId,
    });
  }
  for (const f of (a.followups || [])) {
    admFollowups.push({
      id: f.id, admission_id: a.id, type: f.type, note: f.note,
      employee: f.employee, date: f.date,
    });
  }
  for (const l of (a.systemLog || a.systemEvents || [])) {
    admLogs.push({
      id: l.id, admission_id: a.id, activity_type: l.activityType || l.type,
      timestamp: l.timestamp, by_user: l.by, details: l.details,
    });
  }
}
OUTPUT['admission_payments'] = admPayments;
OUTPUT['admission_followups'] = admFollowups;
OUTPUT['admission_system_log'] = admLogs;
summary.admission_payments = { source: admPayments.length, mapped: admPayments.length, skipped: 0, exceptions: 0 };

// ═══════════════════ 5) matDist → inventory_txn (القرارات 2+3) ═══════════════════
const matDist = main.matDist || [];
const matDistTxns = [];
for (const d of matDist) {
  track('matDist', 'source');
  // received=true → studentDelivery ؛ received=false → reservation
  const type = d.received ? 'studentDelivery' : 'reservation';
  // بحث عن payment حقيقي مقابل (student + material)
  const realPayment = payments.find((p) => p.studentId === d.studentId && p.materialId === d.matId);
  const txn = {
    id: d.id || `invmig_${d.matId}_${d.studentId}`,
    number: null,  // يُولّد من sequence عند التنفيذ الفعلي
    material_id: d.matId,
    type,
    quantity: d.qty || d.quantity || 1,
    student_id: d.studentId || null,
    status: 'active',
    payment_id: realPayment ? realPayment.id : null,
    // القرار 2: الحقول المالية القديمة كـ legacy metadata — بلا أثر مالي
    legacy_metadata: {
      source: 'matDist',
      payStatus: d.payStatus ?? null,
      paidAmount: d.paidAmount ?? null,   // ليس treasury — معلومة تاريخية فقط
      received: d.received ?? null,
      receivedAt: d.receivedAt ?? null,
    },
  };
  // لو paidAmount موجود بلا payment حقيقي → مراجعة مالية (لا treasury مخترعة)
  if ((d.paidAmount ?? 0) > 0 && !realPayment) {
    financialReview.push({
      type: 'matdist_paid_without_treasury',
      matId: d.matId, studentId: d.studentId, paidAmount: d.paidAmount, payStatus: d.payStatus,
      note: 'مبلغ مذكرة تاريخي بلا خزنة/دفعة — محفوظ كـ legacy_metadata فقط. NO INVENTED MONEY.',
    });
  }
  matDistTxns.push(txn);
  track('matDist', 'mapped');
}
// تُضاف لحركات المخزون
OUTPUT['inventory_txn'] = [...(OUTPUT['inventory_txn'] || []), ...matDistTxns];

// ═══════════════════ 6) auth → users/roles/teachers ═══════════════════
OUTPUT['roles'] = (authRoles.length ? authRoles : []).map((r) => ({
  id: r.id, label: r.label, color: r.color, is_system: r.isSystem ?? false,
  permissions: r.permissions ?? null, description: r.description ?? null,
}));
OUTPUT['users'] = (authUsers.length ? authUsers : []).map((u) => {
  const m = {
    id: u.id, name: u.name, role_id: u.role, is_admin: u.isAdmin ?? false,
    active: u.active ?? true, permissions: u.permissions ?? null,
    email: u.email ?? null, created_at: u.createdAt ?? null,
    password_hash: u.password ?? null,   // ملاحظة: كلمة مرور نصّية قديمة — تحتاج hashing لاحقاً
  };
  if (u.password) {
    exceptions.push({ type: 'plaintext_password', userId: u.id, note: 'كلمة مرور نصّية — تحتاج hashing قبل الإنتاج.' });
  }
  return m;
});
summary.roles = { source: authRoles.length, mapped: OUTPUT['roles'].length, skipped: 0, exceptions: 0 };
summary.users = { source: authUsers.length, mapped: OUTPUT['users'].length, skipped: 0, exceptions: 0 };

// parents للإخراج
OUTPUT['parents'] = Array.from(parentsByPhone.values());

// ═══════════════════ كتابة التقارير ═══════════════════
const reportsDir = path.join(__dirname, 'reports');
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

// تحويل unmappedFields (Set → Array)
const unmappedOut = {};
for (const [k, v] of Object.entries(unmappedFields)) unmappedOut[k] = Array.from(v);

const report = {
  mode: EXECUTE ? 'execute' : 'dry-run',
  generatedAt: new Date().toISOString(),
  summary,
  totals: {
    tables_targeted: Object.keys(OUTPUT).length,
    parents_built: parentsByPhone.size,
    exceptions: exceptions.length,
    financial_review: financialReview.length,
    duplicate_candidates: duplicateCandidates.length,
  },
  unmappedFields: unmappedOut,
  financialReview,
  duplicateCandidates,
  exceptions,
};

fs.writeFileSync(path.join(reportsDir, 'migration-summary.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(reportsDir, 'mapped-output-preview.json'), JSON.stringify(OUTPUT, null, 2));

// ═══════════════════ الطباعة ═══════════════════
console.log('── ملخّص التحويل (لكل collection) ──');
for (const [c, s] of Object.entries(summary)) {
  console.log(`  ${c.padEnd(20)} مصدر:${s.source}  محوّل:${s.mapped}  متخطّى:${s.skipped}`);
}
console.log(`\n  parents مبنيّون: ${parentsByPhone.size}`);
console.log(`  استثناءات: ${exceptions.length}`);
console.log(`  مراجعة مالية: ${financialReview.length}`);
console.log(`  مرشّحو دمج: ${duplicateCandidates.length}`);
console.log(`\n  📄 التقارير في: migration/reports/`);
console.log(`     - migration-summary.json`);
console.log(`     - mapped-output-preview.json`);

if (!EXECUTE) {
  console.log(`\n🔒 DRY-RUN — لم يُكتب أي شيء لقاعدة البيانات.`);
  console.log(`   للتنفيذ الفعلي لاحقاً (بعد الموافقة): أضف --execute`);
} else {
  console.log(`\n⚠️  EXECUTE MODE — سيتطلب اتصال Prisma (يُضاف في خطوة لاحقة).`);
  console.log(`   حالياً: التحويل والتقارير فقط. الإدراج الفعلي يحتاج تفعيل Prisma writes.`);
}
console.log();
