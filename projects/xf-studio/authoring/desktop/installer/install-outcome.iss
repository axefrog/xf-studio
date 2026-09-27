// What XF Studio's single setup concludes after running Electrobun's setup, included by xf-studio-setup.iss.
//
// Most of these functions are pure: they take facts the wrapper gathered (whether Electrobun's setup started, the installed files,
// the uninstall entry, the last "error: <Name>" line Electrobun printed) and return an outcome or a plain sentence. The last two
// read the disk: PhysicalPath (where a folder really is) and InstallFolderRedirected (the Microsoft Store app check). The wrapper decides
// success by what is actually installed, never by Electrobun's exit code alone: Electrobun 2.0.1 returns 1 for any error, including
// one raised after the app's files were already committed (its Start menu and uninstall integration runs last). They are tested by
// tests/install-outcome.test.ts, which compiles tests/install-outcome-harness.iss around this file and runs it with fake facts
// (and PhysicalPath with a real folder).

const
  ioInstalled = 0;       { The app's files for this build, the uninstaller and Windows' uninstall entry are all in place. }
  ioFilesOnly = 1;       { This build's files are in place, but the Start menu and installed-apps entry are not. }
  ioAppOpen = 2;         { Nothing new installed: XF Studio (or a file of it) was in use. }
  ioSetupBusy = 3;       { Nothing new installed: another XF Studio setup holds the install lock. }
  ioFailed = 4;          { Nothing new installed, for another reason (the log names it). }
  ioNotStarted = 5;      { Electrobun's setup could not be started at all. }
  FILE_FLAG_BACKUP_SEMANTICS = $02000000;
  OPEN_EXISTING_FILE = 3;
  SHARE_ALL = 7;

{ Electrobun's phase lines (printed to its output when the phase changes), as plain status text for the wizard, or ''. }
function PhaseStatus(const Line: String): String;
begin
  Result := '';
  if (Line = 'Decompressing application...') or (Line = 'Extracting application files...') then
    Result := 'Unpacking XF Studio' + #$2026
  else if Line = 'Installing application files...' then
    Result := 'Copying XF Studio to your computer' + #$2026
  else if Line = 'Creating shortcuts and integration...' then
    Result := 'Adding XF Studio to your Start menu' + #$2026;
end;

{ The error name from Zig's closing "error: <Name>" line, or ''. }
function FatalErrorName(const Line: String): String;
begin
  Result := '';
  if Copy(Line, 1, 7) = 'error: ' then
    Result := Trim(Copy(Line, 8, Length(Line)));
end;

{ Whether Electrobun's version.json names this build: its "hash" value, as Electrobun writes it (compact JSON). }
function VersionFileMatches(const Text, BuildHash: String): Boolean;
begin
  Result := (BuildHash <> '') and (Pos('"hash":"' + BuildHash + '"', Text) > 0);
end;

{ The uninstall entry's InstallLocation names the app folder (case and a trailing backslash aside). }
function SameInstallLocation(const Registered, AppDir: String): Boolean;
begin
  Result := (Registered <> '') and (CompareText(RemoveBackslashUnlessRoot(Trim(Registered)), RemoveBackslashUnlessRoot(AppDir)) = 0);
end;

{ A path from GetFinalPathNameByHandle without its \\?\ (or \\?\UNC\) prefix. }
function StripLongPathPrefix(const Path: String): String;
begin
  Result := Path;
  if Copy(Result, 1, 8) = '\\?\UNC\' then
    Result := '\\' + Copy(Result, 9, Length(Result))
  else if Copy(Result, 1, 4) = '\\?\' then
    Result := Copy(Result, 5, Length(Result));
end;

{
  Whether a folder just created in the user's local app data really landed somewhere else. Windows does this for programs started
  from inside a Microsoft Store (MSIX) app: their writes to AppData go to that app's private
  %LOCALAPPDATA%\Packages\<app>\LocalCache folder, which only that app's processes see. Electrobun's setup then copies XF Studio
  there, refuses to register it (its install-folder check compares these same physical paths) and reports a failure. An unknown
  path (either lookup failed) is never called redirected.
}
function PhysicalPathRedirected(const RootPhysical, ProbePhysical, ProbeName: String): Boolean;
begin
  if (RootPhysical = '') or (ProbePhysical = '') then
    Result := False
  else
    Result := CompareText(StripLongPathPrefix(ProbePhysical), AddBackslash(StripLongPathPrefix(RootPhysical)) + ProbeName) <> 0;
end;

{ The outcome, from what is installed first and Electrobun's error name second. Its exit code is only logged. }
function ClassifyInstall(const Started, AppFiles, AddedToWindows: Boolean; const FatalError: String): Integer;
begin
  if not Started then
    Result := ioNotStarted
  else if AppFiles and AddedToWindows then
    Result := ioInstalled
  else if AppFiles then
    Result := ioFilesOnly
  else if (FatalError = 'AccessDenied') or (FatalError = 'FileBusy') or (FatalError = 'PermissionDenied') then
    Result := ioAppOpen
  else if FatalError = 'InstallationAlreadyInProgress' then
    Result := ioSetupBusy
  else
    Result := ioFailed;
end;

{ The setup's exit code for an outcome the person closed without retrying (see xf-studio-setup.iss). }
function OutcomeExitCode(const Outcome: Integer): Integer;
begin
  case Outcome of
    ioInstalled: Result := 0;
    ioFilesOnly: Result := 103;
    ioNotStarted: Result := 100;
  else
    Result := 101;
  end;
end;

{ The failure message's heading. }
function OutcomeHeading(const Outcome: Integer): String;
begin
  case Outcome of
    ioFilesOnly: Result := 'XF Studio is installed, but not in your Start menu yet';
    ioAppOpen: Result := 'Close XF Studio first';
    ioSetupBusy: Result := 'Another XF Studio setup is running';
    ioNotStarted: Result := 'The setup could not start';
  else
    Result := 'XF Studio could not be installed';
  end;
end;

{ The failure message: what happened, in plain words, and the one next step. }
function OutcomeText(const Outcome: Integer): String;
begin
  case Outcome of
    ioFilesOnly: Result := 'Its files are on your computer, but Windows did not finish adding XF Studio to your Start menu and ' +
      'installed apps. Choose Try again to finish. Your library and settings are kept.';
    ioAppOpen: Result := 'XF Studio is open, so its files cannot be replaced. Close XF Studio (check the taskbar), then choose Try again.';
    ioSetupBusy: Result := 'Let the other setup finish, or close it, then choose Try again.';
    ioNotStarted: Result := 'Windows would not start the installer inside this setup. Build or download the setup again, then run the new copy.';
  else
    Result := 'The installation stopped before it finished. Choose Try again. If it stops again, the setup log says why.';
  end;
end;

function XfsCreateFile(lpFileName: String; dwDesiredAccess, dwShareMode: Cardinal; lpSecurityAttributes: Integer;
  dwCreationDisposition, dwFlagsAndAttributes: Cardinal; hTemplateFile: Integer): Integer;
  external 'CreateFileW@kernel32.dll stdcall';
function XfsGetFinalPathNameByHandle(hFile: Integer; lpszFilePath: String; cchFilePath, dwFlags: Cardinal): Cardinal;
  external 'GetFinalPathNameByHandleW@kernel32.dll stdcall';
function XfsCloseHandle(hObject: Integer): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';

{ Where a folder really is on disk (GetFinalPathNameByHandle), or '' when it can't be opened. }
function PhysicalPath(const Path: String): String;
var
  Handle: Integer;
  Buffer: String;
  Count: Cardinal;
begin
  Result := '';
  Handle := XfsCreateFile(Path, 0, SHARE_ALL, 0, OPEN_EXISTING_FILE, FILE_FLAG_BACKUP_SEMANTICS, 0);
  if Handle = -1 then Exit;
  try
    SetLength(Buffer, 1024);
    Count := XfsGetFinalPathNameByHandle(Handle, Buffer, 1024, 0);
    if (Count > 0) and (Count < 1024) then Result := Copy(Buffer, 1, Count);
  finally
    XfsCloseHandle(Handle);
  end;
end;

{ Whether Windows redirects this setup's writes to the local app data folder (see PhysicalPathRedirected). }
function InstallFolderRedirected: Boolean;
var
  Root, Name, Probe: String;
begin
  Result := False;
  Root := ExpandConstant('{localappdata}');
  Name := 'xfs-setup-probe-' + GetDateTimeString('yyyymmddhhnnsszzz', #0, #0);
  Probe := AddBackslash(Root) + Name;
  if not CreateDir(Probe) then Exit;
  try
    Result := PhysicalPathRedirected(PhysicalPath(Root), PhysicalPath(Probe), Name);
  finally
    RemoveDir(Probe);
  end;
end;
