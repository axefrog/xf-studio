import { parseExportDiagnostics } from "./export-diagnostics";
import { canonicalFinish, finishLabel, type Finish } from "./finish";
import { layerExport, planPresetExport, type ExportAdapterId } from "./finish-export";
import { parseCollection, planCollection, type PresetCollection } from "./preset-collection";
import type { PackagePresetIdentity } from "./package-action";
import { plateUvRecord, presetReachesPlate, type PlateReachInput } from "./plate-reach";

/** Why a whole preset is omitted: nothing exportable is left, or its makeup never reaches the eye plate. */
export const NO_EXPORTABLE_LAYERS_REASON = "No active exportable layers remain.";
export const OFF_PLATE_REASON = "Its makeup doesn't reach the eye plate, so it wouldn't show in game.";
/**
 * Said by a Check that had no plate to plan on (`plateUv: null`): no plate prepared yet for this game, route and head
 * choice. Build then judges plate reach on the plate it packages and reports any omission (PIPE-36).
 */
export const PLATE_REACH_UNCHECKED_NOTE = "Whether each look reaches the eye area is checked when you Build.";

export type PackageOmission =
  | { kind: "layer"; presetId: string; presetName: string; layerId: string; layerName: string;
      finish: Finish; reason: string }
  | { kind: "preset"; presetId: string; presetName: string; reason: string };

/** An included layer whose finish uses an adapter that still needs in-game confirmation. */
export type PackageExperimental = { presetId: string; presetName: string; layerId: string; layerName: string;
  finish: Finish; adapter: ExportAdapterId; note: string };

const label = (finish: Finish) => { const name = finishLabel(finish); return name[0].toUpperCase() + name.slice(1); };

export function describePackageOmissions(omissions: PackageOmission[]): string {
  if (!omissions.length) return "";
  return ` Partial export: ${omissions.map(item => item.kind === "layer"
    ? `omitted layer “${item.layerName}” (${label(item.finish)}) from preset “${item.presetName}”`
    : item.reason === OFF_PLATE_REASON ? `omitted whole preset “${item.presetName}” because its makeup doesn't reach the eye plate`
    : `omitted whole preset “${item.presetName}” because no exportable active layers remain`).join("; ")}. The authored collection is unchanged.`;
}

export function describePackageExperimental(experimental: readonly PackageExperimental[] | undefined): string {
  if (!experimental?.length) return "";
  const finishes = [...new Set(experimental.map(item => label(item.finish)))];
  return ` Experimental finishes included (${finishes.join(", ")}): built from the game's own decal materials but not yet confirmed in game.`;
}

/**
 * Each packaged preset's identity as Check, the manifest and the result gate record it: stable IDs, the export
 * route and, on a prepared test candidate, the preset's diagnostic knobs, so a diagnostic package is never
 * mistaken for a production one.
 */
export const packagePresetIdentities = (plan: Pick<ReturnType<typeof planCollection>, "presets">): PackagePresetIdentity[] => plan.presets.map(p =>
  ({ id: p.id, revision: p.revision, appearance: p.appearance, route: p.route, ...(p.diagnostics ? { diagnostics: p.diagnostics } : {}) }));

/**
 * A package-specific copy. Never changes the authored collection or its stable identities.
 *
 * With `plate` (the eye plate this Check or Build plans on), a preset whose exportable layers never reach the
 * plate is omitted too, as a reported omission; the result then records that plate (`plateUv`). Without it
 * (Check before any plate has been prepared) nothing is judged against the plate and `plateUv` is null.
 */
export function preparePackageCollection(value: unknown, plate: PlateReachInput | null = null) {
  const source = parseCollection(value);
  const omissions: PackageOmission[] = [];
  const experimental: PackageExperimental[] = [];
  const presets: PresetCollection["presets"] = [];
  for (const preset of source.presets) {
    const plan = planPresetExport(preset.recipe), excluded = new Map(plan.excluded.map(item => [item.layer.id, item.reason]));
    const layers = preset.recipe.layers.filter(layer => {
      const reason = excluded.get(layer.id);
      if (reason === undefined) return true;
      omissions.push({ kind: "layer", presetId: preset.id, presetName: preset.name,
        layerId: layer.id, layerName: layer.name, finish: canonicalFinish(layer.finish), reason });
      return false;
    });
    if (!layers.some(layer => layer.enabled && layer.opacity > 0)) {
      omissions.push({ kind: "preset", presetId: preset.id, presetName: preset.name, reason: NO_EXPORTABLE_LAYERS_REASON });
      continue;
    }
    if (plate && !presetReachesPlate({ layers }, plate.footprint)) {
      omissions.push({ kind: "preset", presetId: preset.id, presetName: preset.name, reason: OFF_PLATE_REASON });
      continue;
    }
    for (const layer of plan.included) {
      const status = layerExport(layer);
      if (status.exportable && status.experimental)
        experimental.push({ presetId: preset.id, presetName: preset.name, layerId: layer.id, layerName: layer.name,
          finish: canonicalFinish(layer.finish), adapter: status.adapter, note: status.note });
    }
    presets.push({ ...preset, recipe: { ...preset.recipe, layers } });
  }
  if (!presets.length && plate && omissions.some(item => item.kind === "preset" && item.reason === OFF_PLATE_REASON))
    throw Error("No mod files can be made: none of the presets' makeup reaches the eye plate around the eyes, so nothing would show in game. Move the shapes onto the eyelids in the UV view and try again. Your collection is unchanged.");
  if (!presets.length) throw Error("No mod files can be made: no preset has an active layer with an exportable finish (Matte, Satin, Metallic, or a game-matched Glossy, Shimmer or Colour-shifting layer). Your collection is unchanged.");
  // Diagnostic knobs of a prepared test candidate stay with the packaged copy for the presets it keeps.
  const diagnostics = parseExportDiagnostics((value as { diagnostics?: unknown } | null)?.diagnostics, presets.map(p => p.id));
  const packaged: PresetCollection = { ...source, presets, ...(diagnostics ? { diagnostics } : {}) };
  const plan = planCollection(packaged);
  return { source, packaged, plan, omissions, experimental, plateUv: plate ? plateUvRecord(plate) : null };
}
