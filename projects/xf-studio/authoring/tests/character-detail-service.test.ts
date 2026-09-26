import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import { join } from "node:path";
import { CharacterDetailHost, characterRequestKey, installationFingerprint, type CharacterDetailSettings } from "../src/character-detail-host";
import { createBrowserCharacterDetailDevice } from "../src/browser-character-detail-device";
import type { DetailLimit, SlotLimits } from "../src/detail-limits";
import type { DetailSlot } from "../src/render-detail";
import { CacheRun, CENSORED_BODY, CharacterDetailError, CharacterPreparationCache, gradientStops, hairProfileStops, halveImage, pngSize, prepareCharacterDetails, RECORD_NOTE_CAP, recordNotes,
  skinProfileValues, storeScaledTexture, templateIdentity, textureIsGamma, withCacheRun } from "../src/character-detail-service";
import { DEFAULT_CHARACTER } from "../src/character-detail-request";
import { readChoiceManifest } from "../src/choice-manifest";
import { depotHash } from "../src/depot-path";
import { decodePng, decodePngHalved, encodePng, encodePngAsync } from "../src/png";
import { archiveExportSource, BY_HASH_CONCURRENCY, createGameAssetExporter, GameAssetExportCache, GameAssetExportError, type ExportedGeometry,
  type ExportedMask, type ExportedTexture, type GameAssetExporter } from "../src/game-asset-export";
import { parseCharacterDetail, UNCOVERED_BODY } from "../src/render-detail";
import { BODY_REQUEST, detailFixture, eyeRequest, FACE, P, REQUEST_A, REQUEST_B, TONES } from "./character-detail-fixtures";

const root = mkdtempSync(join(tmpdir(), "xfs-character-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const png = encodePng({ width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]) }, { alpha: true });

/** An exporter over temp files: a tiny GLB-shaped file per geometry and a 2×1 PNG per texture. */
function fakeExporter(options: { failArchive?: string; calls?: string[]; missing?: readonly string[]; partialGeometry?: boolean; big?: readonly string[] } = {}): GameAssetExporter {
  let n = 0;
  return { open(source) {
    const dir = join(root, `export-${n++}`);
    mkdirSync(dir, { recursive: true });
    // A partial geometry export lives in the session's work folder, which WolvenKit's exporter removes on close.
    return { tool: { key: "fake", label: "Fake exporter" }, present: () => null, close() { if (options.partialGeometry) rmSync(join(dir, "geometry"), { recursive: true, force: true }); },
      async geometry(paths) {
        options.calls?.push(`geometry ${source.archivePath}`);
        if (options.failArchive && source.archivePath.includes(options.failArchive)) throw new GameAssetExportError("tool_failed", "fake failure");
        return new Map(paths.map((path): [string, ExportedGeometry] => {
          mkdirSync(join(dir, "geometry"), { recursive: true });
          const file = join(dir, "geometry", `${depotHash(path)}.glb`);
          writeFileSync(file, `glTF ${path}`);
          return [path, { depotPath: path, hash: depotHash(path), raw: file, rawSha256: "", glb: file, glbSha256: "", materials: null, materialsSha256: null, complete: !options.partialGeometry, cached: false }];
        }));
      },
      async textures(paths) {
        options.calls?.push(`textures ${source.archivePath}`);
        return new Map(paths.filter(path => !options.missing?.includes(path)).map((path): [string, ExportedTexture] => {
          const file = join(dir, `${depotHash(path)}.png`);
          // A map larger than the preview is served (a body texture mod's 8K skin), kept tiny here: 4100×2.
          writeFileSync(file, options.big?.includes(path) ? encodePng({ width: 4100, height: 2, data: new Uint8Array(4100 * 2 * 4).fill(200) }, { alpha: false }) : png);
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
    expect(record.schema).toBe("xfs/render-detail-10");
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
    // Every head slot is unavailable; V "A" as saved here lists no body part.
    expect(record.slots.map(s => s.state)).toEqual([...Array(7).fill("unavailable"), "none", "none"]);
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

  test("a partial geometry export survives its session's work folder, and a vanished export fails only its part", async () => {
    const cache = new CharacterPreparationCache();
    const run = (exporter: GameAssetExporter) => prepareCharacterDetails({ request: REQUEST_A, route, storeRoot: join(root, "store"),
      resolverCache: join(root, "resolver"), exporter, open: () => fixture.installation(), cache });
    const fixture = detailFixture();
    // WolvenKit wrote the GLB but not every companion file: never cached by the exporter, and its folder goes on close.
    const first = (await run(fakeExporter({ partialGeometry: true }))).record;
    expect(first.slots.find(s => s.slot === "hair")!.state).toBe("shown");
    // A later preparation on the same installation reuses the kept export (the hairstyle colour change that failed before).
    const second = (await run(fakeExporter({ partialGeometry: true }))).record;
    expect(second.slots.find(s => s.slot === "hair")!.state).toBe("shown");
    // An export whose file is gone leaves only that part unshown, never the whole V.
    for (const [key, value] of cache.geometry) if (key.endsWith(`|${P.hairMesh.toLowerCase()}`)) cache.geometry.set(key, { ...value, glb: join(root, "gone", "missing.glb") });
    cache.components.clear();
    const third = (await run(fakeExporter({ partialGeometry: true }))).record;
    expect(third.slots.find(s => s.slot === "skin")!.state).toBe("shown");
    expect(third.slots.find(s => s.slot === "brows")!.state).toBe("shown");
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

describe("a slot is its parts", () => {
  test("one part of a slot that can't be served leaves the others shown, with one plain line; none served makes it unavailable", async () => {
    // The hair's extra part draws in the scene here (like a CCXL hair's proxy); its mesh can't be exported, the hair itself can.
    const exporter = fakeExporter();
    const geometry = exporter.open.bind(exporter);
    exporter.open = (source, signal) => { const session = geometry(source, signal); return { ...session,
      geometry: async paths => { const out = await session.geometry(paths); out.delete(P.shadowMesh); return out; } }; };
    const events: { event: string; data?: Readonly<Record<string, unknown>> }[] = [];
    const trace = { deep: false, event: (area: string, event: string, data?: Readonly<Record<string, unknown>>) => { if (area === "character") events.push({ event, data }); } };
    const { record } = await prepareCharacterDetails({ request: REQUEST_A, route, storeRoot: join(root, "store"), resolverCache: join(root, "resolver"),
      exporter, open: () => detailFixture({ shadowsInScene: true }).installation(), trace });
    expect(record.components.filter(c => c.slot === "hair").map(c => c.component)).toEqual(["hair"]);
    // The page words the slot's code (PIPE-84): a part left out is never silent.
    expect(record.slots.find(slot => slot.slot === "hair")).toEqual({ slot: "hair", state: "shown", label: "brown",
      message: "Some of your V's hair couldn't be read from your game files, so not all of it is shown.", limits: ["part-unread"] });
    expect(parseCharacterDetail(JSON.parse(JSON.stringify(record))).slots.find(slot => slot.slot === "hair")!.limits).toEqual(["part-unread"]);
    // The drop notes (the shadow mesh is drawn by a hair part and a skin part) lead the record's notes and are in the diagnostics
    // window's `prepared` event.
    const drops = record.provenance.notes.filter(note => note.includes(" isn't shown: "));
    expect(drops.some(note => /^Part \S+ of your V's hair isn't shown: /.test(note))).toBe(true);
    expect(record.provenance.notes.slice(0, drops.length)).toEqual(drops);
    expect(events.find(item => item.event === "prepared")!.data!.dropped).toEqual(drops);
    // The page's device keeps the host's code on the slot, beside the limits the scene finds later.
    let bake: ((limits: { slot: DetailSlot; limit: DetailLimit }[]) => void) | null = null;
    const scene = { setCharacterDetails: () => ({ limits: [] }), details: { load: async () => ({ limits: [], problems: [], notes: [], dispose() {} }) },
      onBakeLimits: (listener: typeof bake) => { bake = listener; return () => {}; } } as never;
    const device = createBrowserCharacterDetailDevice(scene, async () => Response.json(record));
    const shown = await device.show(`${record.identity}.json`, new AbortController().signal);
    expect(shown.slots.find(slot => slot.slot === "hair")!.limits).toEqual(["part-unread"]);
    const updates: SlotLimits[] = [];
    device.onLimits!(update => updates.push(update));
    bake!([{ slot: "hair", limit: "layered-material" }]);
    expect(updates.at(-1)!.find(entry => entry.slot === "hair")!.limits).toEqual(["part-unread", "layered-material"]);
  });

  test("drop notes are kept ahead of informational ones under the record's note cap (PIPE-84)", () => {
    const info = Array.from({ length: 40 }, (_, i) => `part_${i}: the exported geometry is served whole.`);
    const drop = "Part hair_extra of your V's hair isn't shown: WolvenKit couldn't read x.archive.";
    const notes = recordNotes([drop], [...info, drop]);
    expect(notes).toHaveLength(RECORD_NOTE_CAP);
    expect(notes[0]).toBe(drop);
    expect(notes.filter(note => note === drop)).toHaveLength(1);
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
      prepare: async options => { calls.push(options.route.mo2ProfileId ?? ""); return { record: {} as never, recordFile: `${"a".repeat(63)}${calls.length}.json`, degraded: false }; } });
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
        const done = setTimeout(() => { running--; log.push(`finish ${who}`); resolve({ record: {} as never, recordFile: `${"b".repeat(64)}.json`, degraded: false }); }, 120);
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

  test("without WolvenKit the host stops at once as a need, resolving nothing and reporting no failure (NATIVE-47, NATIVE-48)", async () => {
    const { hostDiagnosticsAt, withDiagnostics } = await import("../src/diagnostics/host-log");
    const { TOOL_MISSING } = await import("../src/character-detail-service");
    const diagnostics = hostDiagnosticsAt(join(root, "diagnostics-need"));
    const settings: CharacterDetailSettings = { gameRoot: route.gameRoot, launchRoute: "direct", mo2Root: null, mo2ProfileId: null,
      manualModRoot: null, wolvenKitCli: null };
    let prepared = 0;
    const host = new CharacterDetailHost({ cacheRoot: join(root, "host-need"), settings: () => settings, exporter: () => fakeExporter(),
      prepare: async () => { prepared++; throw new CharacterDetailError("character_tool_missing", TOOL_MISSING, "WolvenKit CLI isn't available."); } });
    await withDiagnostics(diagnostics, async () => {
      const state = host.request(REQUEST_A);
      expect(state).toMatchObject({ phase: "failed", message: TOOL_MISSING, need: "wolvenkit" });
      expect(host.request(REQUEST_A)).toMatchObject({ phase: "failed", need: "wolvenkit" });
      await host.settled();
      expect(prepared).toBe(0);
      // WolvenKit set up, but it can't run (its .NET runtime): the same need, from the preparation, still not an error in the log.
      settings.wolvenKitCli = process.execPath;
      const again = host.request(REQUEST_A);
      expect(again.phase).toBe("preparing");
      await host.settled();
      expect(prepared).toBe(1);
      expect(host.state(again.key)).toMatchObject({ phase: "failed", message: TOOL_MISSING, need: "wolvenkit" });
      expect(diagnostics.log.tail().filter(entry => entry.level === "error")).toEqual([]);
    });
    // The page's reader keeps the need of a failed state only.
    const device = createBrowserCharacterDetailDevice({ setCharacterDetails: () => ({ limits: [] }), details: {} as never }, async () => new Response(JSON.stringify({
      ...host.state(characterRequestKey(REQUEST_A, installationFingerprint(settings))), recordSchema: (await import("../src/render-detail")).CHARACTER_DETAIL_SCHEMA })));
    expect(await device.poll("k", new AbortController().signal)).toMatchObject({ phase: "failed", need: "wolvenkit" });
  });

  test("without a game folder or WolvenKit the host says what's needed", () => {
    const host = new CharacterDetailHost({ cacheRoot: join(root, "none"), settings: () => ({ gameRoot: null, launchRoute: "direct", mo2Root: null,
      mo2ProfileId: null, manualModRoot: null, wolvenKitCli: null }) });
    expect(host.request(REQUEST_A)).toMatchObject({ phase: "failed", message: "Your V's own skin, face details, eyes, brows, lashes, hair, piercings and body appear once your game folder is set up." });
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
    { part: "head" as const, group: "face", option: "makeupCheeks_01", app: depotHash(P.frecklesApp), definition: FACE.frecklesBrown }] } as typeof REQUEST_A;
  const { record } = await prepare(both);
  const shared = record.components.filter(c => c.component === "hx_freckles");
  expect(shared.map(c => c.option)).toEqual(["makeupCheeks_05", "makeupCheeks_01"]);
  expect(new Set(shared.map(c => c.id)).size).toBe(2);
  expect(shared[0]!.geometry.file).toBe(shared[1]!.geometry.file);
  expect(parseCharacterDetail(JSON.parse(JSON.stringify(record)))).toEqual(record);
});

describe("the body in the character record", () => {
  test("the V's body parts with their own shapes; the head's parts are served as without the body", async () => {
    const { record } = await prepare(BODY_REQUEST);
    const body = record.components.filter(c => c.slot === "body");
    expect(body.map(c => c.component)).toEqual(["t0_body", "l0_feet_flat", "a0_arms", "a0_nails_l", "i0_cover"]);
    expect(body.map(c => c.morphs)).toEqual([["breast_big_breast"], [], [], ["nails_long_l_nails_l"], []]);
    expect(record.slots.at(-2)).toEqual({ slot: "body", state: "shown", label: "body, feet, arms, nails (beige), underwear" });
    // Head parts carry no body shapes, and are the same entries as for the V without her body.
    const head = (await prepare(REQUEST_A)).record.components;
    expect(record.components.filter(c => c.slot !== "body")).toEqual(head);
    expect(record.components.some(c => c.slot !== "body" && c.morphs)).toBe(false);
    // The cover is a decal: its own mask, and the decal family's other inputs from the template's defaults.
    const cover = body.at(-1)!.materials[0]!;
    expect(cover.textures.DiffuseTexture!.depotPath).toBe(P.coverD);
    expect(Object.keys(cover.textures).sort()).toEqual(["DiffuseTexture", "MetalnessTexture", "NormalAlphaTex", "NormalTexture", "RoughnessTexture", "SecondaryMask"]);
  });

  // ---- PIPE-97: the host fails closed when a cover can't be served ----
  test("PIPE-97: the covered skin and its cover are served with their markers; the censored twin is not", async () => {
    const { record } = await prepare(BODY_REQUEST);
    expect(record.components.filter(c => c.slot === "body").map(c => [c.option, c.censor ?? null])).toEqual([["body_color", "covered"], ["flat_feet", null],
      ["h_default_arms_colors_tpp", null], ["nails_color_tpp", null], ["underpants", "cover"]]);
  });

  test("PIPE-97: a cover the host can't serve (its texture unread) swaps the covered skin for the game's censored skin", async () => {
    const { record } = await prepare(BODY_REQUEST, fakeExporter({ missing: [P.coverD] }));
    const body = record.components.filter(c => c.slot === "body");
    expect(body.some(c => c.censor === "covered" || c.option === "body_color" || c.option === "underpants")).toBe(false);
    expect(body.map(c => c.option)).toEqual(["body_color_censored", "flat_feet", "h_default_arms_colors_tpp", "nails_color_tpp"]);
    expect(body[0]!.materials.map(m => m.name)).toEqual(["skin_censored", "skin_censored"]);
    expect(record.slots.find(s => s.slot === "body")!.message).toBe(CENSORED_BODY);
  });

  test("PIPE-97: with no censored twin to stand in, a cover the host can't serve withdraws the whole body", async () => {
    const request = { ...BODY_REQUEST, appearances: BODY_REQUEST.appearances.filter(item => item.option !== "body_color_censored") };
    const { record } = await prepare(request, fakeExporter({ missing: [P.coverD] }));
    expect(record.components.some(c => c.slot === "body")).toBe(false);
    expect(record.slots.find(s => s.slot === "body")).toMatchObject({ state: "unavailable", message: UNCOVERED_BODY });
    // The head is served as ever.
    expect(record.components.filter(c => c.slot !== "body").map(c => c.slot)).toEqual((await prepare(REQUEST_A)).record.components.map(c => c.slot));
  });

  test("PREV-107: a map larger than the preview is served from its scaled copy, made off the event loop before the record is written", async () => {
    const { record } = await prepare(BODY_REQUEST, fakeExporter({ big: [P.bodyD] }));
    const skin = record.components.find(c => c.slot === "body" && c.option === "body_color")!;
    expect(skin.materials[0]!.textures.Albedo).toMatchObject({ depotPath: P.bodyD, width: 2050, height: 1 });
    expect(record.provenance.notes.some(note => note.includes("4100×2 in the game files; the preview uses it at 2050×1"))).toBe(true);
  });

  test("PREV-108: a body turned off is neither resolved nor served, and its clothes neither", async () => {
    const { record } = await prepare({ ...BODY_REQUEST, body: false });
    expect(record.components.some(c => c.slot === "body" || c.slot === "clothing")).toBe(false);
    expect(record.slots.filter(s => s.slot === "body" || s.slot === "clothing").map(s => [s.state, s.label])).toEqual([["none", "Hidden"], ["none", "Hidden"]]);
  });

  test("a texture larger than the preview is served halved until it fits, once, by 2×2 means of its bytes", async () => {
    const dir = join(root, "scaled-store"), source = join(root, "big.png");
    // 8×4: each 2×2 block one value, so the halves are exact.
    const data = new Uint8Array(8 * 4 * 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) data.set([x * 30, y * 60, 200, 255], (y * 8 + x) * 4);
    writeFileSync(source, encodePng({ width: 8, height: 4, data }, { alpha: true }));
    expect(await storeScaledTexture(dir, source, { width: 8, height: 4 }, 8)).toBeNull();
    const scaled = (await storeScaledTexture(dir, source, { width: 8, height: 4 }, 2))!;
    expect(scaled.size).toEqual({ width: 2, height: 1 });
    const image = decodePng(readFileSync(join(dir, "files", scaled.file)));
    // Two halvings: the means of x 0–3 and 4–7 over every row (opaque, so served without alpha).
    expect([...image.data.slice(0, 3)]).toEqual([45, 90, 200]);
    expect([...image.data.slice(4, 7)]).toEqual([165, 90, 200]);
    // Made once: the same answer from the store's key.
    expect(await storeScaledTexture(dir, source, { width: 8, height: 4 }, 2)).toEqual(scaled);
    // An odd edge repeats its last texel.
    expect(halveImage({ width: 3, height: 1, data: new Uint8Array([0, 0, 0, 0, 100, 100, 100, 100, 50, 50, 50, 50]) })).toEqual({ width: 1, height: 1, data: new Uint8Array([50, 50, 50, 50]) });
  });

  test("PREV-107: the streamed halving is byte-identical to whole-image halving, for every channel layout, odd sizes and one-texel sides", async () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) % 256;
    const halveTo = (image: ReturnType<typeof decodePng>, max: number) => { while (image.width > max || image.height > max) image = halveImage(image); return image; };
    for (const [width, height, max] of [[37, 23, 8], [64, 1, 16], [1, 50, 4], [300, 211, 64], [5, 5, 5]] as const) {
      const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 && i % 3 ? 255 : random());
      for (const alpha of [true, false]) {
        const file = encodePng({ width, height, data }, { alpha });
        const whole = halveTo(decodePng(file), max);
        expect(await decodePngHalved(file, max)).toEqual(whole);
      }
    }
    // Grey (and grey with alpha) sources, whose rows expand to RGBA as they stream.
    const rawPng = (width: number, height: number, colour: number, channels: number) => {
      const chunk = (type: string, body: Uint8Array) => {
        const out = new Uint8Array(12 + body.length), view = new DataView(out.buffer);
        view.setUint32(0, body.length); out.set(new TextEncoder().encode(type), 4); out.set(body, 8);
        view.setUint32(8 + body.length, Bun.hash.crc32(out.subarray(4, 8 + body.length)));
        return out;
      };
      const header = new Uint8Array(13), view = new DataView(header.buffer);
      view.setUint32(0, width); view.setUint32(4, height); header.set([8, colour, 0, 0, 0], 8);
      // Every row Sub-filtered, so the stream's unfiltering is exercised too.
      const rows = Uint8Array.from({ length: (width * channels + 1) * height }, (_, i) => i % (width * channels + 1) === 0 ? 1 : random());
      const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", new Uint8Array(0))];
      return Uint8Array.from(parts.flatMap(part => [...part]));
    };
    for (const [colour, channels] of [[0, 1], [4, 2], [2, 3]] as const) {
      const file = rawPng(41, 19, colour, channels);
      expect(await decodePngHalved(file, 8)).toEqual(halveTo(decodePng(file), 8));
    }
    // The asynchronous encoder writes exactly what the synchronous one does.
    const image = { width: 33, height: 17, data: Uint8Array.from({ length: 33 * 17 * 4 }, () => random()) };
    for (const alpha of [true, false]) expect(await encodePngAsync(image, { alpha })).toEqual(encodePng(image, { alpha }));
    // A truncated stream is refused, not read past.
    const short = encodePng({ width: 16, height: 16, data: new Uint8Array(16 * 16 * 4).fill(9) }, { alpha: true });
    const damaged = short.slice(); damaged[short.length - 20] ^= 0xff;
    await expect(decodePngHalved(damaged, 4)).rejects.toThrow();
  });
});

// ---- Preparations and prefetch batches sharing one cache (PREV-102, PREV-103, PREV-104) ----

describe("the shared preparation cache's runs", () => {
  test("a degraded run forgets only what it added, never an entry another run added meanwhile (PREV-102)", async () => {
    const cache = new CharacterPreparationCache(), a = new CacheRun(), b = new CacheRun();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = withCacheRun(a, async () => { cache.gamma.set("a-before", true); await gate; cache.gamma.set("a-after", false); });
    // Another run adds its own entry while the first is still going, and uses one of the first run's.
    await withCacheRun(b, async () => { await Promise.resolve(); cache.gamma.set("b", true); expect(cache.gamma.has("a-before")).toBe(true); });
    release();
    await first;
    cache.forget(a);
    expect([...cache.gamma.keys()]).toEqual(["b"]);
    expect(b.used.has(a)).toBe(true);
    // An entry replaced since is not the run's any more, so it stays.
    const c = new CacheRun();
    await withCacheRun(c, async () => { cache.textures.set("t", { png: "c.png" }); });
    cache.textures.set("t", { png: "other.png" });
    cache.forget(c);
    expect(cache.textures.get("t")).toEqual({ png: "other.png" });
  });

  test("a manifest names the reads behind entries served from the shared cache, not only its own (PREV-103)", async () => {
    const dir = join(root, "manifests-103");
    const fixture = detailFixture();
    const run = (request: typeof REQUEST_A, installation: ReturnType<typeof fixture.installation>, cache: CharacterPreparationCache, key: string) =>
      prepareCharacterDetails({ request, route, storeRoot: join(root, "store"), resolverCache: join(root, "resolver"), exporter: fakeExporter(),
        open: () => installation, cache, manifests: { dir, key: () => key } });
    const shared = fixture.installation(), cache = new CharacterPreparationCache();
    await run(REQUEST_A, shared, cache, "a");
    // V B shares V A's lashes: served from the cache, so B's own graph reads miss their resources.
    await run(REQUEST_B, shared, cache, "b-shared");
    await run(REQUEST_B, fixture.installation(), new CharacterPreparationCache(), "b-fresh");
    const reads = (key: string) => new Set(readChoiceManifest(dir, key)!.reads.map(read => read[0]));
    const fresh = reads("b-fresh"), fromShared = reads("b-shared");
    expect(fresh.size).toBeGreaterThan(0);
    expect([...fresh].filter(hash => !fromShared.has(hash))).toEqual([]);
    expect(fromShared.has(depotHash(P.lashApp))).toBe(true);
  });
});

describe("the host's prefetch beside a person's change and Clear", () => {
  const settings: CharacterDetailSettings = { gameRoot: join(root, "game-prefetch"), launchRoute: "direct", mo2Root: null, mo2ProfileId: null,
    manualModRoot: null, wolvenKitCli: process.execPath };
  /** A creator catalogue offering one option with four choices (no game files read). */
  const creator = { ensure: async () => ({ source: { index: { byOptionId: () => ({ part: "head", name: "hair",
    choices: [{ key: "c0" }, { key: "c1" }, { key: "c2" }, { key: "c3" }] }) } } }) } as never;
  const hostWith = (cacheRoot: string, options: Partial<ConstructorParameters<typeof CharacterDetailHost>[0]>) => {
    const host = new CharacterDetailHost({ cacheRoot, settings: () => settings, exporter: () => fakeExporter(), creator, ...options });
    // Every choice is unknown to the manifests (no installation is opened for the check).
    Object.assign(host, { readiness: async () => () => false });
    return host;
  };
  const until = async (done: () => boolean) => { for (let i = 0; i < 200 && !done(); i++) await new Promise(resolve => setTimeout(resolve, 5)); };

  test("a stopped batch lets a person's change start at once, and Clear waits until the batch has finished (PREV-102)", async () => {
    const signals: AbortSignal[] = [];
    let finish!: () => void;
    const prepared: { batchStopped: boolean; preparing: boolean }[] = [];
    const host = hostWith(join(root, "host-prefetch-102"), {
      // Like reads already in WolvenKit: the batch notices its stop only when they finish.
      warm: options => { signals.push(options.signal!); return new Promise(resolve => { finish = () => resolve(options.requests.map(() => ({ ready: false }))); }); },
      prepare: async () => {
        prepared.push({ batchStopped: signals[0]?.aborted ?? false, preparing: host.prefetch.preparing });
        return { record: {} as never, recordFile: `${"c".repeat(64)}.json`, degraded: false };
      } });
    host.prefetchRow({ base: DEFAULT_CHARACTER, option: "head/hair", positions: [0, 1] });
    await until(() => signals.length > 0);
    expect(signals).toHaveLength(1);
    host.request(REQUEST_A);
    await host.settled();
    // The person's change ran without waiting for the batch's reads, and only after the prefetcher let go of the stopped batch.
    expect(prepared).toEqual([{ batchStopped: true, preparing: false }]);
    let cleared = false;
    const clearing = host.clearPreparedFiles().then(() => { cleared = true; });
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(cleared).toBe(false);
    finish();
    await clearing;
    expect(cleared).toBe(true);
  });

  test("Clear lets preparing ahead fill the budget again this session (PREV-104)", async () => {
    const cacheRoot = join(root, "host-prefetch-104");
    const host = hostWith(cacheRoot, { prefetchLimits: { batch: 4, timeMs: 60_000, bytes: 10 },
      warm: async options => {
        mkdirSync(join(cacheRoot, "exports"), { recursive: true });
        writeFileSync(join(cacheRoot, "exports", `${options.requests.length}-${Date.now()}.bin`), Buffer.alloc(64));
        return options.requests.map(() => ({ ready: true }));
      } });
    host.prefetchRow({ base: DEFAULT_CHARACTER, option: "head/hair", positions: [0, 1] });
    await until(() => host.prefetchRow({ base: DEFAULT_CHARACTER, option: "head/hair", positions: [0, 1] }).stopped === "disk");
    expect(host.prefetchRow({ base: DEFAULT_CHARACTER, option: "head/eyes", positions: [0] }).stopped).toBe("disk");
    await host.clearPreparedFiles();
    expect(host.prefetchRow({ base: DEFAULT_CHARACTER, option: "head/brows", positions: [0] }).stopped).toBeNull();
    host.stopPrefetch();
  });
});
