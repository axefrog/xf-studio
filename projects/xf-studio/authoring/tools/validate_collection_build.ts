// Read-only preflight for the local package builder. The compiler owns the finish gate.
import { preparePackageCollection } from "../src/package-filter";
import { compileFlatPreset } from "../src/preset-compiler";

const source = process.argv[2];
if (!source) throw Error("Usage: bun tools/validate_collection_build.ts collection.json");
const { source: original, packaged, plan, omissions } = preparePackageCollection(await Bun.file(source).json());
for (const preset of plan.presets) compileFlatPreset(preset.recipe, 32);
console.log(JSON.stringify({ collectionId: plan.collectionId, namespace: plan.namespace,
  originalPresetCount: original.presets.length, omissions,
  packagedCollectionJson: JSON.stringify(packaged),
  presets: plan.presets.map(p => ({ id: p.id, revision: p.revision, appearance: p.appearance })) }));
