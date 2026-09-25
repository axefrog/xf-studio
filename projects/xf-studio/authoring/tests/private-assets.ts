import { test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
 * `XFS_PREVIEW_CORE_CACHE` or the default `data/preview-cache`, or null when none is prepared. Read-only.
 */
export function derivedPreviewPath(name: string): string | null {
  const root = resolve(process.env.XFS_PREVIEW_CORE_CACHE || resolve(import.meta.dir, "..", "data", "preview-cache"));
  let cacheName: unknown;
  try {
    const status = JSON.parse(readFileSync(resolve(root, "status.json"), "utf8"));
    if (status.state === "ready") cacheName = status.cacheName;
  } catch { return null; }
  const path = typeof cacheName === "string" && /^[\w.-]+$/.test(cacheName) ? resolve(root, cacheName, "assets", name) : "";
  return path && existsSync(path) ? path : null;
}

/**
 * Tests on the real head, which comes only from the 3D preview derived from a local game. Without
 * a prepared preview they are skipped with the reason (and fail under XFS_REQUIRE_ORACLES=1).
 */
export const derivedPreviewTest = oracleTest(derivedPreviewPath("head.glb") !== null,
  "no 3D preview has been prepared from a local game (run bun tools/prepare-preview.ts, or set XFS_PREVIEW_CORE_CACHE to a ready cache).");

/** The prepared file's path; only call inside a `derivedPreviewTest`. */
export const derivedPreviewFile = (name: string) => derivedPreviewPath(name) ??
  (() => { throw Error(`The prepared 3D preview has no ${name}.`); })();

/** Prepared character records (brows, lashes, hair) in the derived preview cache's `characters/` store. Read-only. */
export function derivedCharacterRecords(): { record: any; file: (name: string) => string }[] {
  const root = resolve(process.env.XFS_PREVIEW_CORE_CACHE || resolve(import.meta.dir, "..", "data", "preview-cache"), "characters");
  try {
    return readdirSync(resolve(root, "records")).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
      .map(name => ({ record: JSON.parse(readFileSync(resolve(root, "records", name), "utf8")), file: (file: string) => resolve(root, "files", file) }));
  } catch { return []; }
}
/** Tests on resolved character details, which exist only once the preview prepared a V from a local game. */
export const derivedCharacterTest = oracleTest(derivedCharacterRecords().length > 0,
  "no V's brows, lashes or hair have been prepared from a local game yet (open the 3D preview once, or set XFS_PREVIEW_CORE_CACHE to a ready cache).");
