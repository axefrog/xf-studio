// The session runner's host adapter: what the bridge can't do from inside the game. Launching it through MO2,
// closing it cleanly, the game's process and window, the monitors, the machine's free commit, and guarded key
// presses (sent only while the game is the foreground window; otherwise refused and recorded, nothing touched).
//
// Every machine-specific value (the MO2 executable, profile, the game folder, the save, the keys) comes from the
// run's private fixtures file; nothing here names a path. Tests use a fake Host; the real one refuses every key
// while XFB_NO_INPUT=1 (the test preload sets it), so no test can press a key on this desktop.

import { spawn } from "node:child_process";
import { dlopen, FFIType } from "bun:ffi";
import { mainWindowOf, processImageName, topLevelWindows } from "../capture/win32.ts";
import { parseReading } from "../commit-tripwire.ts";
import { INPUT_SIZE, isExtendedKey, keyboardInput, scanCodeFor, virtualKey } from "../input/photo-key.ts";

export const GAME_PROCESS = "Cyberpunk2077";

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
  /** The title of MO2's "Cannot launch program" dialog when one is up (an antivirus blocked the launch), or null. */
  launchBlocked(): Promise<string | null>;
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

/**
 * Where the CET overlay's XF Runtime Bridge window draws, derived from the game window's size. Seen on a 3840x1600
 * window at x 0-820, y 560-1600 (Borg 4); ImGui scales the window with the screen height (height / 1080), so the
 * crop scales with the height and keeps to the left edge and the bottom.
 */
export function cetWindowRect(width: number, height: number) {
  const y = Math.round(height * (560 / 1600));
  return { x: 0, y, width: Math.min(width, Math.round(height * (820 / 1600))), height: height - y };
}

// ---- The real host (Windows) ----------------------------------------------------------------------------

/** A hidden PowerShell one-liner, asynchronously (never blocks the runner's event loop). */
function powershell(command: string, timeoutMs = 20_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
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
  }).symbols;
}

function foregroundImage(): string | null {
  user32 ??= openUser32();
  const hwnd = user32.GetForegroundWindow() as bigint;
  if (!hwnd) return null;
  const pid = new Uint32Array(1);
  user32.GetWindowThreadProcessId(hwnd, pid);
  return processImageName(pid[0])?.replace(/\.exe$/i, "") ?? null;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    // MO2's own command line keeps the profile even when MO2 is open, and --arguments replaces the configured ones.
    const args = ["-p", spec.profile, "run", "-e", spec.executable, ...(spec.arguments ? ["--arguments", spec.arguments] : [])];
    const command = `ModOrganizer.exe ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`;
    // A missing or blocked executable fails asynchronously (ENOENT, EACCES): wait for spawn or error before answering.
    const child = spawn(spec.exe, args, { detached: true, stdio: "ignore" });
    const error = await new Promise<string | null>((resolve) => {
      child.once("spawn", () => resolve(null));
      child.once("error", (e) => resolve(`${(e as NodeJS.ErrnoException).code ?? "error"}: ${e.message}`));
    });
    if (error) return { started: false, command, error };
    child.unref();
    return { started: true, command };
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
  async launchBlocked() {
    const dialog = topLevelWindows().find((w) => /cannot launch program/i.test(w.title));
    return dialog ? dialog.title : null;
  },
  async systemHandles() {
    const { code, out } = await powershell("(Get-Process | Measure-Object HandleCount -Sum).Sum");
    const total = Number(out.trim());
    return code === 0 && Number.isFinite(total) && total > 0 ? total : null;
  },
};
