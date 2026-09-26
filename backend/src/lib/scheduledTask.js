// backend/src/lib/scheduledTask.js
// ─────────────────────────────────────────────────────────────
// Phase 3 — wires the already-tested backend/src/db/startupOrchestrator.js into the real Windows
// boot path via a Task Scheduler task, so that:
//
//   Windows Boot -> StudixPostgreSQL (AUTO_START) -> Scheduled Task runs startupOrchestrator.js
//   -> waits for real PostgreSQL readiness -> checks/recovers restore state if needed
//   -> starts StudixApp (DEMAND_START, see windowsService.js's STUDIX_APP_START_TYPE comment)
//
// This module ONLY registers/corrects the Scheduled Task definition — it never runs
// startupOrchestrator.js itself, never touches PostgreSQL readiness/restore-state/database
// switching (that is entirely startupOrchestrator.js's own job, reused unmodified), and never
// decides when to start StudixApp.
//
// Task Scheduler XML (schema http://schemas.microsoft.com/windows/2004/02/mit/task), not the
// bare `schtasks /Create /SC ONSTART ...` CLI flag surface — schtasks.exe's own flat CLI has no
// option for several fields this task requires (multiple-instances policy, an execution time
// limit), so the CLI form cannot express the desired configuration at all, let alone let it be
// verified back. `schtasks /Query /TN <name> /XML ONE` and `schtasks /Create /TN <name> /XML
// <file> /F` are used instead — both still invoked via execFileSync with an argv array (never a
// shell, never a concatenated command string; see runExec below), exactly like every other
// Windows-native call in this codebase (windowsService.js's own sc.exe/nssm.exe calls).
//
// Idempotency model: query the task's current XML, parse out exactly the fields this module
// cares about (taskConfigMatches), and compare against the desired configuration built fresh
// from the current install root every run. An exact match is left untouched (no schtasks.exe
// call at all beyond the query) — anything else (missing task, any other unqueryable state, or a
// mismatched field) is corrected by writing the desired XML to a throwaway temp file and calling
// `schtasks /Create ... /F`, which both creates a missing task and overwrites an incorrect one
// with the identical mechanism (Task Scheduler has no separate "update in place" verb for the
// fields this module manages).
// ─────────────────────────────────────────────────────────────
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { resolveInstallRoot, resolveNodeExePath } from './windowsService.js';

export class ScheduledTaskError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

export const STUDIX_STARTUP_TASK_NAME = 'StudixStartupOrchestrator';

const REAL_IO = { execFileSync, writeFileSync: fs.writeFileSync, unlinkSync: fs.unlinkSync };

// ── path resolution ────────────────────────────────────────────────────────────────────────
// Mirrors windowsService.js's own resolveServerJsPath — same __dirname-relative-sibling
// convention, applied to the other bundled entry point this phase cares about.
export function resolveStartupOrchestratorPath(installRoot = resolveInstallRoot()) {
  return path.join(installRoot, 'backend', 'src', 'db', 'startupOrchestrator.js');
}

// ── low-level command execution — the only place in this module that touches a real process ─
function runExec(cmd, args, io) {
  const { execFileSync: exec } = { ...REAL_IO, ...io };
  return exec(cmd, args, { encoding: 'utf8' });
}

// quoteArg: Arguments is a single command-line-shaped string Task Scheduler tokenizes the same
// way CreateProcess does — an unquoted scriptPath containing a space (e.g. under "C:\Program
// Files\Studix\...") would be split at that space, exactly the class of bug
// windowsService.js's own quoteNssmParam closes for NSSM's AppParameters.
function quoteArg(value) {
  return `"${value}"`;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── desired configuration ────────────────────────────────────────────────────────────────────
export function buildDesiredTaskConfig({ nodeExe, scriptPath, installRoot }) {
  return {
    bootTriggerEnabled: true,
    userId: 'S-1-5-18', // the well-known SID for the built-in SYSTEM account
    runLevel: 'HighestAvailable',
    multipleInstancesPolicy: 'IgnoreNew', // do not allow parallel instances
    executionTimeLimit: 'PT10M', // ~10 minutes
    enabled: true,
    runOnlyIfNetworkAvailable: false,
    restartOnFailure: false, // no automatic task restart configured
    command: nodeExe,
    arguments: quoteArg(scriptPath),
    workingDirectory: installRoot,
  };
}

// buildTaskXml: written as UTF-16LE-with-BOM by ensureStartupTask below (the encoding this
// declaration names) — real `schtasks.exe /Create /XML` rejects a plain-UTF-8-bytes file
// outright ("unable to switch the encoding"), confirmed against a real Windows machine.
//
// No <LogonType> element on the Principal — <LogonType>ServiceAccount</LogonType> (the
// documented-looking value for a built-in account) is itself rejected by real `schtasks.exe
// /Create /XML` as "incorrectly formatted or out of range," independent of encoding and
// independent of UserId's exact spelling (confirmed against a real Windows machine with both
// the SID and the literal "SYSTEM" name). Omitting the element entirely — UserId + RunLevel
// alone — passes real Windows' own XML validation; Task Scheduler infers the correct logon
// behavior for this well-known SID without it.
export function buildTaskXml({ command, arguments: args, workingDirectory }) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Studix boot orchestrator: waits for PostgreSQL readiness, runs restore-state recovery if needed, then starts StudixApp.</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(command)}</Command>
      <Arguments>${xmlEscape(args)}</Arguments>
      <WorkingDirectory>${xmlEscape(workingDirectory)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

// ── actual-configuration parsing ─────────────────────────────────────────────────────────────
// Deliberately NOT a general-purpose XML parser (no new dependency for one fixed, self-generated
// schema — see this project's own "reuse codebase -> stdlib" solution-efficiency convention) —
// same targeted, scoped-regex-extraction approach as windowsService.js's parseScQcOutput, just
// applied to the small, fixed set of elements this module actually reads back.
function extractBlock(xml, tagName) {
  const m = xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return m ? m[1] : null;
}

function xmlUnescape(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractLeaf(xml, tagName) {
  if (!xml) return null;
  const m = xml.match(new RegExp(`<${tagName}\\b[^>]*>([^<]*)<\\/${tagName}>`, 'i'));
  return m ? xmlUnescape(m[1].trim()) : null;
}

export function parseTaskXml(xmlText) {
  const triggersBlock = extractBlock(xmlText, 'Triggers');
  const bootTriggerBlock = extractBlock(triggersBlock || '', 'BootTrigger');
  const bootTriggerEnabled = bootTriggerBlock !== null
    && (extractLeaf(bootTriggerBlock, 'Enabled') ?? 'true').toLowerCase() === 'true';

  const principalsBlock = extractBlock(xmlText, 'Principals') || '';
  const principalBlock = extractBlock(principalsBlock, 'Principal') || principalsBlock;

  const settingsBlock = extractBlock(xmlText, 'Settings') || '';
  const enabledRaw = extractLeaf(settingsBlock, 'Enabled');
  const networkRaw = extractLeaf(settingsBlock, 'RunOnlyIfNetworkAvailable');

  const actionsBlock = extractBlock(xmlText, 'Actions') || '';
  const execBlock = extractBlock(actionsBlock, 'Exec') || '';

  return {
    bootTriggerEnabled,
    userId: extractLeaf(principalBlock, 'UserId'),
    runLevel: extractLeaf(principalBlock, 'RunLevel'),
    multipleInstancesPolicy: extractLeaf(settingsBlock, 'MultipleInstancesPolicy'),
    executionTimeLimit: extractLeaf(settingsBlock, 'ExecutionTimeLimit'),
    enabled: enabledRaw === null ? true : enabledRaw.toLowerCase() === 'true',
    runOnlyIfNetworkAvailable: networkRaw !== null && networkRaw.toLowerCase() === 'true',
    restartOnFailure: /<RestartOnFailure\b/i.test(settingsBlock),
    command: extractLeaf(execBlock, 'Command'),
    arguments: extractLeaf(execBlock, 'Arguments'),
    workingDirectory: extractLeaf(execBlock, 'WorkingDirectory'),
  };
}

// normalizeUserId: Task Scheduler round-trips the SYSTEM account's identity inconsistently
// across Windows versions/locales ("S-1-5-18", "SYSTEM", or "NT AUTHORITY\SYSTEM" have all been
// observed in the wild) — every known-equivalent spelling normalizes to one canonical value so
// comparison never flags a real match as "incorrect".
function normalizeUserId(userId) {
  const v = (userId || '').trim().toUpperCase();
  if (v === 'SYSTEM' || v === 'S-1-5-18' || v === 'NT AUTHORITY\\SYSTEM') return 'SYSTEM';
  return v;
}

function normalizeForCompare(config) {
  return {
    bootTriggerEnabled: !!config.bootTriggerEnabled,
    userId: normalizeUserId(config.userId),
    runLevel: (config.runLevel || '').toUpperCase(),
    multipleInstancesPolicy: (config.multipleInstancesPolicy || '').toUpperCase(),
    executionTimeLimit: (config.executionTimeLimit || '').toUpperCase(),
    enabled: !!config.enabled,
    runOnlyIfNetworkAvailable: !!config.runOnlyIfNetworkAvailable,
    restartOnFailure: !!config.restartOnFailure,
    command: (config.command || '').toLowerCase(),
    arguments: (config.arguments || '').toLowerCase(),
    workingDirectory: (config.workingDirectory || '').toLowerCase().replace(/\\+$/, ''),
  };
}

export function taskConfigMatches(desired, actual) {
  if (!actual) return false;
  const d = normalizeForCompare(desired);
  const a = normalizeForCompare(actual);
  return Object.keys(d).every((key) => d[key] === a[key]);
}

// ── query ─────────────────────────────────────────────────────────────────────────────────────
// null means "not registered, or otherwise unqueryable" — unlike windowsService.js's
// queryServiceConfig (which must distinguish a real conflict from a same-named foreign service),
// there is no equivalent risk here: ANY query failure falls through to the exact same
// create-with-/F correction path below, which is always safe to attempt (it only ever writes
// this module's own well-known task name to the desired, fully-specified configuration) and
// throws a clear ScheduledTaskError if that attempt itself fails — never silently masked.
export function queryStartupTaskXml(taskName, io = {}) {
  try {
    return runExec('schtasks.exe', ['/Query', '/TN', taskName, '/XML', 'ONE'], io);
  } catch {
    return null;
  }
}

function defaultTmpXmlPath(taskName) {
  return path.join(os.tmpdir(), `studix-scheduled-task-${taskName}-${process.pid}-${Date.now()}.xml`);
}

// ── ensure (create fresh / correct / no-op) ─────────────────────────────────────────────────
export function ensureStartupTask({
  installRoot = resolveInstallRoot(),
  taskName = STUDIX_STARTUP_TASK_NAME,
  nodeExe = resolveNodeExePath(installRoot),
  scriptPath = resolveStartupOrchestratorPath(installRoot),
} = {}, io = {}) {
  const desired = buildDesiredTaskConfig({ nodeExe, scriptPath, installRoot });

  const existingXml = queryStartupTaskXml(taskName, io);
  const existed = existingXml !== null;
  if (existed && taskConfigMatches(desired, parseTaskXml(existingXml))) {
    return { status: 'already_registered', taskName };
  }

  const { writeFileSync: write, unlinkSync: unlink } = { ...REAL_IO, ...io };
  const xmlPath = (io.tmpFilePathFn || defaultTmpXmlPath)(taskName);
  const xml = buildTaskXml(desired);

  try {
    // UTF-16LE with a leading BOM — confirmed against a real Windows machine as the encoding
    // `schtasks.exe /Create /XML` actually requires (a plain UTF-8-bytes file is rejected
    // outright with "unable to switch the encoding"). '﻿' encodes to the UTF-16LE BOM byte
    // sequence (FF FE) when written with the 'utf16le' encoding below.
    write(xmlPath, `﻿${xml}`, 'utf16le');
  } catch (err) {
    throw new ScheduledTaskError(
      'write_definition_failed',
      `تعذّر كتابة ملف تعريف مهمة الإقلاع المجدولة "${taskName}": ${err.message}`
    );
  }

  try {
    runExec('schtasks.exe', ['/Create', '/TN', taskName, '/XML', xmlPath, '/F'], io);
  } catch (err) {
    throw new ScheduledTaskError(
      'register_failed',
      `فشل تسجيل/تصحيح مهمة الإقلاع المجدولة "${taskName}": ${err.message}`
    );
  } finally {
    try { unlink(xmlPath); } catch { /* best-effort cleanup of the throwaway temp file */ }
  }

  return { status: existed ? 'corrected' : 'created', taskName };
}

// ── remove (Phase 4 — uninstall cleanup) ────────────────────────────────────────────────────
// removeStartupTask: the uninstall-time counterpart to ensureStartupTask above. Reuses
// queryStartupTaskXml (unmodified) to determine "does the task exist at all" — the exact same
// query this module already performs during registration, never a second/duplicated existence
// check. A missing task is a safe, expected no-op (repeated/idempotent uninstall runs, or an
// uninstall of a pre-Phase-3 install that never had this task): `schtasks /Delete` is never even
// invoked in that case. Only a genuinely-registered task reaches the actual `/Delete` call, and
// only a failure of THAT call throws — surfaced as a distinct ScheduledTaskError reason so a
// caller (the installer's Pascal Script, via manageScheduledTask.js) can apply its own existing
// best-effort uninstall philosophy (log and continue, never block/alter application-data
// deletion because of it) without this module deciding that policy itself.
export function removeStartupTask({ taskName = STUDIX_STARTUP_TASK_NAME } = {}, io = {}) {
  const existingXml = queryStartupTaskXml(taskName, io);
  if (existingXml === null) {
    return { status: 'not_registered', taskName };
  }

  try {
    runExec('schtasks.exe', ['/Delete', '/TN', taskName, '/F'], io);
  } catch (err) {
    throw new ScheduledTaskError(
      'remove_failed',
      `فشل حذف مهمة الإقلاع المجدولة "${taskName}": ${err.message}`
    );
  }

  return { status: 'removed', taskName };
}
