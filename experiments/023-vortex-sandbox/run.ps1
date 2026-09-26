# Runs inside Windows Sandbox (see kit.ts), unattended. Installs Vortex quietly, turns its nxm://
# association off before its first start, builds a synthetic Cyberpunk 2077 folder (a dummy executable and
# the archive folders), seeds a managed game and profile through Vortex's own --set command, installs the
# Cyberpunk extension from the kit, then installs three small test mods with --install-archive and records
# what Vortex deployed: the game folder (with hard-link counts), the deployment manifest, the staging folder,
# the state database (read while Vortex runs, then with --get after it closes) and the nxm registration.
# Nothing here touches the host; the sandbox is discarded when it closes.
param([switch]$AutoClose)
$ErrorActionPreference = "Continue"
$in = Join-Path $env:USERPROFILE "Desktop\xfs-input"
$out = Join-Path $env:USERPROFILE "Desktop\xfs-results"
$report = [ordered]@{ schema = "xfs/vortex-sandbox-run-1"; started = (Get-Date).ToString("o"); steps = [ordered]@{} }
function Save { $report | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $out "report.json") }
function Step([string]$name, $value) { $report.steps[$name] = $value; Save }
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class XfsWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
}
"@
function Shot([string]$name) {
  $p = Get-Process Vortex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { return }
  [void][XfsWin]::SetWindowPos($p.MainWindowHandle, [IntPtr]::Zero, 20, 20, 1400, 900, 0x0040); Start-Sleep -Milliseconds 800
  $r = New-Object XfsWin+RECT; [void][XfsWin]::GetWindowRect($p.MainWindowHandle, [ref]$r)
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top; if ($w -le 0 -or $h -le 0) { return }
  $bmp = New-Object System.Drawing.Bitmap $w, $h; $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size); $bmp.Save((Join-Path $out "$name.png")); $g.Dispose(); $bmp.Dispose()
}
function Nxm { try { (Get-ItemProperty "HKCU:\Software\Classes\nxm\shell\open\command" -ErrorAction Stop)."(default)" } catch { $null } }

$report.os = (Get-CimInstance Win32_OperatingSystem).Caption + " " + [Environment]::OSVersion.Version
$report.nxmBefore = Nxm
$setup = Join-Path $env:USERPROFILE "Desktop\xfs-vortex\vortex-setup-2.7.1.exe"
$report.setupHash = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
Save

# 1. Quiet install (electron-builder NSIS, per machine).
$t = Get-Date
$p = Start-Process $setup -ArgumentList "/S" -PassThru; [void]$p.WaitForExit(900000)
$exe = @("$env:ProgramFiles\Black Tree Gaming Ltd\Vortex\Vortex.exe") + @(Get-ChildItem "$env:ProgramFiles", "$env:LOCALAPPDATA\Programs" -Recurse -Filter Vortex.exe -ErrorAction SilentlyContinue -Depth 3 | ForEach-Object FullName) |
  Where-Object { Test-Path $_ } | Select-Object -First 1
Step "install" @{ exitCode = $p.ExitCode; seconds = [int]((Get-Date) - $t).TotalSeconds; exe = $exe; nxmAfterInstall = (Nxm) }
if (-not $exe) { if ($AutoClose) { shutdown /s /t 5 }; exit 1 }
$uninstall = Get-ChildItem "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue |
  Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).DisplayName -like "Vortex*" } |
  ForEach-Object { $v = Get-ItemProperty $_.PSPath; [ordered]@{ key = $_.Name; DisplayName = $v.DisplayName; DisplayVersion = $v.DisplayVersion; InstallLocation = $v.InstallLocation; Publisher = $v.Publisher } }
Step "uninstallKey" $uninstall

# 2. A synthetic game folder: the executable Vortex's Cyberpunk extension requires, plus the archive folders.
$game = "C:\Games\Cyberpunk 2077"
New-Item -ItemType Directory -Force "$game\bin\x64", "$game\archive\pc\content", "$game\archive\pc\mod", "$game\r6\scripts" | Out-Null
Set-Content -Encoding ascii "$game\bin\x64\Cyberpunk2077.exe" "not a game"
Set-Content -Encoding ascii "$game\archive\pc\content\basegame_1_engine.archive" "fixture base archive"
# Files placed by hand before Vortex manages the game: one Vortex never deploys, one a test mod also ships.
Set-Content -Encoding ascii "$game\archive\pc\mod\Hand Installed.archive" "unmanaged"
Set-Content -Encoding ascii "$game\archive\pc\mod\Preexisting.archive" "unmanaged original"

# 3. Seed Vortex state with its own --set command (values are JSON literals), before its first start.
$prof = "xfstest"
$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$gameJson = ($game -replace '\\', '\\')
$sets = @(
  'settings.nexus.associateNXM=false',
  "settings.gameMode.discovered.cyberpunk2077.path=`"$gameJson`"",
  'settings.gameMode.discovered.cyberpunk2077.pathSetManually=true',
  "persistent.profiles.$prof.id=`"$prof`"",
  "persistent.profiles.$prof.gameId=`"cyberpunk2077`"",
  "persistent.profiles.$prof.name=`"XF test profile`"",
  "persistent.profiles.$prof.modState={}",
  "persistent.profiles.$prof.lastActivated=$now",
  "settings.profiles.activeProfileId=`"$prof`"",
  "settings.profiles.lastActiveProfile.cyberpunk2077=`"$prof`"",
  'settings.mods.activator.cyberpunk2077="hardlink_activator"'
)
$setResults = @()
foreach ($s in $sets) {
  $arg = '--set "' + ($s -replace '"', '\"') + '"'
  $o = Join-Path $env:TEMP "set.txt"
  $sp = Start-Process $exe -ArgumentList $arg -PassThru -RedirectStandardOutput $o -RedirectStandardError "$o.err"; [void]$sp.WaitForExit(60000)
  $setResults += [ordered]@{ set = $s; exit = $sp.ExitCode; out = (Get-Content $o -Raw -ErrorAction SilentlyContinue); err = (Get-Content "$o.err" -Raw -ErrorAction SilentlyContinue) }
}
Step "seed" $setResults

# 4. The Cyberpunk extension from the kit (its official GitHub release, extracted on the host).
$plugins = Join-Path $env:APPDATA "Vortex\plugins\cyberpunk2077"
New-Item -ItemType Directory -Force $plugins | Out-Null
Copy-Item (Join-Path $in "cyberpunk2077-ext\*") $plugins -Recurse -Force
Step "extension" @(Get-ChildItem $plugins | ForEach-Object Name)

# 5. Three test mods, zipped here. B and A both ship "XF Test Shared.archive"; B also ships Preexisting.archive.
$mods = Join-Path $env:TEMP "xfs-mods"
function Mod([string]$name, [hashtable]$files) {
  $dir = Join-Path $mods $name
  foreach ($k in $files.Keys) { $f = Join-Path $dir $k; New-Item -ItemType Directory -Force (Split-Path $f) | Out-Null; Set-Content -Encoding ascii $f $files[$k] }
  $zip = Join-Path $mods "$name.zip"; Compress-Archive -Path (Join-Path $dir "*") -DestinationPath $zip -Force; return $zip
}
$zipA = Mod "XF Test Mod A" @{ "archive\pc\mod\xf_test_a.archive" = "A"; "archive\pc\mod\xf_test_a.archive.xl" = "resource: {}"; "archive\pc\mod\XF Test Shared.archive" = "shared from A" }
$zipB = Mod "XF Test Mod B-9001-1-0-1727000000" @{ "archive\pc\mod\xf_test_b.archive" = "B"; "archive\pc\mod\XF Test Shared.archive" = "shared from B"; "archive\pc\mod\Preexisting.archive" = "from B" }
$zipD = Mod "XF Test Mod D" @{ "archive\pc\mod\xf_test_d.archive" = "D" }

# 6. Start Vortex on the seeded game and profile, then install A and B through the running instance.
$t = Get-Date
Start-Process $exe -ArgumentList "--game cyberpunk2077 --profile $prof" | Out-Null
Start-Sleep -Seconds 90
Shot "01-started"
Step "started" @{ seconds = [int]((Get-Date) - $t).TotalSeconds; running = [bool](Get-Process Vortex -ErrorAction SilentlyContinue); nxm = (Nxm) }
foreach ($zip in @($zipA, $zipB)) {
  Start-Process $exe -ArgumentList "--install-archive `"$zip`"" | Out-Null
  Start-Sleep -Seconds 45
}
Shot "02-installed-a-b"

function Tree {
  Get-ChildItem $game -Recurse -Force -File | ForEach-Object {
    $links = @(fsutil hardlink list $_.FullName 2>$null)
    [ordered]@{ path = $_.FullName.Substring($game.Length + 1); size = $_.Length; mtime = $_.LastWriteTimeUtc.ToString("o");
      linkType = $_.LinkType; hardLinks = $links.Count; content = $(if ($_.Length -lt 200) { (Get-Content $_.FullName -Raw) } else { $null }) }
  }
}
function Manifests([string]$tag) {
  Get-ChildItem $game -Recurse -Force -Filter "vortex.deployment*" | ForEach-Object {
    $rel = $_.FullName.Substring($game.Length + 1) -replace '\\', '_'
    Copy-Item $_.FullName (Join-Path $out "$tag-$rel") }
}
Step "afterAB" @{ tree = @(Tree) }
Manifests "after-ab"

# 7. XF Studio's case: a file dropped into archive/pc/mod outside Vortex, then another Vortex deployment.
Set-Content -Encoding ascii "$game\archive\pc\mod\XF Eye Artistry.archive" "dropped by another tool"
Start-Process $exe -ArgumentList "--install-archive `"$zipD`"" | Out-Null
Start-Sleep -Seconds 45
Shot "03-installed-d"
Step "afterD" @{ tree = @(Tree) }
Manifests "after-d"

# 8. The staging folder and the state database while Vortex runs (can another process read it?).
$appData = Join-Path $env:APPDATA "Vortex"
$staging = Join-Path $appData "cyberpunk2077\mods"
Step "staging" @{ path = $staging; entries = @(Get-ChildItem $staging -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Substring($staging.Length + 1) }) ;
  marker = (Get-Content (Join-Path $staging "__vortex_staging_folder") -Raw -ErrorAction SilentlyContinue) }
Copy-Item (Join-Path $staging "vortex.deployment*.msgpack") $out -ErrorAction SilentlyContinue
$db = Join-Path $appData "state.v2"
$live = @(Get-ChildItem $db -Force -ErrorAction SilentlyContinue | ForEach-Object {
  $r = [ordered]@{ name = $_.Name; size = $_.Length }
  try { $fs = [IO.File]::Open($_.FullName, "Open", "Read", "ReadWrite"); $r.readShared = $true; $fs.Close() } catch { $r.readShared = $(if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }) }
  $r })
$liveCopy = Join-Path $out "state.v2-live-copy"
New-Item -ItemType Directory -Force $liveCopy | Out-Null
foreach ($f in Get-ChildItem $db -Force -File -ErrorAction SilentlyContinue) { try { Copy-Item $f.FullName $liveCopy -ErrorAction Stop } catch { } }
Step "stateWhileRunning" @{ files = $live; copied = @(Get-ChildItem $liveCopy | ForEach-Object Name) }

# 9. Close Vortex, then read the state with its own --get and copy the closed database.
Get-Process Vortex -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }
Start-Sleep -Seconds 20
Get-Process Vortex -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 5
$gets = @()
foreach ($path in @("persistent.mods.cyberpunk2077", "persistent.profiles", "settings.profiles", "settings.mods", "settings.nexus.associateNXM", "settings.gameMode.discovered.cyberpunk2077", "app.instanceId")) {
  $o = Join-Path $env:TEMP "get.txt"
  $gp = Start-Process $exe -ArgumentList "--get $path" -PassThru -RedirectStandardOutput $o -RedirectStandardError "$o.err"; [void]$gp.WaitForExit(60000)
  $gets += [ordered]@{ get = $path; out = (Get-Content $o -Raw -ErrorAction SilentlyContinue); err = (Get-Content "$o.err" -Raw -ErrorAction SilentlyContinue) }
}
Step "stateAfterClose" $gets
Copy-Item $db (Join-Path $out "state.v2-closed") -Recurse -Force
Copy-Item (Join-Path $appData "vortex.log") $out -ErrorAction SilentlyContinue
Copy-Item (Join-Path $appData "temp\state_backups_full") (Join-Path $out "state_backups_full") -Recurse -ErrorAction SilentlyContinue
$report.nxmAfter = Nxm
$report.finished = (Get-Date).ToString("o")
Save
if ($AutoClose) { shutdown /s /t 5 }
