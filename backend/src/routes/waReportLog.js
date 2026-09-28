// backend/src/routes/waReportLog.js
// ─────────────────────────────────────────────────────────────────────────────
// wa_report_log — the internal audit row written when a student report's WhatsApp message is
// prepared (StudentReportPage.jsx, status 'prepared'). Mounted before the dynamic collections
// loop on the same /api/waReportLog the generic CRUD (crud.js) serves, with the same
// requireAuth + requirePermission('students') guard — this router only makes the author
// server-derived; every write still goes through the generic CRUD unchanged.
//
// Same technique as treasuryTxn.js's POST interceptor: crud.js has no way to inject a value
// derived from the session, so the body's author is replaced here before next():
//   - POST /     — created_by is ALWAYS req.user.id; any client-supplied createdBy/created_by
//                  is discarded (no impersonation of another user).
//   - PUT/PATCH  — any client-supplied author is dropped, so an existing row can never be
//                  re-attributed through the generic update either.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';

function withoutAuthor(body) {
  // eslint-disable-next-line no-unused-vars
  const { createdBy, created_by, ...rest } = body || {};
  return rest;
}

const router = Router();

router.post('/', (req, res, next) => {
  req.body = { ...withoutAuthor(req.body), createdBy: req.user?.id ?? null };
  next();
});

const stripAuthorOnUpdate = (req, res, next) => {
  req.body = withoutAuthor(req.body);
  next();
};
router.put('/:id', stripAuthorOnUpdate);
router.patch('/:id', stripAuthorOnUpdate);

export default router;
