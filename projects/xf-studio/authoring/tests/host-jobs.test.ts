// The host on its job scheduler (host-jobs.ts, character-detail-host.ts): what a person's change, a page's lease, a committed derivation
// and the resolver's lanes do together. Fakes stand in for the preparation and WolvenKit; no game file is read.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CharacterDetailHost, PAGE_LEASE_MS, type CharacterDetailSettings } from "../src/character-detail-host";
import type { CharacterRequest } from "../src/character-detail-request";
import { currentLane, hostJobs, lowPriorityNow, personWorking } from "../src/host-jobs";
import type { Clock } from "../src/platform/core/clock";
import { WolvenKitFetcher } from "../src/resolver-host";
import { REQUEST_A, REQUEST_B } from "./character-detail-fixtures";
import { cr2w } from "./resolver-fixtures";

const root = mkdtempSync(join(tmpdir(), "xfs-host-jobs-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const settings: CharacterDetailSettings = { gameRoot: join(root, "game"), launchRoute: "direct", mo2Root: null, mo2ProfileId: null,
  manualModRoot: null, wolvenKitCli: process.execPath };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (done: () => boolean, ms = 2000) => { for (const end = Date.now() + ms; !done() && Date.now() < end;) await sleep(2); };
const name = (request: CharacterRequest) => request.source === "save" ? request.appearances[0]!.option : "default";
const record = (letter: string) => ({ record: { components: [] } as never, recordFile: `${letter.repeat(64)}.json`, degraded: false });

describe("the character-detail host on its scheduler", () => {
  test("two pages asking for the same V share one run", async () => {
    let runs = 0;
    const host = new CharacterDetailHost({ cacheRoot: join(root, "same"), settings: () => settings,
      prepare: async () => { runs++; await sleep(30); return record("a"); } });
    const one = host.request(REQUEST_A, "page-1"), two = host.request(REQUEST_A, "page-2");
    expect(two.key).toBe(one.key);
    await host.settled();
    expect(runs).toBe(1);
    expect(host.state(one.key).phase).toBe("ready");
  });

  test("a person's change during a derivation that is already writing waits for it, and the derived source is kept", async () => {
    const log: string[] = [];
    let finishWriting!: () => void;
    const host = new CharacterDetailHost({ cacheRoot: join(root, "committed"), settings: () => settings,
      prepare: async options => {
        if (options.skipDangles) {
          log.push("derive start");
          options.progress?.("writing", 3, 4, "writing");
          await new Promise<void>(resolve => { finishWriting = resolve; });
          log.push(options.signal?.aborted ? "derive stopped" : "derive end");
          return record("d");
        }
        log.push(`prepare ${name(options.request)}`);
        return record("e");
      } });
    const derive = (host as unknown as { derivePreview(...args: unknown[]): Promise<unknown> }).derivePreview(REQUEST_A, "hair", {}, "k".repeat(40), "1:1");
    await until(() => log.length > 0);
    expect(log).toEqual(["derive start"]);
    host.request(REQUEST_B, "page");
    await sleep(30);
    // Past its threshold: not stopped, and the person's change waits.
    expect(log).toEqual(["derive start"]);
    finishWriting();
    await host.settled();
    expect(log).toEqual(["derive start", "derive end", "prepare skin_type_03"]);
    // Derived (not `busy`, not stopped).
    expect(await derive).not.toBe("busy");
  });

  test("a page that stops asking (closed) stops its V's preparation once its lease runs out; one that keeps polling keeps it", async () => {
    const timers: { at: number; run: () => void; signal?: AbortSignal }[] = [];
    let now = 0;
    const clock: Clock = { now: () => now, monotonic: () => now, after: (ms, run, signal) => { timers.push({ at: now + ms, run, signal }); }, frame() {} };
    const advance = (ms: number) => {
      now += ms;
      for (let again = true; again;) {
        again = false;
        for (const timer of [...timers]) if (timer.at <= now) { timers.splice(timers.indexOf(timer), 1); if (!timer.signal?.aborted) { timer.run(); again = true; } }
      }
    };
    const log: string[] = [];
    const host = new CharacterDetailHost({ cacheRoot: join(root, "lease"), settings: () => settings, clock,
      prepare: options => new Promise((resolve, reject) => {
        log.push(`start ${name(options.request)}`);
        options.signal?.addEventListener("abort", () => { log.push(`stopped ${name(options.request)}`); reject(Error("stopped")); }, { once: true });
        if (options.request === REQUEST_B) setTimeout(() => resolve(record("b")), 50);
      }) });
    const closed = host.request(REQUEST_A, "closed-page");
    await until(() => log.length > 0);
    advance(PAGE_LEASE_MS / 2);
    host.state(closed.key);
    advance(PAGE_LEASE_MS - 1);
    expect(log).toEqual(["start skin_type_01"]);
    advance(2);
    await until(() => log.length > 1);
    expect(log).toEqual(["start skin_type_01", "stopped skin_type_01"]);
    await host.settled();
    expect(host.state(closed.key).phase).toBe("unknown");
    // Another page's V, polled, is prepared to its end.
    const open = host.request(REQUEST_B, "open-page");
    await host.settled();
    expect(host.state(open.key).phase).toBe("ready");
  });

  test("Clear waits for a stopped batch's reads to let go, and a person's change asked meanwhile runs after it (CORE-108, PREV-102)", async () => {
    const log: string[] = [];
    let letGo!: () => void;
    const cacheRoot = join(root, "clear");
    mkdirSync(join(cacheRoot, "characters", "files"), { recursive: true });
    writeFileSync(join(cacheRoot, "characters", "files", "x.png"), "x".repeat(100));
    const host = new CharacterDetailHost({ cacheRoot, settings: () => settings,
      prepare: async options => { log.push(`prepare ${name(options.request)}`); return record("c"); } });
    host.jobs.want("prefetch", { key: "batch", lane: "ahead", run: async context => {
      log.push("batch");
      context.afterwards(new Promise<void>(resolve => { letGo = () => { log.push("batch let go"); resolve(); }; }));
    } });
    await until(() => log.includes("batch"));
    const clearing = host.clearPreparedFiles();
    host.request(REQUEST_A, "page");
    await sleep(30);
    expect(log).toEqual(["batch"]);
    letGo();
    expect((await clearing).freed).toBe(100);
    await host.settled();
    expect(log).toEqual(["batch", "batch let go", "prepare skin_type_01"]);
    expect(readdirSync(join(cacheRoot, "characters"))).toEqual([]);
  });
});

describe("the lanes below a job (host-jobs.ts)", () => {
  test("code below a job knows its lane; a person's job makes background launches normal priority", async () => {
    const jobs = hostJobs({ quietMs: 0 });
    const seen: unknown[] = [];
    const ahead = jobs.want("prefetch", { key: "a", lane: "ahead", run: async () => { await sleep(1); seen.push(currentLane(), personWorking(), lowPriorityNow()); } });
    await ahead.settled;
    const person = jobs.want("page/character", { key: "p", lane: "person", run: async () => { await sleep(1); seen.push(currentLane(), personWorking(), lowPriorityNow()); } });
    await person.settled;
    expect(seen).toEqual(["ahead", false, true, "person", true, false]);
    expect(currentLane()).toBeNull();
    expect(personWorking()).toBe(false);
  });

  test("a person who needs a resource in a batch prepared ahead raises its priority (PIPE-96)", async () => {
    const cache = join(root, "raise-cache"), archivePath = join(root, "a.archive");
    writeFileSync(archivePath, "archive");
    const archive = { id: archivePath, name: "a.archive", virtualPath: "archive/pc/content/a.archive", group: "content", provider: "game", providerName: "game", rank: 0, shadowed: [] };
    const fetcher = new WolvenKitFetcher("WolvenKit.CLI.exe", cache, () => true);
    const launches: { hashes: string; low: boolean }[] = [];
    let releaseFirst!: () => void;
    const first = new Promise<void>(resolve => { releaseFirst = resolve; });
    (fetcher as unknown as { run: unknown }).run = async (args: string[], options: { lowPriority?: boolean }) => {
      if (args[0] === "unbundle") {
        const out = args[args.indexOf("-o") + 1]!, list = readFileSync(args[args.indexOf("--hash") + 1]!, "utf8").split(/\r?\n/).filter(Boolean);
        launches.push({ hashes: list.join(","), low: !!options.lowPriority });
        if (list.includes("1")) await first;
        mkdirSync(out, { recursive: true });
        for (const hash of list) writeFileSync(join(out, `${hash}.app`), "raw");
      }
      if (args[0] === "convert") for (const file of readdirSync(args[2]!)) if (!file.endsWith(".json")) writeFileSync(join(args[2]!, `${file}.json`), JSON.stringify(cr2w({ $type: "x" })));
      return { exitCode: 0, stdout: "", stderr: "", output: "" };
    };
    const jobs = hostJobs({ quietMs: 0 });
    // A batch prepared ahead: one resource in WolvenKit, a second queued behind it.
    let queued!: Promise<unknown>;
    jobs.want("prefetch", { key: "batch", lane: "ahead", run: async context => {
      const slow = fetcher.fetch(archive as never, { hash: "1", path: null }, "app");
      await sleep(60);
      queued = fetcher.fetch(archive as never, { hash: "3", path: null }, "app");
      context.afterwards(Promise.all([slow, queued]));
      await new Promise(resolve => context.signal.addEventListener("abort", resolve, { once: true }));
    } });
    await until(() => !!queued);
    // A person's change now waits on the queued resource: the batch stops, and the launch it waits on starts at normal priority.
    const person = jobs.want("page/character", { key: "v", lane: "person", run: async () => { releaseFirst(); return queued; } });
    expect((await person.settled).status).toBe("done");
    expect(launches).toEqual([{ hashes: "1", low: true }, { hashes: "3", low: false }]);
  });
});

describe("review fixes", () => {
  test("a running job a person now wants counts as person work from then on: background launches go to normal priority (review 3)", async () => {
    const jobs = hostJobs({ quietMs: 0 });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const seen: unknown[] = [];
    const shared = async () => { await sleep(1); seen.push(currentLane(), personWorking()); await gate; seen.push(currentLane(), personWorking(), lowPriorityNow()); };
    jobs.want("prefetch", { key: "shared", lane: "ahead", run: shared });
    await until(() => seen.length === 2);
    expect(personWorking()).toBe(false);
    jobs.want("page/character", { key: "shared", lane: "person", run: shared });
    expect(personWorking()).toBe(true);
    release();
    await jobs.idle();
    expect(seen).toEqual(["ahead", false, "person", true, false]);
    expect(personWorking()).toBe(false);
  });

  test("a V whose page went away before it started isn't reported as preparing (review 5)", async () => {
    const timers: { at: number; run: () => void; signal?: AbortSignal }[] = [];
    let now = 0;
    const clock: Clock = { now: () => now, monotonic: () => now, after: (ms, run, signal) => { timers.push({ at: now + ms, run, signal }); }, frame() {} };
    const advance = (ms: number) => {
      now += ms;
      for (let again = true; again;) {
        again = false;
        for (const timer of [...timers]) if (timer.at <= now) { timers.splice(timers.indexOf(timer), 1); if (!timer.signal?.aborted) { timer.run(); again = true; } }
      }
    };
    let finish!: () => void;
    const host = new CharacterDetailHost({ cacheRoot: join(root, "lease-queued"), settings: () => settings, clock,
      prepare: options => options.request === REQUEST_A ? new Promise(resolve => { finish = () => resolve(record("a")); }) : Promise.resolve(record("b")) });
    const kept = host.request(REQUEST_A, "open-page");
    const gone = host.request(REQUEST_B, "closed-page");
    expect(host.state(gone.key).phase).toBe("preparing");
    // The open page keeps polling its V; the closed one never asks again, and its V never started.
    advance(PAGE_LEASE_MS / 2); host.state(kept.key);
    advance(PAGE_LEASE_MS / 2 + 1); host.state(kept.key);
    await sleep(5);
    expect(host.state(gone.key).phase).toBe("unknown");
    finish();
    await host.settled();
    expect(host.state(kept.key).phase).toBe("ready");
  });
});
