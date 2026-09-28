/** Pure material-map compilation, independent of UI, storage and archive packaging.
 * Each adapter follows an inspected post-G-buffer decal program (see finish-export.ts).
 * None claims equivalence to the browser's separately lit transparent layers.
 */
import { canonicalFinish, defaultFlakes, type LegacyFlakes } from "./finish";
import { bakeShimmerGrain, grainCellsPerTexel, grainPitch, SHIMMER_GRAIN } from "./shimmer-grain";
import {
  flatSurface, fresnelMaterial, planPresetExport, ROUTE_ADAPTER,
  type ExportRoute, type TextureChannel,
} from "./finish-export";
import { HEAD_UV_WINDOW, type UvWindow } from "./plate-uv-window";
import { parseRecipe, raster, rasterWindow, type Layer, type Recipe } from "./recipe";
import type { LayeredMakeupRegion, Mirror, SkinScale } from "./region";

/** What the compiler needs of a feature's region: the layer models it validates with, its mirror and its skin scale (mottle). */
export type CompileRegion = Pick<LayeredMakeupRegion, "models" | "mirror" | "skin">;

export const DECAL_ADAPTER = ROUTE_ADAPTER.flat;
export const srgbToLinear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
export const linearToSrgb = (v: number) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
const byte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
/** GPU UNORM decode of a tangent-normal byte. */
const unorm = (b: number) => b / 255 * 2 - 1;
/** Side of the uniform base-colour texture of a Fresnel preset. */
export const GRADIENT_SIZE = 16;

export class UnsupportedMaterialError extends Error {
  constructor(readonly layers: { id: string; finish: string; reason?: string }[]) {
    super(`Material export needs another adapter for: ${layers.map(l => `${l.id} (${l.finish})`).join(", ")}. The editable recipe is unchanged.`);
  }
}

export type FlatSurface = {
  /** Linear albedo; the inspected game shader stores sqrt(albedo) before blending. */
  color: [number, number, number];
  roughness: number;
  metalness: number;
};
export type MergedSample = FlatSurface & { coverage: number };

/** Bottom-to-top composition in the actual destination-channel encoding.
 * All three contributions use the same coverage; normal contribution is disabled.
 */
export function mergeFlatSample(bottom: MergedSample, top: FlatSurface, alpha: number): MergedSample {
  const retained = bottom.coverage * (1 - alpha), coverage = alpha + retained;
  if (!coverage) return { color: [0, 0, 0], roughness: 0, metalness: 0, coverage: 0 };
  return {
    coverage,
    color: top.color.map((v, i) => ((Math.sqrt(v) * alpha + Math.sqrt(bottom.color[i]) * retained) / coverage) ** 2) as [number, number, number],
    roughness: (top.roughness * alpha + bottom.roughness * retained) / coverage,
    metalness: (top.metalness * alpha + bottom.metalness * retained) / coverage,
  };
}

function checkSize(size: number) {
  if (!Number.isInteger(size) || size < 32 || size > 2048 || (size & (size - 1)))
    throw Error("Texture size must be a power of two from 32 to 2048.");
}

/**
 * Where a compiled map's texels sit in authored UV. `head`: a size × size map of the whole head atlas
 * (the historical layout, byte-identical to it). `window`: a width × height map of one UV rectangle, the
 * plate-local window (plate-uv-window.ts), whose material maps it back with its UV transform constants.
 */
export type TextureSpace =
  | { readonly kind: "head"; readonly size: number }
  | { readonly kind: "window"; readonly width: number; readonly height: number; readonly window: UvWindow };
type Target = { width: number; height: number; window: UvWindow; head: boolean; mirror: Mirror; skin: SkinScale };
function target(space: number | TextureSpace, region: CompileRegion): Target {
  const value: TextureSpace = typeof space === "number" ? { kind: "head", size: space } : space, mirror = region.mirror, skin = region.skin;
  if (value.kind === "head") { checkSize(value.size); return { width: value.size, height: value.size, window: HEAD_UV_WINDOW, head: true, mirror, skin }; }
  const pow2 = (n: number) => Number.isInteger(n) && n >= 32 && n <= 4096 && !(n & (n - 1));
  const w = value.window;
  if (!pow2(value.width) || !pow2(value.height)) throw Error("Window texture sides must be powers of two from 32 to 4096.");
  if (!(w.u0 >= 0 && w.u1 <= 1 && w.v0 >= 0 && w.v1 <= 1 && w.u1 > w.u0 && w.v1 > w.v0)) throw Error("Invalid texture window.");
  return { width: value.width, height: value.height, window: w, head: false, mirror, skin };
}
/** Coverage mask of one layer in the target's texel grid (alpha of white RGBA). */
const layerMask = (layer: Layer, t: Target) => t.head ? raster(layer, t.width, t.mirror, t.skin) : rasterWindow(layer, t.width, t.height, t.window, t.mirror, t.skin);
const hexBytes = (color: string) => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
const sqrtLinear = (color: string) => hexBytes(color).map(b => Math.sqrt(srgbToLinear(b / 255)));

/** Per-texel optical inputs of one layer: a constant surface, or Shimmer's grain (shimmer-grain.ts) on the target's own grid. */
function layerOptics(layer: Layer, t: Target) {
  const finish = canonicalFinish(layer.finish);
  if (finish === "shimmer") {
    const flakes = (layer.flakes && !("model" in layer.flakes) ? layer.flakes : defaultFlakes()) as LegacyFlakes;
    // A window compile lays one grain per texel (PIPE-124): a window whose texels hold several grains would average them into
    // ripples below the mode-1 fade, so it is refused rather than exported faint.
    const cells = grainCellsPerTexel(t.width, t.height, t.window);
    if (!t.head && (cells.u !== 1 || cells.v !== 1))
      throw Error(`Shimmer's grain needs one grain per texel; this ${t.width} × ${t.height} window holds ${cells.u} × ${cells.v}.`);
    const grain = bakeShimmerGrain(flakes, t.width, t.height, t.window);
    return { roughness: (p: number) => grain.surface[p * 2] / 255, metalness: (p: number) => grain.surface[p * 2 + 1] / 255,
      normal: (p: number): [number, number] => [unorm(grain.normal[p * 2]), unorm(grain.normal[p * 2 + 1])] };
  }
  const surface = flatSurface(finish);
  if (!surface) throw new UnsupportedMaterialError([{ id: layer.id, finish }]);
  return { roughness: () => surface.roughness, metalness: () => surface.metalness, normal: (): [number, number] => [0, 0] };
}

/** Premultiplied destination accumulation: sqrt-linear RGB, roughness, metalness, coverage, normal X, normal Y. */
function accumulate(layers: Layer[], t: Target) {
  const count = t.width * t.height, accum = new Float64Array(count * 8);
  for (const layer of layers) {
    const mask = layerMask(layer, t), c = sqrtLinear(layer.color), optics = layerOptics(layer, t);
    for (let p = 0; p < count; p++) {
      const a = mask[p * 4 + 3] / 255;
      if (!a) continue;
      const o = p * 8, inv = 1 - a, [nx, ny] = optics.normal(p);
      for (let k = 0; k < 3; k++) accum[o + k] = c[k] * a + accum[o + k] * inv;
      accum[o + 3] = optics.roughness(p) * a + accum[o + 3] * inv;
      accum[o + 4] = optics.metalness(p) * a + accum[o + 4] * inv;
      accum[o + 5] = a + accum[o + 5] * inv;
      accum[o + 6] = nx * a + accum[o + 6] * inv;
      accum[o + 7] = ny * a + accum[o + 7] * inv;
    }
  }
  return accum;
}

const FLAT_MATERIAL = { DiffuseColor: "white", DiffuseAlpha: 1, RoughnessMetalnessAlpha: 1, NormalAlpha: 0,
  AlphaMaskContrast: 0, SecondaryMaskInfluence: 0, RoughnessScale: 1, RoughnessBias: 0, MetalnessScale: 1, MetalnessBias: 0 };

function encodeSurface(accum: Float64Array, count: number, normals: boolean) {
  const diffuse = new Uint8Array(count * 4), roughness = new Uint8Array(count), metalness = new Uint8Array(count);
  const normal = normals ? new Uint8Array(count * 2).fill(byte(.5)) : undefined;
  let coveredTexels = 0;
  for (let p = 0; p < count; p++) {
    const o = p * 8, coverage = accum[o + 5];
    if (!coverage) continue;
    coveredTexels++;
    for (let k = 0; k < 3; k++) diffuse[p * 4 + k] = byte(linearToSrgb((accum[o + k] / coverage) ** 2));
    diffuse[p * 4 + 3] = byte(Math.sqrt(coverage));
    roughness[p] = byte(accum[o + 3] / coverage);
    metalness[p] = byte(accum[o + 4] / coverage);
    if (normal) for (let k = 0; k < 2; k++) normal[p * 2 + k] = byte(accum[o + 6 + k] / coverage * .5 + .5);
  }
  return { diffuse, roughness, metalness, normal, coveredTexels };
}

function strictPlan(recipe: Recipe) {
  const plan = planPresetExport(recipe);
  if (plan.excluded.length) throw new UnsupportedMaterialError(plan.excluded
    .map(({ layer, reason }) => ({ id: layer.id, finish: canonicalFinish(layer.finish), reason })));
  return plan;
}

/** Grid fields of a compiled map set: head keeps its historical `size`; a window records its rectangle. */
const grid = (t: Target) => ({ width: t.width, height: t.height, ...(t.head ? { size: t.width } : { window: t.window }) });
/** The manifest's account of Shimmer's grain on this map: its real pitch (PIPE-124) and what BC5 does to it (PIPE-125). */
function shimmerNote(t: Target) {
  const cells = grainCellsPerTexel(t.width, t.height, t.window), pitch = grainPitch(t.width, t.height, t.window);
  const grid = cells.u === 1 && cells.v === 1 ? "one grain per texel" : `the mean of ${cells.u} × ${cells.v} grains per texel`;
  return `Experimental Shimmer (${SHIMMER_GRAIN.model}): a uniform surface (roughness ${SHIMMER_GRAIN.roughness}, metalness ${SHIMMER_GRAIN.metalness}) ` +
    `with a fine grain of tilted normals, ${grid} (${Math.round(pitch.u)} × ${Math.round(pitch.v)} grains per unit of head UV). ` +
    `As compiled, every tilted grain (${SHIMMER_GRAIN.tiltFloorDeg} degrees or more) clears NormalsBlendingMode 1's fade; ` +
    "BC5 compression lowers a few (WolvenKit 9.0.1, measured offline: about 2 % below full weight).";
}
const spaceNote = (t: Target) => t.head ? [] : [
  "Plate-local UV window: the texture covers only the plate's UV rectangle; the material's UVScale/UVOffset map the plate's stored UVs onto it."];

export function compileFlatPreset(value: unknown, region: CompileRegion, space: number | TextureSpace = 1024) {
  const recipe: Recipe = parseRecipe(value, region.models);
  const t = target(space, region);
  const plan = strictPlan(recipe);
  if (plan.route !== "flat") throw new UnsupportedMaterialError(plan.included.filter(l => canonicalFinish(l.finish) === "shimmer" || canonicalFinish(l.finish) === "iridescent")
    .map(l => ({ id: l.id, finish: canonicalFinish(l.finish), reason: "Needs the faceted or Fresnel adapter." })));
  const { diffuse, roughness, metalness, coveredTexels } = encodeSurface(accumulate(plan.included, t), t.width * t.height, false);
  const glossy = plan.included.some(l => canonicalFinish(l.finish) === "glossy");
  return {
    ...grid(t), diffuse, roughness, metalness,
    metadata: {
      adapter: DECAL_ADAPTER, layerOrder: plan.included.map(l => l.id), coveredTexels,
      diffuseEncoding: "sRGB RGB, linear sqrt(coverage) alpha; import with IsGamma=true",
      scalarEncoding: "linear red channel",
      material: FLAT_MATERIAL,
      limitations: [
        "Texel-centre destination-channel equivalence only; filtered edges, mipmaps and compression need comparison.",
        "Matte, satin and metallic parameters are provisional game finish candidates.",
        ...(glossy ? ["Glossy is an experimental single-lobe approximation: one low-roughness dielectric reflection, no clear coat."] : []),
        "Flake normals, clearcoat and colour shift require further material adapters; never silently flattened here.",
        ...spaceNote(t),
        "Game rendering and perceived browser/game equivalence remain unverified.",
      ],
    },
  };
}

/** Flat channels plus a two-channel tangent normal (X, Y as UNORM bytes) for NormalsBlendingMode 1. */
export function compileFacetedPreset(value: unknown, region: CompileRegion, space: number | TextureSpace = 1024) {
  const recipe: Recipe = parseRecipe(value, region.models);
  const t = target(space, region);
  const plan = strictPlan(recipe);
  if (plan.route !== "faceted") throw Error("This preset has no Shimmer layer; use the flat adapter.");
  const { diffuse, roughness, metalness, normal, coveredTexels } = encodeSurface(accumulate(plan.included, t), t.width * t.height, true);
  return {
    ...grid(t), diffuse, roughness, metalness, normal: normal!,
    metadata: {
      adapter: ROUTE_ADAPTER.faceted, layerOrder: plan.included.map(l => l.id), coveredTexels,
      diffuseEncoding: "sRGB RGB, linear sqrt(coverage) alpha; import with IsGamma=true",
      scalarEncoding: "linear red channel; lower roughness mips widened by unresolved grain slope variance",
      normalEncoding: "tangent X, Y as UNORM; flat outside coverage; BC5 via TCM_Normalmap",
      material: { ...FLAT_MATERIAL, NormalAlpha: 1, UseNormalAlphaTex: 0, NormalsBlendingMode: 1 },
      limitations: [
        shimmerNote(t),
        "Normal alpha follows the colour-map alpha (sqrt coverage).",
        "Grain tilt direction follows the texture's green axis, whose on-plate sign is untested; random grain azimuths make the statistics sign-independent.",
        ...spaceNote(t),
        "Game rendering and perceived browser/game equivalence remain unverified.",
      ],
    },
  };
}

/** Linear coverage mask plus a uniform base-colour texture; the shift is per-preset constants. Head UV only:
 * the gradient-recolour template has no UV transform (finish-export.ts ROUTE_TEXTURE_SPACE). */
export function compileFresnelPreset(value: unknown, region: CompileRegion, size = 1024) {
  const recipe: Recipe = parseRecipe(value, region.models);
  checkSize(size);
  const plan = strictPlan(recipe);
  if (plan.route !== "fresnel") throw Error("This preset is not a single colour-shift pigment.");
  const count = size * size, coverage = new Float64Array(count);
  for (const layer of plan.included) {
    const mask = raster(layer, size, region.mirror, region.skin);
    for (let p = 0; p < count; p++) { const a = mask[p * 4 + 3] / 255; if (a) coverage[p] = a + coverage[p] * (1 - a); }
  }
  const mask = new Uint8Array(count);
  let coveredTexels = 0;
  for (let p = 0; p < count; p++) if (coverage[p]) { coveredTexels++; mask[p] = byte(coverage[p]); }
  const first = plan.included[0], rgb = hexBytes(first.color);
  const gradient = new Uint8Array(GRADIENT_SIZE * GRADIENT_SIZE * 4);
  for (let p = 0; p < GRADIENT_SIZE * GRADIENT_SIZE; p++) gradient.set([...rgb, 255], p * 4);
  const shift = first.optics!.shift!;
  return {
    size, width: size, height: size, mask, gradient,
    metadata: {
      adapter: ROUTE_ADAPTER.fresnel, layerOrder: plan.included.map(l => l.id), coveredTexels,
      maskEncoding: "linear red coverage (this template does not square it); import as linear scalar",
      gradientEncoding: `uniform ${GRADIENT_SIZE}x${GRADIENT_SIZE} sRGB base colour sampled through the gradient lookup`,
      shift: { color: shift.color, strength: shift.strength },
      material: fresnelMaterial(shift),
      limitations: [
        "Experimental: FresnelColor is written assuming the engine passes Color parameters to shaders as byte/255 without sRGB decoding.",
        "The shift is one additive colour weighted by |1 - N.V|^2 over the whole preset; it is not thin-film or multichrome.",
        "MaterialModifiersConsts[2].x also scales the shift at runtime; its value on the player head is unknown.",
        "Head-UV texture: the gradient-recolour template has no UV transform, so this route cannot use the plate-local window.",
        "Game rendering and perceived browser/game equivalence remain unverified.",
      ],
    },
  };
}

export type MapDims = { readonly width: number; readonly height: number };
export type CompiledPreset = {
  route: ExportRoute;
  /** Texel grid of the preset's maps (the Fresnel gradient excepted): the head atlas or a UV window. */
  space: TextureSpace;
  maps: Partial<Record<TextureChannel, Uint8Array>>;
  /** Dimensions of each map; the Fresnel gradient is smaller than the preset's grid. */
  dims: Partial<Record<TextureChannel, MapDims>>;
  metadata: unknown;
};

/**
 * Compile one filtered preset through the route its layers require, in `space` (a head-UV size or a UV
 * window). A Fresnel preset cannot use a window, so with one it compiles in head UV at `headSize`.
 */
export function compilePreset(value: unknown, region: CompileRegion, space: number | TextureSpace = 1024, headSize = 1024): CompiledPreset {
  const recipe = parseRecipe(value, region.models), route = strictPlan(recipe).route;
  if (route === "fresnel") {
    const size = typeof space === "number" ? space : space.kind === "head" ? space.size : headSize;
    const c = compileFresnelPreset(recipe, region, size);
    return { route, space: { kind: "head", size }, maps: { mask: c.mask, gradient: c.gradient },
      dims: { mask: { width: size, height: size }, gradient: { width: GRADIENT_SIZE, height: GRADIENT_SIZE } }, metadata: c.metadata };
  }
  const t = target(space, region), dims = { width: t.width, height: t.height };
  const resolved: TextureSpace = t.head ? { kind: "head", size: t.width } : { kind: "window", width: t.width, height: t.height, window: t.window };
  if (route === "faceted") {
    const c = compileFacetedPreset(recipe, region, resolved);
    return { route, space: resolved, maps: { diffuse: c.diffuse, roughness: c.roughness, metalness: c.metalness, normal: c.normal },
      dims: { diffuse: dims, roughness: dims, metalness: dims, normal: dims }, metadata: c.metadata };
  }
  const c = compileFlatPreset(recipe, region, resolved);
  return { route, space: resolved, maps: { diffuse: c.diffuse, roughness: c.roughness, metalness: c.metalness },
    dims: { diffuse: dims, roughness: dims, metalness: dims }, metadata: c.metadata };
}

/**
 * Head-UV coverage of a preset's included layers over texels [x0, x0 + width) × [y0, y0 + height) of a
 * `grid` × `grid` head atlas (bytes of linear coverage, row-major): the authored content the package
 * verifier compares a window map against at the plate's own UVs. Every route's included layers merge
 * coverage the same way (a + c·(1 − a)).
 *
 * Deliberately a crop of the head-atlas `raster` (the editor's and preview's path), never `rasterWindow`, which
 * the window maps come from: a fault in the window code (a mirror, offset or scale) then moves the maps but not
 * their reference, and the verifier's mapping gate fails (PIPE-32).
 */
export function presetCoverage(value: unknown, region: CompileRegion,
  crop: { grid: number; x0: number; y0: number; width: number; height: number }): Uint8Array {
  const recipe = parseRecipe(value, region.models), plan = strictPlan(recipe), { grid, x0, y0, width, height } = crop;
  if (![grid, x0, y0, width, height].every(Number.isInteger) || x0 < 0 || y0 < 0 || width < 1 || height < 1 || x0 + width > grid || y0 + height > grid)
    throw Error("Invalid coverage crop.");
  const coverage = new Float64Array(width * height);
  for (const layer of plan.included) {
    const mask = raster(layer, grid, region.mirror, region.skin);
    for (let y = 0; y < height; y++) for (let x = 0, row = ((y0 + y) * grid + x0) * 4 + 3, p = y * width; x < width; x++, p++) {
      const a = mask[row + x * 4] / 255;
      if (a) coverage[p] = a + coverage[p] * (1 - a);
    }
  }
  return Uint8Array.from(coverage, byte);
}
