import { expect, test } from "bun:test";
import { InstallDetectionActions } from "../src/installation/install-detection-actions";
import { frameworkCheckFor } from "../src/installation/framework-fixtures";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { INITIAL_LEASE, LEASE_MESSAGES, leaseTransition, WorkspaceLease, type LeaseClock, type WorkspaceLeaseAdapter } from "../src/app/workspace/workspace-lease";
import { leasedDocuments } from "../src/app/workspace/leased-documents";
import { WorkspacePersistence } from "../src/app/workspace/workspace-persistence";
import { documentOwners } from "../src/platform/core/saved-document";
import { ATTEMPT_MS, DocumentOutbox } from "../src/platform/core/document-outbox";
import type { TransactAnswer } from "../src/platform/api/document-commands";
import { formatFence, parseFence, WORKSPACE_FENCE_HEADER, type DocumentStorePort } from "../src/platform/api/document-store";
import { memoryOutboxStorage } from "./fixtures/platform-doubles";
import { browserDocuments } from "../src/app/browser/browser-documents-device";
import { openLibraryFiles } from "../src/library/host/library-files";
import { hostClock } from "../src/platform/core/clock";
import { STUDIO_DOCUMENTS, STUDIO_PARTS } from "../src/compose/studio-registry";
import { freshWorkspace } from "./fixtures/eye-region";
import { trustedFixture } from "./studio-presentation-fixture";

import { namedCore } from "./fixtures/named-targets";
import { tempDir } from "./temp-dir";
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
  expect(lease.snapshot()).toEqual({ phase: "read-only", writable: false, message: LEASE_MESSAGES.readOnly, canTakeOver: true, canRetry: false, canCancel: false, refusal: LEASE_MESSAGES.refused });
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

test("the outbox behind the lease drains commands in flight (and the successor behind them), then sends nothing", async () => {
  const sent: string[] = [];
  let open = true;
  const answers: (() => void)[] = [];
  const store: DocumentStorePort = { list: async () => [], revisions: async () => ({}), read: async () => ({}),
    transact: request => new Promise<TransactAnswer>(resolve => {
      const write = request.writes[0]!;
      sent.push(JSON.stringify(write.value));
      answers.push(() => resolve({ ok: true, revisions: { [`${write.kind}/${write.id}`]: write.base + 1 } }));
    }) };
  const leased = leasedDocuments(store, { draining: () => open });
  const outbox = new DocumentOutbox(leased, memoryOutboxStorage(), { writable: () => open, sendable: () => open });
  outbox.open();
  const doc = documentOwners(outbox).open("sample", "a", 0);
  void doc.save(1);
  await Promise.resolve(); await Promise.resolve();
  void doc.save(2);
  void doc.save(3);
  let done = false;
  const drained = outbox.settle().then(() => { done = true; });
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(done).toBe(false);
  answers.shift()!();
  await new Promise(resolve => setTimeout(resolve, 5));
  // The coalesced save (3) went out after the first was acknowledged; the drain waits for it too.
  expect(sent).toEqual(["1", "3"]);
  expect(done).toBe(false);
  answers.shift()!();
  await drained;
  expect(leased.pending()).toBe(0);
  open = false;
  await expect(doc.save(4)).rejects.toThrow("open elsewhere");
  expect(await leased.transact({ id: "late", command: "x", writes: [{ kind: "sample", id: "a", base: 2, value: 5 }] })).toEqual({ ok: false, reason: "superseded" });
  expect(sent).toEqual(["1", "3"]);
});

test("autosave writes nothing while read-only; after its last write, retiring it stops every later write", () => {
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
  expect(persistence.flush()).toBe(true);
  expect(writes).toHaveLength(2);
  persistence.retire();
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
  // The one exception: the recovery export writes only this window's own copy to a file, so a read-only window can still get its work out.
  expect(shell.files.capability({ kind: "collection.exportWindowCopy" }).code).not.toBe("unavailable");
  expect(await shell.files.execute({ kind: "collection.exportWindowCopy" })).not.toMatchObject({ code: "unavailable" });
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
  expect(Object.keys(shell.workspace.descriptors())).toEqual(["workspace.takeOver", "workspace.retryRelease", "workspace.cancelTakeOver"]);
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
  const root = tempDir("xfs-lease-"), clock = hostClock();
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
    const put = (target: typeof page, value: unknown, base: number) =>
      target.transact({ id: `c-${Math.random()}`, command: "sample.write", writes: [{ kind: "sample", id: "x", base, value }] });
    expect((await put(page, { v: 1 }, 0)).ok).toBe(true);
    // Another window takes the workspace: the first one's late command is refused, and nothing changes.
    expect(await issue("browser-a")).toBe(2);
    expect(await put(page, { v: 2 }, 1)).toEqual({ ok: false, reason: "superseded" });
    expect(files.main.documents.get("sample", "x")).toMatchObject({ revision: 1, value: { v: 1 } });
    // Another browser's workspace has its own generations; an unfenced command (tools) still lands.
    expect(await issue("browser-b")).toBe(1);
    expect((await put(browserDocuments("/api/documents", send), { v: 3 }, 1)).ok).toBe(true);
    generation = 2;
    expect((await put(page, { v: 4 }, 2)).ok).toBe(true);
    // A malformed fence is refused; the verification library keeps its own generations.
    expect((await send("/api/documents/transact", { method: "POST", headers: { "Content-Type": "application/json",
      [WORKSPACE_FENCE_HEADER]: "two browser-a" }, body: JSON.stringify({ id: "c-x", command: "sample.write", writes: [{ kind: "sample", id: "x", base: 3, value: 0 }] }) })).status).toBe(400);
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
  const { createTrustedAuthoringCore } = await import("./fixtures/makeup-core");
  const { STUDIO_COMPOSITION } = await import("../src/compose/studio-registry");
  const script = scriptedAdapter(false), order: string[] = [];
  const lease = new WorkspaceLease(script.adapter, { clock: simulatedClock().clock });
  await lease.start();
  const core = namedCore(createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION));
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
  expect(document.recipe.layers[0].points[0].u).toBeCloseTo(u + .002, 9);
  expect(document.history.state().depth).toBe(1);
  // Nothing more is accepted once released, and the device's late moves change nothing.
  expect(app.applyGesture("uv", { kind: "point.replace", index: 0, next: { u: u + .01 } })).toBe(false);
  expect(app.beginGesture("uv", id)).toBe(false);

  // A slider drag in progress: committed too.
  const second = scriptedAdapter(false), next = new WorkspaceLease(second.adapter, { clock: simulatedClock().clock });
  await next.start();
  const other = namedCore(createTrustedAuthoringCore(freshWorkspace(), { resetStack: () => {}, selectedCollection: () => "draft" }, STUDIO_COMPOSITION));
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

test("a release step that can't save stops the release: the page keeps the lease and its edits, says so, and Try again finishes it", async () => {
  const time = simulatedClock(), script = scriptedAdapter(false), released: string[] = [];
  const lease = new WorkspaceLease(script.adapter, { clock: time.clock });
  await lease.start();
  let saves = false;
  lease.onRelease(() => saves);
  lease.onReleased(() => released.push("autosave retired"));
  script.ask();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(lease.snapshot()).toMatchObject({ phase: "release-failed", writable: true, canRetry: true, canTakeOver: false, message: LEASE_MESSAGES.releaseFailed });
  expect(lease.refusal()).toBeUndefined();
  expect(lease.generation()).toBe(1);
  expect(script.calls).toEqual([]);
  expect(released).toEqual([]);
  // A repeated request doesn't retry by itself; Try again does.
  script.ask();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(lease.snapshot().phase).toBe("release-failed");
  saves = true;
  expect(await lease.dispatch({ kind: "workspace.retryRelease" })).toEqual({ ok: true });
  expect(script.calls).toEqual(["release"]);
  expect(released).toEqual(["autosave retired"]);
  expect(lease.snapshot().phase).toBe("read-only");
});

test("a release whose adapter can't confirm (the desktop's last host write didn't land) keeps the lease too", async () => {
  const script = scriptedAdapter(false);
  const { ReleaseUnsaved } = await import("../src/app/workspace/workspace-lease");
  const adapter = { ...script.adapter, release: async () => { throw new ReleaseUnsaved("The last workspace write didn't land."); } };
  const lease = new WorkspaceLease(adapter, { clock: simulatedClock().clock });
  await lease.start();
  expect(await lease.release()).toBe(false);
  expect(lease.snapshot().phase).toBe("release-failed");
});

test("autosave's last write answers whether the draft is stored", () => {
  const workspace = freshWorkspace();
  let full = false;
  const persistence = new WorkspacePersistence({ storage: { setItem: () => { if (full) throw Object.assign(Error("full"), { name: "QuotaExceededError" }); } },
    key: "k", writable: true, capture: () => { workspace.recipe.layers[0].opacity = Math.random(); return workspace; }, model: STUDIO_DOCUMENTS });
  persistence.activate();
  expect(persistence.flush()).toBe(true);
  full = true;
  expect(persistence.flush()).toBe(false);
});

test("the outbox's drain reports a command that failed while it waited, and stops sending once the window is superseded", async () => {
  let answer: ((result: TransactAnswer) => void) | null = null, fail: ((error: Error) => void) | null = null;
  const store: DocumentStorePort = { list: async () => [], revisions: async () => ({}), read: async () => ({}),
    transact: () => new Promise((resolve, reject) => { answer = resolve; fail = reject; }) };
  let retry: (() => void) | null = null;
  const outbox = new DocumentOutbox(leasedDocuments(store, { draining: () => true }), memoryOutboxStorage(),
    // The retry delay is the test's to run (each attempt's own deadline never passes here).
    { schedule: (ms, run) => { if (ms === ATTEMPT_MS) return { cancel() {} }; retry = run; return { cancel: () => { retry = null; } }; } });
  outbox.open();
  outbox.commit("sample.write", [{ kind: "sample", id: "a", value: 1 }]);
  const drained = outbox.settle();
  await new Promise(resolve => setTimeout(resolve, 5));
  fail!(Error("The host didn't answer."));
  expect(await drained).toBe(false);
  // Sent again under its ID; this time the host says another window holds the workspace now: the outbox stops, the entry stays stored.
  const again = outbox.settle();
  retry!();
  await new Promise(resolve => setTimeout(resolve, 5));
  answer!({ ok: false, reason: "superseded" });
  expect(await again).toBe(false);
  expect(outbox.status()).toMatchObject({ stopped: false, suspended: true, pending: 1 });
});

test("a failed takeover returns to read-only, withdraws its request, and can be tried again", async () => {
  let attempt = 0, withdrawn = 0;
  const lease = new WorkspaceLease({
    acquire: async () => null,
    takeOver: signal => {
      signal.addEventListener("abort", () => withdrawn++, { once: true });
      return ++attempt === 1 ? Promise.reject(Error("No generation.")) : Promise.resolve({ generation: 4 });
    },
    onReleaseRequested: () => {}, release: async () => {},
  }, { clock: simulatedClock().clock });
  await lease.start();
  expect((await lease.takeOver()).ok).toBe(false);
  expect(withdrawn).toBe(1);
  expect(lease.snapshot()).toMatchObject({ phase: "read-only", canTakeOver: true });
  expect((await lease.takeOver()).ok).toBe(true);
  expect(lease.snapshot().phase).toBe("taken-over");
});

test("a page that can't get a generation, or loses its host, is never writable", async () => {
  const noGeneration = new WorkspaceLease({ acquire: async () => { throw Error("No generation."); }, takeOver: () => new Promise(() => {}),
    onReleaseRequested: () => {}, release: async () => {} }, { clock: simulatedClock().clock });
  await noGeneration.start();
  expect(noGeneration.snapshot()).toMatchObject({ phase: "disconnected", writable: false, message: LEASE_MESSAGES.disconnected, canTakeOver: false });
  expect(noGeneration.refusal()?.reason).toBe(LEASE_MESSAGES.disconnected);
  let lose = () => {};
  const held = new WorkspaceLease({ ...scriptedAdapter(false).adapter, onLost: listener => { lose = listener; } }, { clock: simulatedClock().clock });
  await held.start();
  expect(held.writable()).toBe(true);
  lose();
  expect(held.snapshot()).toMatchObject({ phase: "disconnected", writable: false });
  expect(held.generation()).toBeNull();
});

test("localhost: a page holding the Web Lock but refused a generation lets the lock go and is refused (fail closed)", async () => {
  const { browserWorkspaceLease } = await import("../src/app/browser/workspace-lease-device");
  let held = 0;
  const locks = { request: async (_name: string, _options: unknown, callback: (lock: unknown) => unknown) => { held++; try { return await callback({ name: "x" }); } finally { held--; } } };
  const channel = { postMessage() {}, addEventListener() {}, removeEventListener() {}, close() {} };
  const adapter = browserWorkspaceLease({ workspace: "browser-test", locks: locks as never, channel, register: async () => null, retryDelays: [1, 1], sleep: async () => {} });
  await expect(adapter.acquire(new AbortController().signal)).rejects.toThrow("didn't issue a workspace lease");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(held).toBe(0);
});

test("desktop: when the lease stream ends, a pending acquire is refused and a holder loses write access", async () => {
  const { desktopWorkspaceLease } = await import("../src/app/browser/workspace-lease-device");
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const send = async (_url: string, init?: RequestInit) => init?.method === "POST" ? new Response(null, { status: 204 })
    : new Response(new ReadableStream<Uint8Array>({ start: controller => { streams.push(controller); } }));
  const pending = desktopWorkspaceLease({ endpoint: "/lease", send });
  const acquiring = pending.acquire(new AbortController().signal);
  await new Promise(resolve => setTimeout(resolve, 0));
  streams[0]!.close();
  await expect(acquiring).rejects.toThrow("ended");
  const adapter = desktopWorkspaceLease({ endpoint: "/lease", send });
  const lease = new WorkspaceLease(adapter, { clock: simulatedClock().clock });
  const starting = lease.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  streams[1]!.enqueue(new TextEncoder().encode(`${JSON.stringify({ event: "granted", generation: 3 })}\n`));
  await starting;
  expect(lease.generation()).toBe(3);
  streams[1]!.close();
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(lease.snapshot().phase).toBe("disconnected");
  expect(lease.draining()).toBe(false);
});

test("a document whose command failed during the drain stays in the outbox, and Try again sends it before handing over", async () => {
  const script = scriptedAdapter(false), sent: number[] = [];
  let broken = true;
  const store: DocumentStorePort = { list: async () => [], revisions: async () => ({}), read: async () => ({}), transact: async request => {
    const write = request.writes[0]!;
    sent.push(write.value as number);
    if (broken) throw Error("The host didn't answer.");
    return { ok: true, revisions: { [`${write.kind}/${write.id}`]: write.base + 1 } };
  } };
  const lease = new WorkspaceLease(script.adapter, { clock: simulatedClock().clock });
  await lease.start();
  const outbox = new DocumentOutbox(leasedDocuments(store, lease), memoryOutboxStorage(), { schedule: () => ({ cancel() {} }),
    writable: () => lease.writable(), sendable: () => lease.draining() });
  outbox.open();
  lease.onRelease(() => outbox.settle());
  void documentOwners(outbox).open("sample", "a", 0).save(7).catch(() => {});
  script.ask();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(lease.snapshot().phase).toBe("release-failed");
  expect(script.calls).toEqual([]);
  // Try again: the outbox sends the same command again (under its own ID), and only then is the workspace released.
  broken = false;
  expect(await lease.retryRelease()).toBe(true);
  expect(sent).toEqual([7, 7]);
  expect(script.calls).toEqual(["release"]);
});

test("a release whose answer was lost is reconciled before this page may write: still held, released, or unknown", async () => {
  const { ReleaseUnsaved } = await import("../src/app/workspace/workspace-lease");
  const make = (release: () => Promise<void>, reconcile?: () => Promise<"held" | "released">) =>
    new WorkspaceLease({ ...scriptedAdapter(false).adapter, release, ...(reconcile ? { reconcile } : {}) }, { clock: simulatedClock().clock });
  // Unsaved: nothing was released, so the page keeps the lease without asking.
  const unsaved = make(async () => { throw new ReleaseUnsaved("not stored"); });
  await unsaved.start();
  expect(await unsaved.release()).toBe(false);
  expect(unsaved.snapshot().phase).toBe("release-failed");
  // Lost answer, and the host says the release landed: read-only, never writable in between.
  let answer!: (outcome: "held" | "released") => void;
  const seen: boolean[] = [];
  const lost = make(async () => { throw Error("The answer was lost."); }, () => new Promise(resolve => { answer = resolve; }));
  await lost.start();
  lost.subscribe(() => seen.push(lost.writable()));
  const releasing = lost.release();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(lost.snapshot()).toMatchObject({ phase: "reconciling", writable: false, message: LEASE_MESSAGES.reconciling });
  expect(lost.generation()).toBeNull();
  answer("released");
  expect(await releasing).toBe(true);
  expect(lost.snapshot().phase).toBe("read-only");
  expect(seen).toEqual([false, false, false]);
  // The host says this page still holds it: writable again, with Try again.
  const held = make(async () => { throw Error("The answer was lost."); }, async () => "held");
  await held.start();
  expect(await held.release()).toBe(false);
  expect(held.snapshot()).toMatchObject({ phase: "release-failed", writable: true });
  // It can't be told: never writable (disconnected).
  const unknown = make(async () => { throw Error("The answer was lost."); }, async () => { throw Error("No host."); });
  await unknown.start();
  await unknown.release();
  expect(unknown.snapshot()).toMatchObject({ phase: "disconnected", writable: false });
});

test("desktop: Try again sends the latest workspace draft again when its write failed, and waits for it", async () => {
  const { desktopWorkspaceWriter } = await import("../src/app/browser/desktop-workspace-writer");
  const { ReleaseUnsaved } = await import("../src/app/workspace/workspace-lease");
  const sent: string[] = [];
  let broken = true;
  const writer = desktopWorkspaceWriter(async text => { sent.push(text); if (broken) throw Error("refused"); });
  await writer.save("draft 1");
  await writer.save("draft 2");
  expect(writer.failed()).toBe(true);
  await expect(writer.settle()).rejects.toBeInstanceOf(ReleaseUnsaved);
  expect(sent.at(-1)).toBe("draft 2");
  broken = false;
  await writer.settle();
  expect(sent).toEqual(["draft 1", "draft 2", "draft 2", "draft 2"]);
  expect(writer.failed()).toBe(false);
});

test("desktop: a takeover whose request failed (its answer lost) is still withdrawn, so the next one starts clean", async () => {
  const { desktopWorkspaceLease } = await import("../src/app/browser/workspace-lease-device");
  const posts: string[] = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const send = async (_url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return new Response(new ReadableStream<Uint8Array>({ start: controller => { streams.push(controller); } }));
    const { action } = JSON.parse(String(init.body)) as { action: string };
    posts.push(action);
    if (action === "takeover" && posts.filter(item => item === "takeover").length === 1) throw Error("The answer was lost.");
    return new Response(null, { status: action === "takeover" ? 202 : 204 });
  };
  const lease = new WorkspaceLease(desktopWorkspaceLease({ endpoint: "/lease", send }), { clock: simulatedClock().clock });
  const starting = lease.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  streams[0]!.enqueue(new TextEncoder().encode(`${JSON.stringify({ event: "held" })}\n`));
  await starting;
  expect((await lease.takeOver()).ok).toBe(false);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(posts).toEqual(["takeover", "cancel"]);
  const second = lease.takeOver();
  await new Promise(resolve => setTimeout(resolve, 0));
  streams[0]!.enqueue(new TextEncoder().encode(`${JSON.stringify({ event: "granted", generation: 2 })}\n`));
  expect((await second).ok).toBe(true);
});

test("desktop: a release and its status check name one operation; takeovers and their cancellations name their own request", async () => {
  const { desktopWorkspaceLease } = await import("../src/app/browser/workspace-lease-device");
  const bodies: Record<string, unknown>[] = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const send = async (_url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return new Response(new ReadableStream<Uint8Array>({ start: controller => { streams.push(controller); } }));
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    bodies.push(body);
    if (body.action === "release") throw Error("The answer was lost.");
    if (body.action === "status") return Response.json({ held: true });
    return new Response(null, { status: 204 });
  };
  const lease = new WorkspaceLease(desktopWorkspaceLease({ endpoint: "/lease", send }), { clock: simulatedClock().clock });
  const starting = lease.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  streams[0]!.enqueue(new TextEncoder().encode(`${JSON.stringify({ event: "granted", generation: 5 })}\n`));
  await starting;
  expect(await lease.release()).toBe(false);
  const release = bodies.find(body => body.action === "release")!, status = bodies.find(body => body.action === "status")!;
  expect(typeof release.operation).toBe("string");
  expect(status.operation).toBe(release.operation);
  expect(lease.snapshot().phase).toBe("release-failed");
  // A second release is a new operation.
  await lease.retryRelease();
  expect(bodies.filter(body => body.action === "release").map(body => body.operation)).toHaveLength(2);
  expect(new Set(bodies.filter(body => body.action === "release").map(body => body.operation)).size).toBe(2);

  const takeovers: Record<string, unknown>[] = [];
  const reader = desktopWorkspaceLease({ endpoint: "/lease", send: async (_url, init) => {
    if (init?.method !== "POST") return new Response(new ReadableStream<Uint8Array>({ start: controller => {
      controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ event: "held" })}\n`)); } }));
    takeovers.push(JSON.parse(String(init.body)));
    return new Response(null, { status: 202 });
  } });
  await reader.acquire(new AbortController().signal);
  for (let i = 0; i < 2; i++) {
    const run = new AbortController(), asking = reader.takeOver(run.signal).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 0));
    run.abort(); await asking;
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  const [first, cancelFirst, second, cancelSecond] = takeovers;
  expect([first!.action, cancelFirst!.action, second!.action, cancelSecond!.action]).toEqual(["takeover", "cancel", "takeover", "cancel"]);
  expect(cancelFirst!.request).toBe(first!.request);
  expect(cancelSecond!.request).toBe(second!.request);
  expect(first!.request).not.toBe(second!.request);
});


test("Cancel withdraws Waiting, leaves read-only, and permits a fresh takeover", async () => {
  const time = simulatedClock(), script = scriptedAdapter(true);
  const lease = new WorkspaceLease(script.adapter, { clock: time.clock });
  await lease.start();
  expect(lease.capability({ kind: "workspace.cancelTakeOver" }).available).toBe(false);
  const taking = lease.dispatch({ kind: "workspace.takeOver" });
  time.advance(1500);
  expect(lease.snapshot().canCancel).toBe(true);
  expect(await lease.dispatch({ kind: "workspace.cancelTakeOver" })).toEqual({ ok: true });
  await taking;
  expect(lease.snapshot()).toMatchObject({ phase: "read-only", writable: false, canTakeOver: true, canCancel: false });
  expect(lease.capability({ kind: "workspace.takeOver" }).available).toBe(true);
  const again = lease.dispatch({ kind: "workspace.takeOver" });
  script.grant(8); await again;
  expect(lease.snapshot().phase).toBe("taken-over");
});

test("Cancel returns a grant already in transit without writing or becoming editable", async () => {
  const time = simulatedClock(), script = scriptedAdapter(true);
  const lease = new WorkspaceLease(script.adapter, { clock: time.clock });
  await lease.start();
  const taking = lease.dispatch({ kind: "workspace.takeOver" });
  time.advance(1500);
  script.grant(8);
  await lease.dispatch({ kind: "workspace.cancelTakeOver" });
  await taking;
  expect(script.calls).toEqual(["takeOver", "release"]);
  expect(lease.snapshot()).toMatchObject({ phase: "read-only", writable: false, canTakeOver: true });
});


test("a read-only window can check frameworks again, with honest availability and no workspace edits", async () => {
  const lease = new WorkspaceLease(scriptedAdapter(true).adapter, { clock: simulatedClock().clock });
  await lease.start();
  const requests: string[] = [];
  let finish!: () => void;
  const detection = new InstallDetectionActions(async target => {
    requests.push(target);
    await new Promise<void>(resolve => { finish = resolve; });
    return { ok: true, status: 200, data: frameworkCheckFor("all-ok") };
  });
  const { shell } = trustedFixture({ lease, presentation: { installDetection: detection } });
  const before = shell.snapshot().authoring.document;
  const action = { kind: "detect.frameworkVersions" } as const;
  expect(shell.installDetection.capability(action)).toEqual({ available: true });
  const checked = shell.installDetection.dispatch(action);
  expect(shell.installDetection.capability(action)).toEqual({ available: false, reason: "Detection is already running." });
  finish();
  expect(await checked).toEqual({ ok: true });
  expect(shell.installDetection.snapshot().frameworks).toEqual(frameworkCheckFor("all-ok"));
  expect(shell.installDetection.capability(action)).toEqual({ available: true });
  const again = shell.installDetection.dispatch(action);
  finish();
  expect(await again).toEqual({ ok: true });
  expect(requests).toEqual(["frameworks", "frameworks"]);
  expect(shell.snapshot().authoring.document).toEqual(before);
  expect(shell.workspace.snapshot().writable).toBe(false);
  expect(shell.installDetection.capability({ kind: "detect.gameInstalls" })).toMatchObject({ available: false, code: "unavailable", reason: LEASE_MESSAGES.refused });
  expect(await shell.localSetup.dispatch({ kind: "setup.refresh" })).toEqual({ ok: false, code: "unavailable", message: LEASE_MESSAGES.refused });
  const unavailable = trustedFixture({ lease }).shell.installDetection;
  expect(unavailable.capability(action)).toEqual({ available: false, reason: "Looking for your game isn't available here." });
  expect(await unavailable.dispatch(action)).toMatchObject({ ok: false, code: "unavailable", message: "Looking for your game isn't available here." });
});
