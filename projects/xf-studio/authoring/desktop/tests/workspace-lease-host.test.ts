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
