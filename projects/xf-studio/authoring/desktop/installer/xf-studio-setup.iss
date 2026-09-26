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
; Every path is relative to this script, so no build-machine path is compiled in. Files are
; stored uncompressed (the payload is already a Zstandard archive), which also lets
; verify-canary.ts find each verified payload file byte for byte inside the single installer.
;
; Defines passed by single-installer.ts (ISCC /D...):
;   AppVersion      package.json version, e.g. 0.1.0-alpha.1
;   AppVersionQuad  numeric file version, e.g. 0.1.0.0
;   Payload         folder holding Electrobun's setup program and .installer (relative)
;   SetupProgram    Electrobun's setup file name, e.g. "XF Studio-Setup-canary.exe"
;   OutputDir       output folder (relative)
;   OutputName      output base file name, without .exe

#ifndef AppVersion
  #error AppVersion must be defined
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
var
  InstallExitCode: Integer;

// Run Electrobun's setup from the temporary folder and wait for it. Its own window shows the
// progress and the result, then opens XF Studio. It runs from the user's local app data folder
// so the app it starts does not hold Inno Setup's temporary folder open.
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then Exit;
  WizardForm.Hide;
  if not Exec(ExpandConstant('{tmp}\{#SetupProgram}'), '', ExpandConstant('{localappdata}'),
    SW_SHOWNORMAL, ewWaitUntilTerminated, ResultCode) then
  begin
    InstallExitCode := 2;
    SuppressibleMsgBox('XF Studio setup could not start its installer (' + SysErrorMessage(ResultCode) + '). ' +
      'Download the setup again and retry.', mbError, MB_OK, IDOK);
  end
  else if ResultCode <> 0 then
    InstallExitCode := 3;
end;

function GetCustomSetupExitCode: Integer;
begin
  Result := InstallExitCode;
end;
