// Preparing a Character panel row's choices ahead (choice-prefetch.ts), what makes a prepared choice ready across sessions
// (choice-manifest.ts), batched exports (game-asset-export.ts `exportAll`), the prepared files' budget (prepared-files.ts), the fetcher's
// foreground and background lanes and the graph's read recording. Fakes stand in for WolvenKit; no game file is read.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ArchiveFile, buildMountPlan, DepotIndex } from "../src/archive-precedence";
import { readArchiveXlConfig } from "../src/archivexl-config";
import { DEFAULT_CHARACTER, type CharacterRequest } from "../src/character-detail-request";
import { choiceKey, manifestHolds, manifestOf, readChoiceManifest, writeChoiceManifest, xlIdentity } from "../src/choice-manifest";
import { ChoicePrefetcher, type PrefetchDeps, requestKey } from "../src/choice-prefetch";
import { depotHash, refFromPath } from "../src/depot-path";
import { archiveExportSource, createGameAssetExporter, GameAssetExportError, type GeometryRepair, PARTIAL_RUNS, type UncookRun, usedThisSession } from "../src/game-asset-export";
import { clearPrepared, evictPrepared, preparedSize } from "../src/prepared-files";
import { backgroundExtraction, foregroundExtraction, WolvenKitFetcher } from "../src/resolver-host";
import { ResourceGraph } from "../src/resource-graph";
import { app, cr2w, fixtureInstallation, mesh, meshComponent } from "./resolver-fixtures";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = mkdtempSync(join(tmpdir(), "xfs-prefetch-")); roots.push(root); return root; };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const settle = async () => { for (let i = 0; i < 20; i++) await sleep(1); };

// ---- The prefetcher over fakes ----

const withChoice = (position: number): CharacterRequest => ({ ...DEFAULT_CHARACTER, choices: [{ part: "head", option: "hair", choice: `c${position}` }] });
function prefetcher(options: { ready?: Set<number>; warm?: PrefetchDeps["warm"]; limits?: Partial<{ batch: number; maxBatch: number; timeMs: number; bytes: number }>; bytes?: () => number; now?: () => number } = {}) {
  const warmed: number[][] = [];
  let foreground: Promise<void> = Promise.resolve();
  const deps: PrefetchDeps = {
    requestFor: async (_base, _option, position) => position >= 100 ? null : withChoice(position),
    readiness: async () => request => options.ready?.has(Number(request.choices![0]!.choice.slice(1))) ?? false,
    warm: options.warm ?? (async requests => { warmed.push(requests.map(request => Number(request.choices![0]!.choice.slice(1)))); return requests.map(() => ({ ready: true })); }),
    foregroundIdle: () => foreground,
    preparedBytes: async () => options.bytes?.() ?? 0,
    now: options.now,
  };
  const service = new ChoicePrefetcher(deps, { batch: 2, maxBatch: 2, timeMs: 60_000, bytes: 1e12, ...options.limits });
  return { service, warmed, hold: (until: Promise<void>) => { foreground = until; } };
}
const ask = (service: ChoicePrefetcher, positions: number[], focus: number | null = null) =>
  service.update({ base: DEFAULT_CHARACTER, option: "head/hair", positions, focus });

describe("preparing a row's choices ahead", () => {
  test("a choice whose manifest holds is ready at once; the rest are prepared in batches, in the panel's order, a hint first", async () => {
    const { service, warmed } = prefetcher({ ready: new Set([1]) });
    expect(ask(service, [0, 1, 2, 3, 4]).states).toBe("?????");
    await settle();
    // A batch of 2 first, then doubling.
    expect(warmed).toEqual([[0, 2], [3, 4]]);
    expect(ask(service, [0, 1, 2, 3, 4])).toMatchObject({ states: "rrrrr", busy: false, stopped: null });

    const hinted = prefetcher();
    ask(hinted.service, [0, 1, 2, 3], 3);
    await settle();
    expect(hinted.warmed[0]).toEqual([3, 0]);
    // A position the catalogue doesn't offer is not prepared, never queued.
    expect(ask(hinted.service, [0, 150]).states).toBe("r?");
    await settle();
    expect(ask(hinted.service, [0, 150]).states).toBe("rn");
  });

  test("later batches grow: a small first batch, then doubling up to the most", async () => {
    const { service, warmed } = prefetcher({ limits: { batch: 2, maxBatch: 8 } });
    ask(service, Array.from({ length: 16 }, (_, index) => index));
    await settle();
    expect(warmed.map(batch => batch.length)).toEqual([2, 4, 8, 2]);
  });

  test("a person's own change comes first: the batch in WolvenKit stops and is queued again, the queue waits, the change's choice shows as prepared", async () => {
    let release!: () => void;
    const signals: AbortSignal[] = [];
    const { service, hold } = prefetcher({ warm: (requests, signal) => { signals.push(signal); return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Error("cancelled")));
      if (signals.length > 1) resolve(requests.map(() => ({ ready: true })));
    }); } });
    ask(service, [0, 1, 2]);
    await settle();
    expect(ask(service, [0, 1, 2]).states).toBe("ffq");
    // A click on position 2: the person's change is prepared now; the batch stops and waits.
    hold(new Promise(resolve => { release = resolve; }));
    service.foreground(withChoice(2));
    await settle();
    expect(signals[0]!.aborted).toBe(true);
    expect(ask(service, [0, 1, 2]).states).toBe("qqf");
    expect(signals).toHaveLength(1);
    service.prepared(withChoice(2), true);
    expect(ask(service, [0, 1, 2]).states).toBe("qqr");
    release();
    await settle();
    expect(signals).toHaveLength(2);
    expect(ask(service, [0, 1, 2]).states).toBe("rrr");
  });

  test("closing the row cancels the job: its batch's signal aborts and no batch starts after", async () => {
    const signals: AbortSignal[] = [];
    const { service } = prefetcher({ warm: (requests, signal) => { signals.push(signal); return new Promise((_, reject) => signal.addEventListener("abort", () => reject(Error("cancelled")))); } });
    ask(service, [0, 1, 2, 3]);
    await settle();
    service.cancel();
    await settle();
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(true);
    // A new row starts a new job.
    service.update({ base: DEFAULT_CHARACTER, option: "head/eyes", positions: [0], focus: null });
    await settle();
    expect(signals).toHaveLength(2);
  });

  test("bounded: a job stops after its time, and preparing ahead stops for the session after its bytes; the rest show not prepared", async () => {
    let clock = 0;
    const timed = prefetcher({ now: () => clock, warm: async requests => { clock += 40_000; return requests.map(() => ({ ready: true })); } });
    ask(timed.service, [0, 1, 2, 3, 4, 5]);
    await settle();
    expect(ask(timed.service, [0, 1, 2, 3, 4, 5])).toMatchObject({ states: "rrrrnn", stopped: "time", busy: false });

    let bytes = 0;
    const heavy = prefetcher({ limits: { bytes: 100 }, bytes: () => bytes, warm: async requests => { bytes += 80; return requests.map(() => ({ ready: true })); } });
    ask(heavy.service, [0, 1, 2, 3, 4, 5]);
    await settle();
    expect(ask(heavy.service, [0, 1, 2, 3, 4, 5])).toMatchObject({ states: "rrrrnn", stopped: "disk" });
    // Spent for the session: another row doesn't start.
    expect(heavy.service.update({ base: DEFAULT_CHARACTER, option: "head/eyes", positions: [0], focus: null }).stopped).toBe("disk");
  });

  test("a failed batch marks its choices failed; a hint tries one again", async () => {
    let fail = true;
    const { service } = prefetcher({ warm: async requests => requests.map(() => ({ ready: !fail })) });
    ask(service, [0, 1]);
    await settle();
    expect(ask(service, [0, 1]).states).toBe("xx");
    fail = false;
    ask(service, [0, 1], 1);
    await settle();
    expect(ask(service, [0, 1]).states).toBe("xr");
    expect(requestKey(withChoice(1))).toBe(requestKey(structuredClone(withChoice(1))));
  });
});

// ---- A synthetic installation on disk: archives, the resolver's cache and the exporter's ----

const ARCHIVE_TIME = new Date(1_700_000_000_000);
function installationOnDisk(root: string) {
  const archives: Record<string, Record<string, object>> = {
    "base.archive": { "base\\hair\\a.app": app([{ name: "a", components: [meshComponent("hair", "base\\hair\\a.mesh")] }]),
      "base\\hair\\a.mesh": mesh({ appearances: [{ name: "default", chunkMaterials: [] }], entries: [], chunks: 1 }) },
    "mod.archive": { "mod\\hair\\b.mesh": mesh({ appearances: [{ name: "default", chunkMaterials: [] }], entries: [], chunks: 1 }) },
  };
  const files: ArchiveFile[] = [];
  const indexes = new Map<string, BigUint64Array>();
  for (const [name, content] of Object.entries(archives)) {
    const id = join(root, name);
    writeFileSync(id, `archive ${name}`);
    utimesSync(id, ARCHIVE_TIME, ARCHIVE_TIME);
    files.push({ id, virtualPath: `archive/pc/${name === "mod.archive" ? "mod" : "content"}/${name}`, provider: "game", providerName: name, active: true, priority: null });
    indexes.set(id, BigUint64Array.from(Object.keys(content).map(path => BigInt(depotHash(path)))).sort());
  }
  const depot = new DepotIndex(buildMountPlan(files, null), indexes);
  const cache = join(root, "resolver");
  const open = () => {
    const fetcher = new WolvenKitFetcher("WolvenKit.CLI.exe", cache, (id, hash) => depot.archiveContains(id, hash));
    // A fake `uncook -s`: every selected path is written with its JSON.
    (fetcher as unknown as { run: unknown }).run = async (args: string[]) => {
      const out = args[args.indexOf("-o") + 1]!, pattern = args[args.indexOf("-r") + 1]!;
      for (const archive of args.slice(1, args.indexOf("-o"))) for (const [path, document] of Object.entries(archives[archive.split(/[\\/]/).pop()!] ?? {})) {
        if (!new RegExp(pattern.replace("(?i)", ""), "i").test(path)) continue;
        const file = join(out, ...path.split("\\"));
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, "raw"); writeFileSync(`${file}.json`, JSON.stringify(document));
      }
      return { exitCode: 0, stdout: "", stderr: "", output: "" };
    };
    return { fetcher, graph: new ResourceGraph(depot, readArchiveXlConfig([]), fetcher) };
  };
  const exports = join(root, "exports");
  const exporter = createGameAssetExporter(exports, async ({ depotPaths, outDir }) => {
    for (const path of depotPaths) {
      const file = join(outDir, ...path.split("\\"));
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "raw"); writeFileSync(file.replace(/\.mesh$/, ".glb"), "glb");
    }
  }, { tool: { key: "fake", label: "Fake" }, contains: (source, hashes) => new Set(hashes.filter(hash => depot.archiveContains(source.archivePath, hash))) });
  return { depot, files, cache, exports, exporter, open, gameRoot: root };
}

describe("a prepared choice across sessions (manifests)", () => {
  test("a restart keeps it ready; a changed archive (time or size), a changed .xl or an evicted export makes it not prepared", async () => {
    const root = temporary(), setup = installationOnDisk(root);
    const first = setup.open();
    const { reads } = await first.graph.recordReads(async () => { await first.graph.app(refFromPath("base\\hair\\a.app")); await first.graph.mesh(refFromPath("base\\hair\\a.mesh")); });
    const base = join(root, "base.archive");
    const [answer] = await setup.exporter.exportAll!([{ source: archiveExportSource(base, root), geometry: ["base\\hair\\a.mesh"], textures: [], masks: [] }]);
    expect(answer!.geometry.get("base\\hair\\a.mesh")?.glb).toContain(setup.exports);
    const watch = [{ path: join(root, "a.xl"), stamp: "file|1|1" }];
    const manifest = manifestOf(first.graph, reads, [["geometry", "base\\hair\\a.mesh", base]], first.fetcher.tool, xlIdentity({ watch }));
    expect(manifest.reads.map(read => read[0]).sort()).toEqual([depotHash("base\\hair\\a.app"), depotHash("base\\hair\\a.mesh")].sort());
    const dir = join(root, "choices"), key = choiceKey("route", withChoice(1));
    writeChoiceManifest(dir, key, manifest);

    // "Restart": a new fetcher, graph and exporter over the same files.
    const again = setup.open();
    const check = (xl = watch) => manifestHolds(readChoiceManifest(dir, key)!, { graph: again.graph, fetcher: again.fetcher, exporter: setup.exporter, gameRoot: root,
      tool: again.fetcher.tool, xl: xlIdentity({ watch: xl }) });
    expect(check()).toBe(true);
    expect(check([{ path: join(root, "a.xl"), stamp: "file|2|1" }])).toBe(false);
    // The archive's time changes (a mod updated in place): not prepared.
    const later = new Date(ARCHIVE_TIME.getTime() + 5000);
    utimesSync(base, later, later);
    expect(check()).toBe(false);
    // Back to the old identity, it holds again; another size with the old time does not.
    utimesSync(base, ARCHIVE_TIME, ARCHIVE_TIME);
    expect(check()).toBe(true);
    writeFileSync(base, "archive base.archive, a newer version");
    utimesSync(base, ARCHIVE_TIME, ARCHIVE_TIME);
    expect(check()).toBe(false);
  });

  test("an export evicted from the cache makes it not prepared", async () => {
    const root = temporary(), setup = installationOnDisk(root), first = setup.open();
    const mod = join(root, "mod.archive");
    await setup.exporter.exportAll!([{ source: archiveExportSource(mod, root), geometry: ["mod\\hair\\b.mesh"], textures: [], masks: [] }]);
    const manifest = manifestOf(first.graph, [], [["geometry", "mod\\hair\\b.mesh", mod]], first.fetcher.tool, "xl");
    const check = () => manifestHolds(manifest, { graph: first.graph, fetcher: first.fetcher, exporter: setup.exporter, gameRoot: root, tool: first.fetcher.tool, xl: "xl" });
    expect(check()).toBe(true);
    rmSync(join(setup.exports, "resources"), { recursive: true, force: true });
    expect(check()).toBe(false);
  });
});

// ---- Exports in one launch ----

describe("exports in as few launches as possible", () => {
  function recordingExporter(root: string, holds: Record<string, string[]>, options: { failFor?: string; noGlbWithoutGame?: string[]; noMaterials?: boolean } = {}) {
    const launches: { archives: string[]; paths: string[]; withMaterials: boolean; lowPriority?: boolean }[] = [];
    const run: UncookRun = async ({ source, sources, depotPaths, outDir, withMaterials, lowPriority }) => {
      const archives = (sources ?? [source]).map(item => item.archivePath);
      launches.push({ archives, paths: [...depotPaths], withMaterials, lowPriority });
      if (options.failFor && archives.includes(options.failFor) && archives.length > 1) throw new GameAssetExportError("tool_failed", "WolvenKit failed.");
      if (options.failFor && archives.length === 1 && archives[0] === options.failFor) throw new GameAssetExportError("tool_failed", "WolvenKit failed.");
      for (const path of depotPaths) {
        const file = join(outDir, ...path.split("\\"));
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, "raw");
        if (path.endsWith(".xbm")) writeFileSync(file.replace(/\.xbm$/, ".png"), "png");
        if (path.endsWith(".mesh") && (withMaterials || !options.noGlbWithoutGame?.includes(path))) writeFileSync(file.replace(/\.mesh$/, ".glb"), "glb");
        if (path.endsWith(".mesh") && withMaterials && !options.noMaterials) writeFileSync(file.replace(/\.mesh$/, ".Material.json"), "{}");
      }
    };
    const exporter = createGameAssetExporter(join(root, "exports"), run, { tool: { key: "fake", label: "Fake" },
      contains: (source, hashes) => new Set(hashes.filter(hash => (holds[source.archivePath] ?? []).some(path => depotHash(path) === hash))) });
    return { exporter, launches };
  }

  test("several archives share one launch unless their resources collide; a shared launch's failure is retried per archive; nothing points into a work folder", async () => {
    const root = temporary();
    const a = join(root, "a.archive"), b = join(root, "b.archive"), c = join(root, "c.archive");
    const holds = { [a]: ["x\\a.mesh", "x\\t.xbm"], [b]: ["y\\b.mesh"], [c]: ["x\\t.xbm", "z\\c.mesh"] };
    const { exporter, launches } = recordingExporter(root, holds);
    const answers = await exporter.exportAll!([
      { source: archiveExportSource(a, root), geometry: ["x\\a.mesh"], textures: ["x\\t.xbm"], masks: [] },
      { source: archiveExportSource(b, root), geometry: ["y\\b.mesh"], textures: [], masks: [] },
      // c holds a texture a is asked for: it gets a launch of its own.
      { source: archiveExportSource(c, root), geometry: ["z\\c.mesh"], textures: [], masks: [] },
    ], undefined, { lowPriority: true });
    expect(launches.map(launch => launch.archives.map(path => path.split(/[\\/]/).pop()))).toEqual([["a.archive", "b.archive"], ["c.archive"]]);
    // Character geometry runs without the game folder, at the priority asked for.
    expect(launches.every(launch => !launch.withMaterials && launch.lowPriority)).toBe(true);
    for (const answer of answers) for (const kind of ["geometry", "textures"] as const) for (const value of answer[kind].values())
      expect(JSON.stringify(value)).not.toContain(".work-");
    expect(answers[0]!.geometry.get("x\\a.mesh")).toMatchObject({ complete: true, cached: false });
    expect(answers[0]!.textures.get("x\\t.xbm")?.png).toContain(join(root, "exports"));
    // A second ask is answered from the cache: no launch.
    const before = launches.length;
    await exporter.exportAll!([{ source: archiveExportSource(b, root), geometry: ["y\\b.mesh"], textures: [], masks: [] }]);
    expect(launches.length).toBe(before);

    const failing = recordingExporter(temporary(), holds, { failFor: b });
    const failed = await failing.exporter.exportAll!([
      { source: archiveExportSource(a, root), geometry: ["x\\a.mesh"], textures: [], masks: [] },
      { source: archiveExportSource(b, root), geometry: ["y\\b.mesh"], textures: [], masks: [] }]);
    expect(failing.launches.map(launch => launch.archives.length)).toEqual([2, 1, 1]);
    expect(failed[0]!.failed).toBeUndefined();
    expect(failed[0]!.geometry.get("x\\a.mesh")?.glb).toBeTruthy();
    expect(failed[1]!.failed?.code).toBe("tool_failed");
  });

  test("geometry without materials is exported without the game folder, and again with it when no GLB came out; the core preview's materials are still required", async () => {
    const root = temporary(), a = join(root, "a.archive");
    const { exporter, launches } = recordingExporter(root, { [a]: ["x\\a.mesh", "x\\b.mesh"] }, { noGlbWithoutGame: ["x\\b.mesh"] });
    const [answer] = await exporter.exportAll!([{ source: archiveExportSource(a, root), geometry: ["x\\a.mesh", "x\\b.mesh"], textures: [], masks: [] }]);
    expect(launches.map(launch => [launch.withMaterials, launch.paths])).toEqual([[false, ["x\\a.mesh", "x\\b.mesh"]], [true, ["x\\b.mesh"]]]);
    expect(answer!.geometry.get("x\\b.mesh")?.glb).toBeTruthy();
    // The core preview asks for the materials file too: a GLB-only entry is not enough, so it is exported again with it.
    const session = exporter.open(archiveExportSource(a, root));
    const core = await session.geometry(["x\\a.mesh"]);
    session.close();
    expect(launches.at(-1)).toMatchObject({ withMaterials: true, paths: ["x\\a.mesh"] });
    expect(core.get("x\\a.mesh")).toMatchObject({ complete: true });
    expect(core.get("x\\a.mesh")!.materials).toBeTruthy();
  });

  test("a resource clean launches export nothing for settles: from the PARTIAL_RUNSth it isn't asked for again, and counts as prepared", async () => {
    const root = temporary(), a = join(root, "a.archive");
    // WolvenKit exports nothing for it, with or without the game folder (a CCXL mesh it can't uncook).
    let launches = 0;
    const gone = createGameAssetExporter(join(root, "exports"), async () => { launches++; }, { tool: { key: "fake", label: "Fake" } });
    const ask = () => gone.exportAll!([{ source: archiveExportSource(a, root), geometry: ["x\gone.mesh"], textures: [], masks: [] }]);
    for (let run = 0; run < PARTIAL_RUNS; run++) expect((await ask())[0]!.geometry.size).toBe(0);
    expect(launches).toBe(PARTIAL_RUNS * 2);
    expect(gone.has!("geometry", "x\gone.mesh", archiveExportSource(a, root))).toBe(true);
    await ask();
    expect(launches).toBe(PARTIAL_RUNS * 2);
  });

  test("a partial export (no materials file) is kept from its first clean run and served from the cache from the PARTIAL_RUNSth", async () => {
    const root = temporary(), a = join(root, "a.archive");
    const { exporter, launches } = recordingExporter(root, { [a]: ["x\\a.mesh"] }, { noMaterials: true });
    const ask = async () => { const session = exporter.open(archiveExportSource(a, root)); try { return (await session.geometry(["x\\a.mesh"])).get("x\\a.mesh")!; } finally { session.close(); } };
    const first = await ask();
    expect(first).toMatchObject({ complete: false });
    expect(existsSync(first.glb!)).toBe(true);
    for (let run = 1; run < PARTIAL_RUNS; run++) await ask();
    const runs = launches.length;
    const cached = await ask();
    expect(launches.length).toBe(runs);
    expect(cached).toMatchObject({ complete: false, cached: true });
  });
});

describe("lasting outcomes and the mesh export repair", () => {
  // WolvenKit reads the ponytail mesh (its raw copy is written) but refuses to write its GLB (mesh-export-repair.ts).
  const PONY = "base\\characters\\common\\hair\\fhair_highpony_pony.mesh";
  const readOnly = (launches: { withMaterials: boolean; lowPriority?: boolean }[] = []): UncookRun => async ({ depotPaths, outDir, withMaterials, lowPriority }) => {
    launches.push({ withMaterials, lowPriority });
    for (const path of depotPaths) {
      const file = join(outDir, ...path.split("\\"));
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "raw mesh");
    }
  };
  const repairing = (outcome: "glb" | "none", calls: { path: string; lowPriority?: boolean }[] = []): GeometryRepair => async ({ depotPath, workDir, lowPriority }) => {
    calls.push({ path: depotPath, lowPriority });
    if (outcome === "none") return null;
    writeFileSync(join(workDir, "copy.glb"), "glTF");
    return { glb: join(workDir, "copy.glb"), materials: null, detail: "the copy's repair" };
  };
  const tool = { key: "fake", label: "Fake" };

  test("exportAll repairs a mesh the tool read but wrote no GLB for, on its last launch only and at the priority asked for; the repair is cached", async () => {
    const root = temporary(), source = archiveExportSource(join(root, "hair.archive"), root);
    const launches: { withMaterials: boolean; lowPriority?: boolean }[] = [], calls: { path: string; lowPriority?: boolean }[] = [];
    const exporter = createGameAssetExporter(join(root, "exports"), readOnly(launches), { tool, repairGeometry: repairing("glb", calls), repairKey: "r1" });
    const [answer] = await exporter.exportAll!([{ source, geometry: [PONY], textures: [], masks: [] }], undefined, { lowPriority: true });
    // Without the game folder first, then with it; the repair runs once, after the second launch.
    expect(launches.map(launch => launch.withMaterials)).toEqual([false, true]);
    expect(calls).toEqual([{ path: PONY, lowPriority: true }]);
    expect(answer!.geometry.get(PONY)).toMatchObject({ complete: true, repair: "the copy's repair" });
    expect(readFileSync(answer!.geometry.get(PONY)!.glb!, "utf8")).toBe("glTF");
    const [again] = await exporter.exportAll!([{ source, geometry: [PONY], textures: [], masks: [] }]);
    expect(again!.geometry.get(PONY)).toMatchObject({ cached: true, repair: "the copy's repair" });
    expect(launches).toHaveLength(2);
  });

  test("a settled 'nothing exported' recorded without the repair, or by another version of it, never blocks the repaired export", async () => {
    const root = temporary(), cacheRoot = join(root, "exports"), source = archiveExportSource(join(root, "hair.archive"), root);
    const ask = (exporter: ReturnType<typeof createGameAssetExporter>) => exporter.exportAll!([{ source, geometry: [PONY], textures: [], masks: [] }]);
    // An exporter without the repair settles the mesh as exporting nothing.
    const before = createGameAssetExporter(cacheRoot, readOnly(), { tool });
    for (let run = 0; run < PARTIAL_RUNS; run++) await ask(before);
    expect(before.has!("geometry", PONY, source)).toBe(true);
    // A repair whose version also fails settles again under its own identity...
    const failing = createGameAssetExporter(cacheRoot, readOnly(), { tool, repairGeometry: repairing("none"), repairKey: "r1" });
    expect(failing.has!("geometry", PONY, source)).toBe(false);
    for (let run = 0; run < PARTIAL_RUNS; run++) expect((await ask(failing))[0]!.geometry.get(PONY)?.glb ?? null).toBeNull();
    expect(failing.has!("geometry", PONY, source)).toBe(true);
    // ...and the next version is tried and wins.
    const calls: { path: string }[] = [];
    const repaired = createGameAssetExporter(cacheRoot, readOnly(), { tool, repairGeometry: repairing("glb", calls), repairKey: "r2" });
    expect(repaired.has!("geometry", PONY, source)).toBe(false);
    expect((await ask(repaired))[0]!.geometry.get(PONY)).toMatchObject({ complete: true, repair: "the copy's repair" });
    expect(calls).toHaveLength(1);
    expect(repaired.has!("geometry", PONY, source)).toBe(true);
  });

  test("a lasting partial export counts only for the exporter identity that recorded it", async () => {
    const root = temporary(), cacheRoot = join(root, "exports"), source = archiveExportSource(join(root, "a.archive"), root);
    let launches = 0;
    // The GLB without its materials file (a partial export).
    const partial: UncookRun = async ({ depotPaths, outDir }) => {
      launches++;
      for (const path of depotPaths) {
        const file = join(outDir, ...path.split("\\"));
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, "raw");
        writeFileSync(file.replace(/\.mesh$/, ".glb"), "glb");
      }
    };
    const ask = async (exporter: ReturnType<typeof createGameAssetExporter>) => {
      const session = exporter.open(source);
      try { return (await session.geometry(["x\\a.mesh"])).get("x\\a.mesh")!; } finally { session.close(); }
    };
    const before = createGameAssetExporter(cacheRoot, partial, { tool });
    for (let run = 0; run < PARTIAL_RUNS; run++) await ask(before);
    expect(await ask(before)).toMatchObject({ cached: true, complete: false });
    const counted = launches;
    const after = createGameAssetExporter(cacheRoot, partial, { tool, repairGeometry: repairing("none"), repairKey: "r1" });
    expect(await ask(after)).toMatchObject({ cached: false });
    expect(launches).toBe(counted + 1);
  });
});

// ---- The prepared files' budget ----

describe("the prepared game files", () => {
  test("eviction removes the least recently used first, never what this session used; Clear removes everything and says how much", async () => {
    const root = temporary();
    const roots = { exports: join(root, "exports"), resolver: join(root, "resolver"), store: join(root, "characters"), manifests: join(root, "choices") };
    const entry = (name: string, bytes: number, ageMs: number) => {
      const folder = join(roots.exports, "resources", name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "export.glb"), "x".repeat(bytes));
      writeFileSync(join(folder, "entry.json"), "{}");
      const when = new Date(Date.now() - ageMs);
      utimesSync(join(folder, "entry.json"), when, when);
      return join(folder, "entry.json");
    };
    entry("old", 1000, 60_000); entry("newer", 1000, 30_000);
    mkdirSync(join(roots.resolver, "json"), { recursive: true });
    const json = join(roots.resolver, "json", "1-a-b.json");
    writeFileSync(json, "y".repeat(1000));
    const hour = new Date(Date.now() - 3_600_000);
    utimesSync(json, hour, hour);
    writeFileSync(join(roots.resolver, "json", "2-a-b.json.failed"), "{}");
    // Used by this session: kept whatever its age.
    const { touchUsed } = await import("../src/game-asset-export");
    const used = entry("used", 1000, 90_000);
    touchUsed(used);
    const old = new Date(Date.now() - 90_000);
    utimesSync(used, old, old);
    expect(usedThisSession(used)).toBe(true);
    const evicted = await evictPrepared(roots, 2100);
    expect(evicted.removed).toBe(2);
    expect(readdirSync(join(roots.exports, "resources")).sort()).toEqual(["newer", "used"]);
    expect(existsSync(json)).toBe(false);
    mkdirSync(roots.store, { recursive: true }); writeFileSync(join(roots.store, "a.png"), "z".repeat(500));
    const before = await preparedSize(roots);
    expect(before.store).toBe(500);
    const cleared = await clearPrepared(roots);
    expect(cleared.freed).toBe(before.bytes);
    expect((await preparedSize(roots)).bytes).toBe(0);
    // Lasting failure markers are tiny and kept.
    expect(readdirSync(join(roots.resolver, "json"))).toEqual(["2-a-b.json.failed"]);
  });
});

// ---- Lanes and read recording ----

describe("the fetcher's lanes and the graph's reads", () => {
  test("a foreground batch doesn't wait behind a background batch in WolvenKit; background launches run at low priority", async () => {
    const root = temporary(), cache = join(root, "cache");
    const archive = { id: join(root, "a.archive"), name: "a.archive", virtualPath: "archive/pc/content/a.archive", group: "content", provider: "game", providerName: "game", rank: 0, shadowed: [] };
    writeFileSync(archive.id, "archive");
    const fetcher = new WolvenKitFetcher("WolvenKit.CLI.exe", cache, () => true);
    const runs: { hashes: string; lowPriority: boolean | undefined; at: number; done?: number }[] = [];
    let releaseBackground!: () => void;
    const background = new Promise<void>(resolve => { releaseBackground = resolve; });
    (fetcher as unknown as { run: unknown }).run = async (args: string[], options: { lowPriority?: boolean }) => {
      const entry = { hashes: args.join(" "), lowPriority: options.lowPriority, at: Date.now() };
      runs.push(entry);
      if (args[0] === "unbundle") {
        const out = args[args.indexOf("-o") + 1]!, list = readFileSync(args[args.indexOf("--hash") + 1]!, "utf8").split(/\r?\n/).filter(Boolean);
        if (list.includes("1")) await background;
        mkdirSync(out, { recursive: true });
        for (const hash of list) writeFileSync(join(out, `${hash}.app`), "raw");
      }
      if (args[0] === "convert") for (const name of readdirSync(args[2]!)) if (!name.endsWith(".json")) writeFileSync(join(args[2]!, `${name}.json`), JSON.stringify(cr2w({ $type: "x" })));
      return { exitCode: 0, stdout: "", stderr: "", output: "" };
    };
    const slow = backgroundExtraction(cache, () => fetcher.fetch(archive as never, { hash: "1", path: null }, "app"));
    await sleep(80);
    const quick = await foregroundExtraction(cache, () => fetcher.fetch(archive as never, { hash: "2", path: null }, "app"));
    expect(quick).not.toBeNull();
    releaseBackground();
    expect(await slow).not.toBeNull();
    const byHash = (hash: string) => runs.filter(run => run.hashes.includes(`${join(cache, "tmp")}`) && run.hashes.startsWith("unbundle")).find(run => readFileSync(run.hashes.split("--hash ")[1]!, "utf8").includes(hash));
    expect(runs.filter(run => run.hashes.startsWith("unbundle")).map(run => run.lowPriority)).toEqual([true, false]);
    void byHash;
  });

  test("recordReads records consumer reads and memoised models, never prefetched ones; prefetchRef reads with the current batch", async () => {
    const { graph, fetched } = fixtureInstallation([{ virtualPath: "archive/pc/content/base.archive", files: {
      "base\\a.app": app([{ name: "a", components: [meshComponent("m", "base\\a.mesh")] }]),
      "base\\a.mesh": mesh({ appearances: [{ name: "default", chunkMaterials: [] }], entries: [], chunks: 1 }),
      "base\\b.mesh": mesh({ appearances: [{ name: "default", chunkMaterials: [] }], entries: [], chunks: 1 }) } }]);
    graph.prefetchRef(refFromPath("base\\b.mesh"), "mesh");
    const { reads } = await graph.recordReads(async () => { await graph.app(refFromPath("base\\a.app")); await graph.mesh(refFromPath("base\\a.mesh")); });
    expect([...reads].sort()).toEqual([depotHash("base\\a.app"), depotHash("base\\a.mesh")].sort());
    expect(fetched.map(item => item.ref.path)).toContain("base\\b.mesh");
    // A memoised model asked for again is recorded again.
    const again = await graph.recordReads(() => graph.mesh(refFromPath("base\\a.mesh")));
    expect([...again.reads]).toEqual([depotHash("base\\a.mesh")]);
  });
});

test("choosing in the row keeps its job: the V is keyed without the row's own choice", async () => {
  const { service, warmed } = prefetcher();
  const withRowChoice: CharacterRequest = { ...DEFAULT_CHARACTER, choices: [{ part: "head", option: "hair", choice: "c3" }] };
  ask(service, [0, 1]);
  await settle();
  expect(service.update({ base: withRowChoice, option: "head/hair", positions: [0, 1], focus: null }).states).toBe("rr");
  expect(warmed).toEqual([[0, 1]]);
});
