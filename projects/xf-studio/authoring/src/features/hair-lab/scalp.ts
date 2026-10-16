import { scalarBytes } from "../../platform/api/scalar-image";
/** Head-bound scalar maps and cap UV projection. No selected hairstyle becomes the scalp domain. */
import { surfaceProjector } from "./contact";
import { add, clamp, dot, mul, smooth, sub, vertex, type HeadSurface, type Vec3 } from "./types";

/** A coarse cap's chords need clearance too: projecting its vertices alone cuts through a curved head. */
export function fitCapSurface(head: HeadSurface, cap: Pick<HeadSurface, "positions" | "indices" | "uv">) {
  const project = surfaceProjector(head.positions, head.indices), positions: number[] = [], normals: Vec3[] = [];
  const seams = new Map<string, number[]>();
  for (let i = 0; i < cap.positions.length / 3; i++) {
    const hit = project(vertex(cap.positions, i)); normals.push(hit.normal);
    positions.push(...add(hit.point, mul(hit.normal, .0004)));
    const key = vertex(cap.positions, i).map(v => Math.round(v * 1e6)).join(",");
    const group = seams.get(key) ?? []; group.push(i); seams.set(key, group);
  }
  for (let pass = 0; pass < 6; pass++) {
    const lifts = Array(normals.length).fill(0);
    for (let t = 0; t < cap.indices.length; t += 3) {
      const ids = cap.indices.slice(t, t + 3);
      for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4 - a; b++) {
        const weights = [a / 4, b / 4, 1 - (a + b) / 4], p: Vec3 = [0, 0, 0];
        for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) p[k] += positions[ids[j] * 3 + k] * weights[j];
        const hit = project(p), deficit = .0004 - dot(sub(p, hit.point), hit.normal);
        if (deficit > 0) for (const id of ids) lifts[id] = Math.max(lifts[id], deficit * 1.15 / Math.max(.25, dot(normals[id], hit.normal)));
      }
    }
    // UV seams duplicate vertices. They must share the same lift or the fitted surface develops cracks.
    for (const group of seams.values()) { const lift = Math.max(...group.map(i => lifts[i])); for (const i of group) lifts[i] = lift; }
    if (Math.max(...lifts) < .00001) break;
    for (let i = 0; i < lifts.length; i++) for (let k = 0; k < 3; k++) positions[i * 3 + k] += normals[i][k] * lifts[i];
  }
  return { positions, indices: cap.indices, uv: cap.uv };
}

/** High-pass autocorrelation flags repeated holes without mistaking a broad soft edge for a tile. */
export function coveragePattern(mask: { width: number; height: number; values: Uint8Array }) {
  const { width, height, values } = mask, residual = new Float32Array(values.length), valid = new Uint8Array(values.length);
  let energy = 0, count = 0;
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    let sum = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += values[(y + dy) * width + x + dx];
    if (sum / (25 * 255) < .65) continue;
    const i = y * width + x, r = values[i] / 255 - sum / (25 * 255); residual[i] = r; valid[i] = 1; energy += r * r; count++;
  }
  const rms = Math.sqrt(energy / Math.max(1, count)); let correlation = 0, period = 0;
  if (rms > .06) for (let lag = 4; lag <= Math.min(32, width / 3, height / 3); lag++) for (const offset of [lag, lag * width]) {
    let product = 0, aa = 0, bb = 0, pairs = 0;
    for (let i = 0; i < residual.length - offset; i++) if (valid[i] && valid[i + offset] && (offset >= width || i % width + lag < width)) {
      const a = residual[i], b = residual[i + offset]; product += a * b; aa += a * a; bb += b * b; pairs++;
    }
    const score = pairs > 50 ? product / Math.max(1e-12, Math.sqrt(aa * bb)) : 0;
    if (score > correlation) { correlation = score; period = lag; }
  }
  return { rms, correlation, period, periodic: rms > .06 && correlation > .85 };
}

export function scalpRegions(head: HeadSurface) {
  const count = head.positions.length / 3, min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], head.positions[i * 3 + k]); max[k] = Math.max(max[k], head.positions[i * 3 + k]); }
  const centre = min.map((v, k) => (v + max[k]) / 2) as Vec3, size = sub(max, min), front = head.front ?? [0, 0, 1];
  const region = (p: Vec3) => {
    const height = (p[1] - min[1]) / size[1], facing = dot(sub(p, centre), front) / size[2], side = Math.abs(p[0] - centre[0]) / (size[0] * .5);
    const forehead = .72 + .06 * smooth(.18, .38, facing);
    return height < .35 ? "neck" : side > .88 && height < .69 ? "ears" : facing > .06 && height < forehead ? "forehead" : facing > 0 && height < .68 ? "face" : "scalp";
  };
  // A UV-island boundary is not a hairline: the vanilla cap continues across the temple seam.
  const eligible = (i: number) => region(vertex(head.positions, i)) === "scalp";
  return { eligible, region };
}
export function constrainDensity(head: HeadSurface, density: number[]) {
  const regions = scalpRegions(head);
  return density.map((v, i) => regions.eligible(i) ? clamp(v) : 0);
}
export function projectCapDensity(head: HeadSurface): number[] | null {
  const cap = head.cap;
  if (!cap?.indices?.length || !cap.uv?.length || !cap.mask) return null;
  const project = surfaceProjector(cap.points, cap.indices), { width, height } = cap.mask, values = scalarBytes(cap.mask.values);
  const result: number[] = [];
  for (let i = 0; i < head.positions.length / 3; i++) {
    const hit = project(vertex(head.positions, i)), t = hit.triangle!, a = sub(t.b, t.a), b = sub(t.c, t.a), p = sub(hit.point, t.a);
    const aa = dot(a, a), ab = dot(a, b), bb = dot(b, b), pa = dot(p, a), pb = dot(p, b), denominator = aa * bb - ab * ab;
    const v = (bb * pa - ab * pb) / denominator, w = (aa * pb - ab * pa) / denominator, bary = [1 - v - w, v, w];
    const ids = cap.indices.slice(t.index!, t.index! + 3), uv = [0, 0];
    for (let j = 0; j < 3; j++) for (let k = 0; k < 2; k++) uv[k] += cap.uv[ids[j] * 2 + k] * bary[j];
    const x = clamp(uv[0]) * (width - 1), y = clamp(uv[1]) * (height - 1), ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const at = (x: number, y: number) => values[Math.min(height - 1, y) * width + Math.min(width - 1, x)] / 255;
    const alpha = (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
    result.push(alpha * (1 - smooth(.002, .012, Math.sqrt(hit.distanceSquared))));
  }
  return constrainDensity(head, result);
}
export function densityCoverage(head: HeadSurface, density: number[]) {
  const regions = scalpRegions(head), leaked = { ears: 0, face: 0, forehead: 0, neck: 0, nonScalp: 0 };
  for (let i = 0; i < density.length; i++) if (density[i] > .001) {
    const region = regions.region(vertex(head.positions, i));
    if (region !== "scalp") leaked[region]++;
    if (!regions.eligible(i)) leaked.nonScalp++;
  }
  return { ...leaked, passed: Object.values(leaked).every(v => v === 0) };
}
/** Rasterise the authored density on the head's own UV chart; the cap adapter owns colour and blending. */
export function densityMask(head: HeadSurface, density: number[], size = 512) {
  return rasterDensity(head, constrainDensity(head, density), size);
}
function rasterDensity(head: Pick<HeadSurface, "positions" | "indices" | "uv">, safe: number[], size: number, weight: (p: Vec3) => number = () => 1) {
  const values = new Uint8Array(size * size), covered = new Uint8Array(size * size);
  for (let t = 0; t < head.indices.length; t += 3) {
    const ids = head.indices.slice(t, t + 3), uv = ids.map(i => [head.uv[i * 2] * size - .5, head.uv[i * 2 + 1] * size - .5]);
    const [[ax, ay], [bx, by], [cx, cy]] = uv, denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denominator) < 1e-8) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denominator, b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denominator, c = 1 - a - b;
      if (Math.min(a, b, c) >= -1e-5) {
        covered[y * size + x] = 1;
        const p: Vec3 = [0, 0, 0]; for (let k = 0; k < 3; k++) p[k] = a * head.positions[ids[0] * 3 + k] + b * head.positions[ids[1] * 3 + k] + c * head.positions[ids[2] * 3 + k];
        values[y * size + x] = Math.round(clamp(a * safe[ids[0]] + b * safe[ids[1]] + c * safe[ids[2]]) * weight(p) * 255);
      }
    }
  }
  // Extrude chart borders only into unoccupied texels. Bilinear filtering must not reveal UV seams.
  for (let pass = 0; pass < 2; pass++) {
    const pending: [number, number][] = [];
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
      const i = y * size + x; if (covered[i]) continue;
      const neighbours = [i - 1, i + 1, i - size, i + size].filter(j => covered[j]);
      if (neighbours.length) pending.push([i, Math.round(neighbours.reduce((sum, j) => sum + values[j], 0) / neighbours.length)]);
    }
    for (const [i, value] of pending) { covered[i] = 1; values[i] = value; }
  }
  return { width: size, height: size, values };
}

/** Reuse the game's cap topology/UVs, bound to the authored head surface, with our own scalar mask. */
export function capCoverage(head: HeadSurface, density: number[], parting?: { xMetres: number; centre: Vec3; heightMetres: number; strength: number }) {
  const cap = head.coverageSurface;
  if (!cap) return { mask: densityMask(head, density), geometry: null };
  const project = surfaceProjector(head.positions, head.indices), safe = constrainDensity(head, density), values: number[] = [];
  for (let i = 0; i < cap.positions.length / 3; i++) {
    const hit = project(vertex(cap.positions, i)), tri = hit.triangle!, ab = sub(tri.b, tri.a), ac = sub(tri.c, tri.a), ap = sub(hit.point, tri.a);
    const aa = dot(ab, ab), bb = dot(ac, ac), cross = dot(ab, ac), pa = dot(ap, ab), pb = dot(ap, ac), denominator = aa * bb - cross * cross;
    const v = (bb * pa - cross * pb) / denominator, w = (aa * pb - cross * pa) / denominator, ids = head.indices.slice(tri.index!, tri.index! + 3);
    values.push(clamp(safe[ids[0]] * (1 - v - w) + safe[ids[1]] * v + safe[ids[2]] * w));
  }
  const geometry = fitCapSurface(head, cap), regions = scalpRegions(head);
  const mask = rasterDensity(geometry, values, 512, p => {
    if (regions.region(p) !== "scalp") return 0;
    if (!parting) return 1;
    const gate = smooth(.1, .22, (p[1] - parting.centre[1]) / parting.heightMetres) * smooth(-.04, 0, dot(sub(p, parting.centre), head.front ?? [0, 0, 1]));
    return 1 - parting.strength * gate * Math.exp(-(((p[0] - parting.xMetres) / .0012) ** 2));
  });
  // Retain the vanilla reference's fine edge strokes while the authored density controls coverage.
  const detail = cap.mask ? scalarBytes(cap.mask.values) : null;
  if (cap.mask && detail) for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    const sx = Math.round(x / (mask.width - 1) * (cap.mask.width - 1)), sy = Math.round(y / (mask.height - 1) * (cap.mask.height - 1));
    mask.values[y * mask.width + x] = Math.round(mask.values[y * mask.width + x] * detail[sy * cap.mask.width + sx] / 255);
  }
  return { mask, geometry };
}
