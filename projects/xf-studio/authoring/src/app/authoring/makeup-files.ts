/** Eye makeup's explicit released-format adapter. Reads the neutral part owner, never the geometry/view projection. */
import type { FeatureFiles, FeatureFileOperations } from "../feature-files";
import type { CollectionExport } from "../../library/collection-export";
import { EVERY_LOOK_NEWER_MESSAGE } from "../../library/collection-export";
import type { Layer, Recipe } from "../../engines/layered-makeup/recipe";
import type { ReadonlyDeep } from "../../platform/api/read-only";
import { portableRecipe, readPortableRecipe, RECIPE_FILE_MESSAGE } from "../../legacy/eye-makeup/recipe-schema";
import { eyeMakeupCollection, planCollection } from "../../legacy/eye-makeup/export/preset-collection";
import { packageBuildLine, packageCheckLine } from "../../legacy/eye-makeup/export/package-filter";
import { packageBuildStageLine } from "../../legacy/eye-makeup/export/package-action";

export const NO_EDITABLE_EYE_MAKEUP_MESSAGE = "The looks with eye makeup here were made with a newer version of XF Studio, so this " +
  "version can't put them in a mod. Update XF Studio to build them, or add eye makeup to another look.";
/** Explicit adapter for released callers and their fixtures; the registered factory supplies neutral live-part reads. */
export function makeupFileOperations(sources: { recipe(): ReadonlyDeep<Recipe>; selectedLayer(): ReadonlyDeep<Layer> | undefined;
  importRecipe(value: Recipe, name: string, collection: string): void }): FeatureFileOperations {
  return {
    portable: { name: "xfs.recipe.json", invalidMessage: RECIPE_FILE_MESSAGE, message: "Recipe exported — editable shapes, colours and fields.",
      parse: readPortableRecipe, serialize: () => portableRecipe(sources.recipe() as Recipe),
      load: (value, name, collection) => sources.importRecipe(value as Recipe, name, collection) },
    mask: { capture() { const layer = sources.selectedLayer();
      return layer && { value: layer, name: `xfs-${layer.id}-alpha.png` };
    }, message: "Exported the layer's shape as a 2048 × 2048 mask.", unavailable: "Select a layer before exporting a mask." },
  };
}
export function makeupFiles(feature: string): FeatureFiles {
  return { create(host) {
    const state = () => { host.signal.throwIfAborted(); return host.document.features.document(feature)!.state(); };
    return makeupFileOperations({ recipe: () => state().part as Recipe,
      selectedLayer() { const current = state(); return (current.part as Recipe).layers[(current.editor as { active: number }).active]; },
      importRecipe(value, name, collection) {
        const result = host.application.dispatch({ kind: "collection.importRecipe", collection, recipe: value, name });
        if (!result.ok) throw Error(result.message);
        host.imported();
      } });
  } };
}
export function makeupCollectionExport(feature: string): CollectionExport {
  return {
    unavailable(collection) {
      const looks = collection.presets;
      if (looks.some(look => !look.locked && !!look.parts[feature])) return undefined;
      if (looks.length && looks.every(look => look.locked)) return EVERY_LOOK_NEWER_MESSAGE;
      return looks.some(look => look.locked) ? NO_EDITABLE_EYE_MAKEUP_MESSAGE
        : "None of these presets has eye makeup yet, so there is nothing to put in a mod.";
    },
    plan: collection => planCollection(eyeMakeupCollection(collection)),
    checkLine: packageCheckLine, buildLine: packageBuildLine, stageLine: packageBuildStageLine,
  };
}
