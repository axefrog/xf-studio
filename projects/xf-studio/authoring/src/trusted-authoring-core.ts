import { AuthoringControlEdits } from "./authoring-control-edits";
import { AuthoringDocument } from "./authoring-document";
import { eyeMakeupPort, type EyeMakeupGestures, type EyeMakeupSpec } from "./authoring-eye-makeup";
import { AuthoringGeometry } from "./authoring-geometry";
import { AuthoringGestures } from "./authoring-gestures";
import { AuthoringHistory } from "./authoring-history";
import { AuthoringPresentation } from "./authoring-presentation";
import type { DocumentModel } from "./collection-workspace";
import type { AnyOwner, Registry } from "./platform/core/registry";
import { RecipeActions } from "./recipe-actions";
import { StudioApplication } from "./studio-application";
import type { Recipe } from "./recipe";
import type { WorkspaceState } from "./workspace-state";

/**
 * What the composition roots hand the trusted core (feature-module platform §4, CORE-29): the
 * action registry and the document model. Built once in `compose/` and passed in by the startup
 * and server roots; nothing below the roots imports the composition.
 */
export type StudioComposition = { readonly registry: Registry<AnyOwner>; readonly documents: DocumentModel };

/** Trusted, DOM-free authoring composition. The presentation receives only StudioApplication. */
export function createTrustedAuthoringCore(workspace: WorkspaceState, ports: {
  resetStack(previous: Recipe): void;
  selectedCollection(): string;
  /** Where new items' IDs come from (default: random UUIDs); tests pass a deterministic source. */
  newId?(): string;
}, composition: StudioComposition) {
  const { registry, documents } = composition;
  const live = registry.owner(documents.live);
  if (live?.owner !== "feature" || !live.gestures) throw Error(`The live feature ${documents.live} is not a registered feature with gestures.`);
  const specOf = (kind: string): EyeMakeupSpec => {
    const route = registry.route(kind);
    if (!route.ok || route.owner.id !== documents.live) throw Error(`${kind} is not an action of ${documents.live}.`);
    return route.spec as EyeMakeupSpec;
  };
  // The live document edits the live feature's part; its look history chunks parts through the part registry.
  const document = new AuthoringDocument({ recipe: workspace.recipe, active: workspace.active,
    selected: workspace.selected, fieldSelection: workspace.fieldSelection, history: workspace.history,
    ...(workspace.historyTrimmed ? { historyTrimmed: true } : {}) }, { feature: documents.live, parts: documents.parts });
  const geometry = new AuthoringGeometry(document);
  const presentation = new AuthoringPresentation(document, geometry);
  const recipe = new RecipeActions(
    () => ({ recipe: document.recipe, active: document.active,
      selected: document.selected, fieldSelection: document.fieldSelection }),
    (next, effect) => document.applyActionState(next, effect),
    document, workspace.glitterChoices, ports.selectedCollection,
    (index, kind) => document.gestureChanged(index, kind));
  const history = new AuthoringHistory(document, previous => ports.resetStack(previous));
  const undo = () => history.undo();
  // Cancelling a gesture or form transaction restores its checkpoint without creating Redo.
  const revert = () => history.revert();
  // Eye makeup's registered behaviour runs over this port; stack edits reset the preview's layer resources.
  const eyeMakeup = eyeMakeupPort(document, recipe, ports.resetStack, ports.newId);
  // Gesture frames run the module's registered gestures and publish through the port (CORE-31).
  const gestures = new AuthoringGestures(document,
    { applyGesture: edit => eyeMakeup.gesture(live.gestures as EyeMakeupGestures, edit) }, revert);
  // Form controls apply through the registered apply and the port too; their transaction owns the
  // Undo entry, so no checkpoint is recorded here. StudioApplication.controlEdit runs the capability
  // gate first and reports failures as typed results, so hosts wire nothing here.
  const controls = new AuthoringControlEdits(document, action => eyeMakeup.apply(specOf(action.kind), action, false).changed, revert);
  const app = new StudioApplication({ document, eyeMakeup, undo, history, gestures, controls }, registry);
  return { document, geometry, presentation, recipe, eyeMakeup, gestures, controls, app, undo, history, documents };
}
