// Real derivation of the 3D preview core from an installed game. Needs private local inputs, so it
// runs only when XFS_TEST_GAME_ROOT (Cyberpunk 2077 folder) and XFS_TEST_WOLVENKIT (WolvenKit.CLI.exe)
// are set. Without them it is reported as skipped, never as a pass.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGameAssetExporter } from "../src/game-asset-export";
import { createWolvenKitUncook } from "../src/game-asset-export-wolvenkit";
import { ensurePreviewCore, previewCoreReadiness } from "../src/preview-core-service";
import { accessorFloats, parseGlb, readAccessor } from "../src/glb";

/** Show-through counts at neutral, and per eye shape with the eyes left static (the old preview) or morphed. */
function eyeSeating(bytes: Uint8Array) {
  const glb = parseGlb(bytes);
  const part = (name: string) => {
    const node = glb.json.nodes.find((entry: any) => entry.name === name && entry.mesh !== undefined), mesh = glb.json.meshes[node.mesh];
    const primitive = mesh.primitives[0];
    return { position: accessorFloats(readAccessor(glb, primitive.attributes.POSITION)), normal: accessorFloats(readAccessor(glb, primitive.attributes.NORMAL)),
      names: mesh.extras.targetNames as string[], targets: (primitive.targets ?? []).map((target: any) => accessorFloats(readAccessor(glb, target.POSITION))) };
  };
  const head = part("head"), eyes = part("eyes"), eyeCount = eyes.position.length / 3;
  const nearest = (point: ArrayLike<number>, row: number, surface: ArrayLike<number>) => {
    let best = Infinity, index = 0;
    for (let j = 0; j < eyeCount; j++) {
      const d = (point[row * 3]! - surface[j * 3]!) ** 2 + (point[row * 3 + 1]! - surface[j * 3 + 1]!) ** 2 + (point[row * 3 + 2]! - surface[j * 3 + 2]!) ** 2;
      if (d < best) { best = d; index = j; }
    }
    return { distance: Math.sqrt(best), index };
  };
  const rim: number[] = [];
  for (let row = 0; row < head.position.length / 3; row++) if (nearest(head.position, row, eyes.position).distance < 0.004) rim.push(row);
  const through = (headPosition: ArrayLike<number>, eyePosition: ArrayLike<number>) => rim.filter(row => {
    const { index } = nearest(headPosition, row, eyePosition);
    let gap = 0;
    for (let k = 0; k < 3; k++) gap += (headPosition[row * 3 + k]! - eyePosition[index * 3 + k]!) * eyes.normal[index * 3 + k]!;
    return gap < -0.0002;
  }).length;
  const moved = (base: Float32Array, delta: Float32Array) => base.map((value, index) => value + delta[index]!);
  return { rim: rim.length, base: through(head.position, eyes.position), shapes: eyes.names.map((name, k) => {
    const morphedHead = moved(head.position, head.targets[head.names.indexOf(name)]!);
    return { shape: name, static: through(morphedHead, eyes.position), morphed: through(morphedHead, moved(eyes.position, eyes.targets[k]!)) };
  }) };
}

const game = process.env.XFS_TEST_GAME_ROOT, wolvenkit = process.env.XFS_TEST_WOLVENKIT;
const available = !!game && !!wolvenkit && existsSync(join(game, "archive", "pc", "content")) && existsSync(wolvenkit);
if (!available) console.warn("preview-core-game.test.ts skipped: set XFS_TEST_GAME_ROOT and XFS_TEST_WOLVENKIT to derive the 3D preview from an installed game.");

test.skipIf(!available)("the 3D preview core derives from the installed 2.31 game, verifies and is reused", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "xfs-preview-game-"));
  try {
    const exporter = createGameAssetExporter(join(cacheRoot, "exports"), createWolvenKitUncook(wolvenkit!));
    const derived = await ensurePreviewCore({ gameRoot: game!, cacheRoot, exporter });
    expect(derived.reused).toBe(false);
    const { geometry, source } = derived.manifest;
    expect(source.revisionId).toBe("cp2077-2.31");
    expect(geometry.head).toEqual({ vertices: 7186, triangles: 13186, joints: 254, morphTargets: 105, influenceSets: 2 });
    expect(geometry.plate).toEqual({ vertices: 1620, triangles: 3010, morphTargets: 105 });
    // The eyes carry the eye component's own 21 eye-shape targets, each paired with a head target.
    expect(geometry.eyes).toMatchObject({ vertices: 668, triangles: 1292, morphTargets: 21 });
    expect(source.eyeMorphDepotPath.split("\\").pop()).toBe("he_000_pwa__morphs.morphtarget");
    expect(source.textures.map(texture => [texture.file, texture.depotPath.split("\\").pop(), texture.width])).toEqual([
      ["head-color.png", "h0_000_pwa_c__basehead_d01.xbm", 1024], ["head-normal.png", "h0_001_pwa_c__basehead_n01.xbm", 1024],
      ["head-roughness.png", "h0_000_wa_c__basehead_rm01.xbm", 1024], ["eye-color.png", "he_000_base_d02.xbm", 512]]);
    // Seating: head vertices within 4 mm of the eyeball are its lid/socket rim. For each eye shape, count
    // rim vertices the eyeball surface shows through (signed gap along the eye normal below -0.2 mm).
    const seating = eyeSeating(readFileSync(join(derived.directory, "head.glb")));
    console.log("eye seating per eye shape", seating);
    const total = (key: "static" | "morphed") => seating.shapes.reduce((sum, shape) => sum + shape[key], 0);
    expect(seating.shapes).toHaveLength(21);
    expect(total("morphed")).toBeLessThan(total("static") * 0.2);
    expect(seating.shapes.filter(shape => shape.morphed <= seating.base + 5).length).toBeGreaterThanOrEqual(15);
    expect(previewCoreReadiness(cacheRoot, game!).state).toBe("ready");
    const reused = await ensurePreviewCore({ gameRoot: game!, cacheRoot, exporter });
    expect(reused.reused).toBe(true);
    expect(JSON.parse(readFileSync(join(derived.directory, "preview-core.json"), "utf8")).identity).toBe(derived.manifest.cacheKey);
  } finally { rmSync(cacheRoot, { recursive: true, force: true }); }
}, 600_000);

test.skipIf(!available)("cancelling a real derivation stops WolvenKit and publishes nothing", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "xfs-preview-game-cancel-"));
  try {
    const controller = new AbortController();
    const exporter = createGameAssetExporter(join(cacheRoot, "exports"), createWolvenKitUncook(wolvenkit!));
    const started = Date.now();
    setTimeout(() => controller.abort(), 1500);
    await expect(ensurePreviewCore({ gameRoot: game!, cacheRoot, exporter, signal: controller.signal })).rejects.toMatchObject({ code: "preview_cancelled" });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(previewCoreReadiness(cacheRoot, game!).state).toBe("none");
  } finally { rmSync(cacheRoot, { recursive: true, force: true }); }
}, 120_000);
