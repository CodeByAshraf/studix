// backend/src/test-helpers/scratchDbFullSchema.js
// ─────────────────────────────────────────────────────────────
// Database Installation Package pass — DDL كامل (كل الجداول الـ27) لازم لإنتاج
// studix-schema.sql، وسِعته أكبر من scratchDbConstraints.js (MEDIUM-B2) الذي غطّى فقط
// payments/treasury_txn عمداً بموافقة محدودة النطاق وقتها. هذا ملف جديد منفصل — لا يُعدِّل
// scratchDbConstraints.js إطلاقاً (يبقى صحيحاً كما هو، subset مُتحقَّق منه ومُستخدَم في
// dbConstraints.integration.test.js دون تغيير).
//
// مصدر كل نص أدناه: استعلامات SELECT للقراءة فقط على قاعدة studix الحقيقية، حرفياً عبر
// pg_get_functiondef()/pg_get_triggerdef()/pg_get_constraintdef()/pg_get_indexdef() — بلا
// فلترة على جدول معيّن هذه المرة (كل الـ27 جدولاً). أُلتُقطت أثناء "Database Installation
// Package investigation" (القراءة فقط، بلا أي تعديل على studix). العدد الحقيقي المُتحقَّق
// منه عبر COUNT مباشر: 13 trigger، 4 functions، 45 CHECK constraint (وليس 43 كما قُدِّر
// تقريبياً في التقرير السابق قبل العدّ الدقيق)، و2 فهرس UNIQUE جزئي (partial) اكتُشفا فقط
// أثناء مقارنة جرد studix-schema.sql المُولَّد مقابل studix الحقيقية (12 فهرساً فريداً حياً
// مقابل 10 فقط ممثَّلة في schema.prisma) — هذا الملف هو مصدر الحقيقة المُتحقَّق منه.
//
// يُستثنى عمداً (قرار المستخدم الصريح): 6 views و5 sequences غير مُستخدَمة في أي كود تطبيق
// (تحقّق عبر grep شامل على backend/src وsrc، وعبر pg_attrdef لتأكيد عدم استخدام أي
// sequence في أي DEFAULT عمود) — لا تُدرَج هنا ولا في studix-schema.sql الناتج.
//
// لو تغيّرت الـ triggers/constraints الحقيقية مستقبلاً، هذا الملف يحتاج مزامنة يدوية جديدة
// — لا آلية تلقائية تُبقيه متزامناً مع studix.
// ─────────────────────────────────────────────────────────────

const FUNCTIONS = [
  `CREATE OR REPLACE FUNCTION public.prevent_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'الحذف ممنوع على هذا الجدول (append-only). استخدم status = cancelled/archived.';
END;
$function$`,
  `CREATE OR REPLACE FUNCTION public.enforce_payment_treasury()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- تخطّي التحقق أثناء الترحيل التاريخي
  IF current_setting('studix.migration_mode', TRUE) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.treasury_txn_id IS NULL THEN
    RAISE EXCEPTION 'كل دفعة جديدة يجب أن ترتبط بحركة خزنة (treasury_txn_id مطلوب).';
  END IF;
  RETURN NEW;
END;
$function$`,
  `CREATE OR REPLACE FUNCTION public.enforce_admpay_treasury()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF current_setting('studix.migration_mode', TRUE) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.treasury_txn_id IS NULL THEN
    RAISE EXCEPTION 'كل دفعة قبول جديدة يجب أن ترتبط بحركة خزنة.';
  END IF;
  RETURN NEW;
END;
$function$`,
  `CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$`,
];

const TRIGGERS = [
  `CREATE TRIGGER trg_no_delete_activity BEFORE DELETE ON public.activity_logs FOR EACH ROW EXECUTE FUNCTION prevent_delete()`,
  `CREATE TRIGGER trg_admpay_needs_treasury BEFORE INSERT ON public.admission_payments FOR EACH ROW EXECUTE FUNCTION enforce_admpay_treasury()`,
  `CREATE TRIGGER trg_no_delete_admission_payments BEFORE DELETE ON public.admission_payments FOR EACH ROW EXECUTE FUNCTION prevent_delete()`,
  `CREATE TRIGGER trg_no_delete_admlog BEFORE DELETE ON public.admission_system_log FOR EACH ROW EXECUTE FUNCTION prevent_delete()`,
  `CREATE TRIGGER trg_center_updated BEFORE UPDATE ON public.center_profile FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `CREATE TRIGGER trg_communications_updated BEFORE UPDATE ON public.communications FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `CREATE TRIGGER trg_no_delete_comm BEFORE DELETE ON public.communications FOR EACH ROW EXECUTE FUNCTION prevent_delete()`,
  `CREATE TRIGGER trg_no_delete_inventory BEFORE DELETE ON public.inventory_txn FOR EACH ROW EXECUTE FUNCTION prevent_delete()`,
  `CREATE TRIGGER trg_parents_updated BEFORE UPDATE ON public.parents FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `CREATE TRIGGER trg_no_delete_payments BEFORE DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION prevent_delete()`,
  `CREATE TRIGGER trg_payment_needs_treasury BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION enforce_payment_treasury()`,
  `CREATE TRIGGER trg_students_updated BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `CREATE TRIGGER trg_no_delete_treasury BEFORE DELETE ON public.treasury_txn FOR EACH ROW EXECUTE FUNCTION prevent_delete()`,
];

const CHECK_CONSTRAINTS = [
  `ALTER TABLE public.absence_followup ADD CONSTRAINT chk_followup_status CHECK ((follow_status = ANY (ARRAY['pending'::text, 'contacted'::text, 'excused'::text, 'unexcused'::text])))`,
  `ALTER TABLE public.admission_followups ADD CONSTRAINT chk_adm_followup_type CHECK ((type = ANY (ARRAY['call'::text, 'whatsapp'::text, 'visit'::text, 'confirmed'::text, 'noAnswer'::text, 'excused'::text])))`,
  `ALTER TABLE public.admission_payments ADD CONSTRAINT chk_adm_pay_amount CHECK ((amount > (0)::numeric))`,
  `ALTER TABLE public.admission_payments ADD CONSTRAINT chk_adm_pay_type CHECK ((type = ANY (ARRAY['deposit'::text, 'booklets'::text, 'course'::text, 'other'::text])))`,
  `ALTER TABLE public.admission_system_log ADD CONSTRAINT chk_adm_activity CHECK ((activity_type = ANY (ARRAY['created'::text, 'reservation'::text, 'confirmed'::text, 'paymentReceived'::text, 'bookletsDelivered'::text, 'refundIssued'::text, 'waiting'::text, 'firstLesson'::text, 'activated'::text, 'cancelled'::text])))`,
  `ALTER TABLE public.admissions ADD CONSTRAINT chk_adm_lead_status CHECK (((lead_status IS NULL) OR (lead_status = ANY (ARRAY['new'::text, 'contacted'::text, 'interested'::text, 'notInterested'::text, 'followupLater'::text]))))`,
  `ALTER TABLE public.admissions ADD CONSTRAINT chk_adm_reservation_status CHECK (((reservation_status IS NULL) OR (reservation_status = ANY (ARRAY['reserved'::text, 'waiting'::text, 'cancelled'::text]))))`,
  `ALTER TABLE public.admissions ADD CONSTRAINT chk_adm_stage CHECK ((stage = ANY (ARRAY['lead'::text, 'reserved'::text, 'waiting'::text, 'confirmed'::text, 'active'::text])))`,
  `ALTER TABLE public.attendance ADD CONSTRAINT chk_attendance_status CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text])))`,
  `ALTER TABLE public.cashboxes ADD CONSTRAINT chk_cashbox_opening CHECK ((opening_balance >= (0)::numeric))`,
  `ALTER TABLE public.center_profile ADD CONSTRAINT center_profile_single_row CHECK ((id = 1))`,
  `ALTER TABLE public.comm_tasks ADD CONSTRAINT chk_task_priority CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])))`,
  `ALTER TABLE public.comm_tasks ADD CONSTRAINT chk_task_status CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'cancelled'::text])))`,
  `ALTER TABLE public.communications ADD CONSTRAINT chk_comm_priority CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])))`,
  `ALTER TABLE public.communications ADD CONSTRAINT chk_comm_reason CHECK (((reason IS NULL) OR (reason = ANY (ARRAY['newRegistration'::text, 'reservationFollowup'::text, 'firstLessonConfirm'::text, 'attendance'::text, 'absence'::text, 'paymentReminder'::text, 'bookletDelivery'::text, 'scheduleChange'::text, 'complaint'::text, 'inquiry'::text, 'academicFollowup'::text, 'other'::text]))))`,
  `ALTER TABLE public.communications ADD CONSTRAINT chk_comm_result CHECK ((result = ANY (ARRAY['answered'::text, 'noAnswer'::text, 'busy'::text, 'phoneOff'::text, 'wrongNumber'::text, 'promiseToPay'::text, 'confirmedAttendance'::text, 'reschedule'::text, 'reservationCancelled'::text, 'completed'::text, 'followupRequired'::text])))`,
  `ALTER TABLE public.communications ADD CONSTRAINT chk_comm_status CHECK ((status = ANY (ARRAY['open'::text, 'completed'::text, 'cancelled'::text, 'archived'::text])))`,
  `ALTER TABLE public.communications ADD CONSTRAINT chk_comm_type CHECK ((type = ANY (ARRAY['phoneCall'::text, 'whatsapp'::text, 'sms'::text, 'email'::text, 'parentVisit'::text, 'centerVisit'::text, 'other'::text])))`,
  `ALTER TABLE public.exams ADD CONSTRAINT chk_exam_pass CHECK (((pass >= (0)::numeric) AND (pass <= total)))`,
  `ALTER TABLE public.exams ADD CONSTRAINT chk_exam_status CHECK ((status = ANY (ARRAY['upcoming'::text, 'grading'::text, 'done'::text])))`,
  `ALTER TABLE public.exams ADD CONSTRAINT chk_exam_total CHECK ((total > (0)::numeric))`,
  `ALTER TABLE public.exams ADD CONSTRAINT chk_exam_type CHECK ((type = ANY (ARRAY['monthly'::text, 'midterm'::text, 'final'::text, 'quiz'::text])))`,
  `ALTER TABLE public.grades ADD CONSTRAINT chk_grade_score CHECK (((score IS NULL) OR (score >= (0)::numeric)))`,
  `ALTER TABLE public.groups ADD CONSTRAINT chk_group_price CHECK ((price >= (0)::numeric))`,
  `ALTER TABLE public.homeworks ADD CONSTRAINT chk_hw_score CHECK ((total_score > (0)::numeric))`,
  `ALTER TABLE public.homeworks ADD CONSTRAINT chk_hw_status CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'draft'::text])))`,
  `ALTER TABLE public.hw_submissions ADD CONSTRAINT chk_hwsub_status CHECK ((status = ANY (ARRAY['submitted'::text, 'late'::text, 'missing'::text])))`,
  `ALTER TABLE public.inv_materials ADD CONSTRAINT chk_material_cost CHECK ((cost >= (0)::numeric))`,
  `ALTER TABLE public.inv_materials ADD CONSTRAINT chk_material_minstock CHECK ((min_stock >= (0)::numeric))`,
  `ALTER TABLE public.inv_materials ADD CONSTRAINT chk_material_price CHECK ((price >= (0)::numeric))`,
  `ALTER TABLE public.inv_materials ADD CONSTRAINT chk_material_status CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))`,
  `ALTER TABLE public.inventory_settings ADD CONSTRAINT inv_settings_single_row CHECK ((id = 1))`,
  `ALTER TABLE public.inventory_txn ADD CONSTRAINT chk_inv_quantity CHECK ((quantity > (0)::numeric))`,
  `ALTER TABLE public.inventory_txn ADD CONSTRAINT chk_inv_type CHECK ((type = ANY (ARRAY['initialStock'::text, 'printing'::text, 'purchase'::text, 'sale'::text, 'freeDistribution'::text, 'reservation'::text, 'reservationRelease'::text, 'studentDelivery'::text, 'return'::text, 'damaged'::text, 'lost'::text, 'adjustment'::text])))`,
  `ALTER TABLE public.payments ADD CONSTRAINT chk_payment_amount CHECK ((amount >= (0)::numeric))`,
  `ALTER TABLE public.payments ADD CONSTRAINT chk_payment_method CHECK ((method = ANY (ARRAY['cash'::text, 'transfer'::text, 'instapay'::text, 'check'::text, 'visa'::text])))`,
  `ALTER TABLE public.payments ADD CONSTRAINT chk_payment_month CHECK (((month >= 1) AND (month <= 12)))`,
  `ALTER TABLE public.payments ADD CONSTRAINT chk_payment_status CHECK ((status = ANY (ARRAY['paid'::text, 'partial'::text, 'unpaid'::text])))`,
  `ALTER TABLE public.payments ADD CONSTRAINT chk_payment_type CHECK ((pay_type = ANY (ARRAY['subscription'::text, 'material'::text, 'exam'::text, 'extra'::text, 'other'::text])))`,
  `ALTER TABLE public.students ADD CONSTRAINT chk_student_fee CHECK (((monthly_fee IS NULL) OR (monthly_fee >= (0)::numeric)))`,
  `ALTER TABLE public.students ADD CONSTRAINT chk_student_status CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))`,
  `ALTER TABLE public.treasury_txn ADD CONSTRAINT chk_treasury_amount CHECK ((amount > (0)::numeric))`,
  `ALTER TABLE public.treasury_txn ADD CONSTRAINT chk_treasury_method CHECK ((method = ANY (ARRAY['cash'::text, 'transfer'::text, 'instapay'::text, 'check'::text, 'visa'::text])))`,
  `ALTER TABLE public.treasury_txn ADD CONSTRAINT chk_treasury_status CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text])))`,
  `ALTER TABLE public.treasury_txn ADD CONSTRAINT chk_treasury_type CHECK ((type = ANY (ARRAY['income'::text, 'expense'::text])))`,
];

// ── فهارس UNIQUE جزئية (partial) — pg_get_indexdef() الحرفي. Prisma لا يُمثّل عبارة WHERE
// إطلاقاً (لا @unique ولا @@unique يدعمان partial index) فلا ينشئها db push أبداً. اكتُشفا
// أثناء "Database Installation Package investigation" (مقارنة جرد studix-schema.sql
// المُولَّد مقابل studix الحقيقية مباشرةً): 10 فهارس فريدة فقط في القاعدة المُولَّدة من
// schema.prisma، مقابل 12 في studix الحقيقية — الفرق بالضبط هذان الاثنان.
const PARTIAL_UNIQUE_INDEXES = [
  `CREATE UNIQUE INDEX uq_treasury_one_payment ON public.payments USING btree (treasury_txn_id) WHERE (treasury_txn_id IS NOT NULL)`,
  `CREATE UNIQUE INDEX uq_users_email ON public.users USING btree (email) WHERE (email IS NOT NULL)`,
];

export const EXPECTED_TRIGGER_NAMES = TRIGGERS.map((sql) => sql.match(/CREATE TRIGGER (\S+)/)[1]).sort();
export const EXPECTED_FUNCTION_NAMES = FUNCTIONS.map((sql) => sql.match(/FUNCTION public\.(\w+)\(/)[1]).sort();
export const EXPECTED_CHECK_CONSTRAINT_NAMES = CHECK_CONSTRAINTS.map((sql) => sql.match(/ADD CONSTRAINT (\S+)/)[1]).sort();
export const EXPECTED_PARTIAL_UNIQUE_INDEX_NAMES = PARTIAL_UNIQUE_INDEXES.map((sql) => sql.match(/CREATE UNIQUE INDEX (\S+)/)[1]).sort();

/**
 * يطبّق كل الدوال + الـ triggers + الـ CHECK constraints + الفهارس الفريدة الجزئية (الـ27
 * جدولاً كاملة) على عميل scratch جاهز (من setupScratchDb الموجودة في scratchDb.js، غير
 * مُعدَّلة هنا إطلاقاً).
 */
export async function applyFullSchemaDDL(client) {
  for (const sql of FUNCTIONS) await client.$executeRawUnsafe(sql);
  for (const sql of TRIGGERS) await client.$executeRawUnsafe(sql);
  for (const sql of CHECK_CONSTRAINTS) await client.$executeRawUnsafe(sql);
  for (const sql of PARTIAL_UNIQUE_INDEXES) await client.$executeRawUnsafe(sql);
}

/**
 * يتحقّق فعلياً (لا افتراضاً) أن كل trigger/function/CHECK constraint متوقَّع موجود
 * بالفعل على القاعدة المُمرَّرة (scratch أو المُعاد بناؤها من studix-schema.sql) — عبر
 * استعلامات pg_trigger/pg_proc/pg_constraint حقيقية، بلا فلترة على جدول معيّن.
 */
export async function readAppliedFullSchemaObjects(client) {
  const triggerRows = await client.$queryRaw`
    SELECT t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal
  `;
  const functionRows = await client.$queryRaw`
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(${EXPECTED_FUNCTION_NAMES})
  `;
  const constraintRows = await client.$queryRaw`
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.contype = 'c'
  `;
  // partial unique indexes لا تظهر أبداً في pg_constraint (Postgres لا يُسجِّلها كـ
  // constraint إطلاقاً، فهرس فريد بعبارة WHERE فقط) — تُقرَأ من pg_index/pg_class مباشرة.
  const partialUniqueRows = await client.$queryRaw`
    SELECT c.relname AS idxname
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = ANY(${EXPECTED_PARTIAL_UNIQUE_INDEX_NAMES})
  `;
  return {
    triggers: triggerRows.map((r) => r.tgname).sort(),
    functions: functionRows.map((r) => r.proname).sort(),
    constraints: constraintRows.map((r) => r.conname).sort(),
    partialUniqueIndexes: partialUniqueRows.map((r) => r.idxname).sort(),
  };
}
