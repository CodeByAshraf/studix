# MIGRATION_PLAN.md — Studix (localStorage → PostgreSQL)

خطة ترحيل البيانات من Zustand/localStorage إلى قاعدة `studix` (27 جدول). **تحضير فقط.**

## المصدر والوجهة

| المصدر (localStorage) | الوجهة (PostgreSQL) |
|-----------------------|---------------------|
| `studix-v1` (Zustand persist, 24 collection) | 27 جدول |
| `studix-auth-users/roles/teachers` | users / roles / teachers |

## ترتيب الترحيل (يحترم الـ FKs)

```
1. roles          ← studix-auth-roles
2. teachers       ← studix-auth-teachers
3. parents        ← مبني من parentPhone (students+admissions+communications)
4. users          ← studix-auth-users
5. groups
6. students       (parent_id ← parents)
7. cashboxes
8. admissions
9. treasury_txn
10. payments      (treasury_txn_id ← ربط refType=payment)
11. exams → grades
12. homeworks → hw_submissions
13. attendance → absence_followup
14. inv_materials
15. inventory_txn (+ matDist مُدمج)
16. admission_payments / admission_followups / admission_system_log
17. communications → comm_tasks
18. activity_logs / wa_report_log
19. center_profile / inventory_settings
```

## المعالجات الخاصة

### parents (deterministic)
- الرقم يُطبّع (`01x → 201x`). الأرقام الفريدة → parents.
- الفارغ/غير الصالح → `parent_id = NULL` (لا parent وهمي).
- اسمان مختلفان لنفس الرقم → يُدمجان تحت parent واحد + يُبلَّغ في duplicateCandidates.
- **لا دمج بالاسم وحده إطلاقاً.**

### الدمج materials/matDist → inv_materials/inventory_txn
- `materials` القديم → `inv_materials` (إن لم يكن مُرحّلاً عبر invMaterials).
- `matDist`:
  - `received=true` → `inventory_txn` نوع `studentDelivery`.
  - `received=false` → نوع `reservation`.
  - `payStatus/paidAmount/received/receivedAt` → `legacy_metadata` (JSONB) — بلا أثر مالي.
  - إن وُجد payment حقيقي مطابق (student+material) → يُربط `payment_id`؛ وإلا لا مال يُخترع.

### الأموال (NO INVENTED MONEY)
- `treasury_txn` تُرحّل كما هي (مصدر الحقيقة).
- `payments` تُربط بالخزنة عبر `refType=payment, refId`.
- دفعة بلا خزنة تاريخية → `treasury_txn_id=null` + سطر في `financialReview`. **لا treasury مخترعة.**

### createdBy
- يُطابَق بـ users.id إن أمكن؛ الاسم النصّي القديم يُحفظ.

### business numbers
- TC/ADM/COM/MAT/INV تُرحّل كما هي؛ تُضبط sequences على الأعلى بعد التنفيذ.

## ما لا يُرحّل (مشتق — يُحسب)
- رصيد الخزنة، رصيد المخزون، الإحصائيات، تقرير الطالب، الملخص المالي للقبول.

## الأمان
- dry-run افتراضي، localStorage الأصلي سليم، لا تعديل schema، لا مال مخترع، لا فقد بيانات.
