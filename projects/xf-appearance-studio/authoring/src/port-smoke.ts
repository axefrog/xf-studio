/** A deliberately small second browser entry. It uses the public presentation port only. */
import { createBrowserFileDevice } from "./browser-file-device";
import { createBrowserPreviewDevice } from "./browser-preview-device";
import { createBrowserScenePreviewPorts } from "./browser-scene-preview-ports";
import { createBrowserViewportDevice } from "./browser-viewport-device";
import { createBrowserWorkspaceSession, loadBrowserWorkspace } from "./browser-workspace-device";
import { collectionTransport } from "./collection-transport";
import type { RecipeAction } from "./recipe-actions";
import type { SavedAppearanceActions } from "./saved-appearance-actions";
import type { StudioAction } from "./studio-application";
import type { StudioFileAction } from "./studio-file-operations";
import type { StudioPresentationPort } from "./studio-presentation";
import { createTrustedAuthoringCore } from "./trusted-authoring-core";
import { createTrustedPreviewServices } from "./trusted-preview-services";
import { createTrustedStudioBootstrap } from "./trusted-studio-bootstrap";
import { UIPreferenceActions } from "./ui-preferences";

const node = <T extends HTMLElement>(id: string) => {
  const found = document.getElementById(id);
  if (!found) throw Error(`Missing diagnostic host ${id}`);
  return found as T;
};
const status = (message: string) => { node("port-status").textContent = message; };
const verify = new URLSearchParams(location.search).has("verify");
if (!verify) {
  status("Open this diagnostic entry with ?verify=1 to protect the active draft.");
} else {
  void start().catch(error => { status(`Startup failed: ${(error as Error).message}`); console.error(error); });
}

async function start() {
  const restored = loadBrowserWorkspace(localStorage, true), workspace = restored.state;
  const preferences = new UIPreferenceActions(workspace.uiPreferences);
  let previewDevice: ReturnType<typeof createBrowserPreviewDevice>;
  let savedAppearance: SavedAppearanceActions | undefined;
  let previewActions: ReturnType<ReturnType<typeof createTrustedPreviewServices>["finish"]>["preview"] | undefined;
  let motionActions: ReturnType<ReturnType<typeof createTrustedPreviewServices>["finish"]>["motion"] | undefined;
  let bootstrap: ReturnType<typeof createTrustedStudioBootstrap<HTMLElement>>;
  let scene: Awaited<ReturnType<ReturnType<typeof createBrowserViewportDevice>["loadHead"]>> | undefined;
  let uvEditor: ReturnType<ReturnType<typeof createBrowserViewportDevice>["mountUV"]> | undefined;
  let port: StudioPresentationPort<HTMLElement> | undefined;
  let paintQueued = false;
  const schedulePaint = () => {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => { paintQueued = false; if (port) paint(port); });
  };
  const core = createTrustedAuthoringCore(workspace, {
    resetStack: () => previewDevice?.coordinator.resetStack(),
    selectedCollection: () => bootstrap?.collection.workspaceSnapshot()?.selected ?? "draft",
    controlAction: (action: RecipeAction) => { core.recipe.dispatch(action); },
  });
  const viewportDevice = createBrowserViewportDevice({
    headHost: node("port-head-host"), uvHost: node("port-uv-host"),
    queryContext: hit => core.app.contextQuery(hit),
  });
  const session = createBrowserWorkspaceSession({
    workspace, restored, verification: true, storage: localStorage,
    capture: {
      editor: () => core.document.export(),
      uvView: () => uvEditor?.snapshot() ?? workspace.uvView,
      savedV: () => savedAppearance?.snapshot().savedV ?? workspace.savedV,
      collections: () => bootstrap?.collection.workspaceSnapshot() ?? workspace.collections,
      quality: () => previewDevice?.coordinator.quality.snapshot().size ?? workspace.preview.textureSize,
      preview: () => previewActions?.snapshot(), motion: () => motionActions?.snapshot(),
      uiPreferences: () => preferences.snapshot(),
      sidebar: () => ({ sidebarLeft: workspace.panels.sidebarLeft, sidebarRight: workspace.panels.sidebarRight }),
      layout: () => workspace.panels,
    },
    sources: [core.document, preferences], window, document,
    scrollTargets: [], toggleTargets: [],
    onStatus: save => { if (save.kind === "unavailable") status(save.message); },
  });
  const persist = () => session.request();
  const drawUV = () => viewportDevice.drawUV();
  previewDevice = createBrowserPreviewDevice({
    document: core.document, initialSize: workspace.preview.textureSize,
    makeWorker: () => new Worker("/build/raster-worker.js", { type: "module" }),
    frame: run => requestAnimationFrame(run), refresh: () => { drawUV(); persist(); schedulePaint(); },
    refreshSelection: () => { drawUV(); persist(); schedulePaint(); },
    refreshQuality: () => { persist(); schedulePaint(); }, drawUV,
    report: status, measurement: () => {},
  });
  core.app.attach({ quality: previewDevice.coordinator.quality });
  previewDevice.coordinator.quality.subscribe(persist);
  uvEditor = viewportDevice.mountUV(node<HTMLCanvasElement>("port-uv-canvas"), undefined, {
    recipe: () => core.geometry.recipe(), layer: () => core.geometry.layer(),
    selected: () => core.presentation.selected,
    selectedField: () => core.presentation.selectedField()?.id,
    selectField: id => { const layer = core.presentation.layer(); if (layer) core.app.dispatch({ kind: "field.select", layerId: layer.id, fieldId: id }); },
    canvases: () => previewDevice.canvases,
    albedo: () => scene?.albedo.image as HTMLImageElement | undefined,
    select: index => { const layer = core.presentation.layer(); if (layer) core.app.dispatch({ kind: "point.select", layerId: layer.id, index }); },
    begin: () => { const layer = core.presentation.layer(); if (layer) core.app.beginGesture("uv", layer.id); },
    apply: proposal => core.app.applyGesture("uv", proposal),
    cancel: () => core.app.endGesture("uv", true), finish: () => core.app.endGesture("uv"),
    persist, message: status,
  }, workspace.uvView);
  bootstrap = createTrustedStudioBootstrap({
    workspace, core, preferences, viewport: viewportDevice.attachment,
    transport: collectionTransport("/api/verification/collections"),
    onEditorRestored: () => { previewDevice.coordinator.resetStack(); drawUV(); },
    onRecipeImported: persist,
    savedAppearance: {
      has: () => savedAppearance?.hasSavedV() ?? false,
      read: () => savedAppearance?.snapshot().savedV,
      load: bytes => savedAppearance!.dispatch({ kind: "savedV.load", bytes }),
      ready: () => !!scene,
    },
    fileDevice: createBrowserFileDevice({ document, pickers: {
      recipe: node<HTMLInputElement>("port-recipe-picker"),
      collection: node<HTMLInputElement>("port-collection-picker"),
      savedV: node<HTMLInputElement>("port-save-picker"),
    } }),
  });
  // This is the only object passed into the replaceable presentation.
  bootstrap.mount(publicPort => { port = publicPort; mount(publicPort, schedulePaint); });
  // Async library and preview events persist even when no DOM event initiated them.
  port!.subscribe(persist);
  for (let i = 0; i < core.document.recipe.layers.length; i++) previewDevice.coordinator.render(i);
  session.activate();
  await port!.library.execute({ kind: "initialize" });
  try {
    scene = await viewportDevice.loadHead(previewDevice.emptyCanvases());
    let surface: ReturnType<typeof viewportDevice.mountSurface> | undefined;
    const services = createTrustedPreviewServices(workspace,
      createBrowserScenePreviewPorts(scene, {
        setSurfaceControls: enabled => surface?.setEnabled(enabled),
        hasSavedAppearance: () => !!workspace.savedV || !!savedAppearance?.hasSavedV(),
      }));
    savedAppearance = services.savedAppearance;
    core.app.attach({ savedV: savedAppearance });
    savedAppearance.subscribe(persist);
    previewDevice.connectScene(scene);
    surface = viewportDevice.mountSurface({
      layer: () => core.geometry.layer(), selected: () => core.presentation.selected,
      selectedField: () => core.presentation.selectedField()?.id,
      selectField: id => { const layer = core.presentation.layer(); if (layer) core.app.dispatch({ kind: "field.select", layerId: layer.id, fieldId: id }); },
      select: index => { const layer = core.presentation.layer(); if (layer) core.app.dispatch({ kind: "point.select", layerId: layer.id, index }); },
      begin: () => { const layer = core.presentation.layer(); if (layer) core.app.beginGesture("surface", layer.id); },
      apply: proposal => core.app.applyGesture("surface", proposal),
      cancel: () => core.app.endGesture("surface", true), finish: () => core.app.endGesture("surface"),
      message: status,
    });
    ({ preview: previewActions, motion: motionActions } = services.finish());
    core.app.attach({ preview: previewActions, motion: motionActions });
    previewActions.subscribe(persist); motionActions.subscribe(persist);
    previewDevice.presentInitialLayers();
    scene.controls.addEventListener("change", persist);
    viewportDevice.headReady();
    session.setPreviewReady(); session.flush(); drawUV(); schedulePaint();
    status("Ready · independent presentation entry");
  } catch (error) {
    viewportDevice.failHead((error as Error).message);
    status(`Head preview unavailable: ${(error as Error).message}`);
    console.error(error); session.flush();
  }
}

function mount(port: StudioPresentationPort<HTMLElement>, schedulePaint: () => void) {
  port.viewport.attach("head", node("port-head-slot"));
  port.viewport.attach("uv", node("port-uv-slot"));
  for (const [kind, host] of [["head", node("port-head-host")],
    ["uv", node("port-uv-canvas")]] as const) {
    host.addEventListener("contextmenu", event => {
      event.preventDefault();
      const query = port.viewport.contextAt(kind, event.clientX, event.clientY);
      const names = query?.options.filter(option => option.capability.available).map(option => option.id) ?? [];
      status(query ? `${kind} ${query.affordance}: ${names.join(", ") || "no available actions"}` :
        `${kind}: no editable hit at this location`);
    });
  }
  port.subscribe(schedulePaint);
  window.addEventListener("resize", () => port.viewport.resize());
  paint(port);
}

function paint(port: StudioPresentationPort<HTMLElement>) {
  const state = port.snapshot(), documentState = state.authoring.document;
  const action = (value: StudioAction) => {
    const result = port.authoring.dispatch(value);
    status(result.ok ? `${value.kind} applied` : result.message);
  };
  const button = (label: string, run: () => void, available = true, reason?: string) => {
    const element = document.createElement("button"); element.textContent = label;
    element.disabled = !available; element.title = reason ?? ""; element.onclick = run; return element;
  };
  const group = (id: string, contents: Node[]) => {
    const parent = node(id); parent.replaceChildren(...contents); return parent;
  };
  const file = (label: string, command: StudioFileAction) => {
    const allowed = port.files.capability(command);
    return button(label, () => void port.files.execute(command).then(outcome => status(outcome.message)), allowed.available, allowed.reason);
  };
  const canUndo = port.authoring.capability({ kind: "recipe.undo" });
  group("port-global-actions", [button("Undo", () => action({ kind: "recipe.undo" }), canUndo.available, canUndo.reason),
    button("Front", () => action({ kind: "camera.front" }), port.authoring.capability({ kind: "camera.front" }).available),
    button("Restore removed preset", () => action({ kind: "preset.edit", command: { kind: "restore" } }), !!state.library.draft?.removed.length),
    button("Recover previous draft", () => action({ kind: "collection.undoOpen" }),
      port.authoring.capability({ kind: "collection.undoOpen" }).available),
  ]);
  group("port-collection-actions", [
    button("Add preset", () => action({ kind: "preset.edit", command: { kind: "add" } })),
    button("Save collection", () => void port.library.execute({ kind: "save" }).then(outcome => status(outcome.ok ? "Collection saved" : outcome.message))),
    button("Refresh library", () => void port.library.execute({ kind: "refresh" }).then(outcome => status(outcome.ok ? "Library refreshed" : outcome.message))),
  ]);
  group("port-library", state.library.summaries.map(summary =>
    button(`Open ${summary.name} · r${summary.revision}`, () => void port.library.execute({ kind: "open", id: summary.id })
      .then(outcome => status(outcome.ok ? `Opened ${summary.name}` : outcome.message)))));
  group("port-presets", (state.library.draft?.collection.presets ?? []).map((preset, index, presets) => {
    const row = document.createElement("div"); row.className = "row";
    const name = document.createElement("input"); name.type = "text"; name.maxLength = 120; name.value = preset.name;
    name.title = "Rename preset"; name.onchange = () => action({ kind: "preset.edit", command: { kind: "rename", id: preset.id, name: name.value } });
    row.append(button(preset.id === state.library.draft?.selected ? `● ${preset.name}` : preset.name,
      () => action({ kind: "preset.select", id: preset.id })),
      name,
      button("↑", () => action({ kind: "preset.edit", command: { kind: "move", id: preset.id, to: index - 1 } }), index > 0),
      button("↓", () => action({ kind: "preset.edit", command: { kind: "move", id: preset.id, to: index + 1 } }), index < presets.length - 1),
      button("Copy", () => action({ kind: "preset.edit", command: { kind: "copy", id: preset.id } })),
      button("Remove", () => action({ kind: "preset.edit", command: { kind: "remove", id: preset.id } })));
    return row;
  }));
  const active = documentState.recipe.layers[documentState.active];
  group("port-layers", [button("Add layer", () => action({ kind: "layer.edit", command: { kind: "add" } })),
    ...documentState.recipe.layers.map((layer, index, layers) => {
      const row = document.createElement("div"); row.className = "row";
      const name = document.createElement("input"); name.type = "text"; name.maxLength = 80; name.value = layer.name;
      name.title = "Rename layer"; name.onchange = () => action({ kind: "layer.edit", command: { kind: "rename", id: layer.id, name: name.value } });
      row.append(button(layer.id === active?.id ? `● ${layer.name}` : layer.name,
        () => action({ kind: "layer.select", layerId: layer.id })),
        name,
        button("↑", () => action({ kind: "layer.edit", command: { kind: "move", id: layer.id, to: index + 1 } }), index < layers.length - 1),
        button("↓", () => action({ kind: "layer.edit", command: { kind: "move", id: layer.id, to: index - 1 } }), index > 0),
        button(layer.enabled ? "Hide" : "Show", () => action({ kind: "layer.setEnabled", id: layer.id, enabled: !layer.enabled })),
        button("Copy", () => action({ kind: "layer.edit", command: { kind: "duplicate", id: layer.id } })),
        button("Remove", () => action({ kind: "layer.edit", command: { kind: "remove", id: layer.id } })));
      return row;
    })]);
  group("port-file-actions", [file("Open recipe", { kind: "recipe.import" }), file("Export recipe", { kind: "recipe.export" }),
    file("Import collection", { kind: "collection.import" }), file("Load saved V", { kind: "savedV.import" }),
    file("Export collection", { kind: "collection.export" }), file("Check mod export", { kind: "package.check" }),
    file("Build mod files", { kind: "package.build" })]);
  const preview = state.authoring.preview, quality = state.authoring.quality;
  const fov = document.createElement("input"); fov.type = "number"; fov.min = "10"; fov.max = "90";
  fov.value = String(preview?.camera.fov ?? 35); fov.style.width = "70px";
  fov.onchange = () => { action({ kind: "camera.setFov", degrees: Number(fov.value) }); action({ kind: "camera.endFovGesture" }); };
  group("port-head-actions", [document.createTextNode("FOV "), fov,
    button("1K", () => action({ kind: "quality.set", size: 1024 })),
    button("2K", () => action({ kind: "quality.set", size: 2048 })),
    button("Brows", () => action({ kind: "preview.setDetail", detail: "brows", enabled: !preview?.brows }), !!preview),
    button("Lashes", () => action({ kind: "preview.setDetail", detail: "lashes", enabled: !preview?.lashes }), !!preview),
    button("Hair", () => action({ kind: "preview.setHair", enabled: !preview?.hair }), !!preview),
  ]);
  group("port-uv-actions", (["both", "single", "other", "fit"] as const).map(command => {
    const allowed = port.viewport.uvCommandCapability(command);
    return button(command, () => { port.viewport.uvCommand(command); paint(port); }, allowed.available, allowed.reason);
  }));
  node("port-state").textContent = JSON.stringify({
    preset: state.library.draft?.selected, presetCount: state.library.draft?.collection.presets.length,
    layers: documentState.recipe.layers.map(layer => ({ id: layer.id, name: layer.name, enabled: layer.enabled })),
    active: documentState.active, selected: documentState.selected, history: documentState.history.length,
    viewport: state.viewport, preview, quality, motion: state.authoring.motion,
    savedV: !!state.authoring.savedV?.savedV, file: state.files.last,
    package: state.files.package,
  }, null, 2);
  node("port-actions").textContent = `${port.authoring.actionKinds().length} typed actions · ${port.authoring.requestKinds().length} requests\n` +
    port.authoring.actionKinds().join(" · ");
}
