// External screenshots of the game window, with crop and area-filter downscale.
//
// Every capture writes two PNGs and a sidecar under the ignored captures/ folder:
//   <stamp>-<name>.full.png  the crop at full resolution (never downscaled)
//   <stamp>-<name>.png       the same crop downscaled for viewing (default long side <= 1280 px)
//   <stamp>-<name>.json      source window size, route, crop, scale and hashes
// A later `recrop` of the saved full-resolution file gives a tighter view without recapturing.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { contactSheet, crop, decodePng, diffStats, downscaleArea, encodePng, fitSize, type Rect } from "./image.ts";
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

function checkName(name: string) {
  if (!NAME_PATTERN.test(name)) throw new CaptureError("A capture name may use only letters, digits, '.', '_' and '-' (up to 80).", "bad_region");
}

function regionRect(region: RegionSpec | undefined, width: number, height: number): Rect {
  try {
    return resolveRegion(region, width, height);
  } catch (error) {
    throw new CaptureError((error as Error).message, "bad_region");
  }
}

function finish(
  pixels: Pixels,
  options: { region?: RegionSpec; view?: ScaleOptions; name?: string; outDir?: string },
  source: Omit<CaptureRecord["source"], "window"> & { window: { width: number; height: number } },
): CaptureRecord {
  const name = options.name ?? "capture";
  checkName(name);
  const rect = regionRect(options.region, pixels.width, pixels.height);
  return finishCropped(crop(pixels, rect), rect, options, source);
}

/** Writes an already-cropped frame (full resolution, view, sidecar) and returns its record. */
function finishCropped(
  cropped: Pixels,
  rect: Rect,
  options: { region?: RegionSpec; view?: ScaleOptions; name?: string; outDir?: string; stamp?: string },
  source: Omit<CaptureRecord["source"], "window"> & { window: { width: number; height: number } },
  capturedAt = new Date(),
): CaptureRecord {
  const name = options.name ?? "capture";
  checkName(name);
  const view = options.view ?? { maxWidth: DEFAULT_VIEW_MAX, maxHeight: DEFAULT_VIEW_MAX };
  const size = fitSize(cropped.width, cropped.height, view);
  const scaled = downscaleArea(cropped, size.width, size.height);

  const outDir = options.outDir ?? DEFAULT_CAPTURE_ROOT;
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `${options.stamp ?? stamp(capturedAt)}-${name}`);
  const full = writeImage(`${base}.full.png`, cropped);
  const viewFile = size.factor === 1 ? { ...full } : writeImage(`${base}.png`, scaled);
  const record: CaptureRecord = {
    name,
    captured_at: capturedAt.toISOString(),
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
  return finish(pixels, options, sourceOf(window, imageName, route));
}

function sourceOf(window: WindowInfo, imageName: string | null, route: Route): CaptureRecord["source"] {
  return {
    pid: window.pid,
    process: imageName,
    title: window.title,
    window: { width: window.width, height: window.height },
    covers_monitor: window.coversMonitor,
    foreground: window.foreground,
    route,
  };
}

/**
 * Grabs the target window once, without writing anything, and returns it downscaled to at most
 * maxWidth pixels wide (area filter). For image checks such as photo.frame's capture route.
 */
export function grabForAnalysis(target: CaptureTarget, maxWidth = 480, route: CaptureOptions["route"] = "auto"): Pixels {
  const window = findWindow(target);
  const imageName = processImageName(window.pid);
  const { pixels } = grabWindow(window, route, imageName?.toLowerCase() === GAME_EXE.toLowerCase());
  const size = fitSize(pixels.width, pixels.height, { maxWidth });
  return downscaleArea(pixels, size.width, size.height);
}

export type BurstFrame = { index: number; at_ms: number; record: CaptureRecord; diff_previous: { mean: number; changed_fraction: number } | null; diff_first: { mean: number; changed_fraction: number } | null };
export type BurstRecord = {
  schema: "xfb/capture-burst-1";
  name: string;
  started_at: string;
  frames_requested: number;
  interval_ms: number;
  /** Actual time of each grab after the first, in milliseconds (the interval is a target). */
  timing: { first_to_last_ms: number; mean_interval_ms: number; max_interval_ms: number };
  crop: Rect & { region: string };
  diff_note: string;
  frames: BurstFrame[];
  contact_sheet: ImageFile;
  manifest: string;
};

/** Frames kept in memory until the burst ends (cropped, full resolution). */
export const BURST_MEMORY_LIMIT = 256 * 1024 * 1024;

/**
 * Captures `frames` pictures of the same area, `intervalMs` apart, for flicker and motion checks.
 * Every frame is grabbed and cropped first and only written afterwards, so the interval isn't
 * stretched by PNG encoding; the crops are kept in memory (at most BURST_MEMORY_LIMIT bytes, or the
 * burst is refused with a plain message). Writes each frame like a screenshot, a contact sheet of
 * every frame, and one manifest (<stamp>-<name>.burst.json) with timings and frame-to-frame
 * differences (measured on the viewing-size copies: mean absolute difference 0-255 and the share of
 * pixels that changed by more than 8).
 */
export async function captureBurst(options: CaptureOptions & { frames: number; intervalMs: number; signal?: AbortSignal }): Promise<BurstRecord> {
  const name = options.name ?? "burst";
  checkName(name);
  if (!(options.frames >= 2 && options.frames <= 120)) throw new CaptureError("A burst takes 2 to 120 frames.", "bad_region");
  const window = findWindow(options.target);
  const imageName = processImageName(window.pid);
  const isGame = imageName?.toLowerCase() === GAME_EXE.toLowerCase();
  const rect = regionRect(options.region, window.width, window.height);
  const bytesPerFrame = rect.width * rect.height * 3;
  if (bytesPerFrame * options.frames > BURST_MEMORY_LIMIT) {
    const fits = Math.max(1, Math.floor(BURST_MEMORY_LIMIT / bytesPerFrame));
    throw new CaptureError(
      `That burst would hold ${Math.round((bytesPerFrame * options.frames) / 1048576)} MB of pictures in memory. Use a smaller region or at most ${fits} frames.`,
      "bad_region",
    );
  }
  const started = new Date();
  const startMs = performance.now();
  const grabs: { pixels: Pixels; at: number; date: Date; route: Route }[] = [];
  for (let i = 0; i < options.frames; i++) {
    if (i > 0) {
      const due = startMs + i * options.intervalMs;
      const wait = due - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (options.signal?.aborted) break;
    }
    const at = performance.now() - startMs;
    const { pixels, route } = grabWindow(window, options.route ?? "auto", isGame);
    if (pixels.width !== window.width || pixels.height !== window.height) {
      throw new CaptureError("The game window changed size during the burst. Keep it still and try again.", "failed");
    }
    grabs.push({ pixels: crop(pixels, rect), at, date: new Date(), route });
  }
  const stampText = stamp(started);
  const outDir = options.outDir ?? DEFAULT_CAPTURE_ROOT;
  const frames: BurstFrame[] = [];
  const views: Pixels[] = [];
  for (const [index, grab] of grabs.entries()) {
    const frameName = `${name}-${String(index + 1).padStart(3, "0")}`;
    const record = finishCropped(grab.pixels, rect, { region: options.region, view: options.view, name: frameName, outDir, stamp: stampText }, sourceOf(window, imageName, grab.route), grab.date);
    const view = decodePng(new Uint8Array(readFileSync(record.view.path)));
    const previous = views.at(-1);
    frames.push({ index: index + 1, at_ms: Math.round(grab.at), record, diff_previous: previous ? diffStats(previous, view) : null, diff_first: views[0] ? diffStats(views[0], view) : null });
    views.push(view);
    grab.pixels = { width: 0, height: 0, rgb: new Uint8Array(0) }; // release the full-resolution crop
  }
  const sheet = contactSheet(views, 1600);
  mkdirSync(outDir, { recursive: true });
  const sheetFile = writeImage(join(outDir, `${stampText}-${name}.sheet.png`), sheet);
  const intervals = frames.slice(1).map((f, i) => f.at_ms - frames[i].at_ms);
  const manifest = join(outDir, `${stampText}-${name}.burst.json`);
  const record: BurstRecord = {
    schema: "xfb/capture-burst-1",
    name,
    started_at: started.toISOString(),
    frames_requested: options.frames,
    interval_ms: options.intervalMs,
    timing: {
      first_to_last_ms: frames.length > 1 ? frames.at(-1)!.at_ms - frames[0].at_ms : 0,
      mean_interval_ms: intervals.length ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0,
      max_interval_ms: intervals.length ? Math.max(...intervals) : 0,
    },
    crop: { ...rect, region: describeRegion(options.region) },
    diff_note: "Differences are measured on the viewing-size copies: mean absolute difference (0-255) and the share of pixels that changed by more than 8 in any channel. A still scene gives near-zero values; flicker shows as spikes against the previous frame.",
    frames,
    contact_sheet: sheetFile,
    manifest,
  };
  writeFileSync(manifest, JSON.stringify(record, null, 2) + "\n");
  return record;
}

const OUTSIDE = "Only captures saved in the XF capture folder can be cropped again.";

/** True when `path` is `root` itself or lies outside it (another drive, a UNC share, `..`). */
function outside(root: string, path: string): boolean {
  const inside = relative(root, path);
  return !inside || isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`) || inside.startsWith("../");
}

// UNC shares (\\server\share), device paths (\\?\, \\.\) and their forward-slash spellings. Refused
// before anything touches the file system, so a path can never make Windows open an SMB connection.
const UNC = /^[\\/]{2}/;

/**
 * Crops and downscales an earlier capture's full-resolution file, without recapturing. Only
 * files inside the capture folder are accepted, so a client can't read arbitrary images: the
 * path is checked as written (no other drive, no UNC or device path, no `..`), then again after
 * resolving junctions and links, before anything is read. The recrop is written beside it.
 */
export function recrop(options: { path: string; region?: RegionSpec; view?: ScaleOptions; name?: string; root?: string }): CaptureRecord {
  const root = resolve(options.root ?? DEFAULT_CAPTURE_ROOT);
  if (typeof options.path !== "string" || UNC.test(options.path.trim())) throw new CaptureError(OUTSIDE, "bad_file");
  const requested = resolve(root, options.path);
  if (UNC.test(requested) || outside(root, requested)) throw new CaptureError(OUTSIDE, "bad_file");
  if (!requested.endsWith(".full.png") || !existsSync(requested)) {
    throw new CaptureError("Pass the .full.png file of an earlier capture.", "bad_file");
  }
  let path: string;
  try {
    const realRoot = realpathSync.native(root);
    path = realpathSync.native(requested);
    if (UNC.test(path) || UNC.test(realRoot) || outside(realRoot, path)) throw new CaptureError(OUTSIDE, "bad_file");
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    throw new CaptureError(OUTSIDE, "bad_file");
  }
  if (!path.endsWith(".full.png")) throw new CaptureError("Pass the .full.png file of an earlier capture.", "bad_file");
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
    derived_from: { path: requested, ...(parent ? { window: parent.source.window, crop: { x: parent.crop.x, y: parent.crop.y, width: parent.crop.width, height: parent.crop.height } } : {}) },
  });
}
