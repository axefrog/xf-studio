import { createHash } from "node:crypto";
import { preparePackageCollection } from "./package-filter";
import { compilePreset } from "./preset-compiler";
import type { PackageCheck } from "./package-action";

/** Shared, source-tree-independent eligibility check for localhost and desktop. */
export function preflightPackageCollection(value: unknown): PackageCheck & { packagedCollectionJson: string } {
  const { source, packaged, plan, omissions, experimental } = preparePackageCollection(value);
  // Keep the compiler's strict active-layer gate in Check, as in the build CLI.
  for (const preset of plan.presets) compilePreset(preset.recipe, 32);
  const packagedCollectionJson = JSON.stringify(packaged);
  return {
    ready: true,
    collectionId: plan.collectionId,
    namespace: plan.namespace,
    modName: plan.modName,
    selectorLabel: plan.selectorLabel,
    originalPresetCount: source.presets.length,
    omissions,
    experimental,
    packagedCollectionSha256: createHash("sha256").update(packagedCollectionJson).digest("hex"),
    presets: plan.presets.map(p => ({ id: p.id, revision: p.revision, appearance: p.appearance, route: p.route })),
    packagedCollectionJson,
  };
}
