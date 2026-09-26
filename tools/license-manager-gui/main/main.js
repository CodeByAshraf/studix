// tools/license-manager-gui/main/main.js
// Studix License Manager — Electron app entry point (Phase 3).
//
// Security posture (see the Phase 3 report for the full rationale): contextIsolation is
// enabled, nodeIntegration is disabled, no remote-content navigation is allowed (this app
// never loads a URL — only its own bundled renderer/index.html), and devtools are only opened
// when explicitly requested via an environment variable (never in a normal launch).
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerIpcHandlers } from './ipcRegister.js';
import { clearSession } from './sessionState.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    title: 'Studix License Manager',
    autoHideMenuBar: true,
    webPreferences: {
      // NOTE: this file is bundled by scripts/bundle.mjs into dist/main.js before packaging
      // (see the Phase 3 report's "packaging method" section) — dist/ and main/ are siblings
      // under the project root, so this path reaches main/preload.cjs correctly whether
      // running from source (main/main.js, __dirname = .../main) or from the bundled output
      // (dist/main.js, __dirname = .../dist). preload.cjs itself is never bundled — it has no
      // repo-external imports (only Electron's own `require('electron')`), so shipping it
      // as-is is both correct and simplest.
      preload: path.join(__dirname, '..', 'main', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Never allow this app to navigate to, or open, arbitrary external URLs — it has no network
  // functionality by design (fully offline, matching the existing CLI issuer). Deliberately
  // does NOT call shell.openExternal(url) here (Phase 4 audit finding C-1): even though no
  // current renderer code path can trigger this handler (no <a>/window.open() anywhere in
  // renderer/), a network-capable side effect has no place in a handler whose entire purpose
  // is denial, in an app whose value proposition is "fully offline."
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });

  if (process.env.STUDIX_LICENSE_MANAGER_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpcHandlers({ getWindow: () => mainWindow });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  clearSession();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  clearSession();
});
