import { expect, test } from "bun:test";
import { CreatorCatalogueHost } from "../src/character/host/cc-catalogue-service";
import { createCreatorHandler } from "../src/character/host/cc-catalogue-server";
import { createBrowserCreatorDevice } from "../src/character/browser/browser-cc-catalogue-device";
import { CreatorCatalogue } from "../src/character/creator-catalogue";
import { CharacterContextActions } from "../src/character/character-context-actions";
import { VortexShortcutDiscovery } from "../src/installation/host/vortex-data-host";
import { fixtureSource, MOD_NAME } from "./cc-fixtures";
import { tempDir } from "./temp-dir";

async function until(check: () => boolean): Promise<void> {
  const deadline = performance.now() + 3000;
  while (!check()) {
    if (performance.now() >= deadline) throw Error("Fixture did not settle before its deadline.");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function fixture(discovery: VortexShortcutDiscovery) {
  const source = await fixtureSource(true), root = tempDir("vortex-browser-follow-");
  const host = new CreatorCatalogueHost({ route: () => ({ gameRoot: root, launchRoute: "direct", wolvenKitCli: "wk" }),
    fingerprint: () => "fixture", language: () => "en-us", resolverCache: root, shortcutDiscovery: discovery,
    open: () => ({ vortexMods: new Map([[MOD_NAME, "fixture-mod"]]) }) as never,
    makers: () => discovery.snapshot().length ? new Map([[MOD_NAME, { author: "Fixture author", name: "Fixture mod" }]]) : new Map(),
    load: async () => ({ source, catalogue: source.catalogue,
      evidence: { language: { code: "en-us", from: "default" }, texts: [], tweakDb: null, customResources: 1 } }) });
  await host.ensure("female");
  const handler = createCreatorHandler(host);
  let panels = 0, follows = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 10, fetch: request => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.searchParams.get("follow") === "1") follows++;
    else if (request.method === "GET" && url.searchParams.size === 1) panels++;
    return handler(request);
  } });
  const base = `http://127.0.0.1:${server.port}`;
  const device = createBrowserCreatorDevice((url, init) => fetch(base + url, { ...init, headers: { ...init?.headers, Origin: base } }));
  const catalogue = new CreatorCatalogue({ ...device, wait: async (_ms, signal) => {
    signal.throwIfAborted(); await new Promise(resolve => setTimeout(resolve, 5));
  } });
  return { host, catalogue, panels: () => panels, follows: () => follows, close: async () => {
    discovery.stop(); await discovery.settled; await server.stop(true);
  } };
}

test("late shortcut completion reaches an already ready browser panel through the state endpoint", async () => {
  let complete!: (rows: { target: string; arguments: string }[]) => void;
  const discovery = new VortexShortcutDiscovery(async () => new Promise(resolve => { complete = resolve; }));
  const f = await fixture(discovery);
  const context = new CharacterContextActions({ catalogue: f.catalogue, requester: "late", showSave: () => {} });
  try {
    context.start();
    await until(() => context.snapshot().phase === "ready" && discovery.requesters === 1);
    const identity = context.panel()!.identity;
    expect(context.panel()!.groups.some(group => group.label === "Fixture author")).toBe(false);
    expect(f.catalogue.identity("female")).toBe(""); // Ready, but pending evidence is not final in the browser cache.
    const panels = f.panels();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(f.panels()).toBe(panels); // The ready panel has stopped its preparation polling.
    expect(f.follows()).toBe(1);
    complete([{ target: "C:/Fixture/App/Vortex.exe", arguments: "--user-data C:/Fixture/Data" }]);
    await until(() => context.snapshot().phase === "ready" && context.panel()!.identity !== identity);
    expect(context.panel()!.groups.some(group => group.label === "Fixture author")).toBe(true);
    expect(f.catalogue.identity("female")).toBe(context.panel()!.identity);
    expect(discovery.requesters).toBe(0);
    expect(discovery.completed).toBe(true);
    expect(f.follows()).toBe(1);
  } finally { context.dispose(); await f.close(); }
});

test("the production browser releases its follow request on disposal; the last consumer aborts the sweep", async () => {
  let stopped = false;
  const discovery = new VortexShortcutDiscovery(async (_env, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { stopped = true; reject(signal.reason); }, { once: true });
  }));
  const f = await fixture(discovery);
  const first = new CharacterContextActions({ catalogue: f.catalogue, requester: "first", showSave: () => {} });
  const second = new CharacterContextActions({ catalogue: f.catalogue, requester: "second", showSave: () => {} });
  try {
    first.start(); second.start();
    await until(() => first.snapshot().phase === "ready" && second.snapshot().phase === "ready" && discovery.requesters === 1);
    expect(f.follows()).toBe(1); // The browser shares the HTTP question, retaining each context's own want.
    first.dispose();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(discovery.requesters).toBe(1);
    expect(stopped).toBe(false);
    second.dispose();
    await until(() => stopped && discovery.requesters === 0);
    await discovery.settled;
    expect(discovery.completed).toBe(false);
  } finally { first.dispose(); second.dispose(); await f.close(); }
});
