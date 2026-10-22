import type { ModuleRegistration } from "../platform/api";
import { createViewServices } from "./view-actions";
import { AuthoringControlEdits } from "./authoring/authoring-control-edits";
import { AuthoringDocument } from "./authoring/authoring-document";
import { eyeMakeupPort, RecipeActions, type EyeMakeupGestures, type EyeMakeupSpec } from "../legacy/eye-makeup/authoring-eye-makeup";
import { AuthoringGeometry } from "./authoring/authoring-geometry";
import { AuthoringGestures } from "./authoring/authoring-gestures";
import { gestureHistoryLabel } from "../legacy/eye-makeup/history-labels";
import { AuthoringPresentation } from "./authoring/authoring-presentation";
import type { DocumentModel } from "./workspace/collection-workspace";
import type { AnyOwner, Registry } from "../platform/core/registry";
import { LiveFeatures } from "../platform/core/live-features";
import { createHistoryService, type HistoryService } from "../platform/core/history-service";
import { StudioApplication } from "./studio-application";
import type { Recipe } from "../engines/layered-makeup/recipe";
import type { LayeredMakeupRegion } from "../engines/layered-makeup/region";
import type { WorkspaceState } from "./workspace/workspace-state";

/**
 * What the composition roots hand the trusted core (feature-module platform §4, CORE-29): the
 * action registry and the document model. Built once in `compose/` and passed in by the startup
 * and server roots; nothing below the roots imports the composition.
 */
export type StudioComposition = { readonly registry: Registry<AnyOwner>; readonly documents: DocumentModel;
  /** The live feature's layered-makeup region (eye makeup's), which its port, catalogues and edits use. */
  readonly region: LayeredMakeupRegion;
  /** The Studio modules and every view tool (view-graph-design.md §3.9); absent in fixtures (only the platform's tools). */
  readonly modules?: ModuleRegistration };

/** Trusted, DOM-free authoring composition. The presentation receives only StudioApplication. */
export function createTrustedAuthoringCore(workspace: WorkspaceState, ports: {
  resetStack(previous: Recipe): void;
  selectedCollection(): string;
  /** Where new items' IDs come from (default: random UUIDs); tests pass a deterministic source. */
  newId?(): string;
  /** The session's history service (the startup root creates it and shares it with the experiments); default: one of its own. */
  history?: HistoryService;
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
  // The live document edits the live feature's part; its look history chunks parts through the part registry.
  // Every other registered feature has a live document beside it, so one Undo step can span several parts.
  const others = new LiveFeatures(documents.parts.features().filter(feature => feature !== documents.live)
    .map(feature => documents.parts.feature(feature)!));
  // Every Undo history of the session is a scope of one history service: the look's (this document), the View and lighting
  // history (the view graph) and, through the experiments, their documents'.
  const history = ports.history ?? createHistoryService();
  const document = new AuthoringDocument({ recipe: workspace.recipe, active: workspace.active,
    selected: workspace.selected, fieldSelection: workspace.fieldSelection, history: workspace.history,
    ...(workspace.historyTrimmed ? { historyTrimmed: true } : {}),
    ...(workspace.liveFeatures ? { liveFeatures: workspace.liveFeatures } : {}),
    ...(workspace.liveLocked ? { liveLocked: workspace.liveLocked } : {}) }, { feature: documents.live, parts: documents.parts, others },
    { history, resetStack: previous => ports.resetStack(previous) });
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
  // The view graph (view-graph-design.md §3.3): every view's camera, light, display, scene and tool state, for the whole session.
  const { views, viewActions } = createViewServices(workspace.preview, workspace.views, composition.modules, history);
  const app = new StudioApplication({ document, eyeMakeup, history, gestures, controls, views, viewActions,
    ...(ports.newId ? { newId: ports.newId } : {}) }, registry);
  return { document, geometry, presentation, recipe, eyeMakeup, gestures, controls, app, history, documents, views };
}
