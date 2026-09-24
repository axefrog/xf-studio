import { AuthoringControlEdits } from "./authoring-control-edits";
import { AuthoringDocument } from "./authoring-document";
import { AuthoringGeometry } from "./authoring-geometry";
import { AuthoringGestures } from "./authoring-gestures";
import { AuthoringHistory } from "./authoring-history";
import { AuthoringLayerActions } from "./authoring-layer-actions";
import { AuthoringPresentation } from "./authoring-presentation";
import { RecipeActions, type RecipeAction } from "./recipe-actions";
import { StudioApplication } from "./studio-application";
import type { Recipe } from "./recipe";
import type { WorkspaceState } from "./workspace-state";

/** Trusted, DOM-free authoring composition. The presentation receives only StudioApplication. */
export function createTrustedAuthoringCore(workspace: WorkspaceState, ports: {
  resetStack(previous: Recipe): void;
  selectedCollection(): string;
  controlAction(action: RecipeAction): void;
}) {
  const document = new AuthoringDocument({ recipe: workspace.recipe, active: workspace.active,
    selected: workspace.selected, fieldSelection: workspace.fieldSelection, history: workspace.history });
  const geometry = new AuthoringGeometry(document);
  const presentation = new AuthoringPresentation(document, geometry);
  const layers = new AuthoringLayerActions(document, ports.resetStack);
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
  const gestures = new AuthoringGestures(document, recipe, revert);
  const controls = new AuthoringControlEdits(document, ports.controlAction, revert);
  const app = new StudioApplication({ document, recipe, layer: action => layers.dispatch(action),
    undo, history, gestures, controls });
  return { document, geometry, presentation, layers, recipe, gestures, controls, app, undo, history };
}
