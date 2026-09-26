import { parseExportDiagnostics } from "./export-diagnostics";
import { canonicalFinish, finishLabel, type Finish } from "./engines/layered-makeup/finish";
import { layerExport, planPresetExport, type ExportAdapterId } from "./engines/layered-makeup/finish-export";
import { NEWER_LOOK_REASON, NO_EYE_MAKEUP_REASON, parseCollection, planCollection, type PresetCollection } from "./preset-collection";
import { packagedLookCount, type ExportExperimental, type ExportOmission, type PackageBuildResult, type PackageCheckResult } from "./platform/api";
import type { PackagePresetIdentity } from "./package-action";
import { plateUvRecord, presetReachesPlate, type PlateReachInput } from "./plate-reach";
import type { LayeredMakeupRegion } from "./engines/layered-makeup/region";

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
  | { kind: "preset"; presetId: string; presetName: string; reason: string }
  /** Another feature's part of a look: this mod packages eye makeup only (CORE-34). */
  | { kind: "part"; presetId: string; presetName: string; feature: string; reason: string };

/** An included layer whose finish uses an adapter that still needs in-game confirmation. */
export type PackageExperimental = { presetId: string; presetName: string; layerId: string; layerName: string;
  finish: Finish; adapter: ExportAdapterId; note: string };

const label = (finish: Finish) => { const name = finishLabel(finish); return name[0].toUpperCase() + name.slice(1); };

export function describePackageOmissions(omissions: readonly ExportOmission[]): string {
  if (!omissions.length) return "";
  return ` Partial export: ${omissions.map(item => item.kind === "layer"
    ? `omitted layer “${item.layerName}” (${label(canonicalFinish(item.finish as Finish))}) from preset “${item.presetName}”`
    : item.kind === "part" ? `left out the ${item.feature} part of preset “${item.presetName}”, which this mod can't hold yet`
    : item.kind === "feature" ? `left out ${item.label.toLowerCase()}: ${item.reason.replace(/^No mod files can be made: /, "")}`
    : item.reason === OFF_PLATE_REASON ? `omitted whole preset “${item.presetName}” because its makeup doesn't reach the eye plate`
    : item.reason === NO_EYE_MAKEUP_REASON ? `omitted whole preset “${item.presetName}” because it has no eye makeup`
    : item.reason === NEWER_LOOK_REASON ? `omitted whole preset “${item.presetName}” because it was made with a newer version of XF Studio`
    : `omitted whole preset “${item.presetName}” because no exportable active layers remain`).join("; ")}. The authored collection is unchanged.`;
}

export function describePackageExperimental(experimental: readonly ExportExperimental[] | undefined): string {
  if (!experimental?.length) return "";
  const finishes = [...new Set(experimental.map(item => label(canonicalFinish(item.finish as Finish))))];
  return ` Experimental finishes included (${finishes.join(", ")}): built from the game's own decal materials but not yet confirmed in game.`;
}

/** Every omission of a result: the parts no exporter packages, then each product's features' own. */
const allOmissions = (result: Pick<PackageCheckResult, "omissions" | "products">) =>
  [...result.omissions, ...result.products.flatMap(product => product.features.flatMap(feature => feature.omissions))];
const allExperimental = (result: Pick<PackageCheckResult, "products">) =>
  result.products.flatMap(product => product.features.flatMap(feature => feature.experimental));
const mods = (products: readonly { modName: string }[]) => products.length === 1 ? products[0].modName
  : `${products.length} mods (${products.map(product => product.modName).join(", ")})`;

/** A Check's result in plain words: how many looks can become mod files and in which mod, then notes, omissions and experimental finishes. */
export function describePackageCheck(result: PackageCheckResult): string {
  const notes = [...new Set(result.products.flatMap(product => product.features.flatMap(feature => feature.notes)))];
  return `${packagedLookCount(result)} of ${result.originalPresetCount} preset(s) can become mod files in ${mods(result.products)}. ` +
    `This check created no files.${notes.map(note => ` ${note}`).join("")}${describePackageOmissions(allOmissions(result))}` +
    describePackageExperimental(allExperimental(result));
}

/** A Build's result in plain words: each verified mod and where its files are, never claiming install or game tests. */
export function describePackageBuild(result: PackageBuildResult): string {
  const built = result.products.map(product => `${product.modName} mod files for ${new Set(product.features.flatMap(feature =>
    feature.presets.map(look => look.id))).size} of ${result.originalPresetCount} preset(s): ${product.package} · Manifest: ${product.manifest}`);
  return `Verified local ${built.join("; ")}. Not installed or game-tested.${describePackageOmissions(allOmissions(result))}` +
    describePackageExperimental(allExperimental(result));
}

/**
 * Each packaged preset's identity as Check, the manifest and the result gate record it: stable IDs, the export
 * route and, on a prepared test candidate, the preset's diagnostic knobs, so a diagnostic package is never
 * mistaken for a production one.
 */
export const packagePresetIdentities = (plan: Pick<ReturnType<typeof planCollection>, "presets">): PackagePresetIdentity[] => plan.presets.map(p =>
  ({ id: p.id, revision: p.revision, appearance: p.appearance, route: p.route, ...(p.diagnostics ? { diagnostics: p.diagnostics } : {}) }));

/** Every look of the source collection, packaged or not: a look without eye makeup counts as an omitted preset. */
export const originalPresetCount = (source: PresetCollection) =>
  source.presets.length + (source.omitted ?? []).filter(item => item.feature === undefined).length;

/**
 * A package-specific copy. Never changes the authored collection or its stable identities.
 *
 * With `plate` (the eye plate this Check or Build plans on), a preset whose exportable layers never reach the
 * plate is omitted too, as a reported omission; the result then records that plate (`plateUv`). Without it
 * (Check before any plate has been prepared) nothing is judged against the plate and `plateUv` is null.
 */
export function preparePackageCollection(value: unknown, region: Pick<LayeredMakeupRegion, "mirror">, plate: PlateReachInput | null = null) {
  const source = parseCollection(value);
  // Looks without eye makeup and other features' parts, which the collection's eye-makeup view left out, come first.
  const omissions: PackageOmission[] = (source.omitted ?? []).map(item => item.feature === undefined
    ? { kind: "preset" as const, presetId: item.presetId, presetName: item.presetName, reason: item.reason }
    : { kind: "part" as const, presetId: item.presetId, presetName: item.presetName, feature: item.feature, reason: item.reason });
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
    if (plate && !presetReachesPlate({ layers }, plate.footprint, region.mirror)) {
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
  // The omitted list is a report, not content: the packaged copy (and its hash) never carries it.
  const { omitted: _omitted, ...content } = source;
  const packaged: PresetCollection = { ...content, presets, ...(diagnostics ? { diagnostics } : {}) };
  const plan = planCollection(packaged);
  return { source, packaged, plan, omissions, experimental, plateUv: plate ? plateUvRecord(plate) : null };
}
