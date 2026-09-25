import { test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { oracleTest } from "./optional-oracles";

/**
 * Tests that read ignored, game-derived files: detail assets under public/assets and the 3D
 * preview core derived from the local game (the server's preview cache). They fail loudly when
 * the files are missing, except in a build that explicitly declares it has none (public CI sets
 * XFS_PRIVATE_ASSETS=absent after proving the directory does not exist). Never set it locally
 * to hide a missing intake. Under XFS_REQUIRE_ORACLES=1 these declared skips fail too.
 */
export const privateAssetTest = process.env.XFS_PRIVATE_ASSETS === "absent"
  ? oracleTest(false, "XFS_PRIVATE_ASSETS=absent declares that the private preview assets are missing.") : test;

/**
 * One file of the ready derived preview core (`head.glb`, the maps or `preview-core.json`) from
 * `XFS_PREVIEW_CORE_CACHE` or the default `data/preview-cache`. Read-only.
 */
export function derivedPreviewFile(name: string): string {
  const root = resolve(process.env.XFS_PREVIEW_CORE_CACHE || resolve(import.meta.dir, "..", "data", "preview-cache"));
  let cacheName: unknown;
  try {
    const status = JSON.parse(readFileSync(resolve(root, "status.json"), "utf8"));
    if (status.state === "ready") cacheName = status.cacheName;
  } catch { /* Reported below. */ }
  const path = typeof cacheName === "string" && /^[\w.-]+$/.test(cacheName) ? resolve(root, cacheName, "assets", name) : "";
  if (!path || !existsSync(path))
    throw Error("Prepare the 3D preview from your game (bun tools/prepare-preview.ts) or set XFS_PREVIEW_CORE_CACHE before these tests.");
  return path;
}
