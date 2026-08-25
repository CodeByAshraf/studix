// src/utils/validation.js
// ─────────────────────────────────────────────────────────────────────────────
// Centralized Validation Engine
//
// قبل: كل service لها validation منفصلة بأسلوب مختلف
//      بعض الـ services تتحقق من الهاتف، بعضها لا
//      لا يوجد shared rules — نفس القاعدة مكتوبة 5 مرات
//
// بعد: قواعد atomic قابلة للتركيب (composable)
//      كل service تستخدم نفس الـ validators
//      تغيير قاعدة واحدة = يُطبَّق في كل مكان
//
// النمط:
//   validators.required(value) → string | null
//   null = صحيح، string = رسالة الخطأ
//
//   validate({ name: validators.required, phone: validators.egyptPhone })
//   → { name: 'error', phone: null }
// ─────────────────────────────────────────────────────────────────────────────
import { sanitizeText } from './sanitize';

// ── Atomic validators ─────────────────────────────────────────────────────────
// كل validator يأخذ قيمة ويُعيد null (صحيح) أو رسالة خطأ
export const validators = {

  required: (label = 'هذا الحقل') => (value) => {
    if (value === null || value === undefined) return `${label} مطلوب`;
    if (typeof value === 'string' && !value.trim()) return `${label} مطلوب`;
    if (Array.isArray(value) && value.length === 0) return `${label} مطلوب`;
    return null;
  },

  minLength: (min, label = 'النص') => (value) => {
    if (!value) return null; // let required handle empty
    if (String(value).trim().length < min) return `${label} يجب أن يكون ${min} أحرف على الأقل`;
    return null;
  },

  maxLength: (max, label = 'النص') => (value) => {
    if (!value) return null;
    if (String(value).trim().length > max) return `${label} يجب ألا يتجاوز ${max} حرفاً`;
    return null;
  },

  minWords: (min) => (value) => {
    if (!value) return null;
    if (value.trim().split(/\s+/).filter(Boolean).length < min)
      return `أدخل ${min === 2 ? 'الاسم الثنائي' : `${min} كلمات`} على الأقل`;
    return null;
  },

  egyptPhone: (value) => {
    if (!value) return null;
    const cleaned = String(value).replace(/\s/g, '');
    if (!/^01[0-2,5]{1}[0-9]{8}$/.test(cleaned))
      return 'رقم هاتف غير صحيح (01XXXXXXXXX)';
    return null;
  },

  positiveNumber: (label = 'القيمة') => (value) => {
    const n = Number(value);
    if (isNaN(n) || n <= 0) return `${label} يجب أن يكون أكبر من صفر`;
    return null;
  },

  nonNegative: (label = 'القيمة') => (value) => {
    const n = Number(value);
    if (isNaN(n) || n < 0) return `${label} يجب أن يكون صفراً أو أكثر`;
    return null;
  },

  integerRange: (min, max, label = 'القيمة') => (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max)
      return `${label} يجب أن يكون بين ${min} و${max}`;
    return null;
  },

  dateString: (value) => {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'تنسيق التاريخ غير صحيح (YYYY-MM-DD)';
    const d = new Date(value);
    if (isNaN(d.getTime())) return 'تاريخ غير صالح';
    return null;
  },

  notFuture: (label = 'التاريخ') => (value) => {
    if (!value) return null;
    if (new Date(value) > new Date()) return `${label} لا يمكن أن يكون في المستقبل`;
    return null;
  },

  noScript: (value) => {
    if (!value) return null;
    const dangerous = /<script|javascript:|on\w+\s*=/i;
    if (dangerous.test(String(value))) return 'النص يحتوي على محتوى غير مسموح';
    return null;
  },

  password: (value) => {
    if (!value) return null;
    if (value.length < 6)  return 'كلمة المرور 6 أحرف على الأقل';
    if (value.length > 128) return 'كلمة المرور طويلة جداً';
    return null;
  },

  unique: (existingValues, currentId = null, label = 'القيمة') => (value) => {
    if (!value) return null;
    const isDuplicate = existingValues.some(
      (item) => String(item.value).toLowerCase() === String(value).toLowerCase()
                && item.id !== currentId
    );
    if (isDuplicate) return `${label} مستخدم بالفعل`;
    return null;
  },

  oneOf: (options, label = 'القيمة') => (value) => {
    if (!value) return null;
    if (!options.includes(value)) return `${label} غير صالح`;
    return null;
  },
};

// ── Compose: تُركِّب عدة validators على حقل واحد ─────────────────────────────
// أول خطأ يُوقف التحقق
export function compose(...fns) {
  return (value) => {
    for (const fn of fns) {
      const error = fn(value);
      if (error) return error;
    }
    return null;
  };
}

// ── validate: يُطبّق schema على object ────────────────────────────────────────
// schema: { fieldName: validatorFn | composedFn }
// يُعيد: { fieldName: errorMessage } — الحقول الصحيحة غير موجودة في النتيجة
export function validate(schema, data) {
  const errors = {};
  for (const [field, validatorFn] of Object.entries(schema)) {
    const error = validatorFn(data[field]);
    if (error) errors[field] = error;
  }
  return errors;
}

// ── hasErrors: فحص سريع ──────────────────────────────────────────────────────
export function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}

// ── sanitizeFormData: ينظف كل الحقول النصية قبل الحفظ ──────────────────────
export function sanitizeFormData(data, textFields = []) {
  const clean = { ...data };
  textFields.forEach((field) => {
    if (typeof clean[field] === 'string') {
      clean[field] = sanitizeText(clean[field]);
    }
  });
  return clean;
}

// ── Pre-built schemas للاستخدام المباشر ──────────────────────────────────────

export const studentSchema = {
  name:    compose(validators.required('اسم الطالب'), validators.minWords(2), validators.noScript),
  phone:   compose(validators.required('رقم الهاتف'), validators.egyptPhone),
  grade:   validators.required('السنة الدراسية'),
  groupId: validators.required('المجموعة'),
};

export const groupSchema = {
  name:    compose(validators.required('اسم المجموعة'), validators.minLength(3, 'الاسم'), validators.noScript),
  grade:   validators.required('السنة الدراسية'),
  subject: validators.required('المادة'),
  time:    validators.required('موعد الحصة'),
  price:   validators.nonNegative('السعر'),
  max:     compose(validators.required('الحد الأقصى'), validators.positiveNumber('الحد الأقصى')),
  days:    validators.required('أيام الحصة'),
};

export const paymentSchema = {
  studentId: validators.required('الطالب'),
  // Phase 3B-14C (قرار 3 صريح): لا اختيار ضمني لخزنة افتراضية — الخزنة حقل مطلوب في
  // النموذج نفسه، بنفس قوة studentId/amount/month/date.
  cashboxId: validators.required('الخزنة'),
  amount:    compose(validators.required('المبلغ'), validators.positiveNumber('المبلغ')),
  month:     validators.required('الشهر'),
  date:      compose(validators.required('التاريخ'), validators.dateString),
};

export const attendanceSchema = {
  groupId:     validators.required('المجموعة'),
  date:        compose(validators.required('التاريخ'), validators.dateString, validators.notFuture('تاريخ الحصة')),
  sessionTime: validators.required('وقت الحصة'),
};

export const examSchema = {
  name:    compose(validators.required('اسم الامتحان'), validators.noScript),
  groupId: validators.required('المجموعة'),
  date:    compose(validators.required('التاريخ'), validators.dateString),
  total:   compose(validators.required('الدرجة الكلية'), validators.positiveNumber('الدرجة الكلية')),
  pass:    compose(validators.required('درجة النجاح'), validators.nonNegative('درجة النجاح')),
};

export const materialSchema = {
  name:    compose(validators.required('اسم المذكرة'), validators.noScript),
  subject: validators.required('المادة'),
  grade:   validators.required('المرحلة الدراسية'),
  price:   compose(validators.required('السعر'), validators.nonNegative('السعر')),
};

export const treasurySchema = {
  amount:      compose(validators.required('المبلغ'), validators.positiveNumber('المبلغ')),
  date:        compose(validators.required('التاريخ'), validators.dateString),
  category:    validators.required('الفئة'),
  description: compose(validators.required('الوصف'), validators.noScript),
};

export const userSchema = {
  name:     compose(validators.required('الاسم'), validators.noScript),
  id:       compose(validators.required('المعرّف'), validators.minLength(3, 'المعرّف'), validators.noScript),
  role:     validators.required('الدور'),
  password: validators.password,
};

export const teacherSchema = {
  name:    compose(validators.required('اسم المعلم'), validators.minWords(2), validators.noScript),
  subject: validators.required('المادة'),
};
