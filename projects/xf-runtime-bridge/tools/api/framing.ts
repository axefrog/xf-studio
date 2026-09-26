// photo.frame: frames V in photo mode without hand-tuned offsets.
//
// Photo mode has no camera position setter; framing comes from V's placement in front of the camera
// (the pose tab's rotation, left/right and up/down: keys 7, 8, 37) and the field of view (key 1). The
// first session (26 September 2026) found that fixed values can't work everywhere: they depend on
// where the drone camera spawns relative to V. So photo.frame measures and corrects, in two ways:
//
// 1. Projection (preferred). photo.subject reports V's head in the world (the photo-mode stand-in's
//    "Head" slot plus an anatomical offset for the target), the camera's transform, and the game's
//    own projection of those points onto the screen (CameraSystem.ProjectPoint). The loop turns V to
//    face the camera (a probe tells which way the rotation slider turns), measures how the target
//    moves on screen per unit of left/right and up/down (a small probe of each, a 2x2 Jacobian,
//    refined with Broyden updates), moves the target to the requested screen position, then sets
//    the field of view so a span of `span_m` metres at the target fills the window height (the
//    projection of a point 10 cm above the target gives the current scale; tan(fov/2) scales with
//    it), and centres again. Every read is cheap, so it converges in a handful of steps.
//
// 2. Capture (fallback, coarse). When photo.subject isn't available or gives nonsense, the loop
//    nudges V sideways and up by known amounts and compares window captures. With the world still
//    (photo mode pauses it), only V changes between the captures: the changed pixels outline V, the
//    top of that outline is the top of the head, and the head's width comes from the widest part of
//    the outline within about one head width below the top. The shift between the two captures (by
//    correlation of the head band) gives pixels per unit of each offset. The target point is then
//    estimated from the head outline with fixed proportions (eyes about half a head width below the
//    top of the head, the face centre 0.6 of it), which is why this route is coarse.
//
// Both routes record every step, and the result carries the chosen values and an undo that puts the
// camera and V's placement back as they were before the call.

import type { Pixels } from "../capture/win32.ts";
import { downscaleArea, fitSize } from "../capture/image.ts";

export type Vec3 = { x: number; y: number; z: number };
export type ScreenPoint = { x: number; y: number; z?: number; w?: number };
export type PoseValue = { value: number; min?: number; max?: number; step?: number } | null;
export type SubjectReading = {
  subject: string;
  slot: string;
  approximate: boolean;
  head: Vec3;
  target: Vec3;
  subject_forward: Vec3;
  camera: { position: Vec3; forward: Vec3; right: Vec3; up: Vec3; fov: number; aspect: number };
  screen: { target: ScreenPoint; head: ScreenPoint; center: ScreenPoint; up: ScreenPoint; right: ScreenPoint };
  pose?: Partial<Record<"fov" | "yaw" | "left_right" | "near_far" | "up_down" | "look_at", PoseValue>>;
};

export type Offset = { up: number; forward: number; right: number };

/**
 * Named framings. offset: the target point relative to V's head slot, in metres (up along the
 * world's vertical, forward and right along V's facing). span_m: the world height at the target that
 * fills the window height. The offsets are anatomical estimates for the base body rigs' head joint
 * (at the top of the neck): the eyes about 7.5 cm above it and 9 cm in front. [hypothesis until the
 * next session checks one capture per framing]
 */
export const FRAMINGS = {
  eyes: { description: "Both eyes and brows, filling the eyes region (the window's centre band).", offset: { up: 0.075, forward: 0.09, right: 0 }, span_m: 0.2 },
  face: { description: "The face from chin to hairline, filling the face region.", offset: { up: 0.045, forward: 0.08, right: 0 }, span_m: 0.36 },
  "head-and-shoulders": { description: "Head and shoulders.", offset: { up: -0.1, forward: 0.04, right: 0 }, span_m: 0.8 },
} as const satisfies Record<string, { description: string; offset: Offset; span_m: number }>;
export type FramingName = keyof typeof FRAMINGS;

export type FrameOptions = {
  target: FramingName;
  span_m?: number;
  offset?: Partial<Offset>;
  /** Where the target should sit, as fractions of the window's width and height (default 0.5, 0.5). */
  position?: { x?: number; y?: number };
  /** Turn V to face the camera first (default true). */
  face_camera?: boolean;
  /** Degrees V turns away from facing the camera, counter-clockwise seen from above (light sweeps). */
  yaw_offset?: number;
  method?: "auto" | "project" | "capture";
  max_steps?: number;
  /** Allowed centring error, as a fraction of the window height (default 0.01). */
  tolerance?: number;
};

export type CameraApplied = { name: string; before?: number; after?: number; before_known?: boolean };

/** What the framing loop needs from the game; the command API or a test fake provides it. */
export interface FramingAdapter {
  subject(offset: Offset): Promise<SubjectReading>;
  /** photo.camera.set with absolute values; returns its applied list (with before values). */
  setCamera(values: { fov?: number; subject?: { yaw?: number; left_right?: number; up_down?: number } }): Promise<CameraApplied[]>;
  /** A small capture of the window (capture route only). */
  grab?(): Promise<Pixels>;
  /** The current camera and placement values from the photo-mode menu (capture route, when photo.subject gave nothing). */
  pose?(): Promise<{ fov: number; yaw: number; lr: number; ud: number; ranges?: Partial<Ranges> } | null>;
}

export type FrameStep = { kind: string; values?: Record<string, number>; error?: { x: number; y: number }; size?: number; note?: string };
export type FrameResult = {
  method: "project" | "capture";
  target: FramingName;
  span_m: number;
  offset: Offset;
  position: { x: number; y: number };
  chosen: { fov: number; subject: { yaw: number; left_right: number; up_down: number } };
  residual: { x: number; y: number; size: number };
  converged: boolean;
  steps: FrameStep[];
  subject?: { source: string; slot: string; approximate: boolean };
  notes: string[];
  undo: { method: "photo.camera.set"; params: Record<string, unknown> } | null;
};

export class FramingError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

// --- screen space --------------------------------------------------------------------------------

const DEG = Math.PI / 180;
const finite = (...values: number[]) => values.every((v) => Number.isFinite(v));

function perspective(p: ScreenPoint): { x: number; y: number } {
  const w = p.w;
  if (w !== undefined && Number.isFinite(w) && Math.abs(w) > 1e-6 && Math.abs(w - 1) > 1e-4) return { x: p.x / w, y: p.y / w };
  return { x: p.x, y: p.y };
}

export type ScreenSpace = { kind: "ndc" | "unit" | "pixels"; toFrame: (p: ScreenPoint) => { x: number; y: number } };

/**
 * Works out which screen space ProjectPoint answers in, from the projection of a point straight
 * ahead of the camera (the window's centre) and the directions of camera-up and camera-right, and
 * returns a conversion to frame units: offsets from the window's centre in window heights, x to the
 * right and y downwards.
 */
export function screenSpace(reading: SubjectReading): ScreenSpace {
  const c = perspective(reading.screen.center);
  const t = perspective(reading.screen.target);
  const u = perspective(reading.screen.up);
  const r = perspective(reading.screen.right);
  const aspect = reading.camera.aspect > 0 ? reading.camera.aspect : 16 / 9;
  const sy = u.y - t.y > 0 ? -1 : 1; // up on screen must become negative y
  const sx = r.x - t.x > 0 ? 1 : -1;
  let kind: ScreenSpace["kind"];
  if (Math.abs(c.x) < 0.2 && Math.abs(c.y) < 0.2) kind = "ndc";
  else if (Math.abs(c.x - 0.5) < 0.2 && Math.abs(c.y - 0.5) < 0.2) kind = "unit";
  else kind = "pixels";
  const toFrame = (p: ScreenPoint) => {
    const q = perspective(p);
    if (kind === "ndc") return { x: (sx * (q.x - c.x) * aspect) / 2, y: (sy * (q.y - c.y)) / 2 };
    if (kind === "unit") return { x: sx * (q.x - c.x) * aspect, y: sy * (q.y - c.y) };
    const height = 2 * Math.abs(c.y) || 1;
    return { x: (sx * (q.x - c.x)) / height, y: (sy * (q.y - c.y)) / height };
  };
  return { kind, toFrame };
}

/** Frame measurements of one reading: target position, and the size (in window heights) of 10 cm at the target. */
export function measure(reading: SubjectReading) {
  const space = screenSpace(reading);
  const t = space.toFrame(reading.screen.target);
  const u = space.toFrame(reading.screen.up);
  const scale = Math.hypot(u.x - t.x, u.y - t.y); // window heights per 0.1 m
  return { space, x: t.x, y: t.y, scale };
}

/** Why a reading can't drive the projection route, or null when it can. */
export function readingProblem(reading: SubjectReading | null | undefined): string | null {
  if (!reading || !reading.screen || !reading.camera) return "photo.subject gave no reading";
  const { camera, target } = reading;
  const pts = [reading.screen.target, reading.screen.center, reading.screen.up, reading.screen.right];
  if (!pts.every((p) => p && finite(p.x, p.y))) return "the screen positions aren't numbers";
  const ahead = (target.x - camera.position.x) * camera.forward.x + (target.y - camera.position.y) * camera.forward.y + (target.z - camera.position.z) * camera.forward.z;
  if (!(ahead > 0.05)) return "V's head isn't in front of the camera";
  const m = measure(reading);
  if (!finite(m.x, m.y, m.scale) || m.scale < 1e-5) return "the projection doesn't change with position (the camera system may not report the photo-mode camera)";
  return null;
}

function horizontalAngle(from: Vec3, to: Vec3): number {
  // Signed angle from `from` to `to` in the horizontal plane, degrees, counter-clockwise seen from above.
  const a = Math.atan2(from.x * to.y - from.y * to.x, from.x * to.x + from.y * to.y);
  return a / DEG;
}

const wrap180 = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, digits = 3) => Number(v.toFixed(digits));

// --- the projection route ------------------------------------------------------------------------

type Pose = { fov: number; yaw: number; lr: number; ud: number };
export type Ranges = { fov: [number, number]; yaw: [number, number]; lr: [number, number]; ud: [number, number] };

function poseOf(reading: SubjectReading): { pose: Pose; ranges: Ranges } {
  const p = reading.pose ?? {};
  const v = (x: PoseValue | undefined, fallback: number) => (x && Number.isFinite(x.value) ? x.value : fallback);
  const range = (x: PoseValue | undefined, lo: number, hi: number): [number, number] => [x?.min ?? lo, x?.max ?? hi];
  return {
    pose: { fov: v(p.fov, reading.camera.fov), yaw: v(p.yaw, 0), lr: v(p.left_right, 0), ud: v(p.up_down, 0) },
    ranges: { fov: range(p.fov, 1, 120), yaw: range(p.yaw, -180, 180), lr: range(p.left_right, -5, 5), ud: range(p.up_down, -5, 5) },
  };
}

class UndoTracker {
  private readonly before = new Map<string, number>();
  note(applied: CameraApplied[]) {
    for (const item of applied) {
      if (!this.before.has(item.name) && item.before_known !== false && typeof item.before === "number") this.before.set(item.name, item.before);
    }
  }
  undo(): FrameResult["undo"] {
    if (!this.before.size) return null;
    const params: Record<string, unknown> = {};
    for (const [name, value] of this.before) {
      if (name.startsWith("subject.")) ((params.subject ??= {}) as Record<string, number>)[name.slice(8)] = value;
      else params[name] = value;
    }
    return { method: "photo.camera.set", params };
  }
}

function resolve(options: FrameOptions) {
  const base = FRAMINGS[options.target];
  if (!base) throw new FramingError(`There is no framing called "${options.target}".`, "bad_input");
  const offset: Offset = { ...base.offset, ...(options.offset ?? {}) } as Offset;
  const span = options.span_m ?? base.span_m;
  const position = { x: options.position?.x ?? 0.5, y: options.position?.y ?? 0.5 };
  return { offset, span, position, maxSteps: options.max_steps ?? 6, tolerance: options.tolerance ?? 0.01 };
}

export async function frameByProjection(adapter: FramingAdapter, options: FrameOptions, first?: SubjectReading): Promise<FrameResult> {
  const { offset, span, position, maxSteps, tolerance } = resolve(options);
  const steps: FrameStep[] = [];
  const notes: string[] = [];
  const undo = new UndoTracker();
  let reading = first ?? (await adapter.subject(offset));
  const problem = readingProblem(reading);
  if (problem) throw new FramingError(`Framing by projection isn't possible: ${problem}.`, "no_projection");
  if (reading.approximate) notes.push("V's head slot wasn't found, so the head position is V's position plus a standing head height; framing may be off vertically.");
  const { pose, ranges } = poseOf(reading);
  const aspect = reading.camera.aspect > 0 ? reading.camera.aspect : 16 / 9;
  const want = { x: (position.x - 0.5) * aspect, y: position.y - 0.5 };

  const set = async (values: Partial<Pose>, kind: string) => {
    const payload: { fov?: number; subject?: { yaw?: number; left_right?: number; up_down?: number } } = {};
    if (values.fov !== undefined) payload.fov = round(clamp(values.fov, ...ranges.fov), 2);
    const subject: { yaw?: number; left_right?: number; up_down?: number } = {};
    if (values.yaw !== undefined) subject.yaw = round(clamp(wrap180(values.yaw), ...ranges.yaw), 1);
    if (values.lr !== undefined) subject.left_right = round(clamp(values.lr, ...ranges.lr), 3);
    if (values.ud !== undefined) subject.up_down = round(clamp(values.ud, ...ranges.ud), 3);
    if (Object.keys(subject).length) payload.subject = subject;
    undo.note(await adapter.setCamera(payload));
    if (payload.fov !== undefined) pose.fov = payload.fov;
    if (subject.yaw !== undefined) pose.yaw = subject.yaw;
    if (subject.left_right !== undefined) pose.lr = subject.left_right;
    if (subject.up_down !== undefined) pose.ud = subject.up_down;
    if ((values.lr !== undefined && subject.left_right !== round(values.lr, 3)) || (values.ud !== undefined && subject.up_down !== round(values.ud, 3))) {
      notes.push("V reached the end of the pose tab's left/right or up/down range; the camera may need to start closer to V.");
    }
    reading = await adapter.subject(offset);
    const m = measure(reading);
    steps.push({ kind, values: { fov: pose.fov, yaw: pose.yaw, left_right: pose.lr, up_down: pose.ud }, error: { x: round(want.x - m.x, 4), y: round(want.y - m.y, 4) }, size: round((m.scale * span) / 0.1, 3) });
    return m;
  };

  // 1. Turn V to face the camera (plus yaw_offset).
  if (options.face_camera !== false) {
    const facing = () => {
      const toCamera = { x: reading.camera.position.x - reading.head.x, y: reading.camera.position.y - reading.head.y, z: 0 };
      return horizontalAngle(reading.subject_forward, toCamera);
    };
    const before = { forward: reading.subject_forward };
    const probe = 10;
    await set({ yaw: pose.yaw + probe }, "yaw-probe");
    const turned = horizontalAngle(before.forward, reading.subject_forward); // degrees V turned for +10 on the slider
    const k = Math.abs(turned) > 1 ? turned / probe : 1;
    for (let i = 0; i < 2; i++) {
      const error = facing() - (options.yaw_offset ?? 0);
      if (Math.abs(error) < 1.5) break;
      await set({ yaw: pose.yaw + error / k }, "yaw");
    }
  }

  // 2. Centre, 3. size, 4. centre again.
  let m = measure(reading);
  const probe = clamp(0.05 * (span / 0.36), 0.01, 0.2);
  const m0 = m;
  const mx = await set({ lr: pose.lr + probe }, "probe-left-right");
  const my = await set({ ud: pose.ud + probe }, "probe-up-down");
  let J = [
    [(mx.x - m0.x) / probe, (my.x - mx.x) / probe],
    [(mx.y - m0.y) / probe, (my.y - mx.y) / probe],
  ];
  m = my;
  let budget = maxSteps;
  const centre = async (label: string) => {
    while (budget > 0) {
      const ex = want.x - m.x;
      const ey = want.y - m.y;
      if (Math.hypot(ex, ey) <= tolerance) return true;
      const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
      if (!Number.isFinite(det) || Math.abs(det) < 1e-9) throw new FramingError("Moving V doesn't move V on screen as expected, so framing stopped.", "no_response");
      const dlr = (J[1][1] * ex - J[0][1] * ey) / det;
      const dud = (-J[1][0] * ex + J[0][0] * ey) / det;
      budget--;
      const prev = m;
      m = await set({ lr: pose.lr + dlr, ud: pose.ud + dud }, label);
      // Broyden update of the Jacobian from the step just taken.
      const dx = [dlr, dud];
      const dy = [m.x - prev.x, m.y - prev.y];
      const norm = dlr * dlr + dud * dud;
      if (norm > 1e-12) {
        for (let r = 0; r < 2; r++) {
          const predicted = J[r][0] * dlr + J[r][1] * dud;
          for (let c = 0; c < 2; c++) J[r][c] += ((dy[r] - predicted) * dx[c]) / norm;
        }
      }
    }
    return Math.hypot(want.x - m.x, want.y - m.y) <= tolerance;
  };
  await centre("centre");
  for (let zoom = 0; zoom < 2; zoom++) {
    const size = (m.scale * span) / 0.1; // window heights the span covers now
    if (Math.abs(size - 1) <= 0.03) break;
    const current = Math.tan((pose.fov * DEG) / 2);
    const next = (2 * Math.atan(current * size)) / DEG;
    const clamped = clamp(next, ...ranges.fov);
    if (clamped !== next) notes.push(`The field of view needed (${round(next, 2)}) is outside photo mode's range; the framing is as close as photo mode allows.`);
    m = await set({ fov: clamped }, "zoom");
    const ratio = Math.tan((pose.fov * DEG) / 2) > 0 ? current / Math.tan((pose.fov * DEG) / 2) : 1;
    J = J.map((row) => row.map((v) => v * ratio));
    budget = Math.max(budget, 2);
    await centre("centre-after-zoom");
    if (clamped !== next) break;
  }
  const size = (m.scale * span) / 0.1;
  const residual = { x: round(want.x - m.x, 4), y: round(want.y - m.y, 4), size: round(size, 3) };
  const converged = Math.hypot(residual.x, residual.y) <= tolerance && Math.abs(size - 1) <= 0.05;
  if (!converged) notes.push("The framing didn't fully converge within the step budget; see steps and residual.");
  return {
    method: "project",
    target: options.target,
    span_m: span,
    offset,
    position,
    chosen: { fov: pose.fov, subject: { yaw: pose.yaw, left_right: pose.lr, up_down: pose.ud } },
    residual,
    converged,
    steps,
    subject: { source: reading.subject, slot: reading.slot, approximate: reading.approximate },
    notes,
    undo: undo.undo(),
  };
}

// --- the capture route ---------------------------------------------------------------------------

function luma(p: Pixels): Float32Array {
  const out = new Float32Array(p.width * p.height);
  for (let i = 0, j = 0; j < out.length; i += 3, j++) out[j] = 0.299 * p.rgb[i] + 0.587 * p.rgb[i + 1] + 0.114 * p.rgb[i + 2];
  return out;
}

function percentile(values: Float32Array, q: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

export type Outline = { top: number; headWidth: number; centreX: number; band: [number, number]; cutTop: boolean; pixels: number };

/**
 * Finds V's head in the difference between two captures taken before and after a known sideways
 * nudge. `noise` is a capture taken after nudging back (the same view as `a`), which sets the
 * threshold. Coordinates are in the pictures' pixels; centreX is for picture `a`, given the shift
 * (in pixels) from `a` to `b`.
 */
export function findHead(a: Float32Array, b: Float32Array, noise: Float32Array, width: number, height: number, shift: number): Outline | null {
  const noiseDiff = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) noiseDiff[i] = Math.abs(a[i] - noise[i]);
  const threshold = Math.max(10, percentile(noiseDiff, 0.99) + 6);
  const minX = new Int32Array(height).fill(width);
  const maxX = new Int32Array(height).fill(-1);
  const count = new Int32Array(height);
  let pixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (Math.abs(a[i] - b[i]) > threshold) {
        count[y]++;
        pixels++;
        if (x < minX[y]) minX[y] = x;
        if (x > maxX[y]) maxX[y] = x;
      }
    }
  }
  if (pixels < 0.002 * width * height) return null;
  const minCount = Math.max(2, Math.round(0.004 * width));
  let top = -1;
  for (let y = 0; y < height; y++) {
    if (count[y] >= minCount) {
      top = y;
      break;
    }
  }
  if (top < 0) return null;
  const rowWidth = (y: number) => (maxX[y] >= minX[y] ? maxX[y] - minX[y] + 1 - Math.abs(shift) : 0);
  let w = Math.max(2, rowWidth(Math.min(height - 1, top + 2)));
  let bottom = top;
  for (let i = 0; i < 6; i++) {
    bottom = Math.min(height - 1, top + Math.round(0.9 * w));
    let widest = 0;
    for (let y = top; y <= bottom; y++) widest = Math.max(widest, rowWidth(y));
    if (widest <= w) break;
    w = widest;
  }
  let sum = 0;
  let n = 0;
  for (let y = top; y <= bottom; y++) {
    if (maxX[y] >= minX[y]) {
      sum += (minX[y] + maxX[y]) / 2;
      n++;
    }
  }
  if (!n) return null;
  return { top, headWidth: w, centreX: sum / n - shift / 2, band: [top, bottom], cutTop: top === 0, pixels };
}

/** The shift (in pixels) of picture b against a along one axis, by correlating profiles within a band. */
export function estimateShift(a: Float32Array, b: Float32Array, width: number, height: number, axis: "x" | "y", band: [number, number], maxShift: number): number {
  const along = axis === "x" ? width : height;
  const profile = (img: Float32Array) => {
    const out = new Float32Array(along);
    for (let s = band[0]; s <= band[1]; s++) {
      for (let t = 1; t < along; t++) {
        const i = axis === "x" ? s * width + t : t * width + s;
        const j = axis === "x" ? s * width + t - 1 : (t - 1) * width + s;
        out[t] += Math.abs(img[i] - img[j]);
      }
    }
    return out;
  };
  const pa = profile(a);
  const pb = profile(b);
  const mean = (p: Float32Array) => p.reduce((acc, v) => acc + v, 0) / p.length;
  const ma = mean(pa);
  const mb = mean(pb);
  let best = 0;
  let bestScore = -Infinity;
  for (let s = -maxShift; s <= maxShift; s++) {
    let score = 0;
    let n = 0;
    for (let t = Math.max(0, -s); t < along && t + s < along; t++) {
      if (t + s < 0) continue;
      score += (pa[t] - ma) * (pb[t + s] - mb);
      n++;
    }
    if (n > along / 3 && score / n > bestScore) {
      bestScore = score / n;
      best = s;
    }
  }
  return best;
}

/** Fixed proportions for the capture route: target height below the top of the head, in head widths. */
export const CAPTURE_PROPORTIONS: Record<FramingName, { below_top: number; head_widths_per_span: number }> = {
  eyes: { below_top: 0.55, head_widths_per_span: 0.2 / 0.155 },
  face: { below_top: 0.62, head_widths_per_span: 0.36 / 0.155 },
  "head-and-shoulders": { below_top: 1.1, head_widths_per_span: 0.8 / 0.155 },
};

export async function frameByCapture(adapter: FramingAdapter, options: FrameOptions, start: { fov: number; lr: number; ud: number; yaw: number; ranges?: Partial<Ranges> }): Promise<FrameResult> {
  if (!adapter.grab) throw new FramingError("Capture-based framing needs window captures.", "no_capture");
  const { offset, span, position, maxSteps } = resolve(options);
  const steps: FrameStep[] = [];
  const notes: string[] = ["Framed from window captures (coarse): the target is estimated from V's head outline with fixed proportions."];
  const undo = new UndoTracker();
  const ranges: Ranges = { fov: [1, 120], yaw: [-180, 180], lr: [-5, 5], ud: [-5, 5], ...(start.ranges ?? {}) };
  const pose = { fov: start.fov, lr: start.lr, ud: start.ud, yaw: start.yaw };
  const setPose = async (values: Partial<typeof pose>) => {
    const payload: { fov?: number; subject?: { left_right?: number; up_down?: number } } = {};
    if (values.fov !== undefined) payload.fov = round(clamp(values.fov, ...ranges.fov), 2);
    if (values.lr !== undefined || values.ud !== undefined) {
      payload.subject = {};
      if (values.lr !== undefined) payload.subject.left_right = round(clamp(values.lr, ...ranges.lr), 3);
      if (values.ud !== undefined) payload.subject.up_down = round(clamp(values.ud, ...ranges.ud), 3);
    }
    undo.note(await adapter.setCamera(payload));
    if (payload.fov !== undefined) pose.fov = payload.fov;
    if (payload.subject?.left_right !== undefined) pose.lr = payload.subject.left_right;
    if (payload.subject?.up_down !== undefined) pose.ud = payload.subject.up_down;
  };
  const grab = async () => {
    const p = await adapter.grab!();
    const size = fitSize(p.width, p.height, { maxWidth: 480 });
    const small = size.factor === 1 ? p : downscaleArea(p, size.width, size.height);
    return { w: small.width, h: small.height, l: luma(small) };
  };
  const proportions = CAPTURE_PROPORTIONS[options.target];
  let result: { x: number; y: number; size: number } = { x: NaN, y: NaN, size: NaN };
  const rounds = Math.max(1, Math.min(3, Math.floor(maxSteps / 2)));
  for (let round_ = 0; round_ < rounds; round_++) {
    // Expected shift for the nudge: about 4% of the width at the first-session gain (+1 left/right
    // moved V about 290 px of 3840 at FOV 35), scaled with the field of view.
    const gain0 = 0.0755 * (Math.tan(17.5 * DEG) / Math.tan((pose.fov * DEG) / 2));
    const nudge = clamp(0.04 / gain0, 0.005, 1);
    const a = await grab();
    await setPose({ lr: pose.lr + nudge });
    const b = await grab();
    await setPose({ lr: pose.lr - nudge });
    const c = await grab();
    const maxShift = Math.round(a.w / 4);
    const rough = findHead(a.l, b.l, c.l, a.w, a.h, 0);
    if (!rough) throw new FramingError("V didn't show up as moving in the captures (is the photo-mode menu hidden, and V in view?).", "not_found");
    const sx = estimateShift(a.l, b.l, a.w, a.h, "x", rough.band, maxShift);
    const head = findHead(a.l, b.l, c.l, a.w, a.h, sx) ?? rough;
    await setPose({ ud: pose.ud + nudge });
    const d = await grab();
    await setPose({ ud: pose.ud - nudge });
    const colBand: [number, number] = [Math.max(0, Math.round(head.centreX - head.headWidth / 2)), Math.min(a.w - 1, Math.round(head.centreX + head.headWidth / 2))];
    const sy = estimateShift(a.l, d.l, a.w, a.h, "y", colBand, Math.round(a.h / 4));
    if (Math.abs(sx) < 1 || Math.abs(sy) < 1) throw new FramingError("Nudging V didn't move V measurably in the captures, so framing stopped.", "no_response");
    const gx = sx / nudge; // pixels per unit
    const gy = sy / nudge;
    const targetX = head.centreX;
    const targetY = head.top + proportions.below_top * head.headWidth;
    const wantX = position.x * a.w;
    const wantY = position.y * a.h;
    const sizeNow = (head.headWidth * proportions.head_widths_per_span) / a.h;
    result = { x: round((wantX - targetX) / a.h, 4), y: round((wantY - targetY) / a.h, 4), size: round(sizeNow, 3) };
    steps.push({ kind: "measure", values: { fov: pose.fov, left_right: pose.lr, up_down: pose.ud, head_top: head.top, head_width: head.headWidth, gain_x: round(gx, 2), gain_y: round(gy, 2) }, error: { x: result.x, y: result.y }, size: result.size, ...(head.cutTop ? { note: "the head touches the top edge" } : {}) });
    await setPose({ lr: pose.lr + (wantX - targetX) / gx, ud: pose.ud + (wantY - targetY) / gy });
    steps.push({ kind: "centre", values: { left_right: pose.lr, up_down: pose.ud } });
    if (Math.abs(sizeNow - 1) > 0.05) {
      const next = (2 * Math.atan(Math.tan((pose.fov * DEG) / 2) * sizeNow)) / DEG;
      await setPose({ fov: next });
      steps.push({ kind: "zoom", values: { fov: pose.fov } });
    } else if (Math.hypot(result.x, result.y) < 0.02) {
      break;
    }
  }
  return {
    method: "capture",
    target: options.target,
    span_m: span,
    offset,
    position,
    chosen: { fov: pose.fov, subject: { yaw: pose.yaw, left_right: pose.lr, up_down: pose.ud } },
    residual: result,
    converged: false,
    steps,
    notes,
    undo: undo.undo(),
  };
}

/** photo.frame: the projection route when photo.subject works (method auto or project), else the capture route. */
export async function frame(adapter: FramingAdapter, options: FrameOptions): Promise<FrameResult> {
  const method = options.method ?? "auto";
  const { offset } = resolve(options);
  let reading: SubjectReading | null = null;
  let why = "";
  if (method !== "capture") {
    try {
      reading = await adapter.subject(offset);
      why = readingProblem(reading) ?? "";
    } catch (error) {
      why = (error as Error).message;
    }
    if (!why) return frameByProjection(adapter, options, reading!);
    if (method === "project") throw new FramingError(`Framing by projection isn't possible: ${why}.`, /in front|doesn't change/.test(why) ? "no_projection" : "unavailable");
  }
  const fromReading = reading && reading.pose ? poseOf(reading) : null;
  const menu = fromReading ? null : ((await adapter.pose?.()) ?? null);
  if (!fromReading && !menu) throw new FramingError("The photo-mode menu's current camera values couldn't be read, so framing can't start.", "unavailable");
  const start = fromReading ? { ...fromReading.pose, ranges: fromReading.ranges } : menu!;
  const result = await frameByCapture(adapter, options, start);
  if (options.face_camera !== false || options.yaw_offset) result.notes.push("The capture route can't turn V to face the camera; V's rotation was left as it was (set subject.yaw with photo_camera_set if needed).");
  if (why) result.notes.unshift(`The projection route wasn't available (${why}), so the capture route was used.`);
  return result;
}
