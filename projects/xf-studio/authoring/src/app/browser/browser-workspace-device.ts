import { WorkspaceComposer, type WorkspaceCapturePorts, type WorkspaceInput } from "../workspace/workspace-composer";
import { WorkspacePersistence, type WorkspaceSaveStatus } from "../workspace/workspace-persistence";
import type { DocumentModel } from "../workspace/collection-workspace";
import { loadWorkspace, workspaceKeys, type WorkspaceState } from "../workspace/makeup-workspace";
import { loadWorkspace as loadNeutralWorkspace } from "../workspace/workspace-state";
import type { EditingComposition } from "../trusted-authoring-core";

/** Normal compatibility defaults are contributed by the primary registered feature. */
export function loadCompositionWorkspace(storage: Pick<Storage, "getItem">, verification: boolean, composition: EditingComposition) {
  const model = composition.documents;
  const owner = model.live ? composition.registry.owner(model.live) : undefined;
  const loader = (owner as { workspace?: { load: typeof loadNeutralWorkspace } } | undefined)?.workspace?.load;
  return (loader ?? loadNeutralWorkspace)(storage, verification, model);
}

type Observable = { subscribe(listener: () => void): () => void };
type EventSource = { addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void };

/** Save before publishing release, regardless of native event/microtask ordering. A refused save keeps sources alive for retry. */
export function createBrowserWorkspaceLifetime(page: Pick<Window, "addEventListener">, upstream?: AbortSignal) {
  const life = new AbortController();
  let prepare = () => true, releasing = false;
  const abort = () => {
    if (life.signal.aborted || releasing) return;
    releasing = true;
    try { if (prepare()) life.abort(); }
    finally { releasing = false; }
  };
  upstream?.addEventListener("abort", abort, { once: true });
  life.signal.addEventListener("abort", () => upstream?.removeEventListener("abort", abort), { once: true });
  page.addEventListener("pagehide", event => { if (!event.persisted) abort(); }, { signal: life.signal });
  if (upstream?.aborted) abort();
  return { signal: life.signal, abort, beforeRelease: (flush: () => boolean) => { prepare = flush; } };
}

/** The key is selected before services are built so the verification draft stays isolated. */
export function loadBrowserWorkspace(storage: Pick<Storage, "getItem">, verification: boolean, model: DocumentModel & { readonly live: string }) {
  return loadWorkspace(storage, verification, model);
}

/** Own the browser write transport and coarse event triggers; policy remains in the services. */
export function createBrowserWorkspaceSession<W extends WorkspaceInput = WorkspaceState>(options: {
  workspace: W;
  verification: boolean;
  restored: { writable: boolean; error?: string; warning?: string };
  storage: Pick<Storage, "setItem">;
  capture: WorkspaceCapturePorts<W>;
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
  /** The page lifetime; abort flushes before retiring autosave. */
  signal?: AbortSignal;
}) {
  const life = new AbortController();
  const composer = new WorkspaceComposer(options.workspace, options.capture);
  const persistence = new WorkspacePersistence({ storage: options.storage,
    key: workspaceKeys(options.verification).workspace, writable: options.restored.writable,
    restoreError: options.restored.error, restoreWarning: options.restored.warning, capture: () => composer.capture(),
    budget: options.budget, reserved: options.reserved, model: options.model, canWrite: options.canWrite });
  const request = () => persistence.request(), flush = () => persistence.flush();
  const subscriptions = new Set<() => void>([persistence.subscribe(options.onStatus)]);
  const watch = (source: Observable) => {
    if (life.signal.aborted) return () => {};
    const off = source.subscribe(() => request());
    const release = () => { if (subscriptions.delete(release)) off(); };
    subscriptions.add(release);
    return release;
  };
  const retire = () => {
    if (life.signal.aborted) return;
    persistence.retire();
    life.abort();
    for (const release of subscriptions) release();
    subscriptions.clear();
    options.signal?.removeEventListener("abort", release);
  };
  let releasing = false;
  const release = () => {
    if (life.signal.aborted) return true;
    if (releasing) return false;
    releasing = true;
    try {
      if (!flush()) return false;
      retire();
      return true;
    } finally { releasing = false; }
  };
  for (const source of options.sources) watch(source);
  options.window.addEventListener("pagehide", () => { flush(); }, { signal: life.signal });
  options.document.addEventListener("visibilitychange", () => { if (options.document.hidden) flush(); }, { signal: life.signal });
  for (const event of ["input", "change", "click"]) options.document.addEventListener(event, request, { signal: life.signal });
  options.signal?.addEventListener("abort", release, { once: true });
  if (options.signal?.aborted) release();
  return { request, flush, activate: () => persistence.activate(), release,
    /** Confirmed lease handover only: its final flush already succeeded while the lease was held. */
    retire,
    /** Add a content source created after the session (for example the collection library). */
    watch,
    setPreviewReady: () => composer.setPreviewReady(),
    snapshot: () => composer.capture(), status: () => persistence.snapshot() };
}
