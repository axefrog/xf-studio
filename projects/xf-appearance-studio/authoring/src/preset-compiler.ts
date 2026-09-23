/** Pure material-map compilation, independent of UI, storage and archive packaging.
 * This adapter follows the inspected mesh_decal post-G-buffer shader contract.
 * It does not claim equivalence to separately lit transparent browser surfaces.
 */
import { canonicalFinish } from "./finish";
import { parseRecipe, raster, type Recipe } from "./recipe";

export const DECAL_ADAPTER = "mesh-decal-flat-v1";
export const srgbToLinear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
export const linearToSrgb = (v: number) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
const byte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);

export class UnsupportedMaterialError extends Error {
  constructor(readonly layers: { id: string; finish: string }[]) {
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

export function compileFlatPreset(value: unknown, size = 1024) {
  const recipe: Recipe = parseRecipe(value);
  if (!Number.isInteger(size) || size < 32 || size > 2048 || (size & (size - 1)))
    throw Error("Texture size must be a power of two from 32 to 2048.");
  const active = recipe.layers.filter(l => l.enabled && l.opacity > 0);
  const unsupported = active.filter(l => !["matte", "regular", "metallic"].includes(canonicalFinish(l.finish)));
  if (unsupported.length) throw new UnsupportedMaterialError(unsupported.map(l => ({ id: l.id, finish: canonicalFinish(l.finish) })));
  const count = size * size;
  // Premultiplied destination channels; no repeated objects in the texel loop.
  const accum = new Float64Array(count * 6);
  for (const layer of active) {
    const mask = raster(layer, size);
    const finish = canonicalFinish(layer.finish);
    const c = [1, 3, 5].map(i => Math.sqrt(srgbToLinear(parseInt(layer.color.slice(i, i + 2), 16) / 255)));
    const roughness = finish === "matte" ? .88 : finish === "metallic" ? .27 : .38;
    const metalness = finish === "metallic" ? .65 : 0;
    for (let p = 0; p < count; p++) {
      const a = mask[p * 4 + 3] / 255;
      if (!a) continue;
      const o = p * 6, inv = 1 - a;
      for (let k = 0; k < 3; k++) accum[o + k] = c[k] * a + accum[o + k] * inv;
      accum[o + 3] = roughness * a + accum[o + 3] * inv;
      accum[o + 4] = metalness * a + accum[o + 4] * inv;
      accum[o + 5] = a + accum[o + 5] * inv;
    }
  }
  const diffuse = new Uint8Array(count * 4), roughness = new Uint8Array(count), metalness = new Uint8Array(count);
  let coveredTexels = 0;
  for (let p = 0; p < count; p++) {
    const o = p * 6, coverage = accum[o + 5];
    if (!coverage) continue;
    coveredTexels++;
    for (let k = 0; k < 3; k++) diffuse[p * 4 + k] = byte(linearToSrgb((accum[o + k] / coverage) ** 2));
    diffuse[p * 4 + 3] = byte(Math.sqrt(coverage));
    roughness[p] = byte(accum[o + 3] / coverage);
    metalness[p] = byte(accum[o + 4] / coverage);
  }
  return {
    size, diffuse, roughness, metalness,
    metadata: {
      adapter: DECAL_ADAPTER, layerOrder: active.map(l => l.id), coveredTexels,
      diffuseEncoding: "sRGB RGB, linear sqrt(coverage) alpha; import with IsGamma=true",
      scalarEncoding: "linear red channel",
      material: { DiffuseColor: "white", DiffuseAlpha: 1, RoughnessMetalnessAlpha: 1, NormalAlpha: 0,
        AlphaMaskContrast: 0, SecondaryMaskInfluence: 0, RoughnessScale: 1, RoughnessBias: 0, MetalnessScale: 1, MetalnessBias: 0 },
      limitations: [
        "Texel-centre destination-channel equivalence only; filtered edges, mipmaps and compression need comparison.",
        "Matte, satin and metallic parameters are provisional game finish candidates.",
        "Flake normals, clearcoat and colour shift require further material adapters; never silently flattened here.",
        "Game rendering and perceived browser/game equivalence remain unverified.",
      ],
    },
  };
}
