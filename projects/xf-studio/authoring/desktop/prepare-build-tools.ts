import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Only source code needed by the offline package builder is distributable here.
// Private plate/game resources and Python dependencies are supplied locally.
const desktop = import.meta.dir;
const authoring = resolve(desktop, "..");
const study = resolve(authoring, "../../../experiments/005-preset-collection");
const output = resolve(desktop, "build-tools");
rmSync(output, { recursive: true, force: true });
mkdirSync(resolve(output, "app", "tools"), { recursive: true });
mkdirSync(resolve(output, "study"), { recursive: true });
const files: string[] = [];
function copy(source: string, relative: string) {
  cpSync(source, resolve(output, relative));
  files.push(relative);
}
copy(resolve(authoring, "tools", "build_collection_package.py"), "build_collection_package.py");
for (const name of ["build.py", "verify.py", "mip_maps.py", "archive_inventory.py"])
  copy(resolve(study, name), `study/${name}`);
for (const [source, name] of [["validate_collection_build.ts", "preflight.js"],
  ["bake_collection.ts", "bake.js"]] as const) {
  const result = await Bun.build({ entrypoints: [resolve(authoring, "tools", source)], target: "bun" });
  if (!result.success || result.outputs.length !== 1)
    throw Error(result.logs.map(String).join("\n") || `Could not bundle ${source}.`);
  writeFileSync(resolve(output, "app", "tools", name), await result.outputs[0].text());
  files.push(`app/tools/${name}`);
}
const sha256 = (file: string) => createHash("sha256").update(readFileSync(resolve(output, file))).digest("hex");
writeFileSync(resolve(output, "manifest.json"), JSON.stringify({ schema: "xfs/desktop-build-tools-1",
  files: Object.fromEntries(files.map(file => [file, sha256(file)])) }, null, 2) + "\n");
console.log(`Prepared ${files.length} asset-free desktop build tools.`);
