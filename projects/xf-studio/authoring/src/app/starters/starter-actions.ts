/**
 * The starter actions (profiles design §6): choose the starter new layers and looks start from, save a layer's shape as the person's own
 * starter, rename or delete one (a tombstone), and restore it (the Undo notice's action). Adding a layer from a starter is the feature's
 * own `layer.edit` command (`starter` names it); the application resolves the person's own starters into a shape before it applies.
 *
 * This joins `ShapeStarters` (which owns the starters) to the layers the application edits. It holds no state of its own.
 */
import { refusal, type Capability } from "../../platform/api/capability";
import type { LookRef } from "../../library/collection-documents";
import type { Layer } from "../../engines/layered-makeup/recipe";
import { shapeOfLayer } from "../../engines/layered-makeup/starter-shape";
import type { ShapeStarters, StarterView } from "./shape-starters";

export type StarterAction =
  | { kind: "starters.setDefault"; starter: string }
  | { kind: "starters.save"; look: LookRef; layerId: string; name: string }
  | { kind: "starters.rename"; starter: string; name: string }
  | { kind: "starters.delete"; starter: string }
  | { kind: "starters.restore"; starter: string };

/** What a presentation reads: the starters in menu order, and which one new layers use. Detached; changes arrive through `subscribe`. */
export type StarterListing = { readonly feature: string; readonly label: string; readonly starters: readonly StarterView[]; readonly defaultId: string;
  /** What each starter's thumbnail draws behind its outline (the region's). */
  readonly thumbnail: StarterThumbnail };
export type StarterThumbnail = Readonly<{ window: { u0: number; u1: number; v0: number; v1: number }; guides: readonly (readonly (readonly [number, number])[])[] }>;
export type StartersPort = { snapshot(): StarterListing; subscribe(listener: () => void): () => void };

export type StarterActionsDeps = {
  readonly starters: ShapeStarters;
  readonly feature: string;
  readonly label: string;
  readonly thumbnail: StarterThumbnail;
  /** Resolve only within the named look; a changed or missing editor target is refused. */
  layer(look: LookRef, id: string): Layer | undefined;
};

export class StarterActions {
  constructor(private readonly deps: StarterActionsDeps) {}

  capability(action: StarterAction): Capability {
    const { starters } = this.deps;
    switch (action.kind) {
      case "starters.setDefault": return starters.defaultCapability(action.starter);
      case "starters.save": {
        const layer = this.deps.layer(action.look, action.layerId);
        return layer ? starters.capability({ kind: "create", name: action.name, shape: shapeOfLayer(layer) }) : refusal("missing_target", "That look or layer is no longer available. Open the layer and save it again.");
      }
      case "starters.rename": return starters.capability({ kind: "rename", id: action.starter, name: action.name });
      case "starters.delete": return starters.capability({ kind: "delete", id: action.starter });
      case "starters.restore": return starters.capability({ kind: "restore", id: action.starter });
    }
  }
  dispatch(action: StarterAction): undefined {
    const { starters } = this.deps, allowed = this.capability(action);
    if (!allowed.available) throw Error(allowed.reason ?? "That can't be done.");
    const done = action.kind === "starters.setDefault" ? starters.setDefault(action.starter)
      : action.kind === "starters.save" ? starters.dispatch({ kind: "create", name: action.name, shape: shapeOfLayer(this.deps.layer(action.look, action.layerId)!) })
      : action.kind === "starters.rename" ? starters.dispatch({ kind: "rename", id: action.starter, name: action.name })
      : starters.dispatch({ kind: action.kind === "starters.delete" ? "delete" : "restore", id: action.starter });
    if (!done.ok) throw Error(done.reason);
    return undefined;
  }
  /** The presentation port over the starters. */
  port(): StartersPort {
    const { starters, feature, label, thumbnail } = this.deps;
    return Object.freeze({ snapshot: () => ({ feature, label, starters: starters.list(), defaultId: starters.defaultId(), thumbnail }), subscribe: (listener: () => void) => starters.subscribe(listener) });
  }
}
