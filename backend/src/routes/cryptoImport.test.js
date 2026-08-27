// backend/src/routes/cryptoImport.test.js
// Phase — BUG-01 fix verification (audit finding: crypto.randomUUID() called without an
// explicit `import crypto from 'crypto'` in 10 route files — relies on globalThis.crypto,
// which is only unconditionally present starting Node 19; the project's own documented
// minimum is Node 18). Pure static source check — no database, no network — deterministic
// regression guard: if the import is ever removed again, this fails immediately.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FILES = [
  'crud.js', 'payments.js', 'treasuryTxn.js', 'admissionActivation.js',
  'admissionCancellation.js', 'admissionPayments.js', 'attendanceSessions.js',
  'examGrades.js', 'hwSubmissions.js', 'materialDistribution.js',
];

describe('BUG-01 — explicit crypto import present before any crypto.* usage', () => {
  for (const filename of FILES) {
    it(`${filename} imports 'crypto' explicitly, before its first crypto.* usage`, () => {
      const source = fs.readFileSync(path.join(__dirname, filename), 'utf8');
      const importMatch = source.match(/^import crypto from ['"]crypto['"];?\s*$/m);
      expect(importMatch, `${filename} must have "import crypto from 'crypto'"`).not.toBeNull();

      const firstUsageIndex = source.search(/crypto\.\w/);
      if (firstUsageIndex !== -1) {
        expect(importMatch.index).toBeLessThan(firstUsageIndex);
      }
    });
  }
});
