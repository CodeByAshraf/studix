#!/usr/bin/env node
// backend/scripts/fetchWindowsRuntimeDependencies.js
// ─────────────────────────────────────────────────────────────
// INSTALL-06 — build-time only. Downloads the pinned PostgreSQL and NSSM archives (versions/
// URLs/checksums in scripts/windows-runtime-dependencies.json — never invented here), verifies
// each against its pinned SHA256 (src/installer/fetchDependencies.js — refuses a placeholder or
// mismatched hash outright), and extracts them into the assembled runtime package at the
// exact contracted locations: <OutDir>\pgsql\ (INSTALL-03) and <OutDir>\tools\nssm.exe
// (INSTALL-05/06, decision #3).
//
// Never run automatically by the application, the installer, or by the automated test suite —
// invoked explicitly by scripts/build-windows-runtime.ps1 (a new, -SkipDependencyFetch-guarded
// step) or manually by a developer. Requires network access; will refuse to run against the
// placeholder checksums shipped in windows-runtime-dependencies.json until a human completes
// the one-time manual verification step (see migration/reports/INSTALL-06_INSTALLER_DESIGN.md).
//
// Usage: node scripts/fetchWindowsRuntimeDependencies.js <OutDir>
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  fetchAndVerify, extractZip, DependencyFetchError,
} from '../src/installer/fetchDependencies.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, 'windows-runtime-dependencies.json');

async function realDownload(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} فتح ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

async function fetchPostgres(manifest, outDir, tmpDir) {
  const cfg = manifest.postgresql;
  const zipPath = path.join(tmpDir, 'postgresql-binaries.zip');
  await fetchAndVerify({
    url: cfg.url, expectedSha256: cfg.sha256, label: `PostgreSQL ${cfg.version} binaries`,
    destPath: zipPath, downloadFn: realDownload,
  });

  const stagingDir = path.join(tmpDir, 'pg-extracted');
  extractZip(zipPath, stagingDir);

  const extractedPgsql = path.join(stagingDir, 'pgsql');
  const targetPgsql = path.join(outDir, cfg.extractTo);
  if (!fs.existsSync(path.join(extractedPgsql, 'bin', 'postgres.exe'))) {
    throw new DependencyFetchError(
      'unexpected_archive_shape',
      `أرشيف PostgreSQL لا يحتوي pgsql\\bin\\postgres.exe في الموضع المتوقَّع بعد الاستخراج ` +
      `(${extractedPgsql}) — قد يكون هيكل الأرشيف الداخلي قد تغيّر عن الإصدار المُثبَّت.`
    );
  }
  fs.rmSync(targetPgsql, { recursive: true, force: true });
  fs.cpSync(extractedPgsql, targetPgsql, { recursive: true });
  console.log(`✅ PostgreSQL ${cfg.version} -> ${targetPgsql}`);
}

async function fetchNssm(manifest, outDir, tmpDir) {
  const cfg = manifest.nssm;
  const zipPath = path.join(tmpDir, 'nssm.zip');
  await fetchAndVerify({
    url: cfg.url, expectedSha256: cfg.sha256, label: `NSSM ${cfg.version}`,
    destPath: zipPath, downloadFn: realDownload,
  });

  const stagingDir = path.join(tmpDir, 'nssm-extracted');
  extractZip(zipPath, stagingDir);

  const extractedExe = path.join(stagingDir, cfg.extractSourceSubpath);
  if (!fs.existsSync(extractedExe)) {
    throw new DependencyFetchError(
      'unexpected_archive_shape',
      `nssm.exe غير موجود في الموضع المتوقَّع بعد الاستخراج (${extractedExe}) — قد يكون هيكل ` +
      'الأرشيف الداخلي قد تغيّر عن الإصدار المُثبَّت.'
    );
  }
  const targetExe = path.join(outDir, cfg.extractTo);
  fs.mkdirSync(path.dirname(targetExe), { recursive: true });
  fs.copyFileSync(extractedExe, targetExe);
  console.log(`✅ NSSM ${cfg.version} -> ${targetExe}`);
}

async function main() {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('الاستخدام: node scripts/fetchWindowsRuntimeDependencies.js <OutDir>');
    process.exitCode = 1;
    return;
  }

  console.log('\n=== Studix — تنزيل تبعيات وقت التشغيل المُثبَّتة (PostgreSQL + NSSM) ===\n');

  const manifest = loadManifest();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-deps-'));
  // Each dependency is attempted independently — one being blocked (e.g. an unpinned checksum,
  // a network issue) must never hide real progress or a real failure on the other. The overall
  // script still fails (non-zero exit) if either one did, but both are always attempted.
  const jobs = [
    { name: 'PostgreSQL', run: () => fetchPostgres(manifest, outDir, tmpDir) },
    { name: 'NSSM', run: () => fetchNssm(manifest, outDir, tmpDir) },
  ];
  let anyFailed = false;
  try {
    for (const job of jobs) {
      try {
        // eslint-disable-next-line no-await-in-loop -- deliberately sequential, independent try/catch per job
        await job.run();
      } catch (err) {
        anyFailed = true;
        if (err instanceof DependencyFetchError) {
          console.error(`\n❌ [${job.name}] [${err.reason}] ${err.message}`);
        } else {
          console.error(`\n❌ [${job.name}] فشل غير متوقَّع:`, err.message);
        }
      }
    }
    if (anyFailed) {
      process.exitCode = 1;
    } else {
      console.log('\n✅ تم تنزيل والتحقّق من واستخراج كل التبعيات بنجاح.');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
