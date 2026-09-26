// photo.open's one allowlisted input: the player's own photo-mode key, sent only to the game window.
//
// Why: no script can open the full photo mode (knowledge/photo-mode.md §2): the key sends the input
// action TogglePhotoMode, which native code handles, and the quest-node route opens a restricted
// photo mode. The maintainer approved (26 September 2026, test profile only) sending that one key:
// the bound TogglePhotoMode key (the player's rebinding from UserSettings.json, else the default
// IK_N from r6/config/inputUserMappings.xml), only to the Cyberpunk window, only after the bridge
// reports CanPhotoModeBeEnabled, never any other input.
//
// Routes:
//   sendinput    SendInput with the key's scan code (what a keyboard produces; games reading raw
//                input see it). Needs the game window in front: the window is brought forward once
//                (SetForegroundWindow) and the send is refused unless it really is the foreground
//                window, so the key can never land in another program.
//   postmessage  WM_KEYDOWN / WM_KEYUP posted to the game window only (works even when it isn't in
//                front, if the game reads window messages). For research; whether the game reacts is
//                unverified.
// Both routes check first that the window belongs to the given process and that the process image is
// Cyberpunk2077.exe (RB-35), and run the caller's last-moment check (the game's phase) just before
// the key goes (RB-37).
// [doc] Microsoft: SendInput, KEYBDINPUT, MapVirtualKeyW, SetForegroundWindow, PostMessageW,
// "Keystroke Message Flags" (the extended-key flag).

import { dlopen, FFIType } from "bun:ffi";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { processImageName } from "../capture/win32.ts";

const { u64, u32, i32, i64, ptr } = FFIType;

export type KeyRoute = "sendinput" | "postmessage";
export type Binding = { name: string; source: "user_settings" | "default" };

/** The only process the key may ever be sent to. */
export const GAME_IMAGE = "Cyberpunk2077.exe";

export class KeySendError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const KEY_NAME = /^IK_[A-Za-z0-9_]{1,24}$/;

/**
 * The photo-mode key's binding: the player's rebinding in UserSettings.json, or the game's default IK_N
 * when the file or the photoMode entry doesn't exist. An entry that exists but is unbound (IK_None,
 * empty) or malformed, or a settings file that can't be read, is refused (RB-38): guessing IK_N there
 * could press a key the player uses for something else.
 */
export function readPhotoModeBinding(settingsPath = defaultSettingsPath()): Binding {
  if (!settingsPath || !existsSync(settingsPath)) return { name: "IK_N", source: "default" };
  let settings: { data?: { group_name?: string; options?: { name?: string; value?: unknown }[] }[] };
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    throw new KeySendError("The game's settings file couldn't be read, so the photo mode key isn't known and nothing was sent. Ask the player to press it.", "key_binding_unreadable");
  }
  for (const group of Array.isArray(settings?.data) ? settings.data : []) {
    if (!String(group?.group_name ?? "").startsWith("/key_bindings/")) continue;
    const option = (Array.isArray(group.options) ? group.options : []).find((o) => o?.name === "photoMode");
    if (!option) continue;
    if (typeof option.value === "string" && KEY_NAME.test(option.value) && option.value !== "IK_None") return { name: option.value, source: "user_settings" };
    throw new KeySendError("The photo mode key isn't bound to a key in the game's settings, so nothing was sent. Bind it in the game's controls, or ask the player to open photo mode.", "key_unbound");
  }
  return { name: "IK_N", source: "default" };
}

export function defaultSettingsPath(): string {
  const base = process.env.LOCALAPPDATA;
  return base ? join(base, "CD Projekt Red", "Cyberpunk 2077", "UserSettings.json") : "";
}

// Keys whose virtual key code, and so the key the game reads, doesn't depend on the keyboard layout.
// Punctuation keys (IK_Tilde, IK_Minus, brackets …) are left out on purpose (RB-39): their virtual key
// is the US layout's, and on another layout the same code sits on a different key, so the bridge
// couldn't be sure which key the game expects. Such a binding is refused and the player presses it.
const NAMED: Record<string, number> = {
  IK_Space: 0x20,
  IK_Backspace: 0x08,
  IK_Tab: 0x09,
  IK_Enter: 0x0d,
  IK_PageUp: 0x21,
  IK_PageDown: 0x22,
  IK_End: 0x23,
  IK_Home: 0x24,
  IK_Left: 0x25,
  IK_Up: 0x26,
  IK_Right: 0x27,
  IK_Down: 0x28,
  IK_Insert: 0x2d,
  IK_Delete: 0x2e,
};

/** The Windows virtual-key code for a game key name (IK_A..IK_Z, IK_0..IK_9, IK_F1..IK_F24, IK_NumPad0..9 and the keys above), or null. */
export function virtualKey(name: string): number | null {
  let m = /^IK_([A-Z])$/.exec(name);
  if (m) return m[1].charCodeAt(0);
  m = /^IK_([0-9])$/.exec(name);
  if (m) return 0x30 + Number(m[1]);
  m = /^IK_F([0-9]{1,2})$/.exec(name);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 24) return 0x6f + Number(m[1]);
  m = /^IK_NumPad([0-9])$/i.exec(name);
  if (m) return 0x60 + Number(m[1]);
  return Object.hasOwn(NAMED, name) ? NAMED[name] : null;
}

/**
 * Navigation-cluster and arrow keys share their scan codes with the numeric keypad; a keyboard marks
 * them as extended, and without the flag the game gets the keypad key (RB-39).
 */
export function isExtendedKey(vk: number): boolean {
  return (vk >= 0x21 && vk <= 0x28) || vk === 0x2d || vk === 0x2e;
}

// INPUT (x64): DWORD type; 4 bytes padding; union (32 bytes). KEYBDINPUT at offset 8:
// WORD wVk @8, WORD wScan @10, DWORD dwFlags @12, DWORD time @16, 4 bytes padding, ULONG_PTR dwExtraInfo @24.
export const INPUT_SIZE = 40;
export const INPUT_KEYBOARD = 1;
export const KEYEVENTF_EXTENDEDKEY = 0x0001;
export const KEYEVENTF_KEYUP = 0x0002;
export const KEYEVENTF_SCANCODE = 0x0008;

/** One keyboard INPUT record (scan code only, as a physical key press sends; extended for the navigation cluster). */
export function keyboardInput(scan: number, up: boolean, extended = false): Uint8Array {
  const bytes = new Uint8Array(INPUT_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, INPUT_KEYBOARD, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, scan, true);
  view.setUint32(12, KEYEVENTF_SCANCODE | (up ? KEYEVENTF_KEYUP : 0) | (extended ? KEYEVENTF_EXTENDEDKEY : 0), true);
  return bytes;
}

/** WM_KEYDOWN / WM_KEYUP lParam: repeat count 1, scan code, the extended-key bit, and for key up the previous-state and transition bits. */
export function keyMessageParam(scan: number, up: boolean, extended = false): bigint {
  let value = 1n | (BigInt(scan & 0xff) << 16n) | (extended ? 1n << 24n : 0n);
  if (up) value |= (1n << 30n) | (1n << 31n);
  return value;
}

let user32: ReturnType<typeof openUser32> | null = null;
function openUser32() {
  return dlopen("user32.dll", {
    SendInput: { args: [u32, ptr, i32], returns: u32 },
    MapVirtualKeyW: { args: [u32, u32], returns: u32 },
    SetForegroundWindow: { args: [u64], returns: i32 },
    GetForegroundWindow: { args: [], returns: u64 },
    PostMessageW: { args: [u64, u32, u64, i64], returns: i32 },
    GetWindowThreadProcessId: { args: [u64, ptr], returns: u32 },
    IsWindow: { args: [u64], returns: i32 },
  }).symbols;
}
function lib() {
  user32 ??= openUser32();
  return user32;
}

/** The scan code Windows maps a virtual key to (MapVirtualKeyW, MAPVK_VK_TO_VSC); 0 when there is none. Sends nothing. */
export function scanCodeFor(vk: number): number {
  return lib().MapVirtualKeyW(vk, 0) as number;
}

/** Is this process image the game (by file name, case-insensitive)? */
export function isGameImage(image: string | null): boolean {
  return typeof image === "string" && image.toLowerCase() === GAME_IMAGE.toLowerCase();
}

export type KeySendResult = { route: KeyRoute; focused_by_bridge: boolean; scan_code: number; extended: boolean };

export type KeySendOptions = {
  /**
   * Runs right before the key goes, after the window was brought to the front (RB-37): the caller
   * re-checks the game (still in the world, photo mode still allowed) and throws to stop the send.
   */
  beforeSend?: () => Promise<void>;
};

/** Sends one key press to one window: the only input the bridge tools ever produce. */
export type KeySender = (target: { hwnd: bigint; pid: number }, vk: number, route: KeyRoute, options?: KeySendOptions) => Promise<KeySendResult>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const sendKeyToWindow: KeySender = async (target, vk, route, options = {}) => {
  // Test processes set XFB_NO_INPUT=1 (bunfig.toml's test preload): nothing may ever press a key on
  // the test machine's desktop.
  if (process.env.XFB_NO_INPUT === "1") throw new KeySendError("Key input is switched off in this process (XFB_NO_INPUT=1), so nothing was sent.", "input_disabled");
  const u = lib();
  if (!u.IsWindow(target.hwnd)) throw new KeySendError("The game window has gone.", "no_window");
  const owner = new Uint32Array(1);
  u.GetWindowThreadProcessId(target.hwnd, owner);
  if (owner[0] !== target.pid) throw new KeySendError("That window doesn't belong to the game, so nothing was sent.", "wrong_window");
  if (!isGameImage(processImageName(target.pid))) throw new KeySendError(`That window isn't ${GAME_IMAGE}'s, so nothing was sent.`, "wrong_window");
  const scan = scanCodeFor(vk);
  if (!scan) throw new KeySendError("Windows has no scan code for the photo mode key.", "no_scan_code");
  const extended = isExtendedKey(vk);
  if (route === "postmessage") {
    const WM_KEYDOWN = 0x0100;
    const WM_KEYUP = 0x0101;
    await options.beforeSend?.();
    if (!u.PostMessageW(target.hwnd, WM_KEYDOWN, BigInt(vk), keyMessageParam(scan, false, extended))) throw new KeySendError("Windows refused to post the key to the game window.", "send_failed");
    await sleep(80);
    u.PostMessageW(target.hwnd, WM_KEYUP, BigInt(vk), keyMessageParam(scan, true, extended));
    return { route, focused_by_bridge: false, scan_code: scan, extended };
  }
  let focused = false;
  if ((u.GetForegroundWindow() as bigint) !== target.hwnd) {
    u.SetForegroundWindow(target.hwnd);
    focused = true;
    await sleep(250);
  }
  // The game may have changed while the window came forward (a menu, a scene): check it again.
  await options.beforeSend?.();
  if ((u.GetForegroundWindow() as bigint) !== target.hwnd) {
    throw new KeySendError("The game window isn't in front, so the key wasn't sent (it would have gone to another program). Click the game window, then try again.", "not_foreground");
  }
  const down = keyboardInput(scan, false, extended);
  if ((u.SendInput(1, down, INPUT_SIZE) as number) !== 1) throw new KeySendError("Windows refused the key press.", "send_failed");
  // Held for a few frames, so the game's input polling sees it even at low frame rates.
  await sleep(80);
  // Release it even if the focus moved meanwhile: a key left down would be worse.
  u.SendInput(1, keyboardInput(scan, true, extended), INPUT_SIZE);
  return { route, focused_by_bridge: focused, scan_code: scan, extended };
};
