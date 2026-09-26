// backend/src/lib/machineIdentity.test.js
// Machine-binding — pure, dependency-injected unit tests for the Windows machine identity
// provider. NEVER calls a real reg.exe and NEVER reads the real Windows registry — every
// execFileSync call is injected, exactly like windowsService.test.js's own convention in
// this project (see that file's header for why: real registry/service access is
// environment-dependent and this module's entire contract is tested at the
// command-construction/response-classification level instead).
import { describe, it, expect, vi } from 'vitest';
import {
  getWindowsMachineGuid, computeCurrentMachineId, MachineIdentityError,
} from './machineIdentity.js';

// A real MachineGuid shape (random per Windows install, always this exact format) — not
// invented, this is the documented HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid shape.
const REAL_REG_QUERY_OUTPUT = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography
    MachineGuid    REG_SZ    3f2504e0-4f89-11d3-9a0c-0305e82c3301
`;

describe('getWindowsMachineGuid', () => {
  it('parses a valid MachineGuid from real reg.exe query output', () => {
    const execFileSync = vi.fn(() => REAL_REG_QUERY_OUTPUT);
    const guid = getWindowsMachineGuid({ execFileSync }, 'win32');
    expect(guid).toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  });

  it('queries the exact expected registry path/value, forcing the native 64-bit view', () => {
    const execFileSync = vi.fn(() => REAL_REG_QUERY_OUTPUT);
    getWindowsMachineGuid({ execFileSync }, 'win32');
    expect(execFileSync).toHaveBeenCalledWith(
      'reg.exe',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'],
      expect.anything()
    );
  });

  it('fails closed with registry_read_failed when reg.exe itself fails (e.g. key/value missing)', () => {
    const execFileSync = vi.fn(() => { throw new Error('The system was unable to find the specified registry key or value.'); });
    expect(() => getWindowsMachineGuid({ execFileSync }, 'win32')).toThrow(MachineIdentityError);
    try {
      getWindowsMachineGuid({ execFileSync }, 'win32');
      expect.fail('expected a throw');
    } catch (err) {
      expect(err.reason).toBe('registry_read_failed');
    }
  });

  it('fails closed with registry_read_failed when reg.exe output does not contain a MachineGuid line at all', () => {
    const execFileSync = vi.fn(() => '\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\n    (no matching value)\n');
    expect(() => getWindowsMachineGuid({ execFileSync }, 'win32')).toThrow(MachineIdentityError);
  });

  it('fails closed with registry_read_failed when the value present is not a well-formed GUID', () => {
    const malformed = REAL_REG_QUERY_OUTPUT.replace('3f2504e0-4f89-11d3-9a0c-0305e82c3301', 'not-a-real-guid');
    const execFileSync = vi.fn(() => malformed);
    expect(() => getWindowsMachineGuid({ execFileSync }, 'win32')).toThrow(MachineIdentityError);
  });

  it('fails closed with unsupported_platform on a non-Windows platform, without ever invoking execFileSync', () => {
    const execFileSync = vi.fn(() => REAL_REG_QUERY_OUTPUT);
    expect(() => getWindowsMachineGuid({ execFileSync }, 'linux')).toThrow(MachineIdentityError);
    expect(execFileSync).not.toHaveBeenCalled();
    try {
      getWindowsMachineGuid({ execFileSync }, 'darwin');
      expect.fail('expected a throw');
    } catch (err) {
      expect(err.reason).toBe('unsupported_platform');
    }
  });
});

describe('computeCurrentMachineId — fingerprint derivation', () => {
  it('never returns the raw MachineGuid as the machineId', () => {
    const execFileSync = vi.fn(() => REAL_REG_QUERY_OUTPUT);
    const fingerprint = computeCurrentMachineId({ execFileSync }, 'win32');
    expect(fingerprint).not.toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    expect(fingerprint).not.toContain('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  });

  it('is deterministic: the same MachineGuid always produces the same fingerprint', () => {
    const execFileSync = vi.fn(() => REAL_REG_QUERY_OUTPUT);
    const a = computeCurrentMachineId({ execFileSync }, 'win32');
    const b = computeCurrentMachineId({ execFileSync }, 'win32');
    expect(a).toBe(b);
  });

  it('a different MachineGuid produces a different fingerprint', () => {
    const guidA = REAL_REG_QUERY_OUTPUT;
    const guidB = REAL_REG_QUERY_OUTPUT.replace('3f2504e0-4f89-11d3-9a0c-0305e82c3301', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    const fpA = computeCurrentMachineId({ execFileSync: () => guidA }, 'win32');
    const fpB = computeCurrentMachineId({ execFileSync: () => guidB }, 'win32');
    expect(fpA).not.toBe(fpB);
  });

  it('produces a 64-character lowercase hex string (SHA-256 digest)', () => {
    const execFileSync = vi.fn(() => REAL_REG_QUERY_OUTPUT);
    const fingerprint = computeCurrentMachineId({ execFileSync }, 'win32');
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('propagates the underlying MachineIdentityError (fail-closed) when the registry read fails', () => {
    const execFileSync = vi.fn(() => { throw new Error('access denied'); });
    expect(() => computeCurrentMachineId({ execFileSync }, 'win32')).toThrow(MachineIdentityError);
  });

  it('propagates unsupported_platform on a non-Windows platform', () => {
    try {
      computeCurrentMachineId({}, 'linux');
      expect.fail('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MachineIdentityError);
      expect(err.reason).toBe('unsupported_platform');
    }
  });
});
