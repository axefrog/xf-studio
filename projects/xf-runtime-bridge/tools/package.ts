// Assembles the install layout as an MO2-style mod folder and zips it into the ignored dist/.
// It never installs anything: the output stays under projects/xf-runtime-bridge/dist/.
//
//   bun tools/package.ts            -> dist/xf-runtime-bridge-<version>.zip             (bridge off)
//                                      dist/xf-runtime-bridge-<version>-diagnostic.zip  (bridge on, read-only)
//
// Layout inside each zip (paths relative to the game folder, i.e. an MO2 mod root):
//   red4ext/plugins/XFRuntimeBridge/XFRuntimeBridge.dll
//   red4ext/plugins/XFRuntimeBridge/config.ini
//   red4ext/plugins/XFRuntimeBridge/Scripts/*.reds       (added to redscript by the plugin)
//   r6/tweaks/XFRuntimeBridge/xf_runtime_bridge.yaml     (TweakXL)
//   bin/x64/plugins/cyber_engine_tweaks/mods/xf_runtime_bridge/init.lua   (CET)
//   red4ext/plugins/XFRuntimeBridge/THIRD_PARTY_NOTICES.txt  (nlohmann/json and RED4ext.SDK, MIT)
//   red4ext/plugins/XFRuntimeBridge/manifest.json        (versions and SHA-256 of every other file)
//
// It refuses to package unless the project tree is clean and the DLL was built from HEAD with a
// clean tree: the build writes "XFB_BUILD=<commit>;dirty=<0|1>" into the DLL
// (native/cmake/BuildInfo.cmake), and the manifest records that commit.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectDir = resolve(import.meta.dir, "..");
const cmake = readFileSync(join(projectDir, "native", "CMakeLists.txt"), "utf8");
const version = /project\(\s*XFRuntimeBridge\s+VERSION\s+([0-9.]+)/m.exec(cmake)?.[1];
if (!version) throw new Error("could not read the version from native/CMakeLists.txt");

const dll = join(projectDir, "build", "Release", "XFRuntimeBridge.dll");
if (!existsSync(dll)) {
  console.error(`missing ${dll}; build first (see README)`);
  process.exit(2);
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
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
const notices = join(projectDir, "native", "THIRD_PARTY_NOTICES.txt");

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}

function stage(variant: "default" | "diagnostic") {
  const stageDir = join(projectDir, "dist", "stage", variant);
  rmSync(stageDir, { recursive: true, force: true });
  const put = (from: string, to: string) => {
    const target = join(stageDir, to);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(from, target);
  };

  const plugin = "red4ext/plugins/XFRuntimeBridge";
  put(dll, `${plugin}/XFRuntimeBridge.dll`);
  put(notices, `${plugin}/THIRD_PARTY_NOTICES.txt`);
  let config = readFileSync(join(projectDir, "native", "config", "config.ini"), "utf8");
  if (variant === "diagnostic") {
    config = config.replace(/^enabled = false$/m, "enabled = true");
    if (!/^enabled = true$/m.test(config)) throw new Error("diagnostic config did not enable the bridge");
  }
  mkdirSync(join(stageDir, plugin), { recursive: true });
  writeFileSync(join(stageDir, plugin, "config.ini"), config);
  for (const name of readdirSync(join(projectDir, "redscript"))) {
    if (name.endsWith(".reds")) put(join(projectDir, "redscript", name), `${plugin}/Scripts/${name}`);
  }
  put(join(projectDir, "tweaks", "xf_runtime_bridge.yaml"), "r6/tweaks/XFRuntimeBridge/xf_runtime_bridge.yaml");
  put(
    join(projectDir, "cet", "xf_runtime_bridge", "init.lua"),
    "bin/x64/plugins/cyber_engine_tweaks/mods/xf_runtime_bridge/init.lua",
  );

  const files = listFiles(stageDir).map((path) => ({
    path: relative(stageDir, path).replaceAll("\\", "/"),
    bytes: statSync(path).size,
    sha256: sha256(path),
  }));
  const manifest = {
    name: "XF Runtime Bridge",
    version,
    variant,
    bridge_enabled: variant === "diagnostic",
    allow_writes: false,
    commit: builtCommit, // read from the DLL's build marker; equals HEAD at packaging time
    source_tree_clean: true,
    built_for: {
      game: "2.31 (3.0.80.51928)",
      red4ext: "1.30.0 (SDK 1.0.0)",
      redscript: "0.5.31",
      cet: "1.37.1",
      tweakxl: "1.11.4 (optional; only the data marker needs it)",
    },
    files,
  };
  writeFileSync(join(stageDir, plugin, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const suffix = variant === "diagnostic" ? "-diagnostic" : "";
  const zip = join(projectDir, "dist", `xf-runtime-bridge-${version}${suffix}.zip`);
  rmSync(zip, { force: true });
  // Windows' own bsdtar (not Git's GNU tar) writes a zip when the name ends in .zip and -a is given.
  const tarExe = join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe");
  // Name the top-level folders explicitly so entries carry no "./" prefix.
  const tar = spawnSync(tarExe, ["-a", "-c", "-f", zip, "-C", stageDir, "bin", "r6", "red4ext"], { encoding: "utf8" });
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
  console.log(`${zip}\n  sha256 ${sha256(zip)}  (${files.length} files, bridge ${variant === "diagnostic" ? "ON (read-only)" : "OFF"})`);
  for (const file of files) console.log(`  ${file.sha256.slice(0, 16)}  ${file.path}`);
}

stage("default");
stage("diagnostic");
console.log("\nNothing was installed. Stage these zips into a dedicated MO2 profile only when a session is prepared.");
