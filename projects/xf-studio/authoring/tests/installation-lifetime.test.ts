import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installationFingerprint, type CharacterDetailSettings } from "../src/character-detail-host";
import { depotHash, refFromPath } from "../src/depot-path";
import { GradingLutHost } from "../src/grading-lut-host";
import { InstallationRegistry, installations } from "../src/installation-registry";
import { openInstallation, type Installation, type InstallationOptions } from "../src/resolver-host";
import { pathStamp } from "../src/source-discovery";
import { cr2w } from "./resolver-fixtures";

/**
 * How long an opened installation and its graphs live (prepare speed review, `88b5379`): an evicted route still notices a change
 * (PIPE-52), the graphs keep a bounded amount of JSON and a route left behind by a WolvenKit change is dropped (PIPE-55), read
 * errors expire (PIPE-57), folders on volumes without trustworthy folder times are stamped by their listing (PIPE-58), the LUT host
 * checks its route (PIPE-59), and a request checks the route once (PIPE-62).
 */
const roots: string[] = [];
afterEach(() => installations.clear());
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = mkdtempSync(join(tmpdir(), "xfs-lifetime-")); roots.push(root); return root; };
const put = (path: string, content: string | Uint8Array) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
function rdar(paths: string[]): Uint8Array {
  const indexOffset = 64, indexSize = 28 + paths.length * 56;
  const bytes = new Uint8Array(indexOffset + indexSize);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x44, 0x41, 0x52]);
  view.setBigUint64(8, BigInt(indexOffset), true);
  view.setUint32(16, indexSize, true);
  view.setUint32(indexOffset + 16, paths.length, true);
  paths.forEach((path, i) => view.setBigUint64(indexOffset + 28 + i * 56, BigInt(depotHash(path)), true));
  return bytes;
}
let tick = Date.now() / 1000 + 10;
const touchLater = (path: string) => { tick += 10; utimesSync(path, tick, tick); };
/** Put a folder's modification time back, as a tool on a FAT volume (or a coarse clock) may leave it. */
const keepTime = (path: string, run: () => void) => { const { atime, mtime } = statSync(path); run(); utimesSync(path, atime, mtime); };

function setup(profiles = ["Default"]) {
  const root = temporary(), game = join(root, "game"), mo2 = join(root, "mo2");
  put(join(game, "archive", "pc", "content", "basegame_1.archive"), rdar(["base\\a.mesh"]));
  put(join(game, "bin", "x64", "Cyberpunk2077.exe"), "game");
  for (const profile of profiles) put(join(mo2, "profiles", profile, "modlist.txt"), "+Hair\n");
  const mod = join(mo2, "mods", "Hair", "archive", "pc", "mod");
  put(join(mod, "hair.archive"), rdar(["mod\\hair.mesh"]));
  const cli = join(root, "WolvenKit.CLI.exe");
  put(cli, "fake WolvenKit");
  const base = { gameRoot: game, launchRoute: "mo2" as const, mo2Root: mo2, manualModRoot: null, wolvenKitCli: cli, cacheDir: join(root, "cache") };
  const options: InstallationOptions = { ...base, mo2ProfileId: profiles[0]! };
  const settings: CharacterDetailSettings = { gameRoot: game, launchRoute: "mo2", mo2Root: mo2, mo2ProfileId: profiles[0]!, manualModRoot: null, wolvenKitCli: cli };
  return { root, game, mo2, mod, cli, base, options, settings };
}

describe("an evicted route (PIPE-52)", () => {
  test("a change inside a mod folder while it was closed moves its generation on; no change keeps the key", async () => {
    const s = setup(["Default", "P2", "P3"]);
    await installations.acquire(s.options);
    const before = installationFingerprint(s.settings);
    await installations.acquire({ ...s.base, mo2ProfileId: "P2" });
    await installations.acquire({ ...s.base, mo2ProfileId: "P3" }); // Default is dropped (two routes are kept).
    expect(installations.footprint().routes).toBe(2);
    // Nothing changed: the same key when checked and when opened again.
    await installations.revalidate(s.options);
    expect(installationFingerprint(s.settings)).toBe(before);
    await installations.acquire(s.options);
    expect(installationFingerprint(s.settings)).toBe(before);
    // Dropped again, then an archive is replaced inside the mod folder (the cheap route stamps don't see it).
    await installations.acquire({ ...s.base, mo2ProfileId: "P2" });
    await installations.acquire({ ...s.base, mo2ProfileId: "P3" });
    put(join(s.mod, "hair.archive"), rdar(["mod\\hair.mesh", "mod\\hair2.mesh"]));
    touchLater(join(s.mod, "hair.archive"));
    await installations.revalidate(s.options); // what CharacterDetailHost.refresh does
    const after = installationFingerprint(s.settings);
    expect(after).not.toBe(before);
    const reopened = await installations.acquire(s.options);
    expect(reopened.depot.lookup(depotHash("mod\\hair2.mesh")).winner?.name).toBe("hair.archive");
    expect(installationFingerprint(s.settings)).toBe(after);
  });

  test("a change made while closed is noticed on open even without a check first", async () => {
    const s = setup(["Default", "P2", "P3"]);
    const registry = new InstallationRegistry();
    await registry.acquire(s.options);
    await registry.acquire({ ...s.base, mo2ProfileId: "P2" });
    await registry.acquire({ ...s.base, mo2ProfileId: "P3" });
    put(join(s.mod, "hair.archive"), rdar(["mod\\hair.mesh", "mod\\hair3.mesh"]));
    touchLater(join(s.mod, "hair.archive"));
    await registry.acquire(s.options);
    expect(registry.generation(s.options)).toBe(1);
  });
});

describe("what the graphs keep (PIPE-55)", () => {
  /** An installation whose port answers every read with a document of `size` characters. */
  const sized = (s: ReturnType<typeof setup>, size: number) => (options: InstallationOptions): Installation => {
    const opened = openInstallation(options);
    Object.assign(opened.fetcher, { fetch: async () => ({ document: cr2w({ $type: "CMaterialInstance", pad: "x".repeat(size) }), extractedSha256: null }) });
    return opened;
  };
  test("the graphs of every route and cache folder keep at most the budget; the least recently used start afresh", async () => {
    const s = setup(["Default", "P2"]);
    const registry = new InstallationRegistry({ open: sized(s, 40_000), maxGraphBytes: 100_000 });
    const a = await registry.acquire(s.options);
    await a.graph.load(refFromPath("base\\a.mesh"));
    await a.graph.load(refFromPath("mod\\hair.mesh"));
    const plate = await registry.acquire({ ...s.options, cacheDir: join(s.root, "plate") });
    Object.assign(plate.fetcher, { fetch: a.fetcher.fetch });
    await plate.graph.load(refFromPath("base\\a.mesh"));
    expect(registry.footprint().graphBytes).toBeGreaterThan(100_000);
    // The next acquire of the character details' folder keeps the graph it hands out; the other view starts afresh.
    const again = await registry.acquire(s.options);
    expect(registry.footprint().graphBytes).toBeLessThanOrEqual(100_000);
    expect(again.graph).toBe(a.graph);
    expect((await registry.acquire({ ...s.options, cacheDir: join(s.root, "plate") })).graph).not.toBe(plate.graph);
    expect(registry.stats.graphsReplaced).toBe(1);
    // A graph over the budget on its own starts afresh when it is handed out next.
    const small = new InstallationRegistry({ open: sized(s, 40_000), maxGraphBytes: 30_000 });
    const only = await small.acquire(s.options);
    await only.graph.load(refFromPath("base\\a.mesh"));
    expect((await small.acquire(s.options)).graph).not.toBe(only.graph);
  });

  test("a route whose WolvenKit changed in place is dropped when another opens", async () => {
    const s = setup(["Default", "P2"]);
    const registry = new InstallationRegistry({ maxRoutes: 4 });
    await registry.acquire(s.options);
    put(s.cli, "a newer WolvenKit build");
    touchLater(s.cli);
    await registry.acquire({ ...s.base, mo2ProfileId: "P2" });
    // The old key can never be asked for again (WolvenKit's identity is part of it): only the new route stays.
    expect(registry.footprint().routes).toBe(1);
    await registry.acquire(s.options);
    expect(registry.footprint().routes).toBe(2);
  });
});

describe("read errors (PIPE-57)", () => {
  test("an installation opened with read errors is opened again once it is old; the generation moves on only if they changed", async () => {
    const s = setup();
    let now = 1_000, broken = true;
    const opened = (options: InstallationOptions): Installation => {
      const made = openInstallation(options);
      return broken ? { ...made, summary: { ...made.summary, readErrors: ["hair.archive: the index could not be read"] } } : made;
    };
    const registry = new InstallationRegistry({ open: opened, now: () => now, problemTtlMs: 60_000 });
    await registry.acquire(s.options);
    now += 30_000;
    await registry.acquire(s.options);
    expect(registry.stats.opens).toBe(1);
    now += 40_000;
    await registry.acquire(s.options);
    expect(registry.stats.opens).toBe(2);
    expect(registry.generation(s.options)).toBe(0); // Still the same read error: the same answer.
    now += 70_000; broken = false;
    await registry.acquire(s.options);
    expect(registry.stats.opens).toBe(3);
    expect(registry.generation(s.options)).toBe(1); // The index reads now: another answer.
    now += 70_000;
    await registry.acquire(s.options);
    expect(registry.stats.opens).toBe(3); // No read errors: kept.
  });
});

describe("folder stamps (PIPE-58)", () => {
  test("a folder whose time didn't change is still noticed when stamped by its listing", async () => {
    for (const mode of ["time", "listing"] as const) {
      const s = setup();
      touchLater(s.mod); // A whole-second time, which the check below can put back exactly.
      const registry = new InstallationRegistry({ open: options => openInstallation({ ...options, folderStamps: () => mode }) });
      const first = await registry.acquire(s.options);
      expect(first.watch!.some(item => item.stamp.startsWith("list|"))).toBe(mode === "listing");
      keepTime(s.mod, () => put(join(s.mod, "extra.archive"), rdar(["mod\\extra.mesh"])));
      const after = await registry.acquire(s.options);
      // Folder times alone miss it (why they are used only where the file system keeps them); the listing notices it.
      expect(after.depot.lookup(depotHash("mod\\extra.mesh")).winner?.name).toBe(mode === "listing" ? "extra.archive" : undefined);
    }
  });
});

describe("one check per request (PIPE-62)", () => {
  test("a clean check just before a request vouches for the preparation's acquire; an acquire after an acquire checks", async () => {
    const s = setup();
    let stamps = 0;
    const registry = new InstallationRegistry({ stamp: async path => { stamps++; try { return pathStamp(await lstat(path)); } catch { return pathStamp(null); } } });
    const first = await registry.acquire(s.options);
    const watched = first.watch!.length;
    await registry.revalidate(s.options);
    await registry.acquire(s.options);
    expect(registry.stats.checks).toBe(1);
    expect(stamps).toBe(watched);
    await registry.acquire(s.options);
    expect(registry.stats.checks).toBe(2);
    // A vouch lapses.
    const late = new InstallationRegistry({ checkFreshMs: 0 });
    await late.acquire(s.options); await late.revalidate(s.options); await late.acquire(s.options);
    expect(late.stats.checks).toBe(2);
  });
});

describe("the LUT host checks its route (PIPE-59)", () => {
  test("refresh revalidates the LUT host's own registry, and its key follows that registry's generation", async () => {
    const s = setup();
    const host = new GradingLutHost({ cacheRoot: join(s.root, "lut"), resolverCache: join(s.root, "cache"), settings: () => s.settings,
      open: openInstallation, extract: async () => { throw Error("no LUT in this fixture"); } });
    host.request(); await host.settled();
    const before = host.request();
    put(join(s.mod, "hair.archive"), rdar(["mod\\hair.mesh", "mod\\lut.mesh"]));
    touchLater(join(s.mod, "hair.archive"));
    await host.refresh();
    const after = host.request();
    // The shared registry never saw this route, so a key read from it would not have moved.
    expect(installationFingerprint(s.settings)).toBe(installationFingerprint(s.settings, installations));
    expect(after.phase).toBe("preparing");
    expect(before.phase).toBe("ready");
    await host.settled();
  });
});
