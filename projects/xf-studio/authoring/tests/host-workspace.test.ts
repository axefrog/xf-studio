/**
 * One workspace path on both hosts: the page's device (`host-workspace-device.ts`) over the host's workspace file and routes
 * (`platform/persistence/workspace-file.ts`). Nothing the page captured is lost on a reload, a closed tab or a slow write; a
 * draft handed over never overwrites newer work, and goes to the recovery queue instead; an earlier build's browser draft is
 * handed over once per browser and never dropped; an unreadable draft is offered Start fresh; the routes answer local,
 * same-origin pages only.
 */
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { collectionDraft } from "../src/collection-workspace";
import { STUDIO_DOCUMENTS } from "../src/compose/studio-registry";
import { openHostWorkspace, startFreshWorkspace, type TabLocks } from "../src/host-workspace-device";
import { workspaceRequest, type WorkspaceFile } from "../src/platform/persistence/workspace-file";
import { openWorkspaceFile } from "../src/workspace-host";
import { parseWorkspace, serializeWorkspace, workspaceKeys } from "../src/workspace-state";
import { freshWorkspace, initialRecipe } from "./fixtures/eye-region";

const root = mkdtempSync(resolve(tmpdir(), "xfs-host-workspace-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let folders = 0;
const folder = () => resolve(root, String(++folders));
const ORIGIN = "http://127.0.0.1:4317";
const KEY = workspaceKeys(false).workspace;
const draft = (opacity = 0.5) => { const state = freshWorkspace(); state.recipe.layers[0].opacity = opacity; return JSON.stringify(serializeWorkspace(state, STUDIO_DOCUMENTS)); };
const opacityOf = (text: string | null) => parseWorkspace(JSON.parse(text!), STUDIO_DOCUMENTS).recipe.layers[0].opacity;
/** A workspace with an open collection named `name` (what the recovery queue holds). */
const collectionWorkspace = (name: string) => JSON.stringify(serializeWorkspace({ ...freshWorkspace(), collections: collectionDraft({
  schema: "xfas/collection-1", id: crypto.randomUUID(), name, presets: [{ id: crypto.randomUUID(), name: "Look", revision: 1, recipe: initialRecipe() }] },
  STUDIO_DOCUMENTS) }, STUDIO_DOCUMENTS));
const collectionNames = (text: string | null) => {
  const collections = parseWorkspace(JSON.parse(text!), STUDIO_DOCUMENTS).collections!;
  return { open: collections.collection.name, recovery: [collections.previous, ...(collections.older ?? [])].filter(Boolean).map(entry => entry!.collection.name) };
};

/** The host's routes over `file`, as a page's fetch; `hold()` keeps POSTs to `/api/workspace` from reaching the host until `release()`. */
function host(file: WorkspaceFile) {
  const posts: { body: string; keepalive: boolean; headers: Record<string, string> }[] = [];
  let held: (() => void)[] | null = null;
  const fetch = async (input: string, init: RequestInit = {}) => {
    const headers = { Origin: ORIGIN, ...(init.headers as Record<string, string> | undefined) };
    if (init.method === "POST" && input.split("?")[0] === "/api/workspace") {
      const body = init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : String(init.body);
      posts.push({ body, keepalive: !!init.keepalive, headers });
      if (held) await new Promise<void>(release => held!.push(release));
    }
    return workspaceRequest(new Request(ORIGIN + input, { ...init, headers }), file);
  };
  /** `release(true)` lets the requests held so far through and keeps holding later ones. */
  return { fetch, posts, hold() { held = []; },
    release(keepHolding = false) { const waiting = held ?? []; held = keepHolding ? [] : null; for (const release of waiting) release(); } };
}
/** A browser's storage (shared by its tabs), recording writes. */
function browserStorage(entries: Record<string, string> = {}) {
  const stored = new Map(Object.entries(entries)), writes: string[] = [];
  return { stored, writes, get length() { return stored.size; }, key: (i: number) => [...stored.keys()][i] ?? null,
    getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { writes.push(key); stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); } };
}
/** A tab's session storage (it keeps the tab's identity across a reload). */
const sessionStorage = () => { const stored = new Map<string, string>(); return { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => { stored.set(k, v); } }; };
/** Web Locks whose held locks are `live` (tabs still open). */
const locks = (live: Set<string>): TabLocks => ({ request: async name => { live.add(name); }, query: async () => ({ held: [...live].map(name => ({ name })) }) });
async function open(page: ReturnType<typeof host>, browser: ReturnType<typeof browserStorage> | null, session = sessionStorage(), tabLocks?: TabLocks) {
  const opening = await openHostWorkspace({ fetch: page.fetch, verification: false, key: KEY, browser, session, locks: tabLocks ?? null });
  if (!opening.ok) throw Error("unreadable");
  return opening.workspace;
}

test("an earlier build's browser draft is handed over once; the browser copy is never removed or written; other keys stay in the browser", async () => {
  const dir = folder(), file = openWorkspaceFile(dir, STUDIO_DOCUMENTS), old = draft(0.25);
  const browser = browserStorage({ [KEY]: old, "xfs.other": "kept" });
  const workspace = await open(host(file), browser);
  expect(opacityOf(workspace.storage.getItem(KEY))).toBe(0.25);
  expect(JSON.parse(readFileSync(resolve(dir, "workspace.json"), "utf8")).schema).toBe("xfs/workspace-2");
  await workspace.storage.setItem(KEY, draft(0.75));
  workspace.storage.setItem("xfs.other", "changed");
  expect(browser.stored.get(KEY)).toBe(old);
  expect(browser.writes.filter(key => key === KEY)).toEqual([]);
  expect(workspace.storage.getItem("xfs.other")).toBe("changed");
  // Handed over already: a later opening takes the host's draft and hands nothing over again.
  const again = host(file), reopened = await open(again, browser);
  expect(opacityOf(reopened.storage.getItem(KEY))).toBe(0.75);
});

test("a browser draft handed over late never overwrites newer work; a second browser's differing draft goes to the recovery queue", async () => {
  const dir = folder(), file = openWorkspaceFile(dir, STUDIO_DOCUMENTS);
  // Browser A loaded first and handed over its draft; then saved newer work.
  const a = await open(host(file), browserStorage({ [KEY]: collectionWorkspace("From browser A") }));
  const newer = collectionWorkspace("Newer work in A");
  await a.storage.setItem(KEY, newer);
  // Browser B, whose earlier build kept another draft, loads now: its draft is kept for recovery, and A's work stays open.
  const browserB = browserStorage({ [KEY]: collectionWorkspace("From browser B") });
  const b = await open(host(file), browserB);
  expect(collectionNames(b.storage.getItem(KEY))).toEqual({ open: "Newer work in A", recovery: ["From browser B"] });
  // Once per browser: reloading B doesn't queue it again.
  const reloaded = await open(host(file), browserB);
  expect(collectionNames(reloaded.storage.getItem(KEY)).recovery).toEqual(["From browser B"]);
  // A hand-over that raced a save (its eligibility read before the save) is decided by the host when it arrives.
  const late = await file.adopt(false, collectionWorkspace("Late import"), null);
  expect(late.outcome).toBe("recovered");
  expect(collectionNames(late.workspace)).toEqual({ open: "Newer work in A", recovery: ["Late import", "From browser B"] });
});

test("a load waits for the writes on their way: a reload during a slow save gets that save, never the file before it", async () => {
  const dir = folder(), file = openWorkspaceFile(dir, STUDIO_DOCUMENTS);
  await file.save(false, draft(0.1));
  const saving = file.save(false, draft(0.2));
  const loaded = await file.load(false);
  expect(opacityOf(loaded.text)).toBe(0.2);
  await saving;
  // The first hand-over too: a load behind it sees the adopted draft, not an empty workspace.
  const fresh = openWorkspaceFile(folder(), STUDIO_DOCUMENTS);
  const adopting = fresh.adopt(false, draft(0.3), null);
  expect(opacityOf((await fresh.load(false)).text)).toBe(0.3);
  expect((await adopting).outcome).toBe("adopted");
});

test("a reload right after an edit keeps it: the journal hands the draft the host never got back, through the normal path", async () => {
  const dir = folder(), file = openWorkspaceFile(dir, STUDIO_DOCUMENTS), browser = browserStorage(), session = sessionStorage();
  const first = await open(host(file), browser, session);
  await first.storage.setItem(KEY, draft(0.1));
  // The next edit's request never reaches the host (the page reloads first).
  const dying = host(file);
  dying.hold();
  const page = await open(dying, browser, session);
  void page.storage.setItem(KEY, draft(0.2));
  void page.storage.setItem(KEY, draft(0.3));
  expect(opacityOf((await file.load(false)).text)).toBe(0.1);
  // The reload (same tab) restores the newest edit, and the host stores it.
  const reload = await open(host(file), browser, session);
  expect(opacityOf(reload.storage.getItem(KEY))).toBe(0.3);
  expect(opacityOf((await file.load(false)).text)).toBe(0.3);
  expect([...browser.stored.keys()].filter(key => key.startsWith("xfs.workspace.journal"))).toEqual([]);
});

test("a write that reached the host before the reload, and a newer one that didn't: the newer one wins", async () => {
  const dir = folder(), file = openWorkspaceFile(dir, STUDIO_DOCUMENTS), browser = browserStorage(), session = sessionStorage();
  const page = host(file), workspace = await open(page, browser, session);
  await workspace.storage.setItem(KEY, draft(0.1));
  // 0.2 reaches the host; 0.3 is journalled but never sent (the page is gone before its turn).
  page.hold();
  void workspace.storage.setItem(KEY, draft(0.2));
  void workspace.storage.setItem(KEY, draft(0.3));
  page.release(true);
  // 0.2 has landed once 0.3's request is on its way (one at a time).
  while (page.posts.length < 3) await Bun.sleep(1);
  expect(opacityOf((await file.load(false)).text)).toBe(0.2);
  const reload = await open(host(file), browser, session);
  expect(opacityOf(reload.storage.getItem(KEY))).toBe(0.3);
});

test("a closed tab's last edit comes back at the next start; a tab that is still open keeps its own", async () => {
  const dir = folder(), file = openWorkspaceFile(dir, STUDIO_DOCUMENTS), browser = browserStorage(), live = new Set<string>();
  const closing = host(file), tabLocks = locks(live);
  const tab = await open(closing, browser, sessionStorage(), tabLocks);
  await tab.storage.setItem(KEY, draft(0.1));
  closing.hold();
  void tab.storage.setItem(KEY, draft(0.4));
  // Another tab, still open, has an edit on its way too.
  const otherPage = host(file);
  const other = await open(otherPage, browser, sessionStorage(), tabLocks);
  otherPage.hold();
  void other.storage.setItem(KEY, draft(0.1));
  // The first tab closes (its lock goes); a new tab starts.
  live.delete([...live][0]!);
  const next = await open(host(file), browser, sessionStorage(), tabLocks);
  expect(opacityOf(next.storage.getItem(KEY))).toBe(0.4);
  // The open tab's journal is still there (it is that tab's to send).
  expect([...browser.stored.keys()].filter(key => key.startsWith("xfs.workspace.journal")).length).toBeGreaterThanOrEqual(1);
});

test("a journalled draft whose host draft changed since (another tab saved) is kept for recovery, not dropped and not forced", async () => {
  const dir = folder(), file = openWorkspaceFile(dir, STUDIO_DOCUMENTS), browser = browserStorage(), session = sessionStorage();
  const page = host(file), workspace = await open(page, browser, session);
  await workspace.storage.setItem(KEY, collectionWorkspace("Saved"));
  page.hold();
  void workspace.storage.setItem(KEY, collectionWorkspace("Unsent edit"));
  await file.save(false, collectionWorkspace("Another tab's work"), { tab: "other-tab", seq: Date.now() + 10 });
  const reload = await open(host(file), browser, session);
  expect(collectionNames(reload.storage.getItem(KEY))).toEqual({ open: "Another tab's work", recovery: ["Unsent edit"] });
});

test("one write at a time, the newest draft wins, and flush waits for it; a refused write rejects and flush says so", async () => {
  const file = openWorkspaceFile(folder(), STUDIO_DOCUMENTS), page = host(file);
  const { storage, flush } = await open(page, browserStorage());
  page.hold();
  const first = storage.setItem(KEY, draft(0.1));
  await Promise.resolve();
  storage.setItem(KEY, draft(0.2));
  const last = storage.setItem(KEY, draft(0.3));
  expect(page.posts).toHaveLength(1);
  page.release();
  await Promise.all([first, last]);
  // The middle draft was superseded before it went.
  expect(page.posts.map(post => opacityOf(JSON.parse(post.body).workspace))).toEqual([0.1, 0.3]);
  await flush();
  await flush({ "X-XFS-Update-Flush": "nonce" });
  expect(page.posts.at(-1)!.headers["X-XFS-Update-Flush"]).toBe("nonce");
  await expect(storage.setItem(KEY, JSON.stringify({ schema: "xfs/workspace-9" })) as Promise<void>).rejects.toThrow("couldn't be saved");
  await expect(flush()).rejects.toThrow("couldn't be saved");
});

test("keepalive goes by the bytes actually sent, not the draft's length", async () => {
  const file = openWorkspaceFile(folder(), STUDIO_DOCUMENTS), page = host(file);
  const { storage } = await open(page, browserStorage());
  // 40,000 characters that JSON doubles: over the keepalive limit on the wire.
  await (storage.setItem(KEY, "\"".repeat(40_000)) as Promise<void>).catch(() => {});
  await (storage.setItem(KEY, draft(0.6)) as Promise<void>);
  const [quoted, small] = page.posts;
  expect(new TextEncoder().encode(quoted!.body).length).toBeGreaterThan(60_000);
  expect(quoted!.keepalive).toBe(false);
  expect(small!.keepalive).toBe(true);
});

test("a draft too large for browser storage is journalled in its smaller form", async () => {
  const browser = browserStorage(), page = host(openWorkspaceFile(folder(), STUDIO_DOCUMENTS)), session = sessionStorage();
  const { storage } = await open(page, browser, session);
  page.hold();
  void storage.setItem(KEY, "x".repeat(2_100_000), () => draft(0.9));
  const journal = [...browser.stored.entries()].find(([key]) => key.startsWith("xfs.workspace.journal"))!;
  expect(opacityOf(JSON.parse(journal[1]).workspace)).toBe(0.9);
});

test("an unreadable draft is offered Start fresh; nothing changes until then, and the old file is kept", async () => {
  const dir = folder(), file = openWorkspaceFile(dir, STUDIO_DOCUMENTS);
  await file.save(false, draft());
  writeFileSync(resolve(dir, "workspace.json"), "{damaged");
  const page = host(file);
  expect(await openHostWorkspace({ fetch: page.fetch, verification: false, key: KEY, browser: browserStorage({ [KEY]: draft(0.25) }) }))
    .toEqual({ ok: false, file: "workspace.json" });
  expect(readFileSync(resolve(dir, "workspace.json"), "utf8")).toBe("{damaged");
  const kept = await startFreshWorkspace(page.fetch, false);
  expect(kept).toMatch(/^workspace\.broken-.*\.json$/);
  expect(readFileSync(resolve(dir, kept!), "utf8")).toBe("{damaged");
  expect(existsSync(resolve(dir, "workspace.json"))).toBe(false);
});

test("the routes answer local, same-origin pages only", async () => {
  const dir = folder(), file = openWorkspaceFile(dir, STUDIO_DOCUMENTS);
  const post = (origin: string | null, url = `${ORIGIN}/api/workspace`) => workspaceRequest(new Request(url, { method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ workspace: draft() }) }), file);
  expect((await post("https://example.com")).status).toBe(403);
  expect((await post(null)).status).toBe(403);
  expect((await post("http://example.com", "http://example.com/api/workspace")).status).toBe(403);
  expect((await post(ORIGIN, `${ORIGIN}/api/workspace/adopt`)).status).toBe(400);   // no base
  expect(existsSync(resolve(dir, "workspace.json"))).toBe(false);
  expect((await post(ORIGIN)).status).toBe(204);
  expect((await workspaceRequest(new Request(`${ORIGIN}/api/workspace`, { method: "DELETE", headers: { Origin: ORIGIN } }), file)).status).toBe(405);
});
