# Runs inside Windows Sandbox (see sandbox-trial.ts), unattended. Records the environment,
# checks the single setup program against its checksum, installs it, launches the installed app with
# no preview assets and walks a first-time user's session through Windows UI Automation
# (sandbox-ui.ps1): WebView2 consent if needed, welcome, UV editor, edit and Undo, library save,
# fixture import and Check, About and Licences, close and relaunch, then uninstall. It records
# WebView2 presence, the loopback server, the app's desktop.log and app-window screenshots in the
# mapped results folder; with -AutoClose the sandbox shuts itself down when done.
param([switch]$AutoClose)
$ErrorActionPreference = "Continue"
$in = Join-Path $env:USERPROFILE "Desktop\xfs-input"
$out = Join-Path $env:USERPROFILE "Desktop\xfs-results"
$hostWebView = Join-Path $env:USERPROFILE "Desktop\xfs-webview2"
$report = [ordered]@{ schema = "xfs/desktop-sandbox-first-run-3"; started = (Get-Date).ToString("o") }
function Save { $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $out "report.json") }
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class XfsWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
# Screenshots capture one window at a fixed size, never the whole (possibly huge) desktop.
function ShotWindow([IntPtr]$hwnd, [string]$name) {
  if ($hwnd -eq [IntPtr]::Zero) { $hwnd = [XfsWin]::GetForegroundWindow() }
  $r = New-Object XfsWin+RECT
  if (-not [XfsWin]::GetWindowRect($hwnd, [ref]$r)) { return }
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  if ($w -le 0 -or $h -le 0) { return }
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $out "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
}
function AppWindow {
  $app = Get-Process bun -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq "XF Studio" } | Select-Object -First 1
  if ($app) { [void][XfsWin]::SetWindowPos($app.MainWindowHandle, [IntPtr]::Zero, 40, 40, 1280, 800, 0x0040); Start-Sleep -Milliseconds 800 }
  return $app
}
function Shot([string]$name) {
  # Always the XF Studio window itself (in-page dialogs included), sized by AppWindow.
  $app = AppWindow
  if ($app) { [void]$shell.AppActivate($app.Id); Start-Sleep -Milliseconds 400; ShotWindow $app.MainWindowHandle $name }
}
function Pv([string]$key) { try { (Get-ItemProperty -Path $key -ErrorAction Stop).pv } catch { $null } }
# Evaluate one expression in the first WebView2 page through the remote-debugging port.
function PageState([int]$port, [string]$expression) {
  try {
    $targets = Invoke-RestMethod "http://127.0.0.1:$port/json/list" -TimeoutSec 5
    $page = @($targets | Where-Object { $_.type -eq "page" })[0]
    if (-not $page) { return @{ targets = @($targets | ForEach-Object { $_.type + " " + $_.url }) } }
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait(5000) | Out-Null
    $message = @{ id = 1; method = "Runtime.evaluate"; params = @{ expression = $expression; returnByValue = $true } } | ConvertTo-Json -Depth 5 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($message)
    $ws.SendAsync([ArraySegment[byte]]$bytes, "Text", $true, [Threading.CancellationToken]::None).Wait(5000) | Out-Null
    $buffer = New-Object byte[] 1048576; $text = ""
    do {
      $result = $ws.ReceiveAsync([ArraySegment[byte]]$buffer, [Threading.CancellationToken]::None)
      if (-not $result.Wait(10000)) { break }
      $text += [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Result.Count)
    } while (-not $result.Result.EndOfMessage)
    $ws.Dispose()
    return @{ url = $page.url; value = ($text | ConvertFrom-Json).result.result.value }
  } catch { return @{ error = $_.Exception.Message } }
}
$state = "JSON.stringify({ ready: document.readyState, mounted: !!document.querySelector('#studio.studio-ready'), " +
  "welcome: !!document.querySelector('#desktop-welcome')?.open, failed: document.querySelector('.boot-failed')?.innerText ?? null, " +
  "head: window.xfStudioPresentation ? null : document.querySelector('.viewport-state')?.innerText?.slice(0, 200) ?? null, " +
  "text: document.body?.innerText?.slice(0, 300) ?? null })"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$report.os = (Get-CimInstance Win32_OperatingSystem).Caption + " " + [Environment]::OSVersion.Version
$report.elevated = (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$client = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
$report.webview2 = [ordered]@{
  hklmWow64 = Pv "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$client"
  hklm = Pv "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$client"
  hkcu = Pv "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$client"
  programFilesRuntime = @(Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application" -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
  hostRuntimeMapped = Test-Path (Join-Path $hostWebView "msedgewebview2.exe")
}
# Mode C (--install-webview2, networking on): install Microsoft's Evergreen WebView2 Runtime
# with its official bootstrapper, exactly as a user without it would.
if (Test-Path (Join-Path $in "install-webview2.txt")) {
  $bootstrapper = Join-Path $env:TEMP "MicrosoftEdgeWebview2Setup.exe"
  try {
    Invoke-WebRequest "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $bootstrapper -UseBasicParsing -TimeoutSec 120
    $sig = Get-AuthenticodeSignature $bootstrapper
    $report.webview2.bootstrapperSigner = $sig.SignerCertificate.Subject
    if ($sig.Status -eq "Valid" -and $sig.SignerCertificate.Subject -like "*O=Microsoft Corporation*") {
      $p = Start-Process $bootstrapper -ArgumentList "/silent", "/install" -PassThru; [void]$p.WaitForExit(600000)
      $report.webview2.installedByTrial = Pv "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$client"
    } else { $report.webview2.bootstrapperRefused = "$($sig.Status)" }
  } catch { $report.webview2.bootstrapperError = $_.Exception.Message }
}
# Mode D (--webview2-installer=<file>, networking off): Microsoft's signed Evergreen Standalone
# Installer, downloaded beforehand, installs the runtime offline before the app starts.
$standalone = Join-Path $in "webview2-standalone-installer.exe"
if (Test-Path $standalone) {
  $sig = Get-AuthenticodeSignature $standalone
  $report.webview2.standaloneSigner = $sig.SignerCertificate.Subject
  if ($sig.Status -eq "Valid" -and $sig.SignerCertificate.Subject -like "*O=Microsoft Corporation*") {
    $p = Start-Process $standalone -ArgumentList "/silent", "/install" -PassThru; [void]$p.WaitForExit(900000)
    $report.webview2.standaloneExit = $p.ExitCode
    $report.webview2.installedByTrial = Pv "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$client"
  } else { $report.webview2.standaloneRefused = "$($sig.Status)" }
}
# Mode B (--host-webview2): a host WebView2 runtime copied in as a fixed-version runtime.
# Under Electrobun 2.0.1 this did not start WebView2 (25 September); kept for diagnosis.
# A fixed-version runtime must live on a local drive, so copy the mapped folder first.
if ($report.webview2.hostRuntimeMapped) {
  $local = Join-Path $env:LOCALAPPDATA "xfs-webview2-fixed"
  robocopy $hostWebView $local /E /NFL /NDL /NJH /NJS /NP | Out-Null
  $report.webview2.localCopy = Test-Path (Join-Path $local "msedgewebview2.exe")
  # Microsoft's fixed-version guidance: the sandboxed renderer needs read/execute for
  # ALL APPLICATION PACKAGES and ALL RESTRICTED APPLICATION PACKAGES.
  icacls $local /grant "*S-1-15-2-1:(OI)(CI)(RX)" /grant "*S-1-15-2-2:(OI)(CI)(RX)" /T /Q | Out-Null
  $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = $local
}
$report.bunOnPath = [bool](Get-Command bun -ErrorAction SilentlyContinue)

$expected, $setupName = (Get-Content (Join-Path $in "SHA256SUMS.txt") -TotalCount 1) -split "\s+", 2
$download = Get-Item -LiteralPath (Join-Path $in $setupName)
$report.setup = $download.Name
$report.checksumMatches = (Get-FileHash $download.FullName -Algorithm SHA256).Hash.ToLower() -eq $expected
# Run the single downloaded setup program from Downloads, as a user would: nothing to extract.
$downloads = Join-Path $env:USERPROFILE "Downloads"
New-Item -ItemType Directory -Force $downloads | Out-Null
$setup = Copy-Item $download.FullName $downloads -PassThru
Save

# The single setup (Inno Setup) shows one Ready page; Install is its default button. It then
# hides itself and runs Electrobun 2.0.1's own setup, which has no install-time quiet flag (its
# --quiet applies to uninstall), so dismiss that setup's final "Installation complete" window once
# the launcher exists. The report records each step and both exit codes.
$t = Get-Date
$proc = Start-Process $setup.FullName -PassThru
$shell = New-Object -ComObject WScript.Shell
$report.readyPageShown = $false
$end = (Get-Date).AddSeconds(60)
while (-not $proc.HasExited -and (Get-Date) -lt $end) {
  Start-Sleep -Seconds 2
  # Inno Setup's loader starts the wizard as a separate process from its temporary folder.
  $wizard = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "Setup - XF Studio*" } | Select-Object -First 1
  if ($wizard) {
    Start-Sleep -Seconds 2
    $report.readyPageTitle = $wizard.MainWindowTitle
    $report.wizardProcess = $wizard.ProcessName
    ShotWindow $wizard.MainWindowHandle "installer-ready"
    [void]$shell.AppActivate($wizard.Id); Start-Sleep -Milliseconds 500; $shell.SendKeys("{ENTER}")
    $report.readyPageShown = $true
    break
  }
}
Save
$report.installerDismissed = $false
$inner = $null
while (-not $proc.HasExited -and ((Get-Date) - $t).TotalSeconds -lt 600) {
  Start-Sleep -Seconds 5
  $installed = Get-ChildItem $env:LOCALAPPDATA -Directory -Filter "dev.axefrog.xf-studio*" -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ChildItem $_.FullName -Recurse -Filter launcher.exe -ErrorAction SilentlyContinue } | Select-Object -First 1
  if (-not $inner) { $inner = Get-Process -Name "XF Studio-Setup-*" -ErrorAction SilentlyContinue | Select-Object -First 1 }
  if ($inner) {
    $report.electrobunSetupSeenIn = $inner.Path
    $inner.Refresh()
    if ($installed -and -not $inner.HasExited -and $inner.MainWindowHandle -ne 0) {
      Start-Sleep -Seconds 5
      if ($inner.HasExited) { continue }
      ShotWindow $inner.MainWindowHandle "installer-final"
      [void]$shell.AppActivate($inner.Id); Start-Sleep -Milliseconds 500; $shell.SendKeys("{ENTER}")
      Start-Sleep -Seconds 3
      if (-not $inner.HasExited) { [void]$inner.CloseMainWindow() }
      $report.installerDismissed = $true
      [void]$inner.WaitForExit(30000)
      if ($inner.HasExited) { $report.electrobunSetup = "exit $($inner.ExitCode)" }
      [void]$proc.WaitForExit(30000)
    }
  }
}
if (-not $proc.HasExited) { $report.installer = "still running after 10 minutes" } else { $report.installer = "exit $($proc.ExitCode)" }
# Inno Setup removes its temporary folder (and Electrobun's setup inside it) when it exits.
$report.tempSetupLeft = @(Get-ChildItem $env:TEMP -Directory -Filter "is-*.tmp" -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
$report.installSeconds = [int]((Get-Date) - $t).TotalSeconds
$roots = Get-ChildItem $env:LOCALAPPDATA -Directory -Filter "dev.axefrog.xf-studio*" -ErrorAction SilentlyContinue
$report.installRoots = @($roots | ForEach-Object { $_.Name })
$launcher = $roots | ForEach-Object { Get-ChildItem $_.FullName -Recurse -Filter launcher.exe -ErrorAction SilentlyContinue } | Select-Object -First 1
$report.launcherFound = [bool]$launcher
$version = $roots | ForEach-Object { Get-ChildItem $_.FullName -Recurse -Filter version.json -ErrorAction SilentlyContinue } | Select-Object -First 1
if ($version) { $report.packagedVersion = Get-Content $version.FullName -Raw | ConvertFrom-Json }
Save

if ($launcher) {
  $fixture = Join-Path $in "fixture-collection.json"
  . (Join-Path $in "sandbox-ui.ps1")
  function StopApp { Get-Process bun, launcher -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
  function StartApp {
    Start-Process $launcher.FullName -WorkingDirectory $launcher.DirectoryName | Out-Null
  }
  function WaitAppWindow([int]$seconds) {
    $end = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $end) {
      $w = Get-Process bun -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq "XF Studio" } | Select-Object -First 1
      if ($w) { return $w }
      Start-Sleep -Seconds 1
    }
  }
  # The installer's Close starts the app itself; restart it so the trial controls exactly one instance.
  Start-Sleep -Seconds 3; StopApp
  StartApp
  $window = WaitAppWindow 30
  Start-Sleep -Seconds 4
  $report.webview2BeforeApp = [bool](Pv "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$client") -or [bool](Pv "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$client")
  if (-not $report.webview2BeforeApp -and $window) {
    # Expect XF Studio's own consent prompt; accept it with its default button, the one click a user makes.
    [void]$shell.AppActivate($window.Id); Start-Sleep -Milliseconds 800
    ShotWindow ([IntPtr]::Zero) "00-webview2-consent"
    $report.consentText = (Get-Process -Id $window.Id).MainWindowTitle
    $shell.SendKeys("{ENTER}")
    $report.consentClicked = (Get-Date).ToString("o")
    Save
    Start-Sleep -Seconds 20
    ShotWindow ([IntPtr]::Zero) "00-webview2-installing"
    $end = (Get-Date).AddMinutes(10)
    while ((Get-Date) -lt $end -and -not (Get-Process msedgewebview2 -ErrorAction SilentlyContinue)) { Start-Sleep -Seconds 3 }
    $report.webview2InstallSeconds = [int]((Get-Date) - [datetime]$report.consentClicked).TotalSeconds
  }
  $report.webview2After = [ordered]@{
    hklmWow64 = Pv "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$client"
    hkcu = Pv "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$client"
    processes = @(Get-Process msedgewebview2 -ErrorAction SilentlyContinue).Count }
  Save
  if ($report.webview2After.processes -gt 0) {
    Start-Sleep -Seconds 5
    [void](AppWindow)
    UiFirstRun
    ShotWindow ((AppWindow).MainWindowHandle) "09-app-window"
    # Close normally (the save handshake runs), then relaunch: no welcome, same collection.
    $app = AppWindow
    if ($app) {
      [void]$shell.AppActivate($app.Id); $shell.SendKeys("{ESC}"); Start-Sleep -Milliseconds 500   # close any open dialog first
      [void]$app.CloseMainWindow(); $gone = $app.WaitForExit(20000); $report.closedCleanly = $gone
      if (-not $gone) { ShotWindow $app.MainWindowHandle "close-blocked" }
    }
    StopApp
    StartApp
    [void](WaitAppWindow 30); Start-Sleep -Seconds 6; [void](AppWindow)
    UiRelaunch
    $app = AppWindow
    if ($app) { [void]$app.CloseMainWindow(); [void]$app.WaitForExit(20000) }
  } else {
    Shot "no-webview2"
  }
  StopApp
  $dataRoot = Join-Path $env:LOCALAPPDATA "dev.axefrog.xf-studio\canary"
  $log = Join-Path $dataRoot "desktop.log"
  if (Test-Path $log) { Copy-Item $log (Join-Path $out "desktop.log") }
  $report.dataRootBeforeUninstall = @(Get-ChildItem $dataRoot -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
  # Default App uninstall: removes the app, keeps the library and settings.
  $uninstaller = Join-Path $dataRoot "uninstall.exe"
  if (Test-Path $uninstaller) {
    $u = Start-Process $uninstaller -ArgumentList "--quiet" -PassThru; [void]$u.WaitForExit(120000)
    Start-Sleep -Seconds 5
    $report.uninstall = [ordered]@{ exit = $u.ExitCode
      launcherRemains = [bool](Get-ChildItem $dataRoot -Recurse -Filter launcher.exe -ErrorAction SilentlyContinue)
      kept = @(Get-ChildItem $dataRoot -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) }
  } else { $report.uninstall = "uninstall.exe not found" }
}
$report.finished = (Get-Date).ToString("o")
Save
Write-Host "Finished. report.json, desktop.log and screenshots are in the results folder."
if ($AutoClose) { Start-Sleep -Seconds 3; Stop-Computer -Force }
