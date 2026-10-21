/**
 * The collection family's actions and the summaries views read (profiles design §7): types and the package-plan edit only. The service
 * that applies them over the collection owner is `collection-service.ts`.
 */
import type { PresetCommand } from "../app/workspace/collection-workspace";
import type { LookCollection } from "../platform/api";
import type { Recipe } from "../engines/layered-makeup/recipe";
import type { ValidationIssue } from "../platform/api/validation-issues";
import type { ReasonCode } from "../platform/api";
import type { PackagePlanEdit } from "../platform/core/package-plan";

/** A named version in the library: the collection as looks (`xfs/collection-2` in memory), whatever schema its row was written in. */
export type StoredCollection = { collection: LookCollection; revision: number; updatedAt: string };
/** One collection as the library lists its named versions. */
export type CollectionSummary = { id: string; name: string; revision: number; count: number; updatedAt: string };

/** The package-plan actions' kinds. */
export const PACKAGE_PLAN_KINDS = ["package.rename", "package.assign", "package.split", "package.merge"] as const;
export type PackagePlanAction = Extract<CollectionAction, { kind: (typeof PACKAGE_PLAN_KINDS)[number] }>;
/** The plan edit an action asks for (`newId` is filled by the session before it applies). */
export function packagePlanEdit(action: PackagePlanAction, newId = ""): PackagePlanEdit {
  switch (action.kind) {
    case "package.rename": return { kind: "rename", productId: action.productId, name: action.modName.trim() ? action.modName : null };
    case "package.assign": return { kind: "assign", feature: action.feature, productId: action.productId };
    case "package.split": return { kind: "split", feature: action.feature, newId: action.newId ?? newId };
    case "package.merge": return { kind: "merge", productId: action.productId, intoId: action.intoId };
  }
}
/** One mod the draft would build, for views: primitives only. */
export type PackageProductSummary = { id: string; isDefault: boolean; modName: string; nameSource: "plan" | "derived";
  features: { id: string; label: string }[] };

export type CollectionAction =
  | { kind: "preset.edit"; command: PresetCommand }
  | { kind: "preset.select"; id: string }
  | { kind: "collection.rename"; name: string }
  /** Show another collection again: `draft` names a recent draft (its collection ID), else the collection shown before (Undo open). */
  | { kind: "collection.undoOpen"; draft?: string }
  | { kind: "collection.importRecipe"; recipe: Recipe; name: string }
  /**
   * The package plan (feature-module platform §6): which features ship in which XF mod. `package.rename` names a mod
   * (an empty `modName` goes back to the name that follows its features); `package.assign` moves a feature into an existing
   * mod; `package.split` moves one into a new mod of its own (`newId` from the host's ID source); `package.merge` puts
   * everything of one mod into another.
   */
  | { kind: "package.rename"; productId: string; modName: string }
  | { kind: "package.assign"; feature: string; productId: string }
  | { kind: "package.split"; feature: string; newId?: string }
  | { kind: "package.merge"; productId: string; intoId: string };
/** Collection actions a presentation may dispatch. */
export type CollectionStudioAction = CollectionAction;

export type ActionCapability = { available: boolean; reason?: string; issue?: ValidationIssue };
/** A capability with the reason code chosen where it was refused (`platform/api`). */
export type CodedCapability = ActionCapability & { code?: ReasonCode };
/** The shown collection, primitives only (the working copy: "draft" in views' words); building it never clones recipes or histories. */
export type CollectionDraftSummary = {
  id: string; name: string; revision?: number; selected?: string;
  /** `locked`: the look holds a newer build's data and is not editable in this version. */
  presets: { id: string; name: string; revision: number; layers: number; locked?: true }[];
  /** Oldest first; `restore` brings back the last entry. */
  removed: { id: string; name: string; index: number }[];
  /** The collection shown before an open or import (Undo open shows it again). */
  previous?: { id: string; name: string; revision?: number };
  /**
   * Recent drafts, newest first: the library's other working copies never saved as a version (release-readiness-audit.md item 13), each
   * with its collection ID, name and preset count.
   */
  recovery: { id: string; name: string; revision?: number; presets: number; locked?: true;
    /** How it stands against the library: never saved, the same as its saved version, edited since it, or unknown (not loaded). */
    saved: "never" | "same" | "edited" | "unknown" }[];
};
export type ReadonlyDeep<T> = T extends (infer U)[] ? readonly ReadonlyDeep<U>[] :
  T extends object ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> } : T;
