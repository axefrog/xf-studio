/**
 * Builds XF Studio's texture compressor, `xfs_bcn.dll` (native/bcn: a C entry point over DirectXTex's encoders), from an official
 * DirectXTex source release, for the native resource writer (PIPE-130). Needs CMake, Visual Studio 2022's C++ tools and the Windows SDK's
 * `fxc.exe` (DirectXTex's BC7 compute shaders are compiled with it). Everything runs hidden; the build tree is the ignored `build/xfs-bcn`.
 *
 *   bun tools/build-native-bcn.ts --directxtex <DirectXTex source release folder> [--out <folder>]
 *
 * The library lands in `--out` (default: the ignored `data/tools/xfs-bcn`, where localhost Builds look for it) with `xfs_bcn.json`
 * recording its SHA-256 and the DirectXTex release it was built from. It needs nothing beyond Windows (static C runtime, no OpenMP).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { BCN_LIBRARY_VERSION, loadBcnLibrary } from "../src/native/write/bcn";

const app = resolve(import.meta.dir, "..");
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!, process.argv[i + 1] ?? "");
const directxtex = args.get("--directxtex");
if (!directxtex || !existsSync(join(directxtex, "DirectXTex", "BC6HBC7.cpp")))
  throw Error("Usage: bun tools/build-native-bcn.ts --directxtex <DirectXTex source release folder> [--out <folder>]");
const out = resolve(args.get("--out") || join(app, "data", "tools", "xfs-bcn"));
const build = join(app, "build", "xfs-bcn");

/** The newest x64 `fxc.exe` of the Windows 10/11 SDK, or `XFS_FXC`. */
function findFxc(): string {
  if (process.env.XFS_FXC) return process.env.XFS_FXC;
  const bin = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  const versions = existsSync(bin) ? readdirSync(bin).filter(name => /^10\.\d+\.\d+\.\d+$/.test(name)).sort((a, b) =>
    a.split(".").map(Number).reduce((order, part, i) => order || part - Number(b.split(".")[i]), 0)) : [];
  for (const version of versions.reverse()) { const fxc = join(bin, version, "x64", "fxc.exe"); if (existsSync(fxc)) return fxc; }
  throw Error("The Windows SDK's fxc.exe was not found; install the Windows SDK or set XFS_FXC.");
}

const run = (command: string, argv: string[], options: { cwd?: string; env?: Record<string, string> } = {}) => {
  const result = spawnSync(command, argv, { cwd: options.cwd, env: { ...process.env, ...options.env }, encoding: "utf8", windowsHide: true, maxBuffer: 64 << 20 });
  if (result.status !== 0) throw Error(`${basename(command)} ${argv.join(" ")} failed (${result.status}):\n${(result.stdout ?? "").slice(-3000)}\n${(result.stderr ?? "").slice(-2000)}`);
  return result.stdout;
};

rmSync(build, { recursive: true, force: true });
mkdirSync(join(build, "shaders"), { recursive: true });
console.log("Compiling DirectXTex's compute shaders…");
// By full path: the current folder may be off the command search path (NoDefaultCurrentDirectoryInExePath).
const shaders = resolve(directxtex, "DirectXTex", "Shaders");
run("cmd.exe", ["/d", "/c", join(shaders, "CompileShaders.cmd")], { cwd: shaders,
  env: { LegacyShaderCompiler: findFxc(), CompileShadersOutput: join(build, "shaders") } });
console.log("Configuring and building xfs_bcn.dll…");
run("cmake", ["-S", join(app, "native", "bcn"), "-B", join(build, "cmake"), "-G", "Visual Studio 17 2022", "-A", "x64",
  `-DDIRECTXTEX_DIR=${resolve(directxtex)}`, "-DUSE_PREBUILT_SHADERS=ON", `-DCOMPILED_SHADERS=${join(build, "shaders").replaceAll("\\", "/")}`]);
run("cmake", ["--build", join(build, "cmake"), "--config", "Release", "--target", "xfs_bcn"]);
const built = join(build, "cmake", "Release", "xfs_bcn.dll");
mkdirSync(out, { recursive: true });
const target = join(out, "xfs_bcn.dll");
copyFileSync(built, target);
const library = loadBcnLibrary(target);
library.close();
const sha256 = createHash("sha256").update(readFileSync(target)).digest("hex");
writeFileSync(join(out, "xfs_bcn.json"), JSON.stringify({ contract: BCN_LIBRARY_VERSION, sha256, directxtex: basename(resolve(directxtex)),
  built: new Date().toISOString() }, null, 2) + "\n");
console.log(`Built ${target} (SHA-256 ${sha256}).`);
