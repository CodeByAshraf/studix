// tools/license-manager-gui/main/paths.js
// Studix License Manager — non-sensitive UI convenience state (Phase 3).
//
// Portability note (see the Phase 3 report's "Portable design" section): this file stores
// ONLY the last-used file paths the operator picked via native dialogs — never the key store's
// contents, never the passphrase, never the artifact contents. It intentionally lives in the
// normal per-machine Electron userData directory (NOT next to the exe) because it is exactly
// as portable as it needs to be: a convenience pointer, re-creatable with one click if it's
// missing or points at a path that no longer exists on a different machine (e.g. a different
// USB drive letter). The actual key store and artifacts stay wherever the operator explicitly
// put them — this file never assumes or silently creates either.
import fs from 'fs';
import path from 'path';

const SETTINGS_FILENAME = 'studix-license-manager-settings.json';

export function settingsFilePath(userDataDir) {
  return path.join(userDataDir, SETTINGS_FILENAME);
}

export function loadSettings(userDataDir) {
  const filePath = settingsFilePath(userDataDir);
  if (!fs.existsSync(filePath)) return { lastKeyStorePath: null, lastArtifactSaveDir: null, clipboardAutoClearSeconds: 30 };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      lastKeyStorePath: typeof parsed.lastKeyStorePath === 'string' ? parsed.lastKeyStorePath : null,
      lastArtifactSaveDir: typeof parsed.lastArtifactSaveDir === 'string' ? parsed.lastArtifactSaveDir : null,
      clipboardAutoClearSeconds: Number.isFinite(parsed.clipboardAutoClearSeconds) ? parsed.clipboardAutoClearSeconds : 30,
    };
  } catch {
    return { lastKeyStorePath: null, lastArtifactSaveDir: null, clipboardAutoClearSeconds: 30 };
  }
}

export function saveSettings(userDataDir, settings) {
  const filePath = settingsFilePath(userDataDir);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
}
