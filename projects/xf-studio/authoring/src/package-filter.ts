import { canonicalFinish, finishLabel, type Finish } from "./finish";
import { parseCollection, planCollection, type PresetCollection } from "./preset-collection";
import { SUPPORTED_FLAT_FINISHES } from "./preset-compiler";

export type PackageOmission =
  | { kind: "layer"; presetId: string; presetName: string; layerId: string; layerName: string;
      finish: Finish; reason: string }
  | { kind: "preset"; presetId: string; presetName: string; reason: string };

export function describePackageOmissions(omissions: PackageOmission[]): string {
  if (!omissions.length) return "";
  const label = (finish: Finish) => { const name = finishLabel(finish); return name[0].toUpperCase() + name.slice(1); };
  return ` Partial export: ${omissions.map(item => item.kind === "layer"
    ? `omitted layer “${item.layerName}” (${label(item.finish)}) from preset “${item.presetName}”`
    : `omitted whole preset “${item.presetName}” because no exportable active layers remain`).join("; ")}. The authored collection is unchanged.`;
}

/** A package-specific copy. Never changes the authored collection or its stable identities. */
export function preparePackageCollection(value: unknown) {
  const source = parseCollection(value);
  const omissions: PackageOmission[] = [];
  const presets: PresetCollection["presets"] = [];
  for (const preset of source.presets) {
    const layers = preset.recipe.layers.filter(layer => {
      if (!layer.enabled || layer.opacity <= 0 || SUPPORTED_FLAT_FINISHES.includes(canonicalFinish(layer.finish))) return true;
      omissions.push({ kind: "layer", presetId: preset.id, presetName: preset.name,
        layerId: layer.id, layerName: layer.name, finish: canonicalFinish(layer.finish),
        reason: "Active finish has no supported game-export adapter." });
      return false;
    });
    if (!layers.some(layer => layer.enabled && layer.opacity > 0)) {
      omissions.push({ kind: "preset", presetId: preset.id, presetName: preset.name,
        reason: "No active exportable layers remain." });
      continue;
    }
    presets.push({ ...preset, recipe: { ...preset.recipe, layers } });
  }
  if (!presets.length) throw Error("No mod files can be made: every preset has no active Matte, Satin or Metallic layer. Your collection is unchanged.");
  const packaged: PresetCollection = { ...source, presets };
  const plan = planCollection(packaged);
  return { source, packaged, plan, omissions };
}
