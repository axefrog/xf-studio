import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type ArchiveFile, buildMountPlan, DepotIndex } from "../src/archive-precedence";
import { readArchiveXlConfig } from "../src/archivexl-config";
import { installationFingerprint, type CharacterDetailSettings } from "../src/character-detail-host";
import { depotHash, refFromPath } from "../src/depot-path";
import { InstallationRegistry, installations } from "../src/installation-registry";
import { openInstallation, WolvenKitFetcher, type Installation, type InstallationOptions } from "../src/resolver-host";
import { ResourceGraph } from "../src/resource-graph";
import { pathStamp } from "../src/source-discovery";
import { app, cr2w, ent, mesh, meshComponent, mi, rp } from "./resolver-fixtures";

/**
 * The long-lived installation (installation-registry.ts): one opened route reused across preparations, reopened
 * whenever anything it read changed, shared by concurrent requests; and the resource graph's prefetch, which reads
 * what the character details ask for one at a time in fewer WolvenKit launches.
 */
const roots: string[] = [];
afterEach(() => installations.clear());
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = mkdtempSync(join(tmpdir(), "xfs-registry-")); roots.push(root); return root; };
const put = (path: string, content: string | Uint8Array) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };

/** A minimal RDAR archive whose index lists `paths`. */
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

/** A game folder and an MO2 instance with one profile and one mod holding an archive and an `.xl` file. */
function installation() {
  const root = temporary(), game = join(root, "game"), mo2 = join(root, "mo2");
  put(join(game, "archive", "pc", "content", "basegame_1.archive"), rdar(["base\\a.mesh"]));
  put(join(game, "bin", "x64", "Cyberpunk2077.exe"), "game 2.3");
  put(join(mo2, "profiles", "Default", "modlist.txt"), "+Hair\n");
  put(join(mo2, "profiles", "Other", "modlist.txt"), "+Hair\n");
  put(join(mo2, "mods", "Hair", "archive", "pc", "mod", "hair.archive"), rdar(["mod\\hair.mesh"]));
  put(join(mo2, "mods", "Hair", "archive", "pc", "mod", "hair.xl"), "resource:\n  link:\n    mod\\a.mesh: base\\a.mesh\n");
  const cli = join(root, "WolvenKit.CLI.exe");
  put(cli, "fake WolvenKit");
  const options: InstallationOptions = { gameRoot: game, launchRoute: "mo2", mo2Root: mo2, mo2ProfileId: "Default", manualModRoot: null,
    wolvenKitCli: cli, cacheDir: join(root, "cache") };
  return { root, game, mo2, cli, options, mod: join(mo2, "mods", "Hair", "archive", "pc", "mod") };
}

function counting(open = openInstallation) {
  let opens = 0;
  const registry = new InstallationRegistry({ open: options => { opens++; return open(options); } });
  return { registry, opens: () => opens };
}
const archives = (value: Installation) => value.plan.archives.map(archive => archive.name).sort();
/** A later modification time than anything written so far, so a rewrite is never hidden by timestamp resolution. */
let tick = Date.now() / 1000 + 10;
const touchLater = (path: string) => { tick += 10; utimesSync(path, tick, tick); };

test("an unchanged route is reused; a changed mod list, archive, .xl, game or setting opens it again", async () => {
  const setup = installation();
  const { registry, opens } = counting();
  const first = await registry.acquire(setup.options);
  expect(archives(first)).toEqual(["basegame_1.archive", "hair.archive"]);
  expect(first.watch!.length).toBeGreaterThan(5);
  const again = await registry.acquire(setup.options);
  expect(opens()).toBe(1);
  expect(again.depot).toBe(first.depot);
  expect(again.graph).toBe(first.graph);
  expect(registry.generation(setup.options)).toBe(0);

  // The profile's mod list gains a mod.
  put(join(setup.mo2, "mods", "Brows", "archive", "pc", "mod", "brows.archive"), rdar(["mod\\brows.mesh"]));
  put(join(setup.mo2, "profiles", "Default", "modlist.txt"), "+Brows\n+Hair\n");
  touchLater(join(setup.mo2, "profiles", "Default", "modlist.txt"));
  const withBrows = await registry.acquire(setup.options);
  expect(opens()).toBe(2);
  expect(archives(withBrows)).toEqual(["basegame_1.archive", "brows.archive", "hair.archive"]);
  expect(registry.generation(setup.options)).toBe(1);

  // An archive added inside an existing mod folder (no mod list change).
  put(join(setup.mod, "hair_extra.archive"), rdar(["mod\\extra.mesh"]));
  touchLater(setup.mod);
  const added = await registry.acquire(setup.options);
  expect(opens()).toBe(3);
  expect(archives(added)).toContain("hair_extra.archive");
  expect(added.depot.lookup(depotHash("mod\\extra.mesh")).winner?.name).toBe("hair_extra.archive");

  // ...and removed again.
  rmSync(join(setup.mod, "hair_extra.archive"));
  touchLater(setup.mod);
  const removed = await registry.acquire(setup.options);
  expect(opens()).toBe(4);
  expect(archives(removed)).not.toContain("hair_extra.archive");
  expect(removed.depot.lookup(depotHash("mod\\extra.mesh")).winner).toBeNull();

  // An `.xl` edited in place.
  expect(removed.xl.paths.size).toBeGreaterThan(0);
  put(join(setup.mod, "hair.xl"), "resource:\n  link:\n    mod\\b.mesh: base\\a.mesh\n    mod\\c.mesh: base\\a.mesh\n");
  touchLater(join(setup.mod, "hair.xl"));
  const edited = await registry.acquire(setup.options);
  expect(opens()).toBe(5);
  expect([...edited.xl.paths.values()]).toContain("mod\\c.mesh");

  // A game update (its executable changes).
  put(join(setup.game, "bin", "x64", "Cyberpunk2077.exe"), "game 2.31 with more bytes");
  touchLater(join(setup.game, "bin", "x64", "Cyberpunk2077.exe"));
  await registry.acquire(setup.options);
  expect(opens()).toBe(6);

  // Other settings are another route: another profile, the direct route, another WolvenKit.
  await registry.acquire({ ...setup.options, mo2ProfileId: "Other" });
  expect(opens()).toBe(7);
  const direct = await registry.acquire({ ...setup.options, launchRoute: "direct" });
  expect(opens()).toBe(8);
  expect(archives(direct)).toEqual(["basegame_1.archive"]);
  put(setup.cli, "another WolvenKit build");
  touchLater(setup.cli);
  await registry.acquire(setup.options);
  expect(opens()).toBe(9);
  // Nothing changed since: reused.
  await registry.acquire(setup.options);
  expect(opens()).toBe(9);
  expect(registry.stats.changed).toBe(5);
});

test("requests during an open or a check share it", async () => {
  const setup = installation();
  let checks = 0, opens = 0;
  const registry = new InstallationRegistry({ open: options => { opens++; return openInstallation(options); },
    stamp: async path => { checks++; try { return pathStamp(await lstat(path)); } catch { return pathStamp(null); } } });
  const counted = { opens: () => opens };
  const [a, b, c] = await Promise.all([registry.acquire(setup.options), registry.acquire(setup.options), registry.acquire(setup.options)]);
  expect(counted.opens()).toBe(1);
  expect(b.depot).toBe(a.depot); expect(c.depot).toBe(a.depot);
  expect(checks).toBe(0);
  // Three requests on an open installation: one check of each watched path, not three.
  const watched = a.watch!.length;
  await Promise.all([registry.acquire(setup.options), registry.acquire(setup.options), registry.revalidate(setup.options)]);
  expect(checks).toBe(watched);
  expect(registry.stats.checks).toBe(1);
  // A change seen by one check reopens once for everyone waiting.
  put(join(setup.mod, "late.archive"), rdar(["mod\\late.mesh"]));
  touchLater(setup.mod);
  const after = await Promise.all([registry.acquire(setup.options), registry.acquire(setup.options)]);
  expect(counted.opens()).toBe(2);
  expect(after[1].depot).toBe(after[0].depot);
  expect(archives(after[0])).toContain("late.archive");
});

test("the watched-path check is much cheaper than opening", async () => {
  const setup = installation();
  for (let i = 0; i < 60; i++) put(join(setup.mo2, "mods", "Hair", "textures", `folder${i}`, "t.xbm"), "texture");
  const registry = new InstallationRegistry();
  let started = performance.now();
  await registry.acquire(setup.options);
  const open = performance.now() - started;
  started = performance.now();
  for (let i = 0; i < 5; i++) await registry.acquire(setup.options);
  const check = (performance.now() - started) / 5;
  expect(registry.stats.opens).toBe(1);
  expect(check).toBeLessThan(Math.max(open, 5));
});

test("a view whose fetcher failed transiently gets a fresh graph; views per cache folder share the archives", async () => {
  const setup = installation();
  const { registry } = counting();
  const first = await registry.acquire(setup.options);
  // A lasting answer (or none) keeps the graph; a transient failure replaces it over the same archives.
  expect((await registry.acquire(setup.options)).graph).toBe(first.graph);
  first.fetcher.stats.transient++;
  const retried = await registry.acquire(setup.options);
  expect(retried.graph).not.toBe(first.graph);
  expect(retried.depot).toBe(first.depot);
  expect((await registry.acquire(setup.options)).graph).toBe(retried.graph);
  // The eye plate's own cache folder: the same opened archives, its own fetcher.
  const plate = await registry.acquire({ ...setup.options, cacheDir: join(setup.root, "plate", "resolver") });
  expect(plate.depot).toBe(first.depot);
  expect(plate.fetcher).not.toBe(first.fetcher);
  expect(plate.fetcher).toBeInstanceOf(WolvenKitFetcher);
});

test("a request key changes once the registry finds the opened installation out of date (no stale answer)", async () => {
  const setup = installation();
  const settings: CharacterDetailSettings = { gameRoot: setup.game, launchRoute: "mo2", mo2Root: setup.mo2, mo2ProfileId: "Default",
    manualModRoot: null, wolvenKitCli: setup.cli };
  await installations.acquire(setup.options);
  const before = installationFingerprint(settings);
  // Nothing changed: the same key, so a finished answer is reused.
  await installations.revalidate(setup.options);
  expect(installationFingerprint(settings)).toBe(before);
  // A file replaced inside a mod folder: the cheap stamps do not see it, the registry's check does.
  put(join(setup.mod, "hair.archive"), rdar(["mod\\hair.mesh", "mod\\hair2.mesh"]));
  touchLater(join(setup.mod, "hair.archive"));
  await installations.revalidate(setup.options);
  const after = installationFingerprint(settings);
  expect(after).not.toBe(before);
  const reopened = await installations.acquire(setup.options);
  expect(reopened.depot.lookup(depotHash("mod\\hair2.mesh")).winner?.name).toBe("hair.archive");
  expect(installationFingerprint(settings)).toBe(after);
});

/**
 * A fixture chain read like the character details read it: an `.app` with two part entities (awaited one after the
 * other), their mesh, its material, then the material's template, hair profiles and layer setup one at a time, and the
 * setup's layer templates one at a time. Each WolvenKit batch here is one unbundle and one convert launch.
 */
async function readChain(prefetch: boolean) {
  const root = temporary(), cache = join(root, "cache");
  const files: Record<string, object> = {
    "base\\v\\hair.app": app([{ name: "hair", parts: ["base\\v\\hair_a.ent", "base\\v\\hair_b.ent"] }]),
    "base\\v\\hair_a.ent": ent([meshComponent("hair", "base\\v\\hair.mesh")]),
    "base\\v\\hair_b.ent": ent([meshComponent("hair_cards", "base\\v\\hair.mesh")]),
    "base\\v\\hair.mesh": mesh({ appearances: [{ name: "default", chunkMaterials: ["hair"] }], entries: [{ name: "hair", local: false, index: 0 }],
      external: ["base\\v\\hair.mi"], chunks: 1 }),
    "base\\v\\hair.mi": mi("base\\v\\hair.mt", [{ $type: "rRef:CHairProfile", HairProfile: rp("base\\v\\root.hp") },
      { $type: "rRef:CHairProfile", HairProfile: rp("base\\v\\tip.hp") }, { $type: "rRef:Multilayer_Setup", Setup: rp("base\\v\\hair.mlsetup") }]),
    "base\\v\\hair.mt": cr2w({ $type: "CMaterialTemplate", name: { $type: "CName", $storage: "string", $value: "hair" } }),
    "base\\v\\root.hp": cr2w({ $type: "CHairProfile" }),
    "base\\v\\tip.hp": cr2w({ $type: "CHairProfile" }),
    "base\\v\\hair.mlsetup": cr2w({ $type: "Multilayer_Setup", layers: [{ material: rp("base\\v\\one.mltemplate") }, { material: rp("base\\v\\two.mltemplate") }] }),
    "base\\v\\one.mltemplate": cr2w({ $type: "Multilayer_LayerTemplate" }),
    "base\\v\\two.mltemplate": cr2w({ $type: "Multilayer_LayerTemplate" }),
  };
  const byHash = new Map(Object.entries(files).map(([path, document]) => [depotHash(path), { path, document }]));
  const physical = join(root, "archive", "pc", "content", "basegame_1.archive");
  put(physical, "archive");
  const archive: ArchiveFile = { id: physical, virtualPath: "archive/pc/content/basegame_1.archive", provider: "game", providerName: "Installed game", active: true, priority: null };
  const plan = buildMountPlan([archive], null);
  const depot = new DepotIndex(plan, new Map([[physical, BigUint64Array.from([...byHash.keys()].map(BigInt)).sort()]]));
  const fetcher = new WolvenKitFetcher("WolvenKit.CLI.exe", cache, (id, hash) => depot.archiveContains(id, hash));
  const launches: string[][] = [];
  // A fake WolvenKit: uncook -u -s writes each resource its pattern names with its JSON; unbundle writes each listed hash's
  // resource by its path, and convert writes the JSON beside it.
  (fetcher as unknown as { run: unknown }).run = async (args: string[]) => {
    launches.push(args);
    if (args[0] === "uncook") {
      const out = args[args.indexOf("-o") + 1]!, pattern = new RegExp(args[args.indexOf("-r") + 1]!.replace("(?i)", ""), "i");
      for (const [hash, { path, document }] of byHash) if (pattern.test(path)) {
        put(join(out, ...path.split("\\")), hash);
        writeFileSync(join(out, ...path.split("\\")) + ".json", JSON.stringify(document));
      }
    } else if (args[0] === "unbundle") {
      const out = args[args.indexOf("-o") + 1]!;
      for (const hash of readFileSync(args[args.indexOf("--hash") + 1]!, "utf8").split(/\r?\n/).filter(Boolean))
        put(join(out, ...byHash.get(hash)!.path.split("\\")), hash);
    } else {
      const walk = (folder: string): void => { for (const name of readdirSync(folder, { withFileTypes: true })) {
        const full = join(folder, name.name);
        if (name.isDirectory()) walk(full);
        else if (!name.name.endsWith(".json")) writeFileSync(`${full}.json`, JSON.stringify(byHash.get(readFileSync(full, "utf8"))!.document));
      } };
      walk(args[2]!);
    }
    return { exitCode: 0, stdout: "", stderr: "", output: "" };
  };
  const graph = new ResourceGraph(depot, readArchiveXlConfig([]), fetcher, prefetch);
  const hair = await graph.app(refFromPath("base\\v\\hair.app"));
  for (const part of hair!.appearances[0]!.partsValues) await graph.entityComponents(part);
  await graph.mesh(refFromPath("base\\v\\hair.mesh"));
  await graph.load(refFromPath("base\\v\\hair.mi"), "mi");
  for (const path of ["base\\v\\hair.mt", "base\\v\\root.hp", "base\\v\\tip.hp", "base\\v\\hair.mlsetup", "base\\v\\one.mltemplate", "base\\v\\two.mltemplate"])
    expect(await graph.load(refFromPath(path))).not.toBeNull();
  return { batches: launches.filter(args => args[0] === "uncook" || args[0] === "unbundle").length, launches: launches.length, extracted: fetcher.stats.extracted };
}

test("prefetch reads a resource chain in fewer WolvenKit launches, and reads the same resources", async () => {
  const without = await readChain(false), withPrefetch = await readChain(true);
  expect(without.batches).toBe(11);
  expect(withPrefetch.batches).toBeLessThanOrEqual(6);
  // Resources with a depot path are extracted and serialized in one launch per batch (no separate convert).
  expect(withPrefetch.launches).toBe(withPrefetch.batches);
  expect(withPrefetch.extracted).toBe(without.extracted);
});

test("a batch extracts resources with a depot path in one launch, and falls back to extract-and-convert for the rest", async () => {
  const root = temporary(), cache = join(root, "cache");
  const physical = join(root, "mod.archive");
  put(physical, "archive");
  const archive = { id: physical, name: "mod.archive", virtualPath: "archive/pc/mod/mod.archive", group: "mod", provider: "game",
    providerName: "Installed game", rank: 0, shadowed: [] } as unknown as Parameters<WolvenKitFetcher["fetch"]>[0];
  const named = "mod\\hair.mesh", unnamed = "mod\\unnamed.mi", bare = "mod\\bare.mi";
  const hashes = new Map([named, unnamed, bare].map(path => [depotHash(path), path]));
  const fetcher = new WolvenKitFetcher("WolvenKit.CLI.exe", cache, (_id, hash) => hashes.has(hash));
  const launches: string[] = [];
  // The archive lists `unnamed` by hash only, so a pattern finds it only through the hash; `bare` serializes without JSON
  // in step 1 (as a converter crash would) but converts in step 2.
  (fetcher as unknown as { run: unknown }).run = async (args: string[]) => {
    launches.push(args[0]!);
    const out = args.includes("-o") ? args[args.indexOf("-o") + 1]! : args[2]!;
    if (args[0] === "uncook") {
      const pattern = new RegExp(args[args.indexOf("-r") + 1]!.replace("(?i)", ""), "i");
      for (const path of [named, bare]) if (pattern.test(path)) {
        put(join(out, ...path.split("\\")), path);
        if (path === named) writeFileSync(join(out, ...path.split("\\")) + ".json", JSON.stringify(cr2w({ $type: "CMesh", from: "uncook" })));
      }
    } else if (args[0] === "unbundle") {
      for (const hash of readFileSync(args[args.indexOf("--hash") + 1]!, "utf8").split(/\r?\n/).filter(Boolean))
        put(hashes.get(hash) === unnamed ? join(out, `${hash}.bin`) : join(out, ...hashes.get(hash)!.split("\\")), hash);
    } else {
      const walk = (folder: string): void => { for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const full = join(folder, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (!entry.name.endsWith(".json")) writeFileSync(`${full}.json`, JSON.stringify(cr2w({ $type: "CMaterialInstance", from: "convert" })));
      } };
      walk(out);
    }
    return { exitCode: 0, stdout: "", stderr: "", output: "" };
  };
  const [mesh, material, other] = await Promise.all([fetcher.fetch(archive, refFromPath(named), "mesh"),
    fetcher.fetch(archive, refFromPath(unnamed), "mi"), fetcher.fetch(archive, refFromPath(bare), "mi")]);
  expect(launches).toEqual(["uncook", "unbundle", "convert"]);
  expect((mesh!.document as { Data: { RootChunk: { from: string } } }).Data.RootChunk.from).toBe("uncook");
  expect((material!.document as { Data: { RootChunk: { from: string } } }).Data.RootChunk.from).toBe("convert");
  expect((other!.document as { Data: { RootChunk: { from: string } } }).Data.RootChunk.from).toBe("convert");
  expect(mesh!.fresh).toBe(true);
  expect(fetcher.stats.transient).toBe(0);
  // All three are cached now: nothing runs again.
  await fetcher.fetch(archive, refFromPath(named), "mesh");
  expect(launches).toHaveLength(3);
});
