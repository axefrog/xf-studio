<#
.SYNOPSIS
  XF Runtime Bridge client for PowerShell 7 (no Bun needed).

.DESCRIPTION
  Reads session.json, checks that the pipe really belongs to the game process named there
  (GetNamedPipeServerProcessId), sends one request per method and prints one line per answer.
  Never prints the session token.

.EXAMPLE
  pwsh -File tools/bridge-client.ps1 ping
  pwsh -File tools/bridge-client.ps1 smoke
  pwsh -File tools/bridge-client.ps1 call player.position
#>
param(
    [Parameter(Position = 0)] [string] $Command = 'ping',
    [Parameter(Position = 1)] [string] $Method,
    [Parameter(Position = 2)] [string] $ParamsJson = '{}',
    [string] $RuntimeDir,
    [int] $TimeoutMs = 5000
)

$ErrorActionPreference = 'Stop'

if (-not $RuntimeDir) {
    $RuntimeDir = if ($env:XFB_RUNTIME_DIR) { $env:XFB_RUNTIME_DIR } else { Join-Path $env:LOCALAPPDATA 'XFStudio\runtime-bridge' }
}
$sessionFile = Join-Path $RuntimeDir 'session.json'
if (-not (Test-Path $sessionFile)) {
    Write-Host "No bridge session at $sessionFile."
    Write-Host 'Is the game running with [bridge] enabled = true in red4ext/plugins/XFRuntimeBridge/config.ini?'
    exit 2
}
$session = Get-Content -Raw $sessionFile | ConvertFrom-Json
if ($session.protocol -ne 1) { throw "unsupported bridge protocol $($session.protocol)" }

if ($Command -eq 'discover') {
    $session | Select-Object protocol, sid, pid, pipe, started_at, plugin_version, allow_writes | Format-List
    exit 0
}

Add-Type -Namespace XfBridge -Name Native -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GetNamedPipeServerProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle pipe, out uint serverProcessId);
'@

$pipeName = $session.pipe -replace '^\\\\\.\\pipe\\', ''
$pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $pipeName, [System.IO.Pipes.PipeDirection]::InOut)
try {
    $pipe.Connect($TimeoutMs)
} catch {
    Write-Host "Could not open $($session.pipe): $($_.Exception.Message)"
    Write-Host 'The session file may be stale (game closed or crashed), or another client is connected.'
    exit 2
}

$serverPid = [uint32]0
if (-not [XfBridge.Native]::GetNamedPipeServerProcessId($pipe.SafePipeHandle, [ref] $serverPid) -or $serverPid -ne [uint32]$session.pid) {
    $pipe.Dispose()
    Write-Host "Refusing to talk: the pipe server is process $serverPid, but session.json names $($session.pid)."
    exit 3
}

$utf8 = [System.Text.UTF8Encoding]::new($false)
$reader = [System.IO.StreamReader]::new($pipe, $utf8)
$writer = [System.IO.StreamWriter]::new($pipe, $utf8)
$writer.AutoFlush = $true
$script:nextId = 1
$script:failures = 0

function Invoke-Bridge([string] $Name, [string] $Params = '{}', [string] $Cid) {
    $id = $script:nextId++
    $request = [ordered]@{ v = 1; id = $id; token = $session.token; method = $Name; params = ($Params | ConvertFrom-Json) }
    if ($Cid) { $request.cid = $Cid }
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $writer.WriteLine(($request | ConvertTo-Json -Compress -Depth 10))
    $readTask = $reader.ReadLineAsync()
    if (-not $readTask.Wait($TimeoutMs)) { throw "no answer within $TimeoutMs ms" }
    $response = $readTask.Result | ConvertFrom-Json
    $ms = $watch.ElapsedMilliseconds
    if ($response.ok) {
        Write-Host ("OK   {0} cid={1} {2}ms {3}" -f $Name, $response.cid, $ms, ($response.result | ConvertTo-Json -Compress -Depth 10))
    } else {
        $script:failures++
        Write-Host ("FAIL {0} cid={1} {2}ms {3}: {4}" -f $Name, $response.cid, $ms, $response.error.code, $response.error.message)
    }
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
try {
    switch ($Command) {
        'ping' { Invoke-Bridge 'ping' '{}' "ps-$stamp" }
        'smoke' {
            $i = 0
            foreach ($m in 'ping', 'bridge.info', 'game.version', 'game.state', 'layers.status', 'player.position', 'photomode.state', 'script.describe', 'bridge.methods') {
                Invoke-Bridge $m '{}' "ps-smoke-$stamp-$i"
                $i++
            }
        }
        'call' {
            if (-not $Method) { throw 'call needs a method name' }
            Invoke-Bridge $Method $ParamsJson "ps-$stamp"
        }
        'kill' { Invoke-Bridge 'bridge.kill' '{}' "ps-$stamp" }
        default { throw "unknown command $Command" }
    }
} finally {
    $pipe.Dispose()
}
exit ([int]($script:failures -gt 0))
