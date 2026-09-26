// External screenshots of the game window, with crop and area-filter downscale.
//
// Every capture writes two PNGs and a sidecar under the ignored captures/ folder:
//   <stamp>-<name>.full.png  the crop at full resolution (never downscaled)
//   <stamp>-<name>.png       the same crop downscaled for viewing (default long side <= 1280 px)
//   <stamp>-<name>.json      source window size, route, crop, scale and hashes
// A later `recrop` of the saved full-resolution file gives a tighter view without recapturing.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { crop, decodePng, downscaleArea, encodePng, fitSize, type Rect } from "./image.ts";
import { describeRegion, resolveRegion, type RegionSpec } from "./regions.ts";
import { describeWindow, grab, looksBlank, mainWindowOf, processImageName, topLevelWindows, type Pixels, type Route, type WindowInfo } from "./win32.ts";

export const GAME_EXE = "Cyberpunk2077.exe";
export const DEFAULT_VIEW_MAX = 1280;
export const DEFAULT_CAPTURE_ROOT = resolve(import.meta.dir, "..", "..", "captures");

export type CaptureTarget =
  | { pid: number } // the game's process id, normally from the bridge's session.json
  | { hwnd: bigint } // a specific window (tests)
  | { processName: string }; // first process with this executable name

export type ScaleOptions = { maxWidth?: number; maxHeight?: number; scale?: number };

export type CaptureOptions = {
  target: CaptureTarget;
  region?: RegionSpec;
  view?: ScaleOptions;
  route?: "auto" | Route;
  name?: string;
  outDir?: string;
};

export type ImageFile = { path: string; width: number; height: number; bytes: number; sha256: string };

export type CaptureRecord = {
  name: string;
  captured_at: string;
  source: {
    pid: number;
    process: string | null;
    title: string;
    window: { width: number; height: number };
    covers_monitor: boolean;
    foreground: boolean;
    route: Route | "file";
    /** For a recrop: the file it was cut from, and that capture's own window and crop. */
    derived_from?: { path: string; window?: { width: number; height: number }; crop?: Rect };
  };
  crop: Rect & { region: string; requested?: RegionSpec };
  scale: { factor: number; filter: "area"; max_width?: number; max_height?: number; scale?: number };
  full: ImageFile;
  view: ImageFile;
};

export class CaptureError extends Error {
  constructor(
    message: string,
    readonly code: "no_window" | "minimized" | "blank" | "failed" | "bad_region" | "bad_file",
  ) {
    super(message);
  }
}

const NAME_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function findWindow(target: CaptureTarget): WindowInfo {
  if ("hwnd" in target) {
    const info = describeWindow(target.hwnd);
    if (!info) throw new CaptureError("That window no longer exists.", "no_window");
    return info;
  }
  if ("pid" in target) {
    const info = mainWindowOf(target.pid);
    if (!info) throw new CaptureError("The game has no visible window to capture. Is it still starting, or minimised to the tray?", "no_window");
    return info;
  }
  const wanted = target.processName.toLowerCase();
  const pids = new Set(topLevelWindows().map((w) => w.pid));
  for (const pid of pids) {
    if (processImageName(pid)?.toLowerCase() === wanted) {
      const info = mainWindowOf(pid);
      if (info) return info;
    }
  }
  throw new CaptureError(`No ${target.processName} window was found. Is the game running?`, "no_window");
}

function grabWindow(window: WindowInfo, route: CaptureOptions["route"], isGame: boolean): { pixels: Pixels; route: Route } {
  if (window.minimized) throw new CaptureError("The game window is minimised. Restore it, then try again.", "minimized");
  if (route && route !== "auto") {
    const pixels = grab(window, route);
    if (!pixels) throw new CaptureError("Windows refused the capture.", "failed");
    if (looksBlank(pixels)) {
      throw new CaptureError("Windows returned an empty (black) picture for the game window. Borderless windowed mode captures most reliably.", "blank");
    }
    return { pixels, route };
  }
  // Auto: DWM's copy first. The legacy WM_PRINT route shows DirectX content as black, so it is
  // tried only for non-game windows (tests, tools).
  const attempts: Route[] = isGame ? ["printwindow"] : ["printwindow", "printwindow-legacy"];
  for (const attempt of attempts) {
    const pixels = grab(window, attempt);
    if (pixels && !looksBlank(pixels)) return { pixels, route: attempt };
  }
  // Screen route: only meaningful while the window is on top, or we would capture whatever covers it.
  if (!window.foreground) {
    throw new CaptureError(
      "Windows returned an empty picture for the game window, and the game is not the front window, so a screen grab would show something else. Bring the game to the front (or switch it to borderless windowed) and try again.",
      "blank",
    );
  }
  const pixels = grab(window, "screen");
  if (!pixels) throw new CaptureError("Windows refused the screen capture.", "failed");
  if (looksBlank(pixels)) throw new CaptureError("The captured picture is completely black. Is the game showing a loading screen?", "blank");
  return { pixels, route: "screen" };
}
function writeImage(path: string, pixels: Pixels): ImageFile {
  const png = encodePng(pixels);
  writeFileSync(path, png);
  return { path, width: pixels.width, height: pixels.height, bytes: png.length, sha256: sha256(png) };
}

function stamp(date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}

function finish(
  pixels: Pixels,
  options: { region?: RegionSpec; view?: ScaleOptions; name?: string; outDir?: string },
  source: Omit<CaptureRecord["source"], "window"> & { window: { width: number; height: number } },
): CaptureRecord {
  const name = options.name ?? "capture";
  if (!NAME_PATTERN.test(name)) throw new CaptureError("A capture name may use only letters, digits, '.', '_' and '-' (up to 80).", "bad_region");
  let rect: Rect;
  try {
    rect = resolveRegion(options.region, pixels.width, pixels.height);
  } catch (error) {
    throw new CaptureError((error as Error).message, "bad_region");
  }
  const cropped = crop(pixels, rect);
  const view = options.view ?? { maxWidth: DEFAULT_VIEW_MAX, maxHeight: DEFAULT_VIEW_MAX };
  const size = fitSize(cropped.width, cropped.height, view);
  const scaled = downscaleArea(cropped, size.width, size.height);

  const outDir = options.outDir ?? DEFAULT_CAPTURE_ROOT;
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `${stamp()}-${name}`);
  const full = writeImage(`${base}.full.png`, cropped);
  const viewFile = size.factor === 1 ? { ...full } : writeImage(`${base}.png`, scaled);
  const record: CaptureRecord = {
    name,
    captured_at: new Date().toISOString(),
    source,
    crop: { ...rect, region: describeRegion(options.region), ...(options.region ? { requested: options.region } : {}) },
    scale: {
      factor: Number(size.factor.toFixed(6)),
      filter: "area",
      ...(view.maxWidth !== undefined ? { max_width: view.maxWidth } : {}),
      ...(view.maxHeight !== undefined ? { max_height: view.maxHeight } : {}),
      ...(view.scale !== undefined ? { scale: view.scale } : {}),
    },
    full,
    view: viewFile,
  };
  writeFileSync(`${base}.json`, JSON.stringify(record, null, 2) + "\n");
  return record;
}

/** Captures the target window, crops, downscales and saves. Throws CaptureError with plain text. */
export function captureWindow(options: CaptureOptions): CaptureRecord {
  const window = findWindow(options.target);
  const imageName = processImageName(window.pid);
  const { pixels, route } = grabWindow(window, options.route ?? "auto", imageName?.toLowerCase() === GAME_EXE.toLowerCase());
  return finish(pixels, options, {
    pid: window.pid,
    process: imageName,
    title: window.title,
    window: { width: window.width, height: window.height },
    covers_monitor: window.coversMonitor,
    foreground: window.foreground,
    route,
  });
}

/**
 * Crops and downscales an earlier capture's full-resolution file, without recapturing. Only
 * files inside the capture folder are accepted, so a client can't read arbitrary images.
 */
export function recrop(options: { path: string; region?: RegionSpec; view?: ScaleOptions; name?: string; root?: string }): CaptureRecord {
  const root = resolve(options.root ?? DEFAULT_CAPTURE_ROOT);
  const path = resolve(options.path);
  const inside = relative(root, path);
  if (!inside || inside.startsWith("..") || inside.includes(`..${sep}`) || resolve(root, inside) !== path) {
    throw new CaptureError("Only captures saved in the XF capture folder can be cropped again.", "bad_file");
  }
  if (!path.endsWith(".full.png") || !existsSync(path)) {
    throw new CaptureError("Pass the .full.png file of an earlier capture.", "bad_file");
  }
  const pixels = decodePng(new Uint8Array(readFileSync(path)));
  const sidecar = path.replace(/\.full\.png$/, ".json");
  const parent = existsSync(sidecar) ? (JSON.parse(readFileSync(sidecar, "utf8")) as CaptureRecord) : null;
  // A recrop's pixel/normalised rectangle refers to the saved image, not the original window.
  return finish(pixels, { region: options.region, view: options.view, name: options.name ?? `${basename(path, ".full.png").replace(/^\d{8}-\d{6}-\d{3}-/, "")}-recrop`, outDir: dirname(path) }, {
    pid: parent?.source.pid ?? 0,
    process: parent?.source.process ?? null,
    title: parent?.source.title ?? "",
    window: { width: pixels.width, height: pixels.height },
    covers_monitor: parent?.source.covers_monitor ?? false,
    foreground: parent?.source.foreground ?? false,
    route: "file",
    derived_from: { path, ...(parent ? { window: parent.source.window, crop: { x: parent.crop.x, y: parent.crop.y, width: parent.crop.width, height: parent.crop.height } } : {}) },
  });
}
