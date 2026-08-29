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
