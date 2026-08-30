; installer/studix.iss
; ─────────────────────────────────────────────────────────────
; INSTALL-06 — Inno Setup script for Studix. Pinned to Inno Setup 6.4.3 (the last version
; before JRSoftware's optional commercial-license request introduced in 6.5.0 — see
; migration/reports/INSTALL-06_INSTALLER_DESIGN.md §"Installer technology" for the full
; reasoning; the underlying Inno Setup License itself is fully free for commercial use at any
; version, this is a business-preference pin, not a legal requirement).
;
; Pascal Script here is deliberately minimal — one clean Exec() call to the single JS
; orchestrator (backend\scripts\firstInstall.js, INSTALL-06's own new file), never a chain of
; separate CLI commands run from Pascal Script (decision #1). All real sequencing/branching/
; idempotency logic lives in that orchestrator (and the INSTALL-02/03/04/05 code it reuses,
; unmodified) — this file only knows how to lay out files, set directory permissions, and run
; that one command.
;
; NOT VERIFIED TO COMPILE IN THIS SESSION — Inno Setup's compiler (ISCC.exe) is not installed
; in this environment, and per explicit instruction this phase did not install it just to test
; this file. Written against documented, standard Inno Setup 6.x syntax; compilation and a real
; elevated install are both deferred to a future manual verification step, ideally on a
; disposable VM (see the design doc's testing-strategy section).
;
; INSTALL-07 — added PrepareToInstall's pre-upgrade service-stop step (see its own comment
; below), closing the one gap INSTALL-06's design doc explicitly flagged as deferred
; ("stopping the StudixApp/StudixPostgreSQL services before the [Files] copy phase overwrites
; their binaries on an in-place upgrade"). No other INSTALL-06 behavior changed.
; ─────────────────────────────────────────────────────────────

#define MyAppName "Studix"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Studix"

[Setup]
; MUST NOT change after the first public release — Inno Setup's upgrade detection (and the
; Windows "Programs and Features" entry identity) is keyed on this GUID, not the app name/
; version. Generate a real GUID once (e.g. via Inno Setup's own Tools > Generate GUID) and
; treat it as permanent from that point on.
AppId={{00000000-0000-0000-0000-000000000000}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Studix
DefaultGroupName=Studix
DisableProgramGroupPage=yes
; Required: writes to Program Files, registers Windows services (both need elevation) — never
; PrivilegesRequired=lowest for this installer.
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\node\node.exe
OutputBaseFilename=StudixSetup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
; Studix is a local desktop-per-teacher app (see server.js's own 127.0.0.1-only binding
; comment) — no reason to offer a non-elevated per-user install mode here.
WizardStyle=modern

[Languages]
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

; ── ProgramData ACL (decision #4) — the ENTIRE %ProgramData%\Studix\ tree, not just config\.
; Restricted to Administrators + SYSTEM only: the SESSION_SECRET/PostgreSQL-password-bearing
; config file, pgdata, logs, and backups all live under here. Both Windows services run as
; LocalSystem by default (lib/windowsService.js never overrides SERVICE_START_NAME), which
; already has unrestricted local access regardless of this ACL — this permission list denies
; ordinary interactive users read access without breaking either service's own legitimate
; access. NTFS ACL inheritance means every subdirectory the running application later creates
; itself (pgdata\, logs\, backups\, config\ — via plain fs.mkdirSync calls, which set no ACL of
; their own) inherits this same restriction automatically; nothing else in this script needs to
; enumerate those subdirectories individually.
[Dirs]
Name: "{commonappdata}\Studix"; Permissions: admins-full system-full

[Files]
; The entire INSTALL-01..06-assembled runtime package (release\win-x64\studix\ — node\,
; backend\, dist\, pgsql\, tools\nssm.exe) — built and dependency-fetched separately by
; scripts\build-windows-runtime.ps1 before this script is ever compiled. This installer does
; not itself run npm/vite/prisma/binary downloads — it only packages an already-assembled,
; already-verified output directory.
Source: "..\release\win-x64\studix\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\Studix"; Filename: "http://localhost:4000/"; IconFilename: "{app}\node\node.exe"
Name: "{group}\Uninstall Studix"; Filename: "{uninstallexe}"

[Code]
// INSTALL-07 — upgrade safety: stop both services BEFORE the [Files] section overwrites
// node.exe/postgres.exe/pg_ctl.exe/nssm.exe on an in-place upgrade. Without this, Windows can
// refuse to overwrite an executable file that a running process still has open, failing the
// upgrade outright. This gap was explicitly identified and deliberately left unsolved by
// INSTALL-06's own design doc (§"Upgrade/reinstall behavior") — closed here, in the same file,
// with no changes to any INSTALL-01..06 code.
//
// Reuses the ALREADY-INSTALLED (old) node.exe + backend/scripts/manageWindowsServices.js
// (INSTALL-05, unmodified) via Exec() — never reimplements service-stop logic in Pascal
// Script, matching decision #1's "keep Pascal Script minimal, reuse the Node-side tooling"
// principle exactly. Runs at PrepareToInstall — strictly before [Files] copies anything, so
// what gets executed here is genuinely the PREVIOUS version's own tooling stopping itself.
//
// Best-effort and never fatal to the install: a fresh install has neither service registered
// yet (the expected, common case — manageWindowsServices.js's own "stop" action exits non-zero
// with reason "not_registered" for exactly this case), which this code deliberately does not
// treat as an error. Any OTHER real stop failure does not abort Setup either — the actual
// safety net remains firstInstall.js's own unchanged, already-approved fail-closed
// register+start sequence at ssPostInstall (below), which runs after every [Files] copy
// regardless and will surface a clear error if something is still genuinely wrong.
procedure BestEffortStopServiceForUpgrade(ServiceArg: String);
var
  NodeExe, ManageScript: String;
  ResultCode: Integer;
begin
  NodeExe := ExpandConstant('{app}\node\node.exe');
  ManageScript := ExpandConstant('{app}\backend\scripts\manageWindowsServices.js');
  if not FileExists(ManageScript) then
    Exit; // nothing previously installed here — genuinely fresh install, nothing to stop

  if not Exec(NodeExe, '"' + ManageScript + '" ' + ServiceArg + ' stop', ExpandConstant('{app}'),
              SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    Log('INSTALL-07: could not even launch manageWindowsServices.js to stop ' + ServiceArg +
        ' before upgrade file copy — continuing anyway (best-effort, non-fatal).')
  else
    Log('INSTALL-07: pre-upgrade stop of ' + ServiceArg + ' exited with code ' + IntToStr(ResultCode) +
        ' (0/already-stopped/not-registered are all fine; firstInstall.js re-verifies after file copy regardless).');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  BestEffortStopServiceForUpgrade('app');      // stop the Node app first — it depends on Postgres
  BestEffortStopServiceForUpgrade('postgres'); // then Postgres, whose binaries [Files] may also overwrite
  Result := ''; // never block Setup on this — see the procedure's own comment for why
end;

// RunFirstInstall: the ONE Exec() call (decision #1) — invokes the bundled node.exe against
// the single JS orchestrator, passing the actual chosen install directory through so
// lib/windowsService.js's resolveInstallRoot()/STUDIX_INSTALL_ROOT override resolves correctly
// regardless of where the operator chose to install (never assumes a hardcoded path — audit
// §7 "untrusted install paths" finding).
procedure RunFirstInstall();
var
  ResultCode: Integer;
  NodeExe, OrchestratorScript: String;
begin
  NodeExe := ExpandConstant('{app}\node\node.exe');
  OrchestratorScript := ExpandConstant('{app}\backend\scripts\firstInstall.js');

  if not Exec(NodeExe, '"' + OrchestratorScript + '"', ExpandConstant('{app}'),
              SW_SHOW, ewWaitUntilTerminated, ResultCode) then
  begin
    MsgBox('تعذّر تشغيل عملية التثبيت الأولى (firstInstall.js). راجع سجلّ الأخطاء.', mbCriticalError, MB_OK);
    Exit;
  end;

  if ResultCode <> 0 then
  begin
    // Idempotency-first failure handling (design doc §"Rollback/failure philosophy", decision
    // #11) — no custom rollback of already-completed steps is attempted here. Every step
    // firstInstall.js sequences is independently idempotent/fail-closed; re-running Setup (or
    // firstInstall.js directly) safely resumes from wherever this run stopped.
    MsgBox('فشلت خطوة من خطوات إعداد Studix (رمز الخروج: ' + IntToStr(ResultCode) + '). ' +
           'يمكن إعادة تشغيل هذا المثبِّت بأمان لإكمال الإعداد — كل خطوة آمنة لإعادة المحاولة.',
           mbCriticalError, MB_OK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    RunFirstInstall();
end;

// Explicit, in-code confirmation of decision #5 — NOT registered as an [UninstallDelete]
// entry, and no code here ever targets {commonappdata}\Studix. Inno Setup's own built-in
// uninstaller only ever removes files it tracked installing under {app} (Program Files) — it
// has no knowledge of {commonappdata}\Studix at all unless explicitly told to touch it, so the
// simplest and safest implementation of "never delete ProgramData on uninstall" is exactly
// what this script already does: nothing. A future explicit, separate, opt-in "wipe all data"
// utility is out of INSTALL-06's scope (design doc §"Uninstall policy").
