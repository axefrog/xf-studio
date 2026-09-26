import type { AuthoringPresentation } from "./authoring-presentation";
import type { CollectionViewPort } from "./collection-application";
import { emptyPresentationStatus, type PresentationStatus } from "./presentation-status";
import { PREVIEW_SETUP_DESCRIPTORS } from "./studio-action-descriptors";
import type { Layer, Recipe, WarpField } from "./engines/layered-makeup/recipe";
import type { PreviewReadiness } from "./authoring-preview-coordinator";
import type { ReadonlyDeep } from "./read-only";
import type { StudioApplication, StudioCapability, StudioDispatchResult, StudioTarget } from "./studio-application";
import type { EyeMakeupAction } from "./eye-makeup-model";
import type { RecipeAction } from "./engines/layered-makeup/recipe-actions";
import type { FieldLimit } from "./platform/api";
import type { StudioFileOperations } from "./studio-file-operations";
import type { UIPreferenceActions } from "./ui-preferences";
import type { ViewportAttachment } from "./viewport-attachment";
import type { LocalSetupActions } from "./local-setup-actions";
import { InstallDetectionActions } from "./install-detection-actions";
import type { PreviewSetupActions, PreviewSetupSnapshot } from "./preview-setup";
import type { ProjectLink } from "./project-links";

/** Opens one of XF Studio's own public pages; the host resolves the name, the view never sends a URL. */
export type ProjectLinkPort = { open(link: ProjectLink): Promise<{ ok: true } | { ok: false; message: string }> };

/** One registered feature module as the presentation sees it (feature-module platform §4, step 5). */
export type FeatureInfo = { readonly id: string; readonly label: string; readonly stage: "stable" | "preview" | "dev" };
/**
 * A feature's typed facade: its actions only (another owner's kind is refused), their capability,
 * limits and choices, and a read-only view of its live document for the selected look.
 */
export type FeatureFacade<A extends { kind: string } = { kind: string }> = FeatureInfo & {
  /** The feature's action kinds, in catalogue order. */
  kinds(): readonly A["kind"][];
  /**
   * Whether the selected look's part of this feature can be edited here: refused (with a plain reason) when
   * the look was made with a newer version of XF Studio, so a view can say so on that look.
   */
  editable(): StudioCapability;
  /**
   * The plain reason when the selected look was made with a newer version of XF Studio, so this feature's part
   * of it is kept as it is and can't be edited here; undefined otherwise. Views show the newer-version notice
   * from this, never from an `unavailable` refusal (UI-53).
   */
  locked(): string | undefined;
  capability(action: A): StudioCapability;
  dispatch(action: A): StudioDispatchResult;
  limitsFor(target: StudioTarget, kind: A["kind"], variant?: string): Record<string, FieldLimit>;
  choicesFor(target: StudioTarget, kind: A["kind"], field: string, base?: Record<string, unknown>):
    ReturnType<StudioApplication["choicesFor"]>;
};
/**
 * Eye makeup's live editor view: cheap, cached and read-only, for repainting controls on every change.
 * Returned objects are detached from the authored document; `revision` changes whenever geometry is
 * published, including in-place gesture updates. (It was the port's `editor` before step 5.)
 */
export type EyeMakeupView = {
  recipe(): ReadonlyDeep<Recipe>;
  layer(): ReadonlyDeep<Layer> | undefined;
  active(): number;
  selected(): number;
  selectedField(): ReadonlyDeep<WarpField> | undefined;
  revision(): number;
  canUndo(): boolean;
};
/** Eye makeup's facade: its actions, its editor view, its form-control transactions and its catalogues. */
export type EyeMakeupFacade = FeatureFacade<EyeMakeupAction> & {
  view(): EyeMakeupView;
  controlBegin(id: string, layerId: string): boolean;
  controlEdit(id: string, action: RecipeAction): StudioDispatchResult;
  controlCommit(id: string): void;
  controlCancel(id: string): void;
  layerExport: StudioApplication["layerExport"];
  finishCatalogue: StudioApplication["finishCatalogue"];
  glitterModelCatalogue: StudioApplication["glitterModelCatalogue"];
};
/** Any other feature's facade: its live part and editor memory for the selected look, detached. */
export type GenericFeatureFacade = FeatureFacade & { view(): ReadonlyDeep<{ part?: unknown; editor?: unknown }> | undefined };
/** The facades with a typed view, by feature ID; every other registered feature gets a `GenericFeatureFacade`. */
export type PresentationFeatures = { readonly "eye-makeup": EyeMakeupFacade };
export type FeatureLookup = {
  <K extends keyof PresentationFeatures>(id: K): PresentationFeatures[K];
  (id: string): (FeatureFacade & { view(): unknown }) | undefined;
};

/** The complete current UI entry point. Construct it only in the trusted composition root. */
export type StudioPresentationPort<Slot> = {
  readonly authoring: Pick<StudioApplication,
    "actionKinds" | "requestKinds" | "actionDescriptors" | "requestDescriptors" |
    "gestureDescriptors" | "fileKinds" | "fileDescriptors" | "registry" | "descriptorsFor" | "targetCapability" | "contextCapability" |
    "choicesFor" | "limitsFor" | "contextFor" | "contextOptionsFor" | "contextQuery" |
    "boundActionCapability" | "dispatchContext" | "capability" | "actionsFor" | "dispatch" |
    "controlBegin" | "controlEdit" | "controlCommit" | "controlCancel" |
    "requestCapability" | "execute" | "canBeginGesture" | "gestureCapability" |
    "beginGesture" | "applyGesture" | "endGesture" | "previewState" | "history" | "historyTimeline" | "consequences" | "finishCatalogue" | "layerExport" |
    "glitterModelCatalogue" | "characterPanel" | "characterView" | "characterChoices"> & {
      snapshot(): ReadonlyDeep<ReturnType<StudioApplication["snapshot"]>>;
    };
  readonly library: CollectionViewPort;
  readonly files: Pick<StudioFileOperations, "capability" | "execute" | "activity" | "cancel"> & {
    snapshot(): ReadonlyDeep<ReturnType<StudioFileOperations["snapshot"]>>;
  };
  readonly viewport: Pick<ViewportAttachment<Slot>, "attach" | "rehost" |
    "resize" | "cancelInput" | "uvCommandCapability" | "uvCommand" | "uvNavigateCapability" | "uvNavigate" | "contextAt" |
    "input" | "subscribeInput"> & {
      snapshot(): ReadonlyDeep<ReturnType<ViewportAttachment<Slot>["snapshot"]>>;
    };
  readonly preferences: Pick<UIPreferenceActions, "capability" | "dispatch"> & {
    snapshot(): ReadonlyDeep<ReturnType<UIPreferenceActions["snapshot"]>>;
  };
  readonly previewReadiness: { snapshot(): Readonly<PreviewReadiness> };
  /** The registered feature modules, in catalogue order (feature-module platform §4). */
  features(): readonly FeatureInfo[];
  /** One feature's facade: typed for the features in `PresentationFeatures`, undefined for an unregistered ID. */
  readonly feature: FeatureLookup;
  /** Browser draft autosave and optional preview-asset diagnostics from trusted adapters. */
  readonly status: { snapshot(): ReadonlyDeep<PresentationStatus> };
  readonly localSetup: Pick<LocalSetupActions, "capability" | "dispatch"> & {
    snapshot(): ReadonlyDeep<ReturnType<LocalSetupActions["snapshot"]>>;
  };
  /** Read-only discovery of game installs and MO2 instances for setup suggestions. */
  readonly installDetection: Pick<InstallDetectionActions, "capability" | "dispatch" | "descriptors"> & {
    snapshot(): ReadonlyDeep<ReturnType<InstallDetectionActions["snapshot"]>>;
  };
  /**
   * 3D preview setup: the card, the WolvenKit consent and the head pane's next step, as a detached
   * snapshot and typed actions (preparation, WolvenKit download, detected folders, head retry).
   */
  readonly previewSetup: Pick<PreviewSetupActions, "capability" | "dispatch" | "descriptors"> & {
    snapshot(): ReadonlyDeep<PreviewSetupSnapshot>;
  };
  /** XF Studio's public pages (knowledge pages, issue tracker) for the Help view. */
  readonly links: ProjectLinkPort;
  snapshot(): ReadonlyDeep<{
    authoring: ReturnType<StudioApplication["snapshot"]>;
    library: ReturnType<CollectionViewPort["view"]>;
    files: ReturnType<StudioFileOperations["snapshot"]>;
    viewport: ReturnType<ViewportAttachment<Slot>["snapshot"]>;
    preferences: ReturnType<UIPreferenceActions["snapshot"]>;
    previewReadiness: PreviewReadiness;
    status: PresentationStatus;
    localSetup: ReturnType<LocalSetupActions["snapshot"]>;
    installDetection: ReturnType<InstallDetectionActions["snapshot"]>;
    previewSetup: PreviewSetupSnapshot;
  }>;
  subscribe(listener: () => void): () => void;
};
/** A fixture port has no host preview: nothing to set up, no card. */
const NO_PREVIEW_SETUP: PreviewSetupSnapshot = Object.freeze({
  card: { open: false, title: "", body: "", progress: null, step: null, notice: null, primary: null, secondary: null, links: [], canDismiss: true, busy: false },
  consent: null, head: { phase: "unavailable", code: null, message: "", progress: null, next: null }, setupRequests: 0, showRequests: 0, autostart: true,
}) as PreviewSetupSnapshot;
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
  installDetection?: InstallDetectionActions;
  /** Optional for fixtures; without it the port reports a head that needs no setup. */
  previewSetup?: PreviewSetupActions;
  /** Optional for fixtures; without it the Help view says the page can't be opened here. */
  links?: ProjectLinkPort;
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
    previewState: () => a.previewState(), history: () => a.history(),
    historyTimeline: () => a.historyTimeline(), consequences: subject => a.consequences(subject), finishCatalogue: () => a.finishCatalogue(),
    layerExport: layerId => a.layerExport(layerId),
    glitterModelCatalogue: () => a.glitterModelCatalogue(),
    characterPanel: () => a.characterPanel(), characterView: () => a.characterView(),
    characterChoices: (option, want) => a.characterChoices(option, want),
  };
  const fallback = () => a.snapshot().document;
  const editor: EyeMakeupView = e ? {
    recipe: () => e.recipe(), layer: () => e.layer(), active: () => e.active, selected: () => e.selected,
    selectedField: () => e.selectedField(), revision: () => e.revision, canUndo: () => e.canUndo,
  } : {
    recipe: () => fallback().recipe, layer: () => { const d = fallback(); return d.recipe.layers[d.active]; },
    active: () => fallback().active, selected: () => fallback().selected,
    selectedField: () => { const d = fallback(), layer = d.recipe.layers[d.active];
      return layer?.fields.find(field => field.id === d.fieldSelection[layer.id]) ?? layer?.fields[0]; },
    revision: () => -1, canUndo: () => a.capability({ kind: "history.undo" }).available,
  };
  // Feature facades: each feature's own kinds only; eye makeup adds its editor view, controls and catalogues.
  const infos: readonly FeatureInfo[] = Object.freeze(a.features().map(info => Object.freeze(info)));
  const facade = (info: FeatureInfo): FeatureFacade => {
    const own = (kind: string) => a.ownerOf(kind) === info.id;
    const foreign = { available: false as const, code: "invalid_value" as const, reason: `That is not a ${info.label.toLowerCase()} command.` };
    return { ...info,
      kinds: () => a.actionKinds().filter(own),
      editable: () => a.featureEditable(info.id), locked: () => a.featureLocked(info.id),
      capability: action => own(action.kind) ? a.capability(action as never) : foreign,
      dispatch: action => own(action.kind) ? a.dispatch(action as never) : { ok: false, code: foreign.code, message: foreign.reason },
      limitsFor: (target, kind, variant) => own(kind) ? a.limitsFor(target, kind as never, variant) : {},
      choicesFor: (target, kind, field, base) => own(kind) ? a.choicesFor(target, kind as never, field, base) : [],
    };
  };
  const facades = new Map<string, FeatureFacade>(infos.map(info => {
    const base = facade(info);
    if (info.id !== "eye-makeup") return [info.id, Object.freeze({ ...base, view: () => a.featureState(info.id) }) as GenericFeatureFacade];
    const eye: EyeMakeupFacade = { ...(base as FeatureFacade<EyeMakeupAction>), view: () => editor,
      controlBegin: (id, layerId) => a.controlBegin(id, layerId), controlEdit: (id, action) => a.controlEdit(id, action),
      controlCommit: id => a.controlCommit(id), controlCancel: id => a.controlCancel(id),
      layerExport: layerId => a.layerExport(layerId), finishCatalogue: () => a.finishCatalogue(),
      glitterModelCatalogue: () => a.glitterModelCatalogue() };
    return [info.id, Object.freeze(eye)];
  }));
  const feature = ((id: string) => facades.get(id)) as FeatureLookup;
  const library: CollectionViewPort = {
    view: () => l.view(), summary: () => l.summary(), persistence: () => l.persistence(),
    subscribe: listener => l.subscribe(listener),
    capability: action => l.capability(action), dispatch: action => l.dispatch(action),
    fileCapability: action => l.fileCapability(action), fileExecute: action => l.fileExecute(action),
    execute: request => l.execute(request), currentLayerCount: () => l.currentLayerCount(),
  };
  const files: StudioPresentationPort<Slot>["files"] = {
    // File workflows route through the application's registry (the `files` family).
    snapshot: () => f.snapshot(), capability: action => a.fileCapability(action),
    execute: action => a.executeFile(action), activity: () => f.activity(), cancel: id => f.cancel(id),
  };
  const viewport: StudioPresentationPort<Slot>["viewport"] = {
    snapshot: () => v.snapshot(), attach: (kind, slot) => v.attach(kind, slot),
    rehost: (kind, slot) => v.rehost(kind, slot), resize: kind => v.resize(kind),
    cancelInput: kind => v.cancelInput(kind),
    uvCommandCapability: command => v.uvCommandCapability(command),
    uvCommand: command => v.uvCommand(command),
    uvNavigateCapability: command => v.uvNavigateCapability(command), uvNavigate: command => v.uvNavigate(command),
    contextAt: (kind, x, y) => v.contextAt(kind, x, y),
    input: () => v.input(), subscribeInput: listener => v.subscribeInput(listener),
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
    snapshot: () => ({ busy: false }), capability: () => ({ available: false, reason: "Settings aren't available here." }),
    dispatch: async () => ({ ok: false, code: "unavailable", message: "Settings aren't available here." }),
  };
  const detection = sources.installDetection ?? new InstallDetectionActions(null);
  const installDetection: StudioPresentationPort<Slot>["installDetection"] = {
    snapshot: () => detection.snapshot(), capability: action => detection.capability(action),
    dispatch: action => detection.dispatch(action), descriptors: () => detection.descriptors(),
  };
  const setup = sources.previewSetup;
  const previewSetup: StudioPresentationPort<Slot>["previewSetup"] = setup ? {
    snapshot: () => setup.snapshot(), capability: action => setup.capability(action),
    dispatch: action => setup.dispatch(action), descriptors: () => setup.descriptors(),
  } : {
    snapshot: () => NO_PREVIEW_SETUP, capability: () => ({ available: false, reason: "The 3D preview isn't set up here." }),
    dispatch: async () => ({ ok: false, message: "The 3D preview isn't set up here." }), descriptors: () => structuredClone(PREVIEW_SETUP_DESCRIPTORS),
  };
  const linkSource = sources.links;
  const links: ProjectLinkPort = Object.freeze({ open: (link: ProjectLink) => linkSource ? linkSource.open(link)
    : Promise.resolve({ ok: false as const, message: "Web pages can't be opened from here." }) });
  return Object.freeze({ authoring: Object.freeze(authoring), library: Object.freeze(library),
    files: Object.freeze(files), viewport: Object.freeze(viewport), preferences: Object.freeze(preferences),
    previewReadiness, features: () => infos, feature, localSetup: Object.freeze(localSetup),
    installDetection: Object.freeze(installDetection), previewSetup: Object.freeze(previewSetup),
    status: Object.freeze({ snapshot: () => s.snapshot() }), links,
    snapshot: () => ({ authoring: a.snapshot(), library: l.view(), files: f.snapshot(),
      viewport: v.snapshot(), preferences: p.snapshot(), previewReadiness: r.readiness(),
      status: s.snapshot(), localSetup: localSetup.snapshot(),
      installDetection: installDetection.snapshot(), previewSetup: previewSetup.snapshot() }),
    subscribe(listener: () => void) {
      const unsubs = [a.subscribe(listener), l.subscribe(listener), f.subscribe(listener),
        v.subscribe(listener), p.subscribe(listener), r.subscribe(listener), s.subscribe(listener),
        ...(sources.localSetup ? [sources.localSetup.subscribe(listener)] : []),
        ...(sources.installDetection ? [sources.installDetection.subscribe(listener)] : []),
        ...(setup ? [setup.subscribe(listener)] : [])];
      return () => { for (const unsubscribe of unsubs) unsubscribe(); };
    },
  });
}
