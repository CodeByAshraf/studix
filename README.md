# 🎓 Studix — مركز النور التعليمي

نظام إدارة مركز تعليمي متكامل — React (Vite) + Node.js (Express) + PostgreSQL (Prisma)

---

## 📋 متطلبات التشغيل

| البرنامج | الإصدار | رابط |
|---|---|---|
| Node.js | 18+ | https://nodejs.org |
| PostgreSQL | 13+ | https://www.postgresql.org/download |

---

## 🗄️ الخطوة 1 — إعداد الـ Backend

قاعدة PostgreSQL (باسم `studix` افتراضياً) يجب أن تكون موجودة ومتاحة على جهازك قبل هذه الخطوة — هذا المشروع لا يُنشئ قاعدة البيانات، فقط يتصل بها ويقرأ هيكلها (`prisma db pull`).

```bash
cd backend
copy .env.example .env
```

عدّل `backend/.env`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/studix"
PORT=4000
FRONTEND_ORIGIN=http://localhost:5173
SESSION_SECRET=          # ولّد قيمة عشوائية طويلة، مثال أدناه
```

لتوليد `SESSION_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
npm install
npm run db:pull       # يقرأ هيكل قاعدة studix الفعلي ويطابق schema.prisma معه (قراءة فقط — لا يُعدّل القاعدة)
npm run db:generate   # يولّد Prisma Client
npm run dev           # مع إعادة تحميل تلقائي، أو: npm start
```

اختبر: http://localhost:4000/health → استجابة مشابهة لـ:
```json
{ "ok": true, "service": "studix-backend", "database": { "connected": true, "tableCount": 27, "error": null } }
```

---

## 👤 الخطوة 2 — إنشاء حساب المدير الأول

**لا يوجد أي حساب افتراضي مزروع في قاعدة البيانات.** قاعدة `studix` جديدة تماماً لا تحتوي أي مستخدم قابل لتسجيل الدخول حتى تُنشئه بنفسك — ولا توجد أي آلية تلقائية (مثل ترقية كلمة مرور نصّية إلى hash عند أول دخول) تُغني عن هذه الخطوة.

من داخل `backend/`:

```bash
npm run admin:create
```

سكربت تفاعلي (`backend/scripts/adminCreate.js`) يطلب: المعرّف، الاسم، وكلمة المرور (8 أحرف على الأقل، لا تُعرَض على الشاشة أثناء الكتابة، ولا تُسجَّل أو تُرسَل كنص صريح أبداً — تُجزَّأ فوراً بنفس الآلية التي يتحقق بها الخادم عند تسجيل الدخول).

يرفض العمل لو يوجد بالفعل حساب مدير نشط، إلا لو مرّرت `--reset` صراحة (ويطلب حينها كتابة `RESET` حرفياً للتأكيد قبل أي تعديل):

```bash
npm run admin:create -- --reset
```

---

## 🌐 الخطوة 3 — تشغيل الـ Frontend

```bash
# في terminal جديد بالمجلد الرئيسي (وليس backend/)
npm install
npm run dev
```

افتح: http://localhost:5173 — سجّل الدخول بالحساب الذي أنشأته في الخطوة 2.

---

## 🏗️ هيكل المشروع

```
tutoring-center-react/
├── backend/                    ← Node.js Backend (Express + Prisma + PostgreSQL، Port 4000)
│   ├── .env.example
│   ├── prisma/schema.prisma    ← يُولَّد تلقائياً بـ `db pull` من قاعدة studix (27 جدول)
│   ├── scripts/adminCreate.js  ← npm run admin:create (إنشاء/إعادة ضبط حساب المدير)
│   └── src/
│       ├── server.js
│       ├── routes/             ← نقاط النهاية (عامة + مخصّصة لعمليات ذرّية)
│       ├── middleware/         ← auth.js, permissions.js, rateLimit.js, errorHandler.js
│       └── lib/                ← session.js, authCache.js, passwordVerify.js, transaction.js
└── src/                        ← React Frontend (Vite، Port 5173)
    ├── services/api.js         ← HTTP client مركزي، عنوان الـ backend محدَّد هنا مباشرة
    ├── store/                  ← حالة التطبيق (Zustand slices)
    └── modules/                ← صفحات/موديولات التطبيق
```

---

## 🔌 أمثلة على API Endpoints

معظم الكيانات (الطلاب، المجموعات، المدفوعات، الامتحانات، ...) لها نمط CRUD عام موحّد
(`GET/POST/PUT/DELETE /api/<collection>`، بحسب الصلاحية والقابلية للكتابة). بعض العمليات
التي تحتاج معاملة ذرّية عبر أكثر من جدول لها نقاط نهاية مخصّصة:

```
POST   /api/session                  تسجيل الدخول (id + password) — ينشئ كوكي جلسة HttpOnly
DELETE /api/session                  تسجيل الخروج
GET    /api/students                 كل الطلاب
POST   /api/students                 إضافة طالب
PUT    /api/students/:id             تعديل طالب
DELETE /api/students/:id             حذف طالب
GET    /api/groups                   المجموعات
GET    /api/payments                 المدفوعات
POST   /api/payments                 تسجيل دفعة (سجل مالي غير قابل للتعديل/الحذف لاحقاً)
POST   /api/attendance-sessions      حفظ جلسة حضور لمجموعة كاملة دفعة واحدة
POST   /api/exam-grades              حفظ درجات امتحان (bulk)
GET    /api/treasuryTxn              معاملات الخزنة
GET    /health                       اختبار الاتصال بالخادم وقاعدة البيانات
```

> الإشعارات (notifications) تُحسَب بالكامل في الواجهة الأمامية من بيانات موجودة بالفعل
> (تواصل/مدفوعات/قبولات) — لا يوجد لها endpoint مخصّص في الـ backend.

---

## 🔄 تشغيل يومي

```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
npm run dev
```

### تشغيل تلقائي مع الجهاز (اختياري)

```bash
npm install -g pm2
cd backend
pm2 start src/server.js --name studix-backend
pm2 startup
pm2 save
```

---

## 📱 استخدام على شبكة محلية

LAN access is not currently configurable through `VITE_API_URL`. Enabling a different
frontend/backend host requires a source/configuration change.

(عنوان الـ backend الذي تتصل به الواجهة الأمامية ثابت حالياً داخل `src/services/api.js`
— تغيير `.env`/`VITE_API_URL` لا تأثير له عملياً على هذا. الوصول عبر الشبكة المحلية
يحتاج تعديل المصدر نفسه، وليس مجرد متغيّر بيئة.)

---

## 🛠️ استكشاف الأخطاء

| المشكلة | الحل |
|---|---|
| "فشل الاتصال بقاعدة البيانات" عند تشغيل الـ backend | تأكد PostgreSQL شغّال و`DATABASE_URL` في `backend/.env` صحيح |
| "Failed to fetch" أو خطأ اتصال بالمنفذ 4000 | شغّل الـ backend أولاً (`cd backend && npm run dev`) |
| "بيانات الدخول غير صحيحة" رغم التأكد من كلمة المرور | لا يوجد حساب افتراضي — تأكد أنك نفّذت `npm run admin:create` فعلاً من `backend/` |
| صفحة بيضاء بعد فتح http://localhost:5173 | تأكد أن الـ backend شغّال على المنفذ 4000 وأن `npm install` تمّ بنجاح في المجلد الرئيسي |
| "Cannot find module" | `npm install` في `backend/` (لخطأ من الـ backend) أو في المجلد الرئيسي (لخطأ من الواجهة) |
