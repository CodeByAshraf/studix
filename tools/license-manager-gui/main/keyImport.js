// tools/license-manager-gui/main/keyImport.js
// Studix License Manager — Option C: external private-key file import (Phase 3 fallback path,
// approved in the Phase 2 audit). Electron-free, directly unit-testable, same pattern as
// keyStore.js.
//
// This is for an operator who already has a key produced by the existing
// tools/license-keygen.js (a plain, unencrypted PKCS8 PEM file) — or any other Ed25519 PKCS8
// PEM, optionally passphrase-encrypted (Node's crypto.createPrivateKey supports encrypted PEM
// natively via the `passphrase` option, no third-party library).
//
// This module NEVER writes, copies, or moves the source file anywhere — it only reads it into
// memory. If the operator later chooses to protect it going forward, the GUI offers a
// SEPARATE, explicit "save into a protected key store" action (createKeyStore in keyStore.js)
// — never triggered automatically by import.
import fs from 'fs';
import crypto from 'crypto';
import { computeFingerprint } from './keyStore.js';

// importExternalKeyFile: reads a PEM file the operator explicitly selected (via a native file
// dialog wired in main.js) and returns the key material for THIS SESSION ONLY. Throws a clear,
// non-leaky error on any failure — never echoes file content in the error message.
export function importExternalKeyFile({ filePath, passphrase = undefined }) {
  if (!filePath) throw new Error('filePath is required.');
  if (!fs.existsSync(filePath)) throw new Error(`No file found at ${filePath}.`);

  let pem;
  try {
    pem = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`Could not read the selected file.`);
  }

  let privateKeyObj;
  try {
    privateKeyObj = passphrase
      ? crypto.createPrivateKey({ key: pem, format: 'pem', passphrase })
      : crypto.createPrivateKey(pem);
  } catch {
    throw new Error('The selected file is not a valid Ed25519 private key (or the passphrase is wrong).');
  }

  if (privateKeyObj.asymmetricKeyType !== 'ed25519') {
    throw new Error('The selected key is not an Ed25519 key — Studix licensing requires Ed25519.');
  }

  // Re-export as a plain (unencrypted-in-memory) PKCS8 PEM so downstream code (issueLicense,
  // createKeyStore) always deals with one consistent in-memory shape regardless of whether the
  // source file on disk was itself encrypted.
  const privateKeyPem = privateKeyObj.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = crypto.createPublicKey(privateKeyObj).export({ type: 'spki', format: 'pem' }).toString();

  return { privateKeyPem, publicKeyPem, keyFingerprint: computeFingerprint(publicKeyPem) };
}
