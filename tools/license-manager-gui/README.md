# Studix License Manager (GUI)

Standalone, owner-only Windows desktop GUI for issuing Studix license artifacts. Same purpose
as `tools/license-issuer.js` (the existing CLI, still fully supported — this is an additional
interface, not a replacement), reusing the exact same licensing core
(`tools/license-manager-gui/core/licenseCore.js`, unmodified Phase 2 output).

**Not shipped to customers, not bundled into the Studix installer, not part of the customer
application build.** See `tools/LICENSING.md` for the underlying protocol and security model —
everything there still applies.

## Building the portable executable

From this directory (`tools/license-manager-gui/`):

```
npm install
npm run build:portable
```

Output: `release/StudixLicenseManager.exe` — a single portable Windows executable. No
installer, no admin rights required, no Node.js/npm/VS Code/Terminal needed on the machine
that runs it.

### If the build fails with a symlink/winCodeSign error

electron-builder downloads a macOS code-signing tool bundle (`winCodeSign`) even for a
Windows-only build, and extracting it needs a Windows privilege (`SeCreateSymbolicLinkPrivilege`)
that a standard user account may not have. If you see
`Cannot create symbolic link : A required privilege is not held by the client`, run instead:

```
set CSC_IDENTITY_AUTO_DISCOVERY=false
npm run build:portable
```

(`package.json`'s `build.win.signAndEditExecutable`/`signDlls` are already set to `false` to
avoid needing this tooling at all for the actual signing step — this variable only prevents
electron-builder's *identity discovery* pass from triggering the download in the first place.)

### If the build fails with "not enough space on the disk"

The final packaging step needs roughly **800 MB–1 GB free** on whichever drive receives the
output (it writes an intermediate compressed archive, then the final exe, briefly holding both).
If your system drive is low on space, redirect just the output — no source or config file
changes needed:

```
npm run build:portable -- --config.directories.output="D:\SomeOutputFolder"
```

If it still fails, the NSIS compiler itself also needs scratch space via `%TEMP%`, which is
**not** affected by the `directories.output` override above (it's a separate, OS-level default).
Redirect that too, for the one command:

```
set TEMP=D:\SomeOutputFolder\_buildtmp
set TMP=D:\SomeOutputFolder\_buildtmp
npm run build:portable -- --config.directories.output="D:\SomeOutputFolder"
```

### Operational note: the portable exe needs free `%TEMP%` space to *launch*, not just to build

`StudixLicenseManager.exe` is an NSIS "portable" stub — it self-extracts to the current user's
`%TEMP%` directory **on every launch** (this is normal, expected behavior for this packaging
format, not a bug). If the drive holding `%TEMP%` on the machine running the exe is nearly full,
the app will fail to start with no visible error dialog. Before distributing or troubleshooting
a "won't launch" report, confirm the target machine has at least ~200 MB free on its temp
drive.

## Running in development (this repo, with Node.js installed)

```
npm install
npm start
```

## Architecture (Phase 3)

```
tools/license-manager-gui/
  core/licenseCore.js         Phase 2 — re-exports the real, unmodified licensing protocol
  main/
    main.js                   Electron entry point (window, app lifecycle)
    preload.cjs                contextBridge — the ONLY renderer-reachable API surface
    ipcRegister.js              IPC wiring — thin, delegates to the modules below
    sessionState.js              in-memory unlocked signing key (main process only)
    keyStore.js                   Option A — passphrase-encrypted local key store (default)
    keyImport.js                   Option C — external key file import (fallback)
    licenseHandlers.js              the "GUI-facing core" — parseRequestCode / issue
    paths.js                         non-sensitive settings (last-used file paths)
  renderer/
    index.html, styles.css, app.js  plain HTML/CSS/vanilla JS UI (Arabic RTL)
```

## Key management

- **Default (Option A):** a passphrase-encrypted local key store file (AES-256-GCM, scrypt
  KDF) — the operator chooses where this file lives (e.g. directly on a USB drive). Never
  auto-created, never auto-located.
- **Fallback (Option C):** import an existing private key file (e.g. one produced by
  `tools/license-keygen.js`) directly, for one session — never copied anywhere by the app.
- **DPAPI:** not implemented in Phase 3 (kept opt-in-only per your instruction; not required
  for the portable workflow).

The private key is never embedded in the executable, never written to the app's own install
files, and never crosses into the renderer/UI process — see the Phase 3 report's security
section for the specific boundary.
