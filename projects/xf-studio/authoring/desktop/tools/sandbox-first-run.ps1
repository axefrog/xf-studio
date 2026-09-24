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

# The installer may show its own window; complete it by hand if it asks.
$t = Get-Date
$proc = Start-Process $setup.FullName -PassThru
if (-not $proc.WaitForExit(600000)) { $report.installer = "still running after 10 minutes" } else { $report.installer = "exit $($proc.ExitCode)" }
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
}
$report.finished = (Get-Date).ToString("o")
Save
Write-Host "Automatic part finished. Continue the manual checklist in the desktop README, then close the sandbox."
