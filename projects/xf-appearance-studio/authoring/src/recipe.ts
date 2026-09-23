import type { Finish, Flakes } from "./finish";
export type Point = { u: number; v: number; weight: number };
export type Field = {
  u: number;
  v: number;
  du: number;
  dv: number;
  radius: number;
};
export type WarpField = Field & { id: string };
export type Layer = {
  id: string;
  name: string;
  enabled: boolean;
  color: string;
  finish: Finish;
  flakes?: Flakes;
  opacity: number;
  feather: number;
  symmetry: boolean;
  points: Point[];
  fields: WarpField[];
};
export type Recipe = {
  schema: "xfs/recipe-3";
  uv: "gltf-uv0-top-left";
  layers: Layer[];
};
// Operational import/preview budget, separate from preset catalogue size.
export const MAX_LAYERS = 32;
export const MAX_FIELDS = 8;
export const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n));
export function initialRecipe(): Recipe {
  return {
    schema: "xfs/recipe-3",
    uv: "gltf-uv0-top-left",
    layers: Array.from({ length: 4 }, (_, i) => ({
      id: `layer-${i + 1}`,
      name: ["Petal wash", "Fine wing", "Inner light", "Accent"][i],
      enabled: i === 0,
      color: ["#905774", "#201b29", "#d4ae86", "#328c94"][i],
      finish: i === 2 ? "regular" : "matte",
      opacity: 0.85,
      feather: i === 1 ? 0.0015 : 0.012,
      symmetry: true,
      points: (i === 1
        ? [
            [0.31, 0.241],
            [0.36, 0.231],
            [0.423, 0.242],
            [0.454, 0.255],
            [0.392, 0.249],
            [0.345, 0.246],
          ]
        : [
            [0.303, 0.231],
            [0.33, 0.206],
            [0.378, 0.206],
            [0.427, 0.229],
            [0.439, 0.253],
            [0.369, 0.235],
          ]
      ).map(([u, v]) => ({ u, v, weight: 1 })),
      fields: [{ id: `layer-${i + 1}-field-1`, u: 0.342, v: 0.223, du: 0, dv: 0, radius: 0.07 }],
    })),
  };
}
// Bound imported work before it reaches raster loops; imports are atomic.
export function parseRecipe(value: unknown): Recipe {
  type ImportedLayer = Omit<Layer, "fields"> & { field?: Field; fields?: WarpField[] };
  const r = value as { schema: string; uv: Recipe["uv"]; layers: ImportedLayer[] };
  if (
    !r ||
    !["eye-artistry/recipe-1", "xfs/recipe-2", "xfs/recipe-3"].includes(r.schema) ||
    r.uv !== "gltf-uv0-top-left" ||
    !Array.isArray(r.layers) ||
    r.layers.length > MAX_LAYERS ||
    (r.schema === "eye-artistry/recipe-1" && r.layers.length !== 4)
  )
    throw Error(
      `Expected an XF Studio recipe with up to ${MAX_LAYERS} layers, or a legacy four-layer recipe.`,
    );
  const num = (x: unknown, a: number, b: number) =>
    typeof x === "number" && Number.isFinite(x) && x >= a && x <= b;
  const ids = new Set<string>();
  const layers: Layer[] = [];
  for (const l of r.layers) {
    if (
      !l ||
      typeof l !== "object" ||
      typeof l.id !== "string" ||
      !l.id.trim() ||
      l.id.length > 80 ||
      ids.has(l.id) ||
      typeof l.name !== "string" ||
      !l.name.trim() ||
      l.name.length > 80 ||
      !/^#[0-9a-f]{6}$/i.test(l.color) ||
      !["matte", "regular", "shimmer", "glitter", "satin", "metallic", "glossy", "iridescent"].includes(
        l.finish,
      ) ||
      typeof l.enabled !== "boolean" ||
      typeof l.symmetry !== "boolean" ||
      !num(l.opacity, 0, 1) ||
      !num(l.feather, 0.0005, 0.06)
    )
      throw Error("Invalid layer settings.");
    ids.add(l.id);
    if (
      l.flakes !== undefined &&
      (!l.flakes ||
        typeof l.flakes !== "object" ||
        !Number.isInteger(l.flakes.cells) ||
        !num(l.flakes.cells, 32, 256) ||
        !num(l.flakes.density, 0, 1) ||
        !num(l.flakes.tilt, 0, 1) ||
        !Number.isInteger(l.flakes.seed) ||
        !num(l.flakes.seed, 0, 2147483647))
    )
      throw Error("Invalid flake settings.");
    if (
      !Array.isArray(l.points) ||
      l.points.length < 3 ||
      l.points.length > 24 ||
      l.points.some(
        (p) => !p || !num(p.u, 0, 1) || !num(p.v, 0, 1) || !num(p.weight, 0, 1),
      )
    )
      throw Error("Invalid control points (3–24 required).");
    const current = r.schema === "xfs/recipe-3";
    if (current ? "field" in l : "fields" in l)
      throw Error("Ambiguous vector field format.");
    const fields = current ? l.fields : [{ ...l.field, id: `${l.id.slice(0, 72)}-field-1` }];
    if (!Array.isArray(fields) || fields.length > MAX_FIELDS)
      throw Error(`Expected up to ${MAX_FIELDS} vector fields.`);
    const fieldIds = new Set<string>();
    for (const f of fields) {
      if (
        !f ||
        typeof f.id !== "string" ||
        !f.id.trim() ||
        f.id.length > 80 ||
        fieldIds.has(f.id) ||
        !num(f.u, 0, 1) ||
        !num(f.v, 0, 1) ||
        !num(f.du, -0.1, 0.1) ||
        !num(f.dv, -0.1, 0.1) ||
        !num(f.radius, 0.005, 0.2)
      )
        throw Error("Invalid vector field.");
      fieldIds.add(f.id);
    }
    const { field: _legacyField, fields: _fields, ...settings } = l;
    layers.push({ ...settings, fields: fields as WarpField[] });
  }
  return structuredClone({ ...r, schema: "xfs/recipe-3", layers });
}
export function curve(points: Point[], steps = 10): Point[] {
  const out: Point[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[(i + n - 1) % n],
      b = points[i],
      c = points[(i + 1) % n],
      d = points[(i + 2) % n];
    for (let j = 0; j < steps; j++) {
      const t = j / steps,
        t2 = t * t,
        t3 = t2 * t;
      const at = (k: "u" | "v") =>
        0.5 *
        (2 * b[k] +
          (-a[k] + c[k]) * t +
          (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 +
          (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3);
      out.push({
        u: at("u"),
        v: at("v"),
        weight: b.weight * (1 - t) + c.weight * t,
      });
    }
  }
  return out;
}
export function warp(u: number, v: number, field: Field): [number, number] {
  const q = Math.exp(
    -((u - field.u) ** 2 + (v - field.v) ** 2) / (2 * field.radius ** 2),
  );
  return [u - field.du * q, v - field.dv * q];
}
// Each influence is sampled at the original query, never at another field's
// warped result. The sum is independent of field order (up to floating point
// rounding), preserves one-field masks, and does not dilute existing fields.
export function warpFields(u: number, v: number, fields: readonly Field[]): [number, number] {
  let du = 0, dv = 0;
  for (const field of fields) {
    if (field.du === 0 && field.dv === 0) continue;
    const q = Math.exp(
      -((u - field.u) ** 2 + (v - field.v) ** 2) / (2 * field.radius ** 2),
    );
    du += field.du * q;
    dv += field.dv * q;
  }
  return [u - du, v - dv];
}
export function coverage(
  u: number,
  v: number,
  l: Layer,
  polygon = curve(l.points),
): number {
  if (!l.enabled) return 0;
  return l.symmetry
    ? Math.max(coverageAt(u, v, l, polygon), coverageAt(1 - u, v, l, polygon))
    : coverageAt(u, v, l, polygon);
}
function coverageAt(u: number, v: number, l: Layer, polygon: Point[]): number {
  [u, v] = warpFields(u, v, l.fields);
  let inside = false,
    best = Infinity,
    weight = 1;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j],
      b = polygon[i];
    if (
      a.v > v !== b.v > v &&
      u < ((b.u - a.u) * (v - a.v)) / (b.v - a.v) + a.u
    )
      inside = !inside;
    const dx = b.u - a.u,
      dy = b.v - a.v;
    const t = clamp(
      ((u - a.u) * dx + (v - a.v) * dy) / (dx * dx + dy * dy || 1),
    );
    const dist = (u - a.u - dx * t) ** 2 + (v - a.v - dy * t) ** 2;
    if (dist < best) {
      best = dist;
      weight = a.weight * (1 - t) + b.weight * t;
    }
  }
  const x = clamp(0.5 + ((inside ? 1 : -1) * Math.sqrt(best)) / l.feather);
  return x * x * (3 - 2 * x) * weight * l.opacity;
}
// Alpha-only design: white RGB provides colour-independent masks and clean edges.
export function raster(l: Layer, size: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  const polygon = curve(l.points);
  for (let i = 0; i < data.length; i += 4)
    data[i] = data[i + 1] = data[i + 2] = 255;
  if (!l.enabled) return data;
  const pad = l.feather + l.fields.reduce((sum, f) => sum + Math.hypot(f.du, f.dv), 0);
  let minU = Math.min(...polygon.map((p) => p.u)) - pad,
    maxU = Math.max(...polygon.map((p) => p.u)) + pad;
  if (l.symmetry) {
    const a = minU;
    minU = Math.min(minU, 1 - maxU);
    maxU = Math.max(maxU, 1 - a);
  }
  const y0 = Math.floor(
      clamp(Math.min(...polygon.map((p) => p.v)) - pad) * size,
    ),
    y1 = Math.ceil(clamp(Math.max(...polygon.map((p) => p.v)) + pad) * size);
  for (let y = y0; y < y1; y++)
    for (
      let x = Math.floor(clamp(minU) * size);
      x < Math.ceil(clamp(maxU) * size);
      x++
    )
      data[(y * size + x) * 4 + 3] = Math.round(
        255 * coverage((x + 0.5) / size, (y + 0.5) / size, l, polygon),
      );
  return data;
}
