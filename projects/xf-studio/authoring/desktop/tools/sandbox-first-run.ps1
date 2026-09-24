# Runs inside Windows Sandbox (see sandbox-trial.ts). Records the environment, checks the setup
# ZIP against its checksum, runs the installer, launches the installed app with no preview assets
# and captures what happened. Everything written goes to the mapped results folder; the sandbox
# and everything installed in it are discarded when its window closes.
$ErrorActionPreference = "Continue"
$in = Join-Path $env:USERPROFILE "Desktop\xfs-input"
$out = Join-Path $env:USERPROFILE "Desktop\xfs-results"
$report = [ordered]@{ schema = "xfs/desktop-sandbox-first-run-1"; started = (Get-Date).ToString("o") }
function Save { $report | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $out "report.json") }
function Shot([string]$name) {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save((Join-Path $out "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$report.os = (Get-CimInstance Win32_OperatingSystem).Caption + " " + [Environment]::OSVersion.Version
$report.user = $identity.Name
$report.elevated = (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$wv = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
$report.webview2 = if (Test-Path $wv) { (Get-ItemProperty $wv).pv } else { "not registered" }
$report.bunOnPath = [bool](Get-Command bun -ErrorAction SilentlyContinue)

$zip = Get-ChildItem $in -Filter *.zip | Select-Object -First 1
$expected = ((Get-Content (Join-Path $in "SHA256SUMS.txt")) -split "\s+")[0]
$report.setupZip = $zip.Name
$report.checksumMatches = (Get-FileHash $zip.FullName -Algorithm SHA256).Hash.ToLower() -eq $expected
$setupDir = Join-Path $env:TEMP "xfs-setup"
Expand-Archive $zip.FullName $setupDir -Force
$setup = Get-ChildItem $setupDir -Filter "*Setup*.exe" | Select-Object -First 1
Save

# Unattended: Electrobun 2.0.1's setup accepts --quiet. If it still shows its final
# "Installation complete" window, dismiss it once the installed launcher exists, so the
# trial never waits for a person. The report records which path happened.
$t = Get-Date
$proc = Start-Process $setup.FullName -ArgumentList "--quiet" -PassThru
$shell = New-Object -ComObject WScript.Shell
$report.installerDismissed = $false
while (-not $proc.HasExited -and ((Get-Date) - $t).TotalSeconds -lt 600) {
  Start-Sleep -Seconds 5
  $installed = Get-ChildItem $env:LOCALAPPDATA -Directory -Filter "dev.axefrog.xf-studio*" -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ChildItem $_.FullName -Recurse -Filter launcher.exe -ErrorAction SilentlyContinue } | Select-Object -First 1
  $proc.Refresh()
  if ($installed -and $proc.MainWindowHandle -ne 0) {
    Start-Sleep -Seconds 5
    if ($proc.HasExited) { break }
    Shot "installer-final"
    [void]$shell.AppActivate($proc.Id); Start-Sleep -Milliseconds 500; $shell.SendKeys("{ENTER}")
    Start-Sleep -Seconds 3
    if (-not $proc.HasExited) { [void]$proc.CloseMainWindow() }
    $report.installerDismissed = $true
    [void]$proc.WaitForExit(30000)
  }
}
if (-not $proc.HasExited) { $report.installer = "still running after 10 minutes" } else { $report.installer = "exit $($proc.ExitCode)" }
$report.installSeconds = [int]((Get-Date) - $t).TotalSeconds
$roots = Get-ChildItem $env:LOCALAPPDATA -Directory -Filter "dev.axefrog.xf-studio*" -ErrorAction SilentlyContinue
$report.installRoots = @($roots | ForEach-Object { $_.Name })
$launcher = $roots | ForEach-Object { Get-ChildItem $_.FullName -Recurse -Filter launcher.exe -ErrorAction SilentlyContinue } | Select-Object -First 1
$report.launcherFound = [bool]$launcher
$version = $roots | ForEach-Object { Get-ChildItem $_.FullName -Recurse -Filter version.json -ErrorAction SilentlyContinue } | Select-Object -First 1
if ($version) { $report.packagedVersion = Get-Content $version.FullName -Raw | ConvertFrom-Json }
Save

if ($launcher) {
  Start-Process $launcher.FullName -WorkingDirectory $launcher.DirectoryName | Out-Null
  Start-Sleep -Seconds 25
  $report.windows = @(Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { "$($_.ProcessName): $($_.MainWindowTitle)" })
  Shot "first-run"
  # Best effort: the welcome's first button (Start designing) has focus, so Enter dismisses it.
  $app = Get-Process | Where-Object { $_.MainWindowTitle -eq "XF Studio" } | Select-Object -First 1
  if ($app) {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.AppActivate($app.Id); Start-Sleep -Seconds 1; $shell.SendKeys("{ENTER}"); Start-Sleep -Seconds 4
    Shot "after-welcome"
    # Close and reopen: the welcome must not return, and the draft must come back.
    [void]$app.CloseMainWindow(); Start-Sleep -Seconds 8
    $report.closedCleanly = -not (Get-Process -Id $app.Id -ErrorAction SilentlyContinue)
    Start-Process $launcher.FullName -WorkingDirectory $launcher.DirectoryName | Out-Null
    Start-Sleep -Seconds 20
    Shot "relaunch"
  }
  $report.dataRootFiles = @($roots | ForEach-Object { Get-ChildItem $_.FullName -Recurse -File -Include *.json, *.sqlite -ErrorAction SilentlyContinue } |
    Where-Object { $_.FullName -notmatch "\Resources\\" } | ForEach-Object { $_.Name })
}
$report.finished = (Get-Date).ToString("o")
Save
Write-Host "Automatic part finished. Screenshots and report.json are in the results folder; close the sandbox when done."
