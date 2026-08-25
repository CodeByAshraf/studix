// backend/src/test-helpers/scratchDbConstraints.js
// ─────────────────────────────────────────────────────────────
// MEDIUM-B2 — DDL محتاج إلى تكرارها على قاعدة scratch لأن schema.prisma لا يُمثّل الـ
// triggers ولا CHECK constraints إطلاقاً (لا db pull ولا db push يلتقطانها — تأكّد من
// هذا صراحةً أثناء تفتيش MEDIUM-B). هذا الملف يُركِّب فوق setupScratchDb الموجودة في
// scratchDb.js (MEDIUM-B1) بلا أي تعديل عليها إطلاقاً — يستقبل عميل scratch جاهزاً
// ويضيف عليه الـ DDL كخطوة منفصلة اختيارية.
//
// مصدر كل نص أدناه: استعلامات SELECT للقراءة فقط على قاعدة studix الحقيقية، حرفياً عبر
// pg_get_functiondef()/pg_get_triggerdef()/pg_get_constraintdef() — لا إعادة كتابة يدوية
// من الذاكرة أو افتراضاً. أُلتُقطت أثناء تفتيش MEDIUM-B2 (القراءة فقط، بلا أي تعديل على
// studix). لو تغيّرت الـ triggers/constraints الحقيقية مستقبلاً، هذا الملف يحتاج مزامنة
// يدوية جديدة — لا آلية تلقائية تُبقيه متزامناً مع studix.
// ─────────────────────────────────────────────────────────────

// ── الدوال (functions) خلف الـ triggers — نصّ pg_get_functiondef() الحرفي ──
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
];

// ── الـ triggers نفسها — نصّ pg_get_triggerdef() الحرفي ──
const TRIGGERS = [
  `CREATE TRIGGER trg_no_delete_payments BEFORE DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION prevent_delete()`,
  `CREATE TRIGGER trg_payment_needs_treasury BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION enforce_payment_treasury()`,
  `CREATE TRIGGER trg_no_delete_treasury BEFORE DELETE ON public.treasury_txn FOR EACH ROW EXECUTE FUNCTION prevent_delete()`,
];

// ── CHECK constraints — نصّ pg_get_constraintdef() الحرفي، كـ ALTER TABLE ADD CONSTRAINT ──
const CHECK_CONSTRAINTS = [
  `ALTER TABLE public.payments ADD CONSTRAINT chk_payment_amount CHECK ((amount >= (0)::numeric))`,
  `ALTER TABLE public.payments ADD CONSTRAINT chk_payment_method CHECK ((method = ANY (ARRAY['cash'::text, 'transfer'::text, 'instapay'::text, 'check'::text, 'visa'::text])))`,
  `ALTER TABLE public.payments ADD CONSTRAINT chk_payment_month CHECK (((month >= 1) AND (month <= 12)))`,
  `ALTER TABLE public.payments ADD CONSTRAINT chk_payment_status CHECK ((status = ANY (ARRAY['paid'::text, 'partial'::text, 'unpaid'::text])))`,
  `ALTER TABLE public.payments ADD CONSTRAINT chk_payment_type CHECK ((pay_type = ANY (ARRAY['subscription'::text, 'material'::text, 'exam'::text, 'extra'::text, 'other'::text])))`,
  `ALTER TABLE public.treasury_txn ADD CONSTRAINT chk_treasury_amount CHECK ((amount > (0)::numeric))`,
  `ALTER TABLE public.treasury_txn ADD CONSTRAINT chk_treasury_method CHECK ((method = ANY (ARRAY['cash'::text, 'transfer'::text, 'instapay'::text, 'check'::text, 'visa'::text])))`,
  `ALTER TABLE public.treasury_txn ADD CONSTRAINT chk_treasury_status CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text])))`,
  `ALTER TABLE public.treasury_txn ADD CONSTRAINT chk_treasury_type CHECK ((type = ANY (ARRAY['income'::text, 'expense'::text])))`,
];

export const EXPECTED_TRIGGER_NAMES = [
  'trg_no_delete_payments',
  'trg_payment_needs_treasury',
  'trg_no_delete_treasury',
];

export const EXPECTED_CHECK_CONSTRAINT_NAMES = [
  'chk_payment_amount', 'chk_payment_method', 'chk_payment_month', 'chk_payment_status', 'chk_payment_type',
  'chk_treasury_amount', 'chk_treasury_method', 'chk_treasury_status', 'chk_treasury_type',
];

/**
 * يطبّق الدوال + الـ triggers + الـ CHECK constraints على عميل scratch جاهز (من
 * setupScratchDb الموجودة، غير مُعدَّلة هنا إطلاقاً). ترتيب التنفيذ إلزامي: الدوال أولاً
 * (الـ triggers تُشير إليها)، ثم الـ triggers، ثم الـ CHECK constraints (لا تعتمد على
 * شيء سابق، لكن نُبقيها أخيراً للوضوح).
 */
export async function applyTriggersAndConstraints(client) {
  for (const sql of FUNCTIONS) await client.$executeRawUnsafe(sql);
  for (const sql of TRIGGERS) await client.$executeRawUnsafe(sql);
  for (const sql of CHECK_CONSTRAINTS) await client.$executeRawUnsafe(sql);
}

/**
 * يتحقّق فعلياً (لا افتراضاً) أن كل trigger/CHECK constraint متوقَّع موجود بالفعل على
 * قاعدة scratch نفسها، عبر استعلام pg_trigger/pg_constraint الحقيقيين — لا على studix.
 * @returns {{ triggers: string[], constraints: string[] }} الأسماء الموجودة فعلياً.
 */
export async function readAppliedTriggersAndConstraints(client) {
  const triggerRows = await client.$queryRaw`
    SELECT t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname IN ('payments','treasury_txn') AND NOT t.tgisinternal
  `;
  const constraintRows = await client.$queryRaw`
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    WHERE c.relname IN ('payments','treasury_txn') AND con.contype = 'c'
  `;
  return {
    triggers: triggerRows.map((r) => r.tgname).sort(),
    constraints: constraintRows.map((r) => r.conname).sort(),
  };
}
