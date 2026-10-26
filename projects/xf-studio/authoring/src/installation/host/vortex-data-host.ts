/** Read-only launch evidence. Native process metadata and small settings reads are cheap;
 * the session-owned shortcut sweep runs separately, never on an inspection's critical path. */
import { execFile } from "node:child_process";
import { lstat, open, opendir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isLocalDrivePath } from "../../platform/api/path-containment";
import { vortexLastRunUserData, vortexStartupUserData, type VortexDataFacts } from "../vortex-data";
import { readWindowsVortexProcesses } from "./vortex-process-host";

const LOG_TAIL_BYTES = 256 * 1024;
export type VortexLaunchFacts = Pick<VortexDataFacts, "processes" | "shortcuts">;
export type VortexLaunchReader = (roots: readonly string[], signal: AbortSignal) => Promise<VortexLaunchFacts>;

const ROOTS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$shell = New-Object -ComObject WScript.Shell
try { @('Desktop','AllUsersDesktop','Programs','AllUsersPrograms') | ForEach-Object { $shell.SpecialFolders.Item($_) } | ConvertTo-Json -Compress }
finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
`;
/** Receives only the bounded list of .lnk paths from the host's streaming enumeration. */
export const VORTEX_SHORTCUT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$paths = @([Console]::In.ReadToEnd() | ConvertFrom-Json)
$shortcuts = @(); $shell = New-Object -ComObject WScript.Shell
try {
  foreach ($path in $paths) {
    $link = $null
    try {
      $link = $shell.CreateShortcut($path)
      if ($link.TargetPath -match '(?i)[\\/]Vortex\.exe$') {
        $shortcuts += @{ target = $link.TargetPath; arguments = $link.Arguments }
        @{ shortcuts = @($shortcuts) } | ConvertTo-Json -Compress -Depth 4
      }
    } catch {} finally { if ($link) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) } }
  }
} finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
@{ shortcuts = @($shortcuts) } | ConvertTo-Json -Compress -Depth 4
`;

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

function metadataScript(script: string, signal: AbortSignal, input = ""): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 4000, signal },
      (_error, stdout) => signal.aborted ? reject(signal.reason) : resolve(stdout));
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

const environmentRoots = (env: (name: string) => string | undefined) => [
  env("APPDATA") && join(env("APPDATA")!, "Microsoft", "Windows", "Start Menu", "Programs"),
  env("ProgramData") && join(env("ProgramData")!, "Microsoft", "Windows", "Start Menu", "Programs"),
  env("USERPROFILE") && join(env("USERPROFILE")!, "Desktop"), env("PUBLIC") && join(env("PUBLIC")!, "Desktop"),
].filter((path): path is string => !!path && isLocalDrivePath(path));

type DirectoryEntry = { name: string; isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean };
type DirectoryReader = { read(): Promise<DirectoryEntry | null>; close(): Promise<void> };
/** Counts entries actually fetched, including ignored files. bufferSize=1 prevents hidden prefetch past the cap. */
export async function enumerateVortexShortcuts(roots: readonly string[], signal: AbortSignal, options: {
  maxEntries?: number; open?: (path: string) => Promise<DirectoryReader>;
} = {}): Promise<{ paths: string[]; entriesFetched: number }> {
  const queue = [...new Set(roots.filter(path => isLocalDrivePath(path)))], paths: string[] = [], seen = new Set<string>();
  const limit = options.maxEntries ?? 4096;
  let entriesFetched = 0, visited = 0;
  while (queue.length && entriesFetched < limit && visited < 512) {
    signal.throwIfAborted();
    const path = queue.shift()!, key = process.platform === "win32" ? path.toLowerCase() : path;
    if (seen.has(key)) continue;
    seen.add(key); visited++;
    let directory: DirectoryReader | undefined;
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      directory = await (options.open ?? (path => opendir(path, { bufferSize: 1 })))(path);
      while (entriesFetched < limit) {
        signal.throwIfAborted();
        const entry = await directory.read();
        if (!entry) break;
        entriesFetched++;
        if (entry.isSymbolicLink()) continue;
        const child = join(path, entry.name);
        if (entry.isDirectory()) { if (queue.length + visited < 512) queue.push(child); }
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".lnk")) paths.push(child);
      }
    } catch { signal.throwIfAborted(); }
    finally { await directory?.close().catch(() => {}); }
  }
  signal.throwIfAborted();
  return { paths, entriesFetched };
}

export async function readWindowsVortexShortcuts(env: (name: string) => string | undefined, signal: AbortSignal): Promise<NonNullable<VortexDataFacts["shortcuts"]>> {
  signal.throwIfAborted();
  if (process.platform !== "win32") return [];
  const roots = environmentRoots(env);
  try {
    const known: unknown = JSON.parse(await metadataScript(ROOTS_SCRIPT, signal));
    if (Array.isArray(known)) roots.push(...known.filter((path): path is string => typeof path === "string" && isLocalDrivePath(path)));
  } catch { signal.throwIfAborted(); }
  const { paths } = await enumerateVortexShortcuts(roots, signal);
  if (!paths.length) return [];
  return parseVortexLaunchSnapshots(await metadataScript(VORTEX_SHORTCUT_SCRIPT, signal, JSON.stringify(paths))).shortcuts ?? [];
}

/** One sweep per host session, shared by inspections. Its own AbortSignal owns background work;
 * a request's cancellation does not cancel discovery for later requests. stop() ends this owner. */
export class VortexShortcutDiscovery {
  private started = false;
  private readonly controller = new AbortController();
  private rows: NonNullable<VortexDataFacts["shortcuts"]> = [];
  private scheduled?: ReturnType<typeof setImmediate>;
  private finish?: () => void;
  revision = 0;
  settled: Promise<void> = Promise.resolve();
  constructor(private readonly sweep = readWindowsVortexShortcuts) {}
  snapshot(): NonNullable<VortexDataFacts["shortcuts"]> { return this.rows; }
  start(env: (name: string) => string | undefined): void {
    if (this.started || this.controller.signal.aborted) return;
    this.started = true;
    this.settled = new Promise<void>(done => {
      this.finish = done;
      this.scheduled = setImmediate(() => {
        this.scheduled = undefined;
        this.sweep(env, AbortSignal.any([this.controller.signal, AbortSignal.timeout(8000)])).then(rows => {
          if (!this.controller.signal.aborted && rows.length) { this.rows = rows; this.revision++; }
        }).catch(() => {}).finally(done);
      });
    });
  }
  stop(): void {
    this.controller.abort();
    if (this.scheduled) { clearImmediate(this.scheduled); this.finish?.(); }
  }
}
export const vortexShortcutDiscovery = new VortexShortcutDiscovery();

/** Cheap facts only. Startup/log reads precede native process queries; neither waits for shortcuts. */
export async function gatherVortexDataFacts(env: (name: string) => string | undefined, signal: AbortSignal,
  readLaunches: VortexLaunchReader = async (_roots, signal) => ({ processes: readWindowsVortexProcesses(signal) })): Promise<VortexDataFacts> {
  signal.throwIfAborted();
  const platform = process.platform === "win32" ? "win32" : "posix";
  const appData = env("APPDATA"), programData = env("ProgramData");
  let startupUserData: string | undefined, lastRunUserData: string | undefined;
  if (appData && isLocalDrivePath(appData)) {
    const base = join(appData, "Vortex"), startup = join(base, "startup.json");
    try { if ((await stat(startup)).size <= 64 * 1024) startupUserData = vortexStartupUserData(await readFile(startup, { encoding: "utf8", signal })); }
    catch { signal.throwIfAborted(); }
    signal.throwIfAborted();
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
  const launches = platform === "win32" ? await readLaunches(environmentRoots(env), signal) : {};
  signal.throwIfAborted();
  return { platform, appData, programData, ...launches, startupUserData, lastRunUserData };
}
