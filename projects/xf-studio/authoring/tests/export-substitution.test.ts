// PIPE-106: a mod's mesh that WolvenKit can't export as it is must never be drawn from the base game's copy. WolvenKit 9.0.1 exported
// with the game folder silently writes the base game's copy of a path the mod overrides (the KS UV texture framework's left arm, whose
// garment flags are two bytes per vertex where WolvenKit reads four), so the arm was drawn with vanilla UVs over the framework's
// full-body atlas: a foot on the forearm. Small fixtures only; the real resources stay private.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { archiveExportSource, createGameAssetExporter, type GeometryRepair, type UncookRun } from "../src/game-asset-export";
import { createWolvenKitMeshRepair, uncookArguments } from "../src/game-asset-export-wolvenkit";
import { GARMENT_FLAG_BYTES, MESH_EXPORT_REPAIR_VERSION, repairMeshForExport } from "../src/mesh-export-repair";
import type { JsonObject } from "../src/red-json";
import type { runWolvenKit } from "../src/wolvenkit-cli";

const root = mkdtempSync(join(tmpdir(), "xfs-substitution-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let serial = 0;
const temporary = () => { const dir = join(root, `t${serial++}`); mkdirSync(dir, { recursive: true }); return dir; };
const ARM = "base\\characters\\common\\player_base_bodies\\player_female_average\\arms_hq\\a0_000_pwa_base_hq__l.mesh";
const b64 = (bytes: number) => Buffer.alloc(bytes).toString("base64");

/** A serialized arm: render chunks with `vertices` each, and a garment parameter whose flags hold `flagBytes[i]` bytes per chunk. */
function armMesh(vertices: number[], flagBytes: number[]): JsonObject {
  return { Header: {}, Data: { RootChunk: { $type: "CMesh", boneNames: [], boneRigMatrices: [],
    parameters: [{ HandleId: "1", Data: { $type: "meshMeshParamGarmentSupport", chunkCapVertices: vertices.map(() => []) } },
      { HandleId: "2", Data: { $type: "garmentMeshParamGarment", chunks: flagBytes.map((bytes, i) => ({ $type: "garmentMeshParamGarmentChunkData",
        numVertices: vertices[i], garmentFlags: { BufferId: String(i), Flags: 0, Bytes: b64(bytes) }, vertices: { BufferId: "9", Flags: 0, Bytes: b64(12) } })) } }],
    renderResourceBlob: { HandleId: "0", Data: { $type: "rendRenderMeshBlob", header: { bonePositions: [],
      renderChunkInfos: vertices.map(numVertices => ({ $type: "rendChunk", numVertices })) } } } } } };
}
const garmentChunks = (document: JsonObject) => (((document.Data as JsonObject).RootChunk as { parameters: { Data: { chunks?: { garmentFlags: { Bytes: string } }[] } }[] })
  .parameters[1]!.Data.chunks!);

describe("the short garment flags repair (mesh-export-repair.ts)", () => {
  test("a chunk whose garment flags hold fewer than four bytes per vertex is emptied in the copy; full, empty and other chunks are kept", () => {
    expect(GARMENT_FLAG_BYTES).toBe(4);
    expect(MESH_EXPORT_REPAIR_VERSION).toBe("mesh-export-repair-2");
    // The framework's arm: two bytes per vertex in chunks 0 and 2; chunk 1 is full, chunk 3 has none.
    const original = armMesh([6, 5, 7, 3], [12, 20, 14, 0]);
    const before = JSON.stringify(original);
    const repair = repairMeshForExport(original)!;
    expect(JSON.stringify(original)).toBe(before);
    expect(garmentChunks(repair.document).map(chunk => chunk.garmentFlags.Bytes.length > 0)).toEqual([false, true, false, false]);
    expect(repair.detail).toBe("its garment support data is shorter than its vertices in chunks 0, 2, so the exported copy leaves that data out (the preview doesn't read it)");
    // Everything else is the same document.
    const strip = (document: JsonObject) => { const copy = structuredClone(document); for (const chunk of garmentChunks(copy)) chunk.garmentFlags.Bytes = ""; return JSON.stringify(copy); };
    expect(strip(repair.document)).toBe(strip(original));
  });

  test("a vanilla arm (four bytes per vertex) needs no repair; both repairs apply to one mesh together", () => {
    expect(repairMeshForExport(armMesh([6, 5], [24, 20]))).toBeNull();
    const both = armMesh([6], [12]);
    const rootChunk = (both.Data as JsonObject).RootChunk as JsonObject;
    rootChunk.boneNames = [{ $value: "a" }, { $value: "b" }];
    rootChunk.boneRigMatrices = [{}, {}];
    const repair = repairMeshForExport(both)!;
    expect(repair.detail).toContain("bone positions for 2 bones");
    expect(repair.detail).toContain("garment support data is shorter");
  });
});

/**
 * A fake WolvenKit launch: without the game folder the source's own arm is read (its raw is written) but no GLB; with it, the base
 * game's copy is exported instead (another raw, a GLB and a materials file), as WolvenKit 9.0.1 does.
 */
const substituting = (launches: { withMaterials: boolean }[]): UncookRun => async ({ depotPaths, outDir, withMaterials }) => {
  launches.push({ withMaterials });
  for (const path of depotPaths) {
    const file = join(outDir, ...path.split("\\"));
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, withMaterials ? "the base game's arm" : "the framework's arm");
    if (withMaterials) { writeFileSync(file.replace(/\.mesh$/, ".glb"), "vanilla glTF"); writeFileSync(file.replace(/\.mesh$/, ".Material.json"), "{}"); }
  }
};
const repairing = (calls: { raw: string; withMaterials?: boolean }[], outcome: "glb" | "none" = "glb"): GeometryRepair => async ({ raw, workDir, withMaterials }) => {
  calls.push({ raw: readFileSync(raw, "utf8"), withMaterials });
  if (outcome === "none") return { outcome: "not-applicable", detail: "no known repair fits this mesh" };
  writeFileSync(join(workDir, "copy.glb"), "the framework's glTF");
  return { outcome: "repaired", glb: join(workDir, "copy.glb"), materials: null, detail: "its garment support data is shorter" };
};
const tool = { key: "fake", label: "Fake" };

describe("an export with the game folder that read another copy (PIPE-106)", () => {
  test("is discarded: the source's own copy goes to the repair route, exported without the game folder, and the repaired GLB is served", async () => {
    const dir = temporary(), source = archiveExportSource(join(dir, "008_UV_Framework.archive"), dir);
    const launches: { withMaterials: boolean }[] = [], calls: { raw: string; withMaterials?: boolean }[] = [];
    const exporter = createGameAssetExporter(join(dir, "exports"), substituting(launches), { tool, repairGeometry: repairing(calls), repairKey: "r2" });
    const [answer] = await exporter.exportAll!([{ source, geometry: [ARM], textures: [], masks: [] }]);
    expect(launches.map(launch => launch.withMaterials)).toEqual([false, true]);
    // The repair got the framework's own bytes, and was told no materials are needed (so its copy is exported without the game folder).
    expect(calls).toEqual([{ raw: "the framework's arm", withMaterials: false }]);
    const geometry = answer!.geometry.get(ARM)!;
    expect(readFileSync(geometry.glb!, "utf8")).toBe("the framework's glTF");
    expect(readFileSync(geometry.raw, "utf8")).toBe("the framework's arm");
    expect(geometry.materials).toBeNull();
    // Cached as checked: a second ask launches nothing.
    const [again] = await exporter.exportAll!([{ source, geometry: [ARM], textures: [], masks: [] }]);
    expect(readFileSync(again!.geometry.get(ARM)!.glb!, "utf8")).toBe("the framework's glTF");
    expect(launches).toHaveLength(2);
    expect(exporter.has!("geometry", ARM, source)).toBe(true);
  });

  test("with no repair that fits, nothing is served rather than the base game's copy", async () => {
    const dir = temporary(), source = archiveExportSource(join(dir, "008_UV_Framework.archive"), dir);
    const exporter = createGameAssetExporter(join(dir, "exports"), substituting([]), { tool, repairGeometry: repairing([], "none"), repairKey: "r2" });
    const [answer] = await exporter.exportAll!([{ source, geometry: [ARM], textures: [], masks: [] }]);
    expect(answer!.geometry.get(ARM)?.glb ?? null).toBeNull();
  });

  test("an export with the game folder that read the source's own copy is kept, as before", async () => {
    const dir = temporary(), source = archiveExportSource(join(dir, "hair.archive"), dir);
    const own: UncookRun = async ({ depotPaths, outDir, withMaterials }) => {
      for (const path of depotPaths) {
        const file = join(outDir, ...path.split("\\"));
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, "the mod's mesh");
        if (withMaterials) writeFileSync(file.replace(/\.mesh$/, ".glb"), "the mod's glTF");
      }
    };
    const calls: { raw: string }[] = [];
    const exporter = createGameAssetExporter(join(dir, "exports"), own, { tool, repairGeometry: repairing(calls), repairKey: "r2" });
    const [answer] = await exporter.exportAll!([{ source, geometry: ["mod\\hair.mesh"], textures: [], masks: [] }]);
    expect(readFileSync(answer!.geometry.get("mod\\hair.mesh")!.glb!, "utf8")).toBe("the mod's glTF");
    expect(calls).toHaveLength(0);
  });

  test("an entry an earlier version wrote with the game folder (a materials file, raw unchecked) is exported again for the character details, " +
    "and still answers the core preview", async () => {
    const dir = temporary(), cacheRoot = join(dir, "exports"), source = archiveExportSource(join(dir, "008_UV_Framework.archive"), dir);
    // The earlier version: one launch with the game folder wrote the base game's copy under the framework's key.
    const legacy = createGameAssetExporter(cacheRoot, substituting([]), { tool, repairKey: "r2" });
    const session = legacy.open(source);
    await session.geometry([ARM]);
    session.close();
    const entry = JSON.parse(readFileSync(join(cacheRoot, "resources", readdirOnly(join(cacheRoot, "resources")), "entry.json"), "utf8"));
    delete entry.rawChecked;
    writeFileSync(join(cacheRoot, "resources", readdirOnly(join(cacheRoot, "resources")), "entry.json"), JSON.stringify(entry));
    const launches: { withMaterials: boolean }[] = [], calls: { raw: string }[] = [];
    const current = createGameAssetExporter(cacheRoot, substituting(launches), { tool, repairGeometry: repairing(calls), repairKey: "r2" });
    expect(current.has!("geometry", ARM, source)).toBe(false);
    const [answer] = await current.exportAll!([{ source, geometry: [ARM], textures: [], masks: [] }]);
    expect(launches).toHaveLength(2);
    expect(readFileSync(answer!.geometry.get(ARM)!.glb!, "utf8")).toBe("the framework's glTF");
  });
});

function readdirOnly(dir: string): string {
  const names = readdirSync(dir).filter(name => !name.endsWith(".json"));
  if (names.length !== 1) throw Error(`expected one entry in ${dir}, found ${names.join(", ")}`);
  return names[0]!;
}

describe("the repair route's export of the repaired copy (game-asset-export-wolvenkit.ts)", () => {
  /** A fake WolvenKit: the uncook writes a GLB only when `glbWith` allows it, and a raw that is the packed copy unless `substitute`. */
  function wolvenKit(options: { glbWith: "any" | "game"; substitute?: boolean }) {
    const launches: string[][] = [];
    const run = (async (_cli, args) => {
      launches.push([...args]);
      const step = args[0] === "convert" ? args[1] : args[0];
      const out = args[args.indexOf("-o") + 1]!;
      if (step === "serialize") writeFileSync(join(out, `${basename(args[2]!)}.json`), JSON.stringify(armMesh([6], [12])));
      if (step === "deserialize") writeFileSync(join(out, basename(ARM)), "the repaired arm");
      if (step === "pack") writeFileSync(join(out, "pack.archive"), "archive");
      if (step === "uncook") {
        const withGame = args.includes("-gp");
        const stem = join(out, ...ARM.replace(/\.mesh$/, "").split("\\"));
        mkdirSync(join(stem, ".."), { recursive: true });
        writeFileSync(`${stem}.mesh`, options.substitute && withGame ? "the base game's arm" : "the repaired arm");
        if (options.glbWith === "any" || withGame) writeFileSync(`${stem}.glb`, "glTF");
      }
      return { exitCode: 0, stdout: "", stderr: "", output: "" };
    }) as typeof runWolvenKit;
    return { run, launches };
  }
  const repairWith = async (kit: ReturnType<typeof wolvenKit>, withMaterials: boolean) => {
    const dir = temporary(), raw = join(dir, "raw.mesh");
    writeFileSync(raw, "the framework's arm");
    const source = archiveExportSource(join(dir, "008_UV_Framework.archive"), join(dir, "game"));
    const outcome = await createWolvenKitMeshRepair("wk.exe", 1000, kit.run)({ source, depotPath: ARM, raw, workDir: join(dir, "work"), withMaterials });
    return { outcome, source, dir };
  };

  test("without materials the copy is uncooked without the game folder", async () => {
    const kit = wolvenKit({ glbWith: "any" });
    const { outcome } = await repairWith(kit, false);
    expect(outcome).toMatchObject({ outcome: "repaired", detail: expect.stringContaining("garment support data") });
    expect(kit.launches.at(-1)).not.toContain("-gp");
    expect(kit.launches).toHaveLength(4);
  });

  test("a copy that needs the game folder is tried once with it; a raw that isn't the packed copy fails instead of serving another copy", async () => {
    const needsGame = wolvenKit({ glbWith: "game" });
    const { outcome, source } = await repairWith(needsGame, false);
    expect(outcome.outcome).toBe("repaired");
    expect(needsGame.launches).toHaveLength(5);
    expect(needsGame.launches.at(-1)).toContain(source.gameRoot);
    const substituted = wolvenKit({ glbWith: "game", substitute: true });
    expect((await repairWith(substituted, false)).outcome).toEqual({ outcome: "failed", step: "uncook",
      detail: "WolvenKit exported another copy of this resource (the base game's) instead of the repaired one" });
  });

  test("with materials (the core preview) the copy is uncooked with the game folder, as before", async () => {
    const kit = wolvenKit({ glbWith: "any" });
    const { outcome, dir } = await repairWith(kit, true);
    expect(outcome.outcome).toBe("repaired");
    expect(kit.launches.at(-1)).toEqual(uncookArguments(join(dir, "work", "archive", "pack.archive"), [ARM], join(dir, "work", "out"), join(dir, "game")));
    expect(existsSync(join(dir, "work", "out-game"))).toBe(false);
  });
});
