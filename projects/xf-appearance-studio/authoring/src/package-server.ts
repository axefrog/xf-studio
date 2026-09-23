import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { parseCollection, planCollection } from "./preset-collection";
import type { PackageAction, PackageBuild, PackageCheck } from "./package-action";

const app = resolve(import.meta.dir, "..");
const hq = resolve(app, "../../..");
const project = resolve(app, "..");
const dist = resolve(project, "dist");
const script = resolve(app, "tools/build_collection_package.py");
const maxBytes = 16_000_000;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const within = (path: string, root: string) => path.startsWith(root + sep);

export type PackageTools = { python: string; bun: string; plate: string; wolvenkit: string; gamepath: string };
export function localPackageTools(): PackageTools {
  return {
    python: process.env.XFS_PACKAGE_PYTHON || (process.platform === "win32" ? "python" : "python3"),
    bun: process.execPath,
    plate: process.env.XFS_PACKAGE_PLATE || resolve(hq, "experiments/004-plate-import/generated/archive/axefrog/appearance_studio/studies"),
    wolvenkit: process.env.XFS_PACKAGE_WOLVENKIT || "F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe",
    gamepath: process.env.XFS_PACKAGE_GAMEPATH || "F:/Games/Cyberpunk 2077",
  };
}

async function tail(stream: ReadableStream<Uint8Array> | null, limit = 64_000): Promise<string> {
  if (!stream) return "";
  let result = "";
  for await (const chunk of stream) result = (result + new TextDecoder().decode(chunk)).slice(-limit);
  return result;
}

export async function runLocalPackage(action: PackageAction, file: string, tools: PackageTools): Promise<PackageCheck | PackageBuild> {
  if (action === "build") {
    for (const [name, path, kind] of [["Plate", tools.plate, "directory"], ["WolvenKit", tools.wolvenkit, "file"],
      ["Game", tools.gamepath, "directory"]] as const) {
      let valid = false;
      try { const stat = statSync(path); valid = kind === "file" ? stat.isFile() : stat.isDirectory(); } catch { /* Missing local tool. */ }
      if (!valid) throw Error(`${name} input is unavailable at ${path}. Configure the local studio server's XFS_PACKAGE_${name === "Plate" ? "PLATE" : name === "Game" ? "GAMEPATH" : "WOLVENKIT"} setting.`);
    }
  }
  const args = [tools.python, script, "--collection", file, "--bun", tools.bun, "--machine-result",
    ...(action === "check" ? ["--check"] : ["--plate", tools.plate, "--wolvenkit", tools.wolvenkit, "--gamepath", tools.gamepath])];
  const process = Bun.spawn(args, { cwd: hq, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([tail(process.stdout), tail(process.stderr), process.exited]);
  if (code !== 0) throw Error(stderr.trim().slice(-3000) || `Package ${action} failed (exit ${code}).`);
  const line = stdout.split(/\r?\n/).reverse().find(value => value.startsWith("XFS_PACKAGE_RESULT="));
  if (!line) throw Error("Package tool completed without a result.");
  return JSON.parse(line.slice("XFS_PACKAGE_RESULT=".length));
}

type Runner = (action: PackageAction, file: string, tools: PackageTools) => Promise<PackageCheck | PackageBuild>;
/** One active build per server; requests carry only a validated collection snapshot. */
export function createPackageHandler(tools = localPackageTools(), runner: Runner = runLocalPackage) {
  let building = false;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1" || request.headers.get("Origin") !== url.origin ||
        request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
      return json({ error: "Use the local studio to build packages." }, 403);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (Number(request.headers.get("Content-Length")) > maxBytes) return json({ error: "Collection exceeds 16 MB." }, 413);
    let body: string;
    try { body = await request.text(); } catch { return json({ error: "Could not read collection snapshot." }, 400); }
    if (Buffer.byteLength(body) > maxBytes) return json({ error: "Collection exceeds 16 MB." }, 413);
    let action: PackageAction, collection;
    try {
      const input = JSON.parse(body);
      if (!input || (input.action !== "check" && input.action !== "build") || Object.keys(input).some(key => key !== "action" && key !== "collection"))
        throw Error("Expected a package action and collection only.");
      action = input.action;
      collection = parseCollection(input.collection);
    } catch (error) { return json({ error: (error as Error).message }, 400); }
    if (building) return json({ error: "A local package build is already running. Wait for its result before starting another." }, 409);
    const plan = planCollection(collection);
    const source = JSON.stringify(collection);
    const sourceHash = createHash("sha256").update(source).digest("hex");
    const work = mkdtempSync(resolve(tmpdir(), "xfs-ui-package-"));
    const file = resolve(work, "collection.json");
    writeFileSync(file, source);
    if (action === "build") building = true;
    try {
      const result = await runner(action, file, tools);
      if (action === "check") {
        const checked = result as PackageCheck;
        if (checked.ready !== true || checked.collectionId !== collection.id || checked.namespace !== plan.namespace ||
            JSON.stringify(checked.presets) !== JSON.stringify(plan.presets.map(p =>
              ({ id: p.id, revision: p.revision, appearance: p.appearance }))))
          throw Error("Package preflight returned a different collection identity.");
        return json(checked);
      }
      const built = result as PackageBuild;
      const final = resolve(built.package ?? ""), manifestPath = resolve(built.manifest ?? "");
      if (!within(final, dist) || manifestPath !== resolve(final, "manifest.json") || !statSync(manifestPath).isFile())
        throw Error("Package result is outside the local dist directory.");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.schema !== "xfs/local-package-1" || manifest.collectionId !== collection.id ||
          manifest.collectionSha256 !== sourceHash || manifest.namespace !== plan.namespace ||
          JSON.stringify(manifest.presets) !== JSON.stringify(plan.presets.map(p =>
            ({ id: p.id, revision: p.revision, appearance: p.appearance }))) ||
          built.archiveSha256 !== manifest.files?.[0]?.sha256 || built.presetCount !== collection.presets.length ||
          built.installed !== false || built.gameRenderingVerified !== false)
        throw Error("Package manifest does not match this collection snapshot.");
      return json(built);
    } catch (error) {
      console.error("Local package action failed:", (error as Error).message);
      return json({ error: (error as Error).message }, 422);
    } finally {
      if (action === "build") building = false;
      rmSync(work, { recursive: true, force: true });
    }
  };
}
