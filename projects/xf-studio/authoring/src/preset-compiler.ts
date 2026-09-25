/** Pure material-map compilation, independent of UI, storage and archive packaging.
 * Each adapter follows an inspected post-G-buffer decal program (see finish-export.ts).
 * None claims equivalence to the browser's separately lit transparent layers.
 */
import { canonicalFinish, defaultFlakes, bakeFlakes, type LegacyFlakes } from "./finish";
import {
  flatSurface, fresnelMaterial, planPresetExport, ROUTE_ADAPTER,
  type ExportRoute, type TextureChannel,
} from "./finish-export";
import { parseRecipe, raster, type Layer, type Recipe } from "./recipe";

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
const hexBytes = (color: string) => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
const sqrtLinear = (color: string) => hexBytes(color).map(b => Math.sqrt(srgbToLinear(b / 255)));

/** Per-texel optical inputs of one layer: constant surface, or the classic Shimmer facet bake. */
function layerOptics(layer: Layer, size: number) {
  const finish = canonicalFinish(layer.finish);
  if (finish === "shimmer") {
    const flakes = (layer.flakes && !("model" in layer.flakes) ? layer.flakes : defaultFlakes()) as LegacyFlakes;
    const bake = bakeFlakes(size, "shimmer", flakes);
    return { roughness: (p: number) => bake.surface[p * 4 + 1] / 255, metalness: (p: number) => bake.surface[p * 4 + 2] / 255,
      normal: (p: number): [number, number] => [unorm(bake.normal[p * 4]), unorm(bake.normal[p * 4 + 1])] };
  }
  const surface = flatSurface(finish);
  if (!surface) throw new UnsupportedMaterialError([{ id: layer.id, finish }]);
  return { roughness: () => surface.roughness, metalness: () => surface.metalness, normal: (): [number, number] => [0, 0] };
}

/** Premultiplied destination accumulation: sqrt-linear RGB, roughness, metalness, coverage, normal X, normal Y. */
function accumulate(layers: Layer[], size: number) {
  const count = size * size, accum = new Float64Array(count * 8);
  for (const layer of layers) {
    const mask = raster(layer, size), c = sqrtLinear(layer.color), optics = layerOptics(layer, size);
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

function encodeSurface(accum: Float64Array, size: number, normals: boolean) {
  const count = size * size;
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

export function compileFlatPreset(value: unknown, size = 1024) {
  const recipe: Recipe = parseRecipe(value);
  checkSize(size);
  const plan = strictPlan(recipe);
  if (plan.route !== "flat") throw new UnsupportedMaterialError(plan.included.filter(l => canonicalFinish(l.finish) === "shimmer" || canonicalFinish(l.finish) === "iridescent")
    .map(l => ({ id: l.id, finish: canonicalFinish(l.finish), reason: "Needs the faceted or Fresnel adapter." })));
  const { diffuse, roughness, metalness, coveredTexels } = encodeSurface(accumulate(plan.included, size), size, false);
  const glossy = plan.included.some(l => canonicalFinish(l.finish) === "glossy");
  return {
    size, diffuse, roughness, metalness,
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
        "Game rendering and perceived browser/game equivalence remain unverified.",
      ],
    },
  };
}

/** Flat channels plus a two-channel tangent normal (X, Y as UNORM bytes) for NormalsBlendingMode 1. */
export function compileFacetedPreset(value: unknown, size = 1024) {
  const recipe: Recipe = parseRecipe(value);
  checkSize(size);
  const plan = strictPlan(recipe);
  if (plan.route !== "faceted") throw Error("This preset has no Shimmer layer; use the flat adapter.");
  const { diffuse, roughness, metalness, normal, coveredTexels } = encodeSurface(accumulate(plan.included, size), size, true);
  return {
    size, diffuse, roughness, metalness, normal: normal!,
    metadata: {
      adapter: ROUTE_ADAPTER.faceted, layerOrder: plan.included.map(l => l.id), coveredTexels,
      diffuseEncoding: "sRGB RGB, linear sqrt(coverage) alpha; import with IsGamma=true",
      scalarEncoding: "linear red channel; lower roughness mips widened by unresolved facet slope variance",
      normalEncoding: "tangent X, Y as UNORM; flat outside coverage; BC5 via TCM_Normalmap",
      material: { ...FLAT_MATERIAL, NormalAlpha: 1, UseNormalAlphaTex: 0, NormalsBlendingMode: 1 },
      limitations: [
        "Experimental: normal alpha follows the colour-map alpha (sqrt coverage), and NormalsBlendingMode 1 fades facets below about 11 degrees of tilt.",
        "Facet tilt direction follows the texture's green axis, whose on-plate sign is untested; random facet azimuths make the statistics sign-independent.",
        "Game rendering and perceived browser/game equivalence remain unverified.",
      ],
    },
  };
}

/** Linear coverage mask plus a uniform base-colour texture; the shift is per-preset constants. */
export function compileFresnelPreset(value: unknown, size = 1024) {
  const recipe: Recipe = parseRecipe(value);
  checkSize(size);
  const plan = strictPlan(recipe);
  if (plan.route !== "fresnel") throw Error("This preset is not a single colour-shift pigment.");
  const count = size * size, coverage = new Float64Array(count);
  for (const layer of plan.included) {
    const mask = raster(layer, size);
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
    size, mask, gradient,
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
        "Game rendering and perceived browser/game equivalence remain unverified.",
      ],
    },
  };
}

export type CompiledPreset = {
  route: ExportRoute; size: number;
  maps: Partial<Record<TextureChannel, Uint8Array>>;
  /** Side of each map; the Fresnel gradient is smaller than the preset size. */
  sides: Partial<Record<TextureChannel, number>>;
  metadata: unknown;
};

/** Compile one filtered preset through the route its layers require. */
export function compilePreset(value: unknown, size = 1024): CompiledPreset {
  const recipe = parseRecipe(value), route = strictPlan(recipe).route;
  if (route === "fresnel") {
    const c = compileFresnelPreset(recipe, size);
    return { route, size, maps: { mask: c.mask, gradient: c.gradient }, sides: { mask: size, gradient: GRADIENT_SIZE }, metadata: c.metadata };
  }
  if (route === "faceted") {
    const c = compileFacetedPreset(recipe, size);
    return { route, size, maps: { diffuse: c.diffuse, roughness: c.roughness, metalness: c.metalness, normal: c.normal },
      sides: { diffuse: size, roughness: size, metalness: size, normal: size }, metadata: c.metadata };
  }
  const c = compileFlatPreset(recipe, size);
  return { route, size, maps: { diffuse: c.diffuse, roughness: c.roughness, metalness: c.metalness },
    sides: { diffuse: size, roughness: size, metalness: size }, metadata: c.metadata };
}
