# Studix Backend

backend حقيقي (Express + Prisma) متصل بقاعدة PostgreSQL `studix` — أغلب الجداول (طلاب،
مجموعات، مدفوعات، حضور، امتحانات، خزنة، تواصل، ...) مربوطة بنقاط نهاية فعلية حقيقية
تُقرأ وتُكتَب منها مباشرة، بالإضافة إلى عمليات ذرّية مخصّصة (دفعات، عكس معاملات خزنة،
تفعيل قبول، ...). راجع `README.md` في جذر المشروع لخطوات التشغيل الكاملة (Backend +
Frontend + إنشاء حساب المدير الأول).

---

## ⚠️ هذه الأوامر تُنفّذ على جهازك المحلي

قاعدة `studix` موجودة على جهازك (لا في بيئة التطوير السحابية). نفّذ التالي بالترتيب:

### 1) تجهيز الإعدادات
```bash
cd backend
cp .env.example .env
# افتح .env وعدّل DATABASE_URL بمعلومات PostgreSQL عندك:
#   DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/studix"
```

### 2) تثبيت الحزم
```bash
npm install
```

### 3) Prisma introspection (db pull) — يطابق schema مع قاعدتك الفعلية
```bash
npm run db:pull
```
هذا يقرأ الجداول الـ 27 من قاعدة `studix` **ويعيد كتابة** `prisma/schema.prisma`
ليطابقها حرفياً. **لا يعدّل قاعدة البيانات** (قراءة فقط).

> ملاحظة: `db pull` يستبدل الـ schema القديم (13 model قديمة camelCase) بالـ 27 جدول الفعلية.

### 4) توليد Prisma Client
```bash
npm run db:generate
```

### 5) تشغيل الخادم
```bash
npm run dev      # مع إعادة التحميل التلقائي
# أو
npm start
```

### 6) التحقق
```bash
curl http://localhost:4000/health
```
النتيجة المتوقّعة:
```json
{
  "ok": true,
  "service": "studix-backend",
  "database": { "connected": true, "tableCount": 27, "error": null }
}
```

### 7) إنشاء حساب المدير الأول

لا يوجد أي حساب افتراضي مزروع في قاعدة `studix` — قاعدة جديدة تماماً لا تحتوي أي مستخدم
قابل لتسجيل الدخول حتى تُنشئه بنفسك (ولا توجد آلية تلقائية لترقية كلمة مرور نصّية إلى
hash عند أول دخول تُغني عن هذه الخطوة):

```bash
npm run admin:create
```

سكربت تفاعلي (`scripts/adminCreate.js`) يطلب المعرّف/الاسم/كلمة المرور (8 أحرف على
الأقل، لا تُعرَض على الشاشة، لا تُسجَّل أو تُرسَل كنص صريح أبداً). يرفض العمل لو يوجد
بالفعل حساب مدير نشط إلا بتمرير `--reset` صراحة (ويطلب حينها كتابة `RESET` حرفياً
للتأكيد):

```bash
npm run admin:create -- --reset
```

---

## بنية الملفات

```
backend/
├── .env.example              # قالب الإعدادات (انسخه إلى .env)
├── package.json
├── prisma/
│   └── schema.prisma         # يُعاد توليده بـ db pull ليطابق studix (27 جدول)
├── scripts/
│   └── adminCreate.js        # npm run admin:create — إنشاء/إعادة ضبط حساب المدير
└── src/
    ├── server.js             # Express app + تشغيل + تفعيل كل الـ routes
    ├── prisma.js             # Prisma client singleton + فحص الاتصال
    ├── lib/                  # session.js, authCache.js, passwordVerify.js, caseMapper.js, transaction.js
    ├── middleware/           # auth.js, permissions.js, rateLimit.js, errorHandler.js
    └── routes/               # نقاط النهاية — عامة (crud.js/collections.js) + مخصّصة
        ├── health.js         # GET /health
        ├── session.js        # POST/DELETE /api/session (تسجيل الدخول/الخروج)
        ├── crud.js           # بنية CRUD عامة (مفعّلة على معظم الجداول)
        ├── collections.js    # خريطة اسم-الـ-API ↔ اسم الـ Prisma model لكل جدول
        └── ...               # ~15 ملف إضافي لعمليات ذرّية مخصّصة (حضور، درجات، خزنة، قبولات، ...)
```

---

## هام

- **`prisma migrate` ممنوع** — قاعدة `studix` موجودة ولا نعدّل schema-ها. نستخدم `db pull` فقط
  (لا يوجد مجلد `prisma/migrations/` في هذا المشروع، وهذا متعمَّد).
- **لا حساب مدير افتراضي** — `npm run admin:create` (الخطوة 7 أعلاه) هو المسار الوحيد
  لإنشاء أول مستخدم قابل لتسجيل الدخول.
