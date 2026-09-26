// Window lookup and pixel capture through user32/gdi32/kernel32, via bun:ffi.
//
// Three capture routes, all external to the game (they read what Windows composes; nothing is
// injected into the game process):
//   printwindow         PrintWindow(hwnd, PW_CLIENTONLY | PW_RENDERFULLCONTENT) into a 32-bit DIB.
//                       Reads DWM's copy of the window, so it works while other windows cover it
//                       and it sees DirectX content. A window in exclusive fullscreen has no such
//                       copy and may come back black; so does a window placed entirely off-screen
//                       (observed on Windows 11 26200 with a GDI test window).
//   printwindow-legacy  PrintWindow(hwnd, PW_CLIENTONLY): asks the window to paint itself
//                       (WM_PRINT). Works for GDI windows anywhere, but DirectX content is black.
//   screen              BitBlt from the screen DC over the client rectangle. Captures exactly what
//                       is on the monitor, overlays included, so the window must be on top.
// [doc] Microsoft: PrintWindow (PW_RENDERFULLCONTENT, Windows 8.1+), BitBlt, CreateDIBSection,
// SetProcessDpiAwarenessContext.

import { dlopen, FFIType, toArrayBuffer, type Pointer } from "bun:ffi";

const { u64, u32, i32, i64, ptr } = FFIType;

let libs: ReturnType<typeof openLibs> | null = null;
function openLibs() {
  const user32 = dlopen("user32.dll", {
    FindWindowExW: { args: [u64, u64, ptr, ptr], returns: u64 },
    GetWindowThreadProcessId: { args: [u64, ptr], returns: u32 },
    IsWindowVisible: { args: [u64], returns: i32 },
    IsWindow: { args: [u64], returns: i32 },
    IsIconic: { args: [u64], returns: i32 },
    GetWindow: { args: [u64, u32], returns: u64 },
    GetWindowTextW: { args: [u64, ptr, i32], returns: i32 },
    GetClientRect: { args: [u64, ptr], returns: i32 },
    ClientToScreen: { args: [u64, ptr], returns: i32 },
    GetForegroundWindow: { args: [], returns: u64 },
    MonitorFromWindow: { args: [u64, u32], returns: u64 },
    GetMonitorInfoW: { args: [u64, ptr], returns: i32 },
    GetDC: { args: [u64], returns: u64 },
    ReleaseDC: { args: [u64, u64], returns: i32 },
    PrintWindow: { args: [u64, u64, u32], returns: i32 },
    SetProcessDpiAwarenessContext: { args: [i64], returns: i32 },
  }).symbols;
  const gdi32 = dlopen("gdi32.dll", {
    CreateCompatibleDC: { args: [u64], returns: u64 },
    CreateDIBSection: { args: [u64, ptr, u32, ptr, u64, u32], returns: u64 },
    SelectObject: { args: [u64, u64], returns: u64 },
    BitBlt: { args: [u64, i32, i32, i32, i32, u64, i32, i32, u32], returns: i32 },
    DeleteObject: { args: [u64], returns: i32 },
    DeleteDC: { args: [u64], returns: i32 },
    GdiFlush: { args: [], returns: i32 },
  }).symbols;
  const kernel32 = dlopen("kernel32.dll", {
    OpenProcess: { args: [u32, i32, u32], returns: u64 },
    CloseHandle: { args: [u64], returns: i32 },
    QueryFullProcessImageNameW: { args: [u64, u32, ptr, ptr], returns: i32 },
  }).symbols;
  // Physical pixels: without this, GetClientRect and the DIB are scaled on a high-DPI monitor.
  // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (HANDLE)-4. Fails harmlessly if already set.
  user32.SetProcessDpiAwarenessContext(-4n);
  return { user32, gdi32, kernel32 };
}
function api() {
  libs ??= openLibs();
  return libs;
}

export type WindowInfo = {
  hwnd: bigint;
  pid: number;
  title: string;
  /** Client-area size in physical pixels. */
  width: number;
  height: number;
  /** Client-area origin on the virtual screen. */
  screenX: number;
  screenY: number;
  minimized: boolean;
  foreground: boolean;
  /** The client area exactly covers its monitor (borderless fullscreen or exclusive fullscreen). */
  coversMonitor: boolean;
};

const GW_OWNER = 4;
const MONITOR_DEFAULTTONEAREST = 2;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

function windowTitle(hwnd: bigint): string {
  const buffer = new Uint16Array(512);
  const length = api().user32.GetWindowTextW(hwnd, buffer, buffer.length);
  return Buffer.from(buffer.buffer, 0, Math.max(0, length) * 2).toString("utf16le");
}

function windowPid(hwnd: bigint): number {
  const pid = new Uint32Array(1);
  api().user32.GetWindowThreadProcessId(hwnd, pid);
  return pid[0];
}

/** The executable file name (e.g. "Cyberpunk2077.exe") of a process, or null if it can't be read. */
export function processImageName(pid: number): string | null {
  const { kernel32 } = api();
  const handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) as bigint;
  if (!handle) return null;
  try {
    const buffer = new Uint16Array(1024);
    const size = new Uint32Array([buffer.length]);
    if (!kernel32.QueryFullProcessImageNameW(handle, 0, buffer, size)) return null;
    const full = Buffer.from(buffer.buffer, 0, size[0] * 2).toString("utf16le");
    return full.split(/[\\/]/).pop() ?? null;
  } finally {
    kernel32.CloseHandle(handle);
  }
}

export function describeWindow(hwnd: bigint): WindowInfo | null {
  const { user32 } = api();
  if (!user32.IsWindow(hwnd)) return null;
  const rect = new Int32Array(4);
  if (!user32.GetClientRect(hwnd, rect)) return null;
  const origin = new Int32Array(2);
  user32.ClientToScreen(hwnd, origin);
  const width = rect[2] - rect[0];
  const height = rect[3] - rect[1];

  // MONITORINFO: cbSize, rcMonitor (4 ints), rcWork (4 ints), dwFlags.
  const monitorInfo = new Int32Array(10);
  monitorInfo[0] = 40;
  let coversMonitor = false;
  const monitor = user32.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) as bigint;
  if (monitor && user32.GetMonitorInfoW(monitor, monitorInfo)) {
    const [, left, top, right, bottom] = monitorInfo;
    coversMonitor = origin[0] === left && origin[1] === top && width === right - left && height === bottom - top;
  }
  return {
    hwnd,
    pid: windowPid(hwnd),
    title: windowTitle(hwnd),
    width,
    height,
    screenX: origin[0],
    screenY: origin[1],
    minimized: user32.IsIconic(hwnd) !== 0,
    foreground: (user32.GetForegroundWindow() as bigint) === hwnd,
    coversMonitor,
  };
}

/** Visible, unowned top-level windows, optionally only those of one process. */
export function topLevelWindows(pid?: number): WindowInfo[] {
  const { user32 } = api();
  const out: WindowInfo[] = [];
  let hwnd = 0n;
  for (let guard = 0; guard < 20000; guard++) {
    hwnd = user32.FindWindowExW(0n, hwnd, null, null) as bigint;
    if (!hwnd) break;
    if (!user32.IsWindowVisible(hwnd)) continue;
    if (user32.GetWindow(hwnd, GW_OWNER)) continue;
    if (pid !== undefined && windowPid(hwnd) !== pid) continue;
    const info = describeWindow(hwnd);
    if (info && info.width > 0 && info.height > 0) out.push(info);
  }
  return out;
}

/** The main window of a process: its largest visible, unowned top-level window. */
export function mainWindowOf(pid: number): WindowInfo | null {
  const windows = topLevelWindows(pid).sort((a, b) => b.width * b.height - a.width * a.height);
  return windows[0] ?? null;
}

export type Pixels = {
  width: number;
  height: number;
  /** Tightly packed 8-bit RGB, top row first. */
  rgb: Uint8Array;
};

const SRCCOPY = 0x00cc0020;
const CAPTUREBLT = 0x40000000;
const PW_CLIENTONLY = 1;
const PW_RENDERFULLCONTENT = 2;

/** Grabs the client area of `window` by the given route. Returns null if Windows refused. */
export type Route = "printwindow" | "printwindow-legacy" | "screen";

export function grab(window: WindowInfo, route: Route): Pixels | null {
  const { user32, gdi32 } = api();
  const { width, height } = window;
  // BITMAPINFOHEADER (40 bytes): top-down (negative height), 32 bpp, BI_RGB.
  const header = new DataView(new ArrayBuffer(44));
  header.setUint32(0, 40, true);
  header.setInt32(4, width, true);
  header.setInt32(8, -height, true);
  header.setUint16(12, 1, true);
  header.setUint16(14, 32, true);
  header.setUint32(16, 0, true);

  const source = user32.GetDC(route === "screen" ? 0n : window.hwnd) as bigint;
  if (!source) return null;
  const memory = gdi32.CreateCompatibleDC(source) as bigint;
  const bitsOut = new BigUint64Array(1);
  const bitmap = gdi32.CreateDIBSection(memory, new Uint8Array(header.buffer), 0, bitsOut, 0n, 0) as bigint;
  if (!memory || !bitmap || !bitsOut[0]) {
    if (bitmap) gdi32.DeleteObject(bitmap);
    if (memory) gdi32.DeleteDC(memory);
    user32.ReleaseDC(route === "screen" ? 0n : window.hwnd, source);
    return null;
  }
  const previous = gdi32.SelectObject(memory, bitmap) as bigint;
  try {
    const ok =
      route === "printwindow"
        ? user32.PrintWindow(window.hwnd, memory, PW_CLIENTONLY | PW_RENDERFULLCONTENT)
        : route === "printwindow-legacy"
        ? user32.PrintWindow(window.hwnd, memory, PW_CLIENTONLY)
        : gdi32.BitBlt(memory, 0, 0, width, height, source, window.screenX, window.screenY, SRCCOPY | CAPTUREBLT);
    gdi32.GdiFlush();
    if (!ok) return null;
    const bgra = new Uint8Array(toArrayBuffer(Number(bitsOut[0]) as Pointer, 0, width * height * 4));
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < bgra.length; i += 4, j += 3) {
      rgb[j] = bgra[i + 2];
      rgb[j + 1] = bgra[i + 1];
      rgb[j + 2] = bgra[i];
    }
    return { width, height, rgb };
  } finally {
    gdi32.SelectObject(memory, previous);
    gdi32.DeleteObject(bitmap);
    gdi32.DeleteDC(memory);
    user32.ReleaseDC(route === "screen" ? 0n : window.hwnd, source);
  }
}

/** True when every sampled pixel is pure black: what a failed capture returns. */
export function looksBlank(pixels: Pixels): boolean {
  const { rgb } = pixels;
  const step = Math.max(3, Math.floor(rgb.length / 3 / 20000) * 3);
  for (let i = 0; i < rgb.length; i += step) {
    if (rgb[i] !== 0 || rgb[i + 1] !== 0 || rgb[i + 2] !== 0) return false;
  }
  return true;
}
