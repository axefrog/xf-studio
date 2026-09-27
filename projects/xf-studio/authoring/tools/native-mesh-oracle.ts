/**
 * Oracle for the native mesh reader (R&D; read-only towards the game, mods and caches): decodes meshes and morph targets natively
 * (src/native/mesh-glb.ts) and compares the GLB with WolvenKit's export of the same resource, value for value.
 *
 *   bun tools/native-mesh-oracle.ts --game <game folder> [--mods <MO2 mods folder>] --exports <export cache resources folder>
 *     [--filter <regex on depot paths>] [--limit N] [--report <file>] [--verbose]
 *   bun tools/native-mesh-oracle.ts --game <game folder> --fresh <archive> --paths <file: one depot path per line> --out <folder>
 *     --wolvenkit <WolvenKit.CLI.exe> (or XFS_WOLVENKIT_CLI)   (exports those resources with WolvenKit now, then compares)
 *
 * The export cache (a preview cache's `exports/resources`) holds, per exported resource, the extracted file (`raw`) and WolvenKit's GLB
 * (`export.glb`). The raw bytes are decoded natively; a morph target's base mesh is read from the archive that holds the same extracted
 * bytes (the archive WolvenKit exported from), found among the game's and the mods' archives by hash and SHA-256. Fresh WolvenKit
 * exports for resources the cache lacks come from `uncook -u --mesh-export-type MeshOnly` (the preview's own arguments, see
 * game-asset-export-wolvenkit.ts) into such a folder. Run it under tools/memory_guard.py.
 *
 * Reported per resource: meshes matched by name, and per attribute the components that are bit-identical and the largest absolute
 * difference; indices, target names and joint names compared exactly; joint transforms and inverse bind matrices by largest difference.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { depotHash } from "../src/depot-path";
import { parseGlb, readAccessor, accessorFloats, type Glb } from "../src/glb";
import { NativeArchivePool } from "../src/native/archive-reader";
import { readCr2w } from "../src/native/cr2w-reader";
import { DecodeSession } from "../src/native/limits";
import { meshGeometry, morphGeometry } from "../src/native/mesh-glb";
import { MESH_READ_LIMITS } from "../src/native/mesh-decode";
import { referencePath } from "../src/native/morph-blob";
import { loadGameOodle } from "../src/native/oodle";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const game = option("game"), mods = option("mods");
let exportsRoot = option("exports");
const filter = option("filter") ? new RegExp(option("filter")!, "i") : null, limit = Number(option("limit") ?? Infinity), verbose = args.includes("--verbose");
// --fresh: export the listed resources from one archive with WolvenKit now (the preview's uncook arguments), into cache-shaped entries.
if (game && option("fresh")) {
  const archive = option("fresh")!, out = option("out"), cli = option("wolvenkit") ?? process.env.XFS_WOLVENKIT_CLI, list = option("paths");
  if (!out || !cli || !list) { console.error("--fresh needs --out, --paths and --wolvenkit"); process.exit(2); }
  const { uncookArguments } = await import("../src/game-asset-export-wolvenkit");
  const { mkdirSync, copyFileSync } = await import("node:fs");
  const paths = readFileSync(list, "utf8").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const uncooked = join(out, "uncooked");
  mkdirSync(uncooked, { recursive: true });
  const began = performance.now();
  const run = Bun.spawnSync([cli, ...uncookArguments(archive, paths, uncooked, null)], { stdout: "pipe", stderr: "pipe" });
  console.log(`WolvenKit uncook: exit ${run.exitCode}, ${((performance.now() - began) / 1000).toFixed(1)} s for ${paths.length} resources`);
  exportsRoot = join(out, "entries");
  for (const depotPath of paths) {
    const rel = depotPath.split("\\").join("/"), raw = join(uncooked, rel), glb = join(uncooked, rel.replace(/\.mesh$/i, ".glb").replace(/\.morphtarget$/i, ".morphtarget.glb"));
    const glbFile = existsSync(glb) ? glb : existsSync(`${raw}.glb`) ? `${raw}.glb` : null;
    if (!existsSync(raw) || !glbFile) { console.log(`not exported: ${depotPath}`); continue; }
    const dir = join(exportsRoot, depotHash(depotPath));
    mkdirSync(dir, { recursive: true });
    copyFileSync(raw, join(dir, "raw")); copyFileSync(glbFile, join(dir, "export.glb"));
    writeFileSync(join(dir, "entry.json"), JSON.stringify({ depotPath, hash: depotHash(depotPath) }));
  }
}
if (!game || !exportsRoot) {
  console.error("usage: bun tools/native-mesh-oracle.ts --game <folder> [--mods <MO2 mods>] --exports <export cache resources> [--filter re] [--limit N] [--report file] [--verbose]");
  process.exit(2);
}

const oodle = loadGameOodle(game);
const pool = new NativeArchivePool(oodle.decompress);
const archives: string[] = [];
const addDir = (dir: string) => { if (existsSync(dir)) for (const name of readdirSync(dir)) if (name.toLowerCase().endsWith(".archive")) archives.push(join(dir, name)); };
for (const group of ["content", "ep1", "mod"]) addDir(join(game, "archive", "pc", group));
if (mods && existsSync(mods)) for (const mod of readdirSync(mods)) addDir(join(mods, mod, "archive", "pc", "mod"));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** The archive holding `hash` whose extracted bytes are `raw` (the one WolvenKit exported from), or null. */
function archiveOf(hash: string, raw: Uint8Array): string | null {
  const digest = sha(raw);
  for (const archive of archives) {
    try { if (pool.get(archive).has(hash) && sha(pool.read(archive, hash)!) === digest) return archive; } catch { /* unreadable archive */ }
  }
  return null;
}

type Stat = { components: number; exact: number; maxAbs: number };
const stat = (): Stat => ({ components: 0, exact: 0, maxAbs: 0 });
function compare(into: Stat, a: Float32Array | ArrayLike<number>, b: Float32Array | ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    into.components++;
    const x = a[i]!, y = b[i]!;
    if (Object.is(x, y) || (x === y) || (Number.isNaN(x) && Number.isNaN(y))) into.exact++;
    else into.maxAbs = Math.max(into.maxAbs, Math.abs(x - y));
  }
  return true;
}
const floats = (glb: Glb, index: number) => accessorFloats(readAccessor(glb, index));

type Result = { depotPath: string; kind: string; ok: boolean; problems: string[]; attributes: Record<string, Stat>; joints: Stat; ibm: Stat; ms: number; wolvenKitBytes: number; nativeBytes: number };
const results: Result[] = [];
const totals: Record<string, Stat> = {};
const seen = new Set<string>();

for (const entry of readdirSync(exportsRoot)) {
  if (results.length >= limit) break;
  const dir = join(exportsRoot, entry);
  if (!existsSync(join(dir, "raw")) || !existsSync(join(dir, "export.glb"))) continue;
  const meta = JSON.parse(readFileSync(join(dir, "entry.json"), "utf8")) as { depotPath: string; hash: string };
  if (filter && !filter.test(meta.depotPath)) continue;
  const raw = new Uint8Array(readFileSync(join(dir, "raw")));
  const key = `${meta.hash}|${sha(raw)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const result: Result = { depotPath: meta.depotPath, kind: /\.morphtarget$/i.test(meta.depotPath) ? "morph" : "mesh", ok: true, problems: [], attributes: {}, joints: stat(), ibm: stat(), ms: 0, wolvenKitBytes: 0, nativeBytes: 0 };
  results.push(result);
  const problem = (text: string) => { result.ok = false; result.problems.push(text); };
  try {
    const began = performance.now();
    const document = readCr2w(raw, oodle.decompress, new DecodeSession(MESH_READ_LIMITS));
    let geometry;
    if (result.kind === "morph") {
      const basePath = referencePath(document.root.fields.baseMesh);
      const archive = archiveOf(meta.hash, raw);
      const baseHash = basePath ? (basePath.startsWith("#") ? basePath.slice(1) : depotHash(basePath)) : null;
      const baseBytes = archive && baseHash ? pool.read(archive, baseHash) : null;
      if (!archive) result.problems.push("(the source archive was not found; base mesh not read)");
      geometry = morphGeometry(document, baseBytes ? readCr2w(baseBytes, oodle.decompress, new DecodeSession(MESH_READ_LIMITS)) : null);
    } else geometry = meshGeometry(document);
    result.ms = performance.now() - began;
    const wk = parseGlb(new Uint8Array(readFileSync(join(dir, "export.glb")))), native = parseGlb(geometry.glb);
    result.wolvenKitBytes = statSize(join(dir, "export.glb")); result.nativeBytes = geometry.glb.length;
    // Rig: joint names in order, transforms and inverse bind matrices.
    const wkSkin = wk.json.skins?.[0], nativeSkin = native.json.skins?.[0];
    if (!!wkSkin !== !!nativeSkin) problem(`skin: WolvenKit ${wkSkin ? "has" : "has none"}, native ${nativeSkin ? "has" : "has none"}`);
    if (wkSkin && nativeSkin) {
      const names = (glb: Glb, skin: { joints: number[] }) => skin.joints.map(j => glb.json.nodes[j].name);
      if (JSON.stringify(names(wk, wkSkin)) !== JSON.stringify(names(native, nativeSkin))) problem("joint names differ");
      else {
        wkSkin.joints.forEach((j: number, i: number) => {
          const a = wk.json.nodes[j], b = native.json.nodes[nativeSkin.joints[i]];
          compare(result.joints, [...(a.translation ?? [0, 0, 0]), ...(a.rotation ?? [0, 0, 0, 1])], [...(b.translation ?? [0, 0, 0]), ...(b.rotation ?? [0, 0, 0, 1])]);
        });
        compare(result.ibm, floats(wk, wkSkin.inverseBindMatrices), floats(native, nativeSkin.inverseBindMatrices));
      }
    }
    const byName = (glb: Glb) => new Map<string, any>((glb.json.meshes ?? []).map((mesh: any) => [mesh.name, mesh]));
    const wkMeshes = byName(wk), nativeMeshes = byName(native);
    if (JSON.stringify([...wkMeshes.keys()]) !== JSON.stringify([...nativeMeshes.keys()])) problem(`meshes: WolvenKit ${[...wkMeshes.keys()].join(",")} native ${[...nativeMeshes.keys()].join(",")}`);
    for (const [name, a] of wkMeshes) {
      const b = nativeMeshes.get(name);
      if (!b) continue;
      if (JSON.stringify(a.extras ?? null) !== JSON.stringify(b.extras ?? null)) problem(`${name}: extras differ`);
      const pa = a.primitives[0], pb = b.primitives[0];
      const keys = new Set([...Object.keys(pa.attributes), ...Object.keys(pb.attributes)]);
      for (const attribute of keys) {
        if (pa.attributes[attribute] === undefined || pb.attributes[attribute] === undefined) { problem(`${name}: ${attribute} only in ${pa.attributes[attribute] === undefined ? "native" : "WolvenKit"}`); continue; }
        const s = (result.attributes[attribute] ??= stat());
        const x = readAccessor(wk, pa.attributes[attribute]), y = readAccessor(native, pb.attributes[attribute]);
        if (x.componentType !== y.componentType) problem(`${name}: ${attribute} component type ${x.componentType} vs ${y.componentType}`);
        if (!compare(s, x.array, y.array)) problem(`${name}: ${attribute} count ${x.count} vs ${y.count}`);
      }
      const ia = readAccessor(wk, pa.indices).array, ib = readAccessor(native, pb.indices).array;
      const si = (result.attributes.indices ??= stat());
      if (!compare(si, ia, ib)) problem(`${name}: ${ia.length} vs ${ib.length} indices`);
      const ta = pa.targets ?? [], tb = pb.targets ?? [];
      if (ta.length !== tb.length) problem(`${name}: ${ta.length} vs ${tb.length} targets`);
      ta.forEach((target: Record<string, number>, t: number) => {
        for (const [attribute, index] of Object.entries(target)) {
          if (tb[t]?.[attribute] === undefined) { problem(`${name}: target ${t} ${attribute} missing`); continue; }
          compare((result.attributes[`target ${attribute}`] ??= stat()), floats(wk, index), floats(native, tb[t][attribute]));
        }
      });
    }
    for (const [attribute, s] of Object.entries(result.attributes)) {
      if (s.exact !== s.components && attribute === "indices") problem("indices differ");
      const total = (totals[attribute] ??= stat());
      total.components += s.components; total.exact += s.exact; total.maxAbs = Math.max(total.maxAbs, s.maxAbs);
    }
    for (const [name, s] of [["joint transforms", result.joints], ["inverse bind matrices", result.ibm]] as const) {
      const total = (totals[name] ??= stat());
      total.components += s.components; total.exact += s.exact; total.maxAbs = Math.max(total.maxAbs, s.maxAbs);
    }
  } catch (error) {
    problem(`native: ${(error as Error).name}: ${(error as Error).message}`);
  }
  if (verbose || !result.ok) console.log(`${result.ok ? "ok  " : "DIFF"} ${result.kind} ${result.depotPath} ${result.ms.toFixed(1)} ms ${result.problems.join("; ")}`);
}

function statSize(path: string) { try { return readFileSync(path).length; } catch { return 0; } }
const ok = results.filter(result => result.ok).length;
console.log(`\n${results.length} resources: ${ok} equal in structure, ${results.length - ok} with differences`);
for (const [attribute, s] of Object.entries(totals))
  console.log(`  ${attribute.padEnd(24)} ${s.exact}/${s.components} bit-identical (${s.components ? (100 * s.exact / s.components).toFixed(4) : "-"}%), max |Δ| ${s.maxAbs.toExponential(3)}`);
const ms = results.map(result => result.ms).sort((a, b) => a - b);
console.log(`  decode + GLB: median ${ms[Math.floor(ms.length / 2)]?.toFixed(1)} ms, slowest ${ms.at(-1)?.toFixed(1)} ms; GLB bytes WolvenKit ${results.reduce((s, r) => s + r.wolvenKitBytes, 0)} native ${results.reduce((s, r) => s + r.nativeBytes, 0)}`);
if (option("report")) writeFileSync(option("report")!, JSON.stringify({ totals, results }, null, 1));
