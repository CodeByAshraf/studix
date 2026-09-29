// backend/src/routes/studentDelete.js
// ─────────────────────────────────────────────────────────────────────────────
// M2/F3 — server-side related-record guard for DELETE /api/students/:id.
//
// StudentsPage used to run these checks client-side by reading grades ('exams'),
// hw_submissions ('homework') and payments ('payments') before deleting. A 403 from any of
// those reads aborted the delete, so a user with only the 'students' permission could not
// delete even a student with no related data at all.
//
// The checks now run here, inside the delete request itself — mounted in server.js with the
// same requireAuth + requirePermission('students') chain as the generic DELETE it guards. So
// deleting a student requires exactly 'students' (as before), no other permission is needed,
// nothing but a count reaches the response, and the rules cannot be bypassed via the API.
// Same checks, order and messages the page used; the page's remaining checks are only an
// early, friendlier path to the same answers.
//
// Only DELETE /:id is intercepted, and only to reject; when every check passes it calls
// next() and the generic CRUD router performs the delete exactly as before (missing student →
// 404, any other FK violation → 409, unchanged). Same technique as groupDelete.js.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const STUDENT_HAS_RELATED_RECORDS = 'STUDENT_HAS_RELATED_RECORDS';

// [table, message suffix] — in the order StudentsPage checked them.
const RELATED = [
  ['attendance', 'سجل حضور'],
  ['grades', 'درجة مسجّلة'],
  ['admissions', 'سجل قبول'],
  ['communications', 'سجل تواصل'],
  ['hw_submissions', 'تسليم واجب'],
  ['inventory_txn', 'حركة مخزون'],
  ['payments', 'دفعة مسجّلة'],
  ['wa_report_log', 'سجل تقرير واتساب'],
];

const router = Router();

router.delete('/:id', asyncHandler(async (req, res, next) => {
  const student = await prisma.students.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
  if (!student) return next(); // generic router answers 404, unchanged

  for (const [table, label] of RELATED) {
    // Sequential on purpose: stop at the first blocking relation and report it, as the page did.
    const count = await prisma[table].count({ where: { student_id: student.id } });
    if (count > 0) {
      return res.status(409).json({
        ok: false,
        code: STUDENT_HAS_RELATED_RECORDS,
        error: `لا يمكن حذف ${student.name} — له ${count} ${label}. أوقفه بدلاً من حذفه (الحالة: موقوف).`,
      });
    }
  }
  next();
}));

export default router;
