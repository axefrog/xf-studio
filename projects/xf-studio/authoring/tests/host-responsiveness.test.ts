// The host keeps answering while choices are prepared ahead (research/backlog/performance.md, scheduling rule): checking a row's
// choices gives the event loop a turn between choices and between a manifest's entries (event-loop.ts), and a person's request stops the
// batch being prepared ahead. Synthetic work stands in for the manifest checks; no game file is read.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CharacterDetailHost, PREVIEW_DERIVE_WAIT_MS, QUIET_MS, type CharacterDetailSettings } from "../src/character-detail-host";
import { DEFAULT_CHARACTER, type CharacterRequest } from "../src/character-detail-request";
import { CHOICE_MANIFEST_SCHEMA, manifestProblemSliced, type ChoiceManifest, type ManifestCheck } from "../src/choice-manifest";
import { ChoicePrefetcher, type PrefetchDeps } from "../src/choice-prefetch";
import { timeSlicer } from "../src/event-loop";
import { withArchiveFingerprints } from "../src/resolver-host";
import { REQUEST_A } from "./character-detail-fixtures";

const busy = (ms: number) => { const until = performance.now() + ms; while (performance.now() < until) { /* Synchronous work, like a manifest check. */ } };
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const withChoice = (position: number): CharacterRequest => ({ ...DEFAULT_CHARACTER, choices: [{ part: "head", option: "hair", choice: `c${position}` }] });

/** The longest the event loop went without running a 5 ms timer while `work` ran: what a waiting request would have waited at most. */
async function longestStall(work: () => Promise<unknown>): Promise<number> {
  let last = performance.now(), longest = 0, running = true;
  const probe = async () => { while (running) { await sleep(5); const now = performance.now(); longest = Math.max(longest, now - last); last = now; } };
  const probing = probe();
  await work();
  running = false;
  await probing;
  return longest;
}

const services: ChoicePrefetcher[] = [];
afterEach(() => { for (const service of services.splice(0)) service.cancel(); });

/** A row of `count` choices whose readiness checks each take `ms` of synchronous work, with the host's slicer or none. */
function row(count: number, ms: number, slicer?: PrefetchDeps["slicer"]) {
  let checked = 0;
  let done!: () => void;
  const finished = new Promise<void>(resolve => { done = resolve; });
  const deps: PrefetchDeps = {
    requestFor: async (_base, _option, position) => withChoice(position),
    readiness: async () => () => { busy(ms); if (++checked === count) done(); return true; },
    warm: async requests => requests.map(() => ({ ready: true })),
    foregroundIdle: async () => {},
    preparedBytes: async () => 0,
    ...(slicer ? { slicer } : {}),
  };
  const service = new ChoicePrefetcher(deps, { batch: 8, maxBatch: 8, timeMs: 60_000, bytes: 1e12 });
  services.push(service);
  return { start: () => service.update({ base: DEFAULT_CHARACTER, option: "head/hair", positions: Array.from({ length: count }, (_, i) => i) }), finished };
}

describe("the host answers while a row's choices are checked", () => {
  test("checking 40 choices never holds a waiting request back for more than a slice and one check", async () => {
    const { start, finished } = row(40, 10);
    const stall = await longestStall(async () => { start(); await finished; });
    // 40 checks of 10 ms are 400 ms of work; a request waits at most about one check plus a slice.
    expect(stall).toBeLessThan(200);
  });

  test("without the turn between choices the same check held every request back for the whole row (the regression)", async () => {
    const { start, finished } = row(40, 10, () => async () => {});
    const stall = await longestStall(async () => { start(); await finished; });
    expect(stall).toBeGreaterThan(350);
  });

  test("a manifest of many entries is checked in slices, so a waiting request is answered between them", async () => {
    const entries = 60;
    const manifest: ChoiceManifest = { schema: CHOICE_MANIFEST_SCHEMA, tool: "t", xl: "x",
      reads: Array.from({ length: entries }, (_, i) => [String(1000 + i), String(1000 + i), "archive"] as [string, string, string]), exports: [] };
    const winner = { id: "archive", name: "archive" };
    const check = { tool: "t", xl: "x", gameRoot: "", exporter: { has: () => true },
      graph: { locate: (ref: { hash: bigint }) => ({ entry: { hash: String(ref.hash) }, lookup: { winner } }) },
      fetcher: { isCached: () => { busy(5); return true; } } } as unknown as ManifestCheck;
    let problem: string | null = "unset";
    const stall = await longestStall(async () => {
      problem = await manifestProblemSliced(manifest, check, timeSlicer(), run => withArchiveFingerprints(run, new Map()));
    });
    expect(problem).toBeNull();
    // 60 entries of 5 ms: 300 ms of work, answered between slices.
    expect(stall).toBeLessThan(150);
  });
});

describe("a person's request pre-empts preparing ahead", () => {
  test("pause stops the batch being prepared; its choices are queued again and prepared once the host is quiet", async () => {
    let stopped = 0, batches = 0;
    let quiet!: () => void;
    let foreground: Promise<void> = Promise.resolve();
    const deps: PrefetchDeps = {
      requestFor: async (_base, _option, position) => withChoice(position),
      readiness: async () => () => false,
      warm: (requests, signal) => new Promise((resolve, reject) => {
        batches++;
        // A stopped batch answers at once (the host's `untilStopped`), its reads finishing behind it.
        signal.addEventListener("abort", () => { stopped++; reject(new DOMException("Stopped.", "AbortError")); }, { once: true });
        if (batches > 1) resolve(requests.map(() => ({ ready: true })));
      }),
      foregroundIdle: () => foreground,
      preparedBytes: async () => 0,
    };
    const service = new ChoicePrefetcher(deps, { batch: 2, maxBatch: 2, timeMs: 60_000, bytes: 1e12 });
    services.push(service);
    const ask = () => service.update({ base: DEFAULT_CHARACTER, option: "head/hair", positions: [0, 1] });
    ask();
    for (let i = 0; i < 20 && batches === 0; i++) await sleep(2);
    expect(service.preparing).toBe(true);
    // The person asks for a change: the host holds background work until it is quiet again.
    foreground = new Promise(resolve => { quiet = resolve; });
    service.pause();
    for (let i = 0; i < 20 && service.preparing; i++) await sleep(2);
    expect(stopped).toBe(1);
    expect(service.preparing).toBe(false);
    expect(ask().states).toBe("qq");
    quiet();
    for (let i = 0; i < 50 && ask().states !== "rr"; i++) await sleep(2);
    expect(ask().states).toBe("rr");
  });
});

describe("the character-detail host puts a person first", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-host-first-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const settings: CharacterDetailSettings = { gameRoot: join(root, "game"), launchRoute: "direct", mo2Root: null, mo2ProfileId: null,
    manualModRoot: null, wolvenKitCli: process.execPath };

  test("a preview derivation waits a few seconds at most for the background lane, and not at all once the page went away (PREV-153)", async () => {
    let prepared = 0;
    const host = new CharacterDetailHost({ cacheRoot: join(root, "derive"), settings: () => settings,
      prepare: async () => { prepared++; return { record: {} as never, recordFile: `${"d".repeat(64)}.json`, degraded: false }; } });
    // A person's request is being answered the whole time: the lane never frees.
    (host as unknown as { asking: number }).asking = 1;
    const derive = (signal?: AbortSignal) => (host as unknown as { derivePreview(...args: unknown[]): Promise<unknown> })
      .derivePreview(REQUEST_A, "hair", {}, "k".repeat(40), "1:1", signal);
    const gone = new AbortController();
    gone.abort();
    let began = performance.now();
    expect(await derive(gone.signal)).toBe("busy");
    expect(performance.now() - began).toBeLessThan(50);
    began = performance.now();
    const leaving = new AbortController();
    setTimeout(() => leaving.abort(), 150);
    expect(await derive(leaving.signal)).toBe("busy");
    expect(performance.now() - began).toBeLessThan(600);
    began = performance.now();
    expect(await derive()).toBe("busy");
    expect(performance.now() - began).toBeLessThan(PREVIEW_DERIVE_WAIT_MS + 500);
    expect(prepared).toBe(0);
  }, 10_000);

  test("a request stops the batch prepared ahead, even when its answer is ready, and the next batch waits until the page is quiet", async () => {
    const host = new CharacterDetailHost({ cacheRoot: join(root, "host"), settings: () => settings,
      prepare: async () => ({ record: {} as never, recordFile: `${"d".repeat(64)}.json`, degraded: false }) });
    let paused = 0;
    const pause = host.prefetch.pause.bind(host.prefetch);
    host.prefetch.pause = () => { paused++; pause(); };
    // The first request prepares; the same request again is answered ready at once, and still pre-empts preparing ahead.
    host.request(REQUEST_A, "page");
    await host.settled();
    expect(host.request(REQUEST_A, "page").phase).toBe("ready");
    expect(paused).toBe(2);
    // Background work waits for the page to be quiet: it reads the new record's files right after the answer.
    const idle = (host as unknown as { foregroundIdle(): Promise<void> }).foregroundIdle();
    let resumed = false;
    void idle.then(() => { resumed = true; });
    await sleep(QUIET_MS / 4);
    host.noteAsk();
    await sleep(QUIET_MS / 2);
    expect(resumed).toBe(false);
    await sleep(QUIET_MS + 50);
    expect(resumed).toBe(true);
  });
});
