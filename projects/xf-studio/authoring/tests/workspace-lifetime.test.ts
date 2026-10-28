import { afterEach, expect, jest, test } from "bun:test";
import { createBrowserWorkspaceSession } from "../src/app/browser/browser-workspace-device";
import { loadWorkspace } from "../src/app/workspace/workspace-state";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";

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
}

for (const end of ["abort", "retire", "already-aborted"] as const) test(`workspace ${end} releases subscriptions, DOM triggers and debounce without a late write`, () => {
  jest.useFakeTimers();
  const life = new AbortController(), page = new Events(), doc = new Events();
  const listeners = new Set<() => void>();
  const source = { subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  let writes = 0, statuses = 0;
  let size: 512 | 1024 = 512;
  const storage = { getItem: () => null, setItem: () => { writes++; } };
  const restored = loadWorkspace(storage, true, STUDIO_DOCUMENTS), workspace = restored.state;
  if (end === "already-aborted") life.abort();
  const session = createBrowserWorkspaceSession({ signal: life.signal, workspace, restored, storage, verification: true, model: STUDIO_DOCUMENTS,
    capture: { editor: () => ({ features: workspace.liveFeatures, history: workspace.history }),
      uvView: () => workspace.uvView, savedV: () => undefined, collections: () => undefined, quality: () => size, preview: () => undefined },
    sources: [source], window: page, document: doc, onStatus: () => { statuses++; } });
  session.activate();
  if (end !== "already-aborted") {
    expect([listeners.size, page.count(), doc.count()]).toEqual([1, 1, 4]);
    session.flush();
    expect(writes).toBe(1);
    size = 1024;
    for (const listener of listeners) listener();
    expect(jest.getTimerCount()).toBe(1);
    const off = session.watch(source);
    expect(listeners.size).toBe(2); off(); off();
    expect(listeners.size).toBe(1);
  }
  const written = writes, published = statuses;
  if (end === "abort") life.abort(); else session.retire();
  expect([listeners.size, page.count(), doc.count(), jest.getTimerCount()]).toEqual([0, 0, 0, 0]);
  session.retire(); life.abort();
  const off = session.watch(source); off();
  session.activate(); session.request(); session.flush();
  doc.hidden = true;
  for (const type of ["input", "change", "click", "visibilitychange"]) doc.emit(type);
  page.emit("pagehide"); jest.advanceTimersByTime(60_000);
  expect([writes, statuses, listeners.size, jest.getTimerCount()]).toEqual([written, published, 0, 0]);
});
