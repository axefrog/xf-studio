/**
 * Trusted composition root for the XF Studio presentation. It builds the core,
 * browser devices and bootstrap, then mounts `studio-ui` with ONLY the public
 * `StudioPresentationPort`. Nothing in `studio-ui/` imports this module.
 */
import { createBrowserFileDevice } from "./browser-file-device";
import { NO_3D_PREVIEW_IN_ALPHA } from "./alpha-availability";
import { PREVIEW_READY_EVENT, PREVIEW_STATUS_EVENT, type PreviewStatusDetail } from "./preview-preparation";
import { createBrowserLocalSetup } from "./browser-local-setup-device";
import { createBrowserInstallDetection } from "./browser-install-detection-device";
import { createBrowserPreviewDevice } from "./browser-preview-device";
import { createBrowserScenePreviewPorts } from "./browser-scene-preview-ports";
import { createBrowserViewportDevice } from "./browser-viewport-device";
import { createBrowserWorkspaceSession, loadBrowserWorkspace } from "./browser-workspace-device";
import { collectionTransport } from "./collection-transport";
import { GlitterMeasurements } from "./glitter-measurements";
import { emptyPresentationStatus, PresentationStatusSource } from "./presentation-status";
import type { Layer } from "./recipe";
import type { SavedAppearanceActions } from "./saved-appearance-actions";
import type { StudioPresentationPort } from "./studio-presentation";
import { mountStudio } from "./studio-ui/app";
import { createTrustedAuthoringCore } from "./trusted-authoring-core";
import { createTrustedPreviewServices } from "./trusted-preview-services";
import { createTrustedStudioBootstrap } from "./trusted-studio-bootstrap";
import { UIPreferenceActions } from "./ui-preferences";

const byId = <T extends HTMLElement>(id: string) => {
  const found = document.getElementById(id);
  if (!found) throw Error(`Missing device host ${id}`);
  return found as T;
};
const verification = new URLSearchParams(location.search).has("verify");
const root = byId("studio");
void start().catch(error => {
  root.replaceChildren(Object.assign(document.createElement("p"), { className: "boot-error", textContent: `XF Studio could not start: ${(error as Error).message}` }));
  console.error(error);
});

async function start() {
  const storage = (window as typeof window & {
    xfDesktopWorkspaceStorage?: Pick<Storage, "getItem" | "setItem">;
  }).xfDesktopWorkspaceStorage ?? localStorage;
  const restored = loadBrowserWorkspace(storage, verification), workspace = restored.state;
  const preferences = new UIPreferenceActions(workspace.uiPreferences);
  const localSetup = createBrowserLocalSetup();
  const installDetection = createBrowserInstallDetection();
  let previewDevice: ReturnType<typeof createBrowserPreviewDevice>;
  let savedAppearance: SavedAppearanceActions | undefined;
  let previewActions: ReturnType<ReturnType<typeof createTrustedPreviewServices>["finish"]>["preview"] | undefined;
  let motionActions: ReturnType<ReturnType<typeof createTrustedPreviewServices>["finish"]>["motion"] | undefined;
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
      eyeOptics: eye ? { requested: eye.requested, active: eye.active, reason: eye.reason, error: eye.error } : undefined } };
  });

  let messageId = 0;
  const adapterMessage = (source: "uv" | "surface" | "preview", text: string) => {
    status = { ...status, message: { id: ++messageId, source, text } }; statusSource.changed();
  };
  const core = createTrustedAuthoringCore(workspace, {
    resetStack: previous => previewDevice?.coordinator.syncStack(previous),
    selectedCollection: () => bootstrap?.collection.workspaceSnapshot()?.selected ?? "draft",
  });
  const headHost = byId("device-head"), uvHost = byId("device-uv");
  const viewportDevice = createBrowserViewportDevice({ headHost, uvHost, queryContext: hit => core.app.contextQuery(hit) });
  const session = createBrowserWorkspaceSession({
    workspace, restored, verification, storage,
    capture: {
      editor: () => core.document.export(),
      uvView: () => uvEditor?.snapshot() ?? workspace.uvView,
      savedV: () => savedAppearance?.snapshot().savedV ?? workspace.savedV,
      collections: () => bootstrap?.collection.workspaceSnapshot() ?? workspace.collections,
      quality: () => previewDevice?.coordinator.quality.snapshot().size ?? workspace.preview.textureSize,
      preview: () => previewActions?.snapshot(), motion: () => motionActions?.snapshot(),
      uiPreferences: () => preferences.snapshot(),
      // The legacy shell's sidebar and scroll memory are retained untouched for it.
      sidebar: () => ({ sidebarLeft: workspace.panels.sidebarLeft, sidebarRight: workspace.panels.sidebarRight }),
      layout: () => workspace.panels,
    },
    sources: [core.document, preferences], window, document, scrollTargets: [], toggleTargets: [],
    onStatus: save => { status = { ...status, workspace: save }; statusSource.changed(); },
  });
  if ((window as typeof window & { xfDesktopWorkspaceFlush?: () => Promise<void> }).xfDesktopWorkspaceFlush)
    window.addEventListener("xfs-desktop-close-flush", () => session.flush());
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
  bootstrap = createTrustedStudioBootstrap({
    workspace, core, preferences, localSetup, installDetection, viewport: viewportDevice.attachment,
    previewReadiness: previewDevice.coordinator, status: statusSource,
    transport: collectionTransport(verification ? "/api/verification/collections" : "/api/collections"),
    onEditorRestored: () => { previewDevice.coordinator.resetStack(); drawUV(); },
    onRecipeImported: persist,
    savedAppearance: {
      has: () => savedAppearance?.hasSavedV() ?? false,
      read: () => savedAppearance?.snapshot().savedV,
      load: bytes => savedAppearance!.dispatch({ kind: "savedV.load", bytes }),
      ready: () => !!scene,
      unavailableReason: () => viewportDevice.attachment.snapshot().head.error,
    },
    fileDevice: createBrowserFileDevice({ document, pickers: {
      recipe: byId<HTMLInputElement>("device-recipe-picker"),
      collection: byId<HTMLInputElement>("device-collection-picker"),
      savedV: byId<HTMLInputElement>("device-save-picker"),
    } }),
  });
  // The only object handed to the presentation.
  bootstrap.mount(publicPort => { port = publicPort; mountStudio(publicPort, root); });
  if (verification) Object.assign(window, { xfStudioPresentation: port });
  // Library content (preset edits, switches, saves) persists; the whole port is not watched,
  // because it also publishes the save status and preview readiness (CORE-01).
  session.watch(bootstrap.collection);
  void localSetup.dispatch({ kind: "setup.refresh" });
  for (let i = 0; i < core.document.recipe.layers.length; i++) previewDevice.coordinator.render(i);
  session.activate();
  await port!.library.execute({ kind: "initialize" });
  const desktopAssets = document.documentElement.dataset.desktopPreviewAssets;
  if (desktopAssets === "missing" || desktopAssets === "incomplete") {
    // Community installs have no preview intake: the desktop prepares the preview from the
    // player's game files and reports its state; only a maintainer intake mentions prepared files.
    const reason = document.documentElement.dataset.desktopPreviewIntake !== "enabled"
      ? document.documentElement.dataset.desktopPreviewStatus || NO_3D_PREVIEW_IN_ALPHA
      : desktopAssets === "missing"
        ? "3D preview files are missing. Use Enable 3D preview to import the five prepared files."
        : "3D preview files are incomplete. Check the preview-assets folder and import a valid prepared set.";
    const unavailable = (text: string) => {
      core.app.setPreviewUnavailable(text);
      viewportDevice.failHead(text);
      statusSource.changed();
    };
    unavailable(reason);
    session.flush();
    const onStatus = (event: Event) => {
      const message = (event as CustomEvent<PreviewStatusDetail>).detail?.message;
      if (typeof message === "string" && message) unavailable(message);
    };
    window.addEventListener(PREVIEW_STATUS_EVENT, onStatus);
    window.addEventListener(PREVIEW_READY_EVENT, () => {
      window.removeEventListener(PREVIEW_STATUS_EVENT, onStatus);
      core.app.setPreviewUnavailable("");
      void attachHead();
    }, { once: true });
    return;
  }
  await attachHead();

  /** Load the 3D head and connect every head-dependent service (at start, or once the desktop has prepared it). */
  async function attachHead() {
    try {
      scene = await viewportDevice.loadHead(previewDevice.emptyCanvases());
      let surface: ReturnType<typeof viewportDevice.mountSurface> | undefined;
      const services = createTrustedPreviewServices(workspace, createBrowserScenePreviewPorts(scene, {
        setSurfaceControls: enabled => surface?.setEnabled(enabled),
        hasSavedAppearance: () => !!workspace.savedV || !!savedAppearance?.hasSavedV(),
      }));
      savedAppearance = services.savedAppearance;
      core.app.attach({ savedV: savedAppearance });
      savedAppearance.subscribe(persist);
      savedAppearance.subscribe(() => statusSource.changed());
      previewDevice.connectScene(scene);
      surface = viewportDevice.mountSurface({
        layer: () => core.geometry.layer(), selected: () => core.presentation.selected, ...fieldHooks,
        begin: () => { const layer = core.presentation.layer(); if (layer) core.app.beginGesture("surface", layer.id); },
        apply: proposal => core.app.applyGesture("surface", proposal),
        cancel: () => core.app.endGesture("surface", true), finish: () => core.app.endGesture("surface"),
        message: text => adapterMessage("surface", text),
      });
      ({ preview: previewActions, motion: motionActions } = services.finish());
      core.app.attach({ preview: previewActions, motion: motionActions });
      previewActions.subscribe(persist); motionActions.subscribe(persist);
      previewActions.subscribe(() => statusSource.changed());
      previewDevice.presentInitialLayers();
      scene.controls.addEventListener("change", persist);
      const evidence = scene.evidence;
      status = { ...status, assets: { ...status.assets, loaded: true, detailErrors: [...evidence.detailErrors],
        browMaterial: evidence.browMaterial as "saved-double-diffuse" | "provisional",
        lashColor: evidence.lashColor as "saved-hair-profile" | "provisional",
        lashProfileLabel: evidence.lashProfile
          ? `${evidence.lashProfile.winner} (${evidence.lashProfile.basis.replaceAll("-", " ")})` : undefined,
        hairError: evidence.hairError || undefined, piercingError: evidence.piercingError || undefined,
        prcError: evidence.prcError || undefined, prcAvailable: !!evidence.prc.styles } };
      viewportDevice.headReady();
      session.setPreviewReady(); session.flush(); drawUV();
      statusSource.changed();
    } catch (error) {
      const reason = `3D preview unavailable: ${(error as Error).message}`;
      core.app.setPreviewUnavailable(reason);
      viewportDevice.failHead(reason);
      statusSource.changed();
      console.error(error); session.flush();
    }
  }
}
