import { WorkspaceComposer, type WorkspaceCapturePorts } from "../workspace/workspace-composer";
import { WorkspacePersistence, type WorkspaceSaveStatus } from "../workspace/workspace-persistence";
import type { DocumentModel } from "../workspace/collection-workspace";
import { loadWorkspace, workspaceKeys, type WorkspaceState } from "../workspace/workspace-state";

type Observable = { subscribe(listener: () => void): () => void };
type EventSource = { addEventListener(type: string, listener: EventListener): void };

/** The key is selected before services are built so the verification draft stays isolated. */
export function loadBrowserWorkspace(storage: Pick<Storage, "getItem">, verification: boolean, model: DocumentModel) {
  return loadWorkspace(storage, verification, model);
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
  onStatus(status: WorkspaceSaveStatus): void;
  /** Serialized size budget; the desktop host file allows more than browser storage. */
  budget?: number;
  /** What else in the same storage counts against the budget now (the outbox's keys, profiles design §2.2). */
  reserved?: () => number;
  /** The document model the workspace is stored with (from the composition root). */
  model: DocumentModel;
  /** Whether this window may write its workspace now (the workspace lease); always, without one. */
  canWrite?: () => boolean;
}) {
  const composer = new WorkspaceComposer(options.workspace, options.capture);
  const persistence = new WorkspacePersistence({ storage: options.storage,
    key: workspaceKeys(options.verification).workspace, writable: options.restored.writable,
    restoreError: options.restored.error, restoreWarning: options.restored.warning, capture: () => composer.capture(),
    budget: options.budget, reserved: options.reserved, model: options.model, canWrite: options.canWrite });
  persistence.subscribe(options.onStatus);
  for (const source of options.sources) source.subscribe(() => persistence.request());
  const request = () => persistence.request(), flush = () => persistence.flush();
  options.window.addEventListener("pagehide", () => { flush(); });
  options.document.addEventListener("visibilitychange", () => { if (options.document.hidden) flush(); });
  for (const event of ["input", "change", "click"]) options.document.addEventListener(event, request);
  return { request, flush, activate: () => persistence.activate(), retire: () => persistence.retire(),
    /** Add a content source created after the session (for example the collection library). */
    watch: (source: Observable) => source.subscribe(request),
    setPreviewReady: () => composer.setPreviewReady(),
    snapshot: () => composer.capture(), status: () => persistence.snapshot() };
}
