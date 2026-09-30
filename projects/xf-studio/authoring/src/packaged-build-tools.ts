/**
 * The desktop app's packaged build tools, as the package builder sees them (PIPE-130). The desktop packages the builder bundle and XF
 * Studio's texture compressor below one folder with an integrity manifest (desktop/prepare-build-tools.ts) and runs the builder with
 * `--app-root <that folder>`. This module decides which compressor the builder may load: in a packaged run only the packaged copy, and
 * only when its bytes are the manifest's; in the source tree a developer's `XFS_BCN_LIBRARY`, then the one tools/build-native-bcn.ts
 * built into the ignored `data/tools/xfs-bcn`. Anything else is not loaded, and the Build imports textures with WolvenKit (the manifest's
 * `resourceWriters` says why).
 */
import { join } from "node:path";

/** The build-tools manifest's schema. */
export const BUILD_TOOLS_SCHEMA = "xfs/desktop-build-tools-2";
/** The builder bundle, below the build-tools folder. */
export const builderEntry = "app/tools/build.js";
/** The texture compressor, below the build-tools folder (optional: the builder falls back to WolvenKit without it). */
export const bcnEntry = "app/native/xfs_bcn.dll";

/** A compressor the builder may load, with the SHA-256 its bytes must have when it is the packaged copy. */
export type BcnCandidate = { readonly path: string; readonly sha256?: string };

/**
 * Where the builder looks for the compressor. `appRoot` is `--app-root` (the build-tools folder in the desktop app; the authoring folder
 * otherwise); `sourceRoot` is the authoring folder the builder's code came from. A packaged run is one whose app root holds the
 * build-tools manifest: it ignores `XFS_BCN_LIBRARY` (a developer's switch, like the `XFS_PACKAGE_*` overrides the desktop ignores) and
 * binds the packaged copy to the manifest's hash; a packaged manifest that doesn't list the compressor allows none.
 */
export function bcnCandidates(appRoot: string, sourceRoot: string, env: Readonly<Record<string, string | undefined>>,
  readText: (path: string) => string | null): BcnCandidate[] {
  const text = readText(join(appRoot, "manifest.json"));
  if (text !== null) {
    let manifest: { schema?: unknown; files?: Record<string, unknown> } | null = null;
    try { manifest = JSON.parse(text); } catch { manifest = null; }
    if (manifest?.schema === BUILD_TOOLS_SCHEMA) {
      const sha256 = manifest.files?.[bcnEntry];
      return typeof sha256 === "string" && /^[0-9a-f]{64}$/.test(sha256) ? [{ path: join(appRoot, ...bcnEntry.split("/")), sha256 }] : [];
    }
  }
  return [...env.XFS_BCN_LIBRARY ? [{ path: env.XFS_BCN_LIBRARY }] : [], { path: join(sourceRoot, "data", "tools", "xfs-bcn", "xfs_bcn.dll") }];
}
