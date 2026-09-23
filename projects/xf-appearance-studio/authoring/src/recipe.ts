import { convertToBezier, tessellateBezier, interpolatedFeather, type Handles } from "./bezier-path";
import { preparePigmentStrength, type PigmentStrength } from "./pigment-strength";
import type { Finish, Flakes } from "./finish";
export type Point = { u: number; v: number; weight: number; feather?: number; handles?: Handles };
export type Field = {
  u: number;
  v: number;
  du: number;
  dv: number;
  radius: number;
};
export type WarpField = Field & { id: string };
export type Softness = { mode: "uniform" } | { mode: "boundary"; blend: number };
export const DEFAULT_SOFTNESS_BLEND = 0.0000078125;
export const MIN_SOFTNESS_BLEND = 0.0000001;
export const MAX_SOFTNESS_BLEND = 0.001;
export const MIN_FEATHER = 0.0005;
export const MAX_FEATHER = 0.06;
export type Strength = { mode: "legacy-nearest" } | { mode: "smooth-boundary"; blend: number };
export const DEFAULT_STRENGTH_BLEND = 0.0005;
export const MIN_STRENGTH_BLEND = 0.000125;
export const MAX_STRENGTH_BLEND = 0.02;
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
  pathMode: "catmull-rom" | "bezier";
  points: Point[];
  fields: WarpField[];
  strength: Strength;
  softness: Softness;
};
export type Recipe = {
  schema: "xfs/recipe-6";
  uv: "gltf-uv0-top-left";
  layers: Layer[];
};
// Operational import/preview budget, separate from preset catalogue size.
export const MAX_LAYERS = 32;
export const MAX_FIELDS = 8;
export const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n));
export function initialRecipe(): Recipe {
  return {
    schema: "xfs/recipe-6",
    uv: "gltf-uv0-top-left",
    layers: Array.from({ length: 4 }, (_, i) => convertToBezier({
      id: `layer-${i + 1}`,
      name: ["Petal wash", "Fine wing", "Inner light", "Accent"][i],
      enabled: i === 0,
      color: ["#905774", "#201b29", "#d4ae86", "#328c94"][i],
      finish: i === 2 ? "regular" : "matte",
      opacity: 0.85,
      strength: { mode: "smooth-boundary", blend: DEFAULT_STRENGTH_BLEND },
      softness: { mode: "uniform" },
      feather: i === 1 ? 0.0015 : 0.012,
      symmetry: true,
      pathMode: "catmull-rom",
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
  type ImportedLayer = Omit<Layer, "fields" | "strength" | "pathMode" | "softness"> & { field?: Field; fields?: WarpField[]; strength?: Strength; pathMode?: Layer["pathMode"]; softness?: Softness };
  const r = value as { schema: string; uv: Recipe["uv"]; layers: ImportedLayer[] };
  if (
    !r ||
    !["eye-artistry/recipe-1", "xfs/recipe-2", "xfs/recipe-3", "xfs/recipe-4", "xfs/recipe-5", "xfs/recipe-6"].includes(r.schema) ||
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
      !num(l.feather, MIN_FEATHER, MAX_FEATHER)
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
    const currentSoftness = r.schema === "xfs/recipe-6";
    if (!currentSoftness && ("softness" in l || l.points.some(p => "feather" in p)))
      throw Error("Ambiguous edge softness format.");
    let softness: Softness = {mode: "uniform"};
    if (currentSoftness) {
      const s = l.softness;
      if (!s || typeof s !== "object" || Array.isArray(s) ||
        (s.mode === "uniform" ? Object.keys(s).some(k => k !== "mode") :
          s.mode !== "boundary" || !num(s.blend, MIN_SOFTNESS_BLEND, MAX_SOFTNESS_BLEND) ||
          Object.keys(s).some(k => k !== "mode" && k !== "blend")))
        throw Error("Invalid edge softness settings.");
      softness = s;
      if (l.points.some(p => (s.mode === "boundary" || "feather" in p) && !num(p.feather, MIN_FEATHER, MAX_FEATHER)))
        throw Error("Point edge softness is outside the supported range.");
    }
    const currentPath = r.schema === "xfs/recipe-5" || currentSoftness;
    if (!currentPath && ("pathMode" in l || l.points.some(p => "handles" in p)))
      throw Error("Ambiguous path format.");
    const pathMode = currentPath ? l.pathMode : "catmull-rom";
    if (pathMode !== "catmull-rom" && pathMode !== "bezier") throw Error("Invalid path mode.");
    for (const p of l.points) {
      const h = p.handles;
      if (pathMode === "catmull-rom") {
        if ("handles" in p) throw Error("Catmull–Rom points cannot contain Bézier handles.");
      } else {
        const vec = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v) &&
          num((v as {u:unknown}).u, -1, 1) && num((v as {v:unknown}).v, -1, 1) &&
          Object.keys(v).every(k => k === "u" || k === "v");
        if (!h || typeof h !== "object" || Array.isArray(h) ||
          !["aligned", "symmetric", "corner"].includes(h.mode) || !vec(h.in) || !vec(h.out) ||
          Object.keys(h).some(k => k !== "in" && k !== "out" && k !== "mode"))
          throw Error("Invalid Bézier handles.");
        const inLength = Math.hypot(h.in.u, h.in.v), outLength = Math.hypot(h.out.u, h.out.v);
        if (h.mode === "symmetric" && (Math.abs(h.in.u + h.out.u) > 1e-10 || Math.abs(h.in.v + h.out.v) > 1e-10))
          throw Error("Symmetric handles must have equal opposite vectors.");
        if (h.mode === "aligned" && inLength > 0 && outLength > 0 &&
          (Math.abs(h.in.u * h.out.v - h.in.v * h.out.u) > 1e-10 * inLength * outLength || h.in.u * h.out.u + h.in.v * h.out.v > 0))
          throw Error("Aligned handles must point in opposite directions.");
      }
    }
    const currentStrength = r.schema === "xfs/recipe-4" || currentPath;
    if (!currentStrength && "strength" in l) throw Error("Ambiguous pigment strength format.");
    let strength: Strength = { mode: "legacy-nearest" };
    if (currentStrength) {
      const s = l.strength;
      if (!s || typeof s !== "object" || Array.isArray(s) ||
        (s.mode === "legacy-nearest" ? Object.keys(s).some(k => k !== "mode") :
          s.mode !== "smooth-boundary" || !num(s.blend, MIN_STRENGTH_BLEND, MAX_STRENGTH_BLEND) ||
          Object.keys(s).some(k => k !== "mode" && k !== "blend")))
        throw Error("Invalid pigment strength settings.");
      strength = s;
    }
    const current = r.schema === "xfs/recipe-3" || currentStrength;
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
    layers.push({ ...settings, fields: fields as WarpField[], strength, pathMode, softness });
  }
  return structuredClone({ ...r, schema: "xfs/recipe-6", layers });
}
export function curve(points: Point[], steps = 10): Point[] {
  if (points.length && points.every(p => p.handles)) return tessellateBezier(points).map(({segment: _segment, t: _t, ...p}) => p);
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
        ...interpolatedFeather(b,c,t),
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
  return preparedCoverage(u, v, l, polygon, prepareLayerStrength(l, polygon), prepareLayerSoftness(l, polygon).width);
}
function prepareLayerStrength(l: Layer, polygon: Point[]): PigmentStrength | undefined {
  // Keep the legacy arithmetic for uniform knots, including its last-bit linear
  // interpolation rounding. This preserves their mask bytes exactly.
  return l.strength.mode === "smooth-boundary" && !l.points.every(p => p.weight === l.points[0].weight)
    ? preparePigmentStrength(polygon, l.strength.blend) : undefined;
}
function prepareLayerSoftness(l: Layer, polygon: Point[]): {maxWidth: number; width: number | PigmentStrength} {
  if (l.softness.mode === "uniform") return {maxWidth: l.feather, width: l.feather};
  const widths = l.points.map(p => p.feather!);
  const min = Math.min(...widths), max = Math.max(...widths);
  // Constant point widths take the same arithmetic path as a global width.
  if (min === max) return {maxWidth: max, width: min};
  const span = max - min;
  const field = preparePigmentStrength(polygon.map(p => ({...p, weight: ((p.feather ?? l.feather) - min) / span})), l.softness.blend);
  return {maxWidth: max, width: (u,v) => min + span * field(u,v)};
}
function preparedCoverage(u: number, v: number, l: Layer, polygon: Point[], strength?: PigmentStrength, softness?: number | PigmentStrength): number {
  return l.symmetry
    ? Math.max(coverageAt(u, v, l, polygon, strength, softness), coverageAt(1 - u, v, l, polygon, strength, softness))
    : coverageAt(u, v, l, polygon, strength, softness);
}
function coverageAt(u: number, v: number, l: Layer, polygon: Point[], strength?: PigmentStrength, softness?: number | PigmentStrength): number {
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
  const feather = typeof softness === "function" ? softness(u,v) : softness ?? l.feather;
  const x = clamp(0.5 + ((inside ? 1 : -1) * Math.sqrt(best)) / feather);
  if (x === 0) return 0;
  return x * x * (3 - 2 * x) * (strength ? strength(u, v) : weight) * l.opacity;
}

/** Raster-only preparation. Keep coverageAt above as the independent scalar
 * reference: these bounds skip only samples whose exact feather result is
 * already zero or one, without approximating either boundary integral. */
function prepareRasterCoverage(l:Layer,polygon:Point[],strength:PigmentStrength|undefined,
  softness:{maxWidth:number;width:number|PigmentStrength}) {
  // Match the scalar loop's closing edge first, including nearest-edge ties.
  const edges=polygon.map((b,i)=>{
    const a=polygon[(i+polygon.length-1)%polygon.length],dx=b.u-a.u,dy=b.v-a.v;
    return {u:a.u,v:a.v,endV:b.v,dx,dy,denominator:dx*dx+dy*dy||1,weight:a.weight,endWeight:b.weight};
  });
  // The width field is min + (max-min)*boundedField. Allow outward roundoff
  // from that expression and from bounds/warp sums; these are rejection bounds,
  // never replacement widths used to compute the authored feather itself.
  const margin=Number.EPSILON*64*Math.max(1,softness.maxWidth,...polygon.flatMap(p=>[Math.abs(p.u),Math.abs(p.v)]));
  const halfWidth=(softness.maxWidth+margin)/2;
  const minU=Math.min(...polygon.map(p=>p.u))-halfWidth,maxU=Math.max(...polygon.map(p=>p.u))+halfWidth,
    minV=Math.min(...polygon.map(p=>p.v))-halfWidth,maxV=Math.max(...polygon.map(p=>p.v))+halfWidth;
  const warpU=l.fields.reduce((sum,f)=>sum+Math.abs(f.du),0)+margin,
    warpV=l.fields.reduce((sum,f)=>sum+Math.abs(f.dv),0)+margin;
  function at(u:number,v:number) {
    if(u<minU-warpU||u>maxU+warpU||v<minV-warpV||v>maxV+warpV)return 0;
    [u,v]=warpFields(u,v,l.fields);
    if(u<minU||u>maxU||v<minV||v>maxV)return 0;
    let inside=false,best=Infinity,weight=1;
    for(const edge of edges){
      if(edge.v>v!==edge.endV>v&&u<edge.dx*(v-edge.v)/edge.dy+edge.u)inside=!inside;
      const du=u-edge.u,dv=v-edge.v,t=clamp((du*edge.dx+dv*edge.dy)/edge.denominator);
      const distance=(du-edge.dx*t)**2+(dv-edge.dy*t)**2;
      if(distance<best){best=distance;weight=edge.weight*(1-t)+edge.endWeight*t;}
    }
    const distance=Math.sqrt(best);
    let x:number;
    if(distance>=halfWidth){if(!inside)return 0;x=1;}
    else {
      const feather=typeof softness.width==="function"?softness.width(u,v):softness.width;
      x=clamp(.5+((inside?1:-1)*distance)/feather);
      if(x===0)return 0;
    }
    return x*x*(3-2*x)*(strength?strength(u,v):weight)*l.opacity;
  }
  return l.symmetry?(u:number,v:number)=>Math.max(at(u,v),at(1-u,v)):at;
}
// Alpha-only design: white RGB provides colour-independent masks and clean edges.
export function createRasterJob(l: Layer, size: number) {
  if (!Number.isInteger(size) || size < 1 || size > 4096) throw Error("Invalid raster size.");
  l = structuredClone(l);
  const data = new Uint8ClampedArray(size * size * 4);
  const polygon = curve(l.points);
  for (let i = 0; i < data.length; i += 4)
    data[i] = data[i + 1] = data[i + 2] = 255;
  const strength = prepareLayerStrength(l, polygon);
  const softness = prepareLayerSoftness(l, polygon);
  const sample=prepareRasterCoverage(l,polygon,strength,softness);
  const pad = softness.maxWidth + l.fields.reduce((sum, f) => sum + Math.hypot(f.du, f.dv), 0);
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
  const x0 = Math.floor(clamp(minU) * size), x1 = Math.ceil(clamp(maxU) * size);
  // At power-of-two sizes both pixel-centre coordinates and 1-u are exact
  // binary fractions. Symmetric pairs therefore invoke identical two samples
  // in reverse order. Reuse that result; arbitrary sizes retain scalar sampling.
  const paired=l.symmetry&&(size&(size-1))===0;
  const workX0=paired?Math.min(x0,size-x1):x0,workX1=paired?Math.ceil(size/2):x1;
  let x = workX0, y = y0, pendingIndex=-1,pendingAlpha=0;
  let done = !l.enabled || x0 >= x1 || y0 >= y1;
  const next=()=>{if(++x>=workX1){x=workX0;if(++y>=y1)done=true;}};
  return { data, get done() { return done; },
    advance(maxPixels: number) {
      if (!(maxPixels > 0) || (!Number.isInteger(maxPixels) && maxPixels !== Infinity)) throw Error("Invalid raster slice size.");
      let count = 0;
      while (!done && count < maxPixels) {
        // Retain the original write budget even when a one-pixel slice splits
        // a pair. Cancellation still cannot publish an incomplete raster.
        if(pendingIndex>=0){data[pendingIndex]=pendingAlpha;pendingIndex=-1;count++;next();continue;}
        const alpha=Math.round(255*sample((x+.5)/size,(y+.5)/size));
        if(x>=x0&&x<x1){data[(y*size+x)*4+3]=alpha;count++;}
        const opposite=size-1-x;
        if(paired&&opposite!==x&&opposite>=x0&&opposite<x1){
          const index=(y*size+opposite)*4+3;
          if(count<maxPixels){data[index]=alpha;count++;}
          else {pendingIndex=index;pendingAlpha=alpha;continue;}
        }
        next();
      }
      return done;
    },
  };
}

// Synchronous compiler/export callers retain the same exact pixel arithmetic.
export function raster(l: Layer, size: number): Uint8ClampedArray<ArrayBuffer> {
  const job = createRasterJob(l, size);
  job.advance(Infinity);
  return job.data;
}
