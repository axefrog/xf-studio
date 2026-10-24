# Starts the localhost server outside the launching app's container, so it reads and writes the real
# %LOCALAPPDATA%\XF Studio (settings, and the install receipts it shares with the desktop app).
#
# A packaged desktop app (the Claude app, for one) redirects its child processes' AppData writes into a private copy. A
# server started directly from it would keep its own settings and receipts, which the desktop app and every other launch
# can't see. A process created through WMI belongs to no container, so its writes land where they should.
#
# This script stays running as the server's supervisor: it mirrors the server's output, and the server exits within
# about two seconds of this script stopping (tools/serve-with-supervisor.ts).
param([string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path)
$ErrorActionPreference = "Stop"
$scratch = Join-Path $env:USERPROFILE "xfs-scratch"
New-Item -ItemType Directory -Force $scratch | Out-Null
$log = Join-Path $scratch "studio-server.log"
Set-Content -Path $log -Value "" -Encoding utf8
$bun = (Get-Command bun).Source
$environment = [string[]](@([System.Environment]::GetEnvironmentVariables().GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) + "XFS_SUPERVISOR_PID=$PID")
$command = "cmd.exe /d /c `"`"$bun`" tools/serve-with-supervisor.ts >> `"$log`" 2>&1`""
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; EnvironmentVariables = $environment }
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $command; CurrentDirectory = $Root; ProcessStartupInformation = $startup }
if ($result.ReturnValue -ne 0) { throw "Couldn't start the server (Win32_Process.Create returned $($result.ReturnValue))." }
Get-Content -Path $log -Wait
