import { basename, resolve } from "node:path";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

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

const isChunk = (name: string) => /^chunk-[\w-]+\.js(?:\.map)?$/.test(name);

/**
 * Prune generated chunk files after a successful build, keeping the previous generation for one more build, so a page that is
 * already open can still load a lazy feature after a rebuild. Workers and studies keep self-contained bundles and are never pruned.
 */
export function retainBrowserChunks(outdir: string, current: readonly string[]) {
  const manifest = resolve(outdir, ".chunk-generations.json");
  const existing = readdirSync(outdir, { withFileTypes: true }).filter(entry => entry.isFile() && isChunk(entry.name)).map(entry => entry.name);
  let previous: string[] = existing;
  if (existsSync(manifest)) try {
    const value = JSON.parse(readFileSync(manifest, "utf8"));
    if (Array.isArray(value.current)) previous = value.current.filter((name: unknown): name is string => typeof name === "string" && isChunk(name));
  } catch { /* Retaining extra chunks for one cycle is safe after an interrupted manifest write. */ }
  const keep = new Set([...current, ...previous]);
  for (const name of existing) if (!keep.has(name)) unlinkSync(resolve(outdir, name));
  writeFileSync(manifest, JSON.stringify({ current: [...current], previous }));
}

export async function buildBrowser(outdir = resolve(import.meta.dir, "public", "build")) {
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
  if (main.success && independent.success) retainBrowserChunks(outdir, main.outputs.map(output => basename(output.path)).filter(isChunk));
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
