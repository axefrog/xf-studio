import { canonicalFinish, finishLabel, type Finish } from "./finish";
import { layerExport, planPresetExport, type ExportAdapterId } from "./finish-export";
import { parseCollection, planCollection, type PresetCollection } from "./preset-collection";

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
    : `omitted whole preset “${item.presetName}” because no exportable active layers remain`).join("; ")}. The authored collection is unchanged.`;
}

export function describePackageExperimental(experimental: readonly PackageExperimental[] | undefined): string {
  if (!experimental?.length) return "";
  const finishes = [...new Set(experimental.map(item => label(item.finish)))];
  return ` Experimental finishes included (${finishes.join(", ")}): built from the game's own decal materials but not yet confirmed in game.`;
}

/** A package-specific copy. Never changes the authored collection or its stable identities. */
export function preparePackageCollection(value: unknown) {
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
      omissions.push({ kind: "preset", presetId: preset.id, presetName: preset.name,
        reason: "No active exportable layers remain." });
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
  if (!presets.length) throw Error("No mod files can be made: no preset has an active layer with an exportable finish (Matte, Satin, Metallic, or a game-matched Glossy, Shimmer or Colour-shifting layer). Your collection is unchanged.");
  const packaged: PresetCollection = { ...source, presets };
  const plan = planCollection(packaged);
  return { source, packaged, plan, omissions, experimental };
}
