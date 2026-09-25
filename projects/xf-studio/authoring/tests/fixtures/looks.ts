/** Small helpers for tests written against the look/part model (feature-module platform §2). */
import { liveMemory, type CollectionDraft } from "../../src/collection-workspace";
import { LIVE_FEATURE, STUDIO_PARTS, STUDIO_DOCUMENTS } from "../../src/compose/studio-registry";
import { LOOK_HISTORY_1, type Look, type LookHistoryData } from "../../src/platform/api";
import { lookHistoryBodies } from "../../src/platform/core/look-history";
import type { DocumentHistory } from "../../src/authoring-document";
import type { Recipe } from "../../src/recipe";
import { serializeWorkspace, type WorkspaceState } from "../../src/workspace-state";

/** A stored collection of either schema, as the in-memory look collection the library returns. */
export const looks = (collection: unknown) => STUDIO_PARTS.readCollection(collection, true);
/** The eye-makeup recipe of a look (the part body, not a copy). */
export const recipeOf = (look: Pick<Look, "parts"> | { readonly parts: Readonly<Look["parts"]> }) =>
  look.parts[LIVE_FEATURE]!.body as Recipe;
/**
 * An Undo history (the look history's data, or whole recipes) as eye makeup's whole recipes, oldest
 * first: fresh copies, for tests that read what each step restores.
 */
export const historyRecipes = (history: DocumentHistory | Readonly<LookHistoryData>): Recipe[] => structuredClone(Array.isArray(history)
  ? history : (lookHistoryBodies(history as LookHistoryData, STUDIO_PARTS)?.bodies ?? []) as Recipe[]);
/**
 * `value` with every look history in it (a workspace's, a draft's or an editor's) replaced by the whole
 * recipes its steps restore: for comparing content, since chunk addresses follow key order, which a
 * migrated recipe's first read may differ in.
 */
export function historiesAsRecipes<T>(value: T): T {
  const walk = (item: unknown): unknown => {
    if (!item || typeof item !== "object") return item;
    if (Array.isArray(item)) return item.map(walk);
    if ((item as { schema?: unknown }).schema === LOOK_HISTORY_1)
      return { recipes: historyRecipes(item as LookHistoryData), trimmed: (item as LookHistoryData).trimmed === true };
    return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, walk(entry)]));
  };
  return walk(value) as T;
}
/** The live editor's memory of one preset of a draft, with its Undo history as whole recipes. */
export const memoryOf = (draft: { readonly memory: object }, id: string) => {
  const memory = liveMemory((draft.memory as CollectionDraft["memory"])[id], STUDIO_DOCUMENTS);
  return { ...memory, history: historyRecipes(memory.history) };
};
/** A live workspace as storage holds it (`xfs/workspace-2`, through JSON), for restore tests. */
export const storedWorkspace = (state: WorkspaceState) => JSON.parse(JSON.stringify(serializeWorkspace(state, STUDIO_DOCUMENTS)));
