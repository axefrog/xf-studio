# Keeps the installed XF Studio desktop app at parity with a checkout (normally `main`), without anyone's attention:
# builds the single setup from the checkout, then installs it silently over the per-user install, keeping the library, workspace
# and settings. Run after a merge:
#   powershell -NoProfile -File projects/xf-studio/authoring/desktop/tools/refresh-installed.ps1 [-Checkout <folder>] [-Log <file>]
#                                                                                                 [-HutchBinary <hutch.exe>] [-BuildOnly]
#
# - Build: frozen installs (authoring and desktop), the texture compressor, then `bun run build:installer` in desktop/ under
#   tools/memory_guard.py --limit 3. A commit already built (the log's last line, its setup still on disk) is not built again.
# - Install: everything that touches the installed app is done by ONE unpackaged helper, tools/refresh-helper.py, started through
#   Windows Management Instrumentation as `pythonw.exe` (no console window, and outside the Claude app's Store package, whose private
#   AppData would swallow an install and hide the real %LOCALAPPDATA%). This script reads nothing of the installed state. The helper:
#   takes the app's own single-instance mutex (named by tools/installed-instance-name.ts from single-instance.ts) and, when XF Studio
#   is running and so holds it, stops with `pending` and touches nothing, the next run installing the setup already built; otherwise
#   it holds the lock while it runs the setup /VERYSILENT with XFS_INSTALL_REFRESH=1 (which makes the app that Electrobun's setup
#   opens at its end exit at once; desktop README, "Keeping the installed app current") inside a kill-on-close Job Object, waits for
#   it, and checks the install is complete (every file of the built update archive, the build hash, the launcher, the uninstall entry).
# - One line goes to the log: date, commit, build hash, outcome (installed | pending | failed: <reason>; `built` after -BuildOnly).
#   A failed install is retried in full by the next run; only a logged `installed` for this build lets the helper skip the setup, and
#   then only when it finds the install complete. Exit code 0 unless it failed.
#
# It never uninstalls, never starts the app, never touches another XF identity or a disposable trial, and deletes what it created
# (the helper's config, result and the setup's log, in the log's folder) when it ends.
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
$configFile = Join-Path $logDir "desktop-refresh-helper.json"
$resultFile = Join-Path $logDir "desktop-refresh-helper-result.json"
$helper = Join-Path $PSScriptRoot "refresh-helper.py"

$python = Join-Path $env:LOCALAPPDATA "Python\pythoncore-3.14-64\python.exe"
$pythonw = Join-Path $env:LOCALAPPDATA "Python\pythoncore-3.14-64\pythonw.exe"
$setupSeconds = 300
$started = Get-Date
$commit = "-"
$buildHash = "-"

function Write-Line([string]$text) { Write-Host "XF Studio desktop refresh: $text" }

# The log's lines, oldest first, as { Commit; Hash; Outcome }.
function Read-Log {
  if (-not (Test-Path -LiteralPath $Log)) { return @() }
  @(Get-Content -LiteralPath $Log | ForEach-Object {
    if ($_ -match "commit=(?<commit>[0-9a-f]{40}) build=(?<hash>\S+) (?<outcome>installed|pending|built|failed)\b") {
      [pscustomobject]@{ Commit = $Matches.commit; Hash = $Matches.hash; Outcome = $Matches.outcome }
    }
  })
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
  foreach ($tool in @($python, $pythonw, $helper)) { if (-not (Test-Path -LiteralPath $tool)) { throw "$tool is missing" } }
  $bun = (Get-Command bun -ErrorAction Stop).Source

  # Already built for this commit (and the setup is still there)?
  $records = @(Read-Log)
  $last = if ($records.Count) { $records[-1] } else { $null }
  if ($last -and $last.Commit -eq $head -and $last.Outcome -ne "failed" -and (Test-Path -LiteralPath $setup) -and (Test-Path -LiteralPath $update) -and
      ((Get-Content -LiteralPath $update -Raw | ConvertFrom-Json).hash -eq $last.Hash)) {
    Write-Line "commit $($head.Substring(0, 8)) is already built (build $($last.Hash)); not building again."
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
  }
  $built = Get-Content -LiteralPath $update -Raw | ConvertFrom-Json
  if ($built.hash -notmatch "^[a-z0-9]{8,64}$") { throw "the build's update metadata has no build hash" }
  $script:buildHash = $built.hash
  if ($BuildOnly) { Write-Line "built build $($built.hash) in $([int]((Get-Date) - $started).TotalSeconds) s; -BuildOnly, so nothing was installed."; return "built" }

  # The install, by the one helper. The mutex name comes from the app's own single-instance code.
  $instanceLock = (& $bun (Join-Path $desktop "tools\installed-instance-name.ts") $env:LOCALAPPDATA $built.identifier $built.channel)
  if ($LASTEXITCODE -ne 0 -or $instanceLock -notmatch '^Local\\XFStudio-[0-9a-f]{40}$') { throw "couldn't name the app's instance lock" }
  $forThisBuild = @($records | Where-Object { $_.Hash -eq $built.hash })
  $config = [ordered]@{
    mutex = $instanceLock
    localAppData = $env:LOCALAPPDATA
    appDir = Join-Path $env:LOCALAPPDATA "$($built.identifier)\$($built.channel)\app"
    hash = $built.hash
    uninstallKey = "Software\Microsoft\Windows\CurrentVersion\Uninstall\$($built.identifier).$($built.channel)"
    archive = Join-Path (Split-Path $update -Parent) $built.artifact.file
    setup = @($setup, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/LOG=$setupLog")
    timeoutSec = $setupSeconds
    skipIfCurrent = [bool]($forThisBuild.Count -and $forThisBuild[-1].Outcome -eq "installed")
    result = $resultFile
  }
  [IO.File]::WriteAllText($configFile, ($config | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
  Remove-Item -LiteralPath $resultFile -ErrorAction SilentlyContinue
  $launchedAt = Get-Date
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "`"$pythonw`" `"$helper`" `"$configFile`""; CurrentDirectory = $logDir }
  if ($created.ReturnValue -ne 0 -or -not $created.ProcessId) { throw "WMI could not start the helper (return value $($created.ReturnValue))" }
  # Hold a handle to the helper from here on: it is waited on and stopped only through that handle, never by PID later (a PID can be
  # reused). A process of that PID that isn't a pythonw started just now is not the helper (it is already gone); it is let go untouched.
  $helperProcess = Get-Process -Id ([int]$created.ProcessId) -ErrorAction SilentlyContinue
  if ($helperProcess) {
    $null = $helperProcess.Handle
    if ($helperProcess.ProcessName -ne "pythonw" -or $helperProcess.StartTime -lt $launchedAt.AddSeconds(-2)) { $helperProcess.Dispose(); $helperProcess = $null }
  }
  Write-Line "installing build $($built.hash)..."

  $deadline = $launchedAt.AddSeconds($setupSeconds + 60)
  try {
    while (-not (Test-Path -LiteralPath $resultFile)) {
      if (-not $helperProcess -or $helperProcess.HasExited) {
        Start-Sleep -Milliseconds 300
        if (Test-Path -LiteralPath $resultFile) { break }
        throw "the helper ended without a result"
      }
      if ((Get-Date) -gt $deadline) { throw "the helper did not finish within $($setupSeconds + 60) s and was stopped" }
      Start-Sleep -Milliseconds 500
    }
    $result = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
    switch ($result.outcome) {
      "pending" { Write-Line "XF Studio is open, so build $($built.hash) waits; the next run installs it without rebuilding."; return "pending" }
      "installed" { Write-Line "installed build $($built.hash) in $([int]((Get-Date) - $started).TotalSeconds) s$(if ($result.current) { ' (already current)' })."; return "installed" }
      default { throw ([string]$result.reason) }
    }
  } finally {
    # Never report done while the helper, and so its job, is still running: wait for it up to the deadline (an exception above may
    # have come early), and only then stop it through the handle, which closes its job.
    if ($helperProcess) {
      if (-not $helperProcess.HasExited) {
        $left = [int][Math]::Max(0, ($deadline - (Get-Date)).TotalMilliseconds)
        if (-not $helperProcess.WaitForExit($left)) { try { $helperProcess.Kill() } catch { }; $null = $helperProcess.WaitForExit(15000) }
      }
      $helperProcess.Dispose()
    }
  }
}

$mutex = New-Object System.Threading.Mutex($false, "Global\xfs-desktop-refresh-installed")
$owned = try { $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $true }  # a killed run left it: now ours
if (-not $owned) { Write-Line "another refresh is running; nothing to do."; exit 0 }
$outcome = $null
try { $outcome = @(Invoke-Refresh)[-1] }  # the last value; native output is sent to the host
catch { $outcome = "failed: " + (($_.Exception.Message -replace "\s+", " ").Trim()); Write-Line $outcome }
finally {
  foreach ($file in @($setupLog, $configFile, $resultFile)) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue } }
  $mutex.ReleaseMutex()
}
$stamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
Add-Content -LiteralPath $Log -Value "$stamp commit=$commit build=$buildHash $outcome"
exit $(if ($outcome -like "failed*") { 1 } else { 0 })
