// The creator catalogue's on-screen texts through the route's native decoder (research/backlog/native-archive-reader.md, integration;
// PIPE-50): a `JsonResource` is read natively only for a verified payload class, WolvenKit reads anything else through the resolver
// fetcher's JSON-resource mode (a raw `.json` resource kept apart from its `.json.json` companion), a catalogue builds with no WolvenKit
// launch, and the text reads never hold up a V's resolution in the decode worker. Synthetic archives only: no game data, no WolvenKit.
import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { labelsOf, loadCreatorCatalogue, readTextResources } from "../src/cc-catalogue-host";
import { depotHash, refFromPath } from "../src/depot-path";
import { readOnscreenEntries, type TextEntry } from "../src/game-text";
import { NativeArchivePool } from "../src/native/archive-reader";
import { type DecodeWorker, jsonPayloadClass, type NativeDecodeOutcome, type NativeDecoder, type NativeDecodeRequest, type WorkerDecodeMessage,
  WorkerDecoder, type WorkerInit } from "../src/native/native-decode";
import { inProcessDecoder, NATIVE_JSON_PAYLOADS, type NativeReader, nativeReaderIdentity } from "../src/native/native-fetch-port";
import { type InstallationOptions, openInstallation, type ResolverFetcher } from "../src/resolver-host";
import { BASE_CCO, TEXTS, vanillaCreator } from "./cc-fixtures";
import { fakeDecompress, syntheticArchive } from "./fixtures/native-archive";
import { Cr2wBuilder, prop, v } from "./fixtures/native-cr2w";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = mkdtempSync(join(tmpdir(), "xfs-native-texts-")); roots.push(root); return root; };
const put = (path: string, content: string | Uint8Array) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
const closers: (() => void)[] = [];
afterEach(() => { for (const close of closers.splice(0)) close(); });

const ONSCREENS = "localizationPersistenceOnScreenEntries";
const BASE_TEXTS = "base\\localization\\en-us\\onscreens\\onscreens.json";
const MOD_TEXTS = "xl\\pretty\\localization\\en-us.json";
const OTHER_JSON = "xl\\pretty\\other.json";
const MOD_ENTRY: TextEntry = { primaryKey: "0", secondaryKey: "XL-Pretty-Ring", female: "Pretty ring", male: "" };

/** An on-screen text resource as the game stores it: a `JsonResource` whose `root` handle holds the entries (or another payload). */
function textResource(entries: readonly TextEntry[], payload = ONSCREENS): Uint8Array {
  const file = new Cr2wBuilder();
  file.export("JsonResource", [prop("root", "handle:ISerializable", v.handle(1))]);
  file.export(payload, [prop("entries", "array:localizationPersistenceOnScreenEntry", v.array(entries.map(entry => v.struct([
    prop("femaleVariant", "String", v.string(entry.female)), prop("maleVariant", "String", v.string(entry.male)),
    prop("primaryKey", "Uint64", v.u64(BigInt(entry.primaryKey))), prop("secondaryKey", "String", v.string(entry.secondaryKey))]))))]);
  return file.build();
}

function readerOver(tag = "test"): NativeReader {
  const pool = new NativeArchivePool(fakeDecompress);
  return { pool, decompress: fakeDecompress, identity: nativeReaderIdentity(tag), oodleSha256: "0".repeat(64), close: () => pool.close() };
}

/**
 * The route's decoder: the real reader over the synthetic archives, except the creator resource, whose document comes from the shared
 * creator fixture (building a CCO in CR2W is not what these tests are about). Records every request.
 */
function routeDecoder(): { decoder: NativeDecoder; requests: NativeDecodeRequest[] } {
  const real = inProcessDecoder(readerOver()), requests: NativeDecodeRequest[] = [];
  const creator = depotHash(BASE_CCO);
  const decoder: NativeDecoder = { identity: real.identity, close: () => real.close(),
    decode: async request => {
      requests.push(request);
      if (request.hash === creator) return { ok: true, document: vanillaCreator(), extractedSha256: "", root: "gameuiCharacterCustomizationInfoResource", name: null, notes: [], defaulted: [] };
      return real.decode(request);
    } };
  closers.push(() => decoder.close());
  return { decoder, requests };
}

/** A game folder (direct route): the creator resource, the game's English texts, and a mod archive with its own texts and an `.xl`. */
function gameFolder() {
  const root = temporary(), game = join(root, "game");
  put(join(game, "archive", "pc", "content", "basegame_4_gamedata.archive"), syntheticArchive([
    { path: BASE_CCO, segments: [{ bytes: new Cr2wBuilder().build() }] }], { names: true }));
  put(join(game, "archive", "pc", "content", "lang_en_text.archive"), syntheticArchive([
    { path: BASE_TEXTS, segments: [{ bytes: textResource(TEXTS), compress: true }] }], { names: true }));
  put(join(game, "archive", "pc", "mod", "pretty.archive"), syntheticArchive([
    { path: MOD_TEXTS, segments: [{ bytes: textResource([MOD_ENTRY]) }] },
    { path: OTHER_JSON, segments: [{ bytes: textResource([MOD_ENTRY], "gameAppearanceNameVisualTagsPreset") }] }], { names: true }));
  put(join(game, "archive", "pc", "mod", "pretty.archive.xl"), `localization:\n  onscreens:\n    en-us: ${MOD_TEXTS}\n`);
  put(join(game, "bin", "x64", "Cyberpunk2077.exe"), "game");
  const cli = join(root, "WolvenKit.CLI.exe");
  put(cli, "fake WolvenKit");
  const options: InstallationOptions = { gameRoot: game, launchRoute: "direct", manualModRoot: null, wolvenKitCli: cli, cacheDir: join(root, "cache") };
  return { root, game, cli, options };
}

/** Fake WolvenKit launches: `uncook -s` writes each selected `.json` resource and its `.json.json` companion, as WolvenKit does. */
function fakeWolvenKit(fetcher: ResolverFetcher, paths: readonly string[]): { launches: () => number } {
  let launches = 0;
  (fetcher.wolvenKit as unknown as { run: unknown }).run = async (args: string[]) => {
    launches++;
    if (args[0] === "uncook") {
      const out = args[args.indexOf("-o") + 1]!, pattern = new RegExp(args[args.indexOf("-r") + 1]!.replace("(?i)", ""), "i");
      for (const path of paths) if (pattern.test(path)) {
        const file = join(out, ...path.split("\\"));
        put(file, "raw");
        put(`${file}.json`, JSON.stringify({ Header: {}, Data: { RootChunk: { $type: "JsonResource", root: { HandleId: "0", Data: { $type: "wolvenkit", path,
          entries: [{ $type: "localizationPersistenceOnScreenEntry", femaleVariant: "From WolvenKit", maleVariant: "", primaryKey: "7", secondaryKey: "WK" }] } } } } }));
      }
    }
    return { exitCode: 0, stdout: "", stderr: "", output: "" };
  };
  return { launches: () => launches };
}

test("a JsonResource is read natively only for a payload class the request names; without `payloads` any payload reads (the clothing preset)", async () => {
  const setup = gameFolder();
  const decoder = inProcessDecoder(readerOver());
  closers.push(() => decoder.close());
  const archive = join(setup.game, "archive", "pc", "mod", "pretty.archive");
  const ask = (path: string, payloads?: readonly string[]) => decoder.decode({ archivePath: archive, hash: refFromPath(path).hash, needName: false,
    roots: ["JsonResource"], ...(payloads ? { payloads } : {}) });

  const texts = await ask(MOD_TEXTS, [...NATIVE_JSON_PAYLOADS]);
  expect(texts.ok).toBe(true);
  const document = (texts as Extract<NativeDecodeOutcome, { ok: true }>).document;
  expect(jsonPayloadClass(document)).toBe(ONSCREENS);
  expect(readOnscreenEntries(document)).toEqual([MOD_ENTRY]);
  expect(await ask(OTHER_JSON, [...NATIVE_JSON_PAYLOADS])).toMatchObject({ ok: false, kind: "not-verified", message: "JsonResource payload gameAppearanceNameVisualTagsPreset is not verified." });
  expect(await ask(OTHER_JSON)).toMatchObject({ ok: true, root: "JsonResource" });
  // Not asked for as a root at all: refused as before.
  expect(await decoder.decode({ archivePath: archive, hash: refFromPath(MOD_TEXTS).hash, needName: false })).toMatchObject({ ok: false, kind: "not-verified" });
});

test("the creator catalogue builds with no WolvenKit launch: its texts come from the route's decoder, at background priority, and are kept for next time", async () => {
  const setup = gameFolder();
  const { decoder, requests } = routeDecoder();
  const installation = openInstallation({ ...setup.options, native: { decoder } });
  const wk = fakeWolvenKit(installation.fetcher, []);
  const logged: string[] = [];

  const load = await loadCreatorCatalogue({ installation, gameRoot: setup.game, cacheDir: setup.options.cacheDir, language: "en-us", log: line => logged.push(line) }, "female");
  expect(wk.launches()).toBe(0);
  expect(installation.fetcher.stats.cliCalls).toBe(0);
  expect(load.evidence.texts).toEqual([
    { path: BASE_TEXTS, archive: "lang_en_text.archive", entries: TEXTS.length, kind: "game", replace: true },
    { path: MOD_TEXTS, archive: "pretty.archive", entries: 1, kind: "mod", replace: true }]);
  // The game's labels resolve through the texts the reader decoded.
  const eyes = load.catalogue.options.find(option => option.name === "eyes_color")!;
  expect(eyes.label).toMatchObject({ text: "Eye Color", source: "game" });
  // Text reads ask for the verified payload at background priority; the resolver's own reads don't.
  const textReads = requests.filter(request => request.roots?.includes("JsonResource"));
  expect(textReads.map(request => [request.payloads, request.priority])).toEqual([[[...NATIVE_JSON_PAYLOADS], "background"], [[...NATIVE_JSON_PAYLOADS], "background"]]);
  expect(requests.filter(request => !request.roots).every(request => request.priority === undefined)).toBe(true);
  expect(logged).toContain("Creator texts: 2 read by XF Studio, 0 by WolvenKit, 0 from the cache, 0 unreadable.");

  // Next time the parsed entries come from the cache: no decode, no launch.
  requests.length = 0;
  const again = await readTextResources(installation, [BASE_TEXTS, MOD_TEXTS], setup.options.cacheDir);
  expect(again.get(BASE_TEXTS)!.entries).toEqual(TEXTS);
  expect(requests).toEqual([]);
  expect(readdirSync(join(setup.options.cacheDir, "text")).length).toBe(2);
});

test("a JSON resource the reader doesn't answer is read by WolvenKit's JSON-resource mode: the raw `.json` kept apart from its companion (PIPE-50)", async () => {
  const setup = gameFolder();
  const { decoder } = routeDecoder();
  const installation = openInstallation({ ...setup.options, native: { decoder } });
  const wk = fakeWolvenKit(installation.fetcher, [OTHER_JSON]);
  const archive = installation.plan.archives.find(item => item.name === "pretty.archive")!;

  const answer = await installation.fetcher.fetchJsonResource(archive, refFromPath(OTHER_JSON));
  expect(wk.launches()).toBe(1);
  expect(answer!.reader).toBe(installation.fetcher.tool);
  expect(jsonPayloadClass(answer!.document)).toBe("wolvenkit");
  expect(installation.fetcher.nativeStats!.byKind["not-verified"]).toBe(1);
  // WolvenKit's answer is cached like any resource's; the native one is not.
  expect(readdirSync(join(setup.options.cacheDir, "json")).filter(name => name.endsWith(".json")).length).toBe(1);
  const native = await installation.fetcher.fetchJsonResource(archive, refFromPath(MOD_TEXTS));
  expect(native!.reader).toBe(`native:${decoder.identity}`);
  expect(wk.launches()).toBe(1);

  // Without the native reader, WolvenKit reads the texts in one batch, and the catalogue's entries come from its documents.
  const plain = openInstallation({ ...setup.options, cacheDir: join(setup.root, "cache-wk"), native: null });
  const plainWk = fakeWolvenKit(plain.fetcher, [BASE_TEXTS, MOD_TEXTS]);
  const read = await readTextResources(plain, [BASE_TEXTS, MOD_TEXTS], join(setup.root, "cache-wk"));
  expect(plainWk.launches()).toBe(1);
  expect([...read.values()].map(item => item.entries)).toEqual([[{ primaryKey: "7", secondaryKey: "WK", female: "From WolvenKit", male: "" }],
    [{ primaryKey: "7", secondaryKey: "WK", female: "From WolvenKit", male: "" }]]);
});

class FakeWorker implements DecodeWorker {
  readonly sent: (WorkerInit | WorkerDecodeMessage)[] = [];
  private readonly listeners = new Map<string, ((event: any) => void)[]>();
  postMessage(message: WorkerInit | WorkerDecodeMessage): void { this.sent.push(message); }
  addEventListener(type: string, listener: (event: any) => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  terminate(): void {}
  emit(data: unknown): void { for (const listener of this.listeners.get("message") ?? []) listener({ data }); }
  get lastDecode(): WorkerDecodeMessage { return this.sent.filter((message): message is WorkerDecodeMessage => message.type === "decode").at(-1)!; }
}

test("a worker decodes a background request only when no other request waits", async () => {
  const workers: FakeWorker[] = [];
  const decoder = new WorkerDecoder({ decompressor: { test: "fake" }, roots: new Set(), identity: "test",
    createWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker; } });
  closers.push(() => decoder.close());
  const request = (hash: string, background = false): NativeDecodeRequest => ({ archivePath: "a.archive", hash, needName: false, ...(background ? { priority: "background" as const } : {}) });
  const answered: string[] = [];
  const ask = (hash: string, background = false) => decoder.decode(request(hash, background)).then(() => { answered.push(hash); });
  const all = [ask("text-1", true), ask("text-2", true), ask("text-3", true)];
  workers[0]!.emit({ type: "ready" });
  // The first background request is already in the worker; a resolver read queued now goes before the rest.
  all.push(ask("mesh"));
  const reply = () => { const id = workers[0]!.lastDecode.id; workers[0]!.emit({ type: "outcome", id, outcome: { ok: false, kind: "not-indexed", message: "" } }); };
  for (let i = 0; i < 4; i++) { reply(); await Bun.sleep(1); }
  await Promise.all(all);
  expect(answered).toEqual(["text-1", "mesh", "text-2", "text-3"]);
});

// ---- Labels that couldn't be read (NATIVE-46), languages and the text cache (NATIVE-52) ----

const FR_TEXTS = "base\\localization\\fr-fr\\onscreens\\onscreens.json";
/** A game folder with French texts only, and no WolvenKit: the reviewer's case (a worker that can't start yet). */
function frenchFolder() {
  const root = temporary(), game = join(root, "game");
  put(join(game, "archive", "pc", "content", "basegame_4_gamedata.archive"), syntheticArchive([
    { path: BASE_CCO, segments: [{ bytes: new Cr2wBuilder().build() }] }], { names: true }));
  put(join(game, "archive", "pc", "content", "lang_fr_text.archive"), syntheticArchive([
    { path: FR_TEXTS, segments: [{ bytes: textResource(TEXTS) }] }], { names: true }));
  put(join(game, "bin", "x64", "Cyberpunk2077.exe"), "game");
  const options: InstallationOptions = { gameRoot: game, launchRoute: "direct", manualModRoot: null, wolvenKitCli: null, cacheDir: join(root, "cache") };
  return { root, game, options };
}
/** The creator from the fixture; every other read answered by `other` (a worker that is down, or the real reader). */
function creatorDecoder(other: (request: NativeDecodeRequest) => Promise<NativeDecodeOutcome>): NativeDecoder {
  const creator = depotHash(BASE_CCO);
  return { identity: nativeReaderIdentity("labels"), close() {}, decode: async request => request.hash === creator
    ? { ok: true, document: vanillaCreator(), extractedSha256: "", root: "gameuiCharacterCustomizationInfoResource", name: null, notes: [], defaulted: [] }
    : other(request) };
}

test("a worker that briefly can't start, with no WolvenKit: the labels are read again later, never called 'not installed' (NATIVE-46)", async () => {
  const setup = frenchFolder();
  let down = true;
  const real = inProcessDecoder(readerOver("labels"));
  closers.push(() => real.close());
  const decoder = creatorDecoder(async request => down ? { ok: false, kind: "unavailable", message: "worker did not start" } : real.decode(request));
  const installation = openInstallation({ ...setup.options, native: { decoder } });
  const load = await loadCreatorCatalogue({ installation, gameRoot: setup.game, cacheDir: setup.options.cacheDir, language: "fr-fr" }, "female");
  expect(load.labels).toEqual({ next: "retry", message: expect.stringContaining("Try again") });
  expect(load.catalogue.gaps.map(gap => gap.code)).toContain("texts-transient");
  expect(load.catalogue.gaps.map(gap => gap.code)).not.toContain("texts-language-missing");
  expect(load.evidence.language.code).toBe("fr-fr");
  // A person's V isn't marked degraded by a text read (NATIVE-50).
  expect(installation.fetcher.transientNulls).toBe(0);
  expect(installation.fetcher.jsonTransientNulls).toBe(1);

  // Once the worker starts, the same installation reads them: the game's labels, nothing to try again.
  down = false;
  const again = await loadCreatorCatalogue({ installation, gameRoot: setup.game, cacheDir: setup.options.cacheDir, language: "fr-fr" }, "female");
  expect(again.labels).toBeNull();
  expect(again.catalogue.options.find(option => option.name === "eyes_color")!.label).toMatchObject({ text: "Eye Color", source: "game" });
});

test("labels only WolvenKit could read, with the reader off for good and no WolvenKit: said plainly, with that next step (NATIVE-46)", async () => {
  const setup = frenchFolder();
  // The reader answers the creator (as the resolver's own reads do) but refuses the texts lastingly: WolvenKit would read them.
  const refusing = openInstallation({ ...setup.options, native: { decoder: creatorDecoder(async () => ({ ok: false, kind: "not-verified", message: "no" })) } });
  const load = await loadCreatorCatalogue({ installation: refusing, gameRoot: setup.game, cacheDir: setup.options.cacheDir, language: "fr-fr" }, "female");
  expect(load.labels).toEqual({ next: "wolvenkit", message: expect.stringContaining("Set up WolvenKit") });
  expect(load.catalogue.gaps.map(gap => gap.code)).toEqual(expect.arrayContaining(["texts-need-wolvenkit"]));
  expect(load.catalogue.gaps.map(gap => gap.code)).not.toContain("texts-language-missing");
  // A reader off only for a while opens again with the installation: its labels are to be read again, not WolvenKit's to read.
  const brieflyOff = { fetcher: refusing.fetcher, native: { decoder: null, reason: "busy", permanent: false } } as const;
  expect(labelsOf(brieflyOff, { transient: 0, unreadable: 1 })).toMatchObject({ next: "retry" });
  expect(labelsOf({ ...brieflyOff, native: { decoder: null, reason: "not Windows", permanent: true } }, { transient: 0, unreadable: 1 })).toMatchObject({ next: "wolvenkit" });
});

test("a language whose texts no archive holds is 'not installed' and shows English (PIPE-51)", async () => {
  const setup = gameFolder();
  const { decoder } = routeDecoder();
  const installation = openInstallation({ ...setup.options, native: { decoder } });
  const load = await loadCreatorCatalogue({ installation, gameRoot: setup.game, cacheDir: setup.options.cacheDir, language: "de-de" }, "female");
  expect(load.catalogue.gaps.find(gap => gap.code === "texts-language-missing")).toMatchObject({ subject: "de-de" });
  expect(load.evidence.language.code).toBe("en-us");
  expect(load.labels).toBeNull();
});

test("parsed texts of another reader are removed from the cache once the native reader is on (NATIVE-52)", async () => {
  const setup = gameFolder();
  const folder = join(setup.options.cacheDir, "text");
  mkdirSync(folder, { recursive: true });
  const stale = `${refFromPath(BASE_TEXTS).hash}-${"a".repeat(24)}-${"b".repeat(12)}.json`, unrelated = "notes.txt";
  writeFileSync(join(folder, stale), "{}");
  writeFileSync(join(folder, unrelated), "kept");
  const { decoder } = routeDecoder();
  const installation = openInstallation({ ...setup.options, native: { decoder } });
  await readTextResources(installation, [BASE_TEXTS], setup.options.cacheDir);
  for (let i = 0; i < 50 && readdirSync(folder).includes(stale); i++) await Bun.sleep(5);
  const left = readdirSync(folder);
  expect(left).not.toContain(stale);
  expect(left).toContain(unrelated);
  // This reader's own file stays.
  expect(left.filter(name => name.endsWith(".json")).length).toBe(1);
});
