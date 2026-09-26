// tools/license-manager-gui/main/preload.cjs
// Studix License Manager — preload script (Phase 3). Explicit .cjs (CommonJS) regardless of
// this package's "type": "module" — Electron preload scripts are most reliably loaded as
// CommonJS, and contextBridge/ipcRenderer's `require('electron')` needs that. Runs with
// contextIsolation: true and nodeIntegration: false in the renderer's BrowserWindow (see
// main.js) — this is the ONLY file the renderer can reach into Node/Electron through, and it
// exposes nothing beyond a fixed, named set of ipcRenderer.invoke calls. The renderer never
// gets a reference to ipcRenderer itself, never gets `require`, and never receives a private
// key through any of these calls (see ipcRegister.js — every handler's return value is checked
// against that invariant).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studixLicenseManager', {
  appInfo: () => ipcRenderer.invoke('app:info'),

  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  keyStoreExists: (filePath) => ipcRenderer.invoke('keystore:exists', filePath),
  peekKeyStore: (filePath) => ipcRenderer.invoke('keystore:peek', filePath),
  createKeyStoreFromNewKeypair: (args) => ipcRenderer.invoke('keystore:createFromNewKeypair', args),
  createKeyStoreFromSessionKey: (args) => ipcRenderer.invoke('keystore:createFromSessionKey', args),
  unlockKeyStore: (args) => ipcRenderer.invoke('keystore:unlock', args),

  importExternalKey: (args) => ipcRenderer.invoke('keyimport:external', args),

  chooseOpenKeyStoreFile: () => ipcRenderer.invoke('dialog:openKeyStoreFile'),
  chooseSaveKeyStoreFile: () => ipcRenderer.invoke('dialog:saveKeyStoreFile'),
  chooseOpenExternalKeyFile: () => ipcRenderer.invoke('dialog:openExternalKeyFile'),
  chooseSaveArtifactFile: (defaultName) => ipcRenderer.invoke('dialog:saveArtifactFile', defaultName),

  parseRequestCode: (code) => ipcRenderer.invoke('license:parseRequestCode', code),
  issueLicense: (params) => ipcRenderer.invoke('license:issue', params),
  saveArtifactToFile: (args) => ipcRenderer.invoke('license:saveArtifact', args),
  productId: () => ipcRenderer.invoke('license:productId'),

  sessionInfo: () => ipcRenderer.invoke('session:info'),
  clearSession: () => ipcRenderer.invoke('session:clear'),

  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:copy', text),
  clearClipboardIfMatches: (text) => ipcRenderer.invoke('clipboard:clearIfMatches', text),
});
