import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INITIAL_LEASE, LEASE_MESSAGES, leaseTransition, WorkspaceLease, type LeaseClock, type WorkspaceLeaseAdapter } from "../src/app/workspace/workspace-lease";
import { leasedDocuments } from "../src/app/workspace/leased-documents";
import { WorkspacePersistence } from "../src/app/workspace/workspace-persistence";
import { savedDocument } from "../src/platform/core/saved-document";
import { formatFence, parseFence, WORKSPACE_FENCE_HEADER, type DocumentStorePort, type DocumentWrite } from "../src/platform/api/document-store";
import { browserDocuments } from "../src/app/browser/browser-documents-device";
import { openLibraryFiles } from "../src/library/host/library-files";
import { hostClock } from "../src/platform/core/clock";
import { STUDIO_DOCUMENTS, STUDIO_PARTS } from "../src/compose/studio-registry";
import { freshWorkspace } from "./fixtures/eye-region";
import { trustedFixture } from "./studio-presentation-fixture";

/** A simulated clock: timers run when `advance` passes them. */
function simulatedClock() {
  let now = 0;
  const timers: { at: number; run: () => void; signal?: AbortSignal }[] = [];
  const clock: LeaseClock = { after: (ms, run, signal) => { timers.push({ at: now + ms, run, signal }); } };
  return { clock, advance(ms: number) {
    now += ms;
    for (const timer of timers.splice(0).sort((a, b) => a.at - b.at))
      if (timer.at <= now) { if (!timer.signal?.aborted) timer.run(); } else timers.push(timer);
  } };
}

/** An adapter the test drives: the lease is held elsewhere until `held` is false; a takeover waits for `grant`. */
function scriptedAdapter(held: boolean) {
  const calls: string[] = [];
  let asked = () => {}, grant: ((generation: number) => void) | null = null;
  const adapter: WorkspaceLeaseAdapter = {
    acquire: async () => held ? null : { generation: 1 },
    takeOver: signal => new Promise((resolve, reject) => {
      calls.push("takeOver");
      grant = generation => resolve({ generation });
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    onReleaseRequested: listener => { asked = listener; },
    release: async () => { calls.push("release"); },
  };
  return { adapter, calls, ask: () => asked(), grant: (generation: number) => grant?.(generation) };
}

test("the lease's transitions: one holder, release only on request, takeover only by grant", () => {
  const held = leaseTransition(INITIAL_LEASE, { kind: "acquired", generation: 3 });
  expect(held).toEqual({ phase: "holder", generation: 3 });
  // Nothing takes the lease from a holder but its own release.
  expect(leaseTransition(held, { kind: "granted", generation: 4 })).toBe(held);
  expect(leaseTransition(held, { kind: "takeover-requested" })).toBe(held);
  const releasing = leaseTransition(held, { kind: "release-requested" });
  expect(releasing).toEqual({ phase: "releasing", generation: 3 });
  expect(leaseTransition(releasing, { kind: "released" })).toEqual({ phase: "read-only", generation: null });
  const readOnly = leaseTransition(INITIAL_LEASE, { kind: "held-elsewhere" });
  // A grant only answers a takeover; time alone never moves a read-only window on.
  expect(leaseTransition(readOnly, { kind: "granted", generation: 2 })).toBe(readOnly);
  expect(leaseTransition(readOnly, { kind: "grace-elapsed" })).toBe(readOnly);
  const asking = leaseTransition(readOnly, { kind: "takeover-requested" });
  const waiting = leaseTransition(asking, { kind: "grace-elapsed" });
  expect(waiting.phase).toBe("waiting");
  expect(leaseTransition(waiting, { kind: "granted", generation: 5 })).toEqual({ phase: "taken-over", generation: 5 });
});

test("a read-only window refuses, says so, takes over after the grace with the waiting message, and is granted only by the adapter", async () => {
  const time = simulatedClock(), script = scriptedAdapter(true);
  const lease = new WorkspaceLease(script.adapter, { clock: time.clock, graceMs: 1000 });
  expect(lease.refusal()?.reason).toBe(LEASE_MESSAGES.starting);
  await lease.start();
  expect(lease.snapshot()).toEqual({ phase: "read-only", writable: false, message: LEASE_MESSAGES.readOnly, canTakeOver: true, refusal: LEASE_MESSAGES.refused });
  expect(lease.refusal()).toEqual({ available: false, code: "unavailable", reason: LEASE_MESSAGES.refused });
  expect(lease.capability({ kind: "workspace.takeOver" }).available).toBe(true);
  const taking = lease.dispatch({ kind: "workspace.takeOver" });
  expect(lease.snapshot().message).toBe(LEASE_MESSAGES.takingOver);
  expect(lease.capability({ kind: "workspace.takeOver" })).toMatchObject({ available: false, code: "busy" });
  time.advance(999);
  expect(lease.snapshot().phase).toBe("taking-over");
  time.advance(1);
  expect(lease.snapshot().message).toBe(LEASE_MESSAGES.waiting);
  // A hung holder: however long it takes, nothing moves until the adapter grants.
  time.advance(3_600_000);
  expect(lease.snapshot().phase).toBe("waiting");
  script.grant(7);
  expect(await taking).toEqual({ ok: true });
  expect(lease.snapshot().phase).toBe("taken-over");
  expect(lease.generation()).toBeNull();
});

test("the holder refuses edits at once, runs its release steps in order while it may still write, then releases", async () => {
  const time = simulatedClock(), script = scriptedAdapter(false), order: string[] = [];
  const lease = new WorkspaceLease(script.adapter, { clock: time.clock });
  await lease.start();
  expect(lease.writable()).toBe(true);
  expect(lease.refusal()).toBeUndefined();
  let drained!: () => void;
  lease.onRelease(() => { order.push(`drain:${lease.writable()}:${lease.draining()}:${lease.generation()}`); return new Promise<void>(resolve => { drained = resolve; }); });
  lease.onRelease(() => { order.push("last write"); });
  script.ask();
  // Edits stop at once, before any step has finished.
  expect(lease.snapshot().phase).toBe("releasing");
  expect(lease.refusal()?.code).toBe("unavailable");
  expect(order).toEqual(["drain:false:true:1"]);
  expect(script.calls).toEqual([]);
  // A second request joins the release in progress.
  script.ask();
  drained();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(order).toEqual(["drain:false:true:1", "last write"]);
  expect(script.calls).toEqual(["release"]);
  expect(lease.snapshot()).toMatchObject({ phase: "read-only", canTakeOver: true });
  expect(lease.draining()).toBe(false);
});

test("the document store behind the lease drains writes in flight (and the one chained behind them), then sends nothing", async () => {
  const sent: string[] = [];
  let open = true;
  const answers: (() => void)[] = [];
  const store: DocumentStorePort = {
    list: async () => [],
    put: <T>(kind: string, id: string, value: T, revision: number) => new Promise<DocumentWrite<T>>(resolve => {
      sent.push(JSON.stringify(value));
      answers.push(() => resolve({ ok: true, document: { kind, id, revision: revision + 1, value, updatedAt: 0 } }));
    }),
  };
  const leased = leasedDocuments(store, { draining: () => open });
  const doc = savedDocument(leased, "sample", "a", 0);
  void doc.save(1);
  await Promise.resolve(); await Promise.resolve();
  void doc.save(2);
  void doc.save(3);
  let done = false;
  const drained = leased.drain().then(() => { done = true; });
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(done).toBe(false);
  answers.shift()!();
  await new Promise(resolve => setTimeout(resolve, 5));
  // The coalesced save (3) went out after the first settled; the drain waits for it too.
  expect(sent).toEqual(["1", "3"]);
  expect(done).toBe(false);
  answers.shift()!();
  await drained;
  expect(leased.pending()).toBe(0);
  open = false;
  await expect(doc.save(4)).rejects.toThrow("now open elsewhere");
  expect(sent).toEqual(["1", "3"]);
});

test("autosave writes nothing while read-only, and its retirement writes once more and then never again", () => {
  const writes: string[] = [];
  let can = false, edits = 0;
  const workspace = freshWorkspace();
  const persistence = new WorkspacePersistence({ storage: { setItem: (_key, value) => writes.push(value) }, key: "k", writable: true,
    capture: () => { workspace.recipe.layers[0].opacity = ++edits / 100; return workspace; }, model: STUDIO_DOCUMENTS,
    canWrite: () => can });
  persistence.activate();
  persistence.flush();
  expect(writes).toHaveLength(0);
  can = true;
  persistence.flush();
  expect(writes).toHaveLength(1);
  persistence.retire();
  expect(writes).toHaveLength(2);
  persistence.activate(); persistence.request(); persistence.flush();
  expect(writes).toHaveLength(2);
});

test("a read-only window refuses every dispatch with unavailable, keeps reads, and Use it here is the one action offered", async () => {
  const time = simulatedClock(), script = scriptedAdapter(true);
  const lease = new WorkspaceLease(script.adapter, { clock: time.clock });
  await lease.start();
  const { shell } = trustedFixture({ lease });
  const layers = shell.snapshot().authoring.document.recipe.layers.length;
  const refused = { ok: false, code: "unavailable", message: LEASE_MESSAGES.refused };
  expect(shell.authoring.capability({ kind: "layer.edit", command: { kind: "add" } })).toMatchObject({ available: false, code: "unavailable" });
  expect(shell.authoring.dispatch({ kind: "layer.edit", command: { kind: "add" } })).toEqual(refused);
  expect(shell.snapshot().authoring.document.recipe.layers).toHaveLength(layers);
  expect(shell.authoring.controlBegin("opacity", shell.snapshot().authoring.document.recipe.layers[0].id)).toBe(false);
  expect(shell.authoring.canBeginGesture("uv", shell.snapshot().authoring.document.recipe.layers[0].id).code).toBe("unavailable");
  expect(shell.feature("eye-makeup").dispatch({ kind: "layer.edit", command: { kind: "add" } } as never)).toEqual(refused);
  expect(await shell.library.execute({ kind: "save" })).toMatchObject({ ok: false, code: "unavailable" });
  expect(await shell.files.execute({ kind: "recipe.export" } as never)).toMatchObject({ ok: false, code: "unavailable" });
  expect(await shell.presets.execute({ kind: "partPreset.save", feature: "eye-makeup", name: "x" } as never)).toMatchObject({ ok: false, code: "unavailable" });
  expect(await shell.localSetup.dispatch({ kind: "setup.refresh" })).toMatchObject({ ok: false, code: "unavailable" });
  expect(await shell.modInstall.dispatch({ kind: "install.refresh" } as never)).toMatchObject({ ok: false, code: "unavailable" });
  expect(await shell.updates.dispatch({ kind: "updates.check" })).toMatchObject({ ok: false, code: "unavailable" });
  // The header's Save is unavailable with the lease's reason, as every other editing command is.
  expect(shell.authoring.requestCapability({ kind: "save" })).toEqual({ available: false, code: "unavailable", reason: LEASE_MESSAGES.refused });
  // Reads stay: the library list loads.
  expect(shell.authoring.requestCapability({ kind: "refresh" }).code).not.toBe("unavailable");
  expect(shell.workspace.snapshot()).toMatchObject({ phase: "read-only", canTakeOver: true });
  expect(shell.workspace.capability({ kind: "workspace.takeOver" }).available).toBe(true);
  expect(Object.keys(shell.workspace.descriptors())).toEqual(["workspace.takeOver"]);
});

test("the window that holds its workspace behaves as before", async () => {
  const lease = new WorkspaceLease(scriptedAdapter(false).adapter, { clock: simulatedClock().clock });
  await lease.start();
  const { shell } = trustedFixture({ lease });
  expect(shell.authoring.dispatch({ kind: "layer.edit", command: { kind: "add" } }).ok).toBe(true);
  expect(shell.workspace.snapshot()).toMatchObject({ phase: "holder", writable: true, message: "" });
  expect(trustedFixture().shell.workspace.snapshot().writable).toBe(true);
});

test("the host fences document writes by lease generation, in the write's own transaction, and issues generations that survive a restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-lease-")), clock = hostClock();
  try {
    let files = openLibraryFiles(root, { clock, parts: STUDIO_PARTS, isolated: true });
    const handle = (request: Request) => files.handle(request)!;
    const send = (url: string, init?: RequestInit) => handle(new Request(`http://127.0.0.1${url}`, { ...init,
      headers: { Origin: "http://127.0.0.1", ...(init?.headers as Record<string, string>) } }));
    const issue = async (workspace: string) => (await (await send("/api/workspace-lease", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace }) })).json() as { generation: number }).generation;
    expect(await issue("browser-a")).toBe(1);
    let generation = 1;
    const page = browserDocuments("/api/documents", send, () => ({ workspace: "browser-a", generation }));
    expect((await page.put("sample", "x", { v: 1 }, 0)).ok).toBe(true);
    // Another window takes the workspace: the first one's late write is refused, and nothing changes.
    expect(await issue("browser-a")).toBe(2);
    expect(await page.put("sample", "x", { v: 2 }, 1)).toEqual({ ok: false, reason: "superseded" });
    expect(files.main.documents.get("sample", "x")).toMatchObject({ revision: 1, value: { v: 1 } });
    // Another browser's workspace has its own generations; an unfenced write (tools) still lands.
    expect(await issue("browser-b")).toBe(1);
    expect((await browserDocuments("/api/documents", send).put("sample", "x", { v: 3 }, 1)).ok).toBe(true);
    generation = 2;
    expect((await page.put("sample", "x", { v: 4 }, 2)).ok).toBe(true);
    // A malformed fence is refused; the verification library keeps its own generations.
    expect((await send("/api/documents?kind=sample&id=x", { method: "PUT", headers: { "Content-Type": "application/json",
      [WORKSPACE_FENCE_HEADER]: "two browser-a" }, body: JSON.stringify({ revision: 3, value: 0 }) })).status).toBe(400);
    expect(await (await send("/api/verification/workspace-lease", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: "browser-a" }) })).json()).toEqual({ generation: 1 });
    files.close();
    files = openLibraryFiles(root, { clock, parts: STUDIO_PARTS, isolated: true });
    expect(await issue("browser-a")).toBe(3);
    files.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("fence headers round-trip and refuse malformed values", () => {
  expect(parseFence(formatFence({ workspace: "browser-0f0f", generation: 12 }))).toEqual({ workspace: "browser-0f0f", generation: 12 });
  expect(parseFence(formatFence({ workspace: "a b/c", generation: 1 }))).toEqual({ workspace: "a b/c", generation: 1 });
  expect(parseFence(null)).toBeNull();
  for (const bad of ["", "1", "x desktop", "1  desktop", "-1 desktop"]) expect(parseFence(bad)).toBe("invalid");
});

test("a release first ends an open gesture or slider drag (committed, one Undo step each), then refuses edits and drains", async () => {
  const { createTrustedAuthoringCore } = await import("../src/app/trusted-authoring-core");
  const { STUDIO_COMPOSITION } = await import("../src/compose/studio-registry");
  const script = scriptedAdapter(false), order: string[] = [];
  const lease = new WorkspaceLease(script.adapter, { clock: simulatedClock().clock });
  await lease.start();
  const core = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  const app = core.app, document = core.document;
  app.attach({ access: lease });
  lease.onReleaseStart(() => { order.push(`settle:${lease.writable()}`); app.settleEdits(); });
  lease.onRelease(() => { order.push(`drain:${lease.writable()}`); });
  const id = document.recipe.layers[0].id, u = document.recipe.layers[0].points[0].u;
  // A pointer gesture in progress when another window asks for the workspace.
  expect(app.beginGesture("uv", id)).toBe(true);
  expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: u + .002 } })).toBe(true);
  script.ask();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(order).toEqual(["settle:true", "drain:false"]);
  expect(app.snapshot().preview?.gesture ?? null).toBeNull();
  expect(document.recipe.layers[0].points[0].u).toBeCloseTo(u + .002, 9);
  expect(document.history.state().depth).toBe(1);
  // Nothing more is accepted once released, and the device's late moves change nothing.
  expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: u + .01 } })).toBe(false);
  expect(app.beginGesture("uv", id)).toBe(false);

  // A slider drag in progress: committed too.
  const second = scriptedAdapter(false), next = new WorkspaceLease(second.adapter, { clock: simulatedClock().clock });
  await next.start();
  const other = createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION);
  other.app.attach({ access: next });
  next.onReleaseStart(() => other.app.settleEdits());
  const layer = other.document.recipe.layers[0].id;
  expect(other.app.controlBegin("opacity", layer)).toBe(true);
  other.app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layer, opacity: .42 });
  second.ask();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(other.app.snapshot().control).toBeUndefined();
  expect(other.document.recipe.layers[0].opacity).toBe(.42);
  expect(other.document.history.state().depth).toBe(1);
  expect(other.app.controlEdit("opacity", { kind: "layer.setOpacity", layerId: layer, opacity: .9 }).ok).toBe(false);
});
