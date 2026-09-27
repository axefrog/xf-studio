// Real derivation from an installed game. Needs private local inputs, so it runs only when
// XFS_TEST_GAME_ROOT (Cyberpunk 2077 folder) and XFS_TEST_WOLVENKIT (WolvenKit.CLI.exe) are set.
// Without them it is reported as skipped, never as a pass.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureEyePlate } from "../src/eye-plate-service";
import { EYE_PLATE_MASCULINE_RECIPE } from "../src/eye-plate-recipe";
import { createWolvenKitEyePlateTools } from "../src/eye-plate-wolvenkit";
import { oracleTest } from "./optional-oracles";

const game = process.env.XFS_TEST_GAME_ROOT, wolvenkit = process.env.XFS_TEST_WOLVENKIT;
const available = !!game && !!wolvenkit && existsSync(join(game, "archive", "pc", "content")) && existsSync(wolvenkit);
const gameTest = oracleTest(available, "the built-in plate check against an installed game needs XFS_TEST_GAME_ROOT and XFS_TEST_WOLVENKIT.");

// Reference outputs from WolvenKit CLI 8.17.4 and 9.0.1 (identical bytes) for the supported 2.31 head.
const REFERENCE = { mesh: "58081caf393e7d9e0223e2e646e6ad9bd7107a4ac307edf08fe786e4c38eed26",
  morph: "b8b7c055f6e3dd0f9a38bce2862581be13709d16d347bb55d3adb36a4c550131" };

gameTest("the built-in eye plate derives from the installed game with exact native bytes", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "xfs-eye-plate-game-"));
  try {
    const tools = createWolvenKitEyePlateTools(wolvenkit!);
    const derived = await ensureEyePlate({ gameRoot: game!, cacheRoot, tools });
    expect(derived.reused).toBe(false);
    const { verification, files, source } = derived.manifest;
    expect(source.revisionId).toBe("cp2077-2.31");
    expect([verification.vertices, verification.triangles, verification.morphTargets, verification.morphDiffs]).toEqual([1620, 3010, 105, 73164]);
    expect(verification.exactNativeSkinBytesMesh && verification.exactNativeSkinBytesMorphBase && verification.exactMorphDiffRows).toBe(true);
    expect(verification.exactVertexElements).toHaveLength(10);
    expect({ mesh: files.mesh.sha256, morph: files.morph.sha256 }).toEqual(REFERENCE);
    const reused = await ensureEyePlate({ gameRoot: game!, cacheRoot, tools });
    expect(reused.reused).toBe(true);
    expect(reused.manifest.cacheKey).toBe(derived.manifest.cacheKey);
  } finally { rmSync(cacheRoot, { recursive: true, force: true }); }
}, 600_000);

// The masculine plate from the 2.31 male head: WolvenKit CLI 8.17.4 and 9.0.1 give identical bytes (28 September 2026).
const MASCULINE_REFERENCE = { mesh: "7e8975c2d2a5f429560096d8f5b78406e391e50322479a396240e34ccad9aedc",
  morph: "4397f3aa4899cce4042bc3335b6c9e4f2b3c0de3710346789bf23f48b1c7c449" };

gameTest("the masculine eye plate derives from the installed male head with exact native bytes and the head's native seams", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "xfs-eye-plate-game-pma-"));
  try {
    const derived = await ensureEyePlate({ gameRoot: game!, cacheRoot, tools: createWolvenKitEyePlateTools(wolvenkit!), recipe: EYE_PLATE_MASCULINE_RECIPE });
    const { verification, files, source } = derived.manifest;
    expect(source.revisionId).toBe("cp2077-2.31");
    expect([verification.vertices, verification.triangles, verification.morphTargets, verification.morphDiffs]).toEqual([1627, 3010, 100, 69920]);
    expect(verification.exactNativeSkinBytesMesh && verification.exactNativeSkinBytesMorphBase && verification.exactMorphDiffRows).toBe(true);
    expect(verification.seams).toEqual(EYE_PLATE_MASCULINE_RECIPE.selection.seams);
    expect({ mesh: files.mesh.sha256, morph: files.morph.sha256 }).toEqual(MASCULINE_REFERENCE);
  } finally { rmSync(cacheRoot, { recursive: true, force: true }); }
}, 600_000);
