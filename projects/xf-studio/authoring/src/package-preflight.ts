import { createHash } from "node:crypto";
import { originalPresetCount, packagePresetIdentities, PLATE_REACH_UNCHECKED_NOTE, preparePackageCollection } from "./package-filter";
import { compilePreset } from "./engines/layered-makeup/preset-compiler";
import type { PackageCheck } from "./package-action";
import type { PlateReachInput } from "./plate-reach";
import type { LayeredMakeupRegion } from "./engines/layered-makeup/region";
import { readRecipe } from "./recipe-schema";

/**
 * Shared, source-tree-independent eligibility check for localhost and desktop. With `plate` (the prepared eye
 * plate's UV footprint) it also omits presets that do not reach the plate, and records that plate.
 */
export function preflightPackageCollection(value: unknown, region: Pick<LayeredMakeupRegion, "models" | "mirror">,
  plate: PlateReachInput | null = null): PackageCheck & { packagedCollectionJson: string } {
  const { source, packaged, plan, omissions, experimental, plateUv } = preparePackageCollection(value, region, plate);
  // Keep the compiler's strict active-layer gate in Check, as in the build CLI.
  for (const preset of plan.presets) compilePreset(readRecipe(preset.recipe, region.models), region, 32);
  const packagedCollectionJson = JSON.stringify(packaged);
  return {
    ready: true,
    collectionId: plan.collectionId,
    namespace: plan.namespace,
    modName: plan.modName,
    selectorLabel: plan.selectorLabel,
    originalPresetCount: originalPresetCount(source),
    omissions,
    experimental,
    packagedCollectionSha256: createHash("sha256").update(packagedCollectionJson).digest("hex"),
    presets: packagePresetIdentities(plan),
    plateLiftsMm: [...plan.plate.liftsMm],
    plateUv,
    notes: plateUv ? [] : [PLATE_REACH_UNCHECKED_NOTE],
    packagedCollectionJson,
  };
}
