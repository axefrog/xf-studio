// A morph target WolvenKit exported without the game folder came out without its skin (a nails morph mod's fingertip-skinned nails,
// drawn floating beside the fingers as one rigid part). The skin route exports the source's own raw copy once more, with the game
// folder, and keeps that GLB only when it has a skin and the same vertices. Small fixtures only.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveExportSource, createGameAssetExporter, glbSkinState, type MorphTargetSkin, type UncookRun } from "../src/game-asset-export";
import { createWolvenKitMorphSkin } from "../src/game-asset-export-wolvenkit";
import { GlbWriter } from "../src/glb";

const root = mkdtempSync(join(tmpdir(), "xfs-morph-skin-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let serial = 0;
const temporary = () => { const dir = join(root, `t${serial++}`); mkdirSync(dir, { recursive: true }); return dir; };
const NAILS = "base\\characters\\common\\player_base_bodies\\player_female_average\\arms_hq\\nails\\a0_000_pwa_base__nails_l.morphtarget";
const tool = { key: "fake", label: "Fake" };

/** A one-triangle GLB of `vertices` vertices, with a one-joint skin or without one. */
function glb(vertices: number, skinned: boolean): Uint8Array {
  const writer = new GlbWriter();
  const position = writer.add(new Float32Array(vertices * 3), "VEC3");
  const attributes: Record<string, number> = { POSITION: position };
  if (skinned) {
    attributes.JOINTS_0 = writer.add(new Uint8Array(vertices * 4), "VEC4");
    attributes.WEIGHTS_0 = writer.add(Float32Array.from({ length: vertices * 4 }, (_, i) => i % 4 ? 0 : 1), "VEC4");
  }
  return writer.toGlb({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: "submesh_00_LOD_1_doubled", mesh: 0, ...(skinned ? { skin: 0 } : {}) }, { name: "LeftHandIndex3" }],
    meshes: [{ name: "submesh_00_LOD_1_doubled", primitives: [{ attributes }] }], ...(skinned ? { skins: [{ joints: [1] }] } : {}) });
}
/** WolvenKit without the game folder: the raw and a GLB without a skin. */
const unskinned = (launches: number[]): UncookRun => async ({ depotPaths, outDir }) => {
  launches.push(1);
  for (const path of depotPaths) {
    const file = join(outDir, ...path.split("\\"));
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "the mod's nails");
    writeFileSync(`${file}.glb`, glb(3, false));
  }
};
const skinning = (calls: string[], result: "skinned" | "unskinned" | "other" | "none"): MorphTargetSkin => async ({ raw, workDir }) => {
  calls.push(readFileSync(raw, "utf8"));
  if (result === "none") return null;
  const out = join(workDir, "second.glb");
  writeFileSync(out, glb(result === "other" ? 4 : 3, result !== "unskinned"));
  return out;
};

test("a morph target exported without its skin is exported again from its own raw copy, and the skinned GLB is served and cached", async () => {
  const dir = temporary(), source = archiveExportSource(join(dir, "Nails.archive"), dir);
  const launches: number[] = [], calls: string[] = [];
  const exporter = createGameAssetExporter(join(dir, "exports"), unskinned(launches), { tool, skinMorphTarget: skinning(calls, "skinned") });
  const [answer] = await exporter.exportAll!([{ source, geometry: [NAILS], textures: [], masks: [] }]);
  expect(calls).toEqual(["the mod's nails"]);
  expect(glbSkinState(answer!.geometry.get(NAILS)!.glb!)).toEqual({ meshes: 1, skins: 1, vertices: [3] });
  // Cached with its note: a second ask launches nothing and doesn't run the route again.
  const [again] = await exporter.exportAll!([{ source, geometry: [NAILS], textures: [], masks: [] }]);
  expect(glbSkinState(again!.geometry.get(NAILS)!.glb!)?.skins).toBe(1);
  expect(launches).toHaveLength(1); expect(calls).toHaveLength(1);
});

test("a second GLB without a skin or with other vertices is not used, and the route isn't run again for that export", async () => {
  for (const result of ["unskinned", "other", "none"] as const) {
    const dir = temporary(), source = archiveExportSource(join(dir, "Nails.archive"), dir);
    const launches: number[] = [], calls: string[] = [];
    const exporter = createGameAssetExporter(join(dir, "exports"), unskinned(launches), { tool, skinMorphTarget: skinning(calls, result) });
    const [answer] = await exporter.exportAll!([{ source, geometry: [NAILS], textures: [], masks: [] }]);
    expect(glbSkinState(answer!.geometry.get(NAILS)!.glb!)).toEqual({ meshes: 1, skins: 0, vertices: [3] });
    await exporter.exportAll!([{ source, geometry: [NAILS], textures: [], masks: [] }]);
    expect(launches).toHaveLength(1); expect(calls).toHaveLength(1);
  }
});

test("an unskinned morph target cached before the skin route goes through it once; a mesh never does", async () => {
  const dir = temporary(), cacheRoot = join(dir, "exports"), source = archiveExportSource(join(dir, "Nails.archive"), dir);
  const before = createGameAssetExporter(cacheRoot, unskinned([]), { tool });
  await before.exportAll!([{ source, geometry: [NAILS], textures: [], masks: [] }]);
  const launches: number[] = [], calls: string[] = [];
  const now = createGameAssetExporter(cacheRoot, unskinned(launches), { tool, skinMorphTarget: skinning(calls, "skinned") });
  const [answer] = await now.exportAll!([{ source, geometry: [NAILS], textures: [], masks: [] }]);
  expect(glbSkinState(answer!.geometry.get(NAILS)!.glb!)?.skins).toBe(1);
  expect(launches).toHaveLength(1);
});

test("the WolvenKit skin route exports the raw file itself, by name, with the game folder", async () => {
  const dir = temporary(), raw = join(dir, "raw");
  writeFileSync(raw, "the mod's nails");
  const commands: string[][] = [];
  const route = createWolvenKitMorphSkin("WolvenKit.CLI.exe", 1000, (async (_cli: string | null, args: string[]) => {
    commands.push(args);
    const out = args[args.indexOf("-o") + 1]!;
    writeFileSync(join(out, "a0_000_pwa_base__nails_l.morphtarget.glb"), glb(3, true));
  }) as never);
  const glbFile = await route({ source: archiveExportSource(join(dir, "Nails.archive"), "GAME"), depotPath: NAILS, raw, workDir: join(dir, "work") });
  expect(commands[0]!.slice(0, 1)).toEqual(["export"]);
  expect(readFileSync(commands[0]![1]!, "utf8")).toBe("the mod's nails");
  expect(commands[0]).toContain("-gp");
  expect(commands[0]![commands[0]!.indexOf("-gp") + 1]).toBe("GAME");
  expect(glbSkinState(glbFile!)?.skins).toBe(1);
});
