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
import { InstallationRegistry, NATIVE_RETRY_MS } from "../src/installation-registry";
import { NativeArchivePool } from "../src/native/archive-reader";
import type { NativeDecodeOutcome, NativeDecoder } from "../src/native/native-decode";
import { NATIVE_FAILURE_KINDS, type NativeFailureKind } from "../src/native/native-errors";
import { inProcessDecoder, NativeFirstFetcher, type NativeReader, nativeReaderIdentity, TRANSIENT_NATIVE_FAILURES } from "../src/native/native-fetch-port";
import { installationView, LOGGED_FALLBACKS_PER_KIND, NativeAnswerFiles, type NativeRoute, openInstallation, type InstallationOptions, ResolverFetcher,
  WolvenKitFetcher } from "../src/resolver-host";
import { ResourceGraph, type ResourceFetchPort } from "../src/resource-graph";
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

/**
 * A mesh with three chunks: one drawn, one that leaves its render mask out, one shadow-only; `objectType` stored as Bool (RTTI: an enum);
 * and `renderLODs` whose count says 1 while its record holds 4 floats (as a hair replacer pack's meshes store it).
 */
function meshBytes(): Uint8Array {
  const file = new Cr2wBuilder();
  const chunk = (...flags: string[]) => v.struct([prop("lodMask", "Uint8", v.u8(1)), ...(flags.length ? [prop("renderMask", "EMeshChunkFlags", v.bitfield(...flags))] : [])]);
  file.export("CMesh", [prop("objectType", "Bool", v.bool(true)), prop("renderResourceBlob", "handle:IRenderResourceBlob", v.handle(1))]);
  file.export("rendRenderMeshBlob", [prop("header", "rendRenderMeshBlobHeader", v.struct([prop("renderChunkInfos", "array:rendChunk",
    v.array([chunk("MCF_RenderInScene"), chunk(), chunk("MCF_RenderInShadows")])),
    prop("renderLODs", "array:Float", w => { w.u32(1); for (const lod of [0, 3, 6, 9]) w.f32(lod); })]))]);
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
    expect(logged[0]!.message).toContain("couldn't read basegame_9_fixture.archive: base\\fixture\\broken.mi itself (malformed), so WolvenKit will read it instead");
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

test("the reader's notes and left-out properties reach the resolver's models: a mesh chunk without a render mask is its class default, not drawn (NATIVE-41)", async () => {
  const setup = gameFolder(), diagnostics = hostDiagnosticsAt(join(setup.root, "data"));
  const installation = openInstallation({ ...setup.options, native: route() });
  const mesh = await installation.graph.mesh(refFromPath("base\\fixture\\m.mesh"));
  // Chunk 1 leaves its mask out: the class default, no flags, so it isn't drawn, as WolvenKit's JSON ("0") reads.
  expect(mesh!.renderChunkScene).toEqual([true, false, false]);
  expect(mesh!.notes.map(note => note.rule)).toEqual(["R11-stored-type", "R13-array-past-count", "R12-property-absent"]);
  expect(mesh!.notes[0]!.basis).toContain("CMesh.objectType is stored as Bool where the game's current type is ERenderObjectType");
  expect(mesh!.notes[1]!.basis).toBe("rendRenderMeshBlobHeader.renderLODs says it holds 1 element(s) but its record holds 4; all were read, as WolvenKit shows them. Whether the game reads past the count is unread.");
  expect(mesh!.notes[2]!.basis).toBe("The file leaves out rendChunk.renderMask 1 time(s); read as its class default, no flags, as WolvenKit shows it, so those render chunks are not drawn.");
  expect(mesh!.notes[2]!.grade).toBe("source");
  // Every element in the record is read, as WolvenKit shows them.
  const document = (await installation.fetcher.fetch(installation.plan.archives[0]!, refFromPath("base\\fixture\\m.mesh"), "mesh"))!.document as any;
  expect(document.Data.RootChunk.renderResourceBlob.Data.header.renderLODs).toEqual([0, 3, 6, 9]);
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

test("an array record's elements past its count are read only while each uses bytes; anything else is refused", async () => {
  const { readResource } = await import("../src/native/resource-document");
  const withRecord = (write: (w: import("./fixtures/native-cr2w").Bytes) => void) => {
    const file = new Cr2wBuilder(); file.export("CMesh", [prop("lodLevelInfo", "array:Float", write)]); return file.build();
  };
  expect((readResource(withRecord(w => { w.u32(0); w.f32(1); w.f32(2); }), fakeDecompress).document.Data.RootChunk as any).lodLevelInfo).toEqual([1, 2]);
  // Two bytes left over: not a whole element, refused as before.
  expect(() => readResource(withRecord(w => { w.u32(1); w.f32(1); w.u16(7); }), fakeDecompress)).toThrow(/read 12 of 14 bytes|past the end|bytes/);
  // An element that uses no bytes (an empty struct) can't make the reader loop: refused.
  const empty = new Cr2wBuilder(); empty.export("CMesh", [prop("parameters", "array:Box", w => { w.u32(0); w.u8(0); })]);
  expect(() => readResource(empty.build(), fakeDecompress)).toThrow();
});

test("a request may widen the decoder's root classes for itself (the clothing preset through the route's decoder)", async () => {
  const setup = gameFolder(), decoder = route().decoder!;
  const rig = { archivePath: setup.archive, hash: refFromPath("base\\fixture\\r.rig").hash, needName: false };
  expect(await decoder.decode(rig)).toMatchObject({ ok: false, kind: "not-verified" });
  expect(await decoder.decode({ ...rig, roots: ["animRig"] })).toMatchObject({ ok: true, root: "animRig" });
  // Only for that request.
  expect(await decoder.decode(rig)).toMatchObject({ ok: false, kind: "not-verified" });
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
    // A reader bug carries the reader's own stack (the worker's), not the host's (NATIVE-32).
    expect(logged[0]!.details?.stack).toContain("TypeError: x\n    at f");
    expect(logged[0]!.message).toContain("so WolvenKit will read it instead");
    expect(installation.fetcher.nativeStats!.byKind).toMatchObject({ internal: 1, "over-budget": 1, "not-indexed": 1, unavailable: 1 });
    // The same failure again, through a fetcher made anew (a route reopened): counted, not logged again (NATIVE-45).
    const reopened = openInstallation({ ...setup.options, native: { decoder } });
    fakeWolvenKit(reopened.fetcher);
    await reopened.graph.load(refFromPath("base\\fixture\\m.mesh"), null);
    expect(reopened.fetcher.nativeStats!.byKind["over-budget"]).toBe(1);
    expect(diagnostics.log.tail().filter(entry => entry.area === "resolver").length).toBe(3);
  });
});

test("the log's room is per kind: a worker outage's fallbacks never keep a later reader bug out of it (NATIVE-49)", async () => {
  const cacheDir = temporary(), diagnostics = hostDiagnosticsAt(join(cacheDir, "data"));
  const archive = { id: join(cacheDir, "x.archive"), name: "x.archive" } as MountedArchive;
  put(archive.id, "an archive");
  let kind: NativeFailureKind = "unavailable";
  const decoder: NativeDecoder = { identity: "t", close() {}, decode: async () => ({ ok: false, kind, message: `${kind} here`, ...(kind === "internal" ? { stack: "TypeError: late\n    at g" } : {}) }) as NativeDecodeOutcome };
  await withDiagnostics(diagnostics, async () => {
    const fetcher = new ResolverFetcher(new WolvenKitFetcher(null, cacheDir, () => true), { decoder }, cacheDir);
    for (let i = 0; i < LOGGED_FALLBACKS_PER_KIND * 3; i++) await fetcher.fetch(archive, refFromPath(`base\\outage\\${i}.mi`), "mi");
    kind = "internal";
    await fetcher.fetch(archive, refFromPath("base\\bug\\late.mi"), "mi");
    const logged = diagnostics.log.tail().filter(entry => entry.area === "resolver");
    expect(logged.filter(entry => entry.details?.codes?.[0] === "unavailable").length).toBeLessThanOrEqual(LOGGED_FALLBACKS_PER_KIND);
    expect(logged.at(-1)).toMatchObject({ code: "native_internal" });
    expect(logged.at(-1)!.details?.stack).toContain("TypeError: late");
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

test("a decoder that couldn't open for a reason that may pass is tried again after a while; a lasting reason isn't (NATIVE-26)", async () => {
  const setup = gameFolder();
  let clock = 0, opened = 0, answer: "transient" | "decoder" | "permanent" = "transient";
  const registry = new InstallationRegistry({ now: () => clock, nativeStamp: () => "dll|1", openNative: async () => {
    opened++;
    if (answer === "transient") return { decoder: null, reason: "The Oodle library's signature could not be checked (PowerShell timed out).", permanent: false };
    if (answer === "permanent") return { decoder: null, reason: "The game folder has no Oodle library.", permanent: true };
    return route(`retry-${opened}`);
  } });
  const first = await registry.acquire(setup.options);
  expect(first.fetcher.native).toBeNull();
  const generation = registry.generation(setup.options);
  answer = "decoder";
  clock += NATIVE_RETRY_MS - 1;
  expect((await registry.acquire(setup.options)).fetcher.native).toBeNull();
  expect(opened).toBe(1);
  // Due: the decoder opens, and the route is opened again with it (its answers may differ: its generation moves on).
  clock += 1;
  const second = await registry.acquire(setup.options);
  expect(opened).toBe(2);
  expect(second.fetcher.native!.identity).toBe(nativeReaderIdentity("retry-2"));
  expect(registry.generation(setup.options)).toBe(generation + 1);
  registry.clear();

  const lasting = new InstallationRegistry({ now: () => clock, nativeStamp: () => "dll|1", openNative: async () => { opened++; return { decoder: null, reason: "none", permanent: true }; } });
  opened = 0;
  await lasting.acquire(setup.options);
  clock += 10 * NATIVE_RETRY_MS;
  expect((await lasting.acquire(setup.options)).fetcher.native).toBeNull();
  expect(opened).toBe(1);
});

test("a changed game library reopens the routes with the new decoder, a closed decoder answers `unavailable`, and unused folders' decoders close (NATIVE-28, NATIVE-33)", async () => {
  const a = gameFolder(), b = gameFolder();
  let stamp = "dll|1", opened = 0;
  const decoders: NativeDecoder[] = [];
  const registry = new InstallationRegistry({ maxRoutes: 1, nativeStamp: () => stamp, openNative: async () => {
    opened++; const decoder = inProcessDecoder(readerOver(`d${opened}`)); decoders.push(decoder); return { decoder };
  } });
  const one = await registry.acquire(a.options);
  expect(one.fetcher.native!.identity).toBe(nativeReaderIdentity("d1"));
  // Only the library changes (no watched file does): the route opens again with the new decoder.
  stamp = "dll|2";
  const two = await registry.acquire(a.options);
  await Bun.sleep(0);
  expect(two.fetcher.native!.identity).toBe(nativeReaderIdentity("d2"));
  // A preparation still holding the old route reads with WolvenKit, as when the reader is down: `unavailable`, never a reader bug.
  const old = await one.fetcher.native!.decoder.decode({ archivePath: a.archive, hash: refFromPath("base\\fixture\\a.hp").hash, needName: false });
  expect(old).toMatchObject({ ok: false, kind: "unavailable" });
  fakeWolvenKit(one.fetcher);
  await one.graph.load(refFromPath("base\\fixture\\a.hp"), "hp");
  expect(one.fetcher.nativeStats!.byKind).toMatchObject({ unavailable: 1, internal: 0 });
  // Another game folder takes the only route slot: the first folder's decoder is closed.
  const other = await registry.acquire(b.options);
  await Bun.sleep(0);
  expect(other.fetcher.native!.identity).toBe(nativeReaderIdentity("d3"));
  expect(await decoders[1]!.decode({ archivePath: a.archive, hash: "1", needName: false })).toMatchObject({ ok: false, kind: "unavailable" });
  expect(await decoders[2]!.decode({ archivePath: b.archive, hash: refFromPath("base\\fixture\\a.hp").hash, needName: false })).toMatchObject({ ok: true });
  registry.clear();
});

test("a decoder off for the session doesn't keep a failed read retryable (NATIVE-29)", async () => {
  const archive = { id: "x.archive", name: "x.archive" } as MountedArchive, ref = refFromPath("base\\x.mi");
  const lastingFallback: ResourceFetchPort = { fetch: async () => null, transient: () => false };
  const off: NativeDecoder = { identity: "t", close() {}, decode: async () => ({ ok: false, kind: "unavailable", message: "off for this session", lasting: true }) };
  const down: NativeDecoder = { identity: "t", close() {}, decode: async () => ({ ok: false, kind: "unavailable", message: "starting again in a minute" }) };
  const offPort = new NativeFirstFetcher(off, lastingFallback), downPort = new NativeFirstFetcher(down, lastingFallback);
  await offPort.fetch(archive, ref, "mi"); await downPort.fetch(archive, ref, "mi");
  expect(offPort.transient(archive, ref)).toBe(false);
  expect(downPort.transient(archive, ref)).toBe(true);
});

test("a native failure that may pass, then a lasting WolvenKit refusal, counts as a transient null answer, which the preparation's check reads (NATIVE-40)", async () => {
  const cacheDir = temporary();
  const archive = { id: join(cacheDir, "x.archive"), name: "x.archive" } as MountedArchive, ref = refFromPath("base\\x.mi");
  put(archive.id, "an archive");
  // Without WolvenKit set up, its answer is null and lasting for the route; its own `stats.transient` stays 0.
  const fetcherOver = (decoder: NativeDecoder) => new ResolverFetcher(new WolvenKitFetcher(null, cacheDir, () => true), { decoder }, cacheDir);
  const down = fetcherOver({ identity: "t", close() {}, decode: async () => ({ ok: false, kind: "unavailable", message: "starting again in a minute" }) });
  const off = fetcherOver({ identity: "t", close() {}, decode: async () => ({ ok: false, kind: "unavailable", message: "off for this session", lasting: true }) });
  expect(await down.fetch(archive, ref, "mi")).toBeNull();
  expect(await off.fetch(archive, ref, "mi")).toBeNull();
  expect(down.stats.transient).toBe(0);
  expect(down.transientNulls).toBe(1);
  // A decoder off for the session answers the same next time: nothing to read again (NATIVE-29).
  expect(off.transientNulls).toBe(0);
  // A catalogue text read keeps its own count: it never marks a person's V degraded (NATIVE-50).
  expect(await down.fetchJsonResource(archive, refFromPath("base\\x.json"))).toBeNull();
  expect(down.transientNulls).toBe(1);
  expect(down.jsonTransientNulls).toBe(1);
  expect(down.transient(archive, refFromPath("base\\x.json"))).toBe(true);
});

test("an answer marker removed by Clear is written again; markers of another reader identity are pruned (NATIVE-27)", async () => {
  const setup = gameFolder();
  const installation = openInstallation({ ...setup.options, native: route("marker-1") });
  const archive = installation.plan.archives[0]!, hash = refFromPath("base\\fixture\\a.hp").hash;
  const folder = join(setup.options.cacheDir, "native");
  const ledger = new NativeAnswerFiles(setup.options.cacheDir, nativeReaderIdentity("marker-1"));
  ledger.add(archive, hash);
  await Bun.sleep(20);
  expect(readdirSync(folder).length).toBe(1);
  rmSync(folder, { recursive: true, force: true });
  expect(ledger.has(archive, hash)).toBe(false);
  ledger.add(archive, hash);
  await Bun.sleep(20);
  expect(ledger.has(archive, hash)).toBe(true);
  // Another reader identity on the same folder: the first reader's markers can never answer again, so they go.
  const next = new NativeAnswerFiles(setup.options.cacheDir, nativeReaderIdentity("marker-2"));
  await Bun.sleep(50);
  expect(readdirSync(folder)).toEqual([]);
  next.add(archive, hash);
  await Bun.sleep(20);
  expect(next.has(archive, hash)).toBe(true);
});

test("the plan carries a part's reader notes to the record: a value stored with an older type, a render mask left out", async () => {
  const fixture = detailFixture();
  const { graph } = fixture.installation();
  const hairApp = refFromPath(P.hairApp).hash, hairMesh = refFromPath(P.hairMesh).hash;
  const port: ResourceFetchPort = { fetch: async (archive, ref, extension) => {
    const answer = await graph.port.fetch(archive, ref, extension);
    if (!answer) return answer;
    if (ref.hash === hairApp) return { ...answer, notes: [{ kind: "type-mismatch", property: "entSkinnedMeshComponent.castShadows", stored: "Bool", rtti: "shadowsShadowCastingMode", count: 2 }] };
    if (ref.hash === hairMesh) {
      // The file leaves the last chunk's mask out: the reader writes its class default, "0", and reports where.
      const document = structuredClone(answer.document) as { Data: { RootChunk: { renderResourceBlob: { Data: { header: { renderChunkInfos: Record<string, unknown>[] } } } } } };
      const infos = document.Data.RootChunk.renderResourceBlob.Data.header.renderChunkInfos;
      infos[infos.length - 1]!.renderMask = "0";
      const path = `.Data.RootChunk.renderResourceBlob.Data.header.renderChunkInfos[${infos.length - 1}].renderMask`;
      return { ...answer, document, defaulted: [{ property: "rendChunk.renderMask", paths: [path], count: 1 }] };
    }
    return answer;
  } };
  const native = new ResourceGraph(graph.depot, graph.xl, port);
  const cco = await loadMergedCco(native, "female");
  const resolved = await resolveCharacter(native, inputFromCharacterRequest(REQUEST_A as never), cco);
  const plan = planCharacterDetails(resolved, cco.merged.cco);
  // The chunk whose mask the file left out is not drawn: its class default has no flags (NATIVE-41).
  const hairPart = resolved.appearances.flatMap(entry => entry.components).find(component => component.name === "hair")!;
  expect(hairPart.geometry!.chunkInScene).toEqual([true, true, false]);
  const hair = plan.components.find(component => component.component === "hair")!;
  expect(hair.readerNotes).toEqual(["entSkinnedMeshComponent.castShadows is stored as Bool where the game's current type is shadowsShadowCastingMode (2 times); it was read as stored. How the game treats such a value is unread.",
    "The file leaves out rendChunk.renderMask 1 time(s); read as its class default, no flags, as WolvenKit shows it, so those render chunks are not drawn."]);
  // Only the parts read from those two files carry reader notes. Parts read alike by WolvenKit and the native reader carry none.
  expect(plan.components.filter(component => component.readerNotes).map(component => component.component)).toEqual(["hair"]);
});
