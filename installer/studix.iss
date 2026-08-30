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
;
; INSTALL-08 — added an opt-in, off-by-default data-wipe to the uninstaller (see
; InitializeUninstall/TeardownServiceForWipe/CurUninstallStepChanged below), closing the "future
; explicit 'wipe all Studix data' utility" gap INSTALL-06's design doc explicitly flagged as its
; own out-of-scope item (design doc §"Uninstall policy"). Declining the prompt (still the
; default) leaves uninstall behavior byte-for-byte identical to INSTALL-06/07 — nothing about
; the normal uninstall path changed. No INSTALL-01..07 code changed.
;
; INSTALL-09 — added BestEffortUnregisterServiceForUninstall, closing the gap INSTALL-08's own
; D1 decision explicitly left open: a normal (declined-wipe) uninstall never stopped or
; unregistered StudixApp/StudixPostgreSQL, leaving both orphaned and pointing at deleted
; binaries. Best-effort/non-fatal (OD1), runs at CurUninstallStepChanged(usUninstall) (OD2),
; and is a separate helper from TeardownServiceForWipe (OD3) — see
; migration/reports/INSTALL-09_UNINSTALL_SERVICE_CLEANUP.md. InitializeUninstall, D1-D5's
; wipe behavior, and all INSTALL-06/07 install-time code are unchanged.
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
// entry. Inno Setup's own built-in uninstaller only ever removes files it tracked installing
// under {app} (Program Files) — it has no knowledge of {commonappdata}\Studix at all unless
// explicitly told to touch it, so the DEFAULT/DECLINED uninstall path (unchanged since
// INSTALL-06) is exactly what this script already did: nothing. INSTALL-08 below adds the one
// explicit, off-by-default, doubly-confirmed exception to that.

// ── INSTALL-08 — opt-in data-wipe on uninstall ──────────────────────────────────────────────
// Approved design (D1-D5, see migration/reports/INSTALL-08_DATA_WIPE_UNINSTALL.md):
//   D1 — normal (declined-wipe) uninstall behavior is unchanged BY INSTALL-08; the pre-existing
//        gap where a normal uninstall never stops/unregisters either service was a SEPARATE,
//        reported-not-fixed-here issue at the time. Resolved in INSTALL-09 (see
//        BestEffortUnregisterServiceForUninstall below) — the wipe-path decisions D2-D5 in this
//        comment remain exactly as INSTALL-08 implemented them, untouched by that fix.
//   D2 — {commonappdata}\Studix\backups is NEVER deleted, wipe or no wipe — it is the customer's
//        only local disaster-recovery copy (backend/src/db/backup.js has no off-machine
//        replication). Only pgdata\, config\, and logs\ are ever targeted below.
//   D3 — two sequential MsgBox(..., MB_YESNO) confirmations, nothing pre-selected, no custom
//        VCL form.
//   D4 — reachable ONLY through the standard uninstaller; no standalone tool/shortcut/exe.
//   D5 — FAIL-CLOSED: both StudixApp and StudixPostgreSQL must be confirmed
//        stopped-and-unregistered before ANY deletion happens. If either fails, the ENTIRE
//        uninstall aborts before {app} is touched — {app} and both services are left exactly
//        as they were.
//
// Global, set (at most) inside InitializeUninstall, read later inside
// CurUninstallStepChanged(usPostUninstall) — Pascal Script module-level vars persist for the
// whole (un)installer process, the same mechanism already relied on implicitly elsewhere in
// this file (e.g. ExpandConstant('{app}') resolving consistently across every procedure call).
var
  WipeDataConfirmed: Boolean;

// TeardownServiceForWipe: the fail-closed counterpart to INSTALL-07's
// BestEffortStopServiceForUpgrade above — same Exec()-against-the-still-installed-
// manageWindowsServices.js mechanism (decision #1: reuse INSTALL-05, never reimplement service
// logic in Pascal Script), but with the OPPOSITE failure philosophy on purpose (D5): a stop/
// unregister failure here is destructive-adjacent (about to DelTree pgdata), not merely a
// missed optimization the way it is in BestEffortStopServiceForUpgrade (which always has
// firstInstall.js as an independent second safety net afterward — no equivalent net exists for
// a delete). Result defaults to False (fail-closed) and only flips True on a CONFIRMED safe
// outcome.
//
// Uses the 'unregister' action, not 'stop' — unregisterAppService and unregisterPostgresService
// (backend/src/lib/windowsService.js:251,341) already stop the service first internally if it's
// RUNNING before unregistering, so one Exec() call safely does both, reusing INSTALL-05 exactly
// as committed with zero new backend code (per the approved implementation constraints).
//
// A missing manageWindowsServices.js (FileExists check) is treated as a FAILURE here, not a
// safe skip — unlike BestEffortStopServiceForUpgrade's fresh-install case (where "nothing
// installed yet" is provably safe), an uninstall implies something WAS installed; if the script
// that would let us confirm safe teardown is missing, teardown cannot be confirmed, so per D5
// this must not be silently treated as "nothing to do."
function TeardownServiceForWipe(ServiceArg: String): Boolean;
var
  NodeExe, ManageScript: String;
  ResultCode: Integer;
begin
  Result := False; // fail-closed default — only set True below on a confirmed safe outcome
  NodeExe := ExpandConstant('{app}\node\node.exe');
  ManageScript := ExpandConstant('{app}\backend\scripts\manageWindowsServices.js');

  if not FileExists(ManageScript) then
  begin
    Log('INSTALL-08: manageWindowsServices.js not found — cannot confirm safe teardown of ' +
        ServiceArg + '; treating as failure (fail-closed, per D5).');
    Exit;
  end;

  if not Exec(NodeExe, '"' + ManageScript + '" ' + ServiceArg + ' unregister', ExpandConstant('{app}'),
              SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Log('INSTALL-08: could not even launch manageWindowsServices.js to unregister ' + ServiceArg +
        ' — treating as failure (fail-closed, per D5).');
    Exit;
  end;

  if ResultCode <> 0 then
  begin
    Log('INSTALL-08: unregister of ' + ServiceArg + ' exited with code ' + IntToStr(ResultCode) +
        ' — treating as failure (fail-closed, per D5).');
    Exit;
  end;

  Log('INSTALL-08: ' + ServiceArg + ' confirmed safely stopped and unregistered (or was already ' +
      'not registered — manageWindowsServices.js exits 0 for that case too).');
  Result := True;
end;

// InitializeUninstall: the only documented Pascal Script hook whose Boolean return can prevent
// an uninstall from proceeding AT ALL (returning False here cancels everything before Inno
// removes anything, before Inno even shows its own standard "are you sure you want to remove
// {app}?" confirmation) — which is why the wipe's prompts and its fail-closed teardown both have
// to live here rather than in CurUninstallStepChanged(usUninstall) (a plain procedure with no
// way to veto the uninstall). This is a direct, structural consequence of D5's "abort the entire
// uninstall" requirement, not an arbitrary placement choice — traced against Inno Setup's
// documented event contract, not verified by a real compiled run (ISCC.exe still not installed
// in this environment — same carried-forward limitation as INSTALL-06/07).
//
// One known, inherent residual risk (not fixable without new backend transactional logic, which
// the approved implementation constraints explicitly rule out): unregisterAppService and
// unregisterPostgresService are each themselves a stop-then-unregister pair, not a single atomic
// operation. If the 'app' teardown succeeds but the 'postgres' teardown then fails, this
// function still aborts the whole uninstall (D5's letter is satisfied — {app} is never removed,
// no data is deleted), but StudixApp will already have been unregistered while StudixPostgreSQL
// was not — a real, if narrow, partial-state possibility inherent to reusing INSTALL-05's
// existing (non-transactional) primitives as-is.
function InitializeUninstall(): Boolean;
begin
  Result := True; // default: proceed with a completely normal uninstall, no wipe
  WipeDataConfirmed := False;

  if MsgBox(
    'هل تريد أيضاً حذف جميع بيانات Studix نهائياً؟' + #13#10#13#10 +
    'يشمل ذلك: قاعدة البيانات، ملف الإعدادات (بما فيه بيانات الاتصال بقاعدة البيانات)، ' +
    'وسجلّات النظام، الموجودة في:' + #13#10 +
    ExpandConstant('{commonappdata}\Studix') + #13#10#13#10 +
    'لن يتم حذف النسخ الاحتياطية المحلية (backups) — ستبقى محفوظة كما هي.' + #13#10#13#10 +
    'إن اخترت "لا"، ستتم إزالة برنامج Studix فقط، وستبقى جميع بياناتك دون أي تغيير.',
    mbConfirmation, MB_YESNO) = IDNO then
    Exit; // declined at the first prompt — normal uninstall proceeds completely unchanged

  if MsgBox(
    'تحذير: هذا الإجراء نهائي ولا يمكن التراجع عنه.' + #13#10#13#10 +
    'سيتم حذف قاعدة البيانات وملف الإعدادات والسجلّات نهائياً ولن يكون بالإمكان استعادتها ' +
    '(باستثناء النسخ الاحتياطية المحلية في backups، التي ستبقى محفوظة).' + #13#10#13#10 +
    'هل أنت متأكد تماماً من المتابعة؟',
    mbError, MB_YESNO) = IDNO then
    Exit; // backed out at the stronger, irreversibility-focused prompt — proceeds unchanged

  // Fail-closed teardown (D5) — BOTH must succeed before ANY destructive step is allowed.
  // App first (it depends on Postgres — same ordering rationale as INSTALL-07's
  // BestEffortStopServiceForUpgrade above), then Postgres.
  if not TeardownServiceForWipe('app') then
  begin
    MsgBox(
      'تعذّر إيقاف وإلغاء تسجيل خدمة تطبيق Studix (StudixApp) بأمان. تم إلغاء عملية إزالة ' +
      'البرنامج بالكامل حفاظاً على السلامة — لم يتم حذف أي شيء ولم يتم لمس أي بيانات. ' +
      'يمكنك المحاولة مرة أخرى، أو التحقّق من حالة الخدمة يدوياً.',
      mbCriticalError, MB_OK);
    Result := False; // abort the ENTIRE uninstall — {app} and both services stay exactly as they were
    Exit;
  end;

  if not TeardownServiceForWipe('postgres') then
  begin
    MsgBox(
      'تعذّر إيقاف وإلغاء تسجيل خدمة PostgreSQL الخاصة بـ Studix (StudixPostgreSQL) بأمان. تم ' +
      'إلغاء عملية إزالة البرنامج بالكامل حفاظاً على السلامة — لم يتم حذف أي بيانات. ملاحظة: قد ' +
      'تكون خدمة StudixApp قد أُلغي تسجيلها بالفعل ضمن هذه المحاولة.',
      mbCriticalError, MB_OK);
    Result := False;
    Exit;
  end;

  WipeDataConfirmed := True; // both services confirmed safely torn down — wipe may proceed below
end;

// ── INSTALL-09 — best-effort service cleanup for the NORMAL (any) uninstall path ───────────────
// Closes the gap INSTALL-08's own D1 decision explicitly left open (see
// migration/reports/INSTALL-08_DATA_WIPE_UNINSTALL.md and
// migration/reports/INSTALL-09_UNINSTALL_SERVICE_CLEANUP.md): a declined-wipe uninstall
// previously never stopped or unregistered StudixApp/StudixPostgreSQL at all, leaving both
// orphaned and pointing at soon-to-be-deleted binaries.
//
// BestEffortUnregisterServiceForUninstall is a DELIBERATELY SEPARATE helper from
// TeardownServiceForWipe above, not a call to it with the result discarded (OD3) — the two exist
// for different reasons and must stay independently readable: TeardownServiceForWipe is
// fail-closed because it gates a destructive DelTree (D5); this helper is best-effort/non-fatal
// (OD1) because a normal uninstall has no destructive deletion downstream — a failure here only
// means the pre-existing orphaning bug isn't fully closed on this particular run, never a reason
// to block the operator from removing the application. Mirrors
// BestEffortStopServiceForUpgrade's exact shape/mechanism above (decision #1: reuse INSTALL-05's
// manageWindowsServices.js via Exec(), never reimplement service logic in Pascal Script), using
// 'unregister' (not 'stop') for the same reason TeardownServiceForWipe does — unregisterAppService/
// unregisterPostgresService (backend/src/lib/windowsService.js:251,341) already stop the service
// first internally if it's RUNNING, so one Exec() call does both.
procedure BestEffortUnregisterServiceForUninstall(ServiceArg: String);
var
  NodeExe, ManageScript: String;
  ResultCode: Integer;
begin
  NodeExe := ExpandConstant('{app}\node\node.exe');
  ManageScript := ExpandConstant('{app}\backend\scripts\manageWindowsServices.js');
  if not FileExists(ManageScript) then
    Exit; // nothing installed here to unregister

  if not Exec(NodeExe, '"' + ManageScript + '" ' + ServiceArg + ' unregister', ExpandConstant('{app}'),
              SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    Log('INSTALL-09: could not even launch manageWindowsServices.js to unregister ' + ServiceArg +
        ' during normal uninstall — continuing anyway (best-effort, non-fatal, per OD1).')
  else
    Log('INSTALL-09: normal-uninstall unregister of ' + ServiceArg + ' exited with code ' +
        IntToStr(ResultCode) + ' (0/already-unregistered are both fine).');
end;

// CurUninstallStepChanged: two independent branches.
//
// usUninstall (INSTALL-09) — fires AFTER Inno's own "are you sure you want to remove Studix?"
// confirmation has already been accepted (OD2: never acts before the user has confirmed
// anything — deliberately NOT folded into InitializeUninstall, which runs before that standard
// confirmation), and BEFORE {app}'s files are removed, so node.exe/manageWindowsServices.js are
// still present. Runs UNCONDITIONALLY — regardless of whether the operator also accepted
// INSTALL-08's data wipe. This is always safe/idempotent, never a duplicate destructive action:
// if the wipe WAS accepted, InitializeUninstall (which always runs first, before any
// TUninstallStep) already unregistered both services via TeardownServiceForWipe; manageWindows
// Services.js's 'unregister' action exits 0 for an already-not-registered service exactly as it
// does for a freshly-unregistered one, so this call simply finds nothing left to do and logs a
// harmless success. It never re-stops a running process (there isn't one left) and never
// conflicts with D1-D5's already-approved wipe behavior.
//
// usPostUninstall (INSTALL-08, unchanged) — the actual deletion, deliberately placed AFTER
// Inno's own {app} removal has already completed (only reachable at all if InitializeUninstall
// returned True, i.e. either the wipe was declined [WipeDataConfirmed stays False, this whole
// block is a no-op] or both services were already confirmed safely torn down above). Targets
// pgdata\, config\, and logs\ INDIVIDUALLY — never the {commonappdata}\Studix root itself, and
// never backups\ (D2) — so the parent directory and its backups\ subdirectory both survive
// exactly as decision #5's original ACL/[Dirs] entry left them.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    BestEffortUnregisterServiceForUninstall('app');      // app first — it depends on Postgres
    BestEffortUnregisterServiceForUninstall('postgres'); // then Postgres
  end;

  if (CurUninstallStep = usPostUninstall) and WipeDataConfirmed then
  begin
    if not DelTree(ExpandConstant('{commonappdata}\Studix\pgdata'), True, True, True) then
      Log('INSTALL-08: تعذّر حذف pgdata بالكامل — قد تبقى بعض الملفات (راجع سجلّ الإزالة).');
    if not DelTree(ExpandConstant('{commonappdata}\Studix\config'), True, True, True) then
      Log('INSTALL-08: تعذّر حذف config بالكامل — قد تبقى بعض الملفات (راجع سجلّ الإزالة).');
    if not DelTree(ExpandConstant('{commonappdata}\Studix\logs'), True, True, True) then
      Log('INSTALL-08: تعذّر حذف logs بالكامل — قد تبقى بعض الملفات (راجع سجلّ الإزالة).');
  end;
end;
