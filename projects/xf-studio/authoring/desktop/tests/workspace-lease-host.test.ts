import { expect, test } from "bun:test";
import { DESKTOP_LEASE_SCHEMA, DesktopWorkspaceLeases } from "../workspace-lease-host";
import { formatFence, WORKSPACE_FENCE_HEADER } from "../../src/platform/api/document-store";

/** A page's stream, read line by line. */
async function page(leases: DesktopWorkspaceLeases, id: string) {
  const life = new AbortController(), events: { event: string; generation?: number }[] = [];
  const response = leases.connect(false, id, life.signal);
  const reader = response.body!.getReader(), decoder = new TextDecoder();
  void (async () => { for (;;) { const { done, value } = await reader.read(); if (done) break;
    for (const line of decoder.decode(value).split("\n")) if (line) events.push(JSON.parse(line)); } })().catch(() => {});
  await Bun.sleep(5);
  return { events, end: () => life.abort() };
}
const post = (leases: DesktopWorkspaceLeases, body: object) => leases.post(false, new Request("http://127.0.0.1/api/desktop/workspace/lease",
  { method: "POST", body: JSON.stringify({ schema: DESKTOP_LEASE_SCHEMA, ...body }) }));
const write = (generation: number | null) => new Request("http://127.0.0.1/api/desktop/workspace", { method: "POST",
  headers: generation === null ? {} : { [WORKSPACE_FENCE_HEADER]: formatFence({ workspace: "desktop", generation }) } });

test("one page holds the desktop workspace; another takes over only after release or the holder's end, and late writes are fenced", async () => {
  let issued = 0;
  const leases = new DesktopWorkspaceLeases(() => ++issued, 60_000);
  const a = await page(leases, "page-aaaaaaaa"), b = await page(leases, "page-bbbbbbbb");
  expect(a.events).toEqual([{ event: "granted", generation: 1 }]);
  expect(b.events).toEqual([{ event: "held" }]);
  expect(leases.refuseWrite(write(1), false)).toBeNull();
  expect(leases.refuseWrite(write(null), false)).toBeNull();
  // Takeover asks the holder; nothing moves until it releases.
  expect((await post(leases, { page: "page-bbbbbbbb", action: "takeover" })).status).toBe(202);
  await Bun.sleep(5);
  expect(a.events.at(-1)).toEqual({ event: "release" });
  expect(leases.holder(false)).toEqual({ page: "page-aaaaaaaa", generation: 1 });
  // Only the holder, with its own generation, releases.
  expect((await post(leases, { page: "page-bbbbbbbb", action: "release", generation: 1 })).status).toBe(409);
  expect((await post(leases, { page: "page-aaaaaaaa", action: "release", generation: 1 })).status).toBe(204);
  await Bun.sleep(5);
  expect(b.events.at(-1)).toEqual({ event: "granted", generation: 2 });
  expect((await leases.refuseWrite(write(1), false)!.json())).toMatchObject({ code: "superseded" });
  expect(leases.refuseWrite(write(2), false)).toBeNull();
  // A holder whose page ends (closed, crashed or killed) releases at once to the page waiting for it.
  expect((await post(leases, { page: "page-aaaaaaaa", action: "takeover" })).status).toBe(202);
  b.end();
  await Bun.sleep(5);
  expect(a.events.at(-1)).toEqual({ event: "granted", generation: 3 });
  // The verification workspace is apart, and a malformed lease is refused.
  expect(leases.check(true, 3)).toBe(false);
  expect(leases.refuseWrite(new Request("http://127.0.0.1/", { method: "POST", headers: { [WORKSPACE_FENCE_HEADER]: "x" } }), false)?.status).toBe(400);
  a.end();
  await Bun.sleep(5);
  expect(leases.holder(false)).toBeNull();
  leases.close();
});

test("a withdrawn takeover leaves the queue, so the holder's next release grants no one", async () => {
  let issued = 0;
  const leases = new DesktopWorkspaceLeases(() => ++issued, 60_000);
  const a = await page(leases, "page-aaaaaaaa"), b = await page(leases, "page-bbbbbbbb");
  expect((await post(leases, { page: "page-bbbbbbbb", action: "takeover" })).status).toBe(202);
  expect((await post(leases, { page: "page-bbbbbbbb", action: "cancel" })).status).toBe(204);
  expect((await post(leases, { page: "page-aaaaaaaa", action: "release", generation: 1 })).status).toBe(204);
  await Bun.sleep(5);
  expect(leases.holder(false)).toBeNull();
  expect(b.events.some(event => event.event === "granted")).toBe(false);
  a.end(); b.end();
  leases.close();
});

test("a workspace write that stalls in transit is fenced again at the save: a handover in between refuses it", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { DesktopWorkspaceStore, desktopWorkspaceRequest } = await import("../workspace-store");
  const { serializeWorkspace } = await import("../../src/app/workspace/workspace-state");
  const { STUDIO_DOCUMENTS } = await import("../../src/compose/studio-registry");
  const { freshWorkspace } = await import("../../tests/fixtures/eye-region");
  const root = mkdtempSync(join(tmpdir(), "xfs-fence-"));
  try {
    let issued = 0;
    const leases = new DesktopWorkspaceLeases(() => ++issued, 60_000), store = new DesktopWorkspaceStore(root, STUDIO_DOCUMENTS);
    const a = await page(leases, "page-aaaaaaaa"), b = await page(leases, "page-bbbbbbbb");
    const text = JSON.stringify({ workspace: JSON.stringify(serializeWorkspace(freshWorkspace(), STUDIO_DOCUMENTS)) });
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const body = new ReadableStream<Uint8Array>({ async start(controller) {
      controller.enqueue(new TextEncoder().encode(text.slice(0, 10))); await gate;
      controller.enqueue(new TextEncoder().encode(text.slice(10))); controller.close();
    } });
    const request = new Request("http://127.0.0.1/api/desktop/workspace", { method: "POST", body, duplex: "half",
      headers: { "Content-Type": "application/json", [WORKSPACE_FENCE_HEADER]: formatFence({ workspace: "desktop", generation: 1 }) } } as RequestInit);
    const fence = () => leases.refuseWrite(request, false);
    expect(fence()).toBeNull();
    const answer = desktopWorkspaceRequest(request, store, false, fence);
    // The holder hands over while the write's body is still arriving.
    await post(leases, { page: "page-bbbbbbbb", action: "takeover" });
    await post(leases, { page: "page-aaaaaaaa", action: "release", generation: 1 });
    finish();
    expect((await answer).status).toBe(409);
    expect(store.load(false)).toBeNull();
    a.end(); b.end(); leases.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the desktop bootstrap takes the lease before it reads the workspace, and a refused save is a failed save", async () => {
  const source = await Bun.file(new URL("../bootstrap.js", import.meta.url)).text();
  expect(source.indexOf("await lease.start()")).toBeGreaterThan(0);
  expect(source.indexOf("await lease.start()")).toBeLessThan(source.indexOf("await fetch(workspaceEndpoint"));
  expect(source).not.toMatch(/status === 409\) return/);
  expect(source).toMatch(/if \(lastSaveFailed\) throw Error\(SAVE_FAILED\)/);
  const main = await Bun.file(new URL("../../src/compose/studio-main.ts", import.meta.url)).text();
  expect(main.indexOf("await startBrowserWorkspaceLease")).toBeLessThan(main.indexOf("void startStudio("));
});
