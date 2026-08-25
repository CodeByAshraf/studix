// backend/src/routes/health.js
// ─────────────────────────────────────────────────────────────
// Health check — يتحقق من أن الخادم حيّ وأن قاعدة البيانات متصلة.
// ─────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma, checkDbConnection } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// يستخرج بيانات الاتصال الآمنة فقط من DATABASE_URL (بدون كلمة المرور أبداً)
function getSanitizedConnectionInfo() {
  try {
    const url = new URL(process.env.DATABASE_URL);
    return {
      host: url.hostname || null,
      port: url.port || null,
      database: url.pathname.replace(/^\//, '') || null,
      user: url.username || null,
    };
  } catch {
    return null;
  }
}

// GET /health — حالة الخادم + الاتصال بقاعدة البيانات
router.get('/', asyncHandler(async (req, res) => {
  const db = await checkDbConnection();

  // عدّ الجداول الفعلية في القاعدة (من information_schema)
  let tableCount = null;
  if (db.connected) {
    try {
      const rows = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS count
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `;
      tableCount = rows?.[0]?.count ?? null;
    } catch {
      tableCount = null;
    }
  }

  res.status(db.connected ? 200 : 503).json({
    ok: db.connected,
    service: 'studix-backend',
    time: new Date().toISOString(),
    database: {
      connected: db.connected,
      tableCount,
      error: db.error || null,
      connection: getSanitizedConnectionInfo(),
    },
  });
}));

export default router;
