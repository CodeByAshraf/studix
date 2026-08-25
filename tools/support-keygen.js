#!/usr/bin/env node
// tools/support-keygen.js
// Studix Support Access — owner-only key generator. A separate, explicit command from
// support-signer.js on purpose: this is the ONLY thing in this project that ever creates
// the Support Access root credential, and it must never run automatically or silently.
//
// Usage:
//   node tools/support-keygen.js            (refuses if a key already exists)
//   node tools/support-keygen.js --force    (rotates: generates a NEW keypair, overwriting
//                                             the old one — only do this deliberately; every
//                                             customer install provisioned with the OLD
//                                             public key will stop accepting your signatures
//                                             until you redistribute the new public key)
//
// The private key is written ONLY to the owner-controlled directory (see
// tools/lib/keyStorage.js — outside this repository by default) and is NEVER printed to
// the console, logged, or included in this tool's own output beyond the file path it was
// saved to.
import crypto from 'crypto';
import {
  privateKeyExists, resolveKeyDir, resolvePrivateKeyPath, resolvePublicKeyPath, saveKeyPairFiles,
} from './lib/keyStorage.js';

function main() {
  const force = process.argv.includes('--force');

  console.log('\n=== Studix Support Access — Key Generator (owner-only) ===\n');

  if (privateKeyExists() && !force) {
    console.error(`A private key already exists at: ${resolvePrivateKeyPath()}`);
    console.error('Refusing to overwrite it without --force.');
    console.error('');
    console.error('Regenerating the keypair invalidates the public key already installed on');
    console.error('every customer that has one — only pass --force if you deliberately intend');
    console.error('to rotate the key and have a plan to redistribute the new public key.\n');
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
  console.log('  This is the ROOT Support Access credential.');
  console.log('  - Never share it, never commit it to any repository.');
  console.log('  - Never copy it onto a customer machine.');
  console.log('  - Never paste it into chat, email, or a support ticket.');
  console.log('  - Back it up only to an encrypted, offline location you control.\n');

  console.log(`Public key saved to:  ${publicPath}`);
  console.log('  Safe to share. Install it into a customer installation\'s');
  console.log('  support_access_config.support_public_key column as part of that');
  console.log('  installation\'s provisioning step (see tools/README.md).\n');

  console.log('Public key (PEM) — copy from here if convenient:\n');
  console.log(publicKey);
}

main();
