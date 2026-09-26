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
// [doc] Microsoft: SendInput, KEYBDINPUT, MapVirtualKeyW, SetForegroundWindow, PostMessageW.

import { dlopen, FFIType } from "bun:ffi";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { u64, u32, i32, ptr } = FFIType;

export type KeyRoute = "sendinput" | "postmessage";
export type Binding = { name: string; source: "user_settings" | "default" };

/** The photo-mode key's binding: the player's rebinding in UserSettings.json, else the game's default IK_N. */
export function readPhotoModeBinding(settingsPath = defaultSettingsPath()): Binding {
  try {
    if (settingsPath && existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { data?: { group_name?: string; options?: { name?: string; value?: unknown }[] }[] };
      for (const group of settings.data ?? []) {
        if (!String(group.group_name ?? "").startsWith("/key_bindings/")) continue;
        const option = (group.options ?? []).find((o) => o.name === "photoMode");
        if (option && typeof option.value === "string" && /^IK_[A-Za-z0-9_]{1,24}$/.test(option.value)) return { name: option.value, source: "user_settings" };
      }
    }
  } catch {
    // An unreadable settings file means the default binding.
  }
  return { name: "IK_N", source: "default" };
}

export function defaultSettingsPath(): string {
  const base = process.env.LOCALAPPDATA;
  return base ? join(base, "CD Projekt Red", "Cyberpunk 2077", "UserSettings.json") : "";
}

const NAMED: Record<string, number> = {
  IK_Space: 0x20,
  IK_Home: 0x24,
  IK_End: 0x23,
  IK_Insert: 0x2d,
  IK_Delete: 0x2e,
  IK_PageUp: 0x21,
  IK_PageDown: 0x22,
  IK_Backspace: 0x08,
  IK_Tab: 0x09,
  IK_Tilde: 0xc0,
  IK_Minus: 0xbd,
  IK_Equals: 0xbb,
  IK_LeftBracket: 0xdb,
  IK_RightBracket: 0xdd,
  IK_Semicolon: 0xba,
  IK_SingleQuote: 0xde,
  IK_Comma: 0xbc,
  IK_Period: 0xbe,
  IK_Slash: 0xbf,
  IK_Backslash: 0xdc,
};

/** The Windows virtual-key code for a game key name (IK_A..IK_Z, IK_0..IK_9, IK_F1..IK_F24, IK_NumPad0..9 and a few others), or null. */
export function virtualKey(name: string): number | null {
  let m = /^IK_([A-Z])$/.exec(name);
  if (m) return m[1].charCodeAt(0);
  m = /^IK_([0-9])$/.exec(name);
  if (m) return 0x30 + Number(m[1]);
  m = /^IK_F([0-9]{1,2})$/.exec(name);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 24) return 0x6f + Number(m[1]);
  m = /^IK_NumPad([0-9])$/i.exec(name);
  if (m) return 0x60 + Number(m[1]);
  return NAMED[name] ?? null;
}

// INPUT (x64): DWORD type; 4 bytes padding; union (32 bytes). KEYBDINPUT at offset 8:
// WORD wVk @8, WORD wScan @10, DWORD dwFlags @12, DWORD time @16, 4 bytes padding, ULONG_PTR dwExtraInfo @24.
export const INPUT_SIZE = 40;
export const INPUT_KEYBOARD = 1;
export const KEYEVENTF_KEYUP = 0x0002;
export const KEYEVENTF_SCANCODE = 0x0008;

/** One keyboard INPUT record (scan code only, as a physical key press sends). */
export function keyboardInput(scan: number, up: boolean): Uint8Array {
  const bytes = new Uint8Array(INPUT_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, INPUT_KEYBOARD, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, scan, true);
  view.setUint32(12, KEYEVENTF_SCANCODE | (up ? KEYEVENTF_KEYUP : 0), true);
  return bytes;
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
const { i64 } = FFIType;
function lib() {
  user32 ??= openUser32();
  return user32;
}

export class KeySendError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export type KeySendResult = { route: KeyRoute; focused_by_bridge: boolean; scan_code: number };

/** Sends one key press to one window: the only input the bridge tools ever produce. */
export type KeySender = (target: { hwnd: bigint; pid: number }, vk: number, route: KeyRoute) => Promise<KeySendResult>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const sendKeyToWindow: KeySender = async (target, vk, route) => {
  // Test processes set XFB_NO_INPUT=1: nothing may ever press a key on the test machine's desktop.
  if (process.env.XFB_NO_INPUT === "1") throw new KeySendError("Key input is switched off in this process (XFB_NO_INPUT=1), so nothing was sent.", "input_disabled");
  const u = lib();
  if (!u.IsWindow(target.hwnd)) throw new KeySendError("The game window has gone.", "no_window");
  const owner = new Uint32Array(1);
  u.GetWindowThreadProcessId(target.hwnd, owner);
  if (owner[0] !== target.pid) throw new KeySendError("That window doesn't belong to the game, so nothing was sent.", "wrong_window");
  const scan = u.MapVirtualKeyW(vk, 0) as number; // MAPVK_VK_TO_VSC
  if (!scan) throw new KeySendError("Windows has no scan code for the photo mode key.", "no_scan_code");
  if (route === "postmessage") {
    const WM_KEYDOWN = 0x0100;
    const WM_KEYUP = 0x0101;
    const down = 1n | (BigInt(scan) << 16n);
    const up = down | (1n << 30n) | (1n << 31n);
    if (!u.PostMessageW(target.hwnd, WM_KEYDOWN, BigInt(vk), down)) throw new KeySendError("Windows refused to post the key to the game window.", "send_failed");
    await sleep(80);
    u.PostMessageW(target.hwnd, WM_KEYUP, BigInt(vk), up);
    return { route, focused_by_bridge: false, scan_code: scan };
  }
  let focused = false;
  if ((u.GetForegroundWindow() as bigint) !== target.hwnd) {
    u.SetForegroundWindow(target.hwnd);
    focused = true;
    await sleep(250);
  }
  if ((u.GetForegroundWindow() as bigint) !== target.hwnd) {
    throw new KeySendError("The game window isn't in front, so the key wasn't sent (it would have gone to another program). Click the game window, then try again.", "not_foreground");
  }
  const down = keyboardInput(scan, false);
  if ((u.SendInput(1, down, INPUT_SIZE) as number) !== 1) throw new KeySendError("Windows refused the key press.", "send_failed");
  // Held for a few frames, so the game's input polling sees it even at low frame rates.
  await sleep(80);
  // Release it even if the focus moved meanwhile: a key left down would be worse.
  u.SendInput(1, keyboardInput(scan, true), INPUT_SIZE);
  return { route, focused_by_bridge: focused, scan_code: scan };
};
