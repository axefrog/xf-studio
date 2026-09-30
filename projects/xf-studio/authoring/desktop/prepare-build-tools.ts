import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILD_TOOLS_SCHEMA, bcnEntry, builderEntry } from "./build";
import { BCN_DEFAULT_OUT, ensureBcnLibrary } from "../tools/build-native-bcn";

// Only what the offline package builder needs is distributable here: one Bun bundle of the TypeScript builder, verifier and
// compiler, and XF Studio's texture compressor (xfs_bcn.dll, built from the pinned DirectXTex source by the same script localhost
// uses: tools/build-native-bcn.ts). The eye plate is derived from the user's game at Build time; WolvenKit and the game are
// supplied locally. No Python.
//
// The compressor is required: a machine that can't build it (no Visual Studio C++ tools, CMake or Windows SDK) stops here with
// the reason. `XFS_BCN=skip` packages the builder alone; its Builds then import textures with WolvenKit (a few seconds slower) and
// say so in the manifest's resourceWriters. The canary gate (verify-canary.ts) refuses a build without it.
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
if (process.env.XFS_BCN === "skip") console.log("XFS_BCN=skip: packaging without the texture compressor (Builds import textures with WolvenKit).");
else {
  await ensureBcnLibrary({ log: line => console.log(line) });
  mkdirSync(resolve(output, "app", "native"), { recursive: true });
  copyFileSync(resolve(BCN_DEFAULT_OUT, "xfs_bcn.dll"), resolve(output, ...bcnEntry.split("/")));
  files.push(bcnEntry);
}
const sha256 = (file: string) => createHash("sha256").update(readFileSync(resolve(output, file))).digest("hex");
writeFileSync(resolve(output, "manifest.json"), JSON.stringify({ schema: BUILD_TOOLS_SCHEMA,
  files: Object.fromEntries(files.map(file => [file, sha256(file)])) }, null, 2) + "\n");
console.log(`Prepared ${files.length} asset-free desktop build tool${files.length === 1 ? "" : "s"}: ${files.join(", ")}.`);
