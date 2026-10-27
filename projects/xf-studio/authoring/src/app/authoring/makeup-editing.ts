/**
 * Stateless compatibility projections over the neutral look. Slice 5 routes actions/facades from
 * the feature's composition registration, not this bundle. Slice 6 must move gesture/control
 * transactions and recipe/effect publication to the registered editor, then delete this bundle;
 * the geometry/view and released-input projections remain explicit adapters in their later slices.
 */
import { AuthoringControlEdits } from "./authoring-control-edits";
import { AuthoringDocument } from "./makeup-document";
import { eyeMakeupPort, RecipeActions, type EyeMakeupGestures, type EyeMakeupSpec } from "../../legacy/eye-makeup/authoring-eye-makeup";
import { AuthoringGeometry } from "./authoring-geometry";
import { AuthoringGestures } from "./authoring-gestures";
import { gestureHistoryLabel } from "../../legacy/eye-makeup/history-labels";
import { AuthoringPresentation } from "./authoring-presentation";
import type { Recipe } from "../../engines/layered-makeup/recipe";
import type { WorkspaceState } from "../workspace/makeup-workspace";
import { lookWorkspace } from "../workspace/makeup-workspace";
import { readRecipe } from "../../legacy/eye-makeup/recipe-schema";

import type { AuthoringEditing, StudioComposition } from "../trusted-authoring-core";
/** Released callers may still supply a portable recipe file. Normalize it at this compatibility boundary. */
export function makeupEditingState(workspace: WorkspaceState, composition: StudioComposition) {
  const state = lookWorkspace({ ...workspace, recipe: readRecipe(workspace.recipe) }, composition.documents);
  return { features: state.liveFeatures, history: state.history, locked: state.liveLocked };
}

/** One look's data/edit machinery. No view graph, renderer, raster scheduler, collection or persistence writer. */
export function createMakeupEditing(editing: AuthoringEditing, workspace: Pick<WorkspaceState, "glitterChoices">, ports: {
  resetStack(previous: Recipe): void;
  selectedCollection(): string;
  newId?(): string;
  release?(): void;
}, composition: StudioComposition) {
  const { registry, documents } = composition;
  if (composition.region.id !== documents.live) throw Error(`The composition's layered-makeup region is not the live feature's (${documents.live}).`);
  const live = registry.owner(documents.live);
  if (live?.owner !== "feature" || !live.gestures) throw Error(`The live feature ${documents.live} is not a registered feature with gestures.`);
  const specOf = (kind: string): EyeMakeupSpec => {
    const route = registry.route(kind);
    if (!route.ok || route.owner.id !== documents.live) throw Error(`${kind} is not an action of ${documents.live}.`);
    return route.spec as EyeMakeupSpec;
  };
  // Attach without loading, copying or creating a part or history stack.
  const document = new AuthoringDocument(undefined,
    { feature: documents.live, parts: documents.parts, module: documents.parts.feature(documents.live)! },
    { look: editing.document, signal: editing.signal, release: ports.release, resetStack: ports.resetStack });
  const geometry = new AuthoringGeometry(document);
  const presentation = new AuthoringPresentation(document, geometry);
  const recipe = new RecipeActions(
    () => ({ recipe: document.recipe, active: document.active,
      selected: document.selected, fieldSelection: document.fieldSelection }),
    (next, effect) => document.applyActionState(next, effect),
    document, workspace.glitterChoices, ports.selectedCollection,
    (index, kind) => document.gestureChanged(index, kind));
  // Eye makeup's registered behaviour runs over this port; stack edits reset the preview's layer resources.
  const eyeMakeup = eyeMakeupPort(document, recipe, composition.region, ports.resetStack, ports.newId);
  // Gesture frames run the module's registered gestures and publish through the port (CORE-31); cancelling a gesture or form
  // transaction restores its start through the look scope, without creating Redo.
  const gestures = new AuthoringGestures(document,
    { applyGesture: edit => eyeMakeup.gesture(live.gestures as EyeMakeupGestures, edit) },
    edit => (live.gestures as EyeMakeupGestures).label?.(edit) ?? gestureHistoryLabel(edit));
  // Form controls apply through the registered apply and the port too; their transaction owns the
  // Undo entry, so no checkpoint is recorded here. StudioApplication.controlEdit runs the capability
  // gate first and reports failures as typed results, so hosts wire nothing here.
  const controls = new AuthoringControlEdits(document, action => eyeMakeup.apply(specOf(action.kind), action, false).changed,
    action => specOf(action.kind).label(action));
  return { document, geometry, presentation, recipe, eyeMakeup, gestures, controls };
}
