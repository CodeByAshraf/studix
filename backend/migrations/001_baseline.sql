-- backend/migrations/001_baseline.sql
-- Studix — migration 001: baseline supplemental DDL (not representable in schema.prisma).
-- 4 functions, 13 triggers, 45 CHECK constraints, 2 partial unique indexes.
-- Source of truth mirrored from backend/src/test-helpers/scratchDbFullSchema.js
-- (generated verbatim via applyFullSchemaDDL — do not hand-edit either file out of sync).
--
-- On a FRESH install this file is never executed directly — the installer applies
-- backend/prisma/studix-schema.sql (which already includes this DDL's cumulative
-- effect), and migrationRunner.js stamps this version as applied without running it.
-- On an EXISTING installation predating this migration system, migrationRunner.js
-- executes this file for real, inside one transaction.

CREATE OR REPLACE FUNCTION public.prevent_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'الحذف ممنوع على هذا الجدول (append-only). استخدم status = cancelled/archived.';
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_payment_treasury()
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
$function$;

CREATE OR REPLACE FUNCTION public.enforce_admpay_treasury()
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
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_no_delete_activity BEFORE DELETE ON public.activity_logs FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE TRIGGER trg_admpay_needs_treasury BEFORE INSERT ON public.admission_payments FOR EACH ROW EXECUTE FUNCTION enforce_admpay_treasury();

CREATE TRIGGER trg_no_delete_admission_payments BEFORE DELETE ON public.admission_payments FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE TRIGGER trg_no_delete_admlog BEFORE DELETE ON public.admission_system_log FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE TRIGGER trg_center_updated BEFORE UPDATE ON public.center_profile FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_communications_updated BEFORE UPDATE ON public.communications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_no_delete_comm BEFORE DELETE ON public.communications FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE TRIGGER trg_no_delete_inventory BEFORE DELETE ON public.inventory_txn FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE TRIGGER trg_parents_updated BEFORE UPDATE ON public.parents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_no_delete_payments BEFORE DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION prevent_delete();

CREATE TRIGGER trg_payment_needs_treasury BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION enforce_payment_treasury();

CREATE TRIGGER trg_students_updated BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_no_delete_treasury BEFORE DELETE ON public.treasury_txn FOR EACH ROW EXECUTE FUNCTION prevent_delete();

ALTER TABLE public.absence_followup ADD CONSTRAINT chk_followup_status CHECK ((follow_status = ANY (ARRAY['pending'::text, 'contacted'::text, 'excused'::text, 'unexcused'::text])));

ALTER TABLE public.admission_followups ADD CONSTRAINT chk_adm_followup_type CHECK ((type = ANY (ARRAY['call'::text, 'whatsapp'::text, 'visit'::text, 'confirmed'::text, 'noAnswer'::text, 'excused'::text])));

ALTER TABLE public.admission_payments ADD CONSTRAINT chk_adm_pay_amount CHECK ((amount > (0)::numeric));

ALTER TABLE public.admission_payments ADD CONSTRAINT chk_adm_pay_type CHECK ((type = ANY (ARRAY['deposit'::text, 'booklets'::text, 'course'::text, 'other'::text])));

ALTER TABLE public.admission_system_log ADD CONSTRAINT chk_adm_activity CHECK ((activity_type = ANY (ARRAY['created'::text, 'reservation'::text, 'confirmed'::text, 'paymentReceived'::text, 'bookletsDelivered'::text, 'refundIssued'::text, 'waiting'::text, 'firstLesson'::text, 'activated'::text, 'cancelled'::text])));

ALTER TABLE public.admissions ADD CONSTRAINT chk_adm_lead_status CHECK (((lead_status IS NULL) OR (lead_status = ANY (ARRAY['new'::text, 'contacted'::text, 'interested'::text, 'notInterested'::text, 'followupLater'::text]))));

ALTER TABLE public.admissions ADD CONSTRAINT chk_adm_reservation_status CHECK (((reservation_status IS NULL) OR (reservation_status = ANY (ARRAY['reserved'::text, 'waiting'::text, 'cancelled'::text]))));

ALTER TABLE public.admissions ADD CONSTRAINT chk_adm_stage CHECK ((stage = ANY (ARRAY['lead'::text, 'reserved'::text, 'waiting'::text, 'confirmed'::text, 'active'::text])));

ALTER TABLE public.attendance ADD CONSTRAINT chk_attendance_status CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text])));

ALTER TABLE public.cashboxes ADD CONSTRAINT chk_cashbox_opening CHECK ((opening_balance >= (0)::numeric));

ALTER TABLE public.center_profile ADD CONSTRAINT center_profile_single_row CHECK ((id = 1));

ALTER TABLE public.comm_tasks ADD CONSTRAINT chk_task_priority CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])));

ALTER TABLE public.comm_tasks ADD CONSTRAINT chk_task_status CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'cancelled'::text])));

ALTER TABLE public.communications ADD CONSTRAINT chk_comm_priority CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])));

ALTER TABLE public.communications ADD CONSTRAINT chk_comm_reason CHECK (((reason IS NULL) OR (reason = ANY (ARRAY['newRegistration'::text, 'reservationFollowup'::text, 'firstLessonConfirm'::text, 'attendance'::text, 'absence'::text, 'paymentReminder'::text, 'bookletDelivery'::text, 'scheduleChange'::text, 'complaint'::text, 'inquiry'::text, 'academicFollowup'::text, 'other'::text]))));

ALTER TABLE public.communications ADD CONSTRAINT chk_comm_result CHECK ((result = ANY (ARRAY['answered'::text, 'noAnswer'::text, 'busy'::text, 'phoneOff'::text, 'wrongNumber'::text, 'promiseToPay'::text, 'confirmedAttendance'::text, 'reschedule'::text, 'reservationCancelled'::text, 'completed'::text, 'followupRequired'::text])));

ALTER TABLE public.communications ADD CONSTRAINT chk_comm_status CHECK ((status = ANY (ARRAY['open'::text, 'completed'::text, 'cancelled'::text, 'archived'::text])));

ALTER TABLE public.communications ADD CONSTRAINT chk_comm_type CHECK ((type = ANY (ARRAY['phoneCall'::text, 'whatsapp'::text, 'sms'::text, 'email'::text, 'parentVisit'::text, 'centerVisit'::text, 'other'::text])));

ALTER TABLE public.exams ADD CONSTRAINT chk_exam_pass CHECK (((pass >= (0)::numeric) AND (pass <= total)));

ALTER TABLE public.exams ADD CONSTRAINT chk_exam_status CHECK ((status = ANY (ARRAY['upcoming'::text, 'grading'::text, 'done'::text])));

ALTER TABLE public.exams ADD CONSTRAINT chk_exam_total CHECK ((total > (0)::numeric));

ALTER TABLE public.exams ADD CONSTRAINT chk_exam_type CHECK ((type = ANY (ARRAY['monthly'::text, 'midterm'::text, 'final'::text, 'quiz'::text])));

ALTER TABLE public.grades ADD CONSTRAINT chk_grade_score CHECK (((score IS NULL) OR (score >= (0)::numeric)));

ALTER TABLE public.groups ADD CONSTRAINT chk_group_price CHECK ((price >= (0)::numeric));

ALTER TABLE public.homeworks ADD CONSTRAINT chk_hw_score CHECK ((total_score > (0)::numeric));

ALTER TABLE public.homeworks ADD CONSTRAINT chk_hw_status CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'draft'::text])));

ALTER TABLE public.hw_submissions ADD CONSTRAINT chk_hwsub_status CHECK ((status = ANY (ARRAY['submitted'::text, 'late'::text, 'missing'::text])));

ALTER TABLE public.inv_materials ADD CONSTRAINT chk_material_cost CHECK ((cost >= (0)::numeric));

ALTER TABLE public.inv_materials ADD CONSTRAINT chk_material_minstock CHECK ((min_stock >= (0)::numeric));

ALTER TABLE public.inv_materials ADD CONSTRAINT chk_material_price CHECK ((price >= (0)::numeric));

ALTER TABLE public.inv_materials ADD CONSTRAINT chk_material_status CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])));

ALTER TABLE public.inventory_settings ADD CONSTRAINT inv_settings_single_row CHECK ((id = 1));

ALTER TABLE public.inventory_txn ADD CONSTRAINT chk_inv_quantity CHECK ((quantity > (0)::numeric));

ALTER TABLE public.inventory_txn ADD CONSTRAINT chk_inv_type CHECK ((type = ANY (ARRAY['initialStock'::text, 'printing'::text, 'purchase'::text, 'sale'::text, 'freeDistribution'::text, 'reservation'::text, 'reservationRelease'::text, 'studentDelivery'::text, 'return'::text, 'damaged'::text, 'lost'::text, 'adjustment'::text])));

ALTER TABLE public.payments ADD CONSTRAINT chk_payment_amount CHECK ((amount >= (0)::numeric));

ALTER TABLE public.payments ADD CONSTRAINT chk_payment_method CHECK ((method = ANY (ARRAY['cash'::text, 'transfer'::text, 'instapay'::text, 'check'::text, 'visa'::text])));

ALTER TABLE public.payments ADD CONSTRAINT chk_payment_month CHECK (((month >= 1) AND (month <= 12)));

ALTER TABLE public.payments ADD CONSTRAINT chk_payment_status CHECK ((status = ANY (ARRAY['paid'::text, 'partial'::text, 'unpaid'::text])));

ALTER TABLE public.payments ADD CONSTRAINT chk_payment_type CHECK ((pay_type = ANY (ARRAY['subscription'::text, 'material'::text, 'exam'::text, 'extra'::text, 'other'::text])));

ALTER TABLE public.students ADD CONSTRAINT chk_student_fee CHECK (((monthly_fee IS NULL) OR (monthly_fee >= (0)::numeric)));

ALTER TABLE public.students ADD CONSTRAINT chk_student_status CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])));

ALTER TABLE public.treasury_txn ADD CONSTRAINT chk_treasury_amount CHECK ((amount > (0)::numeric));

ALTER TABLE public.treasury_txn ADD CONSTRAINT chk_treasury_method CHECK ((method = ANY (ARRAY['cash'::text, 'transfer'::text, 'instapay'::text, 'check'::text, 'visa'::text])));

ALTER TABLE public.treasury_txn ADD CONSTRAINT chk_treasury_status CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text])));

ALTER TABLE public.treasury_txn ADD CONSTRAINT chk_treasury_type CHECK ((type = ANY (ARRAY['income'::text, 'expense'::text])));

CREATE UNIQUE INDEX uq_treasury_one_payment ON public.payments USING btree (treasury_txn_id) WHERE (treasury_txn_id IS NOT NULL);

CREATE UNIQUE INDEX uq_users_email ON public.users USING btree (email) WHERE (email IS NOT NULL);
