/**
 * One workspace path on both hosts: the page's device (`host-workspace-device.ts`) over the host's workspace file and routes
 * (`platform/persistence/workspace-file.ts`). An earlier build's browser draft is handed to the host once and never removed or
 * written again; writes go one at a time with the newest draft winning; an unreadable draft is offered Start fresh; the
 * routes answer local, same-origin pages only.
 */
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { openHostWorkspace, startFreshWorkspace } from "../src/host-workspace-device";
import { workspaceRequest, type WorkspaceFile } from "../src/platform/persistence/workspace-file";
import { openWorkspaceFile } from "../src/workspace-host";
import { serializeWorkspace, workspaceKeys } from "../src/workspace-state";
import { freshWorkspace } from "./fixtures/eye-region";

const root = mkdtempSync(resolve(tmpdir(), "xfs-host-workspace-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let folders = 0;
const ORIGIN = "http://127.0.0.1:4317";
const draft = (opacity = 0.5) => { const state = freshWorkspace(); state.recipe.layers[0].opacity = opacity; return JSON.stringify(serializeWorkspace(state, STUDIO_DOCUMENTS)); };

/** The page's fetch, answered by the host's routes over `file`; `hold` delays POSTs until released. */
function host(file: WorkspaceFile) {
  const posts: { body: string; headers: Record<string, string> }[] = [];
  let held: (() => void)[] | null = null;
  const fetch = async (input: string, init: RequestInit = {}) => {
    const headers = { Origin: ORIGIN, ...(init.headers as Record<string, string> | undefined) };
    if (init.method === "POST" && input.split("?")[0] === "/api/workspace") {
      posts.push({ body: String(init.body), headers });
      if (held) await new Promise<void>(release => held!.push(release));
    }
    return workspaceRequest(new Request(ORIGIN + input, { ...init, headers }), file);
  };
  return { fetch, posts, hold() { held = []; }, release() { const waiting = held ?? []; held = null; for (const release of waiting) release(); } };
}
/** Browser storage that records writes. */
function browserStorage(entries: Record<string, string> = {}) {
  const stored = new Map(Object.entries(entries)), writes: string[] = [];
  return { stored, writes, getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { writes.push(key); stored.set(key, value); } };
}
const open = (file: WorkspaceFile, page: ReturnType<typeof host>, legacy: ReturnType<typeof browserStorage> | null, verification = false) =>
  openHostWorkspace({ fetch: page.fetch, verification, key: workspaceKeys(verification).workspace, legacy });

test("the first time, an earlier build's browser draft is handed to the host once; the browser copy is never removed or written again", async () => {
  const dir = resolve(root, String(++folders)), file = openWorkspaceFile(dir, STUDIO_DOCUMENTS), page = host(file);
  const key = workspaceKeys(false).workspace, old = draft(0.25);
  const legacy = browserStorage({ [key]: old, "xfs.other": "kept" });
  const opening = await open(file, page, legacy);
  if (!opening.ok) throw Error("unreadable");
  expect(page.posts).toHaveLength(1);
  expect(opening.workspace.storage.getItem(key)).toBe(old);
  expect(JSON.parse(readFileSync(resolve(dir, "workspace.json"), "utf8")).schema).toBe("xfs/workspace-2");
  // Later drafts go to the host only; other keys stay in browser storage.
  await opening.workspace.storage.setItem(key, draft(0.75));
  opening.workspace.storage.setItem("xfs.other", "changed");
  expect(legacy.writes).toEqual(["xfs.other"]);
  expect(legacy.stored.get(key)).toBe(old);
  expect(opening.workspace.storage.getItem("xfs.other")).toBe("changed");
  // The host now has a draft: a later opening takes it and hands nothing over.
  const again = await open(file, host(file), legacy);
  if (!again.ok) throw Error("unreadable");
  expect(JSON.parse(again.workspace.storage.getItem(key)!).look.parts["eye-makeup"].body.layers[0].opacity).toBe(0.75);
  // The verification workspace has its own file, and no browser draft of its own to hand over.
  const verify = await open(file, host(file), legacy, true);
  if (!verify.ok) throw Error("unreadable");
  expect(verify.workspace.storage.getItem(workspaceKeys(true).workspace)).toBeNull();
});

test("after Start fresh, an old browser draft never comes back", async () => {
  const dir = resolve(root, String(++folders)), file = openWorkspaceFile(dir, STUDIO_DOCUMENTS), key = workspaceKeys(false).workspace;
  const legacy = browserStorage({ [key]: draft(0.25) });
  await open(file, host(file), browserStorage());   // a host that never had a draft: nothing to hand over
  expect(existsSync(resolve(dir, "workspace.json"))).toBe(false);
  // A damaged draft: the page is offered Start fresh, and nothing changes until then.
  await file.save(false, draft());
  writeFileSync(resolve(dir, "workspace.json"), "{damaged");
  const page = host(file);
  expect(await open(file, page, legacy)).toEqual({ ok: false, file: "workspace.json" });
  expect(readFileSync(resolve(dir, "workspace.json"), "utf8")).toBe("{damaged");
  const kept = await startFreshWorkspace(page.fetch, false);
  expect(kept).toMatch(/^workspace\.broken-.*\.json$/);
  expect(readFileSync(resolve(dir, kept!), "utf8")).toBe("{damaged");
  const fresh = await open(file, host(file), legacy);
  if (!fresh.ok) throw Error("unreadable");
  expect(fresh.workspace.storage.getItem(key)).toBeNull();
  expect(legacy.stored.get(key)).toBe(draft(0.25));
});

test("one write at a time, the newest draft wins, and flush waits for it; a refused write rejects and flush says so", async () => {
  const dir = resolve(root, String(++folders)), file = openWorkspaceFile(dir, STUDIO_DOCUMENTS), page = host(file), key = workspaceKeys(false).workspace;
  const opening = await open(file, page, null);
  if (!opening.ok) throw Error("unreadable");
  const { storage, flush } = opening.workspace;
  page.hold();
  const first = storage.setItem(key, draft(0.1));
  await Promise.resolve();
  storage.setItem(key, draft(0.2));
  const last = storage.setItem(key, draft(0.3));
  expect(page.posts).toHaveLength(1);
  page.release();
  await Promise.all([first, last]);
  // The middle draft was superseded before it went.
  expect(page.posts.map(post => JSON.parse(JSON.parse(post.body).workspace).look.parts["eye-makeup"].body.layers[0].opacity)).toEqual([0.1, 0.3]);
  await flush();
  // The update flush posts the current draft with its header.
  await flush({ "X-XFS-Update-Flush": "nonce" });
  expect(page.posts.at(-1)!.headers["X-XFS-Update-Flush"]).toBe("nonce");
  // A draft from a newer build is refused by the host: the write rejects and flush throws.
  await expect(storage.setItem(key, JSON.stringify({ schema: "xfs/workspace-9" })) as Promise<void>).rejects.toThrow("couldn't be saved");
  await expect(flush()).rejects.toThrow("couldn't be saved");
});

test("the routes answer local, same-origin pages only", async () => {
  const dir = resolve(root, String(++folders)), file = openWorkspaceFile(dir, STUDIO_DOCUMENTS);
  const post = (origin: string | null, url = `${ORIGIN}/api/workspace`) => workspaceRequest(new Request(url, { method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ workspace: draft() }) }), file);
  expect((await post("https://example.com")).status).toBe(403);
  expect((await post(null)).status).toBe(403);
  expect((await post("http://example.com", "http://example.com/api/workspace")).status).toBe(403);
  expect(existsSync(resolve(dir, "workspace.json"))).toBe(false);
  expect((await post(ORIGIN)).status).toBe(204);
  expect((await workspaceRequest(new Request(`${ORIGIN}/api/workspace`, { method: "DELETE", headers: { Origin: ORIGIN } }), file)).status).toBe(405);
});
