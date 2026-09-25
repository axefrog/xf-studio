import { WorkspaceComposer, type WorkspaceCapturePorts } from "./workspace-composer";
import { WorkspacePersistence, type WorkspaceSaveStatus } from "./workspace-persistence";
import { loadWorkspace, workspaceKeys, type WorkspaceState } from "./workspace-state";

type Observable = { subscribe(listener: () => void): () => void };
type EventSource = { addEventListener(type: string, listener: EventListener): void };

/** The key is selected before services are built so the verification draft stays isolated. */
export function loadBrowserWorkspace(storage: Pick<Storage, "getItem">, verification: boolean) {
  return loadWorkspace(storage, verification);
}

/** Capture the current panel geometry through passed elements, not fixed control IDs. */
export function captureBrowserPanels(options: {
  sidebar(): Pick<WorkspaceState["panels"], "sidebarLeft" | "sidebarRight">;
  lighting: Pick<HTMLDetailsElement, "open">;
  previewQuality: Pick<HTMLDetailsElement, "open">;
  layers: Pick<HTMLElement, "scrollTop">;
  properties: Pick<HTMLElement, "scrollTop">;
  page: Pick<Window, "scrollX" | "scrollY">;
}): WorkspaceState["panels"] {
  return { ...options.sidebar(), lighting: options.lighting.open,
    previewQuality: options.previewQuality.open,
    layersScroll: options.layers.scrollTop, propertiesScroll: options.properties.scrollTop,
    pageX: options.page.scrollX, pageY: options.page.scrollY };
}

/** Own the browser write transport and coarse event triggers; policy remains in the services. */
export function createBrowserWorkspaceSession(options: {
  workspace: WorkspaceState;
  verification: boolean;
  restored: { writable: boolean; error?: string; warning?: string };
  storage: Pick<Storage, "setItem">;
  capture: WorkspaceCapturePorts;
  /**
   * Domain and content sources whose changes need saving. Never pass the whole presentation
   * port: it also carries the save status itself, and a save must not request another save.
   */
  sources: Observable[];
  window: EventSource;
  document: EventSource & { hidden: boolean };
  scrollTargets: EventSource[];
  toggleTargets: EventSource[];
  onStatus(status: WorkspaceSaveStatus): void;
  /** Serialized size budget; the desktop host file allows more than browser storage. */
  budget?: number;
}) {
  const composer = new WorkspaceComposer(options.workspace, options.capture);
  const persistence = new WorkspacePersistence({ storage: options.storage,
    key: workspaceKeys(options.verification).workspace, writable: options.restored.writable,
    restoreError: options.restored.error, restoreWarning: options.restored.warning, capture: () => composer.capture(),
    budget: options.budget });
  persistence.subscribe(options.onStatus);
  for (const source of options.sources) source.subscribe(() => persistence.request());
  const request = () => persistence.request(), flush = () => persistence.flush();
  options.window.addEventListener("pagehide", flush);
  options.window.addEventListener("scroll", request);
  options.document.addEventListener("visibilitychange", () => { if (options.document.hidden) flush(); });
  for (const event of ["input", "change", "click"]) options.document.addEventListener(event, request);
  for (const target of options.scrollTargets) target.addEventListener("scroll", request);
  for (const target of options.toggleTargets) target.addEventListener("toggle", request);
  return { request, flush, activate: () => persistence.activate(),
    /** Add a content source created after the session (for example the collection library). */
    watch: (source: Observable) => source.subscribe(request),
    setPreviewReady: () => composer.setPreviewReady(),
    snapshot: () => composer.capture(), status: () => persistence.snapshot() };
}
