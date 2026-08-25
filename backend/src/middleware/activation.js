// backend/src/middleware/activation.js
// ─────────────────────────────────────────────────────────────
// Phase 5b — Licensing enforcement. Global, mounted once, early (server.js) — unlike
// requireAuth/requirePermission/requireRole (applied per-router, opt-in), this gate is
// fail-closed-by-default: any new /api/* route added in the future is blocked unless
// explicitly allowlisted here. That's a deliberate reversal of this codebase's usual
// per-route-opt-in style, made for exactly this one gate, because the cost of forgetting
// to protect a route is "the whole product's licensing is bypassable" — see the Phase 5
// investigation report's explicit recommendation.
//
// Does not depend on req.user / requireAuth in any way — activation is a property of the
// INSTALLATION, not of who is asking, so this can (and does) run before/independently of
// authentication entirely.
// ─────────────────────────────────────────────────────────────
import { getLicenseStatus } from '../lib/license.js';

// القائمة البيضاء قصيرة وصريحة عمداً — يجب أن تبقى كذلك.
const ALLOWLISTED_API_PREFIXES = ['/api/session', '/api/license', '/api/support-access'];

// isActivationExempt: أي طلب ليس تحت /api/ إطلاقاً (ملفات ثابتة، مسارات SPA من جهة العميل،
// الجذر /) يُستثنى تلقائياً — التفعيل مصدر قلق على مستوى الـ API فقط، لا تحميل الصفحة نفسها
// (نفس منطق فحص req.path.startsWith('/api/') المستخدَم بالفعل في SPA fallback بـ
// server.js). /health ليس تحت /api/ أصلاً فيُستثنى من هذا الفحص وحده دون أي حالة خاصة له.
export function isActivationExempt(path) {
  if (!path.startsWith('/api/')) return true;
  return ALLOWLISTED_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// requireActivation: فشل مغلَق حتى في حالات الخطأ غير المتوقّعة — أي استثناء أثناء فحص
// الحالة (قاعدة بيانات غير متاحة مثلاً) يُعامَل كـ "غير مُفعَّل"، لا كـ "تجاوز الفحص".
export async function requireActivation(req, res, next) {
  if (isActivationExempt(req.path)) return next();

  let status;
  try {
    status = await getLicenseStatus();
  } catch {
    return res.status(402).json({ ok: false, error: 'تعذّر التحقّق من حالة التفعيل.', licenseRequired: true });
  }

  if (!status.activated) {
    return res.status(402).json({ ok: false, error: 'هذا التثبيت يتطلّب تفعيلاً صالحاً.', licenseRequired: true });
  }

  next();
}
