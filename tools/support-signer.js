#!/usr/bin/env node
// tools/support-signer.js
// Studix Support Access — owner-only offline signer. Reads a customer's challenge (relayed
// out-of-band — phone, WhatsApp, email) and produces the signed response the customer
// pastes into the app's "Support Access" screen (POST /api/support-access/verify).
//
// Fully offline: no network call, no database connection, ever. The private key is loaded
// once from the owner-controlled key file (tools/lib/keyStorage.js) and never printed,
// logged, or included in any output this tool produces — only the resulting response code
// (which is safe to send to the customer; it proves nothing about the key itself) is shown.
//
// This tool is never bundled into the application build, never shipped to customers, and
// has no relationship whatsoever to the customer application's own login (POST
// /api/session) — it only ever produces a Support Access response code.
import readline from 'readline';
import { pathToFileURL } from 'url';
import { loadPrivateKeyPem, resolvePrivateKeyPath, privateKeyExists } from './lib/keyStorage.js';
import { signChallenge } from './lib/challengeSigning.js';

function formatExpiry(expiresAt) {
  try { return new Date(expiresAt).toLocaleString(); }
  catch { return String(expiresAt); }
}

async function runInteractive({ input = process.stdin, output = process.stdout, privateKeyPem }) {
  const rl = readline.createInterface({ input, output });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  output.write('\n=== Studix Support Access Signer ===\n');
  output.write('(Owner-only. Fully offline — no network or database access.)\n\n');

  for (;;) {
    const challenge = (await ask('Enter Support Challenge (blank to exit):\n> ')).trim();
    if (!challenge) break;

    try {
      const result = signChallenge(challenge, privateKeyPem);
      output.write('\nResponse Code:\n');
      output.write(`${result.response}\n`);
      output.write(`\nExpires: ${formatExpiry(result.expiresAt)}\n`);
      output.write(`Installation: ${result.installationId}\n\n`);
    } catch (err) {
      output.write(`\nError: ${err.message}\n\n`);
    }
  }

  rl.close();
  output.write('Goodbye.\n');
}

async function main() {
  console.log('\n=== Studix Support Access Signer ===');
  console.log('(Owner-only. Fully offline — no network or database access.)\n');

  if (!privateKeyExists()) {
    console.error(`Private key not found at: ${resolvePrivateKeyPath()}`);
    console.error('Run "node tools/support-keygen.js" first to generate a keypair.\n');
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

// Only auto-run when executed directly (`node tools/support-signer.js`), never when
// imported by a test file. pathToFileURL handles Windows-vs-POSIX path/URL differences
// correctly (a plain `file://${process.argv[1]}` string comparison breaks on Windows,
// where argv[1] uses backslashes and drive letters).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
