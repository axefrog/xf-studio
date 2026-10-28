/** Released makeup test vocabulary over the real neutral product constructors and their one registered projection. */
import { createTrustedAuthoringCore as createCore, type StudioComposition as NeutralComposition } from "../../src/app/trusted-authoring-core";
import { makeupProjection, type MakeupView } from "../../src/app/authoring/makeup-view";
import { lookWorkspace, type WorkspaceState } from "../../src/app/workspace/makeup-workspace";
import { readRecipe } from "../../src/legacy/eye-makeup/recipe-schema";
import type { LayeredMakeupRegion } from "../../src/engines/layered-makeup/region";
import type { createProfileAuthoring } from "../../src/app/profiles/profile-authoring";
export * from "../../src/app/trusted-authoring-core";
export type StudioComposition = NeutralComposition & { documents: NeutralComposition["documents"] & { live: string }; region: LayeredMakeupRegion };
export function withMakeupCore<T extends { projections: ReadonlyMap<string, object>; documents: { live?: string } }>(core: T): Omit<T, keyof MakeupView> & MakeupView {
  const projection = makeupProjection(core);
  if (!projection) throw Error("This fixture requires registered makeup authoring.");
  return { ...core, ...projection };
}
export function createTrustedAuthoringCore(workspace: WorkspaceState, ports: Parameters<typeof createCore>[1], composition: NeutralComposition) {
  return withMakeupCore(createCore(lookWorkspace({ ...workspace, recipe: readRecipe(workspace.recipe) }, composition.documents), ports, composition));
}
export function makeupProfileFixture(authoring: ReturnType<typeof createProfileAuthoring>) {
  const contexts = new Proxy(authoring.contexts, { get(target, key) {
    if (key === "acquire") return (...args: Parameters<typeof target.acquire>) => {
      const held = target.acquire(...args);
      if (!held) return undefined;
      const value = held.context.projections.get("eye-makeup") as MakeupView;
      return { ...held, context: { ...held.context, ...value } };
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } }) as Omit<typeof authoring.contexts, "acquire"> & { acquire(...args: Parameters<typeof authoring.contexts.acquire>):
    { context: Omit<NonNullable<ReturnType<typeof authoring.contexts.acquire>>["context"], keyof MakeupView> & MakeupView; release(): void } | undefined };
  return { ...authoring, core: withMakeupCore(authoring.core), empty: withMakeupCore(authoring.empty), contexts };
}
