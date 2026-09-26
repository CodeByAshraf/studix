#!/usr/bin/env node
// backend/scripts/manageScheduledTask.js
// ─────────────────────────────────────────────────────────────
// Phase 4 — thin CLI over lib/scheduledTask.js's removeStartupTask() (P1-1: applied to every
// Studix task — boot orchestrator and daily backup, see STUDIX_TASK_NAMES), mirroring
// manageWindowsServices.js's own shape exactly (decision #1, reused from INSTALL-06: keep Pascal
// Script minimal, one Exec() call to bundled node.exe against a small Node-side CLI — never
// reimplement schtasks logic in Pascal Script). All real logic (existence check, idempotency,
// error classification) lives in lib/scheduledTask.js — this file only parses argv, calls the
// matching function, and prints the result.
//
// This is the uninstall-time counterpart to Phase 3's registration, which firstInstall.js already
// calls directly (no CLI layer needed there) — registration is never exposed through this CLI,
// only removal, since uninstall's Pascal Script (unlike firstInstall.js) has no other way to
// invoke Node-side logic than Exec()-ing a script like this one.
//
// Usage:
//   node scripts/manageScheduledTask.js remove
//
// Requires Administrator privileges (Task Scheduler modification), same as
// manageWindowsServices.js.
// ─────────────────────────────────────────────────────────────
import { pathToFileURL } from 'url';
import {
  removeStartupTask, STUDIX_STARTUP_TASK_NAME, STUDIX_BACKUP_TASK_NAME, ScheduledTaskError,
} from '../src/lib/scheduledTask.js';

// P1-1 — every Studix scheduled task: the boot orchestrator (Phase 3) and the routine daily
// database backup. Each is removed independently — one failing never skips the other.
export const STUDIX_TASK_NAMES = Object.freeze([STUDIX_STARTUP_TASK_NAME, STUDIX_BACKUP_TASK_NAME]);

function usageAndExit() {
  console.error('الاستخدام: node scripts/manageScheduledTask.js remove');
  process.exitCode = 1;
}

// run: exported (mirrors manageWindowsServices.js's own exported TARGETS) purely so a test can
// drive the CLI's actual branching/reporting logic directly, with a controlled `action` and a
// mocked removeStartupTask, instead of reaching for real process.argv/real process.exitCode.
export async function run(action) {
  if (action !== 'remove') {
    usageAndExit();
    return;
  }

  for (const taskName of STUDIX_TASK_NAMES) {
    console.log(`\n=== Studix — إدارة المهمة المجدولة (${taskName}) — remove ===\n`);

    try {
      const result = removeStartupTask({ taskName });
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      if (err instanceof ScheduledTaskError) {
        console.error(`❌ [${err.reason}] ${err.message}`);
      } else {
        console.error('❌ فشل غير متوقَّع:', err.message);
      }
      process.exitCode = 1;
    }
  }
}

// Only auto-run when executed directly (`node scripts/manageScheduledTask.js ...`), never when
// imported by a test file — same guard convention as manageWindowsServices.js.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , action] = process.argv;
  run(action);
}
