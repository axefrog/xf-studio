/**
 * The Holotable projection (proposal §2): the model at a moment, turned into plain drawing primitives for one camera. Pure: no DOM, no
 * state. The panel writes them as SVG; the same rules feed the agent's text report in the headless service. World axes are the game's:
 * x east, y north, z up, metres.
 */
import type { HoloArea, HoloCameraSample, HoloCell, HoloEvent, HoloSession, HoloSolid, HoloVSample, HoloWorld, Vec3 } from "../types";
import type { HoloLayer } from "../service";
import { solidGeometry, type SolidInstance, SOLID_DRAW_CAP } from "./solid-projection";

export type Style = "grid" | "area" | "venue" | "cell" | "trail" | "v" | "cone" | "camera" | "event" | "event-selected" | "gap" | "label" | "label-muted";
export type Primitive =
  | SolidInstance
  | { kind: "line"; points: [number, number][]; style: Style; opacity: number; closed?: boolean; /** How far into its dash pattern the line starts, in pixels: a line cut at the edge keeps its dashes where they were. */ dashOffset?: number }
  | { kind: "marker"; at: [number, number]; size: number; style: Style; id?: string; shape: "chevron" | "diamond" | "dot"; angle?: number }
  | { kind: "text"; at: [number, number]; text: string; style: Style };

export interface Orbit { yaw: number; pitch: number; distance: number; fov: number }
export const ORBITS = { top: { yaw: -Math.PI / 2, pitch: 1.5, distance: 420, fov: 0.8 }, tilt: { yaw: -2.3, pitch: 0.85, distance: 300, fov: 0.8 }, low: { yaw: -2.3, pitch: 0.32, distance: 170, fov: 0.9 } } satisfies Record<string, Orbit>;

/** The last sample at or before t (binary search over a time-sorted array). */
export function at<T extends { t: number }>(xs: readonly T[], t: number): T | undefined {
  let lo = 0, hi = xs.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (xs[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  return best < 0 ? undefined : xs[best];
}

/** V's path up to t, broken where a gap sits between two samples: nothing is drawn through missing samples. */
export function trail(s: HoloSession, t: number): Vec3[][] {
  const breaks = new Set(s.gaps.map(g => g.to));
  const runs: Vec3[][] = []; let run: Vec3[] = [];
  for (const x of s.v) {
    if (x.t > t) break;
    if (breaks.has(x.t) && run.length) { runs.push(run); run = []; }
    // A stationary recorder can repeat the same point thousands of times; it contributes one geometric vertex.
    const last = run[run.length - 1];
    if (!last || last[0] !== x.position[0] || last[1] !== x.position[1] || last[2] !== x.position[2]) run.push(x.position);
  }
  if (run.length) runs.push(run);
  return runs;
}

const NEAR = 1;
export function camera(target: Vec3, o: Orbit, width: number, height: number) {
  const c: Vec3 = [target[0] + o.distance * Math.cos(o.pitch) * Math.cos(o.yaw), target[1] + o.distance * Math.cos(o.pitch) * Math.sin(o.yaw), target[2] + o.distance * Math.sin(o.pitch)];
  const fl = Math.hypot(target[0] - c[0], target[1] - c[1], target[2] - c[2]) || 1;
  const f = [(target[0] - c[0]) / fl, (target[1] - c[1]) / fl, (target[2] - c[2]) / fl];
  let r = [f[1], -f[0], 0]; const rl = Math.hypot(r[0], r[1]) || 1; r = [r[0] / rl, r[1] / rl, 0];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const focal = (height / 2) / Math.tan(o.fov / 2);
  const view = (p: Vec3) => { const x = p[0] - c[0], y = p[1] - c[1], z = p[2] - c[2]; return [x * r[0] + y * r[1] + z * r[2], x * u[0] + y * u[1] + z * u[2], x * f[0] + y * f[1] + z * f[2]]; };
  const screen = (q: number[]): [number, number] => [width / 2 + focal * q[0] / q[2], height / 2 - focal * q[1] / q[2]];
  const point = (p: Vec3) => { const q = view(p); return q[2] < NEAR ? null : screen(q); };
  const ray = (x: number, y: number) => ({ origin: c, direction: f.map((n, i) => n + r[i] * (x - width / 2) / focal - u[i] * (y - height / 2) / focal) as unknown as Vec3 });
  /**
   * A polyline clipped against the near plane, then against the drawing (plus a margin): only what can be seen, as separate runs.
   * Unclipped, a district outline near the camera projects millions of pixels off-screen, and the browser dashes every one each frame.
   */
  const line = (ps: readonly Vec3[], closed = false): ClippedRun[] => {
    const qs = ps.map(view); if (closed && qs.length) qs.push(qs[0]);
    if (qs.length === 2 && qs[0][2] >= NEAR && qs[1][2] >= NEAR)
      return clipToRect([screen(qs[0]), screen(qs[1])], -MARGIN, -MARGIN, width + MARGIN, height + MARGIN);
    const runs: [number, number][][] = []; let run: [number, number][] = [];
    for (let i = 0; i < qs.length; i++) {
      const a = qs[i], inA = a[2] >= NEAR;
      if (i > 0) {
        const b = qs[i - 1], inB = b[2] >= NEAR;
        if (inA !== inB) { const k = (NEAR - b[2]) / (a[2] - b[2]); const cut = screen([b[0] + (a[0] - b[0]) * k, b[1] + (a[1] - b[1]) * k, NEAR]); run.push(cut); if (!inA) { runs.push(run); run = []; } }
      }
      if (inA) run.push(screen(a));
    }
    if (run.length > 1) runs.push(run);
    return runs.flatMap(r2 => clipToRect(r2, -MARGIN, -MARGIN, width + MARGIN, height + MARGIN));
  };
  /** Screen pixels per metre at a world point (for scale bars and sizes). */
  const scale = (p: Vec3) => { const q = view(p); return q[2] < NEAR ? 0 : focal / q[2]; };
  const clipPolygon = (ps: [number, number][]): [number, number][] => {
    let projected = ps;
    for (const plane of [(p: number[]) => p[0] + MARGIN, (p: number[]) => width + MARGIN - p[0],
      (p: number[]) => p[1] + MARGIN, (p: number[]) => height + MARGIN - p[1]]) projected = cutPolygon(projected, plane) as [number, number][];
    return projected;
  };
  const polygon = (ps: readonly Vec3[]): [number, number][] => clipPolygon(cutPolygon(ps.map(view), q => q[2] - NEAR).map(screen));
  /** Largest projected bound extent, with a frustum rejection. Scalar math avoids eight temporary vectors per candidate. */
  const extent = (ps: readonly Vec3[]): number => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, front = false, behind = false;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const x = p[0] - c[0], y = p[1] - c[1], z = p[2] - c[2], depth = x * f[0] + y * f[1] + z * f[2];
      if (depth < NEAR) { behind = true; continue; }
      front = true;
      const sx = width / 2 + focal * (x * r[0] + y * r[1] + z * r[2]) / depth;
      const sy = height / 2 - focal * (x * u[0] + y * u[1] + z * u[2]) / depth;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    if (!front) return 0;
    if (behind) return Math.max(width, height); // Near-plane crossing: exact clipping follows selection.
    if (x1 < -MARGIN || x0 > width + MARGIN || y1 < -MARGIN || y0 > height + MARGIN) return 0;
    return Math.max(x1 - x0, y1 - y0);
  };
  /** Renderer-owned scratch buffers avoid per-vertex/per-edge allocations in Canvas. */
  const projectInto = (ps: readonly Vec3[], xy: Float64Array, depths: Float64Array) => {
    let inside = true;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], x = p[0] - c[0], y = p[1] - c[1], z = p[2] - c[2], depth = x * f[0] + y * f[1] + z * f[2];
      depths[i] = depth;
      xy[i * 2] = width / 2 + focal * (x * r[0] + y * r[1] + z * r[2]) / depth;
      xy[i * 2 + 1] = height / 2 - focal * (x * u[0] + y * u[1] + z * u[2]) / depth;
      if (depth < NEAR || xy[i * 2] < -MARGIN || xy[i * 2] > width + MARGIN || xy[i * 2 + 1] < -MARGIN || xy[i * 2 + 1] > height + MARGIN) inside = false;
    }
    return inside;
  };
  /** Conservative projected cube around a sphere: safe upper bound for rejecting insignificant candidates. */
  const horizontalPlane = Math.hypot(focal, width / 2 + MARGIN), verticalPlane = Math.hypot(focal, height / 2 + MARGIN);
  const boundExtent = (p: Vec3, radius: number) => {
    const x = p[0] - c[0], y = p[1] - c[1], z = p[2] - c[2], depth = x * f[0] + y * f[1] + z * f[2];
    const horizontal = x * r[0] + y * r[1] + z * r[2], vertical = x * u[0] + y * u[1] + z * u[2];
    if (depth + radius < NEAR || (width / 2 + MARGIN) * depth - Math.abs(horizontal) * focal < -radius * horizontalPlane ||
      (height / 2 + MARGIN) * depth - Math.abs(vertical) * focal < -radius * verticalPlane) return 0;
    if (depth <= radius + NEAR) return Infinity;
    const across = Math.max(radius, Math.abs(horizontal), Math.abs(vertical));
    return 2 * radius * focal * (depth + across) / (depth * depth - radius * radius);
  };
  return { point, line, polygon, clipPolygon, extent, boundExtent, projectInto, scale, ray, position: c, target, width, height };
}

export interface Scene { primitives: Primitive[]; solids: readonly SolidInstance[]; solidCamera: ReturnType<typeof camera>; v?: HoloVSample; cam?: HoloCameraSample; camStale: boolean; vStale: boolean; recent: HoloEvent[]; inGap: boolean; metresPerBar: number; barPx: number; solidsDrawn: number; solidsCut: number }
const EMPTY_SOLIDS: readonly HoloSolid[] = [];
// Two recent camera states per immutable world snapshot; yaw changes in the recorded data do not change the city camera.
const solidViews = new WeakMap<readonly HoloSolid[], Map<string, { instances: SolidInstance[]; cut: number }>>();
type PreparedSolid = { solid: HoloSolid; geometry: ReturnType<typeof solidGeometry> };
const sizeOrder = new WeakMap<readonly HoloSolid[], readonly PreparedSolid[]>();
const distanceViews = new WeakMap<readonly HoloSolid[], { target: string; eligible: { prepared: PreparedSolid; distance: number }[] }>();

/** The model at moment t, projected for an orbit around V (or the first sample, before V's first sample). */
export function project(s: HoloSession, world: HoloWorld, t: number, layers: Readonly<Record<HoloLayer, boolean>>, orbit: Orbit,
  width: number, height: number, selected: string | null, focus?: Vec3, prepared?: { instances: SolidInstance[]; cut: number }): Scene {
  const v = at(s.v, t) ?? s.v[0], cam = at(s.camera, t);
  const target: Vec3 = focus ?? (v ? v.position : [0, 0, 0]);
  const C = camera(target, orbit, width, height), out: Primitive[] = [];
  const fade = (p: Vec3) => { const d = Math.hypot(p[0] - C.position[0], p[1] - C.position[1], p[2] - C.position[2]); return Math.max(0.15, Math.min(1, 1.3 - d / (orbit.distance * 2.6))); };
  const lines = (ps: readonly Vec3[], style: Style, opacity: number, closed = false) => { for (const r of C.line(ps, closed)) out.push({ kind: "line", points: r.points, style, opacity, dashOffset: r.offset }); };

  // The metric ground grid at V's height: there is no terrain decoded yet, so the floor is honest about it.
  const z = target[2] - 0.05, span = 300, step = 20;
  for (let k = -span; k <= span; k += step) {
    const strong = k % 100 === 0 ? 1 : 0.55;
    lines([[target[0] - span, snap(target[1]) + k, z], [target[0] + span, snap(target[1]) + k, z]], "grid", strong * 0.5);
    lines([[snap(target[0]) + k, target[1] - span, z], [snap(target[0]) + k, target[1] + span, z]], "grid", strong * 0.5);
  }
  if (layers.cells) for (const c of world.cells) {
    const cx = (c.min[0] + c.max[0]) / 2, cy = (c.min[1] + c.max[1]) / 2;
    if (Math.hypot(cx - target[0], cy - target[1]) <= CELL_RADIUS) box(c, (ps, o) => lines(ps, "cell", o * fade(ps[0])));
  }
  if (layers.areas) for (const a of world.areas) plate(a, target, (ps, style, o) => lines(ps, style, o * fade(ps[0]), true));
  // Significance follows distance/frustum culling: buildings and walls win over small nearby props.
  const source = layers.solids ? world.solids ?? EMPTY_SOLIDS : EMPTY_SOLIDS, key = JSON.stringify([target, orbit, width, height]);
  let views = solidViews.get(source); if (!views) solidViews.set(source, views = new Map());
  let geometry = prepared ?? views.get(key);
  if (!geometry) {
    const nearby = significantVisible(source, target, C);
    const visible = nearby.kept.sort((a, b) => distance2(b.solid.center, C.position) - distance2(a.solid.center, C.position));
    geometry = { instances: visible.map(({ solid, extent }) => ({ kind: "solid", id: solid.id, source: solid, opacity: fade(solid.center), extentPx: extent })), cut: nearby.total - visible.length };
    views.set(key, geometry); if (views.size > 2) views.delete(views.keys().next().value!);
  }
  out.push(...geometry.instances);
  if (layers.v) for (const run of trail(s, t)) lines(run.map(p => [p[0], p[1], p[2] + 0.3] as Vec3), "trail", 0.85);
  if (layers.gaps) for (const g of s.gaps) if (g.from <= t) {
    const a = at(s.v, g.from), b = at(s.v, g.to);
    if (a && b && b.t <= t) lines([a.position, b.position], "gap", 1);
  }
  // Each channel is judged on its own freshness: a camera sample older than STALE_S isn't drawn as current.
  const camStale = !!cam && t - cam.t > STALE_S;
  if (layers.camera && cam && !camStale) frustum(cam, C, out);
  if (layers.events) for (const e of s.events) if (e.at && e.t <= t) {
    const p = C.point(e.at); if (!p) continue;
    const isSel = e.id === selected;
    out.push({ kind: "marker", at: p, size: isSel ? 8 : 6, style: isSel ? "event-selected" : "event", id: e.id, shape: "diamond" });
    if (isSel || t - e.t < 6) out.push({ kind: "text", at: [p[0] + 10, p[1] - 10], text: e.summary, style: "label-muted" });
  }
  if (layers.v && v) {
    const p = C.point([v.position[0], v.position[1], v.position[2] + 0.3]);
    if (p) {
      // The game's yaw is anticlockwise from +Y; project a point ahead to get the on-screen angle.
      const ahead = C.point([v.position[0] - Math.sin(v.yaw * Math.PI / 180) * 4, v.position[1] + Math.cos(v.yaw * Math.PI / 180) * 4, v.position[2] + 0.3]);
      const angle = ahead ? Math.atan2(ahead[1] - p[1], ahead[0] - p[0]) : 0;
      out.push({ kind: "marker", at: p, size: 9, style: "v", id: "v", shape: "chevron", angle });
      out.push({ kind: "text", at: [p[0] + 12, p[1] - 12], text: "V", style: "label" });
    }
  }
  // A scale bar that tells the truth: the largest round distance that fits in 140 px at V.
  const ppm = C.scale(target), choice = [5, 10, 20, 50, 100, 200, 500].filter(m => m * ppm <= 140).pop() ?? 5;
  return { primitives: out, solids: geometry.instances, solidCamera: C, v, cam, camStale, vStale: !!v && t - v.t > STALE_S, recent: s.events.filter(e => e.t <= t && t - e.t <= 5),
    inGap: s.gaps.some(g => g.from < t && t < g.to), metresPerBar: choice, barPx: choice * ppm,
    solidsDrawn: geometry.instances.length, solidsCut: geometry.cut };
}

const distance2 = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
/** Bounded min heap: retain the largest screen extents, with stable identities as ties. */
function significantVisible(solids: readonly HoloSolid[], target: Vec3, C: ReturnType<typeof camera>) {
  type Significant = { solid: HoloSolid; extent: number };
  const kept: Significant[] = [];
  const smaller = (a: Significant, b: Significant) => a.extent < b.extent || a.extent === b.extent && a.solid.id > b.solid.id;
  let ordered = sizeOrder.get(solids);
  if (!ordered) sizeOrder.set(solids, ordered = solids.map(solid => ({ solid, geometry: solidGeometry(solid) })).sort((a, b) => b.geometry.radius - a.geometry.radius));
  const targetKey = JSON.stringify(target);
  let distanceView = distanceViews.get(solids);
  if (distanceView?.target !== targetKey) {
    const eligible = [];
    for (const prepared of ordered) {
      const d = distance2(prepared.solid.center, target);
      // A conservative affine bound keeps every drawn point within 350 m, including large shapes crossing the boundary.
      if (d <= 350 * 350 && Math.sqrt(d) + prepared.geometry.radius <= 350) eligible.push({ prepared, distance: d });
    }
    distanceViews.set(solids, distanceView = { target: targetKey, eligible });
  }
  for (const { prepared: { solid, geometry }, distance: d } of distanceView.eligible) {
    const upper = C.boundExtent(solid.center, geometry.radius);
    if (upper < 4 && d > 30 * 30 || kept.length === SOLID_DRAW_CAP && upper < kept[0].extent) continue;
    const extent = C.extent(geometry.corners);
    if (!extent || extent < 4 && d > 30 * 30) continue;
    if (kept.length < SOLID_DRAW_CAP) {
      let i = kept.length; kept.push({ solid, extent });
      while (i > 0) { const p = (i - 1) >> 1; if (!smaller(kept[i], kept[p])) break; const swap = kept[i]; kept[i] = kept[p]; kept[p] = swap; i = p; }
    } else if (extent > kept[0].extent || extent === kept[0].extent && solid.id < kept[0].solid.id) {
      kept[0] = { solid, extent }; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        if (l >= kept.length) break;
        const child = r < kept.length && smaller(kept[r], kept[l]) ? r : l;
        if (!smaller(kept[child], kept[i])) break;
        const swap = kept[i]; kept[i] = kept[child]; kept[child] = swap; i = child;
      }
    }
  }
  return { kept, total: distanceView.eligible.length };
}
function cutPolygon(ps: number[][], plane: (p: number[]) => number): number[][] {
  if (ps.every(p => plane(p) >= 0)) return ps;
  const out: number[][] = [];
  for (let i = 0; i < ps.length; i++) {
    const a = ps[(i + ps.length - 1) % ps.length], b = ps[i], da = plane(a), db = plane(b);
    if ((da >= 0) !== (db >= 0)) { const k = da / (da - db); out.push(a.map((x, j) => x + (b[j] - x) * k)); }
    if (db >= 0) out.push(b);
  }
  return out;
}

/** A sample older than this at the moment shown is stale: drawn faded or not at all, and said so. */
export const STALE_S = 0.5;
/** Streaming cells further than this from V aren't drawn: hundreds of overlapping boxes say nothing at a glance. */
const CELL_RADIUS = 450;

const snap = (x: number) => Math.round(x / 20) * 20;

/** How far past the drawing's edge a clipped line still runs, in pixels: enough that no stroke or dash ends visibly at the edge. */
const MARGIN = 32;

/**
 * A screen polyline clipped to a rectangle (Liang–Barsky per segment): the parts inside, as separate runs. A run breaks where a segment
 * leaves the rectangle; a segment wholly outside draws nothing. Each run carries the distance along the whole polyline to its first
 * point, so its dash pattern can continue where the cut-away part left it.
 */
export type ClippedRun = { points: [number, number][]; offset: number };
/** Allocation-free form of the same Liang–Barsky clipping for Canvas edges. */
export function clipSegment(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number,
  draw: (ax: number, ay: number, bx: number, by: number) => void): boolean {
  const dx = bx - ax, dy = by - ay; let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    const p = i === 0 ? -dx : i === 1 ? dx : i === 2 ? -dy : dy;
    const q = i === 0 ? ax - x0 : i === 1 ? x1 - ax : i === 2 ? ay - y0 : y1 - ay;
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; t0 = Math.max(t0, r); }
    else { if (r < t0) return false; t1 = Math.min(t1, r); }
  }
  draw(ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1); return true;
}
export function clipToRect(ps: readonly [number, number][], x0: number, y0: number, x1: number, y1: number): ClippedRun[] {
  if (ps.length === 2) {
    const [a, b] = ps;
    if (a[0] >= x0 && a[0] <= x1 && a[1] >= y0 && a[1] <= y1 && b[0] >= x0 && b[0] <= x1 && b[1] >= y0 && b[1] <= y1)
      return [{ points: [a, b], offset: 0 }];
    if (a[0] < x0 && b[0] < x0 || a[0] > x1 && b[0] > x1 || a[1] < y0 && b[1] < y0 || a[1] > y1 && b[1] > y1) return [];
  }
  const runs: ClippedRun[] = []; let run: [number, number][] = [], offset = 0, along = 0;
  const flush = () => { if (run.length > 1) runs.push({ points: run, offset }); run = []; };
  for (let i = 1; i < ps.length; i++, along += Math.hypot(ps[i - 1][0] - ps[i - 2][0], ps[i - 1][1] - ps[i - 2][1])) {
    const [ax, ay] = ps[i - 1], [bx, by] = ps[i], dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1, inside = true;
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]] as const) {
      if (p === 0) { if (q < 0) { inside = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { inside = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { inside = false; break; } if (r < t1) t1 = r; }
    }
    if (!inside) { flush(); continue; }
    if (!run.length || t0 > 0) { flush(); offset = along + Math.hypot(dx, dy) * t0; run.push(t0 > 0 ? [ax + dx * t0, ay + dy * t0] : [ax, ay]); }
    run.push(t1 < 1 ? [ax + dx * t1, ay + dy * t1] : [bx, by]);
    if (t1 < 1) flush();
  }
  flush();
  return runs;
}

function box(c: HoloCell, draw: (ps: Vec3[], opacity: number) => void) {
  const [x0, y0, z0] = c.min, [x1, y1, z1] = c.max;
  const zl = Math.max(z0, -40), zh = Math.min(z1, z0 + 400); // boxes can run kilometres deep: keep them readable
  draw([[x0, y0, zl], [x1, y0, zl], [x1, y1, zl], [x0, y1, zl], [x0, y0, zl]], 0.35);
  draw([[x0, y0, zh], [x1, y0, zh], [x1, y1, zh], [x0, y1, zh], [x0, y0, zh]], 0.18);
}

function plate(a: HoloArea, target: Vec3, draw: (ps: Vec3[], style: Style, opacity: number) => void) {
  const style: Style = a.kind === "district" ? "area" : "venue";
  // Bands can be hundreds of metres tall; draw the floor at the band's foot near V's height, and the band's top faintly.
  const zlo = Math.max(a.zlo, target[2] - 30), zhi = Math.min(a.zhi, target[2] + 120);
  draw(a.poly.map(p => [p[0], p[1], zlo] as Vec3), style, 0.9);
  if (zhi > zlo + 1) draw(a.poly.map(p => [p[0], p[1], zhi] as Vec3), style, 0.25);
}

function frustum(cam: HoloCameraSample, C: ReturnType<typeof camera>, out: Primitive[]) {
  const len = 30, half = (cam.fov * Math.PI / 180) / 2, w = Math.tan(half) * len, h = w / Math.max(cam.aspect, 0.1);
  const f = cam.forward, u = cam.up, r: Vec3 = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
  const o = cam.position, far = (sx: number, sy: number): Vec3 => [o[0] + f[0] * len + r[0] * w * sx + u[0] * h * sy, o[1] + f[1] * len + r[1] * w * sx + u[1] * h * sy, o[2] + f[2] * len + r[2] * w * sx + u[2] * h * sy];
  const corners = [far(-1, -1), far(1, -1), far(1, 1), far(-1, 1)];
  for (const c of corners) for (const run of C.line([o, c])) out.push({ kind: "line", points: run.points, style: "camera", opacity: 0.6, dashOffset: run.offset });
  for (const run of C.line(corners, true)) out.push({ kind: "line", points: run.points, style: "camera", opacity: 0.6, dashOffset: run.offset });
}

export type { HoloArea, HoloCell };
