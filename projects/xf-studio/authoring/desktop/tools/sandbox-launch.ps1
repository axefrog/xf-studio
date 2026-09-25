# Starts the prepared Windows Sandbox trial (see sandbox-trial.ts) and sizes its window to a
# modest, consistent 1600x1000 so the sandbox desktop and every screenshot stay the same size on
# any monitor (.wsb has no window-size option). Waits until the unattended run shuts it down.
#   powershell -File tools/sandbox-launch.ps1
param([int]$Width = 1600, [int]$Height = 1000, [int]$TimeoutMinutes = 20)
$wsb = Join-Path $PSScriptRoot "..\artifacts\sandbox-trial\XFStudio-first-run.wsb"
if (-not (Test-Path $wsb)) { throw "Prepare the kit first: bun tools/sandbox-trial.ts" }
if (Get-Process WindowsSandboxRemoteSession -ErrorAction SilentlyContinue) { throw "A Windows Sandbox is already running; close it first." }
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class XfsHostWin {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
}
"@
Start-Process -FilePath (Resolve-Path $wsb)
$deadline = (Get-Date).AddMinutes(2); $sized = $false
while (-not $sized -and (Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 1
  $session = Get-Process WindowsSandboxRemoteSession, WindowsSandboxClient -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($session) { $sized = [XfsHostWin]::SetWindowPos($session.MainWindowHandle, [IntPtr]::Zero, 40, 40, $Width, $Height, 0x0040) }
}
Write-Host ($(if ($sized) { "Sandbox window sized to ${Width}x${Height}." } else { "Could not find the sandbox window to size it." }))
$end = (Get-Date).AddMinutes($TimeoutMinutes)
while ((Get-Process WindowsSandboxRemoteSession -ErrorAction SilentlyContinue) -and (Get-Date) -lt $end) { Start-Sleep -Seconds 5 }
Write-Host ($(if (Get-Process WindowsSandboxRemoteSession -ErrorAction SilentlyContinue) { "Sandbox still running after $TimeoutMinutes minutes." } else { "Sandbox finished." }))
