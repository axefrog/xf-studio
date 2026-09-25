import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CharacterDetailHost, characterRequestKey, installationFingerprint, type CharacterDetailSettings } from "../src/character-detail-host";
import { CharacterDetailError, gradientStops, hairProfileStops, pngSize, prepareCharacterDetails, skinProfileValues, templateIdentity, textureIsGamma } from "../src/character-detail-service";
import { depotHash } from "../src/depot-path";
import { encodePng } from "../src/png";
import { archiveExportSource, BY_HASH_CONCURRENCY, createGameAssetExporter, GameAssetExportCache, GameAssetExportError, type ExportedGeometry,
  type ExportedMask, type ExportedTexture, type GameAssetExporter } from "../src/game-asset-export";
import { parseCharacterDetail } from "../src/render-detail";
import { detailFixture, eyeRequest, FACE, P, REQUEST_A, REQUEST_B, TONES } from "./character-detail-fixtures";

const root = mkdtempSync(join(tmpdir(), "xfs-character-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const png = encodePng({ width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]) }, { alpha: true });

/** An exporter over temp files: a tiny GLB-shaped file per geometry and a 2×1 PNG per texture. */
function fakeExporter(options: { failArchive?: string; calls?: string[]; missing?: readonly string[] } = {}): GameAssetExporter {
  let n = 0;
  return { open(source) {
    const dir = join(root, `export-${n++}`);
    mkdirSync(dir, { recursive: true });
    return { tool: { key: "fake", label: "Fake exporter" }, present: () => null, close() {},
      async geometry(paths) {
        options.calls?.push(`geometry ${source.archivePath}`);
        if (options.failArchive && source.archivePath.includes(options.failArchive)) throw new GameAssetExportError("tool_failed", "fake failure");
        return new Map(paths.map((path): [string, ExportedGeometry] => {
          const file = join(dir, `${depotHash(path)}.glb`);
          writeFileSync(file, `glTF ${path}`);
          return [path, { depotPath: path, hash: depotHash(path), raw: file, rawSha256: "", glb: file, glbSha256: "", materials: null, materialsSha256: null, complete: true, cached: false }];
        }));
      },
      async textures(paths) {
        options.calls?.push(`textures ${source.archivePath}`);
        return new Map(paths.filter(path => !options.missing?.includes(path)).map((path): [string, ExportedTexture] => {
          const file = join(dir, `${depotHash(path)}.png`);
          writeFileSync(file, png);
          return [path, { depotPath: path, hash: depotHash(path), png: file, pngSha256: "", cached: false }];
        }));
      },
      // Masks: three layers per `.mlmask`, each a different image (so each layer's file is its own).
      async masks(paths) {
        options.calls?.push(`masks ${source.archivePath}`);
        return new Map(paths.filter(path => !options.missing?.includes(path)).map((path): [string, ExportedMask] => {
          const layers = [0, 1, 2].map(index => {
            const file = join(dir, `${depotHash(path)}_${index}.png`);
            writeFileSync(file, encodePng({ width: 4, height: 4, data: new Uint8Array(64).fill(index * 100) }, { alpha: true }));
            return file;
          });
          return [path, { depotPath: path, hash: depotHash(path), layers, cached: false }];
        }));
      } };
  } };
}

const route = { gameRoot: join(root, "game"), launchRoute: "mo2" as const, wolvenKitCli: "wk.exe" };
const prepare = (request = REQUEST_A, exporter = fakeExporter(), fixture = detailFixture()) => prepareCharacterDetails({ request, route,
  storeRoot: join(root, "store"), resolverCache: join(root, "resolver"), exporter, open: () => fixture.installation() });

describe("character record from the resolver", () => {
  test("record is versioned, strict, content-addressed and names only the resources that draw", async () => {
    const calls: string[] = [];
    const { record, recordFile } = await prepare(REQUEST_A, fakeExporter({ calls }));
    expect(record.schema).toBe("xfs/render-detail-6");
    expect(recordFile).toBe(`${record.identity}.json`);
    expect(parseCharacterDetail(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(record.components.map(c => c.slot)).toEqual(["skin", "face", "face", "brows", "lashes", "hair", "eyes", "piercings"]);
    const hair = record.components.find(c => c.slot === "hair")!;
    expect(hair.chunks).toEqual([0, 1]);
    expect(hair.geometry.depotPath).toBe(P.hairMesh);
    expect(hair.geometry.file).toMatch(/^[a-f0-9]{64}\.glb$/);
    const strand = hair.materials[0]!;
    // Raw channels and the resource's own colour flag; the adapters interpret them.
    expect(strand.textures.Strand_ID).toMatchObject({ depotPath: P.strandId, width: 2, height: 1, isGamma: false });
    expect(record.components.find(c => c.slot === "brows")!.materials[0]!.textures.DiffuseTexture!.isGamma).toBe(true);
    // The mod archive's profile wins over the base game's (R1), with its archive recorded.
    expect(strand.profiles.HairProfile).toMatchObject({ depotPath: P.hp, archive: "fixture_mod.archive", sampleCount: 127 });
    expect(strand.profiles.HairProfile!.rootToTip[1]!.color).toEqual([200, 60, 40]);
    expect(record.provenance.tool).toBe("Fake exporter");
    // One export call per winning archive and kind.
    expect(calls.filter(call => call.startsWith("geometry")).length).toBe(1);
    // Same inputs, same identity: records are content-addressed.
    expect((await prepare()).record.identity).toBe(record.identity);
  });

  test("an export failure empties only the affected slot, with one plain line", async () => {
    const { record } = await prepare(REQUEST_A, fakeExporter({ failArchive: "basegame_fixture" }));
    expect(record.components).toEqual([]);
    expect(record.slots.map(s => s.state)).toEqual(Array(7).fill("unavailable"));
    expect(record.slots[0]!.message).toBe("WolvenKit couldn't read your V's skin from your game files, so it isn't shown.");
    expect(record.slots[1]!.message).toBe("WolvenKit couldn't read your V's face details from your game files, so they aren't shown.");
    expect(record.slots[4]!.message).toBe("WolvenKit couldn't read your V's hair from your game files, so it isn't shown.");
    const b = await prepare(REQUEST_B);
    expect(b.record.slots.find(s => s.slot === "hair")).toEqual({ slot: "hair", state: "none", label: "None" });
  });

  test("the head skin: the resolved chain's inputs, the winning skin profile's values, and the tone per V", async () => {
    const a = (await prepare(REQUEST_A)).record, b = (await prepare(REQUEST_B)).record;
    const skinOf = (record: typeof a) => record.components.find(c => c.slot === "skin")!;
    const skinA = skinOf(a);
    // The head's geometry is the winning morph target, exported with its facial shapes like every morph component.
    expect(skinA.geometry).toMatchObject({ depotPath: P.headMorph, morphTargets: true });
    expect(skinA.definition).toBe(TONES.pale);
    const chunk = skinA.materials[0]!;
    expect(chunk.template).toBe(P.skinMt);
    expect(Object.keys(chunk.textures).sort()).toEqual(["Albedo", "DetailNormal", "EmissiveMask", "MicroDetail", "Normal", "Roughness",
      "SecondaryAlbedo", "TintColorMask"]);
    expect(chunk.textures.Albedo).toMatchObject({ depotPath: P.skinD1, isGamma: true });
    expect(chunk.textures.Normal).toMatchObject({ depotPath: P.skinN, isGamma: false });
    // The template-default profile from the archive that wins its path (a complexion mod here), with its values.
    expect(chunk.skinProfiles.SkinProfile).toEqual({ depotPath: P.defaultSp, archive: "fixture_mod.archive", sha256: null,
      roughness0: 1, roughness1: 1.6, lobeMix: 0.6, blurSize: 2.5, diffuse: [255, 255, 255], falloff: [255, 155, 119] });
    // Another V: another type's albedo (replaced by the mod) and another tone.
    const chunkB = skinOf(b).materials[0]!;
    expect(chunkB.colours.TintColor).toEqual([202, 177, 153, 255]);
    expect(chunkB.textures.Albedo!.sources[0]).toMatchObject({ depotPath: P.skinD3, archive: "fixture_mod.archive" });
    expect(a.slots[0]).toEqual({ slot: "skin", state: "shown", label: "pale, skin type 1" });
    expect(b.slots[0]).toEqual({ slot: "skin", state: "shown", label: "senna, skin type 3" });
    // A texture framework's patch adds its overlay, read from the framework's archive.
    const patched = skinOf((await prepare(REQUEST_B, fakeExporter(), detailFixture({ skinPatch: true }))).record).materials[0]!;
    expect(patched.textures.SecondaryAlbedo!.sources[0]).toMatchObject({ depotPath: P.overlay, archive: "fixture_framework.archive" });
    expect(patched.scalars.SecondaryAlbedoInfluence).toBe(1);
  });

  test("the eyes: eyeball and shell with their inputs, the gradient's sorted stops and the morph texture rule", async () => {
    const { record } = await prepare(eyeRequest("gradient_blue"));
    const eyes = record.components.find(c => c.slot === "eyes")!;
    expect(eyes.chunks).toEqual([1, 2]);
    expect(eyes.geometry).toMatchObject({ depotPath: P.eyeMorph, morphTargets: true });
    const [eyeball, shell] = eyes.materials;
    expect(eyeball!.template).toBe(P.eyeGradMt);
    // The stops as the renderer bakes them: sorted, RGBA bytes, from the winning archive.
    expect(eyeball!.gradients.IrisColorGradient).toEqual({ depotPath: P.blueGradient, archive: "basegame_fixture.archive", sha256: null, stops: [
      { value: 0, color: [22, 22, 22, 255] }, { value: 0.785713971, color: [130, 192, 229, 255] }, { value: 1, color: [255, 255, 255, 255] }] });
    // The mask keeps its own colour flag; the adapter decides how to read it.
    expect(eyeball!.textures.IrisMask).toMatchObject({ depotPath: P.irisMask, isGamma: true });
    expect(eyeball!.textures.Albedo).toMatchObject({ depotPath: P.eyeD, isGamma: true });
    // The vanilla morph's flat normal replaces the eye's own, and the record says why.
    expect(eyeball!.textures.Normal!.depotPath).toBe(P.editorNormal);
    expect(eyes.morphTexture).toEqual({ morph: P.eyeMorph, texture: P.editorNormal, parameter: "Normal" });
    expect(shell!.template).toBe(P.eyeShadowMt);
    expect(Object.keys(shell!.textures)).toEqual(["Mask"]);
    expect(record.slots.find(s => s.slot === "eyes")).toEqual({ slot: "eyes", state: "shown", label: "gradient blue" });
    expect(parseCharacterDetail(JSON.parse(JSON.stringify(record)))).toEqual(record);
    // A pack's colour: its own textures from its archive, and the fix copy's cleared rule leaves the material's normal.
    const pack = (await prepare(eyeRequest("pack_eye_01"))).record.components.find(c => c.slot === "eyes")!;
    expect(pack.morphTexture).toEqual({ morph: P.fixMorph, texture: null, parameter: null });
    expect(pack.materials[0]!.textures.Albedo!.sources[0]).toMatchObject({ depotPath: P.packD, archive: "fixture_pack.archive" });
    expect(pack.materials[0]!.textures.Normal!.depotPath).toBe(P.packN);
    // A layered design is recorded beside its shell; the renderer says it isn't drawn.
    const layered = (await prepare(eyeRequest("layered_design"))).record.components.find(c => c.slot === "eyes")!;
    expect(layered.materials.map(m => m.template)).toEqual([P.layeredMt, P.eyeShadowMt]);
  });

  test("an unreadable input the adapter can draw without leaves the chunk drawn, with a note; a required one drops it (PREV-54)", async () => {
    // The eye's `Normal` is recorded for the two-normal light (ranks 4–5), which no adapter samples yet.
    const withoutNormal = (await prepare(eyeRequest("gradient_blue"), fakeExporter({ missing: [P.editorNormal] }))).record;
    const eyes = withoutNormal.components.find(c => c.slot === "eyes")!;
    expect(eyes.chunks).toEqual([1, 2]);
    expect(eyes.materials[0]!.textures.Normal).toBeUndefined();
    expect(eyes.materials[0]!.textures.Albedo).toBeDefined();
    expect(withoutNormal.provenance.notes.some(note => note.includes("Normal (not exported) could not be read; drawn without it."))).toBe(true);
    expect(withoutNormal.slots.find(s => s.slot === "eyes")!.state).toBe("shown");
    // The eyeball can't be drawn without its colour: that chunk is left out and the shell stays.
    const withoutAlbedo = (await prepare(eyeRequest("gradient_blue"), fakeExporter({ missing: [P.eyeD] }))).record;
    expect(withoutAlbedo.components.find(c => c.slot === "eyes")!.chunks).toEqual([2]);
    expect(withoutAlbedo.provenance.notes.some(note => note.includes("Albedo (not exported) could not be read; the chunk is not drawn."))).toBe(true);
  });

  test("small readers: PNG size, texture colour flag and hair profiles", () => {
    expect(pngSize(png)).toEqual({ width: 2, height: 1 });
    expect(pngSize(new Uint8Array(8))).toBeNull();
    expect(textureIsGamma({ setup: { isGamma: 1 } })).toBe(true);
    expect(textureIsGamma({ setup: { isGamma: 0 } })).toBe(false);
    expect(textureIsGamma({})).toBeNull();
    expect(hairProfileStops({ $type: "CHairProfile", sampleCount: 127, gradientEntriesID: [{ value: 0.5, color: { Red: 1, Green: 2, Blue: 3 } }],
      gradientEntriesRootToTip: [{ value: 2, color: { Red: 300, Green: 0, Blue: 0 } }] })).toEqual(
      { sampleCount: 127, id: [{ value: 0.5, color: [1, 2, 3] }], rootToTip: [{ value: 1, color: [255, 0, 0] }] });
    expect(hairProfileStops({ $type: "CHairProfile", sampleCount: 1, gradientEntriesID: [], gradientEntriesRootToTip: [] })).toBeNull();
    expect(skinProfileValues({ $type: "CSkinProfile", roughness0: 0.966365993, roughness1: 1.59684002, lobeMix: 1, blurSize: 1.39999998,
      diffuse: { Red: 255, Green: 255, Blue: 255 }, falloff: { Red: 255, Green: 178, Blue: 165 } })).toEqual({ roughness0: 0.966365993,
      roughness1: 1.59684002, lobeMix: 1, blurSize: 1.39999998, diffuse: [255, 255, 255], falloff: [255, 178, 165] });
    expect(skinProfileValues({ $type: "CHairProfile" })).toBeNull();
    // Gradients: sorted by value, omitted fields read as their type defaults (alpha 255).
    expect(gradientStops({ $type: "CGradient", gradientEntries: [{ value: 1, color: { Red: 255, Green: 255, Blue: 255 } },
      { color: { Red: 22, Green: 22, Blue: 22, Alpha: 255 } }] })).toEqual([{ value: 0, color: [22, 22, 22, 255] }, { value: 1, color: [255, 255, 255, 255] }]);
    expect(gradientStops({ $type: "CGradient", gradientEntries: [] })).toBeNull();
    expect(gradientStops({ $type: "CHairProfile" })).toBeNull();
  });
});

describe("exporter cache keys", () => {
  test("entries are keyed by depot hash and the winning archive's fingerprint", () => {
    const archive = join(root, "one.archive"), other = join(root, "two.archive");
    writeFileSync(archive, "a"); writeFileSync(other, "a");
    const source = archiveExportSource(archive, route.gameRoot);
    expect(archiveExportSource(archive, route.gameRoot).fingerprint).toBe(source.fingerprint);
    expect(archiveExportSource(other, route.gameRoot).fingerprint).not.toBe(source.fingerprint);
    const cache = new GameAssetExportCache(join(root, "cache"), { key: "tool-1", label: "Tool" });
    const entry = cache.entryDirectory(P.hairMesh, source);
    expect(entry).toContain(depotHash(P.hairMesh));
    expect(cache.entryDirectory(P.browMesh, source)).not.toBe(entry);
    expect(cache.entryDirectory(P.hairMesh, archiveExportSource(other, route.gameRoot))).not.toBe(entry);
    expect(new GameAssetExportCache(join(root, "cache"), { key: "tool-2", label: "Tool" }).entryDirectory(P.hairMesh, source)).not.toBe(entry);
    // A replaced archive (new size or time) is a new container: its exports are never reused.
    writeFileSync(archive, "changed"); utimesSync(archive, new Date(), new Date(Date.now() + 5000));
    expect(archiveExportSource(archive, route.gameRoot).fingerprint).not.toBe(source.fingerprint);
  });

  test("a cached export is reused for the same resource and archive, and re-run for another archive", async () => {
    const runs: string[] = [];
    const exporter = createGameAssetExporter(join(root, "reuse"), async ({ source, depotPaths, outDir }) => {
      runs.push(source.archivePath);
      for (const path of depotPaths) {
        const target = join(outDir, ...path.split("\\"));
        mkdirSync(join(target, ".."), { recursive: true });
        writeFileSync(target.replace(/\.xbm$/, ".png"), png);
      }
    });
    const a = archiveExportSource(join(root, "one.archive"), route.gameRoot), b = archiveExportSource(join(root, "two.archive"), route.gameRoot);
    const first = await exporter.open(a).textures([P.capMask]);
    expect(first.get(P.capMask)!.cached).toBe(false);
    expect((await exporter.open(a).textures([P.capMask])).get(P.capMask)!.cached).toBe(true);
    expect((await exporter.open(b).textures([P.capMask])).get(P.capMask)!.cached).toBe(false);
    expect(runs.length).toBe(2);
  });

  test("a texture an archive lists only by hash (no path names) is exported by its hash, when its index has it", async () => {
    const runs: string[] = [];
    const exporter = createGameAssetExporter(join(root, "by-hash"), async ({ depotPaths, outDir, byHash }) => {
      runs.push(`${byHash ? "hash" : "path"} ${depotPaths.join(",")}`);
      // Like WolvenKit on a nameless archive: a path pattern finds nothing; a hash writes `<hash>.png`.
      if (byHash) { mkdirSync(outDir, { recursive: true }); writeFileSync(join(outDir, `${depotHash(depotPaths[0]!)}.png`), png); }
    }, { contains: (_source, hashes) => new Set(hashes.filter(hash => hash !== depotHash(P.strandId))) });
    const source = archiveExportSource(join(root, "nameless.archive"), route.gameRoot);
    const got = await exporter.open(source).textures([P.packD, P.strandId]);
    expect([...got.keys()]).toEqual([P.packD]);
    expect(runs).toEqual([`path ${P.packD},${P.strandId}`, `hash ${P.packD}`]);
    // Cached like any other export.
    expect((await exporter.open(source).textures([P.packD])).get(P.packD)!.cached).toBe(true);
  });

  test("by-hash launches run a few at a time, and not at all when the archive index can't be read (PREV-55)", async () => {
    // A fake WolvenKit: a path pattern finds nothing in a nameless archive; each `--hash` call takes a while and writes `<hash>.png`.
    const launches: string[] = [];
    let running = 0, peak = 0;
    const fakeWolvenKit = async ({ depotPaths, outDir, byHash }: { depotPaths: string[]; outDir: string; byHash?: boolean }) => {
      launches.push(byHash ? `hash ${depotPaths[0]}` : `path ${depotPaths.length}`);
      if (!byHash) return;
      running++; peak = Math.max(peak, running);
      await Bun.sleep(20);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, `${depotHash(depotPaths[0]!)}.png`), png);
      running--;
    };
    const wanted = [P.packD, P.packN, P.strandId, P.capMask, P.irisMask, P.eyeD];
    const indexed = createGameAssetExporter(join(root, "by-hash-lane"), fakeWolvenKit, { contains: (_source, hashes) => new Set(hashes) });
    const started = performance.now();
    const got = await indexed.open(archiveExportSource(join(root, "nameless-lane.archive"), route.gameRoot)).textures(wanted);
    expect([...got.keys()].sort()).toEqual([...wanted].sort());
    expect(launches.filter(launch => launch.startsWith("hash"))).toHaveLength(wanted.length);
    expect(peak).toBe(Math.min(BY_HASH_CONCURRENCY, wanted.length));
    // Six 20 ms launches at four at a time take two rounds, not six.
    expect(performance.now() - started).toBeLessThan(6 * 20);
    // An unreadable index: no by-hash launch at all, and the textures are simply absent.
    launches.length = 0;
    const unreadable = createGameAssetExporter(join(root, "by-hash-unindexed"), fakeWolvenKit, { contains: () => { throw Error("unreadable index"); } });
    const none = await unreadable.open(archiveExportSource(join(root, "nameless-unindexed.archive"), route.gameRoot)).textures(wanted);
    expect(none.size).toBe(0);
    expect(launches).toEqual([`path ${wanted.length}`]);
    // A tool failure in one launch surfaces once, after the others stopped.
    const failing = createGameAssetExporter(join(root, "by-hash-failing"), async input => {
      if (input.byHash && input.depotPaths[0] === P.strandId) throw new GameAssetExportError("tool_failed", "fake failure");
      await fakeWolvenKit(input);
    }, { contains: (_source, hashes) => new Set(hashes) });
    await expect(failing.open(archiveExportSource(join(root, "nameless-failing.archive"), route.gameRoot)).textures(wanted)).rejects.toMatchObject({ code: "tool_failed" });
    expect(running).toBe(0);
  });
});

describe("layer masks through the real exporter", () => {
  test("masks(): one PNG per mask layer from WolvenKit's layer folder, cached, and by hash for a nameless archive", async () => {
    const runs: string[] = [];
    // Like WolvenKit uncooking an .mlmask: `<name>_layers/<name>_<i>.png` beside where the mask would be, one per layer.
    const layers = (stem: string, count: number) => {
      const name = stem.split(/[\\/]/).pop()!;
      mkdirSync(`${stem}_layers`, { recursive: true });
      for (let index = 0; index < count; index++) writeFileSync(join(`${stem}_layers`, `${name}_${index}.png`), png);
    };
    const exporter = createGameAssetExporter(join(root, "masks"), async ({ depotPaths, outDir, byHash }) => {
      runs.push(`${byHash ? "hash" : "path"} ${depotPaths.join(",")}`);
      if (byHash) { layers(join(outDir, depotHash(depotPaths[0]!)), 2); return; }
      for (const path of depotPaths) if (path === P.earringMask) layers(join(outDir, ...path.replace(/\.mlmask$/i, "").split("\\")), 3);
    }, { contains: (_source, hashes) => new Set(hashes) });
    const source = archiveExportSource(join(root, "masks.archive"), route.gameRoot);
    const nameless = "base\\fixture\\nameless.mlmask";
    const got = await exporter.open(source).masks([P.earringMask, nameless]);
    expect(got.get(P.earringMask)!.layers.map(file => file.split(/[\\/]/).pop())).toEqual(["layer-0.png", "layer-1.png", "layer-2.png"]);
    expect(got.get(nameless)!.layers).toHaveLength(2);
    expect(got.get(P.earringMask)!.cached).toBe(false);
    expect(runs).toEqual([`path ${P.earringMask},${nameless}`, `hash ${nameless}`]);
    // Cached per layer, in order.
    const again = await exporter.open(source).masks([P.earringMask]);
    expect(again.get(P.earringMask)).toMatchObject({ cached: true });
    expect(again.get(P.earringMask)!.layers).toHaveLength(3);
    expect(runs).toHaveLength(2);
  });
});

describe("what the host writes is what the page reads (PIPE-40)", () => {
  test("the written record is the browser reader's own output: parsing it again changes nothing", async () => {
    const { record, recordFile } = await prepare(REQUEST_A);
    const written = JSON.parse(readFileSync(join(root, "store", "records", recordFile), "utf8"));
    expect(written).toEqual(record);
    expect(parseCharacterDetail(written)).toEqual(record);
  });
});

describe("host preparation", () => {
  test("a newer character supersedes the running one; files are served only by content-addressed name", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const settings: CharacterDetailSettings = { gameRoot: route.gameRoot, launchRoute: "mo2",
      mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: process.execPath };
    const host = new CharacterDetailHost({ cacheRoot: join(root, "host"), settings: () => settings, exporter: () => fakeExporter(),
      prepare: async options => {
        started.push(options.request.source === "save" ? options.request.appearances[0]!.option : "default");
        if (started.length === 1) { await gate; if (options.signal?.aborted) throw new (await import("../src/character-detail-service")).CharacterDetailError("character_cancelled", "cancelled"); }
        return prepareCharacterDetails({ ...options, open: () => detailFixture().installation() });
      } });
    const a = host.request(REQUEST_A);
    expect(a.phase).toBe("preparing");
    expect(a.key).toBe(characterRequestKey(REQUEST_A, installationFingerprint(settings)));
    const b = host.request(REQUEST_B);
    release();
    await host.settled();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(host.state(a.key).phase).toBe("unknown");
    const ready = host.state(b.key);
    expect(ready.phase).toBe("ready");
    expect(host.filePath(ready.record!)).not.toBeNull();
    expect(host.filePath("../secret.json")).toBeNull();
    expect(host.filePath("records/x.json")).toBeNull();
    expect(started).toEqual(["skin_type_01", "skin_type_03"]);
  });

  // PREV-26: the answer belongs to the installation it was prepared from.
  test("a changed MO2 profile, mod list or WolvenKit prepares again instead of reusing the earlier answer", async () => {
    const mo2 = join(root, "mo2-stale"), game = join(root, "game-stale");
    mkdirSync(join(mo2, "profiles", "Default"), { recursive: true });
    mkdirSync(join(mo2, "profiles", "WithNewHairMod"), { recursive: true });
    mkdirSync(join(game, "archive", "pc", "mod"), { recursive: true });
    writeFileSync(join(mo2, "profiles", "Default", "modlist.txt"), "+Base\n");
    writeFileSync(join(mo2, "profiles", "WithNewHairMod", "modlist.txt"), "+Hair\n+Base\n");
    const settings: CharacterDetailSettings = { gameRoot: game, launchRoute: "mo2", mo2Root: mo2, mo2ProfileId: "Default",
      manualModRoot: null, wolvenKitCli: process.execPath };
    const calls: string[] = [];
    const host = new CharacterDetailHost({ cacheRoot: join(root, "host-stale"), settings: () => settings, exporter: () => fakeExporter(),
      prepare: async options => { calls.push(options.route.mo2ProfileId ?? ""); return { record: {} as never, recordFile: `${"a".repeat(63)}${calls.length}.json` }; } });
    const first = host.request(REQUEST_A);
    await host.settled();
    expect(host.state(first.key).phase).toBe("ready");
    // The same V on the same installation is answered from the finished preparation.
    expect(host.request(REQUEST_A)).toMatchObject({ key: first.key, phase: "ready" });
    settings.mo2ProfileId = "WithNewHairMod";
    const second = host.request(REQUEST_A);
    expect(second.key).not.toBe(first.key);
    expect(second.phase).toBe("preparing");
    await host.settled();
    expect(host.state(second.key)).toMatchObject({ phase: "ready", record: `${"a".repeat(63)}2.json` });
    // A mod installed into the profile (its mod list changes) prepares again too.
    writeFileSync(join(mo2, "profiles", "WithNewHairMod", "modlist.txt"), "+Brows\n+Hair\n+Base\n");
    const third = host.request(REQUEST_A);
    expect(third.key).not.toBe(second.key);
    await host.settled();
    expect(calls).toEqual(["Default", "WithNewHairMod", "WithNewHairMod"]);
    // So does another launch route or WolvenKit.
    expect(installationFingerprint({ ...settings, launchRoute: "direct" })).not.toBe(installationFingerprint(settings));
    expect(installationFingerprint({ ...settings, wolvenKitCli: join(root, "other-wk.exe") })).not.toBe(installationFingerprint(settings));
  });

  // PREV-27: a quick V1 -> V2 -> V1 restarts V1 at once, and preparations never overlap on the shared cache.
  test("switching back to a cancelled V restarts it, after the cancelled run has stopped", async () => {
    const log: string[] = [];
    let running = 0, overlap = 0;
    const settings: CharacterDetailSettings = { gameRoot: route.gameRoot, launchRoute: "direct", mo2Root: null, mo2ProfileId: null,
      manualModRoot: null, wolvenKitCli: process.execPath };
    const name = (request: typeof REQUEST_A) => request === REQUEST_A ? "V1" : "V2";
    const host = new CharacterDetailHost({ cacheRoot: join(root, "host-aba"), settings: () => settings, exporter: () => fakeExporter(),
      // Like a WolvenKit export in progress: it notices the abort only a little later.
      prepare: options => new Promise((resolve, reject) => {
        const who = name(options.request as typeof REQUEST_A);
        overlap = Math.max(overlap, ++running);
        log.push(`start ${who}`);
        const done = setTimeout(() => { running--; log.push(`finish ${who}`); resolve({ record: {} as never, recordFile: `${"b".repeat(64)}.json` }); }, 120);
        options.signal?.addEventListener("abort", () => setTimeout(() => {
          clearTimeout(done); running--; log.push(`cancelled ${who}`);
          reject(new CharacterDetailError("character_cancelled", "cancelled"));
        }, 40));
      }) });
    const v1 = host.request(REQUEST_A);
    host.request(REQUEST_B);
    const again = host.request(REQUEST_A);
    expect(again).toMatchObject({ key: v1.key, phase: "preparing" });
    await host.settled();
    expect(host.state(v1.key).phase).toBe("ready");
    // V2 was cancelled before it started; V1 ran again only once its cancelled run had stopped.
    expect(log).toEqual(["start V1", "cancelled V1", "start V1", "finish V1"]);
    expect(overlap).toBe(1);
  });

  test("without a game folder or WolvenKit the host says what's needed", () => {
    const host = new CharacterDetailHost({ cacheRoot: join(root, "none"), settings: () => ({ gameRoot: null, launchRoute: "direct", mo2Root: null,
      mo2ProfileId: null, manualModRoot: null, wolvenKitCli: null }) });
    expect(host.request(REQUEST_A)).toMatchObject({ phase: "failed", message: "Your V's own skin, face details, eyes, brows, lashes, hair and piercings appear once your game folder and WolvenKit are set up." });
  });
});

describe("face details in the record", () => {
  test("each decal chunk carries its template's own name and priority, read from the template the chain ends at", async () => {
    const { record } = await prepare(REQUEST_B);
    const face = record.components.filter(c => c.slot === "face");
    expect(face.map(c => c.option)).toEqual(["skin_type_03", "makeupCheeks_01", "facial_tattoo_02", "cyberware_01", "pack_liner"]);
    // Vanilla templates without a stored name fall back to their path; the pack's copy names itself.
    expect(face.at(-1)!.materials[0]).toMatchObject({ template: P.packFrontMt, templateName: "mesh_decal", materialPriority: "EMP_Front" });
    expect(face[1]!.materials[0]).toMatchObject({ template: P.meshDecalMt, templateName: null, materialPriority: "EMP_Normal" });
    // The emissive chunk is recorded (no inputs) so the renderer can report it; the cyberware's decal draws beside it.
    expect(face[3]!.materials.map(m => [m.chunk, m.template, Object.keys(m.textures).length > 0])).toEqual([[0, P.meshDecalMt, true], [1, P.emissiveMt, false]]);
    expect(face[1]!.materials[0]!.textures.DiffuseTexture).toMatchObject({ depotPath: P.frecklesD, isGamma: true });
    expect(parseCharacterDetail(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });

  test("one face detail that can't be read leaves the others shown, with one plain line", async () => {
    const { record } = await prepare(REQUEST_B, fakeExporter({ failArchive: "fixture_pack" }));
    expect(record.components.filter(c => c.slot === "face").map(c => c.option)).toEqual(["skin_type_03", "makeupCheeks_01", "facial_tattoo_02", "cyberware_01"]);
    expect(record.slots.find(s => s.slot === "face")).toMatchObject({ state: "shown",
      message: "Some of your V's face details couldn't be read from your game files, so not all of them are shown." });
  });

  test("templateIdentity reads a template's name and priority; an absent priority is the engine's default", () => {
    expect(templateIdentity({ $type: "CMaterialTemplate", name: { $type: "CName", $storage: "string", $value: "mesh_decal" }, materialPriority: "EMP_Front" }))
      .toEqual({ name: "mesh_decal", priority: "EMP_Front" });
    expect(templateIdentity({ $type: "CMaterialTemplate" })).toEqual({ name: null, priority: "EMP_Normal" });
    expect(templateIdentity({ $type: "CMaterialInstance" })).toEqual({ name: null, priority: null });
    expect(templateIdentity(null)).toEqual({ name: null, priority: null });
  });
});

test("two face choices drawing one shared mesh are two components with their own identities", async () => {
  const both = { ...REQUEST_A, appearances: [...(REQUEST_A.source === "save" ? REQUEST_A.appearances : []),
    { group: "face", option: "makeupCheeks_01", app: depotHash(P.frecklesApp), definition: FACE.frecklesBrown }] } as typeof REQUEST_A;
  const { record } = await prepare(both);
  const shared = record.components.filter(c => c.component === "hx_freckles");
  expect(shared.map(c => c.option)).toEqual(["makeupCheeks_05", "makeupCheeks_01"]);
  expect(new Set(shared.map(c => c.id)).size).toBe(2);
  expect(shared[0]!.geometry.file).toBe(shared[1]!.geometry.file);
  expect(parseCharacterDetail(JSON.parse(JSON.stringify(record)))).toEqual(record);
});
