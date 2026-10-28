// The session runner's host adapter: what the bridge can't do from inside the game. Launching it through MO2,
// closing it cleanly, the game's process and window, the monitors, the machine's free commit, and guarded key
// presses (sent only while the game is the foreground window; otherwise refused and recorded, nothing touched).
//
// Every machine-specific value (the MO2 executable, profile, the game folder, the save, the keys) comes from the
// run's private fixtures file; nothing here names a path. Tests use a fake Host; the real one refuses every key
// while XFB_NO_INPUT=1 (the test preload sets it), so no test can press a key on this desktop.

import { spawn } from "node:child_process";
import { closeSync, existsSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { dlopen, FFIType } from "bun:ffi";
import { mainWindowOf, processImageName, topLevelWindows } from "../capture/win32.ts";
import { parseReading } from "../commit-tripwire.ts";
import { INPUT_SIZE, isExtendedKey, keyboardInput, scanCodeFor, virtualKey } from "../input/photo-key.ts";

export const GAME_PROCESS = "Cyberpunk2077";
export const JOB_BREAKAWAY_MESSAGE = "start the runner from PowerShell: this shell's job forbids breakaway, so MO2 can't create the hooked game (ERROR_ACCESS_DENIED)";

/** replace: the plan means to start a second copy over a running game (never set by the prelude, which adopts). */
export type LaunchSpec = { exe: string; profile: string; executable: string; arguments?: string; replace?: boolean };
export type WindowState = { pid: number; width: number; height: number; x: number; y: number; foreground: boolean; covers_monitor: boolean; minimized: boolean };
export type Monitor = { name: string; x: number; y: number; width: number; height: number; primary: boolean };
export type KeyResult = { sent: boolean; keys: string; refused?: string; foreground?: string | null };

export interface Host {
  /** The game's process, or null. */
  gameProcess(): Promise<{ pid: number } | null>;
  // Every operation with a side effect takes the caller's signal and checks it again right before the effect:
  // a cancelled step must never launch, close or press anything afterwards.
  /** Starts the game through MO2 (detached); answers at once. */
  launch(spec: LaunchSpec, signal?: AbortSignal): Promise<{ started: boolean; command: string; error?: string }>;
  /** Asks the game's main window to close (CloseMainWindow); false when there was nothing to ask. */
  requestClose(pid: number, signal?: AbortSignal): Promise<boolean>;
  /** The foreground window's process name (no extension), or null. */
  foreground(): Promise<string | null>;
  /** Presses keys (a chord: held in order, released in reverse) only while the game is the foreground window. */
  pressKeys(vks: number[], label: string, signal?: AbortSignal): Promise<KeyResult>;
  window(pid: number): Promise<WindowState | null>;
  monitors(): Promise<Monitor[]>;
  /** The machine's free commit in bytes (commit limit less committed), or null when unreadable. */
  freeCommitBytes(): Promise<number | null>;
  /** A process's private bytes (its commit charge), working set and handle count, or null. */
  processStats(pid: number): Promise<{ private_bytes: number; working_set: number; handles: number } | null>;
  /** Every process's handles summed (the kernel's growth showed there in Borg 4), or null. */
  systemHandles(): Promise<number | null>;
  /** MO2's launch failure, including fresh interface-log diagnostics when available, or null. */
  launchBlocked(): Promise<string | null>;
  /** Windows' Animation effects setting (SPI_GETCLIENTAREAANIMATION), read only; null when it can't be read. */
  windowsAnimations(): Promise<boolean | null>;
}

// ---- Key names ----------------------------------------------------------------------------------------------

const KEY_NAMES: Record<string, number> = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, "`": 0xc0, backquote: 0xc0, grave: 0xc0, oem_3: 0xc0,
  esc: 0x1b, escape: 0x1b, enter: 0x0d, return: 0x0d, space: 0x20, tab: 0x09, backspace: 0x08,
  end: 0x23, home: 0x24, insert: 0x2d, delete: 0x2e, pageup: 0x21, pagedown: 0x22,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28, pause: 0x13,
};
const VK_LABELS: Record<number, string> = { 0x11: "Ctrl", 0x10: "Shift", 0x12: "Alt", 0xc0: "`", 0x1b: "Esc", 0x0d: "Enter", 0x20: "Space", 0x09: "Tab",
  0x23: "End", 0x24: "Home", 0x2d: "Insert", 0x2e: "Delete", 0x21: "PageUp", 0x22: "PageDown", 0x25: "Left", 0x26: "Up", 0x27: "Right", 0x28: "Down" };

/** "Ctrl+`", "F6", "IK_F6", "Esc", "Alt+Enter" -> virtual keys in press order. Throws on an unknown name. */
export function parseKeys(text: string): number[] {
  const parts = text === "+" ? ["+"] : text.split(/\+(?!$)/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length || parts.length > 4) throw new Error(`A key is one to four names joined by + (got "${text}")`);
  return parts.map((part) => {
    const lower = part.toLowerCase();
    if (Object.hasOwn(KEY_NAMES, lower)) return KEY_NAMES[lower];
    const ik = virtualKey(part.startsWith("IK_") ? part : `IK_${part.length === 1 ? part.toUpperCase() : part}`);
    if (ik !== null) return ik;
    throw new Error(`Unknown key "${part}" in "${text}"`);
  });
}

/** Virtual keys back to a readable chord ("Ctrl+`"). */
export function keysLabel(vks: number[]): string {
  return vks.map((vk) => VK_LABELS[vk] ?? (vk >= 0x70 && vk <= 0x87 ? `F${vk - 0x6f}` : vk >= 0x30 && vk <= 0x5a ? String.fromCharCode(vk) : `0x${vk.toString(16)}`)).join("+");
}

/**
 * A CET binding as bindings.json stores it: up to four virtual keys of 16 bits each, the first key in the highest
 * bits (Ctrl+` is 0x0011_00C0_0000_0000). Zero means unbound.
 */
export function decodeCetBinding(value: bigint): number[] {
  const keys: number[] = [];
  for (const shift of [48n, 32n, 16n, 0n]) {
    const vk = Number((value >> shift) & 0xffffn);
    if (!vk) break;
    keys.push(vk);
  }
  return keys;
}

/** bindings.json's mods -> binding -> packed keys, read without losing precision (the values exceed 2^53). */
export function parseCetBindings(text: string): Record<string, Record<string, bigint>> {
  const parsed = JSON.parse(text.replace(/:\s*(\d{1,20})(\s*[,}\r\n])/g, ': "$1"$2')) as Record<string, Record<string, string>>;
  const out: Record<string, Record<string, bigint>> = {};
  for (const [mod, bindings] of Object.entries(parsed ?? {})) {
    if (!bindings || typeof bindings !== "object") continue;
    out[mod] = {};
    for (const [name, raw] of Object.entries(bindings)) if (/^\d+$/.test(String(raw))) out[mod][name] = BigInt(String(raw));
  }
  return out;
}

/** CET 0.8.23: the height-capped window can sit anywhere along the left side after ImGui clamps it to screen. */
export function cetWindowRect(width: number, height: number) {
  return { x: 0, y: 0, width: Math.min(width, Math.round(height * (820 / 1600))), height };
}

/** The native Diagnostics card opened beside CET: Overlay.cpp places it 16px from the top-right. */
export function cetDiagnosticsRect(width: number, height: number) {
  const cardWidth = 360 * height / 1080;
  const x = Math.max(0, Math.floor(width - cardWidth - 24));
  return { x, y: 0, width: width - x, height: Math.min(height, Math.ceil(600 * height / 1080)) };
}

/**
 * Where the XF box draws (its status row, chips and diagnostics card), for bursts that judge it: the overlay host
 * places it like the ink panel (native/src/core/overlay/Host.cpp PanelOrigin; the default anchor top_left at 40, 360 in
 * the HUD's 3840-wide units, at least 300 of the 2160-high floor down), 360 px wide at 1080p scaled with the height.
 * The height is generous (the diagnostics card), and the crop keeps a margin so a moved panel still fits.
 */
export function xfBoxRect(width: number, height: number) {
  const unit = width / 3840, scale = height / 1080;
  const left = 40 * unit, top = Math.max(360 * unit, 300 * (height / 2160));
  const x = Math.max(0, Math.round(left - 24 * scale)), y = Math.max(0, Math.round(top - 24 * scale));
  return { x, y, width: Math.min(width - x, Math.round(360 * scale + 48 * scale)), height: Math.min(height - y, Math.round(720 * scale)) };
}

/** The CET line: one line with its dot at the far top left (Cyber Engine Tweaks' label), with room for its message lines. */
export function cetLineRect(width: number, height: number) {
  const scale = height / 1080;
  return { x: 0, y: 0, width: Math.min(width, Math.round(900 * scale)), height: Math.min(height, Math.round(160 * scale)) };
}

/** The ink panel inside photo mode's menu (ST11's answer flash): placed like the XF box, a little wider. */
export function inkPanelRect(width: number, height: number) {
  const box = xfBoxRect(width, height);
  return { ...box, width: Math.min(width - box.x, Math.round(box.width * 1.5)) };
}

/** Bytes a burst holds in memory (capture.ts keeps every frame's RGB crop until the burst ends: 3 bytes a pixel). */
export const burstBytes = (rect: { width: number; height: number }, frames: number) => rect.width * rect.height * 3 * frames;

// ---- The real host (Windows) ----------------------------------------------------------------------------

/** A hidden PowerShell one-liner, asynchronously (never blocks the runner's event loop). */
function powershell(command: string, timeoutMs = 20_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
    child.on("error", () => { clearTimeout(timer); resolve({ code: null, out }); });
  });
}

let user32: ReturnType<typeof openUser32> | null = null;
function openUser32() {
  return dlopen("user32.dll", {
    SendInput: { args: [FFIType.u32, FFIType.ptr, FFIType.i32], returns: FFIType.u32 },
    GetForegroundWindow: { args: [], returns: FFIType.u64 },
    GetWindowThreadProcessId: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.u32 },
    SystemParametersInfoW: { args: [FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  }).symbols;
}

/** Inspect this Bun process, not a child shell (whose job membership could differ).
 * JobObjectExtendedLimitInformation = 9; x64 JOBOBJECT_EXTENDED_LIMIT_INFORMATION is 144 bytes,
 * with BasicLimitInformation.LimitFlags at byte 16. Query failures refuse launch.
 * https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-queryinformationjobobject
 */
export function currentProcessBreakawayBlocked(): boolean {
  const kernel = dlopen("kernel32.dll", {
    GetCurrentProcess: { args: [], returns: FFIType.u64 },
    IsProcessInJob: { args: [FFIType.u64, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    QueryInformationJobObject: { args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  });
  try {
    const inJob = new Uint32Array(1);
    if (!kernel.symbols.IsProcessInJob(kernel.symbols.GetCurrentProcess(), 0n, inJob)) throw new Error("could not inspect the runner's Windows job");
    if (!inJob[0]) return false;
    const limits = Buffer.alloc(144);
    if (!kernel.symbols.QueryInformationJobObject(0n, 9, limits, limits.length, null)) throw new Error("could not read the runner's Windows job limits");
    return (limits.readUInt32LE(16) & 0x800) === 0;
  } finally { kernel.close(); }
}

function foregroundImage(): string | null {
  user32 ??= openUser32();
  const hwnd = user32.GetForegroundWindow() as bigint;
  if (!hwnd) return null;
  const pid = new Uint32Array(1);
  user32.GetWindowThreadProcessId(hwnd, pid);
  return processImageName(pid[0])?.replace(/\.exe$/i, "") ?? null;
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type LogCursor = { size: number; ino: number };
export interface Mo2Port {
  gameProcess(): Promise<{ pid: number } | null>;
  breakawayBlocked(): Promise<boolean>;
  shell(command: string): Promise<{ code: number | null; out: string }>;
  forward(exe: string, args: string[]): Promise<string | null>;
  dialog(): string | null;
  cursor(path: string): LogCursor | null;
  appended(path: string, cursor: LogCursor | null): string;
  now(): number;
  sleep(ms: number): Promise<void>;
}
const psString = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** Windows CommandLineToArgvW quoting, then the whole command is quoted separately for PowerShell. */
export const windowsArgument = (s: string) => `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;

export function mo2Failure(log: string): string {
  const lines = log.split(/\r?\n/).filter((s) => /ERROR_[A-Z_]+|Error \d+|MO elevated:|failed|cannot launch/i.test(s));
  const detail = lines.slice(-8).join("\n");
  if (/ERROR_ACCESS_DENIED|Error 5\b/i.test(detail)) return `MO2 was started from a restricted process; starting it via WMI avoids that restriction. ${detail}`;
  return detail || "MO2 cannot launch the game; no new Windows error was found in mo_interface.log.";
}

/**
 * Prints 'ready', 'starting' or nothing for this MO2 installation (not another instance on the desktop).
 * Paths are compared normalised: fixtures may use forward slashes, Get-Process reports backslashes.
 * It always exits 0: an empty Get-Process leaves $? false even with SilentlyContinue, and "not running" is not a failure.
 */
export const mo2ProcessQuery = (exe: string) =>
  `$p = Get-Process -Name ModOrganizer -ErrorAction SilentlyContinue | Where-Object { $_.Path -and [IO.Path]::GetFullPath($_.Path) -eq [IO.Path]::GetFullPath(${psString(exe)}) }; if ($p) { if ($p | Where-Object { $_.MainWindowHandle -ne 0 }) { 'ready' } else { 'starting' } }; exit 0`;

/** One launch attempt owns its log cursor. No old access-denied error is attributed to a later attempt. */
export function createMo2Launcher(port: Mo2Port) {
  let attempt: { path: string; cursor: LogCursor | null } | undefined;
  return {
    async launch(spec: LaunchSpec, signal?: AbortSignal): ReturnType<Host["launch"]> {
      const args = ["-p", spec.profile, "run", "-e", spec.executable, ...(spec.arguments ? ["--arguments", spec.arguments] : [])];
      const command = `ModOrganizer.exe ${args.map(windowsArgument).join(" ")}`;
      const cancelled = () => ({ started: false, command });
      if (signal?.aborted) return cancelled();
      try {
        if (await port.breakawayBlocked()) return { started: false, command, error: JOB_BREAKAWAY_MESSAGE };
      } catch (error) { return { started: false, command, error: String((error as Error)?.message ?? error) }; }
      if (signal?.aborted) return cancelled();
      const query = mo2ProcessQuery(spec.exe);
      const status = await port.shell(query);
      if (signal?.aborted) return cancelled();
      if (status.code !== 0) return { started: false, command, error: "could not inspect MO2's process" };
      if (!status.out.trim()) {
        const line = [spec.exe, "-p", spec.profile].map(windowsArgument).join(" ");
        const created = await port.shell(`$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psString(line)}; CurrentDirectory = ${psString(dirname(spec.exe))} }; if ($r.ReturnValue -ne 0) { throw "WMI process creation failed: $($r.ReturnValue)" }`);
        if (created.code !== 0) return { started: false, command, error: `WMI could not start MO2: ${created.out.trim()}` };
      }
      const deadline = port.now() + 120_000; // A large mod list can take over a minute to load.
      let ready = status.out.trim() === "ready";
      while (!ready && port.now() < deadline && !signal?.aborted) {
        await port.sleep(250);
        if (signal?.aborted) return cancelled();
        const polled = await port.shell(query);
        ready = polled.code === 0 && polled.out.trim() === "ready";
      }
      if (signal?.aborted) return cancelled();
      if (!ready) return { started: false, command, error: "MO2's window did not appear within 2 minutes" };
      const path = join(dirname(spec.exe), "logs", "mo_interface.log");
      attempt = { path, cursor: port.cursor(path) };
      // A game can appear while MO2's window is starting. Check at the last async boundary before forwarding.
      const running = await port.gameProcess();
      if (running && !spec.replace) return { started: false, command, error: `already_running: ${GAME_PROCESS}.exe is running (pid ${running.pid}); adopt it instead of launching another` };
      if (signal?.aborted) return cancelled();
      const error = await port.forward(spec.exe, args);
      return error ? { started: false, command, error } : { started: true, command };
    },
    async blocked() {
      if (!port.dialog()) return null;
      return mo2Failure(attempt ? port.appended(attempt.path, attempt.cursor) : "");
    },
  };
}

export function mo2LogCursor(path: string): LogCursor | null {
  try { const s = statSync(path); return { size: s.size, ino: s.ino }; } catch { return null; }
}
export function mo2LogAppended(path: string, cursor: LogCursor | null): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const s = fstatSync(fd);
    const start = Math.max(cursor && cursor.ino === s.ino && cursor.size <= s.size ? cursor.size : 0, s.size - 65536);
    const b = Buffer.alloc(s.size - start);
    return b.subarray(0, readSync(fd, b, 0, b.length, start)).toString("utf8");
  } catch { return ""; } finally { if (fd !== undefined) closeSync(fd); }
}

const mo2 = createMo2Launcher({
  shell: powershell, now: Date.now, sleep: pause,
  gameProcess: () => windowsHost.gameProcess(),
  breakawayBlocked: async () => currentProcessBreakawayBlocked(),
  dialog: () => topLevelWindows().find((w) => /cannot launch program/i.test(w.title))?.title ?? null,
  cursor: mo2LogCursor, appended: mo2LogAppended,
  async forward(exe, args) {
    const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: true });
    const error = await new Promise<string | null>((resolve) => {
      child.once("spawn", () => resolve(null));
      child.once("error", (e) => resolve(`${(e as NodeJS.ErrnoException).code ?? "error"}: ${e.message}`));
    });
    if (!error) child.unref();
    return error;
  },
});

export const windowsHost: Host = {
  async gameProcess() {
    const { out } = await powershell(`(Get-Process -Name ${GAME_PROCESS} -ErrorAction SilentlyContinue | Select-Object -First 1).Id`);
    const pid = Number(out.trim());
    return Number.isInteger(pid) && pid > 0 ? { pid } : null;
  },
  async launch(spec, signal) {
    if (signal?.aborted) return { started: false, command: "" };
    // Never a second copy (scripted session 1 started one by hand): a running game is adopted, not launched over.
    const running = await this.gameProcess();
    if (running && !spec.replace) return { started: false, command: "", error: `already_running: ${GAME_PROCESS}.exe is running (pid ${running.pid}); adopt it instead of launching another` };
    if (signal?.aborted) return { started: false, command: "" };
    if (!existsSync(spec.exe)) return { started: false, command: "", error: "ENOENT: the MO2 executable does not exist" };
    return mo2.launch(spec, signal);
  },
  async requestClose(pid, signal) {
    if (signal?.aborted) return false;
    const { out } = await powershell(`$p = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; if ($p) { $p.CloseMainWindow() } else { 'gone' }`);
    return out.trim() === "True";
  },
  async foreground() {
    return foregroundImage();
  },
  async pressKeys(vks, label, signal) {
    if (signal?.aborted) return { sent: false, keys: label, refused: "the step was cancelled" };
    if (process.env.XFB_NO_INPUT === "1") return { sent: false, keys: label, refused: "key input is switched off in this process (XFB_NO_INPUT=1)" };
    const front = foregroundImage();
    if (front?.toLowerCase() !== GAME_PROCESS.toLowerCase()) return { sent: false, keys: label, refused: `the foreground window is ${front ?? "nothing"}, not the game`, foreground: front };
    const records = vks.map((vk) => ({ scan: scanCodeFor(vk), extended: isExtendedKey(vk) }));
    if (records.some((r) => !r.scan)) return { sent: false, keys: label, refused: "Windows has no scan code for one of the keys" };
    const pressed: typeof records = [];
    try {
      for (const record of records) {
        // Checked again right before each key goes down: a key must never land in another program, nor after a cancel.
        if (signal?.aborted) return { sent: false, keys: label, refused: "the step was cancelled part-way; nothing more was sent" };
        if (foregroundImage()?.toLowerCase() !== GAME_PROCESS.toLowerCase()) return { sent: false, keys: label, refused: "the game lost the foreground part-way; nothing more was sent", foreground: foregroundImage() };
        if ((user32!.SendInput(1, keyboardInput(record.scan, false, record.extended), INPUT_SIZE) as number) !== 1) return { sent: false, keys: label, refused: "Windows refused the key press" };
        pressed.push(record);
        await pause(60);
      }
    } finally {
      // Release whatever went down, in reverse, even if the focus moved: a key left down would be worse.
      for (const record of pressed.reverse()) { user32!.SendInput(1, keyboardInput(record.scan, true, record.extended), INPUT_SIZE); await pause(30); }
    }
    return { sent: true, keys: label, foreground: GAME_PROCESS };
  },
  async window(pid) {
    const info = mainWindowOf(pid);
    return info ? { pid, width: info.width, height: info.height, x: info.screenX, y: info.screenY, foreground: info.foreground, covers_monitor: info.coversMonitor, minimized: info.minimized } : null;
  },
  async monitors() {
    const { out } = await powershell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { "$($_.DeviceName)|$($_.Bounds.X)|$($_.Bounds.Y)|$($_.Bounds.Width)|$($_.Bounds.Height)|$($_.Primary)" }`);
    return out.split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, x, y, width, height, primary] = line.split("|");
      return { name, x: Number(x), y: Number(y), width: Number(width), height: Number(height), primary: primary === "True" };
    });
  },
  async freeCommitBytes() {
    const { code, out } = await powershell('$m = Get-CimInstance Win32_PerfRawData_PerfOS_Memory; "$($m.CommitLimit) $($m.CommittedBytes)"');
    const reading = code === 0 ? parseReading(out) : null;
    return reading ? reading.limit - reading.committed : null;
  },
  async processStats(pid) {
    const { code, out } = await powershell(`$p = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; if ($p) { "$($p.PrivateMemorySize64) $($p.WorkingSet64) $($p.HandleCount)" }`);
    const [privateBytes, workingSet, handles] = out.trim().split(/\s+/).map(Number);
    return code === 0 && Number.isFinite(privateBytes) && privateBytes > 0 ? { private_bytes: privateBytes, working_set: workingSet, handles } : null;
  },
  async windowsAnimations() {
    user32 ??= openUser32();
    const value = new Int32Array(1);
    // SPI_GETCLIENTAREAANIMATION (0x1042): what the bridge's motion auto follows; reading changes nothing.
    return user32.SystemParametersInfoW(0x1042, 0, value, 0) ? value[0] !== 0 : null;
  },
  async launchBlocked() {
    return mo2.blocked();
  },
  async systemHandles() {
    const { code, out } = await powershell("(Get-Process | Measure-Object HandleCount -Sum).Sum");
    const total = Number(out.trim());
    return code === 0 && Number.isFinite(total) && total > 0 ? total : null;
  },
};
