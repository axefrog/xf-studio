import { liveModuleActions } from "../platform/core/module-actions";
import type { ExperimentPort } from "../platform/api/experiments";
import type { FacialPreviewSnapshot } from "../platform/api/facial";
import type { PartPresetList, PartPresetOutcome, PartPresetRequest, PartPresetSetList, SetExportState } from "../library/part-presets";
import type { AuthoringPresentation } from "./authoring/authoring-presentation";
import type { CollectionViewPort } from "../library/collection-application";
import { emptyPresentationStatus, type PresentationStatus } from "./presentation-status";
import { DOCUMENT_OUTBOX_DESCRIPTORS, PREVIEW_SETUP_DESCRIPTORS, WORKSPACE_LEASE_DESCRIPTORS } from "./studio-action-descriptors";
import type { DocumentOutbox } from "../platform/core/document-outbox";
import { leaseSnapshot, type WorkspaceLease, type WorkspaceLeaseAction, type WorkspaceLeaseSnapshot } from "./workspace/workspace-lease";
import type { Layer, Recipe, WarpField } from "../engines/layered-makeup/recipe";
import type { PreviewReadiness } from "../legacy/eye-makeup/preview/authoring-preview-coordinator";
import type { ReadonlyDeep } from "../platform/api/read-only";
import type { StudioAction, StudioApplication, StudioCapability, StudioDispatchResult, StudioTarget, ViewToolEntry } from "./studio-application";
import type { StudioBoundContext, StudioContextHit } from "./studio-context-targets";
import { nameTargets, type NamedTargets, type Unnamed } from "./action-targets";
import type { TargetResolver } from "./profiles/targets";
import type { LayoutTabsPort } from "./profiles/tab-presentation";
import type { StartersPort } from "./starters/starter-actions";
import type { EmptyChoiceRequest, EmptyChoicesPort } from "./profiles/empty-choices";
import type { FocusService } from "../platform/core/focus";
import { lookScope } from "../platform/core/history-service";
import { viewPanelId } from "../platform/api/view-graph";
import type { HistorySnapshot, HistoryState } from "../platform/api/history";
import type { ConsequenceSubject, PresentationSubject } from "./action-consequences";
import type { ModuleService, PlannedModule, StudioModule, ViewId, ViewSummaryContribution, ViewToolFilter } from "../platform/api";
import type { EyeMakeupAction } from "../legacy/eye-makeup/eye-makeup-model";
import type { RecipeAction } from "../engines/layered-makeup/recipe-actions";
import type { FieldLimit } from "../platform/api";
import type { StudioFileAction, StudioFileOperations } from "./studio-file-operations";
import type { UIPreferenceActions } from "./ui-preferences";
import type { ViewportAttachment } from "./viewport-attachment";
import type { LocalSetupActions } from "../setup/local-setup-actions";
import { InstallDetectionActions } from "../installation/install-detection-actions";
import type { FrameworkProduct } from "../installation/framework-catalogue";
import { frameworkStatusForInputs, type FrameworkStatusView } from "../installation/framework-status";
import { ModInstallActions, type ModInstallPort } from "../installation/mod-install-actions";
import { DesktopAppActions, type DesktopAppState } from "../setup/desktop-app";
import { UpdateCheckActions, type UpdateCheckState } from "../setup/update-check-actions";
import type { PreviewSetupActions, PreviewSetupSnapshot } from "../preview/preview-setup";
import type { ProjectLink } from "./project-links";
import { DIAGNOSTICS_DESCRIPTORS, type DiagnosticsActions, type DiagnosticsSnapshot } from "../diagnostics/actions";
import { isExpectedFailure } from "../diagnostics/model";

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
  capability(action: Unnamed<A>): StudioCapability;
  /** The action's capability on a concrete target (a layer, a point, a warp field): what that target's controls show. */
  contextCapability(target: StudioTarget, action: Unnamed<A>): StudioCapability;
  dispatch(action: Unnamed<A>): StudioDispatchResult;
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
  controlEdit(id: string, action: Unnamed<RecipeAction>): StudioDispatchResult;
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

/** An action as a presentation dispatches it: its named targets may be left for the port to name (profiles design §3.6). */
export type PresentationAction = Unnamed<StudioAction>;
/** A file workflow as a presentation asks for it: what a picker's file goes to may be left for the port to name. */
export type PresentationFileAction = Unnamed<StudioFileAction>;
/**
 * The application's entry points as a presentation calls them (profiles design §3.6): an action may leave its named targets out, and the
 * port, the input layer, names them before the application sees it, from what the shown tab's focused view resolves to (a menu's targets
 * are frozen when it opens). Undo and the history reads act on the editing context.
 */
type PresentationAuthoring = Pick<StudioApplication,
    "actionKinds" | "requestKinds" | "actionDescriptors" | "requestDescriptors" |
    "gestureDescriptors" | "fileKinds" | "fileDescriptors" | "registry" | "descriptorsFor" | "targetCapability" |
    "limitsFor" | "contextOptionsFor" |
    "controlBegin" | "controlCommit" | "controlCancel" |
    "requestCapability" | "execute" | "canBeginGesture" | "gestureCapability" |
    "beginGesture" | "applyGesture" | "endGesture" | "previewState" | "finishCatalogue" | "layerExport" | "layerSurfaceEdge" |
    "glitterModelCatalogue" | "characterPanel" | "characterView" | "characterChoices" | "characterSwatches" | "characterSearch" | "characterPrefetch" | "characterStopPrefetch" | "characterPreviews"> & {
  snapshot(): ReadonlyDeep<ReturnType<StudioApplication["snapshot"]>>;
  capability(action: Unnamed<StudioAction>): StudioCapability;
  dispatch(action: Unnamed<StudioAction>): StudioDispatchResult;
  contextCapability(target: StudioTarget, action: Unnamed<StudioAction>): StudioCapability;
  choicesFor(target: StudioTarget, kind: StudioAction["kind"], field: string, base?: Record<string, unknown>): ReturnType<StudioApplication["choicesFor"]>;
  actionsFor(target: StudioTarget): ReturnType<StudioApplication["actionsFor"]>;
  contextFor(hit: StudioContextHit): StudioBoundContext;
  contextQuery(hit: StudioContextHit): ReturnType<StudioApplication["contextQuery"]>;
  boundActionCapability(context: StudioBoundContext, action: Unnamed<StudioAction>): StudioCapability;
  dispatchContext(context: StudioBoundContext, action: Unnamed<StudioAction>): StudioDispatchResult;
  controlEdit(id: string, action: Unnamed<RecipeAction>): StudioDispatchResult;
  /** What an action, file workflow or request replaces, writes or discards (an action's targets named as for dispatch). */
  consequences(subject: PresentationSubject): ReturnType<StudioApplication["consequences"]>;
  /** What Undo and Redo would change next in the editing context (§3.7); nothing before anything was edited. */
  history(): HistoryState;
  /** The editing context's steps, for the History panel. */
  historyTimeline(): HistorySnapshot;
};
/** The detection service's state with what the Mod frameworks group shows of the framework check (see `StudioPresentationPort.installDetection`). */
export type InstallDetectionSnapshot = ReturnType<InstallDetectionActions["snapshot"]> & { readonly frameworkStatus: FrameworkStatusView };

/** The complete current UI entry point. Construct it only in the trusted composition root. */
export type StudioPresentationPort<Slot> = {
  /** Data/facade acquisition only. Controller composition consumes it in P3-iii. */
  readonly capture?: (signal: AbortSignal) => StudioPresentationPort<Slot>;
  readonly editing?: { acquire(instance: string, signal: AbortSignal): import("./profiles/panel-editing-contexts").PanelEditingPort<Slot> | undefined };
  readonly experiments?: ExperimentPort;
  readonly authoring: PresentationAuthoring;
  readonly library: CollectionViewPort;
  /** File workflows; one that waits for a picker may leave what its file goes to for the port to name (profiles design §3.3). */
  readonly files: Pick<StudioFileOperations, "activity" | "cancel"> & {
    capability(action: Unnamed<StudioFileAction>): ReturnType<StudioFileOperations["capability"]>;
    execute(action: Unnamed<StudioFileAction>): ReturnType<StudioFileOperations["execute"]>;
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
    /** A view's tools (absent: the view the shown tab's focus resolves to). */
    tools(view: ViewId | undefined, filter: ViewToolFilter): readonly ViewToolEntry[];
    summaries(view: ViewId | undefined, filter: Pick<ViewToolFilter, "modules">): readonly ViewSummaryContribution[];
    /** Each view's derived title and its scene's subject, with the panel that shows it. */
    titles(): readonly { readonly view: ViewId; readonly panel: string; readonly title: string; readonly subject: string }[];
    /**
     * What a view shows, as names a person reads (its V, "Valerie", and its look, "Smoky"), resolved through the view's own panel (a
     * view this page isn't drawing names its own V and look, experiment 044 U7). Absent names: it shows none, or nothing resolves it.
     */
    shows(view: ViewId): { readonly v?: string; readonly look?: string };
    /** Turn a view's tool on or off (`view.setTool` through the registry). */
    setTool(view: ViewId | undefined, tool: string, enabled: boolean): StudioDispatchResult;
    /**
     * The tools this presentation no longer offers (a hidden module's, research tools while they are hidden): their state is kept
     * and no device acts on them until they are offered again (UI-102). Tool IDs only; the application never learns why.
     */
    withdraw(tools: readonly string[]): void;
    /**
     * The view settings offered under `filter` (the Rendering options are research studies, UI-163); the presentation withdraws the
     * others with `withdraw`, and views then draw them at their defaults, keeping each stored choice for when they are offered again.
     */
    settings(filter: Pick<ViewToolFilter, "research">): readonly string[];
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
  /**
   * Read-only discovery of game installs and MO2 instances for setup suggestions, and the framework check. The snapshot adds what
   * Settings › Game › Mod frameworks and the Mod package card show of that check (`frameworkStatus`, derived here from the check, whether
   * it is running and whether a game folder is chosen), so the presentation holds none of its rules.
   */
  readonly installDetection: Pick<InstallDetectionActions, "capability" | "dispatch" | "descriptors" | "discover"> & {
    snapshot(): ReadonlyDeep<InstallDetectionSnapshot>;
    /** Retry failed product-requirement reads through the library owner (no framework detection). */
    retryRequirements(): Promise<void>;
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
  /**
   * Checking for a newer XF Studio (release-readiness-audit.md item 22): the check at start, which the host skips when Settings turns it
   * off, the person's own check, and skipping a version. A fixture port without a host refuses each one.
   */
  readonly updates: Pick<UpdateCheckActions, "capability" | "dispatch" | "descriptors"> & { snapshot(): ReadonlyDeep<UpdateCheckState> };
  /** XF Studio's public pages (knowledge pages, issue tracker) for the Help view. */
  readonly links: ProjectLinkPort;
  /** The host's About view, where it has one. */
  readonly about: AboutPort;
  /** Problem reports, diagnostic mode and error references. */
  readonly diagnostics: DiagnosticsPort;
  /**
   * Whether this page holds its workspace (profiles design §2.3), and Use it here. While another page holds it, every other
   * family's dispatch is refused with `unavailable` (reads stay available; diagnostics and this page's own view preferences too).
   */
  readonly workspace: Pick<WorkspaceLease, "capability" | "dispatch" | "descriptors"> & { snapshot(): WorkspaceLeaseSnapshot };
  /**
   * The outbox (profiles design §2.2): Try again for changes whose record on this computer couldn't be written (`status.outbox` says
   * how many). Without an outbox (fixtures, tools) there is nothing to try again.
   */
  /**
   * The panel instances of the tab shown (profiles design §1.1; phase 1, one instance of each panel): a module panel's own instance ID
   * (`<panel>--<base36>`), which names its session in its module's service.
   */
  readonly tabs?: LayoutTabsPort;
  /** The live feature's starter shapes (profiles design §6): what the Layers panel's starter menu lists. Changes go through the registered actions. */
  readonly starters?: StartersPort;
  readonly emptyChoices?: EmptyChoicesPort;
  readonly panels: {
    capture?(instance: string): () => StudioCapability;
    target?(instance: string): import("./profiles/profile-sessions").PanelTarget;
    tabTarget?(tab: string): import("./profiles/profile-sessions").PanelTabTarget;
    instance(panel: string, tab?: string): string;
    /**
     * The history scope Ctrl+Z acts on while focus is in a panel: a 3D view's is the look its scene shows (`look:<collection>/<look>`,
     * decided, §3.7); the Character panel's is its V's (`character:<id>`; undefined while it shows none); any other panel's is the editing
     * context. Header and History-panel Undo always act on the editing context.
     */
    historyScope(panel: string | undefined): string | undefined;
  };
  /**
   * Focus and the editing context (profiles design §3.3, §3.7): the presentation reports where the person is (a pointer press or keyboard
   * focus in a view, the panel holding keyboard focus); none of it is ever an Undo step. `editing` names the scope Undo acts on.
   */
  readonly focus: {
    instance(): string | undefined;
    view(view: ViewId): void;
    panel(panel: string | undefined): void;
    /**
     * The editing context Undo acts on, and its name ("Look 3", "V · ManualSave-12"; none for a scope nothing names, such as the empty
     * document while no preset is shown); null before anything was edited.
     */
    editing(): { readonly scope: string; readonly name?: string } | null;
    /** What the shown tab's most recently focused view shows (its view, scene, V and look), for a header naming its target. */
    targets(): Readonly<NamedTargets>;
  };
  readonly documents: {
    capability(action: DocumentsAction): StudioCapability;
    dispatch(action: DocumentsAction): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
    descriptors(): typeof DOCUMENT_OUTBOX_DESCRIPTORS;
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
    installDetection: InstallDetectionSnapshot;
    modInstall: ReturnType<ModInstallActions["snapshot"]>;
    previewSetup: PreviewSetupSnapshot;
    desktopApp: DesktopAppState;
    updates: UpdateCheckState;
  }>;
  subscribe(listener: () => void): () => void;
};
/** A fixture port has no host preview: nothing to set up, no card. */
const NO_PREVIEW_SETUP: PreviewSetupSnapshot = Object.freeze({
  card: { open: false, title: "", body: "", progress: null, step: null, notice: null, primary: null, secondary: null, links: [], canDismiss: true, busy: false, route: null },
  consent: null, head: { phase: "unavailable", code: null, message: "", progress: null, next: null }, setupRequests: 0, showRequests: 0, autostart: true, wolvenKitStep: null,
}) as PreviewSetupSnapshot;
export type DocumentsAction = { kind: "documents.protect" | "documents.retryRecovery" | "documents.keepRestored" | "documents.discardWaiting" };
/**
 * Try again is offered while a change's record couldn't be written; the restoring actions while changes from the last session are being
 * restored (t-recovering): Keep working only where that is safe, Discard only for changes waiting for a save that is gone.
 */
function documentsCapability(outbox: DocumentOutbox | undefined, action: DocumentsAction): StudioCapability {
  const status = outbox?.status();
  switch (action?.kind) {
    case "documents.protect":
      return status?.unprotected.length ? { available: true } : { available: false, code: "invalid_value", reason: "Every change is backed up on this computer." };
    case "documents.retryRecovery":
      return status?.recovering.length || status?.missing.length ? { available: true } : { available: false, code: "invalid_value", reason: "Nothing from your last session is waiting." };
    case "documents.keepRestored":
      return status?.recoveringSafe ? { available: true }
        : { available: false, code: "not_ready", reason: "Your restored changes may be older than what's in your library, so they can't be edited until it answers." };
    case "documents.discardWaiting":
      return status?.missing.length ? { available: true } : { available: false, code: "invalid_value", reason: "No change is waiting for a missing save." };
    default: return { available: false, code: "invalid_value", reason: "Unknown command." };
  }
}
/** Without a lease the page is the only one, and holds its workspace. */
const SOLE_WINDOW: WorkspaceLeaseSnapshot = Object.freeze(leaseSnapshot({ phase: "holder", generation: null }));
type StatusSource = { snapshot(): PresentationStatus; subscribe(listener: () => void): () => void };

/** Method wrappers prevent a presentation consumer from receiving trusted service objects. */
export function createStudioPresentation<Slot>(sources: {
  authoring: StudioApplication;
  signal?: AbortSignal;
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
  /** Requirements contributed by a feature whose library holds at least one set (queried through its owner). */
  frameworkProducts?: readonly (FrameworkProduct & { readonly feature: string })[];
  /** Optional for fixtures; without it every install action says it isn't available here. */
  modInstall?: ModInstallPort;
  /** Optional for fixtures; without it the port reports a head that needs no setup. */
  previewSetup?: PreviewSetupActions;
  /** The localhost host's desktop-app offer; without it (the desktop app, fixtures) nothing about the desktop app is offered. */
  desktopApp?: DesktopAppActions;
  /** The host's update check; without it (fixtures) checking says it isn't available here. */
  updates?: UpdateCheckActions;
  /** Optional for fixtures; without it the Help view says the page can't be opened here. */
  links?: ProjectLinkPort;
  /** The host's About view; without it About is refused as not part of this host. */
  about?: () => void;
  /** Optional for fixtures; without it reporting says it isn't available here and notices carry no reference. */
  diagnostics?: DiagnosticsActions;
  /** The modules' services (`compose/module-services.ts`), already facades: the port hands each to its module's view. */
  modules?: readonly ModuleService[];
  experiments?: ExperimentPort;
  /** The page's workspace lease; without it (fixtures, tools) this page is the only one and always holds its workspace. */
  workspace?: WorkspaceLease;
  /** The page's outbox; without it (fixtures, tools) nothing is recorded there. */
  outbox?: DocumentOutbox;
  /** A panel's instance in the tab shown (the session's); without it (fixtures, tools) each panel is one instance, `<panel>--local`. */
  panelInstance?: (panel: string, tab?: string) => string;
  capturePort?: (signal: AbortSignal) => StudioPresentationPort<Slot>;
  panelTargets?: Pick<StudioPresentationPort<Slot>["panels"], "target" | "tabTarget" | "capture">;
  tabs?: LayoutTabsPort;
  starters?: StartersPort;
  emptyChoices?: EmptyChoicesPort;
  /**
   * The input layer's target resolution (app/profiles/targets.ts) and the session's focus: what each action the presentation dispatches
   * names. Without them (tools) actions are dispatched as given, and one that leaves a target out is refused.
   */
  targets?: TargetResolver;
  /** Explicit input target for the drawn compatibility port or a bound instance; never inferred by an owner. */
  naming?: () => NamedTargets;
  lookSelection?: (ref: import("../library/collection-documents").LookRef) => StudioAction;
  editing?: StudioPresentationPort<Slot>["editing"];
  focus?: Pick<FocusService, "focusView" | "focusPanel">;
  /** A history scope's name for people ("Look 3"); without it the scope ID. */
  scopeName?: (scope: string) => string | undefined;
  /** A V's label without History's "V ·" kind prefix, for a view's metadata. */
  characterName?: (character: string) => string | undefined;
}): StudioPresentationPort<Slot> {
  const a = sources.authoring, l = sources.library, f = sources.files,
    v = sources.viewport, p = sources.preferences, r = sources.previewReadiness,
    e = sources.editor;
  const moduleActions = sources.experiments ? liveModuleActions(a.actionRegistry(), sources.experiments) : undefined;
  if (moduleActions) a.useActionRegistry(moduleActions.registry);
  const s: StatusSource = sources.status ?? { snapshot: () => emptyPresentationStatus(),
    subscribe: () => () => {} };
  // The lease's gate for the families that don't route through the application (which refuses by itself, `Services.access`).
  const lease = sources.workspace;
  const denied = () => lease?.refusal();
  const refusedAsync = async () => { const why = denied()!; return { ok: false as const, code: why.code!, message: why.reason! }; };
  /** A family's capability and dispatch behind the lease. */
  const leased = <F extends { capability(action: never): unknown; dispatch(action: never, ...rest: never[]): Promise<unknown> }>(family: F): F => ({
    ...family,
    capability: ((action: never) => denied() ?? family.capability(action)) as F["capability"],
    dispatch: ((action: never, ...rest: never[]) => denied() ? refusedAsync() : family.dispatch(action, ...rest)) as F["dispatch"],
  });
  // An experiment may explain why an action is unavailable while it is on ("Turn Hair Lab off for hair physics").
  const hint = (action: { kind: string }) => sources.experiments?.registrations().map(item => item.actionHints?.()[action.kind]).find(Boolean);
  // The input layer (profiles design §3.6): what the shown tab's focused view resolves to, and the editing context, named in each action.
  const resolver = sources.targets;
  const named = (): NamedTargets => sources.naming?.() ?? resolver?.named() ?? {};
  const name = <A extends { kind: string }>(action: A | Unnamed<A>, targets = named()): A => {
    const look = (action as { look?: import("../library/collection-documents").LookRef }).look;
    if (action.kind === "scene.setLook" && look && (action as { scene?: string }).scene === undefined && sources.lookSelection) return sources.lookSelection(look) as unknown as A;
    return nameTargets(action as A, a.descriptor(action.kind), targets);
  };
  const editingScope = () => sources.naming ? named().scope : resolver?.editing();
  // A control run (a slider drag) captures what it acts on when it begins (§3.3): its edits name that, never what focus resolves to later,
  // so a run that outlives its look is refused instead of landing on the next one.
  const runs = new Map<string, { targets: NamedTargets; app: StudioApplication }>();
  const beginRun = (id: string) => { const targets = named(); runs.set(id, { targets, app: a.captureInput() }); return targets; };
  const runApp = (id: string) => runs.get(id)?.app ?? a;
  const nameRun = <A extends { kind: string }>(id: string, action: A | Unnamed<A>): A =>
    nameTargets(action as A, a.descriptor(action.kind), runs.get(id)?.targets ?? named());
  const endRun = (id: string) => { runs.delete(id); };
  // A picker's request names what its file goes to now, when it is asked (§3.3), not when the file arrives.
  const nameFile = (action: Unnamed<StudioFileAction>): StudioFileAction => nameTargets(action, a.fileDescriptor(action.kind), named()) as StudioFileAction;
  const authoring: StudioPresentationPort<Slot>["authoring"] = {
    snapshot: () => a.snapshot(), actionKinds: () => a.actionKinds(),
    requestKinds: () => a.requestKinds(), actionDescriptors: () => a.actionDescriptors(),
    requestDescriptors: () => a.requestDescriptors(), gestureDescriptors: () => a.gestureDescriptors(),
    fileKinds: () => a.fileKinds(), fileDescriptors: () => a.fileDescriptors(), registry: () => a.registry(),
    descriptorsFor: target => a.descriptorsFor(target),
    targetCapability: target => a.targetCapability(target),
    contextCapability: (target, action) => a.contextCapability(target, name<StudioAction>(action), action as StudioAction),
    choicesFor: (target, kind, field, base) => a.choicesFor(target, kind, field, base, named()),
    limitsFor: (target, kind, variant) => a.limitsFor(target, kind, variant),
    contextFor: hit => a.contextFor(hit, named()),
    contextOptionsFor: context => a.contextOptionsFor(context, name),
    contextQuery: hit => a.contextQuery(hit, named(), name),
    boundActionCapability: (context, action) => a.boundActionCapability(context, action, name),
    dispatchContext: (context, action) => a.dispatchContext(context, action, name),
    capability: unnamed => { const action = name<StudioAction>(unnamed), result = a.capability(action), note = hint(action); return note ? { ...result, note } : result; },
    actionsFor: target => a.actionsFor(target, named(), name),
    dispatch: action => a.dispatch(name<StudioAction>(action)),
    controlBegin: (id, layerId) => a.controlBegin(id, layerId, beginRun(id).look),
    controlEdit: (id, action) => runApp(id).controlEdit(id, nameRun<RecipeAction>(id, action) as Parameters<StudioApplication["controlEdit"]>[1]),
    controlCommit: id => { runApp(id).controlCommit(id); endRun(id); }, controlCancel: id => { runApp(id).controlCancel(id); endRun(id); },
    requestCapability: request => a.requestCapability(request), execute: request => l.execute(request),
    // A gesture captures the look the shown tab's focused view shows when it begins (profiles design §3.3).
    canBeginGesture: (source, layerId) => a.canBeginGesture(source, layerId, named().look),
    gestureCapability: (source, target) => a.gestureCapability(source, target),
    beginGesture: (source, layerId) => a.beginGesture(source, layerId, named().look),
    applyGesture: (source, proposal) => a.applyGesture(source, proposal),
    endGesture: (source, cancel) => a.endGesture(source, cancel),
    previewState: () => a.previewState(), history: () => a.history(editingScope()),
    historyTimeline: () => a.historyTimeline(editingScope()),
    consequences: subject => a.consequences("action" in subject ? { ...subject, action: name<StudioAction>(subject.action) } as ConsequenceSubject : subject as ConsequenceSubject),
    finishCatalogue: () => a.finishCatalogue(),
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
    revision: () => -1, canUndo: () => a.capability(name<StudioAction>({ kind: "history.undo" })).available,
  };
  // Feature facades: each feature's own kinds only; eye makeup adds its editor view, controls and catalogues.
  const infos: readonly FeatureInfo[] = Object.freeze(a.features().map(info => Object.freeze(info)));
  const facade = (info: FeatureInfo): FeatureFacade => {
    const own = (kind: string) => a.ownerOf(kind) === info.id;
    const foreign = { available: false as const, code: "invalid_value" as const, reason: `That is not a ${info.label.toLowerCase()} command.` };
    return { ...info,
      kinds: () => a.actionKinds().filter(own),
      editable: () => a.featureEditable(info.id), locked: () => a.featureLocked(info.id),
      capability: action => own(action.kind) ? a.capability(name(action) as never) : foreign,
      contextCapability: (target, action) => own(action.kind) ? a.contextCapability(target, name(action) as never) : foreign,
      dispatch: action => own(action.kind) ? a.dispatch(name(action) as never) : { ok: false, code: foreign.code, message: foreign.reason },
      limitsFor: (target, kind, variant) => own(kind) ? a.limitsFor(target, kind as never, variant) : {},
      choicesFor: (target, kind, field, base) => own(kind) ? a.choicesFor(target, kind as never, field, base, named()) : [],
    };
  };
  const facades = new Map<string, FeatureFacade>(infos.map(info => {
    const base = facade(info);
    if (info.id !== "eye-makeup") return [info.id, Object.freeze({ ...base, view: () => a.featureState(info.id),
      controlBegin: (id: string) => a.featureControlBegin(info.id, id, beginRun(id).look),
      controlEdit: (id: string, action: { kind: string }) => runApp(id).featureControlEdit(info.id, id, nameRun(id, action)),
      controlCommit: (id: string) => { runApp(id).featureControlCommit(id); endRun(id); }, controlCancel: (id: string) => { runApp(id).featureControlCancel(id); endRun(id); } }) as GenericFeatureFacade];
    const eye: EyeMakeupFacade = { ...(base as FeatureFacade<EyeMakeupAction>), view: () => editor,
      controlBegin: (id, layerId) => a.controlBegin(id, layerId, beginRun(id).look),
      controlEdit: (id, action) => runApp(id).controlEdit(id, nameRun<RecipeAction>(id, action) as Parameters<StudioApplication["controlEdit"]>[1]),
      controlCommit: id => { runApp(id).controlCommit(id); endRun(id); }, controlCancel: id => { runApp(id).controlCancel(id); endRun(id); },
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
    capability: action => l.capability(name(action)), dispatch: action => l.dispatch(name(action)),
    fileCapability: action => l.fileCapability(action), fileExecute: action => l.fileExecute(action),
    execute: request => l.execute(request), currentLayerCount: () => l.currentLayerCount(),
  };
  const files: StudioPresentationPort<Slot>["files"] = {
    // File workflows route through the application's registry (the `files` family).
    snapshot: () => f.snapshot(), capability: action => a.fileCapability(nameFile(action)),
    execute: action => a.executeFile(nameFile(action)), activity: () => f.activity(), cancel: id => f.cancel(id),
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
  // A view the presentation leaves out is the one the shown tab's focus resolves to (the input layer's, never the application's).
  const viewOf = (view: ViewId | undefined) => view ?? named().view;
  const views: StudioPresentationPort<Slot>["views"] = Object.freeze({
    snapshot: () => a.views(), modules: () => [...a.modules(), ...(sources.experiments?.registrations().map(item => item.module) ?? [])], plannedModules: () => a.plannedModules(),
    tools: (view: ViewId | undefined, filter: ViewToolFilter) => { const id = viewOf(view); return id === undefined ? [] : a.viewTools(id, filter); },
    summaries: (view: ViewId | undefined, filter: Pick<ViewToolFilter, "modules">) => { const id = viewOf(view); return id === undefined ? [] : a.viewSummaries(id, filter); },
    titles: () => a.viewTitles(),
    shows: (view: ViewId) => {
      if (!resolver || !sources.panelInstance) return {};
      const target = resolver.named(sources.panelInstance(viewPanelId(view)));
      if (target.view !== view) return {};
      const v = target.character === undefined ? undefined : sources.characterName?.(target.character);
      const look = target.look ? sources.scopeName?.(lookScope(target.look)) : undefined;
      return { ...(v ? { v } : {}), ...(look ? { look } : {}) };
    },
    setTool: (view: ViewId | undefined, tool: string, enabled: boolean) => a.dispatch(name<StudioAction>({ kind: "view.setTool", ...(view === undefined ? {} : { view }), tool, enabled })),
    withdraw: (tools: readonly string[]) => a.withdrawViewTools(tools),
    settings: (filter: Pick<ViewToolFilter, "research">) => a.viewSettings(filter),
  });
  const localSetup: StudioPresentationPort<Slot>["localSetup"] = sources.localSetup ? {
    snapshot: () => sources.localSetup!.snapshot(), capability: action => sources.localSetup!.capability(action),
    dispatch: action => sources.localSetup!.dispatch(action),
  } : {
    snapshot: () => ({ busy: false, canPickFolder: false }), capability: () => ({ available: false, reason: "Settings aren't available here." }),
    dispatch: async () => ({ ok: false, code: "unavailable", message: "Settings aren't available here." }),
  };
  const detection = sources.installDetection ?? new InstallDetectionActions(null);
  // Framework detection only reads installed files and keeps its answer in memory; it needs no workspace lease.
  const detectionDenied = (action: Parameters<InstallDetectionActions["capability"]>[0]) =>
    action.kind === "detect.frameworkVersions" ? undefined : denied();
  const requirementLists = () => (sources.frameworkProducts ?? []).map(product => ({ product, list: a.presetSets(product.feature) }));
  const retryRequirements = async () => {
    await Promise.all(requirementLists().filter(({ list }) => list.phase === "failed")
      .map(({ product }) => a.executePreset({ kind: "partPresetSet.list", feature: product.feature })));
  };
  const installDetection: StudioPresentationPort<Slot>["installDetection"] = {
    snapshot: () => {
      const read = detection.snapshot();
      const lists = requirementLists(), failed = lists.find(({ list }) => list.phase === "failed");
      const requirements = failed ? { phase: "failed" as const, message: failed.list.reason ?? "Saved sets are unavailable right now." }
        : { phase: lists.some(({ list }) => list.phase === "loading") ? "loading" as const : "ready" as const };
      const products = lists.filter(({ list }) => list.phase === "ready" && list.items.length > 0).map(({ product }) => product);
      return { ...read, frameworkStatus: frameworkStatusForInputs(localSetup.snapshot().view?.fields, read, products, requirements) };
    }, capability: action => detectionDenied(action) ?? detection.capability(action),
    dispatch: async (action, options) => {
      if (detectionDenied(action)) return refusedAsync();
      const [outcome] = await Promise.all([detection.dispatch(action, options), action.kind === "detect.frameworkVersions" ? retryRequirements() : undefined]);
      return outcome;
    },
    retryRequirements,
    discover: options => denied() ? refusedAsync() : detection.discover(options), descriptors: () => detection.descriptors(),
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
  const updateSource = sources.updates ?? new UpdateCheckActions(null);
  const updates: StudioPresentationPort<Slot>["updates"] = Object.freeze({
    snapshot: () => updateSource.snapshot(), capability: (action: Parameters<UpdateCheckActions["capability"]>[0]) => updateSource.capability(action),
    dispatch: (action: Parameters<UpdateCheckActions["dispatch"]>[0]) => updateSource.dispatch(action), descriptors: () => updateSource.descriptors() });
  const setup = sources.previewSetup;
  const previewSetup: StudioPresentationPort<Slot>["previewSetup"] = setup ? {
    snapshot: () => setup.snapshot(), capability: action => setup.capability(action),
    dispatch: action => setup.dispatch(action), descriptors: () => setup.descriptors(),
  } : {
    snapshot: () => NO_PREVIEW_SETUP, capability: () => ({ available: false, reason: "The 3D view isn't set up here." }),
    dispatch: async () => ({ ok: false, message: "The 3D view isn't set up here." }), descriptors: () => structuredClone(PREVIEW_SETUP_DESCRIPTORS),
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
  const releaseViewState = d?.setViewState(() => {
    const preview = a.previewState(), head = v.snapshot().head;
    return { "3D head": head?.phase ?? "unknown", "preview quality": String(preview?.quality?.size ?? "unknown"),
      "lighting preset": preview?.preview?.lightingPreset ?? "unknown" };
  });
  if (sources.signal?.aborted) releaseViewState?.();
  else if (releaseViewState) sources.signal?.addEventListener("abort", releaseViewState, { once: true });
  const moduleServices = new Map((sources.modules ?? []).map(service => [service.module, service] as const));
  if (moduleServices.size !== (sources.modules ?? []).length) throw Error("A module's service is registered twice.");
  const openAbout = sources.about;
  const about: AboutPort = Object.freeze({
    capability: () => openAbout ? { available: true } : { available: false, reason: "About is part of the XF Studio desktop app." },
    open: () => { openAbout?.(); } });
  const linkSource = sources.links;
  const links: ProjectLinkPort = Object.freeze({ open: (link: ProjectLink) => linkSource ? linkSource.open(link)
    : Promise.resolve({ ok: false as const, message: "Web pages can't be opened from here." }) });
  return Object.freeze({ ...(sources.editing ? { editing: sources.editing } : {}), authoring: Object.freeze(authoring), library: Object.freeze(library),
    files: Object.freeze(files), viewport: Object.freeze(viewport), preferences: Object.freeze(preferences),
    previewReadiness, views, features: () => infos, feature, module: (id: string) => {
      const service = moduleServices.get(id) ?? sources.experiments?.registrations().find(item => item.module.id === id)?.service;
      const routed = service && sources.experiments?.registrations().some(item => item.service === service && item.module?.actions) ? moduleActions!.bind(service) : service;
      return routed && lease ? leased(routed) : routed;
    },
    experiments: sources.experiments && lease ? { ...sources.experiments, subscribe: sources.experiments.subscribe.bind(sources.experiments),
      snapshot: () => sources.experiments!.snapshot(), registrations: () => sources.experiments!.registrations(),
      set: (id: string, enabled: boolean) => denied() ? refusedAsync() : sources.experiments!.set(id, enabled) } : sources.experiments,
    localSetup: Object.freeze(leased(localSetup)),
    facial: Object.freeze({ snapshot: () => a.facialPreview(), retry: () => a.facialRetry(), installed: () => a.facialInstalled() }),
    // A save without a part saves the feature's live part, serialized with its own codec.
    presets: Object.freeze({ list: (feature: string) => a.presetList(feature), sets: (feature: string) => a.presetSets(feature), exports: () => a.presetExports(),
      capability: (request: PartPresetRequest) => a.presetCapability(withPart(request)), execute: (request: PartPresetRequest) => a.executePreset(withPart(request)) }),
    installDetection: Object.freeze(installDetection), modInstall: Object.freeze(leased(modInstall)), previewSetup: Object.freeze(leased(previewSetup)),
    desktopApp: Object.freeze(leased(desktopApp)), updates: Object.freeze(leased(updates)),
    status: Object.freeze({ snapshot: () => s.snapshot() }), links, about, diagnostics: Object.freeze(diagnostics),
    ...(sources.tabs ? { tabs: sources.tabs } : {}), ...(sources.starters ? { starters: sources.starters } : {}),
    ...(sources.emptyChoices ? { emptyChoices: Object.freeze({ ...sources.emptyChoices,
      capability: (request: EmptyChoiceRequest) => a.emptyChoiceCapability(request), execute: (request: EmptyChoiceRequest) => a.executeEmptyChoice(request) }) } : {}),
    capture: sources.capturePort,
    panels: Object.freeze({ ...sources.panelTargets, instance: (panel: string, tab?: string) => sources.panelInstance?.(panel, tab) ?? `${panel}--local`,
      historyScope: (panel: string | undefined) => resolver?.undoScope(panel === undefined ? undefined : sources.panelInstance?.(panel)) }),
    focus: Object.freeze({
      instance: () => resolver?.focusedInstance(),
      view: (view: ViewId) => sources.focus?.focusView(view),
      panel: (panel: string | undefined) => sources.focus?.focusPanel(panel === undefined ? undefined : sources.panelInstance?.(panel) ?? panel),
      editing: () => { const scope = editingScope(), name = scope && sources.scopeName?.(scope); return scope ? { scope, ...(name ? { name } : {}) } : null; },
      targets: () => named(),
    }),
    documents: Object.freeze({
      capability: (action: DocumentsAction) => documentsCapability(sources.outbox, action),
      async dispatch(action: DocumentsAction) {
        const allowed = documentsCapability(sources.outbox, action);
        if (!allowed.available) return { ok: false as const, code: allowed.code ?? "unavailable", message: allowed.reason ?? "Not available right now." };
        const outbox = sources.outbox!;
        try {
          switch (action.kind) {
            case "documents.retryRecovery": outbox.retry(); return { ok: true as const };
            case "documents.keepRestored": return outbox.keepRestored().length ? { ok: false as const, code: "not_ready",
              message: "Some restored changes still need the library's answer before they can be edited." } : { ok: true as const };
            case "documents.discardWaiting": outbox.discardWaiting(); return { ok: true as const };
            default: break;
          }
        } catch (error) { return { ok: false as const, code: "unavailable", message: (error as Error).message }; }
        return outbox.protect() ? { ok: true as const }
          : { ok: false as const, code: "unavailable", message: "Your changes still couldn't be recorded on this computer. Export your collection to keep a copy." };
      },
      descriptors: () => structuredClone(DOCUMENT_OUTBOX_DESCRIPTORS) }),
    workspace: Object.freeze({ snapshot: () => lease?.snapshot() ?? SOLE_WINDOW,
      capability: (action: WorkspaceLeaseAction) => lease ? lease.capability(action) : { available: false, code: "unavailable" as const, reason: "This workspace is already editable here." },
      dispatch: (action: WorkspaceLeaseAction) => lease ? lease.dispatch(action) : Promise.resolve({ ok: false as const, code: "unavailable", message: "This workspace is already editable here." }),
      descriptors: () => structuredClone(WORKSPACE_LEASE_DESCRIPTORS) }),
    snapshot: () => ({ authoring: a.snapshot(), library: l.view(), files: f.snapshot(),
      viewport: v.snapshot(), preferences: p.snapshot(), previewReadiness: r.readiness(),
      status: s.snapshot(), localSetup: localSetup.snapshot(),
      installDetection: installDetection.snapshot(), modInstall: modInstall.snapshot(), previewSetup: previewSetup.snapshot(),
      desktopApp: desktopApp.snapshot(), updates: updates.snapshot() }),
    subscribe(listener: () => void) {
      const unsubs = [a.subscribe(listener), l.subscribe(listener), f.subscribe(listener),
        v.subscribe(listener), p.subscribe(listener), r.subscribe(listener), s.subscribe(listener),
        ...(sources.localSetup ? [sources.localSetup.subscribe(listener)] : []),
        ...(sources.installDetection ? [sources.installDetection.subscribe(listener)] : []),
        ...(sources.modInstall ? [sources.modInstall.subscribe(listener)] : []),
        ...(sources.desktopApp ? [sources.desktopApp.subscribe(listener)] : []),
        ...(sources.updates ? [sources.updates.subscribe(listener)] : []),
        ...(sources.experiments ? [sources.experiments.subscribe(listener)] : []),
        ...(setup ? [setup.subscribe(listener)] : []), ...(d ? [d.subscribe(listener)] : []), ...(lease ? [lease.subscribe(listener)] : []),
        ...[...moduleServices.values()].map(service => service.subscribe(listener))];
      return () => { for (const unsubscribe of unsubs) unsubscribe(); };
    },
  });
}
