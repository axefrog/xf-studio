/** Opt-in real-sector oracle. Run under tools/memory_guard.py, with the game folder and WolvenKit configured in Settings.
 * bun tools/native-sector-diff.ts --out <ignored folder> [--game <folder>] [--cli <executable>]
 * Only hashes, paths, counts and results belong in knowledge pages; extracted bytes and JSON stay private.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { vanillaSources } from "../../../xf-holotable/src/solid-source";
import { LocalSettingsStore } from "../src/setup/host/local-settings-store";
import { depotHash, fnv1a64 } from "../src/game/depot-path";
import { NativeArchivePool } from "../src/native/archive-reader";
import { loadGameOodle } from "../src/native/oodle";
import { readStreamingSector, type StreamingSector } from "../src/native/streaming-sector";
import { float32Value } from "../src/native/json-numbers";
import { runWolvenKit, wolvenKitIdentity } from "../src/host/wolvenkit-cli";

export const SECTOR_SAMPLES = [
  "base\\worlds\\03_night_city\\_compiled\\default\\exterior_-21_23_-9_0.streamingsector",
  "base\\worlds\\03_night_city\\_compiled\\default\\interior_-51_31_0_0.streamingsector",
  "base\\worlds\\03_night_city\\_compiled\\default\\navigation_-5_5_-2_3.streamingsector",
  "base\\worlds\\03_night_city\\_compiled\\default\\exterior_-8_13_0_1.streamingsector",
];

type Json = Record<string, any>;
const proxyTypes = ["Invalid", "PhysicalSystem", "CharacterController", "Destruction", "ParticleSystem", "Trigger", "Cloth", "WorldCollision", "Terrain", "SimpleCollider", "AggregateSystem", "CharacterObstacle", "Ragdoll", "FoliageDestruction"];
const fv = (xs: readonly number[]) => xs.map(float32Value);
const xyz = (v: Json) => [v.X, v.Y, v.Z];
const quat = (v: Json) => [v.i, v.j, v.k, v.r];
const identities = (xs: readonly (string | number)[]) => { const seen = new Map<string | number, number>(); return xs.map(x => { if (!seen.has(x)) seen.set(x, seen.size); return seen.get(x); }); };
const nameHash = (v: Json) => v.$storage === "uint64" ? String(v.$value) : v.$value === "None" ? "0" : fnv1a64(new TextEncoder().encode(v.$value)).toString();
// WolvenKit 11720772 FNV1A64HashAlgorithm.HashStringWithoutAliases: alias markers/names do not participate.
const nodeRefHash = (v: Json) => v.$storage === "uint64" ? String(v.$value) : fnv1a64(new TextEncoder().encode(v.$value.replaceAll("#", "").replace(/;[^/]*/g, ""))).toString();

/** Compare every stored appendix/placement/collision field. Floats use the reference writer's documented G9 decimal rule.
 * Node handles compare their class/order and aliasing, since WolvenKit assigns JSON HandleIds while walking the graph.
 */
export function sectorDifferences(s: StreamingSector, document: unknown): string[] {
  const r = (document as Json).Data.RootChunk as Json;
  const handles = new Map<string, Json>();
  const collect = (v: any): void => { if (!v || typeof v !== "object") return; if (v.HandleId && v.Data) handles.set(v.HandleId, v.Data); for (const x of Object.values(v)) collect(x); };
  collect(r);
  const nodes: Json[] = r.nodes.map((h: Json) => h.Data ?? handles.get(h.HandleRefId ?? h.HandleId));
  const mine = { version: s.version, nodes: s.nodeTypes, nodeIdentity: identities(s.nodes), nodeRefs: s.nodeRefs,
    variantIndices: s.variantIndices, persistentNodeIndex: s.persistentNodeIndex,
    placements: s.placements.map(p => ({ ...p, position: fv(p.position), positionW: float32Value(p.positionW), orientation: fv(p.orientation), scale: fv(p.scale),
      pivot: fv(p.pivot), bounds: { min: fv(p.bounds.min), max: fv(p.bounds.max) }, maxStreamingDistance: float32Value(p.maxStreamingDistance), ukFloat1: float32Value(p.ukFloat1) })),
    collisions: s.collisions.map(n => ({ nodeIndex: n.nodeIndex, sectorHash: n.sectorHash, actors: n.actors.map(a => ({ ...a, position: a.position.map(x => x * 131072), orientation: fv(a.orientation), scale: fv(a.scale),
      shapes: a.shapes.map(p => ({ ...p, size: p.size ? fv(p.size) : undefined, position: fv(p.position), rotation: fv(p.rotation), proxyType: proxyTypes[p.proxyType] ?? p.proxyType })) })) })) };
  const reference = { version: r.version, nodes: nodes.map(n => n.$type), nodeIdentity: identities(r.nodes.map((h: Json) => h.HandleId ?? h.HandleRefId)),
    nodeRefs: r.nodeRefs.map((x: Json) => x.$value), variantIndices: r.variantIndices, persistentNodeIndex: r.persistentNodeIndex,
    placements: r.nodeData.Data.map((p: Json) => ({ position: xyz(p.Position), positionW: p.Position.W, orientation: quat(p.Orientation), scale: xyz(p.Scale), pivot: xyz(p.Pivot),
      bounds: { min: xyz(p.Bounds.Min), max: xyz(p.Bounds.Max) }, id: p.Id, questPrefabRefHash: nodeRefHash(p.QuestPrefabRefHash), ukHash1: nodeRefHash(p.UkHash1),
      cookedPrefabData: p.CookedPrefabData.DepotPath.$storage === "uint64" ? p.CookedPrefabData.DepotPath.$value : depotHash(p.CookedPrefabData.DepotPath.$value), maxStreamingDistance: p.MaxStreamingDistance, ukFloat1: p.UkFloat1, nodeIndex: p.NodeIndex,
      unknown16: [p.Uk10, p.Uk11, p.Uk12], unknown64: [p.Uk13, p.Uk14] })),
    collisions: nodes.flatMap((n, nodeIndex) => n.$type !== "worldCollisionNode" ? [] : [{ nodeIndex, sectorHash: String(n.sectorHash ?? "0"), actors: (n.compiledData?.Data?.Actors ?? []).map((a: Json) => ({
      position: [a.Position.x.Bits, a.Position.y.Bits, a.Position.z.Bits], orientation: quat(a.Orientation), scale: xyz(a.Scale), uk1: a.Uk1, uk2: a.Uk2,
      shapes: a.Shapes.map((p: Json) => ({ type: p.ShapeType, size: p.Size ? xyz(p.Size) : undefined, hash: p.Hash, position: xyz(p.Position), rotation: quat(p.Rotation),
        materials: p.Materials.map(nameHash), preset: nameHash(p.Preset), proxyType: p.ProxyType, uk1: p.Uk1, uk2: p.Uk2, uk3: p.Uk3 })) })) }]) };
  const mismatches: string[] = [];
  const compare = (a: any, b: any, at: string) => {
    if (mismatches.length >= 20 || a === b) return;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") { mismatches.push(`${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); return; }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) compare(a[key], b[key], `${at}.${key}`);
  };
  compare(mine, reference, "sector"); return mismatches;
}

if (import.meta.main) {
  const args = process.argv.slice(2), option = (name: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
  const settings = new LocalSettingsStore().load().settings;
  const root = option("game") ?? process.env.XFS_TEST_GAME_ROOT ?? settings.gameRoot, cli = option("cli") ?? settings.wolvenKitCli, out = option("out");
  if (!root || !cli || !out) throw Error("Supply --out and configure the game folder and WolvenKit in Settings (or --game and --cli).");
  const sources = vanillaSources(root), oodle = loadGameOodle(root), pool = new NativeArchivePool(oodle.decompress);
  const samples: { path: string; file: string; sha256: string; placements: number; nodes: number; actors: number; shapes: number }[] = [];
  try {
    for (const path of SECTOR_SAMPLES) {
      const hash = depotHash(path), bytes = sources.map(s => pool.read(s.path, hash)).find(b => b !== null);
      if (!bytes) throw Error(`Missing sector ${path}`);
      const file = join(out, path.replaceAll("\\", "/")); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes);
      const sector = readStreamingSector(bytes, oodle.decompress);
      samples.push({ path, file, sha256: createHash("sha256").update(bytes).digest("hex"), placements: sector.placements.length,
        nodes: sector.nodes.length, actors: sector.collisions.reduce((n, c) => n + c.actors.length, 0),
        shapes: sector.collisions.reduce((n, c) => n + c.actors.reduce((n, a) => n + a.shapes.length, 0), 0) });
    }
    await runWolvenKit(cli, ["convert", "s", out], { timeoutMs: 120_000, keep: 8000 });
    const results = samples.map(sample => ({ ...sample, differences: sectorDifferences(readStreamingSector(new Uint8Array(readFileSync(sample.file)), oodle.decompress),
      JSON.parse(readFileSync(`${sample.file}.json`, "utf8"))) }));
    const report = { wolvenKit: wolvenKitIdentity(cli), samples: results };
    writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (results.some(s => s.differences.length)) process.exitCode = 1;
  } finally { pool.close(); oodle.close(); }
}
