#!/usr/bin/env node
// tools/license-keygen.js
// Studix Licensing — owner-only key generator. A separate, explicit command from
// license-issuer.js on purpose: this is the ONLY thing in this project that ever creates
// the Licensing root credential, and it must never run automatically or silently.
//
// This is a COMPLETELY SEPARATE keypair from Support Access (tools/support-keygen.js) —
// never share a keypair between the two.
//
// Usage:
//   node tools/license-keygen.js            (refuses if a key already exists)
//   node tools/license-keygen.js --force    (rotates: generates a NEW keypair, overwriting
//                                             the old one — only do this deliberately; every
//                                             customer installation provisioned with the OLD
//                                             public key will stop accepting new licenses
//                                             signed with the new key until you redistribute
//                                             it, per the approved Phase 5 investigation
//                                             report's key-rotation guidance)
//
// The private key is written ONLY to the owner-controlled directory (see
// tools/lib/licenseKeyStorage.js — outside this repository by default) and is NEVER
// printed to the console, logged, or included in this tool's own output beyond the file
// path it was saved to.
import crypto from 'crypto';
import {
  privateKeyExists, resolveKeyDir, resolvePrivateKeyPath, resolvePublicKeyPath, saveKeyPairFiles,
} from './lib/licenseKeyStorage.js';

function main() {
  const force = process.argv.includes('--force');

  console.log('\n=== Studix Licensing — Key Generator (owner-only) ===\n');

  if (privateKeyExists() && !force) {
    console.error(`A private key already exists at: ${resolvePrivateKeyPath()}`);
    console.error('Refusing to overwrite it without --force.');
    console.error('');
    console.error('Regenerating the keypair invalidates the public key already installed on');
    console.error('every customer installation that has one — only pass --force if you');
    console.error('deliberately intend to rotate the key and have a plan to redistribute the');
    console.error('new public key through a controlled application update.\n');
    process.exit(1);
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const { privatePath, publicPath } = saveKeyPairFiles({
    privateKeyPem: privateKey, publicKeyPem: publicKey, dir: resolveKeyDir(),
  });

  console.log('New Ed25519 keypair generated.\n');
  console.log(`Private key saved to: ${privatePath}`);
  console.log('  This is the ROOT Licensing credential.');
  console.log('  - Never share it, never commit it to any repository.');
  console.log('  - Never copy it onto a customer machine.');
  console.log('  - Never paste it into chat, email, or a support ticket.');
  console.log('  - Never reuse it as (or for) the Support Access keypair, or vice versa.');
  console.log('  - Back it up only to an encrypted, offline location you control.\n');

  console.log(`Public key saved to:  ${publicPath}`);
  console.log('  Safe to share. Install it into a customer installation\'s');
  console.log('  license_config.licensing_public_key column as part of that');
  console.log('  installation\'s provisioning step (see tools/LICENSING.md) — not done');
  console.log('  automatically by this tool.\n');

  console.log('Public key (PEM) — copy from here if convenient:\n');
  console.log(publicKey);
}

main();
