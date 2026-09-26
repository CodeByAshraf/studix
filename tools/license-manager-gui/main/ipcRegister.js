// tools/license-manager-gui/main/ipcRegister.js
// Studix License Manager — IPC wiring (Phase 3). Thin glue only: every channel here delegates
// to a pure, Electron-free module (keyStore.js, keyImport.js, licenseHandlers.js,
// sessionState.js, paths.js) and is responsible for exactly one security-relevant thing: never
// letting a private key PEM cross into an IPC response. Search this file for "privateKeyPem" —
// it must never appear on the right-hand side of anything returned to a handler's caller.
import { ipcMain, dialog, clipboard, app } from 'electron';
import fs from 'fs';
import crypto from 'crypto';
import {
  createKeyStore, unlockKeyStore, keyStoreExists, peekKeyStorePublicInfo,
} from './keyStore.js';
import { importExternalKeyFile } from './keyImport.js';
import {
  setSessionKey, getSafeSessionInfo, getSigningKeyPem, clearSession, isUnlocked,
} from './sessionState.js';
import { parseRequestCode, issueLicenseWithSessionKey, PRODUCT_ID } from './licenseHandlers.js';
import { loadSettings, saveSettings } from './paths.js';

function safeError(err) {
  // Every error surfaced to the renderer is a plain string message — never an Error object
  // that might carry a stack trace referencing key material in a closure variable name, and
  // never anything sourced from raw file/key content.
  return { message: err && err.message ? String(err.message) : 'Unexpected error.', reason: err && err.reason ? err.reason : null };
}

export function registerIpcHandlers({ getWindow }) {
  const userDataDir = app.getPath('userData');

  ipcMain.handle('app:info', () => ({ name: 'Studix License Manager', version: app.getVersion() }));

  ipcMain.handle('settings:load', () => loadSettings(userDataDir));
  ipcMain.handle('settings:save', (_evt, settings) => {
    saveSettings(userDataDir, settings);
    return { ok: true };
  });

  // ── Key store (Option A) ────────────────────────────────────────────────────────────────
  ipcMain.handle('keystore:exists', (_evt, filePath) => keyStoreExists(filePath));

  ipcMain.handle('keystore:peek', (_evt, filePath) => {
    try {
      return { ok: true, ...peekKeyStorePublicInfo(filePath) };
    } catch (err) {
      return { ok: false, error: safeError(err) };
    }
  });

  // create: two distinct callers — (a) "generate a brand-new keypair" (explicit, separate GUI
  // action, mirrors tools/license-keygen.js's own deliberate separateness from the issuer), or
  // (b) "protect a key I just imported via Option C". Neither path is ever invoked implicitly.
  ipcMain.handle('keystore:createFromNewKeypair', (_evt, { filePath, passphrase, overwrite }) => {
    try {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      const result = createKeyStore({
        filePath, privateKeyPem: privateKey, publicKeyPem: publicKey, passphrase, overwrite: Boolean(overwrite),
      });
      setSessionKey({ privateKeyPem: privateKey, publicKeyPem: publicKey, keyFingerprint: result.keyFingerprint, source: 'new_keypair' });
      return { ok: true, ...getSafeSessionInfo() };
    } catch (err) {
      return { ok: false, error: safeError(err) };
    }
  });

  ipcMain.handle('keystore:createFromSessionKey', (_evt, { filePath, passphrase, overwrite }) => {
    try {
      if (!isUnlocked()) throw new Error('No key is currently unlocked to protect.');
      const info = getSafeSessionInfo();
      const privateKeyPem = getSigningKeyPem();
      const result = createKeyStore({
        filePath, privateKeyPem, publicKeyPem: info.publicKeyPem, passphrase, overwrite: Boolean(overwrite),
      });
      return { ok: true, filePath: result.filePath, keyFingerprint: result.keyFingerprint };
    } catch (err) {
      return { ok: false, error: safeError(err) };
    }
  });

  ipcMain.handle('keystore:unlock', (_evt, { filePath, passphrase }) => {
    try {
      const { privateKeyPem, publicKeyPem, keyFingerprint } = unlockKeyStore({ filePath, passphrase });
      setSessionKey({ privateKeyPem, publicKeyPem, keyFingerprint, source: 'key_store' });
      return { ok: true, ...getSafeSessionInfo() };
    } catch (err) {
      return { ok: false, error: safeError(err) };
    }
  });

  // ── External key import (Option C) ──────────────────────────────────────────────────────
  ipcMain.handle('keyimport:external', (_evt, { filePath, passphrase }) => {
    try {
      const { privateKeyPem, publicKeyPem, keyFingerprint } = importExternalKeyFile({ filePath, passphrase });
      setSessionKey({ privateKeyPem, publicKeyPem, keyFingerprint, source: 'external_import' });
      return { ok: true, ...getSafeSessionInfo() };
    } catch (err) {
      return { ok: false, error: safeError(err) };
    }
  });

  // ── Native dialogs ───────────────────────────────────────────────────────────────────────
  ipcMain.handle('dialog:openKeyStoreFile', async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'اختر ملف خزنة المفاتيح', filters: [{ name: 'Studix Key Store', extensions: ['json'] }], properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:saveKeyStoreFile', async () => {
    const win = getWindow();
    const result = await dialog.showSaveDialog(win, {
      title: 'احفظ خزنة المفاتيح الجديدة', defaultPath: 'license-key.store.json', filters: [{ name: 'Studix Key Store', extensions: ['json'] }],
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('dialog:openExternalKeyFile', async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'اختر ملف المفتاح الخاص (PEM)', filters: [{ name: 'PEM Key', extensions: ['pem', 'key', 'txt'] }, { name: 'All Files', extensions: ['*'] }], properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:saveArtifactFile', async (_evt, defaultName) => {
    const win = getWindow();
    const result = await dialog.showSaveDialog(win, {
      title: 'احفظ شهادة الترخيص', defaultPath: defaultName || 'license.lic', filters: [{ name: 'License Artifact', extensions: ['lic'] }, { name: 'Text File', extensions: ['txt'] }],
    });
    return result.canceled ? null : result.filePath;
  });

  // ── Licensing core (Phase 2, unmodified) ────────────────────────────────────────────────
  ipcMain.handle('license:parseRequestCode', (_evt, code) => {
    try {
      return { ok: true, data: parseRequestCode(code) };
    } catch (err) {
      return { ok: false, error: safeError(err) };
    }
  });

  ipcMain.handle('license:issue', (_evt, params) => {
    try {
      const result = issueLicenseWithSessionKey(params);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: safeError(err) };
    }
  });

  ipcMain.handle('license:saveArtifact', (_evt, { filePath, artifact }) => {
    try {
      fs.writeFileSync(filePath, artifact, 'utf8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: safeError(err) };
    }
  });

  ipcMain.handle('license:productId', () => PRODUCT_ID);

  // ── Session hygiene ──────────────────────────────────────────────────────────────────────
  ipcMain.handle('session:info', () => getSafeSessionInfo());
  ipcMain.handle('session:clear', () => {
    clearSession();
    return { ok: true };
  });

  // ── Clipboard (with optional auto-clear support) ────────────────────────────────────────
  ipcMain.handle('clipboard:copy', (_evt, text) => {
    clipboard.writeText(text);
    return { ok: true };
  });
  ipcMain.handle('clipboard:clearIfMatches', (_evt, text) => {
    if (clipboard.readText() === text) clipboard.writeText('');
    return { ok: true };
  });
}
