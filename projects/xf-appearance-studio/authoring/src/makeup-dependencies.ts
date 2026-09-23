import { defaultFlakes, type Flakes } from "./finish";
import { FLAKE_LIMITS, FLAKE_MATERIAL, FLAKE_SUBSAMPLES, FLAKE_SUBSAMPLES_16, type IrregularFlakes, type FlakeNormalStudyMode } from "./flake-field";
import type { Layer } from "./recipe";

/** Pure preparation for future material scheduling, not yet wired into the
 * production worker. Exact strings avoid digest collisions. Names and IDs own
 * document identity; these keys describe only reusable calculation inputs. */
type DependencyKey<Kind extends string> = string & { readonly __makeupDependency: Kind };
export type CatalogueKey = DependencyKey<"catalogue">;
export type OpticalKey = DependencyKey<"optical">;
export type AlphaKey = DependencyKey<"alpha">;
export type AlbedoKey = DependencyKey<"albedo">;
type Value = string | number | boolean | null | readonly Value[];

export const MASK_RASTER_VERSION = "recipe-6-coverage-1";
export const IRREGULAR_SAMPLING_VERSION = "planar-subsample-average-1";
export const ALBEDO_COMPOSITION_VERSION = "linear-srgb-byte-coverage-1";

function key<Kind extends string>(kind: Kind, inputs: readonly Value[]): DependencyKey<Kind> {
  const check = (value: Value): void => {
    if (Array.isArray(value)) { for (const item of value) check(item); return; }
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    // JSON would otherwise collapse non-finite/undefined values to null.
    throw Error("Dependency inputs must contain finite, explicit values.");
  };
  check(inputs);
  return JSON.stringify(["xfs/makeup-dependencies-1", kind, ...inputs]) as DependencyKey<Kind>;
}
function sizeWithin(size: number, minimum: number) {
  if (!Number.isInteger(size) || size < minimum || size > 4096) throw Error("Invalid dependency texture size.");
}
function version(value: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 120) throw Error("Invalid dependency version.");
  return value;
}
function colour(value: string) {
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value)) throw Error("Expected six-digit sRGB colour.");
  return value.toLowerCase();
}

/** Accept an already parsed layer. This is not a replacement recipe validator.
 * Retain optional widths/handle mode conservatively even when currently dormant.
 * Warp order stays significant because floating-point accumulation is ordered. */
export function maskAlphaKey(layer: Layer, size: number, rasterVersion = MASK_RASTER_VERSION): AlphaKey {
  sizeWithin(size, 1);
  const points: Value[] = layer.points.map(point => [point.u, point.v, point.weight, point.feather ?? null,
    point.handles ? [point.handles.mode, point.handles.in.u, point.handles.in.v, point.handles.out.u, point.handles.out.v] : null]);
  return key("alpha", [version(rasterVersion), "gltf-uv0-top-left", size, layer.enabled, layer.pathMode,
    points, [layer.strength.mode, layer.strength.mode === "smooth-boundary" ? layer.strength.blend : null],
    [layer.softness.mode, layer.softness.mode === "boundary" ? layer.softness.blend : null], layer.feather,
    layer.fields.map(field => [field.u, field.v, field.du, field.dv, field.radius]), layer.symmetry, layer.opacity]);
}

/** Complete unit-square catalogues only. Region-limited study outputs are
 * incomplete outside their declared regions and must not use this cache key;
 * a future region cache needs a distinct scope including those exact bounds. */
export function irregularCatalogueKey(settings: Omit<IrregularFlakes, "color">): CatalogueKey {
  if (!settings || settings.model !== "irregular-planar-1" ||
      !Number.isInteger(settings.count) || settings.count < 0 || settings.count > FLAKE_LIMITS.count ||
      !Number.isFinite(settings.radius) || settings.radius < FLAKE_LIMITS.minRadius || settings.radius > FLAKE_LIMITS.maxRadius ||
      !Number.isFinite(settings.spread) || settings.spread < 0 || settings.spread > 1 ||
      !Number.isFinite(settings.tilt) || settings.tilt < 0 || settings.tilt > 1 ||
      !Number.isInteger(settings.seed) || settings.seed < 0 || settings.seed > FLAKE_LIMITS.maxSeed)
    throw Error("Invalid irregular catalogue dependency settings.");
  return key("catalogue", [settings.model, settings.count, settings.radius, settings.spread, settings.tilt, settings.seed]);
}

/** Sampling ablations remain explicit study inputs. This does not select a
 * production sampling policy or accept irregular settings in recipe-6.
 * Existing keys implicitly mean surface-average; retain their exact strings.
 * Other normal representations append an explicit discriminator. */
export function irregularOpticalKey(catalogue: CatalogueKey, size: number, sampleAxis: 2 | 4 = 2,
  samplingVersion = IRREGULAR_SAMPLING_VERSION, normalMode: FlakeNormalStudyMode = "surface-average"): OpticalKey {
  sizeWithin(size, FLAKE_LIMITS.minSize);
  if (sampleAxis !== 2 && sampleAxis !== 4) throw Error("Invalid flake sampling axis.");
  if (normalMode !== "surface-average" && normalMode !== "covered-average") throw Error("Invalid flake normal study mode.");
  return key("optical", ["irregular", catalogue, size, version(samplingVersion), sampleAxis,
    sampleAxis === 2 ? FLAKE_SUBSAMPLES : FLAKE_SUBSAMPLES_16,
    [FLAKE_MATERIAL.baseRoughness, FLAKE_MATERIAL.flakeRoughness, FLAKE_MATERIAL.baseMetalness, FLAKE_MATERIAL.flakeMetalness],
    ...(normalMode === "surface-average" ? [] : [["normal-mode", normalMode] as Value])]);
}

/** Missing legacy settings mean the existing exact defaults; legacy shimmer
 * and glitter remain different models even when their controls match. */
export function legacyOpticalKey(size: number, finish: "shimmer" | "glitter", settings: Flakes = defaultFlakes()): OpticalKey {
  sizeWithin(size, 32);
  if ((finish !== "shimmer" && finish !== "glitter") || !settings ||
      !Number.isInteger(settings.cells) || settings.cells < 32 || settings.cells > 256 ||
      !Number.isFinite(settings.density) || settings.density < 0 || settings.density > 1 ||
      !Number.isFinite(settings.tilt) || settings.tilt < 0 || settings.tilt > 1 ||
      !Number.isInteger(settings.seed) || settings.seed < 0 || settings.seed > 2147483647)
    throw Error("Invalid legacy optical dependency settings.");
  return key("optical", ["legacy-cell-disks-1", finish, size, settings.cells, settings.density, settings.tilt, settings.seed]);
}

export function irregularAlbedoKey(optics: OpticalKey, alpha: AlphaKey, baseColour: string, flakeColour: string,
  compositionVersion = ALBEDO_COMPOSITION_VERSION): AlbedoKey {
  return key("albedo", [version(compositionVersion), optics, alpha, colour(baseColour), colour(flakeColour)]);
}
