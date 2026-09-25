import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILD_TOOLS_SCHEMA, builderEntry } from "./build";

// Only source code needed by the offline package builder is distributable here: one Bun
// bundle of the TypeScript builder, verifier and compiler. The eye plate is derived from the
// user's game at Build time; WolvenKit and the game are supplied locally. No Python.
const desktop = import.meta.dir;
const authoring = resolve(desktop, "..");
const output = resolve(desktop, "build-tools");
rmSync(output, { recursive: true, force: true });
mkdirSync(resolve(output, "app", "tools"), { recursive: true });
const result = await Bun.build({ entrypoints: [resolve(authoring, "tools", "build_collection_package.ts")], target: "bun" });
if (!result.success || result.outputs.length !== 1)
  throw Error(result.logs.map(String).join("\n") || "Could not bundle the package builder.");
writeFileSync(resolve(output, ...builderEntry.split("/")), await result.outputs[0].text());
const files = [builderEntry];
const sha256 = (file: string) => createHash("sha256").update(readFileSync(resolve(output, file))).digest("hex");
writeFileSync(resolve(output, "manifest.json"), JSON.stringify({ schema: BUILD_TOOLS_SCHEMA,
  files: Object.fromEntries(files.map(file => [file, sha256(file)])) }, null, 2) + "\n");
console.log(`Prepared ${files.length} asset-free desktop build tool.`);
