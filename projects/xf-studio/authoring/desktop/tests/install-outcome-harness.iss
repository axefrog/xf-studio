; Test harness for installer/install-outcome.iss, compiled and run by tests/install-outcome.test.ts. It installs nothing: run with
; /VERYSILENT /CASES=<file> /OUT=<file>, it reads one case per line (fields separated by "|"), writes one result per line and
; stops before its first page.
;
; Defines: OutputDir (absolute; the harness is never shipped).

[Setup]
AppId=dev.axefrog.xf-studio.outcome-harness
AppName=XF Studio outcome harness
AppVersion=0
PrivilegesRequired=lowest
CreateAppDir=no
Uninstallable=no
DisableWelcomePage=yes
ShowLanguageDialog=no
OutputDir={#OutputDir}
OutputBaseFilename=outcome-harness

[Code]
#include "..\installer\install-outcome.iss"

function Field(const Line: String; Index: Integer): String;
var
  Rest: String;
  At: Integer;
begin
  Rest := Line;
  while Index > 0 do
  begin
    At := Pos('|', Rest);
    if At = 0 then Rest := '' else Rest := Copy(Rest, At + 1, Length(Rest));
    Index := Index - 1;
  end;
  At := Pos('|', Rest);
  if At = 0 then Result := Rest else Result := Copy(Rest, 1, At - 1);
end;

function Flag(const Value: String): Boolean;
begin
  Result := Value = '1';
end;

function Answer(const Value: Boolean): String;
begin
  if Value then Result := 'yes' else Result := 'no';
end;

function RunCase(const Line: String): String;
var
  Kind: String;
begin
  Kind := Field(Line, 0);
  if Kind = 'classify' then
    Result := IntToStr(ClassifyInstall(Flag(Field(Line, 1)), Flag(Field(Line, 2)), Flag(Field(Line, 3)), Field(Line, 4)))
  else if Kind = 'exit' then
    Result := IntToStr(OutcomeExitCode(StrToInt(Field(Line, 1))))
  else if Kind = 'heading' then
    Result := OutcomeHeading(StrToInt(Field(Line, 1)))
  else if Kind = 'text' then
    Result := OutcomeText(StrToInt(Field(Line, 1)))
  else if Kind = 'phase' then
    Result := PhaseStatus(Field(Line, 1))
  else if Kind = 'fatal' then
    Result := FatalErrorName(Field(Line, 1))
  else if Kind = 'version' then
    Result := Answer(VersionFileMatches(Field(Line, 1), Field(Line, 2)))
  else if Kind = 'location' then
    Result := Answer(SameInstallLocation(Field(Line, 1), Field(Line, 2)))
  else if Kind = 'strip' then
    Result := StripLongPathPrefix(Field(Line, 1))
  else if Kind = 'redirected' then
    Result := Answer(PhysicalPathRedirected(Field(Line, 1), Field(Line, 2), Field(Line, 3)))
  else if Kind = 'physical' then
    Result := StripLongPathPrefix(PhysicalPath(Field(Line, 1)))
  else if Kind = 'probe' then
    Result := Answer(InstallFolderRedirected)
  else
    Result := 'unknown case ' + Kind;
end;

function InitializeSetup: Boolean;
var
  Cases, Results: TArrayOfString;
  I: Integer;
begin
  Result := False;
  if not LoadStringsFromFile(ExpandConstant('{param:cases|}'), Cases) then Exit;
  SetArrayLength(Results, GetArrayLength(Cases));
  for I := 0 to GetArrayLength(Cases) - 1 do
    Results[I] := RunCase(Cases[I]);
  SaveStringsToUTF8FileWithoutBOM(ExpandConstant('{param:out|}'), Results, False);
end;
