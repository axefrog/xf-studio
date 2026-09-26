// A CCXL hairstyle whose main mesh uses ArchiveXL dynamic materials, lists fewer chunk materials than it has render chunks, is coloured
// by a hair-colour pack's patched appearance, and which WolvenKit can't export as it is (its render data lists fewer bone positions
// than it has bones). Asset-free: the shapes mirror the High Ponytail CCXL hair (knowledge/mod-loading.md §5–6).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planCharacterDetails } from "../src/character-detail-plan";
import { CharacterPreparationCache, prepareCharacterDetails } from "../src/character-detail-service";
import { loadMergedCco, resolveCharacter, type CharacterInput } from "../src/character-resolver";
import { depotHash, refFromPath } from "../src/depot-path";
import { archiveExportSource, createGameAssetExporter, GameAssetExportError, type ExportedGeometry, type ExportedMask, type ExportedTexture,
  type GameAssetExporter, type GeometryRepair, type UncookRun } from "../src/game-asset-export";
import { bonePositionFromRigMatrix, repairMeshForExport } from "../src/mesh-export-repair";
import { encodePng } from "../src/png";
import type { JsonObject } from "../src/red-json";
import { detailFixture, P, REQUEST_A } from "./character-detail-fixtures";
import { app, cco, fixtureInstallation, instance, mesh, meshComponent, mi, nameParam, tex, appearanceOption, type FixtureArchive } from "./resolver-fixtures";

const root = mkdtempSync(join(tmpdir(), "xfs-dynamic-hair-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const HAIR_APP = "anru\\highpony\\fhair_highpony.app", PONY = "anru\\highpony\\fhair_highpony_pony.mesh";
const LONG_MI = "anru\\highpony\\highpony_long.mi", CAP_MI = "anru\\highpony\\highpony_cap.mi";
const PATCH = "archive_xl\\characters\\common\\hair\\h1_base_color_patch.mesh";
const PROFILE = (colour: string) => `base\\characters\\common\\hair\\textures\\hair_profiles\\${colour}.hp`;

/** Ten render chunks: two real LOD0 strand chunks, then three-vertex stubs on LOD0 and every lower level, as the ponytail has. */
function ponyMesh() {
  const document = mesh({ chunks: 10, appearances: [{ name: "black_carbon", chunkMaterials: ["black_carbon@long", "black_carbon@long"] }],
    entries: [{ name: "@context", local: true, index: 0 }, { name: "@long", local: true, index: 1 }, { name: "@cap", local: true, index: 2 }],
    local: [instance("", [nameParam("LongBaseMaterial", LONG_MI), nameParam("CapBaseMaterial", CAP_MI)]),
      instance(LONG_MI, [tex("HairProfile", "*base\\characters\\common\\hair\\textures\\hair_profiles\\{material}.hp")]),
      instance(CAP_MI, [tex("GradientMap", "*base\\characters\\common\\hair\\textures\\cap_gradiants\\hh_cap_grad__{material}.xbm")])] });
  const infos = ((document.Data.RootChunk as JsonObject).renderResourceBlob as { Data: { header: { renderChunkInfos: JsonObject[] } } }).Data.header.renderChunkInfos;
  [1, 1, 1, 2, 2, 2, 4, 4, 8, 8].forEach((lodMask, index) => Object.assign(infos[index]!, { lodMask,
    renderMask: index < 2 ? "MCF_RenderInScene, MCF_IsTwoSided" : "MCF_RenderInScene" }));
  return document;
}

function hairInstallation() {
  const FEMALE_CCO = "base\\gameplay\\gui\\fullscreen\\main_menu\\female_cco.inkcharcustomization";
  const archives: FixtureArchive[] = [
    { virtualPath: "archive/pc/content/basegame.archive", files: {
      [FEMALE_CCO]: cco([], { hairs: [] }), "base\\materials\\hair.mt": {},
      [PROFILE("pink_magenta")]: {}, [PROFILE("black_carbon")]: {}, [PROFILE("ash_brown")]: {} } },
    { virtualPath: "archive/pc/mod/ANRU_HighPony.archive", provider: "mo2-mod", providerName: "High Ponytail", priority: 5, files: {
      "anru\\highpony\\_pwa.inkcharcustomization": cco([appearanceOption("fhair_highpony", HAIR_APP, ["01_blonde_platinum", "06_black_carbon"], { uiSlot: "hair_color" })],
        { hairs: ["fhair_highpony"] }),
      [HAIR_APP]: app([{ name: "default" }, { name: "01_blonde_platinum", components: [meshComponent("fhair_highpony", PONY, "blonde_platinum")],
        overrides: [{ componentName: "fhair_highpony", meshAppearance: "blonde_platinum" }] }]),
      [PONY]: ponyMesh(),
      [LONG_MI]: mi("base\\materials\\hair.mt", [tex("Strand_Alpha", "anru\\highpony\\alpha.xbm"), tex("Strand_ID", "anru\\highpony\\id.xbm"),
        tex("Strand_Gradient", "anru\\highpony\\grad.xbm")]),
      "anru\\highpony\\alpha.xbm": {}, "anru\\highpony\\id.xbm": {}, "anru\\highpony\\grad.xbm": {},
    } },
    // ArchiveXL's bundled hair-colour patch: every vanilla colour as an appearance with no chunk materials, patched into every
    // hairstyle mesh in the customization scope; the colour pack's CCO adds the choice.
    { virtualPath: "archive/pc/mod/colours.archive", provider: "mo2-mod", providerName: "Hair colours", priority: 4, files: {
      "colours\\colours.inkcharcustomization": cco([appearanceOption("", null, ["15_pink_magenta", "38_ash_brown"], { uiSlot: "hair_color" })], {}),
      [PATCH]: mesh({ appearances: [{ name: "pink_magenta", chunkMaterials: [] }, { name: "ash_brown", chunkMaterials: [] }], entries: [] }),
    } },
  ];
  const xl = [
    { id: "archive/pc/mod/ANRU_HighPony.archive.xl", document: { customizations: { female: "anru\\highpony\\_pwa.inkcharcustomization" },
      resource: { scope: { "player_customization.app": ["player_wa_hair.app"], "player_wa_hair.app": [HAIR_APP], "player_wa_hair.mesh": [PONY] } } } },
    { id: "archive/pc/mod/colours.xl", document: { customizations: { female: "colours\\colours.inkcharcustomization" },
      resource: { patch: { [PATCH]: { props: ["appearances"], targets: ["player_wa_hair.mesh"] } } } } },
  ];
  return fixtureInstallation(archives, xl);
}

async function resolveColour(definition: string) {
  const { graph } = hairInstallation();
  const merged = await loadMergedCco(graph, "female");
  const input: CharacterInput = { bodyGender: "female", origin: "ui-state", morphs: [],
    appearances: [{ part: "head", group: "hairs", option: "fhair_highpony", app: refFromPath(HAIR_APP), definition }] };
  const resolved = await resolveCharacter(graph, input, merged);
  return { resolved, plan: planCharacterDetails(resolved, merged.merged.cco) };
}

describe("a dynamic CCXL hairstyle coloured by a patched appearance", () => {
  test("the patched colour expands, instantiates the @long template from @context, and the strand chunks are planned", async () => {
    const { resolved, plan } = await resolveColour("15_pink_magenta");
    const [entry] = resolved.appearances;
    expect(entry!.appearance.status).toBe("dynamic");
    const pony = entry!.components.find(component => component.name === "fhair_highpony")!;
    expect(pony.meshAppearanceResolved).toEqual({ requested: "pink_magenta", used: "pink_magenta", expandedFrom: "black_carbon", patchedFrom: PATCH });
    const [first, second] = pony.materials;
    for (const material of [first!, second!]) {
      expect(material.route).toBe("template");
      expect(material.name).toBe("pink_magenta@long");
      expect(material.dynamic!.context.long_base_material).toBe(LONG_MI);
      expect(material.params.find(param => param.name === "HairProfile")!.value).toBe(PROFILE("pink_magenta"));
      expect(material.template!.ref.path).toBe("base\\materials\\hair.mt");
    }
    // Chunk 2 takes ArchiveXL's patch-source tag (an empty placeholder material); later chunks have no material of their own.
    expect(pony.materials[2]).toMatchObject({ chunk: 2, route: "none", template: null });
    expect(pony.materials[2]!.gaps[0]).toContain(PATCH);
    expect(pony.materials.slice(3).every(material => material.route === "none" && material.gaps[0]!.includes("no material of its own"))).toBe(true);
    expect(pony.notes.some(item => item.rule === "R10-short-chunk-list")).toBe(true);
    // Regression: the ponytail is drawn, with both strand chunks and nothing reported as an unsupported material.
    const hair = plan.components.find(component => component.component === "fhair_highpony")!;
    expect(hair.chunks).toEqual([0, 1]);
    expect(hair.skippedChunks).toBe(0);
    expect(hair.materials.map(material => Object.keys(material.profiles))).toEqual([["HairProfile"], ["HairProfile"]]);
    expect(plan.slots.find(slot => slot.slot === "hair")).toEqual({ slot: "hair", state: "shown", label: "pink magenta" });
  });

  test("the mesh's own colour and another patched colour resolve the same way", async () => {
    for (const [definition, colour] of [["06_black_carbon", "black_carbon"], ["38_ash_brown", "ash_brown"]]) {
      const { resolved, plan } = await resolveColour(definition!);
      const pony = resolved.appearances[0]!.components.find(component => component.name === "fhair_highpony")!;
      expect(pony.materials[0]!.params.find(param => param.name === "HairProfile")!.value).toBe(PROFILE(colour!));
      expect(plan.components.find(component => component.component === "fhair_highpony")!.chunks).toEqual([0, 1]);
    }
  });
});

/** A WolvenKit-shaped mesh document: `bones` bone names and rig matrices (bone i at x = i / 100), `positions` header bone positions. */
function serializedMesh(bones: number, positions: number): JsonObject {
  const vector = (X: number, Y: number, Z: number, W: number) => ({ $type: "Vector4", X, Y, Z, W });
  // A rig matrix maps mesh space to bone space: rotation +90° about Z, then translation. Its inverse's translation is the bone position.
  const matrix = (x: number) => ({ $type: "Matrix", X: vector(0, 1, 0, 0), Y: vector(-1, 0, 0, 0), Z: vector(0, 0, 1, 0), W: vector(0, x, -1.6, 1) });
  return { Header: {}, Data: { RootChunk: { $type: "CMesh",
    boneNames: Array.from({ length: bones }, (_, i) => ({ $type: "CName", $storage: "string", $value: `bone_${i}` })),
    boneRigMatrices: Array.from({ length: bones }, (_, i) => matrix(-i / 100)),
    renderResourceBlob: { HandleId: "0", Data: { $type: "rendRenderMeshBlob", header: { bonePositions: Array.from({ length: positions }, () => vector(9, 9, 9, 1)) } } } } } };
}

describe("exporting a mesh WolvenKit refuses as it is", () => {
  test("a short bone position list is filled from the bones' own rig matrices; nothing else changes", () => {
    const original = serializedMesh(5, 2);
    const before = JSON.stringify(original);
    const repair = repairMeshForExport(original)!;
    expect(JSON.stringify(original)).toBe(before);
    const header = (((repair.document.Data as JsonObject).RootChunk as JsonObject).renderResourceBlob as { Data: { header: { bonePositions: { X: number; Y: number; Z: number }[] } } }).Data.header;
    expect(header.bonePositions).toHaveLength(5);
    // The existing entries are kept as they are; new ones are each rig matrix's inverted translation.
    expect(header.bonePositions[0]).toMatchObject({ X: 9, Y: 9, Z: 9 });
    const third = header.bonePositions[3]!;
    expect([third.X, third.Y, third.Z].map(v => Number(v.toFixed(6)) + 0)).toEqual([0.03, 0, 1.6]);
    expect(repair.detail).toBe("its render data lists 2 bone positions for 5 bones, so the exported copy fills in the other 3 from the bones' own rig matrices");
    expect(repairMeshForExport(serializedMesh(5, 5))).toBeNull();
    expect(repairMeshForExport({ Data: { RootChunk: { $type: "CMaterialInstance" } } })).toBeNull();
    expect(bonePositionFromRigMatrix({ X: { X: 0 }, Y: { Y: 0 }, Z: { Z: 0 }, W: {} })).toBeNull();
  });

  const fakeRun = (): UncookRun => async ({ depotPaths, outDir }) => {
    // WolvenKit read the mesh (its raw copy is written) but refused to write the GLB.
    for (const path of depotPaths) {
      const file = join(outDir, ...path.split("\\"));
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "raw mesh");
    }
  };
  const fakeRepair = (outcome: "glb" | "none" | "failed" | "tool_failed" | "cancelled" | "disk", calls: string[] = []): GeometryRepair => async ({ depotPath, workDir }) => {
    calls.push(depotPath);
    if (outcome === "tool_failed" || outcome === "cancelled") throw new GameAssetExportError(outcome, "fake");
    if (outcome === "disk") throw Object.assign(Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
    if (outcome === "none") return { outcome: "not-applicable", detail: "no known repair fits this mesh" };
    if (outcome === "failed") return { outcome: "failed", step: "pack", detail: "WolvenKit wrote no archive" };
    writeFileSync(join(workDir, "copy.glb"), "glTF");
    writeFileSync(join(workDir, "copy.Material.json"), "{}");
    return { outcome: "repaired", glb: join(workDir, "copy.glb"), materials: join(workDir, "copy.Material.json"), detail: "the copy's repair" };
  };
  const source = archiveExportSource(join(root, "hair.archive"), join(root, "game"));

  test("the repaired copy's GLB completes the export, is cached with its repair line and is reused", async () => {
    const calls: string[] = [];
    const exporter = createGameAssetExporter(join(root, "export-cache"), fakeRun(), { tool: { key: "fake", label: "Fake" }, repairGeometry: fakeRepair("glb", calls) });
    const session = exporter.open(source);
    const exported = (await session.geometry([PONY])).get(PONY)!;
    session.close();
    expect(exported).toMatchObject({ complete: true, cached: false, repair: "the copy's repair" });
    expect(readFileSync(exported.glb!, "utf8")).toBe("glTF");
    const again = exporter.open(source);
    expect((await again.geometry([PONY])).get(PONY)).toMatchObject({ complete: true, cached: true, repair: "the copy's repair" });
    again.close();
    expect(calls).toEqual([PONY]);
  });

  test("without a repair (or when it fails) the export stays incomplete and uncached; cancellation still stops it", async () => {
    // Each outcome is reported with the step it stopped at (PIPE-86).
    const reported: [string, string, string | null][] = [];
    for (const outcome of ["none", "failed", "tool_failed"] as const) {
      const exporter = createGameAssetExporter(join(root, `export-${outcome}`), fakeRun(), { repairGeometry: fakeRepair(outcome),
        onRepair: (depotPath, result) => reported.push([depotPath, result.outcome, result.outcome === "failed" ? result.step : null]) });
      const session = exporter.open(source);
      const exported = (await session.geometry([PONY])).get(PONY)!;
      session.close();
      expect(exported).toMatchObject({ glb: null, complete: false, cached: false, repair: null });
    }
    expect(reported).toEqual([[PONY, "not-applicable", null], [PONY, "failed", "pack"], [PONY, "failed", "tool"]]);
    // A failure that isn't the tool's (a full disk) is never taken for WolvenKit's: it stops the export with its own error (PIPE-86).
    const disk = createGameAssetExporter(join(root, "export-disk"), fakeRun(), { repairGeometry: fakeRepair("disk") }).open(source);
    await expect(disk.geometry([PONY])).rejects.toMatchObject({ code: "ENOSPC" });
    disk.close();
    const exporter = createGameAssetExporter(join(root, "export-cancelled"), fakeRun(), { repairGeometry: fakeRepair("cancelled") });
    const session = exporter.open(source);
    await expect(session.geometry([PONY])).rejects.toMatchObject({ code: "cancelled" });
    session.close();
    // Only meshes are repaired: a morph target's missing GLB is left as it is.
    const calls: string[] = [];
    const morphs = createGameAssetExporter(join(root, "export-morph"), fakeRun(), { repairGeometry: fakeRepair("glb", calls) }).open(source);
    expect((await morphs.geometry(["anru\\x.morphtarget"])).get("anru\\x.morphtarget")!.glb).toBeNull();
    morphs.close();
    expect(calls).toEqual([]);
  });
});

const png = encodePng({ width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]) }, { alpha: true });
/** A minimal exporter: GLB-shaped files and 2×1 PNGs; `drop` removes geometry, `missing` textures, `fail` makes an archive's tool fail. */
function exporterFor(options: { drop?: string[]; missing?: string[]; fail?: string; repair?: string } = {}): GameAssetExporter {
  let n = 0;
  return { open(source) {
    const dir = join(root, `served-${n++}`);
    mkdirSync(dir, { recursive: true });
    return { tool: { key: "fake", label: "Fake exporter" }, present: () => null, close() {},
      async geometry(paths) {
        if (options.fail && source.archivePath.includes(options.fail)) throw new GameAssetExportError("tool_failed", "fake failure");
        return new Map(paths.filter(path => !options.drop?.includes(path)).map((path): [string, ExportedGeometry] => {
          const file = join(dir, `${depotHash(path)}.glb`);
          writeFileSync(file, `glTF ${path}`);
          return [path, { depotPath: path, hash: depotHash(path), raw: file, rawSha256: "", glb: file, glbSha256: "", materials: null, materialsSha256: null,
            complete: true, cached: false, repair: path === P.hairMesh ? options.repair ?? null : null }];
        }));
      },
      async textures(paths) {
        return new Map(paths.filter(path => !options.missing?.includes(path)).map((path): [string, ExportedTexture] => {
          const file = join(dir, `${depotHash(path)}.png`);
          writeFileSync(file, png);
          return [path, { depotPath: path, hash: depotHash(path), png: file, pngSha256: "", cached: false }];
        }));
      },
      async masks(paths) { return new Map<string, ExportedMask>(paths.map(path => [path, { depotPath: path, hash: depotHash(path), layers: [], cached: false }])); } };
  } };
}

describe("a planned part that can't be served always says so (diagnostics)", () => {
  const route = { gameRoot: join(root, "game"), launchRoute: "mo2" as const, wolvenKitCli: "wk.exe" };
  const prepare = (exporter: GameAssetExporter, fixture = detailFixture(), cache?: CharacterPreparationCache, installation = fixture.installation()) =>
    prepareCharacterDetails({ request: REQUEST_A, route, storeRoot: join(root, "store"), resolverCache: join(root, "resolver"), exporter,
      open: () => installation, cache });

  test("a shape WolvenKit didn't export names the part, the resource and the archive", async () => {
    const { record } = await prepare(exporterFor({ drop: [P.shadowMesh] }), detailFixture({ shadowsInScene: true }));
    expect(record.components.filter(c => c.slot === "hair").map(c => c.component)).toEqual(["hair"]);
    expect(record.provenance.notes).toContain(`Part hair_shadow of your V's hair isn't shown: WolvenKit couldn't export its shape (${P.shadowMesh}) from basegame_fixture.archive.`);
  });

  test("a tool failure, missing required inputs and a vanished export each leave a note", async () => {
    const failed = (await prepare(exporterFor({ fail: "basegame_fixture" }))).record;
    expect(failed.provenance.notes).toContain("Part hair of your V's hair isn't shown: WolvenKit couldn't read basegame_fixture.archive.");
    // Every chunk of the hair needs an input that can't be read: no chunk is left to draw.
    const unreadable = (await prepare(exporterFor({ missing: [P.strandA, P.capMask] }))).record;
    expect(unreadable.components.some(c => c.slot === "hair")).toBe(false);
    expect(unreadable.provenance.notes).toContain("Part hair of your V's hair isn't shown: none of its 2 chunk(s) could be drawn, because an input they need couldn't be read.");
    // One installation, so the second preparation reuses the first one's exports.
    const cache = new CharacterPreparationCache(), fixture = detailFixture(), installation = fixture.installation();
    await prepare(exporterFor(), fixture, cache, installation);
    for (const [key, value] of cache.geometry) if (key.endsWith(`|${P.hairMesh.toLowerCase()}`)) cache.geometry.set(key, { ...value, glb: join(root, "gone.glb") });
    cache.components.clear();
    const vanished = (await prepare(exporterFor(), fixture, cache, installation)).record;
    expect(vanished.provenance.notes.some(line => line.startsWith("Part hair of your V's hair isn't shown: its exported shape") && line.includes(P.hairMesh))).toBe(true);
    expect(existsSync(join(root, "gone.glb"))).toBe(false);
  });

  test("a shape exported from a repaired copy is served with a note saying so", async () => {
    const { record } = await prepare(exporterFor({ repair: "its render data lists 45 bone positions for 141 bones" }));
    expect(record.components.some(c => c.component === "hair")).toBe(true);
    expect(record.provenance.notes).toContain("hair: WolvenKit couldn't export its shape as it is, so it was exported from a repaired copy: its render data lists 45 bone positions for 141 bones.");
  });
});
