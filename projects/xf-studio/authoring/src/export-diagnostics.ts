// Diagnostic-only export knobs for prepared in-game test candidates. Pure; no IO, no UI.
//
// A collection file may carry `diagnostics` (schema `xfs/export-diagnostics-1`) keyed by preset ID:
// - `plateLiftMm`: this preset's eye-plate lift instead of the production default (plate-lift.ts),
//   so several depth alternatives can sit side by side in one selector;
// - `surface`: overrides of the flat material's roughness/metalness scale, bias and surface alpha,
//   so one session can separate "the written roughness is ignored" from "the values are too glossy";
// - `uvSpace: "head"`: compile a flat or faceted preset on the 1024 head atlas without the UV transform
//   (the layout before the plate-local window), so old and new texel density sit side by side;
// - `glitter`: build a flat-finish preset through the diagnostic Glitter route (glitter-route.ts): its
//   layers stay the pigment, and named layers carry a resolved flake field with nested mips, optionally
//   with an emissive accent on a second plate chunk. This is the only way into that route: the Glitter
//   finish itself still has no export route, so Glitter layers are still omitted with a reason.
// The Studio never writes or shows these knobs, and the library does not keep them: only the package
// filter reads them from an exported file. Every packaged use is restated by the independent verifier.
import { MAX_PLATE_LIFT_MM } from "./plate-lift";

export const EXPORT_DIAGNOSTICS_SCHEMA = "xfs/export-diagnostics-1";
/** Flat-material parameters a diagnostic may override, with their accepted ranges. */
export const SURFACE_OVERRIDE_RANGES = {
  RoughnessScale: [0, 2], RoughnessBias: [-1, 1], MetalnessScale: [0, 2], MetalnessBias: [-1, 1], RoughnessMetalnessAlpha: [0, 1],
} as const;
export type SurfaceParameter = keyof typeof SURFACE_OVERRIDE_RANGES;
export type SurfaceOverride = Partial<Record<SurfaceParameter, number>>;
/** Flake statistics of one glitter region (experiment 018's recipe fields). */
export type GlitterFlakes = {
  /** Median flake width (mm) and log-normal spread. */ sizeMm: number; sizeSigma: number;
  /** Authored share of the region the flakes cover. */ cover: number;
  /** Tilt |N(0, σ)| in degrees, redrawn uniformly below the maximum when it exceeds it. */ tiltSigmaDeg: number; tiltMaxDeg: number;
  roughness: number; metalness: number; color: string; seed: number;
};
/** One glitter region: the flakes of one layer, drawn over its UV bounds and clipped by its coverage. */
export type GlitterRegion = { layer: string; mips: "nested" | "box"; flakes?: GlitterFlakes; mirrorOf?: string };
/** Emissive accent: the lowest-key share of one region's flakes, drawn on a second plate chunk. */
export type GlitterAccent = { layer: string; share: number; ev: number };
export type GlitterDiagnostic = { base: { roughness: number; metalness: number }; regions: GlitterRegion[]; accent?: GlitterAccent };
export type PresetDiagnostics = { plateLiftMm?: number; surface?: SurfaceOverride; uvSpace?: "head"; glitter?: GlitterDiagnostic };

/** Accepted ranges of the glitter knob's numbers. */
export const GLITTER_RANGES = {
  sizeMm: [.05, 1.2], sizeSigma: [0, 1], cover: [.01, .6], tiltSigmaDeg: [0, 90], tiltMaxDeg: [1, 89], roughness: [0, 1], metalness: [0, 1],
  seed: [0, 2147483647], share: [.01, 1], ev: [-10, 10],
} as const;
const FLAKE_KEYS = ["sizeMm", "sizeSigma", "cover", "tiltSigmaDeg", "tiltMaxDeg", "roughness", "metalness", "color", "seed"] as const;
export type ExportDiagnostics = { schema: typeof EXPORT_DIAGNOSTICS_SCHEMA; presets: Record<string, PresetDiagnostics> };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Validate a collection's `diagnostics` against its preset IDs. Absent means none. Entries for presets
 * that are not in `presetIds` (for example a preset the partial export left out) are dropped.
 */
export function parseExportDiagnostics(value: unknown, presetIds: readonly string[]): ExportDiagnostics | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || value.schema !== EXPORT_DIAGNOSTICS_SCHEMA || !isRecord(value.presets))
    throw Error(`Collection diagnostics must use ${EXPORT_DIAGNOSTICS_SCHEMA} with a presets map.`);
  const presets: Record<string, PresetDiagnostics> = {};
  for (const [id, entry] of Object.entries(value.presets)) {
    if (!isRecord(entry) || Object.keys(entry).some(key => !["plateLiftMm", "surface", "uvSpace", "glitter"].includes(key)))
      throw Error(`Diagnostics for preset ${id} may only set plateLiftMm, surface, uvSpace and glitter.`);
    const out: PresetDiagnostics = {};
    if (entry.plateLiftMm !== undefined) {
      const lift = entry.plateLiftMm;
      if (typeof lift !== "number" || !Number.isFinite(lift) || lift < 0 || lift > MAX_PLATE_LIFT_MM)
        throw Error(`Diagnostic plate lift for preset ${id} must be between 0 and ${MAX_PLATE_LIFT_MM} mm.`);
      out.plateLiftMm = lift;
    }
    if (entry.surface !== undefined) {
      if (!isRecord(entry.surface) || !Object.keys(entry.surface).length) throw Error(`Diagnostic surface for preset ${id} is empty.`);
      const surface: SurfaceOverride = {};
      for (const [name, number] of Object.entries(entry.surface)) {
        const range = (SURFACE_OVERRIDE_RANGES as Record<string, readonly [number, number]>)[name];
        if (!range || typeof number !== "number" || !Number.isFinite(number) || number < range[0] || number > range[1])
          throw Error(`Diagnostic surface ${name} for preset ${id} is not an accepted override.`);
        surface[name as SurfaceParameter] = number;
      }
      out.surface = surface;
    }
    if (entry.uvSpace !== undefined) {
      if (entry.uvSpace !== "head") throw Error(`Diagnostic uvSpace for preset ${id} must be "head".`);
      out.uvSpace = "head";
    }
    if (entry.glitter !== undefined) {
      if (out.surface || out.uvSpace) throw Error(`Diagnostic glitter for preset ${id} cannot be combined with a surface override or head UV.`);
      out.glitter = parseGlitter(entry.glitter, id);
    }
    if (presetIds.includes(id) && Object.keys(out).length) presets[id] = out;
  }
  return Object.keys(presets).length ? { schema: EXPORT_DIAGNOSTICS_SCHEMA, presets } : undefined;
}

const inRange = (value: unknown, [lo, hi]: readonly [number, number]) => typeof value === "number" && Number.isFinite(value) && value >= lo && value <= hi;
function parseFlakes(value: unknown, where: string): GlitterFlakes {
  if (!isRecord(value) || Object.keys(value).length !== FLAKE_KEYS.length || !FLAKE_KEYS.every(key => key in value))
    throw Error(`${where} must set exactly ${FLAKE_KEYS.join(", ")}.`);
  for (const key of FLAKE_KEYS) if (key !== "color" && !inRange(value[key], GLITTER_RANGES[key])) throw Error(`${where} ${key} is out of range.`);
  if (typeof value.color !== "string" || !/^#[0-9a-f]{6}$/i.test(value.color)) throw Error(`${where} color must be #rrggbb.`);
  if (!Number.isInteger(value.seed)) throw Error(`${where} seed must be an integer.`);
  if ((value.tiltMaxDeg as number) < (value.tiltSigmaDeg as number) / 4) throw Error(`${where} tiltMaxDeg is too small for its spread.`);
  // Canonical key order, so the packaged collection's hash does not depend on how the file was written.
  return Object.fromEntries(FLAKE_KEYS.map(key => [key, key === "color" ? (value.color as string).toLowerCase() : value[key]])) as GlitterFlakes;
}

/** Validate a glitter knob's shape and numbers (layer references are checked against the recipe when planning). */
function parseGlitter(value: unknown, id: string): GlitterDiagnostic {
  const where = `Diagnostic glitter for preset ${id}`;
  if (!isRecord(value) || Object.keys(value).some(key => !["base", "regions", "accent"].includes(key))) throw Error(`${where} may only set base, regions and accent.`);
  const base = value.base;
  if (!isRecord(base) || Object.keys(base).length !== 2 || !inRange(base.roughness, [0, 1]) || !inRange(base.metalness, [0, 1]))
    throw Error(`${where} base must set roughness and metalness between 0 and 1.`);
  if (!Array.isArray(value.regions) || !value.regions.length || value.regions.length > 8) throw Error(`${where} needs one to eight regions.`);
  const regions: GlitterRegion[] = value.regions.map((item, i) => {
    const at = `${where} region ${i + 1}`;
    if (!isRecord(item) || Object.keys(item).some(key => !["layer", "mips", "flakes", "mirrorOf"].includes(key))) throw Error(`${at} may only set layer, mips, flakes and mirrorOf.`);
    if (typeof item.layer !== "string" || !item.layer) throw Error(`${at} names no layer.`);
    if (item.mips !== "nested" && item.mips !== "box") throw Error(`${at} mips must be "nested" or "box".`);
    if ((item.flakes === undefined) === (item.mirrorOf === undefined)) throw Error(`${at} must set either flakes or mirrorOf.`);
    return { layer: item.layer, mips: item.mips, ...(item.flakes !== undefined ? { flakes: parseFlakes(item.flakes, at) } : { mirrorOf: String(item.mirrorOf) }) };
  });
  const layers = regions.map(region => region.layer);
  if (new Set(layers).size !== layers.length) throw Error(`${where} names a layer twice.`);
  for (const region of regions) if (region.mirrorOf !== undefined && !regions.some(other => other.layer === region.mirrorOf && other.flakes))
    throw Error(`${where} mirrors ${region.mirrorOf}, which is not a region with its own flakes.`);
  let accent: GlitterAccent | undefined;
  if (value.accent !== undefined) {
    const a = value.accent;
    if (!isRecord(a) || Object.keys(a).length !== 3 || typeof a.layer !== "string" || !inRange(a.share, GLITTER_RANGES.share) || !inRange(a.ev, GLITTER_RANGES.ev))
      throw Error(`${where} accent must set layer, share and ev.`);
    if (!layers.includes(a.layer)) throw Error(`${where} accent names a layer with no flakes.`);
    accent = { layer: a.layer, share: a.share as number, ev: a.ev as number };
  }
  return { base: { roughness: base.roughness as number, metalness: base.metalness as number }, regions, ...(accent ? { accent } : {}) };
}

/** Constants of a glitter accent's emissive instance: red mask channel, the flake colour's sRGB bytes, the knob's EV, no threshold. */
export function accentConstants(knob: GlitterDiagnostic) {
  if (!knob.accent) throw Error("This glitter preset has no accent.");
  const region = knob.regions.find(r => r.layer === knob.accent!.layer)!;
  const flakes = region.flakes ?? knob.regions.find(r => r.layer === region.mirrorOf)!.flakes!;
  const [Red, Green, Blue] = [1, 3, 5].map(i => parseInt(flakes.color.slice(i, i + 2), 16));
  return { EmissiveMaskChannel: { X: 1, Y: 0, Z: 0, W: 0 }, EmissiveColor: { Red, Green, Blue, Alpha: 255 }, EmissiveEV: knob.accent.ev, AlphaThreshold: 0 };
}
export type AccentConstants = ReturnType<typeof accentConstants>;

/** Canonical text of a surface override (sorted keys), used for the material entry name. */
export const surfaceKey = (surface: SurfaceOverride) =>
  JSON.stringify(Object.keys(surface).sort().map(key => [key, surface[key as SurfaceParameter]]));
