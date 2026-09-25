// Derive the localhost 3D preview core from the configured game (Local setup, or the
// XFS_PACKAGE_GAMEPATH / XFS_PACKAGE_WOLVENKIT overrides) into the ignored preview cache.
// The localhost server serves it whenever public/assets has no prepared head.
//   bun tools/prepare-preview.ts
import { join, resolve } from "node:path";
import { createWolvenKitGameAssetExporter } from "../src/game-asset-export-wolvenkit";
import { packageToolPaths } from "../src/local-settings-readiness";
import { LocalSettingsStore } from "../src/local-settings-store";
import { localToolsRoot } from "../src/package-server";
import { WolvenKitSetupHost } from "../src/wolvenkit-setup-host";
import { ensurePreviewCore, PreviewCoreError } from "../src/preview-core-service";

const cacheRoot = resolve(process.env.XFS_PREVIEW_CORE_CACHE || resolve(import.meta.dir, "..", "data", "preview-cache"));
const settings = new LocalSettingsStore().load().settings;
const wolvenKit = new WolvenKitSetupHost({ root: localToolsRoot(), configured: () => process.env.XFS_PACKAGE_WOLVENKIT || settings.wolvenKitCli });
const tools = { ...packageToolPaths(settings), wolvenkit: wolvenKit.usable() };
if (!tools.gamepath || !tools.wolvenkit) {
  console.error(tools.gamepath ? wolvenKit.snapshot().message + " (bun tools/setup-wolvenkit.ts downloads it.)"
    : "Set the Cyberpunk 2077 folder in Local setup (or XFS_PACKAGE_GAMEPATH) first.");
  process.exit(2);
}
const started = Date.now();
try {
  const result = await ensurePreviewCore({ gameRoot: tools.gamepath, cacheRoot,
    exporter: createWolvenKitGameAssetExporter(join(cacheRoot, "exports"), tools.wolvenkit),
    progress: (_step, index, total, label) => console.log(`[${index + 1}/${total}] ${label}`) });
  console.log(`${result.reused ? "Reused" : "Prepared"} in ${((Date.now() - started) / 1000).toFixed(1)} s: ${result.directory}`);
  console.log(JSON.stringify(result.manifest.geometry));
} catch (error) {
  console.error(error instanceof PreviewCoreError ? `${error.code}: ${error.message}\n${error.detail}` : error);
  process.exit(1);
}
