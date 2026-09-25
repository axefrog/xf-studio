// Diagnostic-only export knobs for prepared in-game test candidates. Pure; no IO, no UI.
//
// A collection file may carry `diagnostics` (schema `xfs/export-diagnostics-1`) keyed by preset ID:
// - `plateLiftMm`: this preset's eye-plate lift instead of the production default (plate-lift.ts),
//   so several depth alternatives can sit side by side in one selector;
// - `surface`: overrides of the flat material's roughness/metalness scale, bias and surface alpha,
//   so one session can separate "the written roughness is ignored" from "the values are too glossy".
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
export type PresetDiagnostics = { plateLiftMm?: number; surface?: SurfaceOverride };
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
    if (!isRecord(entry) || Object.keys(entry).some(key => key !== "plateLiftMm" && key !== "surface"))
      throw Error(`Diagnostics for preset ${id} may only set plateLiftMm and surface.`);
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
    if (presetIds.includes(id) && Object.keys(out).length) presets[id] = out;
  }
  return Object.keys(presets).length ? { schema: EXPORT_DIAGNOSTICS_SCHEMA, presets } : undefined;
}

/** Canonical text of a surface override (sorted keys), used for the material entry name. */
export const surfaceKey = (surface: SurfaceOverride) =>
  JSON.stringify(Object.keys(surface).sort().map(key => [key, surface[key as SurfaceParameter]]));
