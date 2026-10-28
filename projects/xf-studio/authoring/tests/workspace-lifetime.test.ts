import { afterEach, expect, jest, test } from "bun:test";
import { createBrowserWorkspaceLifetime, createBrowserWorkspaceSession } from "../src/app/browser/browser-workspace-device";
import { loadWorkspace } from "../src/app/workspace/workspace-state";
import { loadWorkspace as loadMakeupWorkspace } from "../src/app/workspace/makeup-workspace";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { profileStudio } from "./fixtures/profile-studio";
import { lookRef } from "../src/library/collection-documents";

afterEach(() => jest.useRealTimers());

/** Count the browser's signal-bound listeners without ending the document. */
class Events {
  hidden = false;
  private listeners = new Map<string, Set<EventListener>>();
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions) {
    if (options?.signal?.aborted) return;
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    this.listeners.set(type, listeners); listeners.add(listener);
    options?.signal?.addEventListener("abort", () => listeners.delete(listener), { once: true });
  }
  count() { return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0); }
  emit(type: string) { for (const listener of this.listeners.get(type) ?? []) listener(new Event(type)); }
  async nativePagehide() {
    const listeners = this.listeners.get("pagehide") ?? new Set<EventListener>();
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) listener(Object.assign(new Event("pagehide"), { persisted: false }));
      // Model a native microtask checkpoint between callbacks, unlike synchronous dispatchEvent.
      await Promise.resolve();
    }
  }
}

for (const end of ["abort", "release", "pagehide", "upstream", "already-aborted"] as const) test(`workspace ${end} saves pending work before releasing sources and debounce`, async () => {
  jest.useFakeTimers();
  const upstream = new AbortController(), page = new Events(), doc = new Events();
  if (end === "already-aborted") upstream.abort();
  const life = createBrowserWorkspaceLifetime(page as unknown as Pick<Window, "addEventListener">, upstream.signal);
  const listeners = new Set<() => void>();
  const source = { subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  let writes = 0, statuses = 0, disposed = false, commits = 0;
  let size: 512 | 1024 = 512;
  const stored = new Map<string, string>(), writeAfterAbort: boolean[] = [];
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => {
    writeAfterAbort.push(life.signal.aborted); stored.set(key, value); writes++;
  } };
  const restored = loadWorkspace(storage, true, STUDIO_DOCUMENTS), workspace = restored.state;
  const session = createBrowserWorkspaceSession({ signal: life.signal, workspace, restored, storage, verification: true, model: STUDIO_DOCUMENTS,
    capture: { editor: () => { if (disposed) throw Error("Capture source was disposed before saving"); return { features: workspace.liveFeatures, history: workspace.history }; },
      uiPreferences: () => workspace.uiPreferences, uvView: () => workspace.uvView, savedV: () => undefined,
      collections: () => undefined, quality: () => size, preview: () => undefined },
    sources: [source], window: page, document: doc, onStatus: () => { statuses++; } });
  life.beforeRelease(() => { commits++; return session.release(); });
  life.signal.addEventListener("abort", () => { disposed = true; }, { once: true });
  session.activate();
  if (end !== "already-aborted") {
    expect([listeners.size, page.count(), doc.count()]).toEqual([1, 2, 4]);
    session.flush();
    expect(writes).toBe(1);
    size = 1024;
    workspace.uiPreferences.theme = "dark";
    workspace.uiPreferences.layout = { format: "fixture", version: 1, state: { ratio: .7 } };
    for (const listener of listeners) listener();
    expect(jest.getTimerCount()).toBe(1);
    const off = session.watch(source);
    expect(listeners.size).toBe(2); off(); off();
    expect(listeners.size).toBe(1);
  }
  if (end === "pagehide") await page.nativePagehide();
  else if (end === "upstream") upstream.abort();
  else if (end === "release") expect(session.release()).toBe(true);
  else life.abort();
  life.abort();
  if (end !== "already-aborted") {
    expect(writes).toBe(2); expect(commits).toBe(1);
    const saved = loadWorkspace(storage, true, STUDIO_DOCUMENTS).state;
    expect(saved.preview.textureSize).toBe(1024);
    expect(saved.uiPreferences).toMatchObject({ theme: "dark", layout: { state: { ratio: .7 } } });
    expect(writeAfterAbort).toEqual([false, false]);
  } else expect(writes).toBe(0);
  const written = writes, published = statuses;
  expect([listeners.size, page.count(), doc.count(), jest.getTimerCount()]).toEqual([0, 0, 0, 0]);
  session.retire(); life.abort();
  const off = session.watch(source); off();
  session.activate(); session.request(); session.flush();
  doc.hidden = true;
  for (const type of ["input", "change", "click", "visibilitychange"]) doc.emit(type);
  page.emit("pagehide"); jest.advanceTimersByTime(60_000);
  expect([writes, statuses, listeners.size, jest.getTimerCount()]).toEqual([written, published, 0, 0]);
});

for (const end of ["abort", "upstream"] as const) test(`read-only workspace ${end} releases its lifetime without capturing or writing`, () => {
  jest.useFakeTimers();
  const upstream = new AbortController(), page = new Events(), doc = new Events();
  const life = createBrowserWorkspaceLifetime(page as unknown as Pick<Window, "addEventListener">, upstream.signal);
  let writable = false, writes = 0, captures = 0, statuses = 0, disposed = false;
  const storage = { getItem: () => null, setItem: () => { writes++; } };
  const restored = loadWorkspace(storage, true, STUDIO_DOCUMENTS), workspace = restored.state;
  const listeners = new Set<() => void>();
  const source = { subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const session = createBrowserWorkspaceSession({ signal: life.signal, workspace, restored, storage, verification: true, model: STUDIO_DOCUMENTS,
    canWrite: () => writable,
    capture: { editor: () => { captures++; return { features: workspace.liveFeatures, history: workspace.history }; },
      uvView: () => workspace.uvView, savedV: () => undefined, collections: () => undefined, quality: () => 1024, preview: () => undefined },
    sources: [source], window: page, document: doc, onStatus: () => { statuses++; } });
  life.beforeRelease(session.release);
  life.signal.addEventListener("abort", () => { disposed = true; }, { once: true });
  session.activate();
  for (const listener of listeners) listener();
  expect([listeners.size, page.count(), doc.count(), jest.getTimerCount()]).toEqual([1, 2, 4, 0]);
  if (end === "upstream") upstream.abort(); else life.abort();
  expect([life.signal.aborted, disposed]).toEqual([true, true]);
  expect([listeners.size, page.count(), doc.count(), jest.getTimerCount(), captures, writes, statuses]).toEqual([0, 0, 0, 0, 0, 0, 0]);
  // Retirement stays final even if the lease later becomes writable.
  writable = true;
  session.activate(); session.request(); session.flush(); session.watch(source)();
  doc.hidden = true;
  for (const type of ["input", "change", "click", "visibilitychange"]) doc.emit(type);
  page.emit("pagehide"); life.abort(); expect(session.release()).toBe(true);
  jest.advanceTimersByTime(60_000);
  expect([listeners.size, jest.getTimerCount(), captures, writes, statuses]).toEqual([0, 0, 0, 0, 0]);
});

for (const end of ["abort", "upstream"] as const) test(`dirty workspace ${end} after lease loss preserves state and recovery export without writing`, async () => {
  const studio = await profileStudio();
  await studio.collection.initialize(); await studio.settle();
  jest.useFakeTimers();
  const upstream = new AbortController(), page = new Events(), doc = new Events();
  const life = createBrowserWorkspaceLifetime(page as unknown as Pick<Window, "addEventListener">, upstream.signal);
  let writable = true, writes = 0, disposed = false;
  const transact = studio.port.transact;
  studio.port.transact = request => writable ? transact(request) : Promise.resolve({ ok: false, reason: "superseded" });
  const ref = lookRef(studio.scene.look()!), storedLook = JSON.stringify(studio.library.documents.read([ref]));
  const storage = { getItem: () => null, setItem: () => { writes++; } };
  const restored = loadMakeupWorkspace(storage, true, STUDIO_DOCUMENTS), workspace = restored.state;
  const listeners = new Set<() => void>();
  const source = { subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const session = createBrowserWorkspaceSession({ signal: life.signal, workspace, restored, storage, verification: true, model: STUDIO_DOCUMENTS,
    canWrite: () => writable,
    capture: { editor: () => { if (disposed) throw Error("Capture source was released"); return studio.document.export(); },
      uiPreferences: () => workspace.uiPreferences, uvView: () => workspace.uvView, savedV: () => undefined,
      collections: () => undefined, quality: () => workspace.preview.textureSize, preview: () => undefined },
    sources: [source, studio.document], window: page, document: doc, onStatus() {} });
  life.beforeRelease(() => { studio.lookEditor.commit(); return session.release(); });
  life.signal.addEventListener("abort", () => { disposed = true; studio.files.dispose(); studio.lookEditor.dispose(); }, { once: true });
  try {
    session.activate();
    workspace.uiPreferences.theme = "dark";
    workspace.uiPreferences.layout = { format: "fixture", version: 1, state: { ratio: .7 } };
    for (const listener of listeners) listener();
    expect(jest.getTimerCount()).toBe(1);
    expect(studio.app.dispatch({ kind: "layer.setOpacity", layerId: studio.document.recipe.layers[0]!.id, opacity: .37 }).ok).toBe(true);
    writable = false;
    if (end === "upstream") upstream.abort(); else life.abort();
    expect([life.signal.aborted, disposed, writes, listeners.size, page.count(), doc.count()]).toEqual([false, false, 0, 1, 2, 4]);
    expect(session.snapshot().uiPreferences).toMatchObject({ theme: "dark", layout: { state: { ratio: .7 } } });
    // Expiring a denied debounce must not make the owned changes clean or permit a later release.
    jest.advanceTimersByTime(200); life.abort(); expect(session.release()).toBe(false);
    expect([life.signal.aborted, disposed, writes]).toEqual([false, false, 0]);
    expect(studio.files.capability({ kind: "collection.exportWindowCopy" }).available).toBe(true);
    const copy = studio.collection.service.exportWindowCopy();
    expect(copy.json.replace(/\s/g, "")).toContain('"opacity":0.37');
    expect(JSON.stringify(studio.library.documents.read([ref]))).toBe(storedLook);
    expect(session.snapshot().uiPreferences).toMatchObject({ theme: "dark", layout: { state: { ratio: .7 } } });
    expect(writes).toBe(0);
    writable = true; life.abort();
    expect([life.signal.aborted, disposed, writes, listeners.size, page.count(), doc.count()]).toEqual([true, true, 1, 0, 0, 0]);
  } finally {
    studio.outbox.stop(); session.retire(); studio.files.dispose(); studio.lookEditor.dispose(); studio.collection.dispose(); studio.library.close();
  }
});

for (const end of ["abort", "upstream"] as const) test(`an unchanged document-click request permits ${end} after lease loss`, () => {
  jest.useFakeTimers();
  const upstream = new AbortController(), page = new Events(), doc = new Events();
  const life = createBrowserWorkspaceLifetime(page as unknown as Pick<Window, "addEventListener">, upstream.signal);
  let writable = true, writes = 0, captures = 0, disposed = false;
  const storage = { getItem: () => null, setItem: () => { writes++; } };
  const restored = loadWorkspace(storage, true, STUDIO_DOCUMENTS), workspace = restored.state;
  const listeners = new Set<() => void>();
  const source = { subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const session = createBrowserWorkspaceSession({ signal: life.signal, workspace, restored, storage, verification: true, model: STUDIO_DOCUMENTS,
    canWrite: () => writable,
    capture: { editor: () => { if (disposed) throw Error("Capture source was released"); captures++; return { features: workspace.liveFeatures, history: workspace.history }; },
      uvView: () => workspace.uvView, savedV: () => undefined, collections: () => undefined, quality: () => 1024, preview: () => undefined },
    sources: [source], window: page, document: doc, onStatus() {} });
  life.beforeRelease(session.release);
  life.signal.addEventListener("abort", () => { disposed = true; }, { once: true });
  session.activate(); expect(session.flush()).toBe(true);
  doc.emit("click"); expect(jest.getTimerCount()).toBe(1);
  writable = false;
  if (end === "upstream") upstream.abort(); else life.abort();
  expect([life.signal.aborted, disposed, captures, writes]).toEqual([true, true, 2, 1]);
  expect([listeners.size, page.count(), doc.count(), jest.getTimerCount()]).toEqual([0, 0, 0, 0]);
  jest.advanceTimersByTime(200); life.abort();
  expect([captures, writes]).toEqual([2, 1]);
});

for (const state of ["unchanged", "drained"] as const) test(`a formerly writable workspace retires after lease loss when ${state}`, () => {
  jest.useFakeTimers();
  const page = new Events(), doc = new Events(), life = createBrowserWorkspaceLifetime(page as unknown as Pick<Window, "addEventListener">);
  let writable = true, writes = 0, captures = 0;
  const storage = { getItem: () => null, setItem: () => { writes++; } };
  const restored = loadWorkspace(storage, true, STUDIO_DOCUMENTS), workspace = restored.state;
  const session = createBrowserWorkspaceSession({ signal: life.signal, workspace, restored, storage, verification: true, model: STUDIO_DOCUMENTS,
    canWrite: () => writable,
    capture: { editor: () => { captures++; return { features: workspace.liveFeatures, history: workspace.history }; },
      uvView: () => workspace.uvView, savedV: () => undefined, collections: () => undefined, quality: () => 1024, preview: () => undefined },
    sources: [], window: page, document: doc, onStatus() {} });
  life.beforeRelease(session.release); session.activate();
  if (state === "drained") { workspace.uiPreferences.theme = "dark"; session.request(); expect(session.flush()).toBe(true); }
  const beforeLoss = [captures, writes];
  writable = false; life.abort();
  expect(life.signal.aborted).toBe(true);
  expect([captures, writes]).toEqual(beforeLoss);
  expect([page.count(), doc.count(), jest.getTimerCount()]).toEqual([0, 0, 0]);
});

test("a refused final workspace save keeps the lifetime and capture sources alive for retry", () => {
  jest.useFakeTimers();
  const page = new Events(), doc = new Events(), life = createBrowserWorkspaceLifetime(page as unknown as Pick<Window, "addEventListener">);
  let refused = true, writable = true, writes = 0, disposed = false;
  const storage = { getItem: () => null, setItem: () => { if (refused) throw Error("Storage temporarily unavailable"); writes++; } };
  const restored = loadWorkspace(storage, true, STUDIO_DOCUMENTS), workspace = restored.state;
  const session = createBrowserWorkspaceSession({ signal: life.signal, workspace, restored, storage, verification: true, model: STUDIO_DOCUMENTS,
    canWrite: () => writable,
    capture: { editor: () => { if (disposed) throw Error("Released too early"); return { features: workspace.liveFeatures, history: workspace.history }; },
      uvView: () => workspace.uvView, savedV: () => undefined, collections: () => undefined, quality: () => 1024, preview: () => undefined },
    sources: [], window: page, document: doc, onStatus() {} });
  life.beforeRelease(session.release);
  life.signal.addEventListener("abort", () => { disposed = true; }, { once: true });
  // No debounce request: a failed explicit capture/write must itself retain ownership of unsaved work.
  session.activate(); life.abort();
  expect([life.signal.aborted, disposed, writes]).toEqual([false, false, 0]);
  expect(session.status().kind).toBe("unavailable"); expect(doc.count()).toBe(4);
  writable = false; life.abort();
  expect([life.signal.aborted, disposed, writes, doc.count()]).toEqual([false, false, 0, 4]);
  refused = false; writable = true; life.abort();
  expect([life.signal.aborted, disposed, writes, doc.count(), jest.getTimerCount()]).toEqual([true, true, 1, 0, 0]);
});
