import { basename, resolve } from "node:path";

// Every browser bundle served from public/build. Each public page's /build/<name>.js
// script must come from this list; tests/browser-build.test.ts enforces that.
// The desktop shell deliberately bundles only its distributable subset (desktop/prepare-static.ts).
export const browserEntries = [
  "src/studio-main.ts",
  "src/raster-worker.ts",
  "src/render-fidelity-study.ts",
  "tools/glitter-head-study.ts",
].map(path => resolve(import.meta.dir, path));

export const browserBundleNames = browserEntries.map(path => basename(path).replace(/\.ts$/, ".js"));

export async function buildBrowser(outdir = resolve(import.meta.dir, "public", "build")) {
  return Bun.build({
    entrypoints: browserEntries,
    outdir,
    target: "browser",
    sourcemap: "external",
    // Entries live in src/ and tools/; keep every bundle at /build/<name>.js.
    naming: "[name].[ext]",
  });
}

if (import.meta.main) {
  const build = await buildBrowser();
  if (!build.success) {
    console.error(build.logs);
    process.exit(1);
  }
  console.log(`Built ${browserEntries.length} browser entries.`);
}
