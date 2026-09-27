; XF Studio single-file Windows setup (Inno Setup 6.7.3), built by single-installer.ts.
;
; Electrobun 2.0.1's setup program only works with its hidden `.installer` payload folder beside
; it, which is why Electrobun ships it as a ZIP. This wrapper carries that unmodified setup and
; payload inside one executable: it unpacks them into Inno Setup's private temporary folder and
; runs Electrobun's own setup there, which installs for the current Windows user, creates the
; Start menu shortcut, registers Electrobun's uninstaller and opens XF Studio. The wrapper itself
; installs nothing, registers no second uninstaller and needs no administrator rights, and Inno
; Setup deletes its temporary folder when it exits.
;
; One window: Electrobun's own progress dialog runs hidden (SW_HIDE) and closes itself
; (ELECTROBUN_INSTALLER_UI_AUTOCLOSE=1), while this wizard shows a moving bar with Electrobun's
; phases in plain words. Success is decided by what is installed (this build's version.json and
; launcher, Electrobun's uninstall.exe and its uninstall entry), not by Electrobun's exit code
; alone (install-outcome.iss). Electrobun's output, the checks and the outcome go to the setup
; log, %TEMP%\XF Studio setup.log.
;
; Every path is relative to this script, so no build-machine path is compiled in. Files are
; stored uncompressed (the payload is already a Zstandard archive), which also lets
; verify-canary.ts find each verified payload file byte for byte inside the single installer.
; Setup's own data (the compiled script, messages and wizard settings) is stored uncompressed too
; (InternalCompressLevel=none), so verify-canary.ts's content scan reads it as text, not as
; compressed bytes.
;
; Exit codes, beside Inno Setup's own 0-8 (1: it stopped before its first page, which it also
; does after offering to reopen itself through File Explorer; 2: the user cancelled before
; installing):
;   100  Electrobun's setup could not be started
;   101  nothing new was installed, and the person closed the explanation instead of retrying
;   103  this build's files were installed but not added to the Start menu and installed apps,
;        and the person closed the explanation instead of retrying
;
; Defines passed by single-installer.ts (ISCC /D...):
;   AppVersion      package.json version, e.g. 0.1.0-alpha.1
;   AppVersionQuad  numeric file version, distinct per pre-release, e.g. 0.1.0.1001
;   AppIdentifier   Electrobun identifier from the payload's metadata, e.g. dev.axefrog.xf-studio
;   AppChannel      Electrobun channel from the payload's metadata, e.g. canary
;   BuildHash       Electrobun build hash from the payload's metadata (checked in version.json)
;   Payload         folder holding Electrobun's setup program and .installer (relative)
;   SetupProgram    Electrobun's setup file name, e.g. "XF Studio-Setup-canary.exe"
;   OutputDir       output folder (relative)
;   OutputName      output base file name, without .exe

#ifndef AppVersion
  #error AppVersion must be defined
#endif
#ifndef BuildHash
  #error BuildHash must be defined
#endif

[Setup]
AppId=dev.axefrog.xf-studio.setup
AppName=XF Studio
AppVersion={#AppVersion}
AppVerName=XF Studio {#AppVersion}
AppPublisher=XF Studio
AppPublisherURL=https://github.com/axefrog/xf-studio
AppSupportURL=https://github.com/axefrog/xf-studio/issues
VersionInfoVersion={#AppVersionQuad}
VersionInfoTextVersion={#AppVersion}
VersionInfoProductName=XF Studio
VersionInfoProductVersion={#AppVersionQuad}
VersionInfoProductTextVersion={#AppVersion}
VersionInfoDescription=XF Studio {#AppVersion} setup
; Per-user, like Electrobun's own setup: never asks for administrator rights.
PrivilegesRequired=lowest
; Electrobun's setup owns the install folder, shortcuts and uninstaller.
CreateAppDir=no
Uninstallable=no
DisableWelcomePage=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
DisableFinishedPage=yes
ShowLanguageDialog=no
ArchitecturesAllowed=x64compatible
MinVersion=10.0
WizardStyle=modern
SetupIconFile=..\icon\icon.ico
Compression=none
InternalCompressLevel=none
; One setup at a time: a second copy started while one runs says so and stops.
SetupMutex=dev.axefrog.xf-studio.setup
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}

[Messages]
WizardReady=Ready to install XF Studio
ReadyLabel1=XF Studio {#AppVersion} will be installed for your Windows user only. No administrator rights are needed.
ReadyLabel2b=Click Install to continue. XF Studio opens when it's ready.

[Files]
Source: "{#Payload}\{#SetupProgram}"; DestDir: "{tmp}"; Flags: ignoreversion
Source: "{#Payload}\.installer\{#StringChange(SetupProgram, '.exe', '.metadata.json')}"; DestDir: "{tmp}\.installer"; Flags: ignoreversion
Source: "{#Payload}\.installer\{#StringChange(SetupProgram, '.exe', '.tar.zst')}"; DestDir: "{tmp}\.installer"; Flags: ignoreversion

[Code]
#include "install-outcome.iss"

const
  AppIdentifier = '{#AppIdentifier}';
  AppChannel = '{#AppChannel}';
  BuildHash = '{#BuildHash}';
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppIdentifier}.{#AppChannel}';

var
  InstallExitCode: Integer;
  SetupLog: TArrayOfString;
  FatalError: String;

function XfsSetEnvironmentVariable(lpName, lpValue: String): Boolean;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';

function ChannelRoot: String;
begin
  Result := ExpandConstant('{localappdata}') + '\' + AppIdentifier + '\' + AppChannel;
end;

function AppDir: String;
begin
  Result := ChannelRoot + '\app';
end;

function SetupLogPath: String;
begin
  Result := AddBackslash(GetEnv('TEMP')) + 'XF Studio setup.log';
end;

procedure AddLog(const Line: String);
begin
  SetArrayLength(SetupLog, GetArrayLength(SetupLog) + 1);
  SetupLog[GetArrayLength(SetupLog) - 1] := Line;
end;

function YesNo(const Value: Boolean): String;
begin
  if Value then Result := 'yes' else Result := 'no';
end;

{ This build's app files: its launcher and a version.json naming this build. }
function AppFilesInstalled: Boolean;
var
  Text: AnsiString;
begin
  Result := FileExists(AppDir + '\bin\launcher.exe') and LoadStringFromFile(AppDir + '\Resources\version.json', Text) and
    VersionFileMatches(String(Text), BuildHash);
end;

{ Electrobun's integration: its uninstaller in the channel folder and its uninstall entry naming this app folder and version. }
function AddedToWindows: Boolean;
var
  Location, Version: String;
begin
  Result := FileExists(ChannelRoot + '\uninstall.exe') and
    RegQueryStringValue(HKCU64, UninstallKey, 'InstallLocation', Location) and SameInstallLocation(Location, AppDir) and
    RegQueryStringValue(HKCU64, UninstallKey, 'DisplayVersion', Version) and (Version = '{#AppVersion}');
end;

{ Each line Electrobun's setup prints: kept for the log, its phases shown as plain status, its closing error name kept. }
procedure OnElectrobunOutput(const S: String; const Error, FirstLine: Boolean);
var
  Status: String;
begin
  AddLog(S);
  Status := PhaseStatus(S);
  if Status <> '' then WizardForm.StatusLabel.Caption := Status;
  if FatalErrorName(S) <> '' then FatalError := FatalErrorName(S);
end;

{ Run Electrobun's setup once, hidden, and say what is installed afterwards. }
function RunElectrobunSetup: Integer;
var
  Started, Files, Added: Boolean;
  ResultCode: Integer;
begin
  SetArrayLength(SetupLog, 0);
  FatalError := '';
  AddLog('XF Studio {#AppVersion} setup, build ' + BuildHash + ', ' + GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':'));
  AddLog('Install folder: ' + AppDir);
  WizardForm.StatusLabel.Caption := 'Installing XF Studio' + #$2026;
  WizardForm.FilenameLabel.Caption := '';
  WizardForm.ProgressGauge.Style := npbstMarquee;
  // Electrobun's own dialog stays hidden and closes itself at the end, so this wizard is the one progress display.
  XfsSetEnvironmentVariable('ELECTROBUN_INSTALLER_UI_AUTOCLOSE', '1');
  try
    // From the local app data folder, so the app it opens doesn't hold Inno Setup's temporary folder open.
    Started := ExecAndLogOutput(ExpandConstant('{tmp}\{#SetupProgram}'), '', ExpandConstant('{localappdata}'), SW_HIDE,
      ewWaitUntilTerminated, ResultCode, @OnElectrobunOutput);
  except
    Started := False;
    AddLog('Could not start: ' + GetExceptionMessage);
  end;
  if Started then
    AddLog('Electrobun setup exit code: ' + IntToStr(ResultCode))
  else
    AddLog('Electrobun setup did not start: ' + SysErrorMessage(ResultCode));
  Files := AppFilesInstalled;
  Added := AddedToWindows;
  Result := ClassifyInstall(Started, Files, Added, FatalError);
  AddLog('This build''s files installed: ' + YesNo(Files));
  AddLog('Added to the Start menu and installed apps: ' + YesNo(Added));
  AddLog('Outcome: ' + IntToStr(Result));
  SaveStringsToUTF8File(SetupLogPath, SetupLog, False);
  WizardForm.ProgressGauge.Style := npbstNormal;
end;

{ After Inno Setup unpacked Electrobun's setup: run it, then explain anything short of a full install, with Try again. }
procedure CurStepChanged(CurStep: TSetupStep);
var
  Outcome, Choice, OpenError: Integer;
begin
  if CurStep <> ssPostInstall then Exit;
  repeat
    Outcome := RunElectrobunSetup;
    InstallExitCode := OutcomeExitCode(Outcome);
    if Outcome = ioInstalled then Exit;
    if Outcome = ioNotStarted then
    begin
      SuppressibleTaskDialogMsgBox(OutcomeHeading(Outcome), OutcomeText(Outcome), mbError, MB_OK, [], 0, IDOK);
      Exit;
    end;
    repeat
      // (A line of this section must not begin with "[": Inno Setup would read it as a section heading.)
      Choice := SuppressibleTaskDialogMsgBox(OutcomeHeading(Outcome), OutcomeText(Outcome), mbError,
        MB_YESNOCANCEL, ['Try again', 'Open the setup log', 'Close'], 0, IDCANCEL);
      if Choice = IDNO then
        ShellExec('open', SetupLogPath, '', '', SW_SHOWNORMAL, ewNoWait, OpenError);
    until Choice <> IDNO;
  until Choice <> IDYES;
end;

function GetCustomSetupExitCode: Integer;
begin
  Result := InstallExitCode;
end;

{
  Before any page: a setup started from inside a Microsoft Store app would install XF Studio into that app's private storage,
  where Windows' Start menu, installed apps and File Explorer can't see it. Offer to reopen it through File Explorer (a new process
  of the Windows shell, outside that app), and stop this copy.
}
function InitializeSetup: Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  if not InstallFolderRedirected then Exit;
  Result := False;
  if SuppressibleTaskDialogMsgBox('Open this setup from File Explorer',
    'It was started from inside another app (one from the Microsoft Store, for example), and Windows keeps anything installed ' +
    'from there inside that app, so XF Studio would not appear in your Start menu or open on its own.' + #13#10#13#10 +
    'Reopen it through File Explorer, where it installs normally.',
    mbInformation, MB_OKCANCEL, ['Reopen through File Explorer', 'Close'], 0, IDCANCEL) = IDOK then
    Exec(ExpandConstant('{win}\explorer.exe'), AddQuotes(ExpandConstant('{srcexe}')), '', SW_SHOWNORMAL, ewNoWait, ResultCode);
end;
