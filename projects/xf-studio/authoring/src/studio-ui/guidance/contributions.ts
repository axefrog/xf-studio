import type { ReferenceSection } from "../../app/input-bindings";
import type { FeatureFacade } from "../../app/studio-presentation";
import type { StudioRuntime } from "../runtime";
import type { AnchorInfo } from "./anchors";
import type { GuidanceFacts, HelpTopic, Tour, HelpContent } from "./types";

export type GuidanceEditing = {
  facts(): Pick<GuidanceFacts, "layers" | "activeLayer" | "finish" | "color">;
  layer(): { readonly id: string; readonly enabled: boolean } | undefined;
  layerIds(): readonly string[];
  canCapture(): boolean;
};
export type GuidanceContent = {
  tours: readonly Tour[]; topics: readonly HelpTopic[]; onboarding?: { tour: string; offer: HelpContent & { eyebrow: string } };
  reference?: readonly ReferenceSection[];
  editing?: GuidanceEditing;
};
/** A view contributes plain content and a reader over its own facade; the runner knows no feature model. */
export type GuidanceContribution = {
  anchors: readonly (AnchorInfo & { readonly order: number })[];
  create(facade: never): GuidanceContent;
};
export function guidanceSources(rt: Pick<StudioRuntime, "port" | "views">) {
  const active = new Set(rt.port.features().map(feature => feature.id));
  return rt.views.guidance.filter(source => active.has(source.owner));
}
const contents = new WeakMap<object, Map<GuidanceContribution, { facade: FeatureFacade; content: GuidanceContent }>>();
export function guidanceContents(rt: Pick<StudioRuntime, "port" | "views">): GuidanceContent[] {
  const sources = guidanceSources(rt);
  let held = contents.get(rt.port);
  if (!held) contents.set(rt.port, held = new Map());
  for (const key of held.keys()) if (!sources.some(source => source.contribution === key)) held.delete(key);
  return sources.flatMap(({ owner, contribution }) => {
    const facade = rt.port.feature(owner);
    if (!facade) { held!.delete(contribution); return []; }
    const entry = held!.get(contribution);
    if (entry?.facade === facade) return [entry.content];
    const content = contribution.create(facade as never);
    held!.set(contribution, { facade, content });
    return [content];
  });
}
export const guidanceEditing = (rt: Pick<StudioRuntime, "port" | "views">) => guidanceContents(rt).find(content => content.editing)?.editing;
