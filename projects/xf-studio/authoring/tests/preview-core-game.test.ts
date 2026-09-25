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
import { inspectCoreAssets } from "../desktop/asset-intake";

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
    expect(geometry.eyes).toMatchObject({ vertices: 668, triangles: 1292 });
    expect(source.textures.map(texture => [texture.file, texture.depotPath.split("\\").pop(), texture.width])).toEqual([
      ["head-color.png", "h0_000_pwa_c__basehead_d01.xbm", 1024], ["head-normal.png", "h0_001_pwa_c__basehead_n01.xbm", 1024],
      ["head-roughness.png", "h0_000_wa_c__basehead_rm01.xbm", 1024], ["eye-color.png", "he_000_base_d02.xbm", 512]]);
    // The derived set also passes the desktop's structural check for the five core preview files.
    expect((await inspectCoreAssets(derived.directory, false)).ready).toBe(true);
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
