/**
 * The one trusted composition root for the XF Studio page, shared by localhost (`studio-main.ts`)
 * and the desktop bootstrap. It builds the core, browser devices and bootstrap, then mounts
 * `studio-ui` with ONLY the public `StudioPresentationPort`. Host differences (workspace
 * storage, the preparation endpoint, the setup form) arrive as a typed `StudioHost`, never as
 * page globals or data attributes. Nothing in `studio-ui/` imports this module.
 */
import { createBrowserFileDevice } from "./browser-file-device";
import { NO_3D_PREVIEW_IN_ALPHA } from "./alpha-availability";
import type { PreviewPreparationActions } from "./preview-preparation";
import { PreviewSetupActions } from "./preview-setup";
import { wolvenKitLinkUrl, type WolvenKitLink, type WolvenKitSetupActions } from "./wolvenkit-setup";
import { PROJECT_LINKS, type ProjectLink } from "./project-links";
import { createBrowserLocalSetup } from "./browser-local-setup-device";
import { createBrowserInstallDetection } from "./browser-install-detection-device";
import { createBrowserPreviewDevice } from "./browser-preview-device";
import { attachBrowserHead, type AttachedHead } from "./browser-head-attachment";
import { createBrowserViewportDevice } from "./browser-viewport-device";
import { createBrowserWorkspaceSession, loadBrowserWorkspace } from "./browser-workspace-device";
import { collectionTransport } from "./collection-transport";
import { GlitterMeasurements } from "./glitter-measurements";
import type { LocalSetupActions } from "./local-setup-actions";
import { emptyPresentationStatus, PresentationStatusSource } from "./presentation-status";
import type { Layer } from "./recipe";
import type { SavedAppearanceActions } from "./saved-appearance-actions";
import type { StudioPresentationPort } from "./studio-presentation";
import { mountStudio } from "./studio-ui/app";
import { createTrustedAuthoringCore } from "./trusted-authoring-core";
import type { MotionActions } from "./motion-actions";
import type { PreviewActions } from "./preview-actions";
import { createTrustedStudioBootstrap } from "./trusted-studio-bootstrap";
// The composition root: the one browser module that imports the composition list (CORE-29).
import { STUDIO_COMPOSITION } from "./compose/studio-registry";
import { UIPreferenceActions } from "./ui-preferences";

export type StudioHost = {
  /** Where the workspace draft is stored: browser storage, or the desktop's host-owned file. */
  storage: Pick<Storage, "getItem" | "setItem">;
  /** Serialized workspace budget; the desktop host file allows more than browser storage. */
  storageBudget?: number;
  /** The host's 3D preview preparation service. */
  previewPreparation: PreviewPreparationActions;
  /** The host's WolvenKit setup service (download with consent, .NET check). */
  wolvenKitSetup: WolvenKitSetupActions;
  /** The host's settings service; the desktop shares its Build setup dialog's instance. */
  localSetup?: LocalSetupActions;
  /** Opens a named official page (WolvenKit's, or XF Studio's own); without it the page opens in a new browser tab. */
  openLink?: (link: WolvenKitLink | ProjectLink) => Promise<void>;
  /** Where the game folder and WolvenKit CLI are set, in the host's own words ("Build setup", "Game & tools"). */
  setupPlace: string;
  /** Opens the host's own setup form, when it has one outside the Studio panels; otherwise Game & tools is shown. */
  openSetup?: () => void;
  /** Lets the host ask for an immediate workspace save (the desktop does before closing). */
  onFlushRequest?: (flush: () => void) => void;
  /** Called once the 3D head is interactive. */
  onPreviewReady?: () => void;
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
    root.replaceChildren(Object.assign(document.createElement("p"), { className: "boot-error",
      textContent: "XF Studio couldn't start. Reload the page, or restart XF Studio if this keeps happening." }));
    console.error(error);
  });
}

async function start(host: StudioHost, root: HTMLElement) {
  const verification = new URLSearchParams(location.search).has("verify");
  const storage = host.storage;
  const restored = loadBrowserWorkspace(storage, verification, STUDIO_COMPOSITION.documents), workspace = restored.state;
  const preferences = new UIPreferenceActions(workspace.uiPreferences);
  const localSetup = host.localSetup ?? createBrowserLocalSetup();
  const installDetection = createBrowserInstallDetection();
  // Whether the 3D preview may start preparing by itself; a workspace preference (per verification scope).
  let autostart = workspace.previewSetup?.autostart ?? legacyAutostart(storage, verification);
  let previewDevice: ReturnType<typeof createBrowserPreviewDevice>;
  let savedAppearance: SavedAppearanceActions | undefined;
  let previewActions: PreviewActions | undefined;
  let motionActions: MotionActions | undefined;
  /** The loaded head and its connections, released together. */
  let head: AttachedHead | undefined;
  let bootstrap: ReturnType<typeof createTrustedStudioBootstrap<HTMLElement>>;
  let scene: Awaited<ReturnType<ReturnType<typeof createBrowserViewportDevice>["loadHead"]>> | undefined;
  let uvEditor: ReturnType<ReturnType<typeof createBrowserViewportDevice>["mountUV"]> | undefined;
  let port: StudioPresentationPort<HTMLElement> | undefined;

  // Device facts published read-only to the view.
  let status = emptyPresentationStatus(verification);
  const measurements = new GlitterMeasurements({
    layers: () => core.document.recipe.layers, size: () => previewDevice.coordinator.size });
  const statusSource = new PresentationStatusSource(() => {
    const eye = scene?.eyeAppearance().optics;
    return { ...status, glitter: measurements.snapshot(), assets: { ...status.assets,
      characterDetails: head?.characterDetails.snapshot(),
      eyeOptics: eye ? { requested: eye.requested, active: eye.active, reason: eye.reason, error: eye.error } : undefined } };
  });

  let messageId = 0;
  const adapterMessage = (source: "uv" | "surface" | "preview", text: string) => {
    status = { ...status, message: { id: ++messageId, source, text } }; statusSource.changed();
  };
  const core = createTrustedAuthoringCore(workspace, {
    resetStack: previous => previewDevice?.coordinator.syncStack(previous),
    // A cheap read: Glitter-model and finish changes ask for it, and a snapshot would stash and copy the whole draft (CORE-05).
    selectedCollection: () => bootstrap?.collection.selectedPresetId() ?? "draft",
  }, STUDIO_COMPOSITION);
  const headHost = byId("device-head"), uvHost = byId("device-uv");
  const viewportDevice = createBrowserViewportDevice({ headHost, uvHost, queryContext: hit => core.app.contextQuery(hit) });
  const session = createBrowserWorkspaceSession({
    workspace, restored, verification, storage, budget: host.storageBudget, model: STUDIO_COMPOSITION.documents,
    capture: {
      editor: () => core.document.export(),
      uvView: () => uvEditor?.snapshot() ?? workspace.uvView,
      savedV: () => savedAppearance?.snapshot().savedV ?? workspace.savedV,
      collections: () => bootstrap?.collection.workspaceSnapshot() ?? workspace.collections,
      quality: () => previewDevice?.coordinator.quality.snapshot().size ?? workspace.preview.textureSize,
      preview: () => previewActions?.snapshot(), motion: () => motionActions?.snapshot(),
      triedChoice: () => head?.characterDetails.snapshot().tried,
      uiPreferences: () => preferences.snapshot(),
      previewSetup: () => ({ autostart }),
    },
    sources: [core.document, preferences], window, document,
    onStatus: save => { status = { ...status, workspace: save }; statusSource.changed(); },
  });
  host.onFlushRequest?.(() => session.flush());
  const persist = () => session.request();
  const drawUV = () => viewportDevice.drawUV();
  previewDevice = createBrowserPreviewDevice({
    document: core.document, initialSize: workspace.preview.textureSize,
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
  previewDevice.coordinator.quality.subscribe(persist);
  const fieldHooks = {
    selectedField: () => core.presentation.selectedField()?.id,
    selectField: (id: string) => { const layer = core.presentation.layer(); if (layer) core.app.dispatch({ kind: "field.select", layerId: layer.id, fieldId: id }); },
    select: (index: number) => { const layer = core.presentation.layer(); if (layer) core.app.dispatch({ kind: "point.select", layerId: layer.id, index }); },
  };
  uvEditor = viewportDevice.mountUV(byId<HTMLCanvasElement>("device-uv-canvas"), undefined, {
    recipe: () => core.geometry.recipe(), layer: () => core.geometry.layer(),
    selected: () => core.presentation.selected, ...fieldHooks,
    canvases: () => previewDevice.canvases,
    albedo: () => scene?.albedo.image as HTMLImageElement | undefined,
    begin: () => { const layer = core.presentation.layer(); if (layer) core.app.beginGesture("uv", layer.id); },
    apply: proposal => core.app.applyGesture("uv", proposal),
    cancel: () => core.app.endGesture("uv", true), finish: () => core.app.endGesture("uv"),
    persist: () => { persist(); viewportDevice.attachment.viewChanged(); },
    message: text => adapterMessage("uv", text),
  }, workspace.uvView);
  // 3D preview setup: follows the host's preparation and WolvenKit setup, then loads the head.
  const previewSetup = new PreviewSetupActions({
    preparation: host.previewPreparation, wolvenKit: host.wolvenKitSetup, detection: installDetection, localSetup,
    openLink: host.openLink ?? (link => openInNewTab(host.wolvenKitSetup, link)),
    openHostSetup: host.openSetup, setupPlace: host.setupPlace,
    autostart: { get: () => autostart, set: on => { if (autostart !== on) { autostart = on; persist(); } } },
    loadHead: () => attachHead(),
  });
  bootstrap = createTrustedStudioBootstrap({
    workspace, core, preferences, localSetup, installDetection, previewSetup, viewport: viewportDevice.attachment,
    links: { open: async link => {
      try { await (host.openLink ? host.openLink(link) : openProjectLinkInNewTab(link)); return { ok: true }; }
      catch (error) { return { ok: false, message: error instanceof Error ? error.message : "That page couldn't be opened. Try again." }; }
    } },
    previewReadiness: previewDevice.coordinator, status: statusSource,
    transport: collectionTransport(verification ? "/api/verification/collections" : "/api/collections"),
    onEditorRestored: () => { previewDevice.coordinator.resetStack(); drawUV(); },
    onRecipeImported: persist,
    savedAppearance: {
      has: () => savedAppearance?.hasSavedV() ?? false,
      read: () => savedAppearance?.snapshot().savedV,
      load: bytes => savedAppearance!.dispatch({ kind: "savedV.load", bytes }),
      ready: () => !!scene,
      unavailableReason: () => { const head = viewportDevice.attachment.snapshot().head; return head.error ?? head.message; },
    },
    fileDevice: createBrowserFileDevice({ document, pickers: {
      recipe: byId<HTMLInputElement>("device-recipe-picker"),
      collection: byId<HTMLInputElement>("device-collection-picker"),
      savedV: byId<HTMLInputElement>("device-save-picker"),
    } }),
  });
  // The only object handed to the presentation.
  bootstrap.mount(publicPort => { port = publicPort; mountStudio(publicPort, root); });
  if (verification) Object.assign(window, { xfStudioPresentation: port,
    // Developer evidence about the loaded head (read-only): what loaded, how the V's details landed, frame timing.
    xfStudioSceneEvidence: () => scene ? structuredClone({ core: scene.evidence, characterDetails: scene.characterDetailsEvidence(),
      frames: scene.frameTiming(), plateBlend: scene.plateBlendEvidence() }) : null,
    xfStudioLayeredSamples: () => scene ? scene.layeredSamples() : null });
  // Library content (preset edits, switches, saves) persists; the whole port is not watched,
  // because it also publishes the save status and preview readiness (CORE-01).
  session.watch(bootstrap.collection);
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

  /** Load the 3D head and connect every head-dependent service once the preview is ready. */
  async function attachHead() {
    core.app.setPreviewUnavailable("");
    // A retry starts from nothing: an earlier head and its connections are released first (PREV-20).
    releaseHead(head);
    const priorAssets = status.assets;
    let attached: AttachedHead | undefined;
    try {
      attached = await attachBrowserHead({
        workspace, viewport: viewportDevice, preview: previewDevice, preferences,
        // The stage backdrop follows the resolved UI theme through the renderer's typed input.
        colourScheme: matchMedia("(prefers-color-scheme: dark)"),
        attach: services => core.app.attach(services),
        surface: {
          layer: () => core.geometry.layer(), layers: () => core.geometry.recipe().layers,
          selected: () => core.presentation.selected, ...fieldHooks,
          begin: () => { const layer = core.presentation.layer(); if (layer) core.app.beginGesture("surface", layer.id); },
          apply: proposal => core.app.applyGesture("surface", proposal),
          cancel: () => core.app.endGesture("surface", true), finish: () => core.app.endGesture("surface"),
          message: text => adapterMessage("surface", text),
        },
        persist, changed: () => statusSource.changed(),
      });
      head = attached;
      ({ scene, savedAppearance, preview: previewActions, motion: motionActions } = attached);
      status = { ...status, assets: { ...status.assets, loaded: true } };
      viewportDevice.headReady();
      session.setPreviewReady(); session.flush(); drawUV();
      statusSource.changed();
      host.onPreviewReady?.();
    } catch (error) {
      // The setup service maps the failure to plain words; nothing of this attempt stays connected.
      releaseHead(attached);
      status = { ...status, assets: priorAssets };
      statusSource.changed();
      console.error(error); session.flush();
      throw error;
    }
  }

  /** Release the loaded head (or a part-attached one) and forget its services. */
  function releaseHead(attached: AttachedHead | undefined) {
    if (head === attached) head = undefined;
    attached?.dispose();
    scene = undefined; savedAppearance = undefined; previewActions = undefined; motionActions = undefined;
  }
}

/** The automatic-start choice saved by earlier builds in page storage (not verification-scoped). */
function legacyAutostart(storage: Pick<Storage, "getItem">, verification: boolean) {
  if (verification) return true;
  try { return storage.getItem("xfs.preview.autostart") !== "off"; } catch { return true; }
}

/** Localhost opens XF Studio's own public pages in a new tab. */
function openProjectLinkInNewTab(link: ProjectLink) {
  const opened = window.open(PROJECT_LINKS[link], "_blank");
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
