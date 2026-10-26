/** Read-only Windows launch evidence. Never executes a shortcut target or Vortex. */
import { execFile } from "node:child_process";
import { open, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isLocalDrivePath } from "../../platform/api/path-containment";
import { vortexLastRunUserData, vortexStartupUserData, type VortexDataFacts } from "../vortex-data";

const LOG_TAIL_BYTES = 256 * 1024;
/** Fixed script: only process queries and shortcut reads; no paths interpolated into code.
 * Counts, process timeout and AbortSignal bound the work. Skip reparse points and remote roots.
 */
export const VORTEX_LAUNCH_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$processes = @(); $shortcuts = @()
try {
  $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'Vortex.exe'" | Sort-Object ProcessId | ForEach-Object {
    if ($_.ExecutablePath -and $_.CommandLine) { @{ executable = $_.ExecutablePath; commandLine = $_.CommandLine } }
  })
} catch {}
# Emit process evidence before scanning shortcuts, so a bounded scan timeout cannot lose it.
@{ processes = @($processes); shortcuts = @() } | ConvertTo-Json -Compress -Depth 4
$roots = @($env:XFS_VORTEX_SHORTCUT_ROOTS | ConvertFrom-Json)
$shell = $null
try {
  $shell = New-Object -ComObject WScript.Shell
  # Ask Windows for redirected Desktop/Start-menu locations as well as the supplied environment folders.
  if ($env:XFS_VORTEX_KNOWN_FOLDERS -eq '1') {
    foreach ($name in @('Desktop', 'AllUsersDesktop', 'Programs', 'AllUsersPrograms')) {
      $known = $shell.SpecialFolders.Item($name)
      if ($known -and $roots -notcontains $known) { $roots += $known }
    }
  }
  $queue = New-Object 'System.Collections.Generic.Queue[string]'
  foreach ($root in $roots) { if ($root -match '^[A-Za-z]:[\\/]') { $queue.Enqueue($root) } }
  $visited = 0; $examined = 0
  while ($queue.Count -gt 0 -and $visited -lt 512 -and $examined -lt 4096) {
    $dir = $queue.Dequeue(); $visited++
    try {
      $info = Get-Item -LiteralPath $dir -Force
      if ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
      foreach ($entry in (Get-ChildItem -LiteralPath $dir -Force | Sort-Object Name)) {
        $examined++; if ($examined -gt 4096) { break }
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        if ($entry.PSIsContainer) { $queue.Enqueue($entry.FullName) }
        elseif ($entry.Extension -ieq '.lnk') {
          $link = $shell.CreateShortcut($entry.FullName)
          if ($link.TargetPath -match '(?i)[\\/]Vortex\.exe$') {
            $shortcuts += @{ target = $link.TargetPath; arguments = $link.Arguments }
            @{ processes = @($processes); shortcuts = @($shortcuts) } | ConvertTo-Json -Compress -Depth 4
          }
          [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($link)
        }
      }
    } catch {}
  }
} catch {} finally { if ($shell) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) } }
@{ processes = @($processes); shortcuts = @($shortcuts) } | ConvertTo-Json -Compress -Depth 4
`;

export type VortexLaunchFacts = Pick<VortexDataFacts, "processes" | "shortcuts">;
export type VortexLaunchReader = (roots: readonly string[], signal: AbortSignal, timeoutMs?: number) => Promise<VortexLaunchFacts>;

/** Each complete line is a snapshot. Keep the last intact one after a timeout/output cap. */
export function parseVortexLaunchSnapshots(stdout: string): VortexLaunchFacts {
  let value: Record<string, unknown> = {};
  for (const line of stdout.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    try {
      const decoded: unknown = JSON.parse(line);
      if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) value = decoded as Record<string, unknown>;
    } catch { /* incomplete or empty line */ }
  }
  const processes = Array.isArray(value.processes) ? value.processes.filter((row: unknown): row is NonNullable<VortexDataFacts["processes"]>[number] =>
    !!row && typeof row === "object" && "executable" in row && typeof row.executable === "string" && "commandLine" in row && typeof row.commandLine === "string") : [];
  const shortcuts = Array.isArray(value.shortcuts) ? value.shortcuts.filter((row: unknown): row is NonNullable<VortexDataFacts["shortcuts"]>[number] =>
    !!row && typeof row === "object" && "target" in row && typeof row.target === "string" && "arguments" in row && typeof row.arguments === "string") : [];
  return { processes, shortcuts };
}

export const readWindowsVortexLaunches: VortexLaunchReader = (roots, signal, timeoutMs = 4000) => new Promise((resolve, reject) => {
  signal.throwIfAborted();
  execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", VORTEX_LAUNCH_SCRIPT],
    { windowsHide: true, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: Math.max(1, Math.min(4000, Math.ceil(timeoutMs))), signal,
      env: { ...process.env, XFS_VORTEX_SHORTCUT_ROOTS: JSON.stringify(roots), XFS_VORTEX_KNOWN_FOLDERS: "1" } },
    (_error, stdout) => {
      if (signal.aborted) { reject(signal.reason); return; }
      resolve(parseVortexLaunchSnapshots(stdout));
    });
});

/** Only launch metadata, startup.json and the tail of the base log. State markers are supplied by the state reader. */
export async function gatherVortexDataFacts(env: (name: string) => string | undefined, signal: AbortSignal,
  readLaunches: VortexLaunchReader = readWindowsVortexLaunches): Promise<VortexDataFacts> {
  signal.throwIfAborted();
  const platform = process.platform === "win32" ? "win32" : "posix";
  const appData = env("APPDATA"), programData = env("ProgramData");
  const roots = [appData && join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
    programData && join(programData, "Microsoft", "Windows", "Start Menu", "Programs"),
    env("USERPROFILE") && join(env("USERPROFILE")!, "Desktop"), env("PUBLIC") && join(env("PUBLIC")!, "Desktop")]
    .filter((path): path is string => !!path && isLocalDrivePath(path));
  let startupUserData: string | undefined, lastRunUserData: string | undefined;
  if (appData && isLocalDrivePath(appData)) {
    const base = join(appData, "Vortex"), startup = join(base, "startup.json");
    try { if ((await stat(startup)).size <= 64 * 1024) startupUserData = vortexStartupUserData(await readFile(startup, { encoding: "utf8", signal })); }
    catch { signal.throwIfAborted(); }
    signal.throwIfAborted();
    // Open read-only; never load an entire rotating log. Drop the possibly partial first line.
    try {
      const file = await open(join(base, "vortex.log"), "r");
      try {
        const size = (await file.stat()).size, length = Math.min(size, LOG_TAIL_BYTES);
        signal.throwIfAborted();
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await file.read(buffer, 0, length, size - length);
        let tail = buffer.subarray(0, bytesRead).toString("utf8");
        if (size > length) tail = tail.includes("\n") ? tail.slice(tail.indexOf("\n") + 1) : "";
        lastRunUserData = vortexLastRunUserData(tail);
      } finally { await file.close(); }
    } catch { signal.throwIfAborted(); }
  }
  signal.throwIfAborted();
  const launches = platform === "win32" ? await readLaunches(roots, signal) : {};
  signal.throwIfAborted();
  return { platform, appData, programData, ...launches, startupUserData, lastRunUserData };
}
