// backend/src/lib/caseMapper.js
// ─────────────────────────────────────────────────────────────
// تحويل أسماء المفاتيح بين قاعدة البيانات (snake_case) والتطبيق (camelCase).
// Phase 1 يستخدم snakeToCamel فقط (القراءة). camelToSnake جاهز للمستقبل.
// تحويل عميق (nested objects/arrays) وآمن مع القيم غير الكائنية.
// ─────────────────────────────────────────────────────────────
import { Prisma } from '@prisma/client';

function snakeToCamelKey(str) {
  return str.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function camelToSnakeKey(str) {
  return str.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

// تحويل عميق لكائن/مصفوفة
export function snakeToCamel(input) {
  if (Array.isArray(input)) return input.map(snakeToCamel);
  if (input === null || typeof input !== 'object') return input;
  // لا نحوّل التواريخ أو أنواع خاصة (Decimal له خصائص داخلية s/e/d — تفكيكها يكسر تسلسله كـ JSON)
  if (input instanceof Date || input instanceof Prisma.Decimal) return input;
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    out[snakeToCamelKey(k)] = snakeToCamel(v);
  }
  return out;
}

export function camelToSnake(input) {
  if (Array.isArray(input)) return input.map(camelToSnake);
  if (input === null || typeof input !== 'object') return input;
  if (input instanceof Date || input instanceof Prisma.Decimal) return input;
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    out[camelToSnakeKey(k)] = camelToSnake(v);
  }
  return out;
}
