// Assembles the install layout as an MO2-style mod folder and zips it into the ignored dist/.
// It never installs anything: the output stays under projects/xf-runtime-bridge/dist/.
//
//   bun tools/package.ts            -> dist/xf-runtime-bridge-<version>.zip             (bridge off)
//                                      dist/xf-runtime-bridge-<version>-diagnostic.zip  (bridge on, read-only)
//                                      dist/xf-runtime-bridge-<version>-writes.zip      (bridge on, writes allowed;
//                                                                                        the XF test profile only)
//
// What each package holds is tools/packaging.ts (tested by tools/test/package.test.ts). This file adds
// the provenance gate and the zips: it refuses to package unless the project tree is clean and the DLL
// was built from HEAD with a clean tree: the build writes "XFB_BUILD=<commit>;dirty=<0|1>" into the
// DLL (native/cmake/BuildInfo.cmake), and the manifest records that commit.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { DESCRIBE, SUFFIX, VARIANTS, sha256, stageVariant, type Variant } from "./packaging.ts";

const projectDir = resolve(import.meta.dir, "..");
const cmake = readFileSync(join(projectDir, "native", "CMakeLists.txt"), "utf8");
const version = /project\(\s*XFRuntimeBridge\s+VERSION\s+([0-9.]+)/m.exec(cmake)?.[1];
if (!version) throw new Error("could not read the version from native/CMakeLists.txt");

const dll = join(projectDir, "build", "Release", "XFRuntimeBridge.dll");
if (!existsSync(dll)) {
  console.error(`missing ${dll}; build first (see README)`);
  process.exit(2);
}

const git = (...args: string[]) => {
  const result = spawnSync("git", args, { cwd: projectDir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
};

// Provenance gate: package only committed source, and only a DLL built from exactly that commit.
const head = git("rev-parse", "HEAD");
const dirtyFiles = git("status", "--porcelain", "--", ".");
if (dirtyFiles) {
  console.error(`refusing to package: projects/xf-runtime-bridge has uncommitted changes:\n${dirtyFiles}`);
  process.exit(3);
}
const marker = /XFB_BUILD=([0-9a-f]{40}|unknown);dirty=([01])/.exec(readFileSync(dll).toString("latin1"));
if (!marker) {
  console.error(`refusing to package: ${dll} carries no build marker; rebuild it`);
  process.exit(3);
}
const [, builtCommit, builtDirty] = marker;
if (builtDirty !== "0" || builtCommit !== head) {
  console.error(
    `refusing to package: the DLL was built from ${builtCommit}${builtDirty === "1" ? " with uncommitted changes" : ""}, ` +
      `but HEAD is ${head}. Rebuild from the clean tree: cmake --build build --config Release`,
  );
  process.exit(3);
}

function build(variant: Variant) {
  const stageDir = join(projectDir, "dist", "stage", variant);
  const manifest = stageVariant({ projectDir, variant, dll, stageDir, version: version!, commit: builtCommit });
  const zip = join(projectDir, "dist", `xf-runtime-bridge-${version}${SUFFIX[variant]}.zip`);
  rmSync(zip, { force: true });
  // Windows' own bsdtar (not Git's GNU tar) writes a zip when the name ends in .zip and -a is given.
  const tarExe = join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe");
  // Name the top-level folders explicitly so entries carry no "./" prefix.
  const tar = spawnSync(tarExe, ["-a", "-c", "-f", zip, "-C", stageDir, "bin", "r6", "red4ext"], { encoding: "utf8" });
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
  console.log(`${zip}\n  sha256 ${sha256(zip)}  (${manifest.files.length} files, ${DESCRIBE[variant]})`);
  for (const file of manifest.files) console.log(`  ${file.sha256.slice(0, 16)}  ${file.path}`);
}

for (const variant of VARIANTS) build(variant);
console.log("\nNothing was installed. Stage a zip into a dedicated MO2 profile only when a session is prepared; the -writes zip only into the XF test profile.");
