import { afterAll, describe, expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CharacterDetailHost, installationFingerprint, characterRequestKey, type CharacterDetailSettings } from "../src/character-detail-host";
import { codeIdentityOf, hostCodeIdentity, includeHostCode, memoisedRead } from "../src/host-code-identity";
import { InstallationRegistry, installationRouteKey } from "../src/installation-registry";
import { DiscoverySnapshots, watchDigest, watchUnchanged } from "../src/installation-snapshot";
import { KEEP_ANSWERS, PreparedAnswers } from "../src/prepared-answers";
import { discoverRoute, DISCOVERY_LIMITS, openInstallation, type InstallationOptions } from "../src/resolver-host";
import { routeIdentity } from "../src/route-fingerprint";
import { pathStamp, type WatchedPath } from "../src/source-discovery";
import { CHARACTER_DETAIL_SCHEMA } from "../src/render-detail";
import { REQUEST_A, REQUEST_B } from "./character-detail-fixtures";

/**
 * What a warm restart reuses and when it stops (research/backlog/performance.md, warm restart): a route's kept discovery
 * (installation-snapshot.ts), the character-detail host's kept answers (prepared-answers.ts) and the host code identity that names both
 * (host-code-identity.ts). Each is reused only while every stamp it depends on, the route, the code and its own version are unchanged.
 */
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = mkdtempSync(join(tmpdir(), "xfs-warm-restart-")); roots.push(root); return root; };
const put = (path: string, content: string | Uint8Array) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
let tick = Date.now() / 1000 + 10;
const touchLater = (path: string) => { tick += 10; utimesSync(path, tick, tick); };
const stamped = (paths: string[]): WatchedPath[] => paths.map(path => ({ path, stamp: pathStamp(lstatSync(path)) }));
function rdar(count: number): Uint8Array {
  const indexOffset = 64, indexSize = 28 + count * 56, bytes = new Uint8Array(indexOffset + indexSize), view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x44, 0x41, 0x52]);
  view.setBigUint64(8, BigInt(indexOffset), true);
  view.setUint32(16, indexSize, true);
  view.setUint32(indexOffset + 16, count, true);
  return bytes;
}
function game() {
  const root = temporary(), gameRoot = join(root, "game");
  put(join(gameRoot, "archive", "pc", "content", "basegame_1.archive"), rdar(0));
  put(join(gameRoot, "bin", "x64", "Cyberpunk2077.exe"), "game");
  const mod = join(gameRoot, "archive", "pc", "mod");
  put(join(mod, "hair.archive"), rdar(0));
  const cli = join(root, "WolvenKit.CLI.exe");
  put(cli, "fake WolvenKit");
  const options: InstallationOptions = { gameRoot, launchRoute: "direct", mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: cli,
    cacheDir: join(root, "cache") };
  return { root, gameRoot, mod, cli, options };
}

describe("the watched-stamp check", () => {
  test("holds while every stamp is unchanged; a changed, added or removed file breaks it", async () => {
    const root = temporary(), a = join(root, "a.txt"), b = join(root, "b.txt");
    put(a, "a"); put(b, "b");
    const watch = stamped([a, b, root]);
    expect(await watchUnchanged(watch)).toBe(true);
    expect(await watchUnchanged(watch, undefined, 1)).toBe(true);
    put(b, "bb");
    expect(await watchUnchanged(watch)).toBe(false);
    const again = stamped([a, b, root]);
    rmSync(a);
    expect(await watchUnchanged(again)).toBe(false);
    expect(watchDigest(again)).not.toBe(watchDigest(stamped([b, root])));
  });
});

describe("a route's kept discovery", () => {
  test("is reused while nothing it walked changed, and walked again after a change, another route or other code", async () => {
    const g = game();
    const route = { route: routeIdentity(g.options), limits: DISCOVERY_LIMITS };
    let code = "code-1";
    const snapshots = new DiscoverySnapshots({ code: async () => code });
    expect(await snapshots.read(g.options.cacheDir, route)).toBeNull();
    const walked = discoverRoute(g.options);
    await snapshots.write(g.options.cacheDir, route, walked);
    const kept = await snapshots.read(g.options.cacheDir, route);
    expect(kept?.candidates.map(c => c.virtualPath).sort()).toEqual(walked.candidates.map(c => c.virtualPath).sort());
    // Another route's settings, or another XF Studio, never reads it.
    expect(await snapshots.read(g.options.cacheDir, { ...route, route: routeIdentity({ ...g.options, launchRoute: "mo2" }) })).toBeNull();
    code = "code-2";
    expect(await snapshots.read(g.options.cacheDir, route)).toBeNull();
    code = "code-1";
    // A mod added (its folder's time moves on) or edited in place.
    put(join(g.mod, "new.archive"), rdar(0));
    touchLater(g.mod);
    expect(await snapshots.read(g.options.cacheDir, route)).toBeNull();
    await snapshots.write(g.options.cacheDir, route, discoverRoute(g.options));
    expect((await snapshots.read(g.options.cacheDir, route))?.candidates.some(c => c.virtualPath.endsWith("new.archive"))).toBe(true);
    put(join(g.mod, "hair.archive"), rdar(1));
    expect(await snapshots.read(g.options.cacheDir, route)).toBeNull();
  });

  test("a damaged or foreign snapshot file is a walk, not a failure", async () => {
    const g = game();
    const route = { route: routeIdentity(g.options), limits: DISCOVERY_LIMITS };
    const snapshots = new DiscoverySnapshots({ code: async () => "code" });
    await snapshots.write(g.options.cacheDir, route, discoverRoute(g.options));
    const folder = join(g.options.cacheDir, "discovery");
    for (const name of readdirSync(folder)) writeFileSync(join(folder, name), "{ not json");
    expect(await snapshots.read(g.options.cacheDir, route)).toBeNull();
  });

  test("a discovery that met a read failure is neither kept nor reused; an unreadable code identity is a walk (PIPE-127, PIPE-128)", async () => {
    const g = game();
    const route = { route: routeIdentity(g.options), limits: DISCOVERY_LIMITS };
    const snapshots = new DiscoverySnapshots({ code: async () => "code" });
    const walked = discoverRoute(g.options);
    const failed = { ...walked, complete: false, issues: [...walked.issues, { code: "entry_unreadable", detail: "direct entry could not be inspected.", blocking: true }] };
    await snapshots.write(g.options.cacheDir, route, failed);
    expect(await snapshots.read(g.options.cacheDir, route)).toBeNull();
    // A snapshot an earlier version kept with such an issue is not reused either.
    await snapshots.write(g.options.cacheDir, route, walked);
    expect(await snapshots.read(g.options.cacheDir, route)).not.toBeNull();
    const folder = join(g.options.cacheDir, "discovery");
    for (const name of readdirSync(folder)) {
      const kept = JSON.parse(readFileSync(join(folder, name), "utf8"));
      kept.discovery.issues.push({ code: "directory_unreadable", detail: "x", blocking: true });
      writeFileSync(join(folder, name), JSON.stringify(kept));
    }
    expect(await snapshots.read(g.options.cacheDir, route)).toBeNull();
    // The code identity can't be read: nothing is kept or read, and nothing throws.
    const broken = new DiscoverySnapshots({ code: async () => { throw new Error("stat failed"); } });
    expect(await broken.read(g.options.cacheDir, route)).toBeNull();
    await broken.write(g.options.cacheDir, route, walked);
    const answers = new PreparedAnswers(temporary(), { code: async () => { throw new Error("stat failed"); }, recordSchema: CHARACTER_DETAIL_SCHEMA, recordExists: () => true });
    expect(await answers.find("route", REQUEST_A)).toBeNull();
  });

  test("the registry opens from the kept discovery on a later start, and walks again once a mod changed", async () => {
    const g = game();
    const seen: ("kept" | "walked")[] = [];
    const snapshots = new DiscoverySnapshots({ code: async () => "code" });
    const registry = () => new InstallationRegistry({ openNative: false, snapshots,
      open: options => { seen.push(options.discovery && options.discovery.discoveredAt === first?.discoveredAt ? "kept" : "walked"); return openInstallation(options); } });
    let first: { discoveredAt: string } | undefined;
    const opened = await registry().acquire(g.options);
    first = opened.discovery;
    await Bun.sleep(20);
    const again = await registry().acquire(g.options);
    expect(again.discovery?.discoveredAt).toBe(first!.discoveredAt);
    expect(again.summary.mountedArchives).toBe(opened.summary.mountedArchives);
    put(join(g.mod, "more.archive"), rdar(0));
    touchLater(g.mod);
    const changed = await registry().acquire(g.options);
    expect(changed.discovery?.discoveredAt).not.toBe(first!.discoveredAt);
    expect(changed.summary.mountedArchives).toBe(opened.summary.mountedArchives + 1);
    expect(seen).toEqual(["walked", "kept", "walked"]);
  });
});

describe("the host code identity", () => {
  test("follows every source file's size and time, and a bundle's", async () => {
    const root = temporary(), main = join(root, "main.ts"), other = join(root, "sub", "other.ts");
    put(main, "export {}"); put(other, "export const a = 1;"); put(join(root, "notes.md"), "ignored");
    const first = await codeIdentityOf(main);
    expect(await codeIdentityOf(main)).toBe(first);
    put(join(root, "notes.md"), "still ignored");
    expect(await codeIdentityOf(main)).toBe(first);
    put(other, "export const a = 2;");
    expect(await codeIdentityOf(main)).not.toBe(first);
    // Data the code loads (the resource reader's tables, the eye plate's recipe) is part of it (PIPE-129).
    const withJson = await codeIdentityOf(main);
    put(join(root, "native", "rtti-subset.json"), "{}");
    expect(await codeIdentityOf(main)).not.toBe(withJson);
    const bundle = join(root, "host.js");
    put(bundle, "bundle 1");
    const built = await codeIdentityOf(bundle);
    put(bundle, "bundle 22");
    expect(await codeIdentityOf(bundle)).not.toBe(built);
    // A packaged host's decode worker bundle counts beside the main bundle.
    const worker = join(root, "native-decode-worker.js");
    put(worker, "worker 1");
    const withWorker = await codeIdentityOf(bundle, [worker]);
    expect(withWorker).not.toBe(await codeIdentityOf(bundle));
    put(worker, "worker 22");
    expect(await codeIdentityOf(bundle, [worker])).not.toBe(withWorker);
  });

  test("a failed read of the host's identity is not remembered; a counted worker bundle reads it again (PIPE-128, PIPE-129)", async () => {
    let calls = 0;
    const read = memoisedRead(async () => { if (++calls === 1) throw new Error("stat failed"); return `identity ${calls}`; });
    await expect(read.get()).rejects.toThrow("stat failed");
    expect(await read.get()).toBe("identity 2");
    expect(await read.get()).toBe("identity 2");
    expect(calls).toBe(2);
    const first = await hostCodeIdentity();
    expect(await hostCodeIdentity()).toBe(first);
    includeHostCode(join(temporary(), "worker.js"));
    expect(await hostCodeIdentity()).not.toBe(first);
  });
});

describe("the character-detail host's kept answers", () => {
  const record = "a".repeat(64) + ".json";
  function store(root: string, code = () => Promise.resolve("code")) {
    const answers = new PreparedAnswers(join(root, "answers"), { code, recordSchema: CHARACTER_DETAIL_SCHEMA, recordExists: name => name === record });
    return answers;
  }

  test("are found while nothing they were prepared from changed, and not after a change, for another request, route, code or record", async () => {
    const root = temporary(), watched = join(root, "watched.archive");
    put(watched, "one");
    let code = "code-1";
    const answers = store(root, async () => code);
    await answers.remember("route-1", REQUEST_A, { record, message: "" }, stamped([watched]));
    expect(await answers.find("route-1", REQUEST_A)).toEqual({ record, message: "" });
    expect(await answers.find("route-1", REQUEST_B)).toBeNull();
    expect(await answers.find("route-2", REQUEST_A)).toBeNull();
    code = "code-2";
    expect(await answers.find("route-1", REQUEST_A)).toBeNull();
    code = "code-1";
    const gone = new PreparedAnswers(join(root, "answers"), { code: async () => code, recordSchema: CHARACTER_DETAIL_SCHEMA, recordExists: () => false });
    expect(await gone.find("route-1", REQUEST_A)).toBeNull();
    const newer = new PreparedAnswers(join(root, "answers"), { code: async () => code, recordSchema: "xfs/render-detail-999", recordExists: () => true });
    expect(await newer.find("route-1", REQUEST_A)).toBeNull();
    put(watched, "two!");
    expect(await answers.find("route-1", REQUEST_A)).toBeNull();
  });

  test("keep only the most recent answers, and an empty watch list keeps nothing", async () => {
    const root = temporary(), watched = join(root, "w");
    put(watched, "w");
    let now = 1;
    const answers = new PreparedAnswers(join(root, "answers"), { code: async () => "c", recordSchema: CHARACTER_DETAIL_SCHEMA, recordExists: () => true,
      now: () => now++ });
    await answers.remember("r", REQUEST_A, { record, message: "" }, []);
    expect(await answers.find("r", REQUEST_A)).toBeNull();
    const requests = Array.from({ length: KEEP_ANSWERS + 2 }, (_, i) => ({ ...REQUEST_A, choices: [{ part: "head" as const, option: "hairstyle", choice: `hh_${i}` }] }));
    for (const request of requests) await answers.remember("r", request, { record, message: "" }, stamped([watched]));
    expect(await answers.find("r", requests[0]!)).toBeNull();
    expect(await answers.find("r", requests.at(-1)!)).not.toBeNull();
  });

  test("answer a request at once after a restart, only while nothing changed; a warm start's question never prepares", async () => {
    const root = temporary(), watched = join(root, "mods");
    mkdirSync(watched, { recursive: true });
    const cli = join(root, "WolvenKit.CLI.exe");
    put(cli, "fake WolvenKit");
    const settings: CharacterDetailSettings = { gameRoot: join(root, "game"), launchRoute: "direct", mo2Root: null, mo2ProfileId: null,
      manualModRoot: null, wolvenKitCli: cli };
    const cacheRoot = join(root, "cache");
    put(join(cacheRoot, "characters", "records", record), "{}");
    const answers = new PreparedAnswers(join(cacheRoot, "choices", "answers"), { code: async () => "code", recordSchema: CHARACTER_DETAIL_SCHEMA,
      recordExists: name => name === record });
    const route = { gameRoot: settings.gameRoot!, launchRoute: settings.launchRoute, mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: cli };
    await answers.remember(installationRouteKey(route), REQUEST_A, { record, message: "kept" }, stamped([watched]));
    const prepared: string[] = [];
    const host = () => new CharacterDetailHost({ cacheRoot, settings: () => settings, keptAnswers: answers,
      prepare: async options => { prepared.push(options.request.source); return { record: {} as never, recordFile: "b".repeat(64) + ".json", degraded: false }; } });
    const restarted = host();
    const key = characterRequestKey(REQUEST_A, installationFingerprint(settings));
    // The warm start's question: the kept answer, nothing prepared.
    expect(await restarted.known(REQUEST_A, "warm-start")).toMatchObject({ key, phase: "ready", record, message: "kept" });
    expect(await restarted.known(REQUEST_B, "warm-start")).toMatchObject({ phase: "unknown" });
    // The page's own request, a moment later: the same answer, still nothing prepared.
    expect(await restarted.answer(REQUEST_A, "page")).toMatchObject({ key, phase: "ready", record });
    expect(prepared).toEqual([]);
    // Another start after a mod changed: the V is prepared again.
    put(join(watched, "new.archive"), "x");
    touchLater(watched);
    const changed = host();
    const state = await changed.answer(REQUEST_A, "page");
    expect(state.phase === "preparing" || state.record !== record).toBe(true);
    await changed.settled();
    expect(prepared).toEqual([REQUEST_A.source]);
    expect(changed.state(state.key).record).toBe("b".repeat(64) + ".json");
  });
});

