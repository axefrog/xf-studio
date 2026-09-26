// The native reader in the resolver host (research/backlog/native-archive-reader.md, integration): each cache folder's fetch port reads
// natively first and falls back to WolvenKit per resource, with typed reasons; native answers never enter WolvenKit's cache, and what is
// kept of them is keyed by the native reader's identity; the reader's notes and left-out properties reach the resolver's models, the
// plan and the diagnostics log. Synthetic archives only: no game data, no WolvenKit (its launches are faked).
import { afterAll, afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { MountedArchive } from "../src/archive-precedence";
import { planCharacterDetails } from "../src/character-detail-plan";
import { loadMergedCco, resolveCharacter } from "../src/character-resolver";
import { refFromPath } from "../src/depot-path";
import { hostDiagnosticsAt, withDiagnostics } from "../src/diagnostics/host-log";
import { InstallationRegistry } from "../src/installation-registry";
import { NativeArchivePool } from "../src/native/archive-reader";
import type { NativeDecodeOutcome, NativeDecoder } from "../src/native/native-decode";
import { NATIVE_FAILURE_KINDS, type NativeFailureKind } from "../src/native/native-errors";
import { inProcessDecoder, NativeFirstFetcher, type NativeReader, nativeReaderIdentity, TRANSIENT_NATIVE_FAILURES } from "../src/native/native-fetch-port";
import { installationView, type NativeRoute, openInstallation, type InstallationOptions } from "../src/resolver-host";
import { forgetDefaulted, jsonPathSteps, ResourceGraph, type ResourceFetchPort } from "../src/resource-graph";
import { detailFixture, P, REQUEST_A } from "./character-detail-fixtures";
import { inputFromCharacterRequest } from "../src/character-detail-request";
import { fakeDecompress, syntheticArchive } from "./fixtures/native-archive";
import { Cr2wBuilder, prop, v } from "./fixtures/native-cr2w";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = mkdtempSync(join(tmpdir(), "xfs-native-resolver-")); roots.push(root); return root; };
const put = (path: string, content: string | Uint8Array) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
const closers: (() => void)[] = [];
afterEach(() => { for (const close of closers.splice(0)) close(); });

function readerOver(tag = "test"): NativeReader {
  const pool = new NativeArchivePool(fakeDecompress);
  return { pool, decompress: fakeDecompress, identity: nativeReaderIdentity(tag), oodleSha256: "0".repeat(64), close: () => pool.close() };
}
const route = (tag = "test"): NativeRoute => { const decoder = inProcessDecoder(readerOver(tag)); closers.push(() => decoder.close()); return { decoder }; };

/** A mesh with three chunks: one drawn, one that leaves its render mask out, one shadow-only; `objectType` stored as Bool (RTTI: an enum). */
function meshBytes(): Uint8Array {
  const file = new Cr2wBuilder();
  const chunk = (...flags: string[]) => v.struct([prop("lodMask", "Uint8", v.u8(1)), ...(flags.length ? [prop("renderMask", "EMeshChunkFlags", v.bitfield(...flags))] : [])]);
  file.export("CMesh", [prop("objectType", "Bool", v.bool(true)), prop("renderResourceBlob", "handle:IRenderResourceBlob", v.handle(1))]);
  file.export("rendRenderMeshBlob", [prop("header", "rendRenderMeshBlobHeader", v.struct([prop("renderChunkInfos", "array:rendChunk",
    v.array([chunk("MCF_RenderInScene"), chunk(), chunk("MCF_RenderInShadows")]))]))]);
  return file.build();
}
function resource(className: string, props = [prop("sampleCount", "Uint16", v.u16(16))]) { const file = new Cr2wBuilder(); file.export(className, props); return file.build(); }

/** A game folder (direct route) with one archive: a hair profile and a mesh the native reader reads, a rig it doesn't, a damaged material. */
function gameFolder() {
  const root = temporary(), game = join(root, "game");
  const archive = join(game, "archive", "pc", "content", "basegame_9_fixture.archive");
  put(archive, syntheticArchive([
    { path: "base\\fixture\\a.hp", segments: [{ bytes: resource("CHairProfile") }] },
    { path: "base\\fixture\\m.mesh", segments: [{ bytes: meshBytes(), compress: true }] },
    { path: "base\\fixture\\r.rig", segments: [{ bytes: resource("animRig", []) }] },
    { path: "base\\fixture\\broken.mi", segments: [{ bytes: new Uint8Array([1, 2, 3]) }] },
  ], { names: true }));
  put(join(game, "bin", "x64", "Cyberpunk2077.exe"), "game");
  const cli = join(root, "WolvenKit.CLI.exe");
  put(cli, "fake WolvenKit");
  const options: InstallationOptions = { gameRoot: game, launchRoute: "direct", manualModRoot: null, wolvenKitCli: cli, cacheDir: join(root, "cache") };
  return { root, game, archive, cli, options };
}

/** Fake WolvenKit launches: `uncook -s` writes each selected path with a JSON saying WolvenKit read it. Returns the launch count. */
function fakeWolvenKit(fetcher: { wolvenKit: object }): { launches: () => number } {
  let launches = 0;
  (fetcher.wolvenKit as { run: unknown }).run = async (args: string[]) => {
    launches++;
    if (args[0] === "uncook") {
      const out = args[args.indexOf("-o") + 1]!, pattern = new RegExp(args[args.indexOf("-r") + 1]!.replace("(?i)", ""), "i");
      for (const path of ["base\\fixture\\r.rig", "base\\fixture\\broken.mi", "base\\fixture\\a.hp"]) if (pattern.test(path)) {
        const file = join(out, ...path.split("\\"));
        put(file, "raw"); put(`${file}.json`, JSON.stringify({ Header: {}, Data: { RootChunk: { $type: "wolvenkit", path } } }));
      }
    }
    return { exitCode: 0, stdout: "", stderr: "", output: "" };
  };
  return { launches: () => launches };
}
const rootOf = (document: unknown) => (document as { Data: { RootChunk: Record<string, unknown> } }).Data.RootChunk;

test("a route with a native decoder reads natively first; WolvenKit answers only what the reader can't, and caches only its own answers", async () => {
  const setup = gameFolder(), diagnostics = hostDiagnosticsAt(join(setup.root, "data"));
  await withDiagnostics(diagnostics, async () => {
    const native = route();
    const installation = openInstallation({ ...setup.options, native });
    expect(installation.summary.nativeReader).toEqual({ state: "on", identity: nativeReaderIdentity("test") });
    const wk = fakeWolvenKit(installation.fetcher);
    const { graph, fetcher } = installation;

    const hair = await graph.load(refFromPath("base\\fixture\\a.hp"), "hp");
    expect(hair!.root).toMatchObject({ $type: "CHairProfile", sampleCount: 16 });
    expect(wk.launches()).toBe(0);
    // Not a verified class, and damaged bytes: WolvenKit reads both, in one launch.
    const [rig, broken] = await Promise.all([graph.load(refFromPath("base\\fixture\\r.rig"), "rig"), graph.load(refFromPath("base\\fixture\\broken.mi"), "mi")]);
    expect(rig!.root).toEqual({ $type: "wolvenkit", path: "base\\fixture\\r.rig" });
    expect(broken!.root).toEqual({ $type: "wolvenkit", path: "base\\fixture\\broken.mi" });
    expect(wk.launches()).toBe(1);
    expect(fetcher.nativeStats).toMatchObject({ native: 1, fallback: 2 });
    expect(fetcher.nativeStats!.byKind).toMatchObject({ "not-verified": 1, malformed: 1 });
    expect(fetcher.stats.extracted).toBe(2);

    // WolvenKit's cache holds its own two answers only; the native answer left a marker keyed by the reader's identity, nothing more.
    const cached = readdirSync(join(setup.options.cacheDir, "json")).filter(name => name.endsWith(".json"));
    expect(cached.length).toBe(2);
    await Bun.sleep(20);
    const markers = readdirSync(join(setup.options.cacheDir, "native"));
    expect(markers).toEqual([expect.stringMatching(/^\d+-[0-9a-f]{24}-[0-9a-f]{12}\.ok$/)]);
    expect(markers[0]!.startsWith(refFromPath("base\\fixture\\a.hp").hash)).toBe(true);

    // The damaged material is logged in plain words (a class the reader doesn't read is only counted).
    const logged = diagnostics.log.tail().filter(entry => entry.area === "resolver");
    expect(logged.map(entry => [entry.code, entry.level])).toEqual([["native_fallback", "warn"]]);
    expect(logged[0]!.message).toContain("couldn't read basegame_9_fixture.archive: base\\fixture\\broken.mi itself (malformed), so WolvenKit read it instead");
  });
});

test("which resources a later session answers without WolvenKit is keyed by archive identity and reader identity, never WolvenKit's", async () => {
  const setup = gameFolder();
  const first = openInstallation({ ...setup.options, native: route("reader-1") });
  fakeWolvenKit(first.fetcher);
  const archive = first.plan.archives[0]!, hp = refFromPath("base\\fixture\\a.hp").hash, rig = refFromPath("base\\fixture\\r.rig").hash;
  await first.graph.load(refFromPath("base\\fixture\\a.hp"), "hp");
  await first.graph.load(refFromPath("base\\fixture\\r.rig"), "rig");
  expect(first.fetcher.isCached(archive, hp)).toBe(true);
  expect(first.fetcher.isCached(archive, rig)).toBe(true);
  expect(first.fetcher.wolvenKit.isCached(archive, hp)).toBe(false);
  await Bun.sleep(20);

  // A restart with the same reader: both still answer without WolvenKit.
  const again = installationView({ ...first, native: route("reader-1") }, setup.options);
  expect(again.fetcher.isCached(archive, hp)).toBe(true);
  // Another reader identity doesn't reuse the first reader's answers (WolvenKit's own cache still counts).
  const other = installationView({ ...first, native: route("reader-2") }, setup.options);
  expect(other.fetcher.isCached(archive, hp)).toBe(false);
  expect(other.fetcher.isCached(archive, rig)).toBe(true);
  // Without a native decoder, nothing native counts.
  const plain = installationView({ ...first, native: null }, setup.options);
  expect(plain.fetcher.native).toBeNull();
  expect(plain.fetcher.isCached(archive, hp)).toBe(false);
  // The archive changes (a mod updated in place): not answered for its new bytes yet.
  const later = new Date(Date.now() + 60_000);
  utimesSync(setup.archive, later, later);
  expect(installationView({ ...first, native: route("reader-1") }, setup.options).fetcher.isCached(archive, hp)).toBe(false);
});

test("the reader's notes and left-out properties reach the resolver's models: a mesh chunk without a render mask is drawn", async () => {
  const setup = gameFolder(), diagnostics = hostDiagnosticsAt(join(setup.root, "data"));
  const installation = openInstallation({ ...setup.options, native: route() });
  const mesh = await installation.graph.mesh(refFromPath("base\\fixture\\m.mesh"));
  // Chunk 1 leaves its mask out: the engine's default flags draw it (WolvenKit's JSON shows "0", which would read as not drawn).
  expect(mesh!.renderChunkScene).toEqual([true, true, false]);
  expect(mesh!.notes.map(note => note.rule)).toEqual(["R11-stored-type", "R12-property-absent"]);
  expect(mesh!.notes[0]!.basis).toContain("CMesh.objectType is stored as Bool where the game's current type is ERenderObjectType");
  expect(mesh!.notes[1]!.basis).toContain("rendChunk.renderMask 1 time(s)");
  // The rolling window records them beside the read (in diagnostic mode it records every read).
  const events: { event: string; data?: Readonly<Record<string, unknown>> }[] = [];
  installation.graph.trace = { deep: false, event: (_area, event, data) => { events.push({ event, data }); } };
  await installation.graph.load(refFromPath("base\\fixture\\m.mesh"), "mesh");
  expect(events).toEqual([]);
  const fresh = new ResourceGraph(installation.depot, installation.xl, installation.fetcher);
  fresh.trace = { deep: false, event: (_area, event, data) => { events.push({ event, data }); } };
  await fresh.mesh(refFromPath("base\\fixture\\m.mesh"));
  expect(events.map(item => item.event)).toEqual(["reader_notes"]);
  expect(diagnostics.log.tail()).toEqual([]);
});

test("forgetDefaulted removes only watched properties at the reader's paths, and counts what it could not place", () => {
  expect(jsonPathSteps(".Data.RootChunk.list[12].renderMask")).toEqual(["Data", "RootChunk", "list", 12, "renderMask"]);
  expect(jsonPathSteps("Data")).toBeNull();
  expect(jsonPathSteps(".a..b")).toBeNull();
  const document = { Data: { RootChunk: { list: [{ renderMask: "0" }, { renderMask: "0" }], other: { renderMask: "0" } } } };
  const unresolved = forgetDefaulted(document, [
    { property: "rendChunk.renderMask", count: 4, paths: [".Data.RootChunk.list[1].renderMask", ".Data.RootChunk.missing[0].renderMask", ".Data.RootChunk.list[1].renderMask"] },
    { property: "somethingElse.value", count: 1, paths: [".Data.RootChunk.other.renderMask"] }]);
  expect(document as unknown).toEqual({ Data: { RootChunk: { list: [{ renderMask: "0" }, {}], other: { renderMask: "0" } } } });
  // One path past the reader's list (count 4, 3 paths), one that leads nowhere, and the repeated path (already removed).
  expect(unresolved).toBe(3);
});

test("every native failure kind falls back to WolvenKit per resource; only kinds that may not repeat keep a failed read retryable", async () => {
  const archive = { id: "x.archive", name: "x.archive" } as MountedArchive, ref = refFromPath("base\\x.mi");
  for (const kind of NATIVE_FAILURE_KINDS) {
    const decoder: NativeDecoder = { identity: "t", close() {}, decode: async () => ({ ok: false, kind, message: `${kind} happened` }) as NativeDecodeOutcome };
    // WolvenKit also fails, lastingly (its marker says it can't read the resource).
    const lasting: ResourceFetchPort = { fetch: async () => null, transient: () => false };
    const port = new NativeFirstFetcher(decoder, lasting);
    expect(await port.fetch(archive, ref, "mi")).toBeNull();
    expect(port.stats.byKind[kind]).toBe(1);
    expect(port.transient(archive, ref)).toBe(TRANSIENT_NATIVE_FAILURES.has(kind));
    const answering: ResourceFetchPort = { fetch: async () => ({ document: { from: "wolvenkit" }, extractedSha256: "x", fresh: true }) };
    expect((await new NativeFirstFetcher(decoder, answering).fetch(archive, ref, "mi"))!.document).toEqual({ from: "wolvenkit" });
  }
  expect([...TRANSIENT_NATIVE_FAILURES].sort()).toEqual(["io", "unavailable"]);
});

test("each fallback is logged by kind (bounded), a reader bug as a failure; expected kinds are only counted", async () => {
  const setup = gameFolder(), diagnostics = hostDiagnosticsAt(join(setup.root, "data"));
  const answers = new Map<string, NativeFailureKind>([["base\\fixture\\a.hp", "internal"], ["base\\fixture\\m.mesh", "over-budget"], ["base\\fixture\\r.rig", "not-indexed"]]);
  const decoder: NativeDecoder = { identity: "stub", close() {}, decode: async request => {
    const kind = [...answers].find(([path]) => refFromPath(path).hash === request.hash)?.[1] ?? "unavailable";
    return { ok: false, kind, message: `${kind} here`, ...(kind === "internal" ? { stack: "TypeError: x\n    at f" } : {}) };
  } };
  await withDiagnostics(diagnostics, async () => {
    const installation = openInstallation({ ...setup.options, native: { decoder } });
    fakeWolvenKit(installation.fetcher);
    for (const path of [...answers.keys(), "base\\fixture\\broken.mi"]) await installation.graph.load(refFromPath(path), null);
    const logged = diagnostics.log.tail().filter(entry => entry.area === "resolver");
    expect(logged.map(entry => [entry.code, entry.level])).toEqual([["native_internal", "warn"], ["native_fallback", "warn"], ["native_fallback", "warn"]]);
    expect(logged.map(entry => entry.details?.codes?.[0])).toEqual([undefined, "over-budget", "unavailable"]);
    expect(installation.fetcher.nativeStats!.byKind).toMatchObject({ internal: 1, "over-budget": 1, "not-indexed": 1, unavailable: 1 });
  });
});

test("the registry opens one native decoder per game folder, shares it across routes and cache folders, and says why when it can't", async () => {
  const setup = gameFolder(), diagnostics = hostDiagnosticsAt(join(setup.root, "data"));
  let opened = 0, closed = 0, stamp = "dll|1";
  const registry = new InstallationRegistry({ nativeStamp: () => stamp, openNative: async () => {
    opened++;
    const decoder = inProcessDecoder(readerOver(`n${opened}`));
    return { decoder: { identity: decoder.identity, decode: request => decoder.decode(request), close: () => { closed++; decoder.close(); } } };
  } });
  await withDiagnostics(diagnostics, async () => {
    const one = await registry.acquire(setup.options);
    const two = await registry.acquire({ ...setup.options, cacheDir: join(setup.root, "cache-2") });
    expect(opened).toBe(1);
    expect(one.fetcher.native!.identity).toBe(nativeReaderIdentity("n1"));
    expect(two.fetcher.native!.identity).toBe(nativeReaderIdentity("n1"));
    expect(one.fetcher).not.toBe(two.fetcher);
    expect((await one.graph.load(refFromPath("base\\fixture\\a.hp"), "hp"))!.root.$type).toBe("CHairProfile");
    // A game update replaces the Oodle library: the next open gets a new decoder and the old one is closed.
    stamp = "dll|2";
    put(join(setup.game, "bin", "x64", "Cyberpunk2077.exe"), "game, updated");
    const three = await registry.acquire(setup.options);
    await Bun.sleep(0);
    expect(opened).toBe(2);
    expect(closed).toBe(1);
    expect(three.fetcher.native!.identity).toBe(nativeReaderIdentity("n2"));
    registry.clear();
    await Bun.sleep(0);
    expect(closed).toBe(2);
    expect(diagnostics.log.tail().filter(entry => entry.code === "native_reader_on").length).toBe(2);
  });

  const failing = new InstallationRegistry({ openNative: async () => ({ decoder: null, reason: "The game folder has no Oodle library (bin/x64/oo2ext_7_win64.dll)." }) });
  await withDiagnostics(diagnostics, async () => {
    const installation = await failing.acquire(setup.options);
    expect(installation.fetcher.native).toBeNull();
    expect(installation.summary.nativeReader).toEqual({ state: "off", reason: "The game folder has no Oodle library (bin/x64/oo2ext_7_win64.dll)." });
    const off = diagnostics.log.tail().filter(entry => entry.code === "native_reader_off");
    expect(off.length).toBe(1);
    expect(off[0]!.message).toBe("XF Studio can't read your game files itself here, so WolvenKit reads them (slower the first time). The game folder has no Oodle library (bin/x64/oo2ext_7_win64.dll).");
    expect(off[0]!.level).toBe("warn");
  });
  // A registry told not to use the reader never opens one.
  const never = new InstallationRegistry({ openNative: false });
  expect((await never.acquire(setup.options)).summary.nativeReader).toMatchObject({ state: "off" });
  // The real opener refuses a folder without the library, with the reason, and never throws.
  const real = new InstallationRegistry();
  const summary = (await real.acquire(setup.options)).summary.nativeReader!;
  expect(summary.state).toBe("off");
  real.clear();
});

test("the plan carries a part's reader notes to the record: a value stored with an older type, a render mask left out", async () => {
  const fixture = detailFixture();
  const { graph } = fixture.installation();
  const hairApp = refFromPath(P.hairApp).hash, shadowMesh = refFromPath(P.shadowMesh).hash;
  const port: ResourceFetchPort = { fetch: async (archive, ref, extension) => {
    const answer = await graph.port.fetch(archive, ref, extension);
    if (!answer) return answer;
    if (ref.hash === hairApp) return { ...answer, notes: [{ kind: "type-mismatch", property: "entSkinnedMeshComponent.castShadows", stored: "Bool", rtti: "shadowsShadowCastingMode", count: 2 }] };
    if (ref.hash === shadowMesh) {
      const document = structuredClone(answer.document) as { Data: { RootChunk: { renderResourceBlob: { Data: { header: { renderChunkInfos: unknown[] } } } } } };
      const paths = document.Data.RootChunk.renderResourceBlob.Data.header.renderChunkInfos.map((_, i) => `.Data.RootChunk.renderResourceBlob.Data.header.renderChunkInfos[${i}].renderMask`);
      return { ...answer, document, defaulted: [{ property: "rendChunk.renderMask", paths, count: paths.length }] };
    }
    return answer;
  } };
  const native = new ResourceGraph(graph.depot, graph.xl, port);
  const cco = await loadMergedCco(native, "female");
  const resolved = await resolveCharacter(native, inputFromCharacterRequest(REQUEST_A as never), cco);
  const plan = planCharacterDetails(resolved, cco.merged.cco);
  const hair = plan.components.find(component => component.component === "hair")!;
  expect(hair.readerNotes).toEqual(["entSkinnedMeshComponent.castShadows is stored as Bool where the game's current type is shadowsShadowCastingMode (2 times); it was read as stored. How the game treats such a value is unread."]);
  // The shadow proxy's masks were left out of the file: its chunks draw (with WolvenKit's "0" they were shadow-only).
  const proxy = resolved.appearances.flatMap(entry => entry.components).find(component => component.name === "hair_shadow")!;
  expect(proxy.geometry!.chunkInScene).toEqual([true, true]);
  // Only the parts read from those two files carry reader notes: the hair appearance's parts (its .app), and the skin's seam fix, which
  // draws the same shadow mesh. Parts read alike by WolvenKit and the native reader carry none.
  const noted = plan.components.filter(component => component.readerNotes);
  expect(noted.map(component => component.component).sort()).toEqual(["hair", "hair_shadow", "seam_fix"]);
  expect(noted.find(component => component.component === "seam_fix")!.readerNotes).toEqual([expect.stringContaining("rendChunk.renderMask 2 time(s)")]);
});
