import { basename, resolve } from "node:path";
import { existsSync, readdirSync, unlinkSync } from "node:fs";

// Every browser bundle served from public/build. Each public page's /build/<name>.js
// script must come from this list; tests/browser-build.test.ts enforces that.
// The desktop shell deliberately bundles only its distributable subset (desktop/prepare-static.ts).
export const browserEntries = [
  "src/studio-main.ts",
  "src/raster-worker.ts",
  "src/features/hair-lab/render/hair-worker.ts",
  "src/choice-preview-worker.ts",
  "src/render-fidelity-study.ts",
  "tools/glitter-head-study.ts",
].map(path => resolve(import.meta.dir, path));

export const browserBundleNames = browserEntries.map(path => basename(path).replace(/\.ts$/, ".js"));

export async function buildBrowser(outdir = resolve(import.meta.dir, "public", "build")) {
  // Remove only generated chunk files. Workers and studies retain self-contained bundles.
  if (existsSync(outdir)) for (const entry of readdirSync(outdir, { withFileTypes: true }))
    if (entry.isFile() && /^chunk-[\w-]+\.js(?:\.map)?$/.test(entry.name)) unlinkSync(resolve(outdir, entry.name));
  const main = await Bun.build({
    entrypoints: browserEntries.filter(path => basename(path) === "studio-main.ts"),
    outdir,
    target: "browser",
    splitting: true,
    sourcemap: "external",
    // Entries live in src/ and tools/; keep every bundle at /build/<name>.js.
    naming: "[name].[ext]",
  });
  const independent = await Bun.build({ entrypoints: browserEntries.filter(path => basename(path) !== "studio-main.ts"),
    outdir, target: "browser", splitting: false, sourcemap: "external", naming: "[name].[ext]" });
  return { success: main.success && independent.success, outputs: [...main.outputs, ...independent.outputs], logs: [...main.logs, ...independent.logs] };
}

if (import.meta.main) {
  const build = await buildBrowser();
  if (!build.success) {
    console.error(build.logs);
    process.exit(1);
  }
  console.log(`Built ${browserEntries.length} browser entries.`);
}
