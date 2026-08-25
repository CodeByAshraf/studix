# Studix — أدوات الترحيل (Migration Tooling)

ترحيل بيانات localStorage إلى PostgreSQL (`studix`, 27 جدول). **التحضير فقط — لا يُدرج شيء إلا بأمر صريح لاحقاً.**

المبدأ الحاكم: **NO INVENTED MONEY · NO LOST DATA · NO INVENTED BUSINESS LOGIC**.

---

## بنية المجلد

```
migration/
├── export-localstorage.js      # تصدير localStorage → JSON (قراءة فقط)
├── import-postgres.js          # التحويل + التقارير — DRY-RUN افتراضياً
├── mapping/
│   ├── fieldMaps.js            # camelCase → snake_case لكل الجداول
│   └── normalizePhone.js       # تطبيع الهاتف لبناء parents
├── reports/                    # مخرجات التحليل (تُولّد عند الـ dry-run)
└── README.md
```

---

## الخطوات (بالترتيب)

### 1) نسخة احتياطية من localStorage (قراءة فقط — لا يمس الأصل)

```bash
node migration/export-localstorage.js
```
يطبع كوداً تلصقه في **console المتصفح** (F12) وأنت على تطبيق Studix.
سيُنزّل `studix-localstorage-backup.json` — **احفظه داخل `migration/`**.

> بياناتك الأصلية في localStorage **تبقى سليمة تماماً** — هذا تصدير فقط.

### 2) Dry-Run (تحليل آمن — لا كتابة لقاعدة البيانات)

```bash
cd migration
node import-postgres.js --file=studix-localstorage-backup.json
```

يُنتج في `migration/reports/`:
- `migration-summary.json` — العدّادات والاستثناءات والمراجعات المالية.
- `mapped-output-preview.json` — البيانات بعد التحويل (معاينة، لا إدراج).

### 3) المراجعة

افحص التقارير، خصوصاً:
- `financialReview` — دفعات بلا خزنة (استثناءات تاريخية).
- `duplicateCandidates` — أولياء أمور بأسماء مختلفة لنفس الرقم.
- `unmappedFields` — حقول بلا mapping (لا تُفقد — تُبلَّغ).

### 4) التنفيذ الفعلي (لاحقاً — بعد موافقتك فقط)

```bash
# لا تشغّله الآن — يتطلب تفعيل Prisma writes (خطوة منفصلة)
node import-postgres.js --file=studix-localstorage-backup.json --execute
```

---

## ضمانات الأمان

- **Dry-run افتراضي** — بلا `--execute` لا شيء يُكتب.
- **localStorage الأصلي لا يُلمس** — تصدير فقط.
- **قاعدة البيانات لا تُعدّل** أثناء التحضير.
- **لا مال مخترع** — الدفعات بلا خزنة تبقى استثناءات تاريخية.
- **لا فقد بيانات** — الحقول غير المُطابقة تُبلَّغ، مبالغ matDist تُحفظ كـ legacy_metadata.
- **لا دمج صامت** — دمج parents فقط بقاعدة صريحة (الرقم المطبّع المتطابق)، والاختلافات تُبلَّغ.

---

## القرارات المطبّقة (من الـ audit المعتمد)

| القرار | التطبيق |
|--------|---------|
| Payment بلا treasury | يُرحّل بحالته، `treasury_txn_id=null`، يُدرج في financialReview |
| matDist paidAmount | `legacy_metadata` فقط — لا treasury، لا زيادة رصيد |
| matDist received=false | `inventory_txn` نوع `reservation` |
| matDist received=true | `inventory_txn` نوع `studentDelivery` |
| parents | يُبنون من الأرقام المطبّعة الفريدة؛ الفارغ/غير الصالح → parent_id=null |
| business numbers | تُرحّل كما هي؛ تُضبط sequences لاحقاً |
| createdBy نصّي | يُحفظ؛ FK يُطابَق ما أمكن |

---

## ملاحظات

- الـ `--execute` الفعلي يحتاج طبقة كتابة Prisma — **تُضاف في خطوة منفصلة بعد مراجعة الـ dry-run**.
- الـ import لا يحذف بيانات موجودة في PostgreSQL؛ منطق التعامل مع التعارض (skip/upsert) يُحسم قبل التنفيذ.
