import { expect, test } from "bun:test";
import { compareVersions, emptyUpdateCheckMemory, newestRelease, parseVersion, UPDATE_RECHECK_MS, UpdateCheckService,
  type ReleaseList, type UpdateCheckMemory } from "../src/update-check";
import { gitHubReleases, RELEASES_API, releasesFromGitHub, simulatedReleases } from "../src/update-check-github";
import { createUpdateCheckHandler, UpdateCheckJsonStore } from "../src/update-check-host";
import { UpdateCheckActions } from "../src/update-check-actions";
import { UPDATE_CHECK_DESCRIPTORS } from "../src/studio-action-descriptors";
import { checkForUpdatesNow, checkingForUpdates, updateCheckLine } from "../src/studio-ui/update-check";

const v = (text: string) => parseVersion(text)!;
const release = (tag: string, prerelease = true) => ({ version: tag.replace(/^v/, ""), tag, prerelease });

test("versions follow SemVer precedence, pre-releases included", () => {
  const ordered = ["0.1.0-alpha", "0.1.0-alpha.1", "0.1.0-alpha.2", "0.1.0-alpha.10", "0.1.0-alpha.beta", "0.1.0-beta", "0.1.0-beta.2",
    "0.1.0-beta.11", "0.1.0-rc.1", "0.1.0", "0.1.1-alpha.1", "0.1.1", "0.2.0", "1.0.0-alpha.1", "1.0.0", "10.0.0"];
  for (let i = 1; i < ordered.length; i++) {
    expect(compareVersions(v(ordered[i - 1]), v(ordered[i])), `${ordered[i - 1]} < ${ordered[i]}`).toBe(-1);
    expect(compareVersions(v(ordered[i]), v(ordered[i - 1]))).toBe(1);
  }
  expect(compareVersions(v("v0.1.0-alpha.2"), v("0.1.0-alpha.2+build.7"))).toBe(0);
  for (const bad of ["", "1.0", "01.0.0", "1.0.0-", "1.0.0-01", "latest", "v1.0.0.0", "1.0.0-alpha..1", 12, null])
    expect(parseVersion(bad), String(bad)).toBeNull();
  expect(newestRelease([release("v0.1.0-alpha.2"), release("nightly"), release("v0.1.0-alpha.10"), release("v0.1.0-alpha.9")]))
    .toEqual(release("v0.1.0-alpha.10"));
  expect(newestRelease([release("notes")])).toBeNull();
});

type Harness = { service: UpdateCheckService; memory: () => UpdateCheckMemory; calls: () => number; clock: { now: number };
  setting: { on: boolean }; answer: { list: ReleaseList } };
function harness(installed = "0.1.0-alpha.2", list: ReleaseList = { ok: true, releases: [release("v0.1.0-alpha.2"), release("v0.1.0-beta.1")] }): Harness {
  let memory = emptyUpdateCheckMemory(), calls = 0;
  const clock = { now: 1_000_000 }, setting = { on: true }, answer = { list };
  const service = new UpdateCheckService({ installed, now: () => clock.now, automatic: () => setting.on,
    store: { load: () => structuredClone(memory), save: next => { memory = structuredClone(next); } },
    releases: async () => { calls++; return answer.list; } });
  return { service, memory: () => memory, calls: () => calls, clock, setting, answer };
}
const signal = () => new AbortController().signal;

test("the check at start runs once per start, reuses a fresh answer and announces a newer version once", async () => {
  const h = harness();
  const first = await h.service.startup(signal());
  expect(first).toMatchObject({ result: "newer", latest: { version: "0.1.0-beta.1" }, announce: true, installed: "0.1.0-alpha.2", automatic: true });
  expect(await h.service.startup(signal())).toMatchObject({ result: "newer", announce: false });
  expect(h.calls()).toBe(1);
  // A new start within a few hours reads what was found, without asking GitHub, and announces it again.
  const next = new UpdateCheckService({ installed: "0.1.0-alpha.2", now: () => h.clock.now + 60_000, automatic: () => true,
    store: { load: () => h.memory(), save: () => {} }, releases: async () => { throw Error("not asked"); } });
  expect(await next.startup(signal())).toMatchObject({ result: "newer", announce: true });
  // Past the interval, a new start asks again.
  const later = harness();
  await later.service.startup(signal());
  later.clock.now += UPDATE_RECHECK_MS + 1;
  const again = new UpdateCheckService({ installed: "0.1.0-alpha.2", now: () => later.clock.now, automatic: () => true,
    store: { load: () => later.memory(), save: () => {} }, releases: async () => ({ ok: true, releases: [release("v0.1.0-alpha.2")] }) });
  expect(await again.startup(signal())).toMatchObject({ result: "current", announce: false });
});

test("the setting off skips the check at start; the person's own check still runs", async () => {
  const h = harness();
  h.setting.on = false;
  expect(await h.service.startup(signal())).toMatchObject({ result: "skipped", announce: false, automatic: false });
  expect(h.calls()).toBe(0);
  expect(await h.service.check(signal())).toMatchObject({ result: "newer", announce: false });
  expect(h.calls()).toBe(1);
});

test("skipping a version stops the check at start announcing it; a newer one is announced again", async () => {
  const h = harness();
  h.service.skip("v0.1.0-beta.1");
  expect(h.memory().skipped).toBe("0.1.0-beta.1");
  expect(await h.service.startup(signal())).toMatchObject({ result: "newer", announce: false });
  // Help still finds it.
  expect(await h.service.check(signal())).toMatchObject({ result: "newer", latest: { version: "0.1.0-beta.1" } });
  const next = new UpdateCheckService({ installed: "0.1.0-alpha.2", now: () => h.clock.now + UPDATE_RECHECK_MS * 2, automatic: () => true,
    store: { load: () => h.memory(), save: () => {} }, releases: async () => ({ ok: true, releases: [release("v0.1.0-beta.2")] }) });
  expect(await next.startup(signal())).toMatchObject({ result: "newer", latest: { version: "0.1.0-beta.2" }, announce: true });
  expect(() => h.service.skip("soon")).toThrow();
});

test("offline and rate-limited checks fail quietly; a rate limit waits a few hours, offline tries again next start", async () => {
  const offline = harness(undefined, { ok: false, reason: "offline" });
  expect(await offline.service.startup(signal())).toMatchObject({ result: "failed", reason: "offline", announce: false });
  expect(offline.memory().checkedAt).toBeNull();
  const limited = harness(undefined, { ok: false, reason: "rate_limited" });
  expect(await limited.service.check(signal())).toMatchObject({ result: "failed", reason: "rate_limited" });
  expect(limited.memory().checkedAt).toBe(limited.clock.now);
  // A throwing source reads as offline; an unknown installed version can't be compared.
  const throwing = new UpdateCheckService({ installed: "0.1.0", now: () => 0, automatic: () => true, store: { load: emptyUpdateCheckMemory, save: () => {} },
    releases: async () => { throw TypeError("fetch failed"); } });
  expect(await throwing.check(signal())).toMatchObject({ result: "failed", reason: "offline" });
  expect(await harness("unavailable").service.check(signal())).toMatchObject({ result: "failed", reason: "unavailable" });
  // Releases older than or equal to this one: up to date.
  expect(await harness("0.2.0").service.check(signal())).toMatchObject({ result: "current", latest: { version: "0.1.0-beta.1" } });
});

test("the GitHub adapter lists published releases, pre-releases included, and names each failure (simulated fetch)", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => async (url: string, init: RequestInit) => {
    seen.push({ url, init }); return new Response(JSON.stringify(body), { status, headers }); };
  const body = [{ tag_name: "v0.1.0-alpha.2", draft: false, prerelease: true }, { tag_name: "v0.2.0", draft: true, prerelease: false },
    { tag_name: "v0.1.0-beta.1", draft: false, prerelease: true }, { name: "no tag", draft: false }];
  expect(await gitHubReleases(answer(200, body))(signal())).toEqual({ ok: true, releases: [release("v0.1.0-alpha.2"), release("v0.1.0-beta.1")] });
  expect(seen[0].url).toBe(RELEASES_API);
  expect((seen[0].init.headers as Record<string, string>).Accept).toBe("application/vnd.github+json");
  expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
  expect(await gitHubReleases(answer(403, { message: "rate limit" }, { "x-ratelimit-remaining": "0" }))(signal())).toEqual({ ok: false, reason: "rate_limited" });
  expect(await gitHubReleases(answer(429, {}))(signal())).toEqual({ ok: false, reason: "rate_limited" });
  expect(await gitHubReleases(answer(500, {}))(signal())).toEqual({ ok: false, reason: "unavailable" });
  expect(await gitHubReleases(answer(200, { not: "a list" }))(signal())).toEqual({ ok: false, reason: "unavailable" });
  expect(await gitHubReleases(async () => { throw TypeError("network"); })(signal())).toEqual({ ok: false, reason: "offline" });
  // An aborted check stops the request.
  const aborted = new AbortController(); aborted.abort();
  expect(await gitHubReleases(async (_url, init) => { if (init.signal?.aborted) throw init.signal.reason; return new Response("[]"); })(aborted.signal))
    .toEqual({ ok: false, reason: "unavailable" });
  // A request that never answers gives up as offline.
  expect(await gitHubReleases((_url, init) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
    { timeoutMs: 5 })(signal())).toEqual({ ok: false, reason: "offline" });
  expect(releasesFromGitHub([{ tag_name: "x".repeat(65), draft: false }])).toEqual([]);
  expect(await simulatedReleases("current", "0.1.0-alpha.2")(signal())).toEqual({ ok: true, releases: [release("v0.1.0-alpha.2")] });
});

/** A release source held until `answer()`, which rejects as the GitHub adapter does when its signal aborts. */
function heldSource(list: ReleaseList = { ok: true, releases: [release("v0.1.0-alpha.2"), release("v0.1.0-beta.1")] }) {
  const pending: { signal: AbortSignal; resolve: (list: ReleaseList) => void }[] = [];
  const source = (signal: AbortSignal) => new Promise<ReleaseList>((resolve, reject) => {
    const call = { signal, resolve };
    pending.push(call);
    signal.addEventListener("abort", () => { pending.splice(pending.indexOf(call), 1); reject(signal.reason); }, { once: true });
  });
  return { source, pending, answer: () => { for (const call of pending.splice(0)) call.resolve(list); } };
}
function heldService(held: ReturnType<typeof heldSource>) {
  let memory = emptyUpdateCheckMemory();
  return new UpdateCheckService({ installed: "0.1.0-alpha.2", now: () => 1_000_000, automatic: () => true, releases: held.source,
    store: { load: () => structuredClone(memory), save: next => { memory = structuredClone(next); } } });
}
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test("checks made while one is running join its one request, which stops only when every one of them has been aborted (UPD-01, UPD-04)", async () => {
  // The person's check during the check at start: aborting the check at start leaves the request running for the person.
  {
    const held = heldSource(), service = heldService(held);
    const a = new AbortController(), b = new AbortController();
    const startup = service.startup(a.signal), manual = service.check(b.signal);
    expect(held.pending.length).toBe(1);
    a.abort();
    expect(await startup).toMatchObject({ result: "failed", reason: "unavailable", announce: false });
    expect(held.pending[0].signal.aborted).toBe(false);
    held.answer();
    expect(await manual).toMatchObject({ result: "newer", latest: { version: "0.1.0-beta.1" }, announce: false });
  }
  // Both joined and neither aborted: one request, and each caller gets its own answer (only the check at start announces).
  {
    const held = heldSource(), service = heldService(held);
    const startup = service.startup(new AbortController().signal), manual = service.check(new AbortController().signal);
    expect(held.pending.length).toBe(1);
    held.answer();
    expect(await startup).toMatchObject({ result: "newer", announce: true });
    expect(await manual).toMatchObject({ result: "newer", announce: false });
  }
  // Every joined check aborted: the request is abandoned.
  {
    const held = heldSource(), service = heldService(held);
    const a = new AbortController(), b = new AbortController();
    const first = service.check(a.signal), second = service.check(b.signal);
    const request = held.pending[0].signal;
    a.abort();
    expect(request.aborted).toBe(false);
    b.abort();
    expect(request.aborted).toBe(true);
    expect(held.pending.length).toBe(0);
    expect(await first).toMatchObject({ result: "failed" });
    expect(await second).toMatchObject({ result: "failed" });
  }
});

test("an aborted or failed check at start leaves the next start free to ask (UPD-02)", async () => {
  const held = heldSource(), service = heldService(held);
  const first = new AbortController();
  const aborted = service.startup(first.signal);
  first.abort();
  expect(await aborted).toMatchObject({ result: "failed" });
  await flush();
  const second = service.startup(new AbortController().signal);
  expect(held.pending.length).toBe(1);
  held.answer();
  expect(await second).toMatchObject({ result: "newer", announce: true });
  // Once one has finished, the check at start doesn't ask again this run.
  expect(await service.startup(new AbortController().signal)).toMatchObject({ result: "newer", announce: false });
  expect(held.pending.length).toBe(0);
  // Offline: the next start asks again.
  const offline = harness(undefined, { ok: false, reason: "offline" });
  await offline.service.startup(signal());
  await offline.service.startup(signal());
  expect(offline.calls()).toBe(2);
});

test("the person's check made while the check at start is waiting on GitHub says what it found (UPD-01)", async () => {
  const held = heldSource(), service = heldService(held);
  // The host's endpoint, as the page reaches it: a request whose signal aborts rejects, as fetch does.
  const actions = new UpdateCheckActions((body, sent) => new Promise((resolve, reject) => {
    sent.addEventListener("abort", () => reject(sent.reason), { once: true });
    const answer = body.action === "skip" ? Promise.resolve(service.skip(body.version)) : body.action === "check" ? service.check(sent) : service.startup(sent);
    answer.then(data => resolve({ ok: true, status: 200, data }), reject);
  }));
  const startup = actions.dispatch({ kind: "updates.startupCheck" });
  await flush();
  expect(held.pending.length).toBe(1);
  const manual = actions.dispatch({ kind: "updates.check" });
  await flush();
  held.answer();
  expect(await manual).toMatchObject({ ok: true, answer: { result: "newer", latest: { version: "0.1.0-beta.1" } } });
  expect(await startup).toMatchObject({ ok: true, answer: { result: "newer" } });
  expect(actions.snapshot()).toMatchObject({ busy: null, checkedByPerson: true, unreachable: false });
});

test("the person's check sets aside a check at start still in its quiet wait, and nothing is asked for it", async () => {
  const held = heldSource(), service = heldService(held);
  const timers: (() => void)[] = [];
  const actions = new UpdateCheckActions(async (body, sent) => ({ ok: true, status: 200,
    data: body.action === "skip" ? service.skip(body.version) : body.action === "check" ? await service.check(sent) : await service.startup(sent) }),
    { after: (_ms, run, stop) => { if (!stop?.aborted) timers.push(run); } });
  const startup = actions.dispatch({ kind: "updates.startupCheck" });
  const manual = actions.dispatch({ kind: "updates.check" });
  expect(await startup).toMatchObject({ ok: false, code: "cancelled" });
  await flush();
  expect(held.pending.length).toBe(1);
  held.answer();
  expect(await manual).toMatchObject({ ok: true, answer: { result: "newer" } });
  for (const run of timers) run();
  await flush();
  expect(held.pending.length).toBe(0);
});

test("the host keeps what was found in a file and serves the check to the page only", async () => {
  let saved: string | null = null;
  const file = { read: () => saved, write: (text: string) => { saved = text; } };
  {
    const store = new UpdateCheckJsonStore(file);
    expect(store.load()).toEqual(emptyUpdateCheckMemory());
    const service = new UpdateCheckService({ installed: "0.1.0-alpha.2", now: () => 5, automatic: () => true, store,
      releases: simulatedReleases("newer", "0.1.0-alpha.2") });
    const handle = createUpdateCheckHandler(service);
    const origin = "http://127.0.0.1:4390";
    const post = (body: unknown, headers: Record<string, string> = { Origin: origin, "Content-Type": "application/json" }) =>
      handle(new Request(`${origin}/api/update-check`, { method: "POST", headers, body: JSON.stringify(body) }));
    const started = await (await post({ action: "startup" })).json();
    expect(started).toMatchObject({ schema: "xfs/update-check-1", result: "newer", announce: true, latest: { version: "0.2.0-beta.1" } });
    expect(JSON.parse(saved!)).toMatchObject({ checkedAt: 5, latest: { tag: "v0.2.0-beta.1" } });
    expect(await (await post({ action: "skip", version: "0.2.0-beta.1" })).json()).toMatchObject({ result: "newer" });
    expect(new UpdateCheckJsonStore(file).load().skipped).toBe("0.2.0-beta.1");
    expect((await post({ action: "check" }, { Origin: "https://example.test", "Content-Type": "application/json" })).status).toBe(403);
    expect((await post({ action: "check", url: "https://example.test" })).status).toBe(400);
    expect((await post({ action: "skip", version: "../x" })).status).toBe(400);
    // Only the page's POSTs are served: there is no read-only GET (UPD-03).
    expect((await handle(new Request(`${origin}/api/update-check`))).status).toBe(405);
    saved = "{ not json";
    expect(new UpdateCheckJsonStore(file).load()).toEqual(emptyUpdateCheckMemory());
  }
});

test("the page's actions are catalogued, pre-empt the check at start, and say plainly what was found", async () => {
  expect(UPDATE_CHECK_DESCRIPTORS).toEqual({
    "updates.startupCheck": { scope: ["host"], effect: "read", payload: {}, async: true, cancellable: true },
    "updates.check": { scope: ["host"], effect: "read", payload: {}, async: true, cancellable: true },
    "updates.skipVersion": { scope: ["host"], effect: "save", payload: { version: { type: "string", required: true, from: "target" } }, async: true, cancellable: false },
  });
  const none = new UpdateCheckActions(null);
  expect(none.descriptors()).toEqual(UPDATE_CHECK_DESCRIPTORS);
  expect(none.capability({ kind: "updates.check" })).toMatchObject({ available: false, code: "unavailable" });
  expect(none.capability({ kind: "nope" } as never)).toMatchObject({ available: false, code: "invalid_value" });

  const service = new UpdateCheckService({ installed: "0.1.0-alpha.2", now: () => 1, automatic: () => true,
    store: { load: emptyUpdateCheckMemory, save: () => {} }, releases: simulatedReleases("newer", "0.1.0-alpha.2") });
  let startupSignal: AbortSignal | null = null, holdStartup: (() => void) | null = null;
  const actions = new UpdateCheckActions(async (body, sent) => {
    if (body.action === "startup") { startupSignal = sent; await new Promise<void>(resolve => { holdStartup = resolve; }); }
    const answer = body.action === "skip" ? service.skip(body.version) : body.action === "check" ? await service.check(sent) : await service.startup(sent);
    return { ok: true, status: 200, data: answer };
  });
  const startup = actions.dispatch({ kind: "updates.startupCheck" });
  expect(actions.snapshot().busy).toBe("updates.startupCheck");
  expect(updateCheckLine(actions.snapshot())).toBeNull();
  const manual = actions.dispatch({ kind: "updates.check" });
  // The check at start was already sent, so it is left to finish (the host joins the two; UPD-01).
  expect(startupSignal!.aborted).toBe(false);
  // A check still running has no line of its own: views keep the last result and show the check on their button.
  expect(checkingForUpdates(actions.snapshot())).toBe(true);
  expect(updateCheckLine(actions.snapshot())).toBeNull();
  expect(await manual).toMatchObject({ ok: true, answer: { result: "newer" } });
  holdStartup!();
  await startup;
  expect(actions.snapshot().busy).toBeNull();
  expect(checkingForUpdates(actions.snapshot())).toBe(false);
  expect(updateCheckLine(actions.snapshot())).toEqual({ text: "XF Studio 0.2.0-beta.1 is available. You have 0.1.0-alpha.2.", releases: true });
  expect(updateCheckLine(actions.snapshot(), { releasesBelow: true }))
    .toEqual({ text: "XF Studio 0.2.0-beta.1 is available. Download it from XF Studio releases below.", releases: true });

  const current = { busy: null, checkedByPerson: true, unreachable: false,
    answer: { schema: "xfs/update-check-1", installed: "0.1.0-alpha.2", result: "current", latest: null, reason: null, announce: false, automatic: true, checkedAt: 1 } } as const;
  expect(updateCheckLine(current)).toEqual({ text: "You have the newest version, 0.1.0-alpha.2.", releases: false });
  expect(updateCheckLine({ ...current, answer: { ...current.answer, result: "failed", reason: "offline" } }))
    .toEqual({ text: "XF Studio couldn't check for updates just now. New versions are always on the releases page.", releases: true });
  // The check at start's quiet failure says nothing until the person asks.
  expect(updateCheckLine({ ...current, checkedByPerson: false, answer: { ...current.answer, result: "failed", reason: "offline" } })).toBeNull();
  const unreachable = new UpdateCheckActions(async () => { throw TypeError("host gone"); });
  expect(await unreachable.dispatch({ kind: "updates.check" })).toMatchObject({ ok: false, code: "transport" });
  expect(updateCheckLine(unreachable.snapshot())?.releases).toBe(true);
});

test("the check at start waits for a quiet moment, announces a newer version once, and Skip this version stops it", async () => {
  const { startupUpdateCheck } = await import("../src/studio-ui/update-check");
  let memory = emptyUpdateCheckMemory(), on = true;
  const service = () => new UpdateCheckService({ installed: "0.1.0-alpha.2", now: () => 1, automatic: () => on,
    store: { load: () => memory, save: next => { memory = next; } }, releases: simulatedReleases("newer", "0.1.0-alpha.2") });
  const start = async () => {
    const host = service(), toasts: { message: string; actions: { label: string; run(): void }[] }[] = [];
    const waits: number[] = [];
    let idle: (() => void) | null = null;
    const actions = new UpdateCheckActions(async (body, sent) => ({ ok: true, status: 200,
      data: body.action === "skip" ? host.skip(body.version) : body.action === "startup" ? await host.startup(sent) : await host.check(sent) }),
      { frame: run => run(0), after: (ms, run) => { waits.push(ms); idle = run; } });
    const rt = { port: { updates: actions, links: { open: async () => ({ ok: true as const }) } },
      feedback: { toast: (_tone: string, _source: string, message: string, list: { label: string; run(): void }[] = []) => { toasts.push({ message, actions: list }); return () => {}; },
        record: () => {} }, changed: () => {} };
    startupUpdateCheck(rt as never);
    expect(toasts).toEqual([]);
    expect(waits).toEqual([2000]);
    idle!();
    await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0));
    return toasts;
  };
  const first = await start();
  expect(first.map(toast => toast.message)).toEqual(["XF Studio 0.2.0-beta.1 is available. You have 0.1.0-alpha.2."]);
  expect(first[0].actions.map(action => action.label)).toEqual(["Open the releases page", "Skip this version"]);
  first[0].actions[1].run();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(memory.skipped).toBe("0.2.0-beta.1");
  expect(await start()).toEqual([]);
  memory = emptyUpdateCheckMemory(); on = false;
  expect(await start()).toEqual([]);
});

test("the palette's check says it's checking at once, closes that notice before the answer, and couldn't-check is info", async () => {
  const run = async (kind: "newer" | "current" | "offline") => {
    const host = new UpdateCheckService({ installed: "0.1.0-alpha.2", now: () => 1, automatic: () => true,
      store: { load: emptyUpdateCheckMemory, save: () => {} }, releases: simulatedReleases(kind, "0.1.0-alpha.2") });
    let release: (() => void) | null = null;
    const actions = new UpdateCheckActions(async (_body, sent) => {
      await new Promise<void>(resolve => { release = resolve; });
      return { ok: true, status: 200, data: await host.check(sent) };
    });
    const events: string[] = [];
    const rt = { port: { updates: actions, links: { open: async () => ({ ok: true as const }) } }, changed: () => {},
      feedback: { toast: (tone: string, _source: string, message: string) => { events.push(`${tone}: ${message}`); return () => { events.push(`closed: ${message}`); }; },
        record: () => {} } };
    const done = checkForUpdatesNow(rt as never, true);
    expect(events).toEqual(["info: Checking for updates…"]);
    release!();
    await done;
    return events;
  };
  expect(await run("current")).toEqual(["info: Checking for updates…", "closed: Checking for updates…", "success: You have the newest version, 0.1.0-alpha.2."]);
  expect((await run("offline")).slice(1))
    .toEqual(["closed: Checking for updates…", "info: XF Studio couldn't check for updates just now. New versions are always on the releases page."]);
  expect((await run("newer")).slice(1)).toEqual(["closed: Checking for updates…", "info: XF Studio 0.2.0-beta.1 is available. You have 0.1.0-alpha.2."]);
});
