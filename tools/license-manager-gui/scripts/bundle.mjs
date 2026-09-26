// tools/license-manager-gui/scripts/bundle.mjs
// Studix License Manager — build-time bundling step (Phase 3), run before both `npm start`
// and `npm run build:portable`.
//
// WHY this exists: main/main.js imports main/ipcRegister.js, which imports
// core/licenseCore.js, which imports tools/lib/licenseIssuing.js, which imports
// backend/src/lib/licenseArtifactFormat.js — all OUTSIDE tools/license-manager-gui/. Those
// paths only exist on a machine that has this whole monorepo checked out. electron-builder's
// packager only includes files from within THIS project directory (see package.json's
// "build.files"), so shipping the raw source files unbundled would silently produce a
// portable exe that crashes on launch on any machine that doesn't also happen to have the
// Studix source tree at the exact same relative path — defeating the entire point of
// "standalone."
//
// The fix (exactly the migration/compatibility plan approved in the Phase 2 audit, Section
// F): esbuild resolves and inlines the ENTIRE import graph — including the real, unmodified
// licenseArtifactFormat.js/licenseIssuing.js — into one self-contained dist/main.js at build
// time. This is not a copy-paste of the protocol logic; it's the literal same source text,
// compiled in. Any future change to the canonical files is picked up automatically on the
// next bundle. main/preload.cjs and renderer/**/* are NOT bundled — they have no imports
// reaching outside tools/license-manager-gui/, so they ship as-is (see main.js's own comment
// on the preload path for why this is safe).
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(here, '..');

await build({
  entryPoints: [path.join(projectRoot, 'main', 'main.js')],
  outfile: path.join(projectRoot, 'dist', 'main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  external: ['electron'],
  banner: { js: '// Studix License Manager — bundled main process. See scripts/bundle.mjs for what this contains and why.' },
});

console.log('Bundled main/main.js (+ core/licenseCore.js + tools/lib/licenseIssuing.js + backend/src/lib/licenseArtifactFormat.js) -> dist/main.js');
