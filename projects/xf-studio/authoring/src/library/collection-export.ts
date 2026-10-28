/** The live feature's released compiler-file and package-result bridge, on its existing part registration. */
import type { LookCollection, PackageBuildProgress, PackageBuildResult, PackageCheckResult } from "../platform/api";
import type { DocumentModel } from "../app/workspace/collection-workspace";
export type CollectionExport = {
  unavailable(collection: LookCollection): string | undefined;
  plan(collection: LookCollection): unknown;
  checkLine(result: PackageCheckResult): string;
  buildLine(result: PackageBuildResult): string;
  stageLine(progress: PackageBuildProgress): string;
};
export const EVERY_LOOK_NEWER_MESSAGE = "Every look in this collection was made with a newer version of XF Studio, so this version " +
  "can't put them in a mod. Update XF Studio to build it.";
export const NO_COLLECTION_EXPORT = "No mod exporter is registered for this collection.";
export function registeredCollectionExport(model: DocumentModel): CollectionExport | undefined {
  const owner = model.live === undefined ? undefined : model.parts.feature(model.live);
  return owner?.exports ? (owner as typeof owner & { collectionExport?: CollectionExport }).collectionExport : undefined;
}
