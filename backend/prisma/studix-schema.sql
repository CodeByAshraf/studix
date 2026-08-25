-- studix-schema.sql
-- تم توليده تلقائياً بواسطة backend/scripts/generateSchemaArtifact.js — لا تُعدِّله يدوياً.
-- لإعادة التوليد بعد أي تغيير حقيقي في schema.prisma أو الـ triggers/constraints:
--   node backend/scripts/generateSchemaArtifact.js
-- تاريخ التوليد: 2026-08-24T12:23:16.530Z
-- المصدر: قاعدة scratch معزولة (db push + DDL كامل)، وليس أي قاعدة تطوير حقيقية — لا بيانات إطلاقاً.

--
-- PostgreSQL database dump
--

\restrict eosKmk7XFecIQYzS1sVTW0RpRo0YyLcqcIVrcqqblJOogCAw9WxesMQ0gzEq2gU

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: enforce_admpay_treasury(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_admpay_treasury() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF current_setting('studix.migration_mode', TRUE) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.treasury_txn_id IS NULL THEN
    RAISE EXCEPTION 'كل دفعة قبول جديدة يجب أن ترتبط بحركة خزنة.';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_payment_treasury(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_payment_treasury() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: prevent_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'الحذف ممنوع على هذا الجدول (append-only). استخدم status = cancelled/archived.';
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: absence_followup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.absence_followup (
    id text NOT NULL,
    attendance_id text NOT NULL,
    absence_reason text,
    followed_by text,
    followed_at timestamp(6) with time zone,
    follow_status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    parent_contacted_us boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_followup_status CHECK ((follow_status = ANY (ARRAY['pending'::text, 'contacted'::text, 'excused'::text, 'unexcused'::text])))
);


--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_logs (
    id text NOT NULL,
    action text,
    module text,
    user_id text,
    user_name text,
    entity_type text,
    entity_id text,
    details text,
    "timestamp" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: admission_followups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admission_followups (
    id text NOT NULL,
    admission_id text NOT NULL,
    type text NOT NULL,
    note text,
    employee text,
    date date,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_adm_followup_type CHECK ((type = ANY (ARRAY['call'::text, 'whatsapp'::text, 'visit'::text, 'confirmed'::text, 'noAnswer'::text, 'excused'::text])))
);


--
-- Name: admission_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admission_payments (
    id text NOT NULL,
    admission_id text NOT NULL,
    type text NOT NULL,
    amount numeric(12,2) NOT NULL,
    date date NOT NULL,
    method text DEFAULT 'cash'::text NOT NULL,
    notes text,
    treasury_txn_id text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    material_id bigint,
    CONSTRAINT chk_adm_pay_amount CHECK ((amount > (0)::numeric)),
    CONSTRAINT chk_adm_pay_type CHECK ((type = ANY (ARRAY['deposit'::text, 'booklets'::text, 'course'::text, 'other'::text])))
);


--
-- Name: admission_system_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admission_system_log (
    id text NOT NULL,
    admission_id text NOT NULL,
    activity_type text NOT NULL,
    "timestamp" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    by_user text,
    details text,
    CONSTRAINT chk_adm_activity CHECK ((activity_type = ANY (ARRAY['created'::text, 'reservation'::text, 'confirmed'::text, 'paymentReceived'::text, 'bookletsDelivered'::text, 'refundIssued'::text, 'waiting'::text, 'firstLesson'::text, 'activated'::text, 'cancelled'::text])))
);


--
-- Name: admissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admissions (
    id text NOT NULL,
    number text NOT NULL,
    name text NOT NULL,
    parent_id bigint,
    parent_name text,
    phone text,
    parent_phone text,
    grade text,
    school text,
    source text,
    notes text,
    stage text DEFAULT 'lead'::text NOT NULL,
    lead_status text,
    reservation_status text,
    reservation_date date,
    group_id text,
    student_id text,
    course_fee numeric(12,2),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by text,
    last_modified_at timestamp(6) with time zone,
    last_modified_by text,
    CONSTRAINT chk_adm_lead_status CHECK (((lead_status IS NULL) OR (lead_status = ANY (ARRAY['new'::text, 'contacted'::text, 'interested'::text, 'notInterested'::text, 'followupLater'::text])))),
    CONSTRAINT chk_adm_reservation_status CHECK (((reservation_status IS NULL) OR (reservation_status = ANY (ARRAY['reserved'::text, 'waiting'::text, 'cancelled'::text])))),
    CONSTRAINT chk_adm_stage CHECK ((stage = ANY (ARRAY['lead'::text, 'reserved'::text, 'waiting'::text, 'confirmed'::text, 'active'::text])))
);


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id text NOT NULL,
    student_id text NOT NULL,
    group_id text NOT NULL,
    date date NOT NULL,
    status text NOT NULL,
    session_time text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_attendance_status CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text])))
);


--
-- Name: cashboxes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cashboxes (
    id text NOT NULL,
    name text NOT NULL,
    type text,
    color text,
    icon text,
    opening_balance numeric(12,2) DEFAULT 0 NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_cashbox_opening CHECK ((opening_balance >= (0)::numeric))
);


--
-- Name: center_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.center_profile (
    id smallint DEFAULT 1 NOT NULL,
    name text,
    address text,
    phone1 text,
    phone2 text,
    logo_url text,
    teacher_name text,
    subject text,
    academic_year text,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT center_profile_single_row CHECK ((id = 1))
);


--
-- Name: comm_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comm_tasks (
    id text NOT NULL,
    communication_id text,
    title text NOT NULL,
    due_date date,
    due_time text,
    priority text DEFAULT 'normal'::text NOT NULL,
    employee text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_task_priority CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT chk_task_status CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: communications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communications (
    id text NOT NULL,
    number text NOT NULL,
    parent_id bigint,
    legacy_parent_name text,
    type text NOT NULL,
    reason text,
    result text NOT NULL,
    employee text,
    student_name text,
    phone text,
    notes text,
    priority text DEFAULT 'normal'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    followup_date date,
    followup_time text,
    student_id text,
    admission_id text,
    payment_id text,
    group_id text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by text,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_comm_priority CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT chk_comm_reason CHECK (((reason IS NULL) OR (reason = ANY (ARRAY['newRegistration'::text, 'reservationFollowup'::text, 'firstLessonConfirm'::text, 'attendance'::text, 'absence'::text, 'paymentReminder'::text, 'bookletDelivery'::text, 'scheduleChange'::text, 'complaint'::text, 'inquiry'::text, 'academicFollowup'::text, 'other'::text])))),
    CONSTRAINT chk_comm_result CHECK ((result = ANY (ARRAY['answered'::text, 'noAnswer'::text, 'busy'::text, 'phoneOff'::text, 'wrongNumber'::text, 'promiseToPay'::text, 'confirmedAttendance'::text, 'reschedule'::text, 'reservationCancelled'::text, 'completed'::text, 'followupRequired'::text]))),
    CONSTRAINT chk_comm_status CHECK ((status = ANY (ARRAY['open'::text, 'completed'::text, 'cancelled'::text, 'archived'::text]))),
    CONSTRAINT chk_comm_type CHECK ((type = ANY (ARRAY['phoneCall'::text, 'whatsapp'::text, 'sms'::text, 'email'::text, 'parentVisit'::text, 'centerVisit'::text, 'other'::text])))
);


--
-- Name: exams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exams (
    id text NOT NULL,
    name text NOT NULL,
    group_id text NOT NULL,
    subject text,
    date date NOT NULL,
    total numeric(6,2) NOT NULL,
    pass numeric(6,2) DEFAULT 50 NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    type text DEFAULT 'monthly'::text NOT NULL,
    teacher text,
    status text DEFAULT 'upcoming'::text NOT NULL,
    CONSTRAINT chk_exam_pass CHECK (((pass >= (0)::numeric) AND (pass <= total))),
    CONSTRAINT chk_exam_status CHECK ((status = ANY (ARRAY['upcoming'::text, 'grading'::text, 'done'::text]))),
    CONSTRAINT chk_exam_total CHECK ((total > (0)::numeric)),
    CONSTRAINT chk_exam_type CHECK ((type = ANY (ARRAY['monthly'::text, 'midterm'::text, 'final'::text, 'quiz'::text])))
);


--
-- Name: grades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grades (
    id text NOT NULL,
    exam_id text NOT NULL,
    student_id text NOT NULL,
    score numeric(6,2),
    absent boolean DEFAULT false NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_grade_score CHECK (((score IS NULL) OR (score >= (0)::numeric)))
);


--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id text NOT NULL,
    name text NOT NULL,
    subject text,
    grade text,
    teacher_id bigint,
    teacher_name text,
    "time" text,
    days jsonb,
    price numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    max integer,
    color text,
    notes text,
    CONSTRAINT chk_group_price CHECK ((price >= (0)::numeric))
);


--
-- Name: homeworks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.homeworks (
    id text NOT NULL,
    title text NOT NULL,
    description text,
    subject text,
    teacher text,
    group_id text NOT NULL,
    total_score numeric(6,2) DEFAULT 10 NOT NULL,
    due_date date NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    assigned_date date DEFAULT CURRENT_DATE NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    CONSTRAINT chk_hw_score CHECK ((total_score > (0)::numeric)),
    CONSTRAINT chk_hw_status CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'draft'::text])))
);


--
-- Name: hw_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hw_submissions (
    id text NOT NULL,
    homework_id text NOT NULL,
    student_id text NOT NULL,
    status text DEFAULT 'missing'::text NOT NULL,
    submitted_at timestamp(6) with time zone,
    score numeric(6,2),
    notes text,
    CONSTRAINT chk_hwsub_status CHECK ((status = ANY (ARRAY['submitted'::text, 'late'::text, 'missing'::text])))
);


--
-- Name: inv_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inv_materials (
    id bigint NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    subject text,
    grade text,
    price numeric(12,2) DEFAULT 0 NOT NULL,
    cost numeric(12,2) DEFAULT 0 NOT NULL,
    min_stock numeric(12,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    barcode text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    teacher text,
    description text,
    added_at date,
    CONSTRAINT chk_material_cost CHECK ((cost >= (0)::numeric)),
    CONSTRAINT chk_material_minstock CHECK ((min_stock >= (0)::numeric)),
    CONSTRAINT chk_material_price CHECK ((price >= (0)::numeric)),
    CONSTRAINT chk_material_status CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


--
-- Name: inv_materials_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inv_materials_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inv_materials_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inv_materials_id_seq OWNED BY public.inv_materials.id;


--
-- Name: inventory_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_settings (
    id smallint DEFAULT 1 NOT NULL,
    default_min_stock numeric(12,2) DEFAULT 10 NOT NULL,
    allow_negative_stock boolean DEFAULT false NOT NULL,
    reservation_expiry_days smallint DEFAULT 7 NOT NULL,
    CONSTRAINT inv_settings_single_row CHECK ((id = 1))
);


--
-- Name: inventory_txn; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_txn (
    id text NOT NULL,
    number text NOT NULL,
    material_id bigint NOT NULL,
    type text NOT NULL,
    quantity numeric(12,2) NOT NULL,
    batch_no text,
    unit_cost numeric(12,2),
    recipient text,
    student_id text,
    admission_id text,
    payment_id text,
    status text DEFAULT 'active'::text NOT NULL,
    legacy_metadata jsonb,
    created_by text,
    created_by_name text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_inv_quantity CHECK ((quantity > (0)::numeric)),
    CONSTRAINT chk_inv_type CHECK ((type = ANY (ARRAY['initialStock'::text, 'printing'::text, 'purchase'::text, 'sale'::text, 'freeDistribution'::text, 'reservation'::text, 'reservationRelease'::text, 'studentDelivery'::text, 'return'::text, 'damaged'::text, 'lost'::text, 'adjustment'::text])))
);


--
-- Name: parents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parents (
    id bigint NOT NULL,
    full_name text,
    phone text,
    alt_phone text,
    preferred_method text,
    preferred_time text,
    notes text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: parents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.parents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: parents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.parents_id_seq OWNED BY public.parents.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id text NOT NULL,
    student_id text NOT NULL,
    group_id text,
    material_id bigint,
    month smallint NOT NULL,
    year smallint NOT NULL,
    amount numeric(12,2) NOT NULL,
    method text DEFAULT 'cash'::text NOT NULL,
    pay_type text DEFAULT 'subscription'::text NOT NULL,
    date date NOT NULL,
    status text NOT NULL,
    notes text,
    treasury_txn_id text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_payment_amount CHECK ((amount >= (0)::numeric)),
    CONSTRAINT chk_payment_method CHECK ((method = ANY (ARRAY['cash'::text, 'transfer'::text, 'instapay'::text, 'check'::text, 'visa'::text]))),
    CONSTRAINT chk_payment_month CHECK (((month >= 1) AND (month <= 12))),
    CONSTRAINT chk_payment_status CHECK ((status = ANY (ARRAY['paid'::text, 'partial'::text, 'unpaid'::text]))),
    CONSTRAINT chk_payment_type CHECK ((pay_type = ANY (ARRAY['subscription'::text, 'material'::text, 'exam'::text, 'extra'::text, 'other'::text])))
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id text NOT NULL,
    label text NOT NULL,
    color text,
    is_system boolean DEFAULT false NOT NULL,
    permissions jsonb,
    description text,
    auth_version integer DEFAULT 1 NOT NULL
);


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    phone text,
    parent_id bigint,
    grade text,
    group_id text,
    school text,
    notes text,
    status text DEFAULT 'active'::text NOT NULL,
    monthly_fee numeric(12,2),
    enroll_date date DEFAULT CURRENT_DATE NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    parent_phone text,
    CONSTRAINT chk_student_fee CHECK (((monthly_fee IS NULL) OR (monthly_fee >= (0)::numeric))),
    CONSTRAINT chk_student_status CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


--
-- Name: teachers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teachers (
    id bigint NOT NULL,
    name text NOT NULL,
    phone text,
    subject text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: teachers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teachers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teachers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teachers_id_seq OWNED BY public.teachers.id;


--
-- Name: treasury_txn; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.treasury_txn (
    id text NOT NULL,
    cashbox_id text NOT NULL,
    date date NOT NULL,
    type text NOT NULL,
    category text NOT NULL,
    amount numeric(12,2) NOT NULL,
    method text DEFAULT 'cash'::text NOT NULL,
    party text,
    notes text,
    status text DEFAULT 'active'::text NOT NULL,
    ref_type text,
    ref_id text,
    payment_id text,
    admission_id text,
    source_module text,
    source_doc_no text,
    created_by text,
    created_by_name text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_treasury_amount CHECK ((amount > (0)::numeric)),
    CONSTRAINT chk_treasury_method CHECK ((method = ANY (ARRAY['cash'::text, 'transfer'::text, 'instapay'::text, 'check'::text, 'visa'::text]))),
    CONSTRAINT chk_treasury_status CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text]))),
    CONSTRAINT chk_treasury_type CHECK ((type = ANY (ARRAY['income'::text, 'expense'::text])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    name text NOT NULL,
    role_id text,
    teacher_id bigint,
    password_hash text,
    is_admin boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    permissions jsonb,
    email text,
    last_login timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    auth_version integer DEFAULT 1 NOT NULL
);


--
-- Name: wa_report_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_report_log (
    id text NOT NULL,
    student_id text,
    parent_phone text,
    report_type text,
    message_type text,
    status text DEFAULT 'prepared'::text NOT NULL,
    created_by text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: inv_materials id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inv_materials ALTER COLUMN id SET DEFAULT nextval('public.inv_materials_id_seq'::regclass);


--
-- Name: parents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parents ALTER COLUMN id SET DEFAULT nextval('public.parents_id_seq'::regclass);


--
-- Name: teachers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers ALTER COLUMN id SET DEFAULT nextval('public.teachers_id_seq'::regclass);


--
-- Name: absence_followup absence_followup_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_followup
    ADD CONSTRAINT absence_followup_pkey PRIMARY KEY (id);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: admission_followups admission_followups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_followups
    ADD CONSTRAINT admission_followups_pkey PRIMARY KEY (id);


--
-- Name: admission_payments admission_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_payments
    ADD CONSTRAINT admission_payments_pkey PRIMARY KEY (id);


--
-- Name: admission_system_log admission_system_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_system_log
    ADD CONSTRAINT admission_system_log_pkey PRIMARY KEY (id);


--
-- Name: admissions admissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admissions
    ADD CONSTRAINT admissions_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: cashboxes cashboxes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashboxes
    ADD CONSTRAINT cashboxes_pkey PRIMARY KEY (id);


--
-- Name: center_profile center_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.center_profile
    ADD CONSTRAINT center_profile_pkey PRIMARY KEY (id);


--
-- Name: comm_tasks comm_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comm_tasks
    ADD CONSTRAINT comm_tasks_pkey PRIMARY KEY (id);


--
-- Name: communications communications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_pkey PRIMARY KEY (id);


--
-- Name: exams exams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_pkey PRIMARY KEY (id);


--
-- Name: grades grades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grades
    ADD CONSTRAINT grades_pkey PRIMARY KEY (id);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: homeworks homeworks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.homeworks
    ADD CONSTRAINT homeworks_pkey PRIMARY KEY (id);


--
-- Name: hw_submissions hw_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hw_submissions
    ADD CONSTRAINT hw_submissions_pkey PRIMARY KEY (id);


--
-- Name: inv_materials inv_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inv_materials
    ADD CONSTRAINT inv_materials_pkey PRIMARY KEY (id);


--
-- Name: inventory_settings inventory_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_settings
    ADD CONSTRAINT inventory_settings_pkey PRIMARY KEY (id);


--
-- Name: inventory_txn inventory_txn_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_txn
    ADD CONSTRAINT inventory_txn_pkey PRIMARY KEY (id);


--
-- Name: parents parents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parents
    ADD CONSTRAINT parents_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- Name: teachers teachers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_pkey PRIMARY KEY (id);


--
-- Name: treasury_txn treasury_txn_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treasury_txn
    ADD CONSTRAINT treasury_txn_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: wa_report_log wa_report_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_report_log
    ADD CONSTRAINT wa_report_log_pkey PRIMARY KEY (id);


--
-- Name: absence_followup_attendance_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX absence_followup_attendance_id_key ON public.absence_followup USING btree (attendance_id);


--
-- Name: admissions_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX admissions_number_key ON public.admissions USING btree (number);


--
-- Name: communications_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX communications_number_key ON public.communications USING btree (number);


--
-- Name: idx_activity_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_user ON public.activity_logs USING btree (user_id);


--
-- Name: idx_adm_fu_adm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adm_fu_adm ON public.admission_followups USING btree (admission_id);


--
-- Name: idx_adm_log_adm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adm_log_adm ON public.admission_system_log USING btree (admission_id);


--
-- Name: idx_adm_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adm_parent ON public.admissions USING btree (parent_id);


--
-- Name: idx_adm_pay_adm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adm_pay_adm ON public.admission_payments USING btree (admission_id);


--
-- Name: idx_adm_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adm_stage ON public.admissions USING btree (stage);


--
-- Name: idx_adm_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adm_student ON public.admissions USING btree (student_id);


--
-- Name: idx_attendance_group_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_group_date ON public.attendance USING btree (group_id, date);


--
-- Name: idx_attendance_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_student ON public.attendance USING btree (student_id);


--
-- Name: idx_comm_followup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comm_followup ON public.communications USING btree (followup_date);


--
-- Name: idx_comm_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comm_parent ON public.communications USING btree (parent_id);


--
-- Name: idx_comm_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comm_status ON public.communications USING btree (status);


--
-- Name: idx_comm_tasks_comm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comm_tasks_comm ON public.comm_tasks USING btree (communication_id);


--
-- Name: idx_grades_exam; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grades_exam ON public.grades USING btree (exam_id);


--
-- Name: idx_grades_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grades_student ON public.grades USING btree (student_id);


--
-- Name: idx_hwsub_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hwsub_student ON public.hw_submissions USING btree (student_id);


--
-- Name: idx_inv_txn_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_txn_material ON public.inventory_txn USING btree (material_id);


--
-- Name: idx_inv_txn_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_txn_status ON public.inventory_txn USING btree (status);


--
-- Name: idx_inv_txn_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_txn_student ON public.inventory_txn USING btree (student_id);


--
-- Name: idx_inv_txn_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_txn_type ON public.inventory_txn USING btree (type);


--
-- Name: idx_payments_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_material ON public.payments USING btree (material_id);


--
-- Name: idx_payments_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_student ON public.payments USING btree (student_id);


--
-- Name: idx_payments_treasury; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_treasury ON public.payments USING btree (treasury_txn_id);


--
-- Name: idx_students_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_group ON public.students USING btree (group_id);


--
-- Name: idx_students_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_parent ON public.students USING btree (parent_id);


--
-- Name: idx_students_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_status ON public.students USING btree (status);


--
-- Name: idx_treasury_admission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_treasury_admission ON public.treasury_txn USING btree (admission_id);


--
-- Name: idx_treasury_cashbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_treasury_cashbox ON public.treasury_txn USING btree (cashbox_id);


--
-- Name: idx_treasury_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_treasury_date ON public.treasury_txn USING btree (date);


--
-- Name: idx_treasury_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_treasury_payment ON public.treasury_txn USING btree (payment_id);


--
-- Name: idx_treasury_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_treasury_ref ON public.treasury_txn USING btree (ref_type, ref_id);


--
-- Name: idx_treasury_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_treasury_status ON public.treasury_txn USING btree (status);


--
-- Name: idx_wa_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_student ON public.wa_report_log USING btree (student_id);


--
-- Name: inv_materials_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inv_materials_code_key ON public.inv_materials USING btree (code);


--
-- Name: inventory_txn_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_txn_number_key ON public.inventory_txn USING btree (number);


--
-- Name: parents_phone_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX parents_phone_key ON public.parents USING btree (phone);


--
-- Name: students_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX students_code_key ON public.students USING btree (code);


--
-- Name: uq_attendance_student_date_group; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_attendance_student_date_group ON public.attendance USING btree (student_id, date, group_id);


--
-- Name: uq_grade_exam_student; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_grade_exam_student ON public.grades USING btree (exam_id, student_id);


--
-- Name: uq_hwsub_hw_student; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_hwsub_hw_student ON public.hw_submissions USING btree (homework_id, student_id);


--
-- Name: uq_treasury_one_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_treasury_one_payment ON public.payments USING btree (treasury_txn_id) WHERE (treasury_txn_id IS NOT NULL);


--
-- Name: uq_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_users_email ON public.users USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: admission_payments trg_admpay_needs_treasury; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_admpay_needs_treasury BEFORE INSERT ON public.admission_payments FOR EACH ROW EXECUTE FUNCTION public.enforce_admpay_treasury();


--
-- Name: center_profile trg_center_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_center_updated BEFORE UPDATE ON public.center_profile FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: communications trg_communications_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_communications_updated BEFORE UPDATE ON public.communications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: activity_logs trg_no_delete_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_no_delete_activity BEFORE DELETE ON public.activity_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_delete();


--
-- Name: admission_payments trg_no_delete_admission_payments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_no_delete_admission_payments BEFORE DELETE ON public.admission_payments FOR EACH ROW EXECUTE FUNCTION public.prevent_delete();


--
-- Name: admission_system_log trg_no_delete_admlog; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_no_delete_admlog BEFORE DELETE ON public.admission_system_log FOR EACH ROW EXECUTE FUNCTION public.prevent_delete();


--
-- Name: communications trg_no_delete_comm; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_no_delete_comm BEFORE DELETE ON public.communications FOR EACH ROW EXECUTE FUNCTION public.prevent_delete();


--
-- Name: inventory_txn trg_no_delete_inventory; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_no_delete_inventory BEFORE DELETE ON public.inventory_txn FOR EACH ROW EXECUTE FUNCTION public.prevent_delete();


--
-- Name: payments trg_no_delete_payments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_no_delete_payments BEFORE DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.prevent_delete();


--
-- Name: treasury_txn trg_no_delete_treasury; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_no_delete_treasury BEFORE DELETE ON public.treasury_txn FOR EACH ROW EXECUTE FUNCTION public.prevent_delete();


--
-- Name: parents trg_parents_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_parents_updated BEFORE UPDATE ON public.parents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payments trg_payment_needs_treasury; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payment_needs_treasury BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_treasury();


--
-- Name: students trg_students_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_students_updated BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: absence_followup absence_followup_attendance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.absence_followup
    ADD CONSTRAINT absence_followup_attendance_id_fkey FOREIGN KEY (attendance_id) REFERENCES public.attendance(id);


--
-- Name: activity_logs activity_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: admission_followups admission_followups_admission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_followups
    ADD CONSTRAINT admission_followups_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES public.admissions(id);


--
-- Name: admission_payments admission_payments_admission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_payments
    ADD CONSTRAINT admission_payments_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES public.admissions(id);


--
-- Name: admission_payments admission_payments_treasury_txn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_payments
    ADD CONSTRAINT admission_payments_treasury_txn_id_fkey FOREIGN KEY (treasury_txn_id) REFERENCES public.treasury_txn(id);


--
-- Name: admission_system_log admission_system_log_admission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_system_log
    ADD CONSTRAINT admission_system_log_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES public.admissions(id);


--
-- Name: admissions admissions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admissions
    ADD CONSTRAINT admissions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: admissions admissions_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admissions
    ADD CONSTRAINT admissions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: admissions admissions_last_modified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admissions
    ADD CONSTRAINT admissions_last_modified_by_fkey FOREIGN KEY (last_modified_by) REFERENCES public.users(id);


--
-- Name: admissions admissions_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admissions
    ADD CONSTRAINT admissions_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.parents(id);


--
-- Name: admissions admissions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admissions
    ADD CONSTRAINT admissions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: attendance attendance_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: attendance attendance_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: comm_tasks comm_tasks_communication_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comm_tasks
    ADD CONSTRAINT comm_tasks_communication_id_fkey FOREIGN KEY (communication_id) REFERENCES public.communications(id);


--
-- Name: communications communications_admission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_admission_id_fkey FOREIGN KEY (admission_id) REFERENCES public.admissions(id);


--
-- Name: communications communications_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: communications communications_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.parents(id);


--
-- Name: communications communications_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: communications communications_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: exams exams_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: admission_payments fk_admission_payments_material; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_payments
    ADD CONSTRAINT fk_admission_payments_material FOREIGN KEY (material_id) REFERENCES public.inv_materials(id);


--
-- Name: inventory_txn fk_inventory_admission; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_txn
    ADD CONSTRAINT fk_inventory_admission FOREIGN KEY (admission_id) REFERENCES public.admissions(id);


--
-- Name: payments fk_payments_material; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT fk_payments_material FOREIGN KEY (material_id) REFERENCES public.inv_materials(id);


--
-- Name: treasury_txn fk_treasury_admission; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treasury_txn
    ADD CONSTRAINT fk_treasury_admission FOREIGN KEY (admission_id) REFERENCES public.admissions(id);


--
-- Name: treasury_txn fk_treasury_payment; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treasury_txn
    ADD CONSTRAINT fk_treasury_payment FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: grades grades_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grades
    ADD CONSTRAINT grades_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id);


--
-- Name: grades grades_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grades
    ADD CONSTRAINT grades_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: groups groups_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id);


--
-- Name: homeworks homeworks_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.homeworks
    ADD CONSTRAINT homeworks_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: hw_submissions hw_submissions_homework_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hw_submissions
    ADD CONSTRAINT hw_submissions_homework_id_fkey FOREIGN KEY (homework_id) REFERENCES public.homeworks(id);


--
-- Name: hw_submissions hw_submissions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hw_submissions
    ADD CONSTRAINT hw_submissions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: inventory_txn inventory_txn_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_txn
    ADD CONSTRAINT inventory_txn_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: inventory_txn inventory_txn_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_txn
    ADD CONSTRAINT inventory_txn_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.inv_materials(id);


--
-- Name: inventory_txn inventory_txn_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_txn
    ADD CONSTRAINT inventory_txn_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: inventory_txn inventory_txn_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_txn
    ADD CONSTRAINT inventory_txn_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: payments payments_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: payments payments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: payments payments_treasury_txn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_treasury_txn_id_fkey FOREIGN KEY (treasury_txn_id) REFERENCES public.treasury_txn(id);


--
-- Name: students students_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id);


--
-- Name: students students_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.parents(id);


--
-- Name: treasury_txn treasury_txn_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treasury_txn
    ADD CONSTRAINT treasury_txn_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES public.cashboxes(id);


--
-- Name: treasury_txn treasury_txn_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.treasury_txn
    ADD CONSTRAINT treasury_txn_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: users users_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.teachers(id);


--
-- Name: wa_report_log wa_report_log_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_report_log
    ADD CONSTRAINT wa_report_log_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: wa_report_log wa_report_log_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_report_log
    ADD CONSTRAINT wa_report_log_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- PostgreSQL database dump complete
--

\unrestrict eosKmk7XFecIQYzS1sVTW0RpRo0YyLcqcIVrcqqblJOogCAw9WxesMQ0gzEq2gU

