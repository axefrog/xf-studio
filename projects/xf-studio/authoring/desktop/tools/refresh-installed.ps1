# Keeps the installed XF Studio desktop app at parity with a checkout (normally `main`), without anyone's attention:
# builds the single setup from the checkout, then installs it silently over the per-user install, keeping the library, workspace
# and settings. Run after a merge:
#   powershell -NoProfile -File projects/xf-studio/authoring/desktop/tools/refresh-installed.ps1 [-Checkout <folder>] [-Log <file>]
#                                                                                                 [-HutchBinary <hutch.exe>] [-BuildOnly]
#
# - Build: frozen installs (authoring and desktop), the texture compressor, then `bun run build:installer` in desktop/ under
#   tools/memory_guard.py --limit 3. A commit already built (the log's last successful line, its setup still on disk) is not built again.
# - If the installed app is running (any process whose program is under %LOCALAPPDATA%\dev.axefrog.xf-studio\canary\app), nothing
#   is touched: the run logs `pending` and the next run installs the setup it already built.
# - Install: the single setup starts through Windows Management Instrumentation as `pythonw.exe` running a small script (no console
#   window, and not inside the Claude app's Store package, whose private AppData would swallow the install; desktop README, "Driving
#   an installed trial"). The script sets XFS_INSTALL_REFRESH=1, which makes the app that Electrobun's setup unconditionally opens at
#   its end exit at once (desktop README, "Keeping the installed app current"), and runs the setup /VERYSILENT.
# - Verify: the installed Resources\version.json names the built hash, Electrobun's uninstall entry exists, and nothing from the
#   setup's own process tree is left running (any that is gets stopped, by PID, and logged).
# - One line goes to the log: date, commit, build hash, outcome (installed | pending | failed: <reason>; `built` after -BuildOnly).
#   Exit code 0 unless it failed.
#
# It never uninstalls, never starts the app, never touches another XF identity or a disposable trial, and deletes what it created
# (the setup log and its two small helper files, in the log's folder) when it ends.
param(
  # The folder to build in: a git checkout with no uncommitted tracked changes. Default: the repository this script sits in.
  [string]$Checkout,
  # Default <repository>/local/desktop-refresh.log (ignored by git).
  [string]$Log,
  # A Hutch to use instead of the slow paired download (ELECTROBUN_HUTCH_BINARY; desktop README, "Build environment notes").
  [string]$HutchBinary,
  # Build and verify the setup, then stop; install nothing.
  [switch]$BuildOnly
)
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..\..")).Path
if (-not $Checkout) { $Checkout = $repoRoot }
if (-not $Log) { $Log = Join-Path $repoRoot "local\desktop-refresh.log" }
$Log = [IO.Path]::GetFullPath($Log)
$logDir = Split-Path $Log -Parent
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$setupLog = Join-Path $logDir "desktop-refresh-setup.log"
$helperScript = Join-Path $logDir "desktop-refresh-install.py"
$exitFile = Join-Path $logDir "desktop-refresh-install.exit"

$installRoot = Join-Path $env:LOCALAPPDATA "dev.axefrog.xf-studio\canary\app"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\dev.axefrog.xf-studio.canary"
$python = Join-Path $env:LOCALAPPDATA "Python\pythoncore-3.14-64\python.exe"
$pythonw = Join-Path $env:LOCALAPPDATA "Python\pythoncore-3.14-64\pythonw.exe"
$started = Get-Date
$commit = "-"
$buildHash = "-"

function Write-Line([string]$text) { Write-Host "XF Studio desktop refresh: $text" }

function Get-Snapshot { Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate, ExecutablePath, Name }

function Get-LastBuiltLine {
  if (-not (Test-Path -LiteralPath $Log)) { return $null }
  $lines = @(Get-Content -LiteralPath $Log)
  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    if ($lines[$i] -match "commit=(?<commit>[0-9a-f]{40}) build=(?<hash>[a-z0-9]+) (installed|pending|built)\b") { return $Matches }
    if ($lines[$i] -match "build=- failed|\bfailed\b") { return $null }
  }
  return $null
}

function Invoke-Refresh {
  if ($env:OS -ne "Windows_NT") { throw "this runs on Windows only" }
  $Checkout = (Resolve-Path -LiteralPath $Checkout).Path
  $head = (& git -C $Checkout rev-parse HEAD 2>$null)
  if ($LASTEXITCODE -ne 0 -or $head -notmatch "^[0-9a-f]{40}$") { throw "$Checkout is not a git checkout" }
  $script:commit = $head
  $dirty = @(& git -C $Checkout status --porcelain --untracked-files=no)
  if ($dirty.Count) { throw "the checkout has uncommitted tracked changes ($($dirty.Count) files), so the build wouldn't match the commit" }

  $authoring = Join-Path $Checkout "projects\xf-studio\authoring"
  $desktop = Join-Path $authoring "desktop"
  $setup = Join-Path $desktop "artifacts\canary-win-x64-XFStudio-Setup-canary.exe"
  $update = Join-Path $desktop "artifacts\canary-win-x64-update.json"
  if (-not (Select-String -LiteralPath (Join-Path $desktop "startup-watchdog.ts") -Pattern "XFS_INSTALL_REFRESH" -Quiet)) {
    throw "this commit's app has no XFS_INSTALL_REFRESH switch, so the setup's own launch of it would open a window"
  }
  if (-not (Test-Path -LiteralPath $python)) { throw "Python isn't at $python" }
  $bun = (Get-Command bun -ErrorAction Stop).Source

  # Already built for this commit (and the setup is still there)?
  $builtHash = $null
  $last = Get-LastBuiltLine
  if ($last -and $last.commit -eq $head -and (Test-Path -LiteralPath $setup) -and (Test-Path -LiteralPath $update) -and
      ((Get-Content -LiteralPath $update -Raw | ConvertFrom-Json).hash -eq $last.hash)) {
    $builtHash = $last.hash
    Write-Line "commit $($head.Substring(0, 8)) is already built (build $builtHash); not building again."
  } else {
    $savedHutch = $env:ELECTROBUN_HUTCH_BINARY
    $savedTrial = $env:XFS_DESKTOP_UI_TRIAL_SUFFIX
    $buildStart = Get-Date
    try {
      if ($HutchBinary) { $env:ELECTROBUN_HUTCH_BINARY = (Resolve-Path -LiteralPath $HutchBinary).Path }
      # A trial suffix in this environment would build a disposable identity, never the app being refreshed.
      Remove-Item Env:XFS_DESKTOP_UI_TRIAL_SUFFIX -ErrorAction SilentlyContinue
      Write-Line "building commit $($head.Substring(0, 8))..."
      Push-Location $authoring
      try {
        & $bun install --frozen-lockfile | Out-Host; if ($LASTEXITCODE -ne 0) { throw "bun install (authoring) exited $LASTEXITCODE" }
        & $bun install --frozen-lockfile --cwd $desktop | Out-Host; if ($LASTEXITCODE -ne 0) { throw "bun install (desktop) exited $LASTEXITCODE" }
        & $bun tools/build-native-bcn.ts | Out-Host; if ($LASTEXITCODE -ne 0) { throw "the texture compressor build exited $LASTEXITCODE" }
      } finally { Pop-Location }
      Push-Location $desktop
      try {
        & $python (Join-Path $Checkout "tools\memory_guard.py") --limit 3 -- $bun run build:installer | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "build:installer exited $LASTEXITCODE (99 means the memory guard stopped it)" }
      } finally { Pop-Location }
    } finally {
      if ($null -eq $savedHutch) { Remove-Item Env:ELECTROBUN_HUTCH_BINARY -ErrorAction SilentlyContinue } else { $env:ELECTROBUN_HUTCH_BINARY = $savedHutch }
      if ($null -ne $savedTrial) { $env:XFS_DESKTOP_UI_TRIAL_SUFFIX = $savedTrial }
    }
    if (-not (Test-Path -LiteralPath $setup) -or -not (Test-Path -LiteralPath $update)) { throw "the build finished without a setup program" }
    if ((Get-Item -LiteralPath $setup).LastWriteTime -lt $buildStart) { throw "the setup program on disk is older than this build" }
    $builtHash = (Get-Content -LiteralPath $update -Raw | ConvertFrom-Json).hash
    if ($builtHash -notmatch "^[a-z0-9]{8,64}$") { throw "the build's update metadata has no build hash" }
  }
  $script:buildHash = $builtHash
  if ($BuildOnly) { Write-Line "built build $builtHash in $([int]((Get-Date) - $started).TotalSeconds) s; -BuildOnly, so nothing was installed."; return "built" }

  # Already current: nothing to install.
  $installedVersion = Join-Path $installRoot "Resources\version.json"
  if ((Test-Path -LiteralPath $installedVersion) -and (Test-Path -LiteralPath $uninstallKey) -and
      ((Get-Content -LiteralPath $installedVersion -Raw | ConvertFrom-Json).hash -eq $builtHash)) {
    Write-Line "the installed app is already build $builtHash."
    return "installed"
  }

  # Never touch the app while it is open.
  $prefix = $installRoot.TrimEnd("\") + "\"
  $running = @(Get-Snapshot | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
  if ($running.Count) {
    Write-Line "XF Studio is open, so the new build $builtHash waits; the next run installs it without rebuilding."
    return "pending"
  }

  # Install through WMI as pythonw.exe (no console window; a process of no app package), setting the switch for the app that
  # Electrobun's setup opens when it finishes.
  $q = { param($s) $s | ConvertTo-Json }
  $py = @(
    "import os, subprocess",
    'os.environ["XFS_INSTALL_REFRESH"] = "1"',
    "code = subprocess.call([$(& $q $setup), `"/VERYSILENT`", `"/SUPPRESSMSGBOXES`", `"/NORESTART`", `"/LOG=$($setupLog.Replace('\', '\\'))`"],",
    "                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000)",
    "open($(& $q $exitFile), `"w`").write(str(code))",
    ""
  ) -join "`n"
  [IO.File]::WriteAllText($helperScript, $py, (New-Object Text.UTF8Encoding($false)))
  Remove-Item -LiteralPath $exitFile -ErrorAction SilentlyContinue
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "`"$pythonw`" `"$helperScript`""; CurrentDirectory = $logDir }
  if ($created.ReturnValue -ne 0 -or -not $created.ProcessId) { throw "WMI could not start the setup (return value $($created.ReturnValue))" }
  $rootPid = [int]$created.ProcessId
  Write-Line "installing build $builtHash..."

  # Follow the setup's process tree while it runs: Electrobun's setup, and the app it opens, are descendants whose parents may
  # be gone by the time anyone looks.
  $tree = @{}
  $deadline = (Get-Date).AddMinutes(3)
  $timedOut = $false
  while ($true) {
    $snapshot = @(Get-Snapshot)
    if ($tree.Count -eq 0) { $root = $snapshot | Where-Object ProcessId -eq $rootPid | Select-Object -First 1; if ($root) { $tree[$rootPid] = $root.CreationDate } }
    do {
      $added = $false
      foreach ($p in $snapshot) {
        if (-not $tree.ContainsKey([int]$p.ProcessId) -and $tree.ContainsKey([int]$p.ParentProcessId) -and $p.CreationDate -ge $tree[[int]$p.ParentProcessId]) {
          $tree[[int]$p.ProcessId] = $p.CreationDate; $added = $true
        }
      }
    } while ($added)
    $alive = @($snapshot | Where-Object { $tree.ContainsKey([int]$_.ProcessId) -and $tree[[int]$_.ProcessId] -eq $_.CreationDate })
    if (Test-Path -LiteralPath $exitFile) { break }
    if (-not ($alive | Where-Object ProcessId -eq $rootPid)) { break }
    if ((Get-Date) -gt $deadline) { $timedOut = $true; break }
    Start-Sleep -Milliseconds 400
  }
  # The refresh launch of the app ends at once; give it a few seconds, then stop whatever of the tree is still there.
  $grace = (Get-Date).AddSeconds(20)
  while (-not $timedOut -and (Get-Date) -lt $grace) {
    $snapshot = @(Get-Snapshot)
    if (-not @($snapshot | Where-Object { $tree.ContainsKey([int]$_.ProcessId) -and $tree[[int]$_.ProcessId] -eq $_.CreationDate }).Count) { break }
    Start-Sleep -Milliseconds 400
  }
  $left = @(Get-Snapshot | Where-Object { $tree.ContainsKey([int]$_.ProcessId) -and $tree[[int]$_.ProcessId] -eq $_.CreationDate })
  foreach ($p in $left) { Stop-Process -Id ([int]$p.ProcessId) -Force -ErrorAction SilentlyContinue }
  $stopped = if ($left.Count) { " Stopped $($left.Count) process(es) left from the setup's own tree: $(($left | ForEach-Object { "$($_.Name) $($_.ProcessId)" }) -join ', ')." } else { "" }
  if ($stopped) { Write-Line $stopped.Trim() }
  if ($timedOut) { throw "the setup did not finish within 3 minutes and was stopped (the next run retries).$stopped" }

  $code = if (Test-Path -LiteralPath $exitFile) { (Get-Content -LiteralPath $exitFile -Raw).Trim() } else { "none" }
  if ($code -ne "0") {
    if (Test-Path -LiteralPath $setupLog) { Get-Content -LiteralPath $setupLog -Tail 5 | ForEach-Object { Write-Host "  setup log: $_" } }
    throw "the setup exited with code $code$stopped"
  }
  $installed = if (Test-Path -LiteralPath $installedVersion) { (Get-Content -LiteralPath $installedVersion -Raw | ConvertFrom-Json).hash } else { $null }
  if ($installed -ne $builtHash) { throw "the installed version.json names build '$installed', not $builtHash$stopped" }
  if (-not (Test-Path -LiteralPath $uninstallKey)) { throw "Electrobun's uninstall entry is missing after the install$stopped" }
  Write-Line "installed build $builtHash in $([int]((Get-Date) - $started).TotalSeconds) s.$stopped"
  return "installed"
}

$mutex = New-Object System.Threading.Mutex($false, "Global\xfs-desktop-refresh-installed")
$owned = try { $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $true }  # a killed run left it: now ours
if (-not $owned) { Write-Line "another refresh is running; nothing to do."; exit 0 }
$outcome = $null
try { $outcome = @(Invoke-Refresh)[-1] }  # the last value; native output is sent to the host
catch { $outcome = "failed: " + (($_.Exception.Message -replace "\s+", " ").Trim()); Write-Line $outcome }
finally {
  foreach ($file in @($setupLog, $helperScript, $exitFile)) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue } }
  $mutex.ReleaseMutex()
}
$stamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
Add-Content -LiteralPath $Log -Value "$stamp commit=$commit build=$buildHash $outcome"
exit $(if ($outcome -like "failed*") { 1 } else { 0 })
