#!/usr/bin/env node
// tools/license-issuer.js
// Studix Licensing — owner-only offline issuer. Reads a customer's Activation Request Code
// (relayed out-of-band — phone, WhatsApp, email) and produces a signed License Artifact the
// customer pastes into the app's "Activate Studix" screen (POST /api/license/activate).
//
// Fully offline: no network call, no database connection, ever. The private key is loaded
// once from the owner-controlled key file (tools/lib/licenseKeyStorage.js) and never
// printed, logged, or included in any output this tool produces — only the resulting
// License Artifact (which is safe to send to the customer; it proves nothing about the key
// itself) is shown.
//
// This tool is never bundled into the application build, never shipped to customers, and
// has no relationship whatsoever to the customer application's own login (POST
// /api/session) or to Support Access — it only ever produces a license artifact.
import readline from 'readline';
import { pathToFileURL } from 'url';
import { loadPrivateKeyPem, resolvePrivateKeyPath, privateKeyExists } from './lib/licenseKeyStorage.js';
import { parseCustomerRequestCode, issueLicense, PRODUCT_ID } from './lib/licenseIssuing.js';

function formatDate(ms) {
  try { return new Date(ms).toLocaleString(); }
  catch { return String(ms); }
}

function parseFeatures(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const list = trimmed.split(',').map((f) => f.trim()).filter(Boolean);
  return list.length > 0 ? list : null;
}

async function runInteractive({ input = process.stdin, output = process.stdout, privateKeyPem }) {
  const rl = readline.createInterface({ input, output });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  output.write('\n=== Studix License Issuer ===\n');
  output.write('(Owner-only. Fully offline — no network or database access.)\n\n');

  for (;;) {
    const code = (await ask('Enter Activation Request Code (blank to exit):\n> ')).trim();
    if (!code) break;

    let requestInfo;
    try {
      requestInfo = parseCustomerRequestCode(code);
    } catch (err) {
      output.write(`\nError: ${err.message}\n\n`);
      continue;
    }

    output.write(`\nInstallation: ${requestInfo.installationId}\n`);
    output.write(`Product: ${requestInfo.product}\n\n`);

    const licenseIdInput = (await ask('License ID (blank to auto-generate):\n> ')).trim();

    const perpetualInput = (await ask('Perpetual license? [Y/n]:\n> ')).trim().toLowerCase();
    let expiresAt = null;
    if (perpetualInput.startsWith('n')) {
      const daysInput = (await ask('Expires in how many days from today?:\n> ')).trim();
      const days = Number(daysInput);
      if (!Number.isFinite(days) || days <= 0) {
        output.write('\nError: expected a positive number of days. Starting over.\n\n');
        continue;
      }
      expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
    }

    const featuresInput = await ask('Features, comma-separated (blank for none):\n> ');
    const notesInput = (await ask('Notes, e.g. customer name (blank for none):\n> ')).trim();

    try {
      const result = issueLicense({
        licenseId: licenseIdInput || undefined,
        installationId: requestInfo.installationId,
        product: requestInfo.product || PRODUCT_ID,
        expiresAt,
        features: parseFeatures(featuresInput),
        notes: notesInput || null,
      }, privateKeyPem);

      output.write('\nLicense Artifact:\n');
      output.write(`${result.artifact}\n\n`);
      output.write(`License ID: ${result.licenseId}\n`);
      output.write(`Issued: ${formatDate(result.issuedAt)}\n`);
      output.write(`Expires: ${result.expiresAt === null ? 'Never (perpetual)' : formatDate(result.expiresAt)}\n\n`);
    } catch (err) {
      output.write(`\nError: ${err.message}\n\n`);
    }
  }

  rl.close();
  output.write('Goodbye.\n');
}

async function main() {
  console.log('\n=== Studix License Issuer ===');
  console.log('(Owner-only. Fully offline — no network or database access.)\n');

  if (!privateKeyExists()) {
    console.error(`Private key not found at: ${resolvePrivateKeyPath()}`);
    console.error('Run "node tools/license-keygen.js" first to generate a keypair.\n');
    process.exitCode = 1;
    return;
  }

  let privateKeyPem;
  try {
    privateKeyPem = loadPrivateKeyPem();
  } catch (err) {
    console.error(`\nError: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`Private key loaded from: ${resolvePrivateKeyPath()}\n`);
  await runInteractive({ privateKeyPem });
}

// Exported for tests — the interactive loop is driven entirely through the input/output
// streams passed in, so tests can feed it in-memory streams instead of real stdin/stdout.
export { runInteractive };

// Only auto-run when executed directly (`node tools/license-issuer.js`), never when
// imported by a test file.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
