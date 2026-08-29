// backend/src/installer/fetchDependencies.js
// ─────────────────────────────────────────────────────────────
// INSTALL-06 — build-time acquisition of the two third-party binaries the assembled Windows
// runtime package needs but this repository never vendors into git: PostgreSQL (INSTALL-03's
// pgsql\ contract) and NSSM (INSTALL-05's tools\nssm.exe contract, per the approved runtime
// layout). Invoked once, at build time, by scripts/build-windows-runtime.ps1 — never by the
// installer or by the running application. Downloads nothing during the automated test suite;
// every network/filesystem/extraction call here is injectable.
//
// Checksum policy (explicit decision, not invented): neither EDB's PostgreSQL "binaries" zip
// nor NSSM's release zip has an officially published SHA256 on their own download pages
// (verified during the INSTALL-06 audit). This module therefore verifies against a
// SELF-ESTABLISHED, manually-verified pinned hash (see windows-runtime-dependencies.json) —
// never invents or trusts an upstream-published value that doesn't exist, and never silently
// skips verification. A placeholder hash (see PLACEHOLDER_SHA256 below) is refused outright,
// loudly, rather than treated as "verification passed."
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

export class DependencyFetchError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

// The literal placeholder value windows-runtime-dependencies.json ships with until a human
// performs the one-time manual acquisition-and-verification step documented in
// migration/reports/INSTALL-06_INSTALLER_DESIGN.md. Never a valid SHA256 (wrong length/charset
// by construction), but checked explicitly anyway so the failure message is unambiguous rather
// than a generic "checksum mismatch".
export const PLACEHOLDER_SHA256 = 'REPLACE_WITH_MANUALLY_VERIFIED_SHA256_BEFORE_USE';

const REAL_IO = {
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync,
  readFileSync: fs.readFileSync,
  rmSync: fs.rmSync,
  execFileSync,
};

// computeSha256: pure, injectable-via-io — reads the file and returns its lowercase hex SHA256.
export function computeSha256(filePath, io = {}) {
  const { readFileSync } = { ...REAL_IO, ...io };
  const buffer = readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// assertChecksumPinned: the placeholder/empty check, factored out so fetchAndVerify can run it
// BEFORE ever attempting a download — no point spending a network round-trip (or, worse,
// attempting to fetch a still-placeholder URL string) for a dependency that was never going to
// pass verification anyway.
function assertChecksumPinned(expectedSha256, label) {
  if (!expectedSha256 || expectedSha256 === PLACEHOLDER_SHA256) {
    throw new DependencyFetchError(
      'checksum_not_pinned',
      `لا يوجد بصمة SHA256 مُثبَّتة فعلياً لـ "${label}" — لا يزال placeholder. يجب إتمام خطوة ` +
      'التحقّق اليدوي لمرة واحدة (راجع migration/reports/INSTALL-06_INSTALLER_DESIGN.md) قبل ' +
      'استخدام هذا الملف في أي بناء حقيقي.'
    );
  }
}

// verifyChecksum: throws DependencyFetchError on a placeholder or mismatched hash — never
// returns a partial/ambiguous result. `label` is only used to produce a clear message.
export function verifyChecksum(filePath, expectedSha256, { label = filePath, io = {} } = {}) {
  assertChecksumPinned(expectedSha256, label);
  const actual = computeSha256(filePath, io);
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new DependencyFetchError(
      'checksum_mismatch',
      `بصمة SHA256 لـ "${label}" لا تطابق القيمة المُثبَّتة — الملف قد يكون تالفاً أو مُستبدَلاً. ` +
      `المتوقَّع: ${expectedSha256} — الفعلي: ${actual}. تم رفض استخدامه.`
    );
  }
  return { verified: true, sha256: actual };
}

// downloadFile: injectable so no automated test ever performs a real network fetch.
// downloadFn(url) must return a Promise<Buffer>.
export async function downloadFile(url, destPath, { downloadFn, io = {} } = {}) {
  if (typeof downloadFn !== 'function') {
    throw new DependencyFetchError('missing_download_fn', 'downloadFn مطلوبة صراحةً (لا تنزيل ضمنيّ افتراضي).');
  }
  const { mkdirSync, writeFileSync = fs.writeFileSync } = { ...REAL_IO, ...io };
  let buffer;
  try {
    buffer = await downloadFn(url);
  } catch (err) {
    throw new DependencyFetchError('download_failed', `فشل تنزيل ${url}: ${err.message}`);
  }
  mkdirSync(path.dirname(destPath), { recursive: true });
  writeFileSync(destPath, buffer);
  return { path: destPath, bytes: buffer.length };
}

// extractZip: shells out to Windows 10 1803+'s built-in tar.exe (bsdtar, handles .zip natively)
// — no new dependency, no PowerShell child-process hop. Injectable execFileSync, so no
// automated test ever spawns a real process.
export function extractZip(zipPath, destDir, io = {}) {
  const { mkdirSync, execFileSync: exec } = { ...REAL_IO, ...io };
  mkdirSync(destDir, { recursive: true });
  try {
    exec('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'pipe' });
  } catch (err) {
    throw new DependencyFetchError('extract_failed', `فشل استخراج ${zipPath}: ${err.message}`);
  }
  return { destDir };
}

// fetchAndVerify: the composed step — download, verify checksum, and only then hand back a
// path a caller may extract/use. Never extracts (or lets a caller believe it's safe to extract)
// an unverified or corrupted download; the temp download is removed on a failed verification.
export async function fetchAndVerify({ url, expectedSha256, label, destPath, downloadFn, io = {} } = {}) {
  assertChecksumPinned(expectedSha256, label); // fail before spending a network round-trip
  await downloadFile(url, destPath, { downloadFn, io });
  try {
    verifyChecksum(destPath, expectedSha256, { label, io });
  } catch (err) {
    const { existsSync, rmSync } = { ...REAL_IO, ...io };
    if (existsSync(destPath)) rmSync(destPath, { force: true });
    throw err;
  }
  return { path: destPath };
}
