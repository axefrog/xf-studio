/** Small helpers for tests written against the look/part model (feature-module platform §2). */
import { liveMemory, type CollectionDraft } from "../../src/collection-workspace";
import { LIVE_FEATURE, STUDIO_PARTS } from "../../src/compose/studio-registry";
import type { Look } from "../../src/platform/api";
import type { Recipe } from "../../src/recipe";
import { serializeWorkspace, type WorkspaceState } from "../../src/workspace-state";

/** A stored collection of either schema, as the in-memory look collection the library returns. */
export const looks = (collection: unknown) => STUDIO_PARTS.readCollection(collection, true);
/** The eye-makeup recipe of a look (the part body, not a copy). */
export const recipeOf = (look: Pick<Look, "parts"> | { readonly parts: Readonly<Look["parts"]> }) =>
  look.parts[LIVE_FEATURE]!.body as Recipe;
/** The live editor's memory of one preset of a draft. */
export const memoryOf = (draft: { readonly memory: object }, id: string) =>
  liveMemory((draft.memory as CollectionDraft["memory"])[id]);
/** A live workspace as storage holds it (`xfs/workspace-2`, through JSON), for restore tests. */
export const storedWorkspace = (state: WorkspaceState) => JSON.parse(JSON.stringify(serializeWorkspace(state)));
