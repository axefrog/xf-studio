import type { StudioAction } from "../app/studio-application";
import { browserReferenceTextures } from "../character/browser/browser-reference-textures-device";
import { OFF_EXPERIMENTS } from "../platform/core/experiments";
import { createHistoryService, type HistoryService } from "../platform/core/history-service";
import type { ExperimentPort } from "../platform/api/experiments";
import type { ExperimentRegistration } from "../platform/api/experiments";
import type { ViewContribution } from "../studio-ui/views/contribution";
import type { ModuleViewBinding } from "../studio-ui/views/feature-view";
/**
 * The one trusted composition root for the XF Studio page, shared by localhost (`studio-main.ts`)
 * and the desktop bootstrap. It builds the core, browser devices and bootstrap, then mounts
 * `studio-ui` with ONLY the public `StudioPresentationPort`. Host differences (workspace
 * storage, the preparation endpoint, the setup form) arrive as a typed `StudioHost`, never as
 * page globals or data attributes. Nothing in `studio-ui/` imports this module.
 */
import { createBrowserFileDevice } from "../app/browser/browser-file-device";
import { NO_3D_PREVIEW_IN_ALPHA } from "../app/alpha-availability";
import type { PreviewPreparationActions } from "../preview/preview-preparation";
import { PreviewSetupActions } from "../preview/preview-setup";
import { wolvenKitLinkUrl, type WolvenKitLink, type WolvenKitSetupActions } from "../setup/wolvenkit-setup";
import { LOCAL_PROJECT_PAGES, PROJECT_LINKS, type ProjectLink } from "../app/project-links";
import { createBrowserLocalSetup } from "../setup/browser/browser-local-setup-device";
import { createBrowserInstallDetection } from "../installation/browser/browser-install-detection-device";
import { createBrowserSaveExplorerDevice, savesLocationSignal } from "../saves/browser/browser-save-explorer-device";
import { createModuleServices } from "./module-services";
import { createBrowserPoseLibraryDevice } from "../animation/browser/browser-pose-device";
import { PoseStageHub } from "../animation/pose-stage";
import { createBrowserModInstall } from "../installation/browser/browser-mod-install-device";
import { builtModsOf, type BuiltMod } from "../installation/mod-install-actions";
import { createBrowserPreviewDevice } from "../legacy/eye-makeup/browser/browser-preview-device";
import { createBrowserSceneHeads } from "../preview/browser/browser-scene-heads";
import type { AttachedHead } from "../preview/browser/browser-head-attachment";
import { createSceneEditors } from "../preview/browser/scene-editors";
import { CharacterWarmStart } from "../character/browser/character-warm-start";
import { CreatorCatalogue } from "../character/creator-catalogue";
import { createBrowserCreatorDevice } from "../character/browser/browser-cc-catalogue-device";
import { readSavedV } from "../saves/save-reader";
import { rasterRegion } from "../engines/layered-makeup/region";
import { createBrowserViewportDevice } from "../preview/browser/browser-viewport-device";
import { createBrowserWorkspaceSession, loadBrowserWorkspace } from "../app/browser/browser-workspace-device";
import { collectionTransport, collectionVersions } from "../library/browser/collection-transport";
import { GlitterMeasurements } from "../legacy/eye-makeup/glitter-measurements";
import type { LocalSetupActions } from "../setup/local-setup-actions";
import type { DesktopAppActions } from "../setup/desktop-app";
import { emptyPresentationStatus, PresentationStatusSource, type AdapterMessage } from "../app/presentation-status";
import type { Layer } from "../engines/layered-makeup/recipe";
import type { StudioPresentationPort } from "../app/studio-presentation";
import { mountStudio } from "../studio-ui/app";
import { createTrustedAuthoringCore } from "../app/trusted-authoring-core";
import { createTrustedStudioBootstrap } from "../app/trusted-studio-bootstrap";
// The composition root: the one browser module that imports the composition list (CORE-29).
import { STUDIO_COMPOSITION } from "./studio-registry";
import { STUDIO_VIEW_COMPOSITION } from "./view-panels";
import { STUDIO_CATALOGUE } from "./views";
import { STUDIO_FACE_POSES, STUDIO_LAYERED_SURFACES, STUDIO_RENDERERS } from "./renderers";
import { combineFacePoses, FacialPreview } from "../animation/facial-preview";
import { headQuiet, prefetchWhenQuiet } from "../animation/facial-prefetch";
import { TransitionSettings } from "../platform/core/transition-settings";
import { createBrowserFacialDevice } from "../animation/browser/browser-facial-device";
import { PartPresetService, partPresetTransport, setExportTransport } from "../library/part-presets";
import { UIPreferenceActions } from "../app/ui-preferences";
import { sessionViewGraph } from "../preview/preview-view-graph";
import { DiagnosticsActions } from "../diagnostics/actions";
import { createBrowserDiagnostics } from "../diagnostics/browser/browser-device";
import { createBrowserUpdateCheck } from "../setup/browser/browser-update-check-device";
import { pageFailure, setPageDiagnostics } from "../diagnostics/page-sink";
import type { WorkspaceLease } from "../app/workspace/workspace-lease";
import type { StartedOutbox } from "../app/browser/document-outbox-device";
import { PROFILES_MIGRATION_ENABLED, startProfilesMigration } from "../app/browser/profiles-migration-device";
import { workspaceKeys, type WorkspaceState } from "../app/workspace/workspace-state";
import { WorkspacePersistence } from "../app/workspace/workspace-persistence";
import { outboxView } from "../app/presentation-status";
import type { TargetResolver } from "../app/profiles/targets";
import { createProfileServices, createTargetResolver, drawnScene, historyScopeName, openProfileSession, sceneCharacter, sceneCommands } from "../app/profiles/profile-window";
import { viewPanel } from "../app/profiles/profile-session-state";
import { createStudioSubjects } from "./subjects";
import { LookEditor, lookContent } from "../library/look-editor";
import { lookRef, type LookRef } from "../library/collection-documents";
import { lookScope, viewScope } from "../platform/core/history-service";
import { MAIN_VIEW } from "../platform/api/view-graph";
import { emptyLookHistory } from "../platform/core/look-history";
import { emptyRecipe } from "../engines/layered-makeup/recipe";

export type StudioHost = {
  /** Optional host capability; the desktop omits experimental modules until their assets are supported. */
  experiments?: (verification: boolean, signal: AbortSignal) => Omit<ExperimentPort, "registrations"> & {
    registrations(): readonly (ExperimentRegistration & { contribution: ViewContribution; binding: ModuleViewBinding })[];
    /** The history service the experiments' documents live in, shared with the look's history. */
    readonly historyService?: HistoryService;
  };
  /** Where the workspace draft is stored: browser storage, or the desktop's host-owned file. */
  storage: Pick<Storage, "getItem" | "setItem">;
  /** Serialized workspace budget; the desktop host file allows more than browser storage. */
  storageBudget?: number;
  /** The host's 3D preview preparation service. */
  previewPreparation: PreviewPreparationActions;
  /** The host's WolvenKit setup service (download with consent, .NET check). */
  wolvenKitSetup: WolvenKitSetupActions;
  /** The host's settings service; the desktop shares its Build setup dialog's instance (the verification copy under `?verify`). */
  localSetup?: LocalSetupActions;
  /** Opens a named official page (WolvenKit's, or XF Studio's own); without it the page opens in a new browser tab. */
  openLink?: (link: WolvenKitLink | ProjectLink) => Promise<void>;
  /** Where the game folder and WolvenKit CLI are set, in the host's own words ("Build setup", "Settings"). */
  setupPlace: string;
  /** Opens the host's own setup form, when it has one outside the Studio panels; otherwise Settings › Game is shown. */
  openSetup?: () => void;
  /** The host's About view (version, licences, updates); the Studio offers it in Help and the command palette (UI-87). */
  about?: () => void;
  /** "Get the desktop app": localhost only; the desktop app leaves it out, so it offers nothing about itself. */
  desktopApp?: DesktopAppActions;
  /** Called once the Studio is mounted, with what the host may ask of it (the desktop's welcome and About open Settings › Game). */
  onMounted?: (studio: { openGameSetup(): void }) => void;
  /** Lets the host ask for an immediate workspace save (the desktop does before closing). */
  onFlushRequest?: (flush: () => void) => void;
  /** Called once the 3D head is interactive. */
  onPreviewReady?: () => void;
  /**
   * The window's workspace lease, already started (profiles design §2.3): while another window holds the workspace this one is
   * read-only, and it restarts once Use it here has taken the workspace over. Without one (tools) this window is the only one.
   */
  lease?: WorkspaceLease;
  /**
   * The page's outbox, started (`app/browser/document-outbox-device.ts`, profiles design §2.2): the one way documents reach the library.
   * Its status is shown (the unprotected-changes warning), and it counts against the workspace's storage budget.
   */
  documents: StartedOutbox;
};

const byId = <T extends HTMLElement>(id: string) => {
  const found = document.getElementById(id);
  if (!found) throw Error(`Missing device host ${id}`);
  return found as T;
};

export function startStudio(host: StudioHost): Promise<void> {
  const root = byId("studio");
  return start(host, root).catch(error => {
    root.removeAttribute("aria-busy");
    const ref = pageFailure("startup", "start_failed", "XF Studio couldn't start.", error);
    root.replaceChildren(Object.assign(document.createElement("p"), { className: "boot-error",
      textContent: `XF Studio couldn't start. Reload the page, or restart XF Studio if this keeps happening.${ref ? ` If you report it, mention ${ref}.` : ""}` }));
  });
}

async function start(host: StudioHost, root: HTMLElement) {
  const verification = new URLSearchParams(location.search).has("verify");
  // Diagnostics first, so everything after is trapped (docs/diagnostics.md): page failures reach the host log, notices carry a
  // reference, and "Report a problem" prepares a report for review. Nothing is sent anywhere by itself.
  const fileDevice = createBrowserFileDevice({ document, pickers: {
    recipe: byId<HTMLInputElement>("device-recipe-picker"),
    collection: byId<HTMLInputElement>("device-collection-picker"),
    savedV: byId<HTMLInputElement>("device-save-picker"),
    characterPreset: byId<HTMLInputElement>("device-character-picker"),
  } });
  let port: StudioPresentationPort<HTMLElement> | undefined;
  const diagnosticsDevice = createBrowserDiagnostics({ window, download: (blob, name) => fileDevice.download(blob, name) });
  // The presentation names the view settings a report carries; the root adds only which workspace this is.
  const diagnostics = new DiagnosticsActions(diagnosticsDevice.device, Date.now, { "verification workspace": verification ? "yes" : "no" });
  diagnosticsDevice.install(diagnostics);
  setPageDiagnostics((area, code, message, error, options) => diagnostics.failure(area, code, message, error, options));
  void diagnostics.refresh();
  const experimentLife = new AbortController();
  window.addEventListener("pagehide", () => experimentLife.abort(), { once: true });
  const experiments = host.experiments?.(verification, experimentLife.signal) ?? OFF_EXPERIMENTS;
  const storage = host.storage;
  const restored = loadBrowserWorkspace(storage, verification, STUDIO_COMPOSITION.documents), workspace = restored.state;
  // The V's details the page asked for last are read while everything else starts (research/backlog/performance.md, warm restart).
  // `?warm=off` leaves it out (a developer's A/B measurement, tools/measure-warm-restart.ts).
  const warmStart = new CharacterWarmStart({ storage, verification });
  if (new URLSearchParams(location.search).get("warm") !== "off") void warmStart.start();
  const documents = host.documents, lease = host.lease, base = verification ? "/api/verification" : "/api";
  // One history service for the session: every look's history (`look:<collection>/<look>`), every V's (`character:<id>`) and the View and
  // lighting history, beside the experiments' documents (profiles design §3.7).
  const historyService = ("historyService" in experiments && experiments.historyService) || createHistoryService();
  // One creator catalogue for the page (creator-catalogue.ts): every character, and every head made again for another body, shares it.
  const creatorCatalogue = new CreatorCatalogue(createBrowserCreatorDevice());
  // The library's owners (profiles design §7): profiles, Vs, collections and looks, each changed only through its commands (the outbox).
  const services = createProfileServices({ documents: documents.documents, outbox: documents.outbox, subjects: createStudioSubjects(),
    catalogue: creatorCatalogue, history: historyService, versions: collectionVersions(`${base}/collection-versions`, fetch, documents.fence),
    report: error => diagnostics.failure("library", "library_owner_failed", "Part of your library couldn't be read.", error, { level: "warn" }) });
  // The profiles migration (profiles design §8) runs before anything is built, in the window holding the workspace: the Studio opens on the
  // session it makes, and the workspace's own fields stay as they were (migration input only). A migrated workspace costs nothing.
  if (PROFILES_MIGRATION_ENABLED && restored.writable && (!lease || lease.writable())) {
    const life = new AbortController();
    window.addEventListener("pagehide", () => life.abort(), { once: true });
    const early = new WorkspacePersistence({ storage, key: workspaceKeys(verification).workspace, writable: true, capture: () => workspace,
      budget: host.storageBudget, reserved: () => documents.outbox.storedSize(), model: STUDIO_COMPOSITION.documents,
      ...(lease ? { canWrite: () => lease.draining() } : {}) });
    early.activate();
    await startProfilesMigration({ endpoint: `${base}/profiles/migrate`, send: fetch, workspace: documents.workspace, fence: documents.fence,
      model: STUDIO_COMPOSITION.documents, state: () => workspace, marks: workspace, flush: () => early.flush(), signal: life.signal,
      report: error => diagnostics.failure("library", "profiles_migration_failed", "Your work couldn't be moved into your profile yet; it will try again.", error, { level: "warn" }) });
  }
  await services.load();
  // The session this window opens on (tab 1, the views and scenes, and what each scene shows), with the window's focus: the history
  // service records the editing context into it (profiles design §3.3, §3.7).
  const { state: sessionState, stored: sessionStored } = openProfileSession(workspace, services, historyService.focus);
  // Tab 1's arrangement is the dock's; the workspace's own arrangement stays as it was (migration input only).
  const legacyLayout = workspace.uiPreferences.layout, tabDock = sessionState.dock();
  const { layout: _legacy, ...uiPreferences } = workspace.uiPreferences;
  const preferences = new UIPreferenceActions({ ...uiPreferences, ...(tabDock ? { layout: tabDock } : {}) });
  // How a held expression's changes animate (design §5.5): the workspace's setting, available before the head loads.
  const transitions = new TransitionSettings(workspace.preview.transitions);
  // A verification workspace has its own settings and never adds a mod (INSTALL-01, UI-98).
  const localSetup = host.localSetup ?? createBrowserLocalSetup({ verification });
  const installDetection = createBrowserInstallDetection();
  // Part-less modules' services (the Save Explorer, Poses), over their browser devices. The saves device reads the workspace's own saves
  // folder and follows Settings › Saves (UI-109). Poses reach the shown V through the stage, which the head fills in once it is attached;
  // the whole-body view goes through the application like the toolbar's.
  const poseStage = new PoseStageHub({
    capability: view => core.app.capability({ kind: "camera.body", view }),
    frame: view => { const done = core.app.dispatch({ kind: "camera.body", view }); return done.ok ? { available: true } : { available: false, reason: done.message }; },
  });
  const moduleServices = createModuleServices({ saves: createBrowserSaveExplorerDevice(document,
    { verification, locationChanged: savesLocationSignal(localSetup) }),
    poses: { device: createBrowserPoseLibraryDevice({ verification }), stage: poseStage } });
  // "Add to my mod manager" installs the mods of the latest Build (read from the files service once it exists) and of each expression
  // set's latest Build (the part preset service, made below).
  let setBuilds: () => readonly BuiltMod[] = () => [];
  const modInstall = createBrowserModInstall(() => [...builtModsOf(bootstrap?.files.snapshot().package as Parameters<typeof builtModsOf>[0]), ...setBuilds()],
    verification ? "/api/verification/mod-install" : "/api/mod-install");
  // Whether the 3D preview may start preparing by itself; a workspace preference (per verification scope).
  let autostart = workspace.previewSetup?.autostart ?? legacyAutostart(storage, verification);
  // Whether the person chose Not now on the 3D preview card; a workspace preference too, so it stays declined.
  let declined = workspace.previewSetup?.declined === true;
  let previewDevice: ReturnType<typeof createBrowserPreviewDevice>;
  /** Stops waiting for the page to be quiet before the installed expressions are read ahead (facial-prefetch.ts). */
  let stopPrefetch: (() => void) | undefined;
  let bootstrap: ReturnType<typeof createTrustedStudioBootstrap<HTMLElement>>;
  let uvEditor: ReturnType<ReturnType<typeof createBrowserViewportDevice>["mountUV"]> | undefined;

  /**
   * The head shown now: the scene runtime owner's (`heads`, made below), read by what is wired before it. Several of those read it at once
   * when they are made (the live face starts following, the UV editor draws its first frame), before the owner exists: none is shown then.
   */
  let shownHead: () => AttachedHead | undefined = () => undefined;
  /** The view drawn now: the scene runtime owner's once it exists; the window draws the main view first (phase 2's tabs choose others). */
  let drawnView: () => string = () => MAIN_VIEW;
  // Device facts published read-only to the view.
  let status = emptyPresentationStatus(verification);
  const region = STUDIO_COMPOSITION.region;
  const measurements = new GlitterMeasurements({
    layers: () => core.document.recipe.layers, size: () => previewDevice.coordinator.size, fineGlitter: region.fineGlitter });
  const statusSource = new PresentationStatusSource(() => {
    const head = shownHead(), eye = head?.scene.eyeAppearance().optics;
    return { ...status, ...(lease ? { lease: lease.snapshot() } : {}), outbox: outboxView(documents.outbox.status()),
      glitter: measurements.snapshot(), assets: { ...status.assets,
      characterDetails: head?.characterDetails.snapshot(),
      eyeOptics: eye ? { requested: eye.requested, active: eye.active, reason: eye.reason, error: eye.error } : undefined } };
  });
  // The outbox's warning follows its status (a failed outbox write, a send that failed, a conflict).
  documents.outbox.subscribe(event => { if (event.kind !== "acknowledged") statusSource.changed(); });

  let messageId = 0;
  const adapterMessage = (source: AdapterMessage["source"], text: string) => {
    status = { ...status, message: { id: ++messageId, source, text } }; statusSource.changed();
  };
  // The look the drawn view's scene shows, read from its working copy: what the editor document starts with (the look editor keeps it).
  const firstLook = sessionState.scene(drawnScene(sessionState)).look, firstView = firstLook ? services.collections.look(firstLook) : null;
  let first: ReturnType<typeof lookContent> | null = null;
  if (firstView?.state === "live") {
    try { first = lookContent(firstView, STUDIO_COMPOSITION.documents); }
    catch (error) { pageFailure("library", "look_unreadable", "A look couldn't be read.", error); }
  }
  const shownState = first?.state ?? { recipe: emptyRecipe(), active: 0, selected: 0, fieldSelection: {}, history: emptyLookHistory() };
  const core = createTrustedAuthoringCore({ ...workspace, views: sessionState.graph(), recipe: shownState.recipe, active: shownState.active,
    selected: shownState.selected, fieldSelection: shownState.fieldSelection, history: shownState.history, historyTrimmed: shownState.historyTrimmed,
    liveFeatures: shownState.liveFeatures, liveLocked: shownState.liveLocked }, {
    history: historyService, ...(first && firstLook ? { scope: lookScope(firstLook) } : {}), viewScope: viewScope(sessionState.profile),
    resetStack: previous => previewDevice?.coordinator.syncStack(previous),
    // A cheap read: Glitter-model and finish changes ask for it, and a snapshot would stash and copy the whole draft (CORE-05).
    selectedCollection: () => bootstrap?.collection.selectedPresetId() ?? "draft",
  }, STUDIO_COMPOSITION);
  // One writer per workspace: while another window holds it, every action, request, control and gesture is refused here.
  if (lease) core.app.attach({ access: lease });
  // The view graph the core owns (view-graph-design.md §3.3): the head restores and follows its main view.
  const views = core.views;
  // The scene the drawn view shows and the look it shows, which the collection service changes.
  const drawn = () => views.node(drawnView(), "scene").id;
  const shownScene = { look: () => sessionState.scene(drawn()).look, setLook: (ref: LookRef | undefined) => sessionState.setLook(drawn(), ref),
    subscribe: (listener: () => void) => sessionState.subscribe(listener) };
  // The scenes' `gen` (what a view action that edits a scene names) and the input layer's resolution over the session.
  core.app.attach({ scenes: sceneCommands(sessionState, services) });
  const targets: TargetResolver = createTargetResolver({ state: sessionState, graph: views, history: historyService, services, contexts: type => STUDIO_CATALOGUE.context(type),
    collection: () => bootstrap?.collection.service.draftIdentity()?.collectionId });
  // Dispatch checks what an action names by the resolver's rule (the one its captures follow).
  core.app.attach({ targetCheck: targets });
  const headHost = byId("device-head"), uvHost = byId("device-uv");
  const viewportDevice = createBrowserViewportDevice({ region, headHost, uvHost, queryContext: hit => core.app.contextQuery(hit, targets.named()), renderers: STUDIO_RENDERERS, optionalRenderers: experiments, referenceTextures: browserReferenceTextures(verification),
    onContext: event => event === "lost" ? diagnostics.contextLost("3D view") : diagnostics.contextRestored("3D view") });
  // The workspace's own editor fields, V and arrangement as the migration found them: stored back unchanged (an older build opens them).
  const frozenEditor = { recipe: workspace.recipe, active: workspace.active, selected: workspace.selected, fieldSelection: workspace.fieldSelection,
    history: workspace.history, ...(workspace.historyTrimmed ? { historyTrimmed: true } : {}), ...(workspace.liveFeatures ? { liveFeatures: workspace.liveFeatures } : {}) };
  // The session as it is now, stored with the migration's mark (a session made for this window from the library is stored nowhere).
  const profileMarks = (): Pick<WorkspaceState, "migration" | "profiles"> => ({ migration: workspace.migration,
    profiles: sessionStored ? sessionState.stored({ graph: sessionViewGraph(views), dock: preferences.snapshot().layout ?? null },
      workspace.profiles) : workspace.profiles });
  const session = createBrowserWorkspaceSession({
    workspace, restored, verification, storage, budget: host.storageBudget, model: STUDIO_COMPOSITION.documents,
    // The outbox's keys share the workspace's storage, so they count against its budget (profiles design §2.2).
    reserved: () => documents.outbox.storedSize(),
    capture: {
      editor: () => frozenEditor,
      uvView: () => uvEditor?.snapshot() ?? workspace.uvView,
      savedV: () => workspace.savedV,
      collections: () => workspace.collections,
      quality: () => previewDevice?.coordinator.quality.snapshot().size ?? workspace.preview.textureSize,
      preview: () => shownHead()?.preview.snapshot(), sample: () => shownHead()?.motion.sample(), views: () => workspace.views,
      uiPreferences: () => { const { layout: _live, ...rest } = preferences.snapshot(); return { ...rest, ...(legacyLayout ? { layout: legacyLayout } : {}) }; },
      previewSetup: () => ({ autostart, ...(declined ? { declined: true as const } : {}) }),
      transitions: () => transitions.stored(),
      profiles: profileMarks,
    },
    sources: [preferences, sessionState, views], window, document,
    onStatus: save => { status = { ...status, workspace: save }; statusSource.changed(); },
    canWrite: lease ? () => lease.draining() : undefined,
  });
  // The shown look's edits are written through its session (the outbox); anything that needs them now writes them first.
  let lookShown: (() => void) | undefined;
  const lookEditor = new LookEditor({ model: STUDIO_COMPOSITION.documents, sessions: services.looks, document: core.document,
    store: () => documents.outbox.store(),
    restoring: ref => documents.outbox.recovering(lookRef(ref)), shown: () => lookShown?.(), note: text => adapterMessage("preview", text),
    report: error => diagnostics.failure("library", "look_write_failed", "Your latest look change couldn't be recorded yet; it will be tried again.", error, { level: "warn" }) });
  host.onFlushRequest?.(() => { lookEditor.commit(); session.flush(); });
  window.addEventListener("pagehide", () => lookEditor.commit());
  document.addEventListener("visibilitychange", () => { if (document.hidden) lookEditor.commit(); });
  if (lease) {
    // Releasing to another window: after the pending document saves drain (a step the host registered first), the workspace is
    // written a last time and its timers stop (§2.3 release steps 3 to 5).
    lease.onReleaseStart(() => { core.app.settleEdits(); lookEditor.commit(); });
    // Every experiment document stored (an unsaved one written again), then the last workspace write: both must succeed, and
    // autosave retires only once the lease is released and confirmed.
    lease.onRelease(async () => await (experiments as ExperimentPort).settle?.() ?? true);
    lease.onRelease(() => session.flush());
    lease.onReleased(() => session.retire());
    lease.subscribe(() => {
      statusSource.changed();
      // Taken over: this page was built from the workspace as it was when it opened, so it restarts from the one just released.
      if (lease.snapshot().phase === "taken-over") location.reload();
    });
  }
  const persist = () => session.request();
  const drawUV = () => viewportDevice.drawUV();
  previewDevice = createBrowserPreviewDevice({
    document: core.document, region: rasterRegion(region), initialSize: workspace.preview.textureSize,
    makeWorker: () => new Worker("/build/raster-worker.js", { type: "module" }),
    frame: run => requestAnimationFrame(run),
    refresh: () => { drawUV(); persist(); }, refreshSelection: () => { drawUV(); persist(); },
    refreshQuality: () => { persist(); }, drawUV,
    report: text => adapterMessage("preview", text),
    measurement: (layer: Layer, size, stats) => {
      measurements.record(layer, size, stats);
      statusSource.changed();
    },
  });
  core.app.attach({ quality: previewDevice.coordinator.quality });
  // The live face (facial-preview.ts): the composition's face posers read the selected look's parts, the host solves them with the blink,
  // and the head shows the result once it is loaded. Part presets (favourites) live in the library, the verification workspace's apart.
  // The main view shows the held expression: the view graph's per-view scene input is the seam where another view could show another.
  const facial = new FacialPreview(createBrowserFacialDevice());
  // A set of saved expressions exports as one mod through the same package route a collection uses (never installed by Build).
  const presets = new PartPresetService(partPresetTransport(verification ? "/api/verification/part-presets" : "/api/part-presets"),
    setExportTransport(verification ? "/api/verification/mod-install" : "/api/mod-install"));
  setBuilds = () => presets.builtMods();
  core.app.attach({ facial, presets, transitions });
  facial.follow(() => combineFacePoses(STUDIO_FACE_POSES.map(poser => poser.pose(core.app.featureState(poser.feature)?.part))),
    () => shownHead()?.motion.snapshot());
  // Changes ease by the expression's transition setting; an edit inside an open form control (a slider drag) follows at once.
  facial.animate({ setting: () => transitions.get("expression"), continuous: () => !!core.app.featureControlSnapshot() });
  transitions.subscribe(persist);
  core.app.subscribe(() => facial.changed());
  facial.start();
  previewDevice.coordinator.quality.subscribe(persist);
  // The editors (scene-editors.ts): every composed layered surface is registered, and each view's on-head editor edits the look that view's
  // scene shows, naming it through the view's panel (the input layer's resolution, profiles design §3.6). The root names no feature.
  const panelOf = (view: string) => sessionState.instance(viewPanel(view));
  const editors = createSceneEditors({ surfaces: STUDIO_LAYERED_SURFACES, look: { feature: core.document.feature, preview: previewDevice, ref: () => lookEditor.ref() }, core,
    naming: { look: view => targets.named(panelOf(view)).look,
      complete: (action, view) => targets.complete(action, core.app.descriptor(action.kind as StudioAction["kind"]), { instance: panelOf(view) }) as StudioAction },
    drawn: () => drawnView(), viewport: viewportDevice, attach: services => core.app.attach(services), message: adapterMessage });
  uvEditor = viewportDevice.mountUV(byId<HTMLCanvasElement>("device-uv-canvas"), undefined, {
    ...editors.uvHooks(), canvases: () => previewDevice.canvases,
    albedo: () => shownHead()?.scene.albedo.image as HTMLImageElement | undefined,
    persist: () => { persist(); viewportDevice.attachment.viewChanged(); },
  }, workspace.uvView);
  // The drawn scene's heads (profiles phase 4a-iv): the head of the V it shows, built hidden and shown once ready, with one more kept warm.
  // A change of the scene's V or of the V's body supersedes any earlier one; the V's context outlives the heads. What follows the shown
  // head (the live face, the poses stage, prefetching) is connected here as each one is shown.
  const heads = createBrowserSceneHeads({
    head: { workspace, graph: views, viewport: viewportDevice, preferences, warmStart,
      // The layered surfaces each head connects (the one the look editor edits).
      layered: editors.wiring,
      // The stage backdrop follows the resolved UI theme through the renderer's typed input.
      colourScheme: matchMedia("(prefers-color-scheme: dark)"),
      quality: previewDevice.coordinator.quality,
      attach: attached => core.app.attach(attached), persist, changed: () => statusSource.changed() },
    scenes: { view: () => MAIN_VIEW, of: view => views.has(view) ? views.node(view, "scene").id : undefined,
      subject: id => { const subject = sessionState.scene(id).subject; return subject?.kind === "character" ? subject.id : undefined; },
      ensureSubject: id => sceneCharacter(sessionState, id, services), subscribe: listener => sessionState.subscribe(listener) },
    characters: services.characters,
    // The shown V's body decides the core head (the masculine V's is prepared on first use, and stops when a newer change supersedes it).
    prepareCore: (body, pending, signal) => host.previewPreparation.ensureBody(body, pending, signal),
    pending: (message, progress) => viewportDevice.headPending("preparing", message, progress),
    preparation: state => viewportDevice.headPreparation(state),
    notice: text => adapterMessage("preview", text),
    onContext: listener => viewportDevice.onContext(listener),
    editors,
    shown: head => {
      stopPrefetch?.(); stopPrefetch = undefined;
      facial.attachScene(head?.scene.face);
      poseStage.attach(head ? { view: drawnView(), motion: head.motion, details: head.characterDetails, context: head.characterContext } : null);
      if (!head) return;
      stopPrefetch = prefetchWhenQuiet(() => facial.prefetch(), headQuiet({ details: head.characterDetails, scene: head.scene }));
      status = { ...status, assets: { ...status.assets, loaded: true } };
      viewportDevice.headReady();
      session.setPreviewReady(); session.flush(); drawUV();
      statusSource.changed();
      host.onPreviewReady?.();
    },
  });
  shownHead = () => heads.shown();
  drawnView = () => heads.shownView();
  // Camera, preview and motion actions go to the runtime holding the view they name (view-routes.ts).
  core.app.attach({ runtimes: heads.runtimes });
  // 3D preview setup: follows the host's preparation and WolvenKit setup, then loads the head.
  const previewSetup = new PreviewSetupActions({
    preparation: host.previewPreparation, wolvenKit: host.wolvenKitSetup, detection: installDetection, localSetup,
    openLink: host.openLink ?? (link => openInNewTab(host.wolvenKitSetup, link)),
    openHostSetup: host.openSetup, setupPlace: host.setupPlace,
    autostart: { get: () => autostart, set: on => { if (autostart !== on) { autostart = on; persist(); } } },
    declined: { get: () => declined, set: on => { if (declined !== on) { declined = on; persist(); } } },
    loadHead: () => loadHead(),
  });
  bootstrap = createTrustedStudioBootstrap({
    core, preferences, localSetup, installDetection, modInstall, previewSetup, viewport: viewportDevice.attachment,
    links: { open: async link => {
      try { await (host.openLink ? host.openLink(link) : openProjectLinkInNewTab(link)); return { ok: true }; }
      catch (error) { return { ok: false, message: error instanceof Error ? error.message : "That page couldn't be opened. Try again." }; }
    } },
    previewReadiness: previewDevice.coordinator, status: statusSource, about: host.about, desktopApp: host.desktopApp,
    // Both hosts serve the update check; a verification workspace keeps what it found apart (UI-98).
    updates: createBrowserUpdateCheck(verification ? "/api/verification/update-check" : "/api/update-check"),
    collections: { owner: services.collections, scene: shownScene, transport: collectionTransport(`${base}/collections`),
      flushLook: () => lookEditor.commit(),
      membership: id => services.profiles.collectionMembership(sessionState.profile, id),
      join: id => {
        const profile = services.profiles.profile(sessionState.profile);
        if (profile && !profile.collections.includes(id))
          void services.profiles.dispatch({ kind: "profile.addCollection", profile: profile.id, base: profile.revision, collection: id });
      } },
    onRecipeImported: persist,
    savedAppearance: {
      has: () => heads.shown()?.savedAppearance.hasSavedV() ?? false,
      read: () => heads.shown()?.savedAppearance.snapshot().savedV,
      // A save file becomes where the V comes from (`character.setSource`, which `savedV.load` stays an alias of until phase 1 ends),
      // for the V the request named when it was asked (profiles design §3.3); the head showing that V applies it.
      load: (bytes, character) => {
        if (bytes.byteLength > 128 * 1024 * 1024) throw Error("Save is larger than the supported limit.");
        const result = core.app.dispatch({ kind: "character.setSource", character, source: { kind: "save", value: readSavedV(bytes) } });
        if (!result.ok) throw Error(result.message);
        return heads.showing(character)!.savedAppearance.snapshot();
      },
      // Ready per scene: a head shows the V the request names.
      ready: character => !!heads.showing(character),
      unavailableReason: () => { const head = viewportDevice.attachment.snapshot().head; return head.error ?? head.message; },
    },
    fileDevice, diagnostics, modules: moduleServices, experiments, lease, outbox: documents.outbox,
    panelInstance: panel => sessionState.instance(panel),
    // The input layer: what each action names (profiles design §3.6), resolved from the session, focus and the owners.
    targets, focus: historyService.focus, scopeName: scope => historyScopeName(scope, { services, history: historyService }),
  });
  // The editor shows the scene's look, and follows it when the scene shows another one.
  lookShown = () => { previewDevice.coordinator.resetStack(); drawUV(); };
  lookEditor.show(shownScene.look());
  sessionState.subscribe(() => lookEditor.show(shownScene.look()));
  // The only object handed to the presentation.
  const viewComposition = { ...STUDIO_VIEW_COMPOSITION, optional: () => experiments.registrations().map(item => ({ contribution: item.contribution, binding: item.binding })) };
  bootstrap.mount(publicPort => { port = publicPort; mountStudio(publicPort, root, viewComposition); });
  host.onMounted?.({ openGameSetup: () => void previewSetup.dispatch({ kind: "previewSetup.openSetup" }) });
  if (verification) {
    /** The scene runtime shown now (developer evidence reads only that one). */
    const viewer = () => heads.shown()?.scene;
    Object.assign(window, { xfStudioPresentation: port,
    // Developer evidence about the loaded head (read-only): what loaded, how the V's details landed, frame timing, and which runtimes are
    // resident (profiles phase 4a-iv).
    xfStudioSceneEvidence: () => { const scene = viewer(); return scene ? structuredClone({ core: scene.evidence, characterDetails: scene.characterDetailsEvidence(),
      frames: scene.frameTiming(), plateBlend: (editors.edited && scene.feature(editors.edited)?.evidence?.()) ?? null,
      features: scene.featureEvidence(), bands: scene.featureBands(), dangles: scene.dangleEvidence(), mouth: scene.mouthEvidence(),
      // The lighting drawn now (a setup asked for that isn't prepared yet is staged, and the one before stays drawn until it takes over).
      lighting: { preset: scene.lighting.status().preset, staged: scene.lighting.staged !== null },
      residency: heads.snapshot() }) : null; },
    // Developer captures: hold the mouth interior's light at a fixed parting and floor (the earlier stand-in: 0.010, 0.3), null to follow the face.
    xfStudioPinMouthInterior: (pin: { parting: number; floor: number } | null) => { viewer()?.pinMouthInterior(pin); },
    xfStudioLayeredSamples: () => viewer()?.layeredSamples() ?? null,
    // Developer captures: put the playing or paused idle at a motion time (the dangles re-simulate to it deterministically).
    xfStudioSeekIdle: (seconds: number) => { const scene = viewer(); scene?.idle?.seek(seconds); return scene?.idle?.time ?? null; },
    // Developer captures (tools/preparation-look.ts): show a preparation state in the head pane as the runtime owner would, in its quiet
    // status line, or with `pane` in its loading state (null: back to the shown head). The next real preparation replaces it.
    xfStudioShowPreparation: (state: Parameters<typeof viewportDevice.headPreparation>[0], options: { pane?: boolean } = {}) => {
      viewportDevice.headPreparation(state);
      if (state && options.pane) viewportDevice.headPending("preparing", "", state.fraction);
      else if (heads.shown()) viewportDevice.headReady();
    },
    // Creator rig evidence for calibration captures (tools/creator-light-look.ts): its lights, one alone, and the frame cost.
    xfStudioCreatorRig: {
      lights: () => viewer()?.lighting.rig.lights.map(light => ({ name: light.id, castShadow: light.shadows })) ?? [],
      solo: (name: string | null) => { const scene = viewer(); scene?.lighting.solo(name); scene?.requestRender(); },
      trialYaw: (degrees: number | null) => { const scene = viewer(); scene?.lighting.trialYaw(degrees); scene?.requestRender(); },
      trialCasters: (names: string[] | null) => { const scene = viewer(); scene?.lighting.trialCasters(names); scene?.requestRender(); },
      casters: () => viewer()?.lighting.rig.lights.filter(light => light.shadows).map(light => light.id) ?? [],
      frameMs: (frames: number) => { const scene = viewer(); return scene ? scene.lighting.frameCost(scene.camera, frames) : null; },
      shadowMapSize: () => viewer()?.lighting.rig.shadowMapSize ?? null,
      // The skin scatter (platform/scene/skin-scatter.ts): switch it off for the wrap stand-in and on again (A/B evidence), and its state.
      scatter: (mode: boolean | "bare") => { const scene = viewer(); scene?.lighting.setScatter(mode); scene?.requestRender(); },
      scatterEvidence: () => viewer()?.lighting.scatter.evidence() ?? null,
      // Character contact shadows (platform/scene/contact-shadow.ts): off and on again for A/B captures, and what the last frame marched toward.
      contact: (on: boolean) => { const scene = viewer(); scene?.lighting.setContactShadows(on); scene?.requestRender(); },
      contactEvidence: () => viewer()?.lighting.contact.evidence() ?? null,
      scatterScale: (scale: number | null) => { const scene = viewer(); scene?.lighting.setScatterScale(scale); scene?.requestRender(); },
      // The scatter's own passes (input, both blurs), `passes` times back to back after one frame, the GPU finished at both ends.
      scatterPassMs: (passes: number) => {
        const scene = viewer();
        if (!scene) return null;
        const gl = scene.renderer.getContext(), { scene: world } = scene, scatter = scene.lighting.scatter;
        scene.lighting.render(scene.camera); gl.finish();
        const start = performance.now();
        for (let i = 0; i < passes; i++) scatter.render(world, scene.camera);
        gl.finish();
        return (performance.now() - start) / passes;
      },
      // One frame right after the scatter's input variants are dropped: their compile cost, as a V's first scatter frame pays it.
      scatterColdFrameMs: () => {
        const scene = viewer();
        if (!scene) return null;
        const gl = scene.renderer.getContext();
        scene.lighting.render(scene.camera); gl.finish();
        scene.lighting.scatter.resetVariants();
        const start = performance.now();
        scene.lighting.render(scene.camera); gl.finish();
        return performance.now() - start;
      },
    } });
  }
  void localSetup.dispatch({ kind: "setup.refresh" });
  for (let i = 0; i < core.document.recipe.layers.length; i++) previewDevice.coordinator.render(i);
  session.activate();
  await port!.library.execute({ kind: "initialize" });
  followPreviewSetup();

  /**
   * The 3D head has one source: the preview the host derives from the player's own game files.
   * Until it is interactive the head pane shows the setup service's typed state (checking,
   * preparing, waiting for something, or failed with a way forward) and head actions say why.
   */
  function followPreviewSetup() {
    let shown = "";
    const show = () => {
      const head = previewSetup.snapshot().head, key = JSON.stringify(head);
      if (key === shown || head.phase === "ready") return;
      shown = key;
      core.app.setPreviewUnavailable(head.message || NO_3D_PREVIEW_IN_ALPHA);
      if (head.phase === "failed") viewportDevice.failHead(head.message);
      else viewportDevice.headPending(head.phase === "checking" ? "loading" : head.phase, head.message, head.progress);
      statusSource.changed();
    };
    previewSetup.subscribe(show);
    show();
    session.flush();
    // After installing .NET in another window, coming back re-checks without a click.
    window.addEventListener("focus", () => previewSetup.windowFocused());
    void previewSetup.start();
  }

  /** The preview is ready: show the drawn scene's head (the setup service's first load, and its Try again). */
  async function loadHead() {
    core.app.setPreviewUnavailable("");
    try { await heads.load(); }
    catch (error) {
      // The setup service maps the failure to plain words; nothing of this attempt stays connected (the heads owner released it).
      statusSource.changed();
      pageFailure("preview", "head_load_failed", "The 3D head couldn't be loaded.", error);
      session.flush();
      throw error;
    }
  }
}

/** The automatic-start choice saved by earlier builds in page storage (not verification-scoped). */
function legacyAutostart(storage: Pick<Storage, "getItem">, verification: boolean) {
  if (verification) return true;
  try { return storage.getItem("xfs.preview.autostart") !== "off"; } catch { return true; }
}

/** Localhost opens XF Studio's own public pages in a new tab (its own copy of a page it serves, such as the interface guide). */
function openProjectLinkInNewTab(link: ProjectLink) {
  const opened = window.open(LOCAL_PROJECT_PAGES[link] ?? PROJECT_LINKS[link], "_blank");
  if (!opened) throw Error("Your browser blocked the new tab. Allow pop-ups for XF Studio, then try again.");
  opened.opener = null;
}

/**
 * Localhost opens official pages in a new tab. `noopener` makes `window.open` return null even when
 * the tab opened, so the opener is cut on the returned window instead.
 */
async function openInNewTab(wolvenKit: WolvenKitSetupActions, link: WolvenKitLink) {
  const state = wolvenKit.snapshot(), url = state && wolvenKitLinkUrl(state, link);
  if (!url) throw Error("That page isn't available yet. Try again in a moment.");
  const opened = window.open(url, "_blank");
  if (!opened) throw Error("Your browser blocked the new tab. Allow pop-ups for XF Studio, then try again.");
  opened.opener = null;
}
