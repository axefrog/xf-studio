import type { FacialPreviewSnapshot } from "./platform/api/facial";
import type { PartPresetList, PartPresetOutcome, PartPresetRequest, PartPresetSetList, SetExportState } from "./part-presets";
import type { AuthoringPresentation } from "./authoring-presentation";
import type { CollectionViewPort } from "./collection-application";
import { emptyPresentationStatus, type PresentationStatus } from "./presentation-status";
import { PREVIEW_SETUP_DESCRIPTORS } from "./studio-action-descriptors";
import type { Layer, Recipe, WarpField } from "./engines/layered-makeup/recipe";
import type { PreviewReadiness } from "./authoring-preview-coordinator";
import type { ReadonlyDeep } from "./read-only";
import type { StudioApplication, StudioCapability, StudioDispatchResult, StudioTarget, ViewToolEntry } from "./studio-application";
import type { ModuleService, PlannedModule, StudioModule, ViewId, ViewSummaryContribution, ViewToolFilter } from "./platform/api";
import type { EyeMakeupAction } from "./eye-makeup-model";
import type { RecipeAction } from "./engines/layered-makeup/recipe-actions";
import type { FieldLimit } from "./platform/api";
import type { StudioFileOperations } from "./studio-file-operations";
import type { UIPreferenceActions } from "./ui-preferences";
import type { ViewportAttachment } from "./viewport-attachment";
import type { LocalSetupActions } from "./local-setup-actions";
import { InstallDetectionActions } from "./install-detection-actions";
import { ModInstallActions } from "./mod-install-actions";
import { DesktopAppActions, type DesktopAppState } from "./desktop-app";
import type { PreviewSetupActions, PreviewSetupSnapshot } from "./preview-setup";
import type { ProjectLink } from "./project-links";
import { DIAGNOSTICS_DESCRIPTORS, type DiagnosticsActions, type DiagnosticsSnapshot } from "./diagnostics/actions";
import { isExpectedFailure } from "./diagnostics/model";

/**
 * "Report a problem", diagnostic mode and the references error notices carry (docs/diagnostics.md). `notice` logs a failure a
 * notice is about to show and returns its reference (null for an expected refusal, which gets none).
 */
export type DiagnosticsPort = Pick<DiagnosticsActions, "capability" | "dispatch" | "descriptors" | "notice" | "fullText"> & {
  snapshot(): ReadonlyDeep<DiagnosticsSnapshot>;
  /**
   * Whether a failure code is an ordinary refusal that explains itself (busy, nothing to undo, out of range, cancelled): a
   * presentation shows it as a notice that fades, with no reference (UI-80). The same rule `notice` applies.
   */
  expected(code: string | undefined): boolean;
};

/**
 * The host's About view (version, licences, updates), when the host has one (the desktop app): a presentation offers it in its
 * Help panel and command palette, never as a control of its own over the panels (UI-87).
 */
export type AboutPort = { capability(): { available: boolean; reason?: string }; open(): void };
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
  /** The action's capability on a concrete target (a layer, a point, a warp field): what that target's controls show. */
  contextCapability(target: StudioTarget, action: A): StudioCapability;
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
  layerSurfaceEdge: StudioApplication["layerSurfaceEdge"];
  finishCatalogue: StudioApplication["finishCatalogue"];
  glitterModelCatalogue: StudioApplication["glitterModelCatalogue"];
  mottleCatalogue: StudioApplication["mottleCatalogue"];
};
/**
 * Any other feature's facade: its live part and editor memory for the selected look, detached, and its form-control transactions (a
 * slider drag is one Undo step: `controlBegin`, then `controlEdit` per change, then `controlCommit`, or `controlCancel` on Escape).
 */
export type GenericFeatureFacade = FeatureFacade & { view(): ReadonlyDeep<{ part?: unknown; editor?: unknown }> | undefined;
  controlBegin(id: string): boolean; controlEdit(id: string, action: { kind: string }): StudioDispatchResult;
  controlCommit(id: string): void; controlCancel(id: string): void };
/**
 * The live facial preview a feature's drawer reads (facial-preview.ts), and its Try again. `installed`: the drawer is showing, so the
 * installed expressions are read (the host reads them only when asked, PREV-179).
 */
export type FacialPort = { snapshot(): FacialPreviewSnapshot | undefined; retry(): void; installed?(): void };
/** Part presets in the library (part-presets.ts): list per feature, and the `presets` family's requests. */
export type PartPresetPort = { list(feature: string): PartPresetList; sets(feature: string): PartPresetSetList; exports(): SetExportState;
  capability(request: PartPresetRequest): StudioCapability;
  execute(request: PartPresetRequest): Promise<PartPresetOutcome> };
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
    "beginGesture" | "applyGesture" | "endGesture" | "previewState" | "history" | "historyTimeline" | "consequences" | "finishCatalogue" | "layerExport" | "layerSurfaceEdge" |
    "glitterModelCatalogue" | "characterPanel" | "characterView" | "characterChoices" | "characterSwatches" | "characterSearch" | "characterPrefetch" | "characterStopPrefetch" | "characterPreviews"> & {
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
  /**
   * The view graph and the Studio modules (view-graph-design.md §3, §4): the views and what they share, the View and lighting
   * history, the registered modules, and each view's derived tools and summaries. Module visibility and the research preference
   * are the presentation's (UI preferences), passed in as `filter`; the application never reads them.
   */
  readonly views: {
    snapshot(): ReadonlyDeep<ReturnType<StudioApplication["views"]>>;
    modules(): readonly StudioModule[];
    /** Modules with an agreed design, not built yet: the Modules menu lists them as Planned. */
    plannedModules(): readonly PlannedModule[];
    tools(view: ViewId | undefined, filter: ViewToolFilter): readonly ViewToolEntry[];
    summaries(view: ViewId | undefined, filter: Pick<ViewToolFilter, "modules">): readonly ViewSummaryContribution[];
    /** Each view's derived title and its scene's subject, with the panel that shows it. */
    titles(): readonly { readonly view: ViewId; readonly panel: string; readonly title: string; readonly subject: string }[];
    /** Turn a view's tool on or off (`view.setTool` through the registry). */
    setTool(view: ViewId | undefined, tool: string, enabled: boolean): StudioDispatchResult;
    /**
     * The tools this presentation no longer offers (a hidden module's, research tools while they are hidden): their state is kept
     * and no device acts on them until they are offered again (UI-102). Tool IDs only; the application never learns why.
     */
    withdraw(tools: readonly string[]): void;
  };
  /** The registered feature modules, in catalogue order (feature-module platform §4). */
  features(): readonly FeatureInfo[];
  /** The live facial preview (the held expression on the head). */
  readonly facial: FacialPort;
  /** Part presets in the library. */
  readonly presets: PartPresetPort;
  /** One feature's facade: typed for the features in `PresentationFeatures`, undefined for an unregistered ID. */
  readonly feature: FeatureLookup;
  /**
   * A module's service (a module without a document part, view-graph-design.md §5), for that module's view: undefined for a module
   * the composition registered no service for. The module's view knows its own facade type.
   */
  module(id: string): ModuleService | undefined;
  /** Browser draft autosave and optional preview-asset diagnostics from trusted adapters. */
  readonly status: { snapshot(): ReadonlyDeep<PresentationStatus> };
  readonly localSetup: Pick<LocalSetupActions, "capability" | "dispatch"> & {
    snapshot(): ReadonlyDeep<ReturnType<LocalSetupActions["snapshot"]>>;
  };
  /**
   * "Add to my mod manager" and "Show in folder" for the latest Build (UI-82): review the host's plan, then consent to it.
   * Without a host installer every action says so.
   */
  readonly modInstall: Pick<ModInstallActions, "capability" | "dispatch" | "descriptors"> & {
    snapshot(): ReadonlyDeep<ReturnType<ModInstallActions["snapshot"]>>;
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
  /**
   * "Get the desktop app" on localhost: whether it is installed, the setup this checkout built, and opening either with the
   * person's consent. `offered()` is false in the desktop app itself, where a presentation shows nothing about it.
   */
  readonly desktopApp: Pick<DesktopAppActions, "offered" | "capability" | "dispatch" | "descriptors"> & {
    snapshot(): ReadonlyDeep<DesktopAppState>;
  };
  /** XF Studio's public pages (knowledge pages, issue tracker) for the Help view. */
  readonly links: ProjectLinkPort;
  /** The host's About view, where it has one. */
  readonly about: AboutPort;
  /** Problem reports, diagnostic mode and error references. */
  readonly diagnostics: DiagnosticsPort;
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
    modInstall: ReturnType<ModInstallActions["snapshot"]>;
    previewSetup: PreviewSetupSnapshot;
    desktopApp: DesktopAppState;
  }>;
  subscribe(listener: () => void): () => void;
};
/** A fixture port has no host preview: nothing to set up, no card. */
const NO_PREVIEW_SETUP: PreviewSetupSnapshot = Object.freeze({
  card: { open: false, title: "", body: "", progress: null, step: null, notice: null, primary: null, secondary: null, links: [], canDismiss: true, busy: false },
  consent: null, head: { phase: "unavailable", code: null, message: "", progress: null, next: null }, setupRequests: 0, showRequests: 0, autostart: true, wolvenKitStep: null,
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
  /** Optional for fixtures; without it every install action says it isn't available here. */
  modInstall?: ModInstallActions;
  /** Optional for fixtures; without it the port reports a head that needs no setup. */
  previewSetup?: PreviewSetupActions;
  /** The localhost host's desktop-app offer; without it (the desktop app, fixtures) nothing about the desktop app is offered. */
  desktopApp?: DesktopAppActions;
  /** Optional for fixtures; without it the Help view says the page can't be opened here. */
  links?: ProjectLinkPort;
  /** The host's About view; without it About is refused as not part of this host. */
  about?: () => void;
  /** Optional for fixtures; without it reporting says it isn't available here and notices carry no reference. */
  diagnostics?: DiagnosticsActions;
  /** The modules' services (`compose/module-services.ts`), already facades: the port hands each to its module's view. */
  modules?: readonly ModuleService[];
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
    layerSurfaceEdge: layerId => a.layerSurfaceEdge(layerId),
    glitterModelCatalogue: () => a.glitterModelCatalogue(),
    characterPanel: () => a.characterPanel(), characterView: () => a.characterView(),
    characterChoices: (option, want, query) => a.characterChoices(option, want, query), characterSwatches: option => a.characterSwatches(option),
    characterSearch: query => a.characterSearch(query),
    characterPrefetch: (option, positions, focus) => a.characterPrefetch(option, positions, focus), characterStopPrefetch: option => a.characterStopPrefetch(option),
    characterPreviews: (option, positions, selected, focus, spin) => a.characterPreviews(option, positions, selected, focus, spin),
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
      contextCapability: (target, action) => own(action.kind) ? a.contextCapability(target, action as never) : foreign,
      dispatch: action => own(action.kind) ? a.dispatch(action as never) : { ok: false, code: foreign.code, message: foreign.reason },
      limitsFor: (target, kind, variant) => own(kind) ? a.limitsFor(target, kind as never, variant) : {},
      choicesFor: (target, kind, field, base) => own(kind) ? a.choicesFor(target, kind as never, field, base) : [],
    };
  };
  const facades = new Map<string, FeatureFacade>(infos.map(info => {
    const base = facade(info);
    if (info.id !== "eye-makeup") return [info.id, Object.freeze({ ...base, view: () => a.featureState(info.id),
      controlBegin: (id: string) => a.featureControlBegin(info.id, id), controlEdit: (id: string, action: { kind: string }) => a.featureControlEdit(info.id, id, action),
      controlCommit: (id: string) => a.featureControlCommit(id), controlCancel: (id: string) => a.featureControlCancel(id) }) as GenericFeatureFacade];
    const eye: EyeMakeupFacade = { ...(base as FeatureFacade<EyeMakeupAction>), view: () => editor,
      controlBegin: (id, layerId) => a.controlBegin(id, layerId), controlEdit: (id, action) => a.controlEdit(id, action),
      controlCommit: id => a.controlCommit(id), controlCancel: id => a.controlCancel(id),
      layerExport: layerId => a.layerExport(layerId), layerSurfaceEdge: layerId => a.layerSurfaceEdge(layerId), finishCatalogue: () => a.finishCatalogue(),
      glitterModelCatalogue: () => a.glitterModelCatalogue(), mottleCatalogue: () => a.mottleCatalogue() };
    return [info.id, Object.freeze(eye)];
  }));
  const feature = ((id: string) => facades.get(id)) as FeatureLookup;
  const withPart = (request: PartPresetRequest): PartPresetRequest => request.kind === "partPreset.save" && !request.part
    ? { ...request, part: a.featureEnvelope(request.feature)! } : request;
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
  const views: StudioPresentationPort<Slot>["views"] = Object.freeze({
    snapshot: () => a.views(), modules: () => a.modules(), plannedModules: () => a.plannedModules(),
    tools: (view: ViewId | undefined, filter: ViewToolFilter) => a.viewTools(view, filter),
    summaries: (view: ViewId | undefined, filter: Pick<ViewToolFilter, "modules">) => a.viewSummaries(view, filter),
    titles: () => a.viewTitles(),
    setTool: (view: ViewId | undefined, tool: string, enabled: boolean) => a.dispatch({ kind: "view.setTool", ...(view === undefined ? {} : { view }), tool, enabled }),
    withdraw: (tools: readonly string[]) => a.withdrawViewTools(tools),
  });
  const localSetup: StudioPresentationPort<Slot>["localSetup"] = sources.localSetup ? {
    snapshot: () => sources.localSetup!.snapshot(), capability: action => sources.localSetup!.capability(action),
    dispatch: action => sources.localSetup!.dispatch(action),
  } : {
    snapshot: () => ({ busy: false, canPickFolder: false }), capability: () => ({ available: false, reason: "Settings aren't available here." }),
    dispatch: async () => ({ ok: false, code: "unavailable", message: "Settings aren't available here." }),
  };
  const detection = sources.installDetection ?? new InstallDetectionActions(null);
  const installDetection: StudioPresentationPort<Slot>["installDetection"] = {
    snapshot: () => detection.snapshot(), capability: action => detection.capability(action),
    dispatch: action => detection.dispatch(action), descriptors: () => detection.descriptors(),
  };
  const install = sources.modInstall ?? new ModInstallActions(null, () => []);
  const modInstall: StudioPresentationPort<Slot>["modInstall"] = {
    snapshot: () => install.snapshot(), capability: action => install.capability(action),
    dispatch: action => install.dispatch(action), descriptors: () => install.descriptors(),
  };
  const desktopSource = sources.desktopApp ?? new DesktopAppActions(null);
  const desktopApp: StudioPresentationPort<Slot>["desktopApp"] = Object.freeze({
    offered: () => desktopSource.offered(), snapshot: () => desktopSource.snapshot(), capability: (action: Parameters<DesktopAppActions["capability"]>[0]) => desktopSource.capability(action),
    dispatch: (action: Parameters<DesktopAppActions["dispatch"]>[0]) => desktopSource.dispatch(action), descriptors: () => desktopSource.descriptors() });
  const setup = sources.previewSetup;
  const previewSetup: StudioPresentationPort<Slot>["previewSetup"] = setup ? {
    snapshot: () => setup.snapshot(), capability: action => setup.capability(action),
    dispatch: action => setup.dispatch(action), descriptors: () => setup.descriptors(),
  } : {
    snapshot: () => NO_PREVIEW_SETUP, capability: () => ({ available: false, reason: "The 3D preview isn't set up here." }),
    dispatch: async () => ({ ok: false, message: "The 3D preview isn't set up here." }), descriptors: () => structuredClone(PREVIEW_SETUP_DESCRIPTORS),
  };
  const d = sources.diagnostics;
  const noReports = { available: false as const, code: "unavailable" as const, reason: "Reporting a problem isn't available here." };
  const diagnostics: DiagnosticsPort = d ? {
    snapshot: () => d.snapshot(), capability: action => d.capability(action), dispatch: action => d.dispatch(action),
    descriptors: () => d.descriptors(), notice: failure => d.notice(failure), fullText: item => d.fullText(item),
    expected: code => isExpectedFailure(code),
  } : {
    snapshot: () => ({ mode: null, report: null, opens: 0, notice: null }), capability: () => noReports,
    dispatch: async () => ({ ok: false, code: noReports.code, message: noReports.reason }), descriptors: () => structuredClone(DIAGNOSTICS_DESCRIPTORS),
    notice: () => null, fullText: async () => null, expected: code => isExpectedFailure(code),
  };
  // The view settings a problem report names: what the 3D head and the preview were doing (DIAG-17).
  d?.setViewState(() => {
    const preview = a.previewState(), head = v.snapshot().head;
    return { "3D head": head?.phase ?? "unknown", "preview quality": String(preview?.quality?.size ?? "unknown"),
      "lighting preset": preview?.preview?.lightingPreset ?? "unknown" };
  });
  const moduleServices = new Map((sources.modules ?? []).map(service => [service.module, service] as const));
  if (moduleServices.size !== (sources.modules ?? []).length) throw Error("A module's service is registered twice.");
  const openAbout = sources.about;
  const about: AboutPort = Object.freeze({
    capability: () => openAbout ? { available: true } : { available: false, reason: "About is part of the XF Studio desktop app." },
    open: () => { openAbout?.(); } });
  const linkSource = sources.links;
  const links: ProjectLinkPort = Object.freeze({ open: (link: ProjectLink) => linkSource ? linkSource.open(link)
    : Promise.resolve({ ok: false as const, message: "Web pages can't be opened from here." }) });
  return Object.freeze({ authoring: Object.freeze(authoring), library: Object.freeze(library),
    files: Object.freeze(files), viewport: Object.freeze(viewport), preferences: Object.freeze(preferences),
    previewReadiness, views, features: () => infos, feature, module: (id: string) => moduleServices.get(id), localSetup: Object.freeze(localSetup),
    facial: Object.freeze({ snapshot: () => a.facialPreview(), retry: () => a.facialRetry(), installed: () => a.facialInstalled() }),
    // A save without a part saves the feature's live part, serialized with its own codec.
    presets: Object.freeze({ list: (feature: string) => a.presetList(feature), sets: (feature: string) => a.presetSets(feature), exports: () => a.presetExports(),
      capability: (request: PartPresetRequest) => a.presetCapability(withPart(request)), execute: (request: PartPresetRequest) => a.executePreset(withPart(request)) }),
    installDetection: Object.freeze(installDetection), modInstall: Object.freeze(modInstall), previewSetup: Object.freeze(previewSetup), desktopApp,
    status: Object.freeze({ snapshot: () => s.snapshot() }), links, about, diagnostics: Object.freeze(diagnostics),
    snapshot: () => ({ authoring: a.snapshot(), library: l.view(), files: f.snapshot(),
      viewport: v.snapshot(), preferences: p.snapshot(), previewReadiness: r.readiness(),
      status: s.snapshot(), localSetup: localSetup.snapshot(),
      installDetection: installDetection.snapshot(), modInstall: modInstall.snapshot(), previewSetup: previewSetup.snapshot(),
      desktopApp: desktopApp.snapshot() }),
    subscribe(listener: () => void) {
      const unsubs = [a.subscribe(listener), l.subscribe(listener), f.subscribe(listener),
        v.subscribe(listener), p.subscribe(listener), r.subscribe(listener), s.subscribe(listener),
        ...(sources.localSetup ? [sources.localSetup.subscribe(listener)] : []),
        ...(sources.installDetection ? [sources.installDetection.subscribe(listener)] : []),
        ...(sources.modInstall ? [sources.modInstall.subscribe(listener)] : []),
        ...(sources.desktopApp ? [sources.desktopApp.subscribe(listener)] : []),
        ...(setup ? [setup.subscribe(listener)] : []), ...(d ? [d.subscribe(listener)] : []),
        ...[...moduleServices.values()].map(service => service.subscribe(listener))];
      return () => { for (const unsubscribe of unsubs) unsubscribe(); };
    },
  });
}
