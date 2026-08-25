// backend/src/prisma.js
// ─────────────────────────────────────────────────────────────
// Prisma Client — instance واحدة مشتركة (singleton).
// يُولّد بعد `prisma db pull` + `prisma generate` على جهازك.
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from '@prisma/client';

// singleton يمنع تعدد الاتصالات أثناء التطوير (hot reload)
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// فحص الاتصال بقاعدة البيانات
export async function checkDbConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { connected: true };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}
