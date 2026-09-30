// backend/src/lib/machineIdentity.js
// ─────────────────────────────────────────────────────────────
// Machine-binding — Windows machine identity provider. Reads the OS-level MachineGuid
// (HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid — a stable per-install identifier
// Windows itself generates, distinct from any disk/volume serial) and derives a SHA-256
// fingerprint from it. The raw MachineGuid is never returned by computeCurrentMachineId and
// never embedded in a license artifact — only the domain-separated hash is.
//
// Same injectable-io / fail-closed shape as windowsService.js (REAL_IO default, `io = {}`
// override for tests, a typed *Error class carrying a machine-readable `.reason`) — kept in
// its own small module rather than folded into license.js so license.js's crypto/DB logic
// stays untangled from registry access, and so tests can inject a fake provider at this one
// boundary (see license.js's `machineIdentity` dependency-injection parameter).
//
// Every failure mode (unreadable registry, malformed value, unsupported platform) throws
// MachineIdentityError rather than returning a fallback value — callers (license.js) must
// treat any throw here as "machine identity unavailable" and fail closed, never as "skip
// the machine check."
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { execFileSync } from 'child_process';

export class MachineIdentityError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

const REAL_IO = { execFileSync };

// MACHINE_ID_DOMAIN_PREFIX: domain-separation for the hash — ensures this fingerprint can
// never collide with some other system independently hashing the same raw MachineGuid for
// an unrelated purpose. Versioned ("v1") so a future change to the derivation itself is a
// distinguishable, deliberate migration, not a silent reinterpretation of old values.
const MACHINE_ID_DOMAIN_PREFIX = 'studix-machine-v1:';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// getWindowsMachineGuid: reads the raw OS MachineGuid. Never call this to obtain a value to
// store/transmit directly — it exists only as computeCurrentMachineId's input. Exported
// separately purely so its own parsing/failure behavior is directly testable.
export function getWindowsMachineGuid(io = {}, platform = process.platform) {
  if (platform !== 'win32') {
    throw new MachineIdentityError('unsupported_platform', `تعذّر تحديد هوية الجهاز — هذه الآلية تتطلّب Windows (المنصّة الحالية: ${platform}).`);
  }

  const { execFileSync: exec } = { ...REAL_IO, ...io };
  let output;
  try {
    output = exec('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], { encoding: 'utf8' });
  } catch (err) {
    throw new MachineIdentityError('registry_read_failed', `تعذّرت قراءة MachineGuid من سجل النظام: ${err.message}`);
  }

  const match = output.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
  if (!match) {
    throw new MachineIdentityError('registry_read_failed', 'قيمة MachineGuid غير موجودة في مخرجات الاستعلام عن السجل.');
  }

  const guid = match[1].trim().toLowerCase();
  if (!GUID_RE.test(guid)) {
    throw new MachineIdentityError('registry_read_failed', 'قيمة MachineGuid المقروءة ليست بصيغة GUID صالحة.');
  }
  return guid;
}

// The real machine's fingerprint, memoized for the life of the process. MachineGuid cannot
// change under a running process (it changes only on an OS reinstall/sysprep, which restarts
// the service), and reading it spawns reg.exe synchronously — ~14 ms of blocked event loop —
// which license.js would otherwise pay on every licensed API request. Failures are never
// cached: the next call retries, and callers keep failing closed until a read succeeds.
let processMachineId = null;

// computeCurrentMachineId: the only function license.js ever calls. Returns a stable,
// non-reversible-to-the-raw-GUID fingerprint safe to embed in a signed license artifact.
// Called with no arguments (production), the result is memoized; any injected `io`/`platform`
// (tests) always computes afresh and never reads or writes the memo.
export function computeCurrentMachineId(io, platform) {
  const isRealMachine = io === undefined && platform === undefined;
  if (isRealMachine && processMachineId) return processMachineId;
  const guid = getWindowsMachineGuid(io ?? {}, platform ?? process.platform);
  const machineId = crypto.createHash('sha256').update(`${MACHINE_ID_DOMAIN_PREFIX}${guid}`, 'utf8').digest('hex');
  if (isRealMachine) processMachineId = machineId;
  return machineId;
}
