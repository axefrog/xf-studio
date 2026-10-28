import { expect, test } from "bun:test";
import { startStudio, type StudioHost } from "../src/compose/studio-startup";
import { setPageDiagnostics } from "../src/diagnostics/page-sink";
import { installLightDom, lightDocument, uninstallLightDom } from "./light-dom";
import { startDocumentOutbox } from "../src/app/browser/document-outbox-device";
import { WorkspaceLease } from "../src/app/workspace/workspace-lease";
import { memoryOutboxStorage } from "./fixtures/platform-doubles";

test("a real startup failure hands its displayed error reference to keepalive logging before abort", async () => {
  const previous = ["window", "location"].map(key => ({ key, descriptor: Object.getOwnPropertyDescriptor(globalThis, key) }));
  installLightDom();
  const elements = new Map(["studio", "device-recipe-picker", "device-collection-picker", "device-save-picker", "device-character-picker"]
    .map(id => [id, lightDocument.createElement(id.endsWith("picker") ? "input" : "div")]));
  const doc = Object.assign(Object.create(lightDocument) as typeof lightDocument, { getElementById: (id: string) => elements.get(id) ?? null });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc, writable: true });
  const requests: { url: string; init?: RequestInit }[] = [];
  let finish!: (response: Response) => void;
  const logged = new Promise<Response>(resolve => { finish = resolve; });
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); requests.push({ url, init });
    return url.endsWith("/entries") ? logged : Response.json({ mode: "normal", until: null, minutes: 30 });
  }) as typeof fetch;
  const events = new EventTarget();
  const win = { fetch: send, document: doc, navigator: { userAgent: "fixture" },
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  Object.defineProperty(globalThis, "window", { configurable: true, value: win, writable: true });
  Object.defineProperty(globalThis, "location", { configurable: true, value: { search: "?verify=1&composition=empty" }, writable: true });
  const releases: string[] = [], storage = memoryOutboxStorage();
  const lease = new WorkspaceLease({ acquire: async () => ({ generation: 1 }), takeOver: async () => ({ generation: 2 }),
    onReleaseRequested() {}, release: async () => {}, stop: async () => { releases.push("lease"); } }, { clock: { after() {} } });
  await lease.start();
  const documents = startDocumentOutbox({ workspace: "test", prefix: "/documents", lease, send,
    storage: { ...storage, write: (...args) => { releases.push("outbox"); storage.write(...args); } } });
  documents.outbox.commit("pending", [{ kind: "sample", id: "a", value: "durable" }], { store: "soon" });
  try {
    const host = { documents, lease, experiments() { throw Error("Fixture startup failed after diagnostics installation"); } } as unknown as StudioHost;
    expect(await startStudio(host)).toBeUndefined();
    const entryPosts = requests.filter(request => request.url.endsWith("/entries"));
    expect(entryPosts).toHaveLength(1);
    expect(entryPosts[0]!.init?.keepalive).toBe(true); expect(entryPosts[0]!.init?.signal).toBeUndefined();
    const entries = JSON.parse(String(entryPosts[0]!.init?.body)).entries as { code: string; ref: string }[];
    expect(entries).toHaveLength(1); expect(entries[0]!.code).toBe("start_failed");
    expect(elements.get("studio")!.textContent).toContain(entries[0]!.ref);
    expect(requests.find(request => request.url.endsWith("/state"))!.init?.signal?.aborted).toBe(true);
    expect(win.fetch).toBe(send);
    finish(new Response(null, { status: 204 })); await logged; await Promise.resolve();
    expect(entryPosts).toHaveLength(1);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(releases).toEqual(["outbox", "lease"]);
    expect(JSON.parse(storage.load().get("sample/a")!).entries[0].writes[0].value).toBe("durable");
    expect(lease.generation()).toBeNull();
  } finally {
    finish(new Response(null, { status: 204 }));
    setPageDiagnostics(null);
    await documents.stop(); await lease.stop();
    for (const { key, descriptor } of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    uninstallLightDom();
  }
});
