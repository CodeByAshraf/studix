// tools/license-manager-gui/core/licenseCore.js
// Studix License Manager — standalone core (Phase 2 of the standalone-tool project; see the
// Phase 2 audit report's Section F, "Migration/Compatibility Plan").
//
// This module is the ONLY bridge between the future standalone License Manager GUI (Phase 3+)
// and the existing, canonical Studix licensing protocol. It performs no cryptography, no
// payload serialization, and no validation of its own — every one of those already lives in
// backend/src/lib/licenseArtifactFormat.js, reached here transitively, unmodified, through
// tools/lib/licenseIssuing.js (the same pure, offline facade the existing CLI issuer,
// tools/license-issuer.js, already imports). This file exists only so a future GUI has one
// stable, documented import path instead of reaching directly into tools/lib/ and
// backend/src/lib/ from Electron code — it changes nothing about the protocol itself, and
// re-exports rather than wraps so there is zero risk of behavioral drift from the real thing.
//
// Deliberately out of scope here (Phase 2):
//   - Key generation or storage of any kind — no key ever touches this file. issueLicense()
//     only ever RECEIVES a PEM string the caller already holds in memory.
//   - Any GUI/Electron/IPC code.
//   - Any packaging/build tooling.
// Phase 3 adds passphrase-protected key storage (Option A, DPAPI opt-in) on top of this
// module; this module itself does not change when that happens.
export { PRODUCT_ID, parseCustomerRequestCode, issueLicense } from '../../lib/licenseIssuing.js';
