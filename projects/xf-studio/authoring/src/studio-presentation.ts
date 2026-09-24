import type { AuthoringPresentation } from "./authoring-presentation";
import type { CollectionViewPort } from "./collection-application";
import { emptyPresentationStatus, type PresentationStatus } from "./presentation-status";
import type { Layer, Recipe, WarpField } from "./recipe";
import type { PreviewReadiness } from "./authoring-preview-coordinator";
import type { ReadonlyDeep } from "./read-only";
import type { StudioApplication } from "./studio-application";
import type { StudioFileOperations } from "./studio-file-operations";
import type { UIPreferenceActions } from "./ui-preferences";
import type { ViewportAttachment } from "./viewport-attachment";
import type { LocalSetupActions } from "./local-setup-actions";

/** The complete current UI entry point. Construct it only in the trusted composition root. */
export type StudioPresentationPort<Slot> = {
  readonly authoring: Pick<StudioApplication,
    "actionKinds" | "requestKinds" | "actionDescriptors" | "requestDescriptors" |
    "gestureDescriptors" | "fileKinds" | "fileDescriptors" | "registry" | "descriptorsFor" | "targetCapability" | "contextCapability" |
    "choicesFor" | "limitsFor" | "contextFor" | "contextOptionsFor" | "contextQuery" |
    "boundActionCapability" | "dispatchContext" | "capability" | "actionsFor" | "dispatch" |
    "controlBegin" | "controlEdit" | "controlCommit" | "controlCancel" |
    "requestCapability" | "execute" | "canBeginGesture" | "gestureCapability" |
    "beginGesture" | "applyGesture" | "endGesture" | "previewState" | "history" | "finishCatalogue" |
    "glitterModelCatalogue"> & {
      snapshot(): ReadonlyDeep<ReturnType<StudioApplication["snapshot"]>>;
    };
  readonly library: CollectionViewPort;
  readonly files: Pick<StudioFileOperations, "capability" | "execute" | "activity" | "cancel"> & {
    snapshot(): ReadonlyDeep<ReturnType<StudioFileOperations["snapshot"]>>;
  };
  readonly viewport: Pick<ViewportAttachment<Slot>, "attach" | "rehost" |
    "resize" | "cancelInput" | "uvCommandCapability" | "uvCommand" | "contextAt"> & {
      snapshot(): ReadonlyDeep<ReturnType<ViewportAttachment<Slot>["snapshot"]>>;
    };
  readonly preferences: Pick<UIPreferenceActions, "capability" | "dispatch"> & {
    snapshot(): ReadonlyDeep<ReturnType<UIPreferenceActions["snapshot"]>>;
  };
  readonly previewReadiness: { snapshot(): Readonly<PreviewReadiness> };
  /**
   * Cheap, cached read-only editor view for repainting controls on every change.
   * Returned objects are detached from the authored document; `revision` changes
   * whenever geometry is published, including in-place gesture updates.
   */
  readonly editor: {
    recipe(): ReadonlyDeep<Recipe>;
    layer(): ReadonlyDeep<Layer> | undefined;
    active(): number;
    selected(): number;
    selectedField(): ReadonlyDeep<WarpField> | undefined;
    revision(): number;
    canUndo(): boolean;
  };
  /** Browser draft autosave and optional preview-asset diagnostics from trusted adapters. */
  readonly status: { snapshot(): ReadonlyDeep<PresentationStatus> };
  readonly localSetup: Pick<LocalSetupActions, "capability" | "dispatch"> & {
    snapshot(): ReadonlyDeep<ReturnType<LocalSetupActions["snapshot"]>>;
  };
  snapshot(): ReadonlyDeep<{
    authoring: ReturnType<StudioApplication["snapshot"]>;
    library: ReturnType<CollectionViewPort["view"]>;
    files: ReturnType<StudioFileOperations["snapshot"]>;
    viewport: ReturnType<ViewportAttachment<Slot>["snapshot"]>;
    preferences: ReturnType<UIPreferenceActions["snapshot"]>;
    previewReadiness: PreviewReadiness;
    status: PresentationStatus;
    localSetup: ReturnType<LocalSetupActions["snapshot"]>;
  }>;
  subscribe(listener: () => void): () => void;
};
type StatusSource = { snapshot(): PresentationStatus; subscribe(listener: () => void): () => void };

/** Method wrappers prevent a presentation consumer from receiving trusted service objects. */
export function createStudioPresentation<Slot>(sources: {
  authoring: StudioApplication;
  library: CollectionViewPort;
  files: StudioFileOperations;
  viewport: ViewportAttachment<Slot>;
  preferences: UIPreferenceActions;
  previewReadiness: { readiness(): PreviewReadiness; subscribe(listener: () => void): () => void };
  /** Optional for fixtures; without it the editor view falls back to detached snapshots. */
  editor?: AuthoringPresentation;
  status?: StatusSource;
  localSetup?: LocalSetupActions;
}): StudioPresentationPort<Slot> {
  const a = sources.authoring, l = sources.library, f = sources.files,
    v = sources.viewport, p = sources.preferences, r = sources.previewReadiness,
    e = sources.editor;
  const s: StatusSource = sources.status ?? { snapshot: () => emptyPresentationStatus(),
    subscribe: () => () => {} };
  const authoring: StudioPresentationPort<Slot>["authoring"] = {
    snapshot: () => a.snapshot(), actionKinds: () => a.actionKinds(),
    requestKinds: () => a.requestKinds(), actionDescriptors: () => a.actionDescriptors(),
    requestDescriptors: () => a.requestDescriptors(), gestureDescriptors: () => a.gestureDescriptors(),
    fileKinds: () => a.fileKinds(), fileDescriptors: () => a.fileDescriptors(), registry: () => a.registry(),
    descriptorsFor: target => a.descriptorsFor(target),
    targetCapability: target => a.targetCapability(target),
    contextCapability: (target, action) => a.contextCapability(target, action),
    choicesFor: (target, kind, field, base) => a.choicesFor(target, kind, field, base),
    limitsFor: (target, kind, variant) => a.limitsFor(target, kind, variant),
    contextFor: hit => a.contextFor(hit),
    contextOptionsFor: context => a.contextOptionsFor(context),
    contextQuery: hit => a.contextQuery(hit),
    boundActionCapability: (context, action) => a.boundActionCapability(context, action),
    dispatchContext: (context, action) => a.dispatchContext(context, action),
    capability: action => a.capability(action), actionsFor: target => a.actionsFor(target),
    dispatch: action => a.dispatch(action),
    controlBegin: (id, layerId) => a.controlBegin(id, layerId),
    controlEdit: (id, action) => a.controlEdit(id, action),
    controlCommit: id => a.controlCommit(id), controlCancel: id => a.controlCancel(id),
    requestCapability: request => a.requestCapability(request), execute: request => a.execute(request),
    canBeginGesture: (source, layerId) => a.canBeginGesture(source, layerId),
    gestureCapability: (source, target) => a.gestureCapability(source, target),
    beginGesture: (source, layerId) => a.beginGesture(source, layerId),
    applyGesture: (source, proposal) => a.applyGesture(source, proposal),
    endGesture: (source, cancel) => a.endGesture(source, cancel),
    previewState: () => a.previewState(), history: () => a.history(), finishCatalogue: () => a.finishCatalogue(),
    glitterModelCatalogue: () => a.glitterModelCatalogue(),
  };
  const fallback = () => a.snapshot().document;
  const editor: StudioPresentationPort<Slot>["editor"] = e ? {
    recipe: () => e.recipe(), layer: () => e.layer(), active: () => e.active, selected: () => e.selected,
    selectedField: () => e.selectedField(), revision: () => e.revision, canUndo: () => e.canUndo,
  } : {
    recipe: () => fallback().recipe, layer: () => { const d = fallback(); return d.recipe.layers[d.active]; },
    active: () => fallback().active, selected: () => fallback().selected,
    selectedField: () => { const d = fallback(), layer = d.recipe.layers[d.active];
      return layer?.fields.find(field => field.id === d.fieldSelection[layer.id]) ?? layer?.fields[0]; },
    revision: () => -1, canUndo: () => a.capability({ kind: "recipe.undo" }).available,
  };
  const library: CollectionViewPort = {
    view: () => l.view(), summary: () => l.summary(), persistence: () => l.persistence(),
    subscribe: listener => l.subscribe(listener),
    capability: action => l.capability(action), dispatch: action => l.dispatch(action),
    fileCapability: action => l.fileCapability(action), fileExecute: action => l.fileExecute(action),
    execute: request => l.execute(request), currentLayerCount: () => l.currentLayerCount(),
  };
  const files: StudioPresentationPort<Slot>["files"] = {
    snapshot: () => f.snapshot(), capability: action => f.capability(action),
    execute: action => f.execute(action), activity: () => f.activity(), cancel: id => f.cancel(id),
  };
  const viewport: StudioPresentationPort<Slot>["viewport"] = {
    snapshot: () => v.snapshot(), attach: (kind, slot) => v.attach(kind, slot),
    rehost: (kind, slot) => v.rehost(kind, slot), resize: kind => v.resize(kind),
    cancelInput: kind => v.cancelInput(kind),
    uvCommandCapability: command => v.uvCommandCapability(command),
    uvCommand: command => v.uvCommand(command),
    contextAt: (kind, x, y) => v.contextAt(kind, x, y),
  };
  const preferences: StudioPresentationPort<Slot>["preferences"] = {
    snapshot: () => p.snapshot(), capability: action => p.capability(action),
    dispatch: action => p.dispatch(action),
  };
  const previewReadiness = Object.freeze({ snapshot: () => r.readiness() });
  const localSetup: StudioPresentationPort<Slot>["localSetup"] = sources.localSetup ? {
    snapshot: () => sources.localSetup!.snapshot(), capability: action => sources.localSetup!.capability(action),
    dispatch: action => sources.localSetup!.dispatch(action),
  } : {
    snapshot: () => ({ busy: false }), capability: () => ({ available: false, reason: "Local setup is unavailable on this host." }),
    dispatch: async () => ({ ok: false, code: "unavailable", message: "Local setup is unavailable on this host." }),
  };
  return Object.freeze({ authoring: Object.freeze(authoring), library: Object.freeze(library),
    files: Object.freeze(files), viewport: Object.freeze(viewport), preferences: Object.freeze(preferences),
    previewReadiness, editor: Object.freeze(editor), localSetup: Object.freeze(localSetup),
    status: Object.freeze({ snapshot: () => s.snapshot() }),
    snapshot: () => ({ authoring: a.snapshot(), library: l.view(), files: f.snapshot(),
      viewport: v.snapshot(), preferences: p.snapshot(), previewReadiness: r.readiness(),
      status: s.snapshot(), localSetup: localSetup.snapshot() }),
    subscribe(listener: () => void) {
      const unsubs = [a.subscribe(listener), l.subscribe(listener), f.subscribe(listener),
        v.subscribe(listener), p.subscribe(listener), r.subscribe(listener), s.subscribe(listener),
        ...(sources.localSetup ? [sources.localSetup.subscribe(listener)] : [])];
      return () => { for (const unsubscribe of unsubs) unsubscribe(); };
    },
  });
}
