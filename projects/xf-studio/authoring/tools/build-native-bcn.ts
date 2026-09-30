/**
 * Builds XF Studio's texture compressor, `xfs_bcn.dll` (native/bcn: a C entry point over DirectXTex's encoders), for the native resource
 * writer (PIPE-130). One script for every build of it: a developer's localhost Builds, the desktop app's `prepare-build-tools.ts` (local
 * `build:dev`/`build:canary`) and CI's Windows runner.
 *
 * The DirectXTex source is pinned (`native/bcn/directxtex.json`: release, URL, SHA-256): the script takes the release ZIP from `--zip` or
 * `XFS_DIRECTXTEX_ZIP`, or downloads it from the pinned GitHub URL, and refuses any other bytes. It needs CMake, Visual Studio's C++ tools
 * (2022 or later, found with vswhere) and the Windows SDK's `fxc.exe` (DirectXTex's BC7 compute shaders are compiled with it). Everything
 * runs hidden; the build tree is the ignored `build/xfs-bcn`. Compiler and linker run with `/Brepro`, so the same inputs and toolset give
 * the same bytes.
 *
 *   bun tools/build-native-bcn.ts [--zip <DirectXTex release ZIP>] [--out <folder>] [--force]
 *
 * The library lands in `--out` (default: the ignored `data/tools/xfs-bcn`, where localhost Builds look for it) with `xfs_bcn.json`
 * recording its SHA-256, the DirectXTex release and ZIP hash, the toolset and a key over every input. When that record's key and hash
 * already match, nothing is rebuilt. It needs nothing beyond Windows at run time (static C runtime, no OpenMP).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { BCN_LIBRARY_VERSION, checkBcnLibrary, loadBcnLibrary } from "../src/native/write/bcn";

const app = resolve(import.meta.dir, "..");
const sourceDir = join(app, "native", "bcn");
/** The pinned DirectXTex source release. */
export const DIRECTXTEX: { release: string; url: string; sha256: string; folder: string; licence: string } =
  JSON.parse(readFileSync(join(sourceDir, "directxtex.json"), "utf8"));
/** Bump when this script's build recipe changes in a way that changes the library. */
const RECIPE = 2;
export const BCN_DEFAULT_OUT = join(app, "data", "tools", "xfs-bcn");
export type BcnBuildRecord = { contract: number; sha256: string; directxtex: string; directxtexSha256: string; inputs: string;
  toolset: string; generator: string };

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const run = (command: string, argv: string[], options: { cwd?: string; env?: Record<string, string> } = {}) => {
  const result = spawnSync(command, argv, { cwd: options.cwd, env: { ...process.env, ...options.env }, encoding: "utf8", windowsHide: true, maxBuffer: 64 << 20 });
  if (result.status !== 0) throw Error(`${basename(command)} ${argv.join(" ")} failed (${result.status ?? result.error?.message}):\n${(result.stdout ?? "").slice(-3000)}\n${(result.stderr ?? "").slice(-2000)}`);
  return result.stdout;
};

/** Every input that decides the library's bytes (besides the toolset, which the record names). */
export function bcnInputsKey(): string {
  return sha256([`recipe ${RECIPE}`, `contract ${BCN_LIBRARY_VERSION}`, `directxtex ${DIRECTXTEX.sha256}`,
    ...["xfs_bcn.cpp", "CMakeLists.txt"].map(name => `${name} ${sha256(readFileSync(join(sourceDir, name)))}`)].join("\n"));
}

/** The built library's record in `out`, when it matches the current inputs and the DLL beside it. */
export function currentBcnBuild(out = BCN_DEFAULT_OUT): BcnBuildRecord | null {
  try {
    const record: BcnBuildRecord = JSON.parse(readFileSync(join(out, "xfs_bcn.json"), "utf8"));
    return record.inputs === bcnInputsKey() && record.contract === BCN_LIBRARY_VERSION &&
      sha256(readFileSync(join(out, "xfs_bcn.dll"))) === record.sha256 ? record : null;
  } catch { return null; }
}

/** The newest x64 `fxc.exe` of the Windows 10/11 SDK, or `XFS_FXC`. */
function findFxc(): string {
  if (process.env.XFS_FXC) return process.env.XFS_FXC;
  const bin = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  const versions = existsSync(bin) ? readdirSync(bin).filter(name => /^10\.\d+\.\d+\.\d+$/.test(name)).sort((a, b) =>
    a.split(".").map(Number).reduce((order, part, i) => order || part - Number(b.split(".")[i]), 0)) : [];
  for (const version of versions.reverse()) { const fxc = join(bin, version, "x64", "fxc.exe"); if (existsSync(fxc)) return fxc; }
  throw Error("The Windows SDK's fxc.exe was not found; install the Windows SDK or set XFS_FXC.");
}

/** CMake's generator for the newest Visual Studio with the x64 C++ tools (vswhere), or `XFS_CMAKE_GENERATOR`. */
function findGenerator(): string {
  if (process.env.XFS_CMAKE_GENERATOR) return process.env.XFS_CMAKE_GENERATOR;
  const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!existsSync(vswhere)) throw Error("Visual Studio's C++ tools were not found (no vswhere.exe); install Visual Studio 2022 or later with the C++ workload.");
  const found = run(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property", "installationVersion"]).trim();
  const major = Number(found.split(".")[0]);
  const names: Record<number, string> = { 17: "Visual Studio 17 2022", 18: "Visual Studio 18 2026" };
  if (!names[major]) throw Error(`No supported Visual Studio with the x64 C++ tools was found (vswhere: "${found}"); set XFS_CMAKE_GENERATOR.`);
  return names[major];
}

/** The pinned DirectXTex ZIP's bytes: the given file, else a cached or fresh download; refused unless its SHA-256 is the pinned one. */
async function directXTexZip(zip: string | undefined, cache: string): Promise<string> {
  const check = (path: string) => {
    const hash = sha256(readFileSync(path));
    if (hash !== DIRECTXTEX.sha256) throw Error(`${path} is not DirectXTex ${DIRECTXTEX.release} (SHA-256 ${hash}, expected ${DIRECTXTEX.sha256}).`);
    return path;
  };
  if (zip) return check(resolve(zip));
  const cached = join(cache, `DirectXTex-${DIRECTXTEX.release}.zip`);
  if (existsSync(cached)) { try { return check(cached); } catch { rmSync(cached, { force: true }); } }
  console.log(`Downloading DirectXTex ${DIRECTXTEX.release} from ${DIRECTXTEX.url}…`);
  const response = await fetch(DIRECTXTEX.url);
  if (!response.ok) throw Error(`Could not download DirectXTex ${DIRECTXTEX.release}: HTTP ${response.status}.`);
  mkdirSync(cache, { recursive: true });
  writeFileSync(cached, new Uint8Array(await response.arrayBuffer()));
  return check(cached);
}

/** Windows' own bsdtar reads ZIPs; a GNU tar earlier on PATH (Git's usr/bin) cannot. */
const tar = () => {
  const system = process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "tar.exe") : "";
  return system && existsSync(system) ? system : "tar";
};

/**
 * Build `xfs_bcn.dll` into `out` (or keep the one there when its record matches the current inputs), load it and compress one BC4 block
 * with it. Returns the record.
 */
export async function ensureBcnLibrary(options: { zip?: string; out?: string; force?: boolean; log?: (line: string) => void } = {}): Promise<BcnBuildRecord> {
  const out = resolve(options.out ?? BCN_DEFAULT_OUT), log = options.log ?? console.log;
  if (process.platform !== "win32") throw Error("XF Studio's texture compressor is built on Windows only.");
  const current = options.force ? null : currentBcnBuild(out);
  if (current) { log(`xfs_bcn.dll is up to date (SHA-256 ${current.sha256}).`); return current; }
  const build = join(app, "build", "xfs-bcn");
  const zip = await directXTexZip(options.zip ?? process.env.XFS_DIRECTXTEX_ZIP, join(build, "download"));
  for (const dir of ["source", "shaders", "cmake"]) rmSync(join(build, dir), { recursive: true, force: true });
  mkdirSync(join(build, "source"), { recursive: true });
  mkdirSync(join(build, "shaders"), { recursive: true });
  run(tar(), ["-xf", zip, "-C", join(build, "source")]);
  const directxtex = join(build, "source", DIRECTXTEX.folder);
  if (!existsSync(join(directxtex, "DirectXTex", "BC6HBC7.cpp"))) throw Error(`The DirectXTex ZIP does not hold ${DIRECTXTEX.folder}/DirectXTex.`);
  log("Compiling DirectXTex's compute shaders…");
  // By full path: the current folder may be off the command search path (NoDefaultCurrentDirectoryInExePath).
  const shaders = join(directxtex, "DirectXTex", "Shaders");
  run("cmd.exe", ["/d", "/c", join(shaders, "CompileShaders.cmd")], { cwd: shaders,
    env: { LegacyShaderCompiler: findFxc(), CompileShadersOutput: join(build, "shaders") } });
  const generator = findGenerator();
  log(`Configuring and building xfs_bcn.dll (${generator})…`);
  run("cmake", ["-S", sourceDir, "-B", join(build, "cmake"), "-G", generator, "-A", "x64",
    `-DDIRECTXTEX_DIR=${directxtex.replaceAll("\\", "/")}`, "-DUSE_PREBUILT_SHADERS=ON", `-DCOMPILED_SHADERS=${join(build, "shaders").replaceAll("\\", "/")}`]);
  run("cmake", ["--build", join(build, "cmake"), "--config", "Release", "--target", "xfs_bcn"]);
  // The compiler CMake identified (CMakeFiles/<cmake version>/CMakeCXXCompiler.cmake).
  const files = join(build, "cmake", "CMakeFiles");
  const toolset = readdirSync(files).map(name => join(files, name, "CMakeCXXCompiler.cmake")).filter(path => existsSync(path))
    .map(path => /set\(CMAKE_CXX_COMPILER_VERSION "([^"]+)"\)/.exec(readFileSync(path, "utf8"))?.[1]).find(Boolean) ?? "unknown";
  mkdirSync(out, { recursive: true });
  const target = join(out, "xfs_bcn.dll");
  copyFileSync(join(build, "cmake", "Release", "xfs_bcn.dll"), target);
  const library = loadBcnLibrary(target);
  try { checkBcnLibrary(library); } finally { library.close(); }
  const record: BcnBuildRecord = { contract: BCN_LIBRARY_VERSION, sha256: sha256(readFileSync(target)), directxtex: DIRECTXTEX.release,
    directxtexSha256: DIRECTXTEX.sha256, inputs: bcnInputsKey(), toolset: `MSVC ${toolset}`, generator };
  writeFileSync(join(out, "xfs_bcn.json"), JSON.stringify(record, null, 2) + "\n");
  log(`Built ${target} (SHA-256 ${record.sha256}; DirectXTex ${DIRECTXTEX.release}, MSVC ${toolset}).`);
  return record;
}

if (import.meta.main) {
  const args = new Map<string, string>();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--force") { args.set("--force", "1"); continue; }
    if (!["--zip", "--out"].includes(argv[i]!) || i + 1 >= argv.length)
      throw Error("Usage: bun tools/build-native-bcn.ts [--zip <DirectXTex release ZIP>] [--out <folder>] [--force]");
    args.set(argv[i]!, argv[++i]!);
  }
  await ensureBcnLibrary({ zip: args.get("--zip"), out: args.get("--out"), force: args.has("--force") });
}
