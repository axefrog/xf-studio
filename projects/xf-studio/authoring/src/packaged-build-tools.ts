/**
 * The desktop app's packaged build tools as the package builder sees them, and which texture compressor the builder may load
 * (NATIVE-75). The desktop packages the builder bundle below one folder with an integrity manifest (desktop/prepare-build-tools.ts) and
 * runs it with `--app-root <that folder>`. Pure apart from the `readText` port.
 *
 * - **A packaged run** (the app root holds the build-tools manifest) loads only the app's own packaged compressor, which the manifest
 *   lists, bound to the manifest's SHA-256, and ignores `XFS_BCN_LIBRARY` (a developer's switch, like the `XFS_PACKAGE_*` overrides the
 *   desktop ignores). A manifest that doesn't list it allows none.
 * - **The source tree** takes a developer's `XFS_BCN_LIBRARY` as given, then the copy tools/build-native-bcn.ts built into the ignored
 *   `data/tools/xfs-bcn`, bound to the SHA-256 its `xfs_bcn.json` records.
 *
 * A candidate whose bytes differ from its hash, or whose hash is unknown, is never loaded; the Build imports textures with WolvenKit and
 * its manifest's `resourceWriters` says why.
 */
import { dirname, join } from "node:path";

/** The build-tools manifest's schema. */
export const BUILD_TOOLS_SCHEMA = "xfs/desktop-build-tools-2";
/** The builder bundle, below the build-tools folder. */
export const builderEntry = "app/tools/build.js";
/** The texture compressor, below the build-tools folder, listed in the manifest with its SHA-256 (optional: WolvenKit imports textures without it). */
export const bcnEntry = "app/native/xfs_bcn.dll";

/**
 * A compressor the builder may load. `sha256`: the hash its bytes must have (a string), unknown so it may not load (null), or absent
 * for a developer's explicit `XFS_BCN_LIBRARY`.
 */
export type BcnCandidate = { readonly path: string; readonly sha256?: string | null };

const HEX64 = /^[0-9a-f]{64}$/;
const parse = (text: string | null): Record<string, unknown> | null => {
  if (text === null) return null;
  try { const value = JSON.parse(text); return value && typeof value === "object" && !Array.isArray(value) ? value : null; } catch { return null; }
};

/** Where the builder looks for the compressor. `appRoot` is `--app-root`; `sourceRoot` is the authoring folder the builder came from. */
export function bcnCandidates(appRoot: string, sourceRoot: string, env: Readonly<Record<string, string | undefined>>,
  readText: (path: string) => string | null): BcnCandidate[] {
  const manifest = parse(readText(join(appRoot, "manifest.json")));
  if (manifest?.schema === BUILD_TOOLS_SCHEMA) {
    const files = manifest.files && typeof manifest.files === "object" ? manifest.files as Record<string, unknown> : {};
    const sha256 = files[bcnEntry];
    return typeof sha256 === "string" && HEX64.test(sha256) ? [{ path: join(appRoot, ...bcnEntry.split("/")), sha256 }] : [];
  }
  const built = join(sourceRoot, "data", "tools", "xfs-bcn", "xfs_bcn.dll");
  const record = parse(readText(join(dirname(built), "xfs_bcn.json")));
  const recorded = typeof record?.sha256 === "string" && HEX64.test(record.sha256) ? record.sha256 : null;
  return [...env.XFS_BCN_LIBRARY ? [{ path: env.XFS_BCN_LIBRARY }] : [], { path: built, sha256: recorded }];
}
