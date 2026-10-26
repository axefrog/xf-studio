// Installed-game adapter and the single owner of W0 region jobs/cache. Vanilla only; never invokes WolvenKit or a bridge tool.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildMountPlan } from "../../xf-studio/authoring/src/game/archive-precedence";
import { depotHash } from "../../xf-studio/authoring/src/game/depot-path";
import { LocalSettingsStore } from "../../xf-studio/authoring/src/setup/host/local-settings-store";
import { NativeArchivePool } from "../../xf-studio/authoring/src/native/archive-reader";
import { loadGameOodle } from "../../xf-studio/authoring/src/native/oodle";
import { NATIVE_READER_VERSION } from "../../xf-studio/authoring/src/native/resource-document";
import { Cr2wFile } from "../../xf-studio/authoring/src/native/cr2w-file";
import { Cr2wDecoder } from "../../xf-studio/authoring/src/native/cr2w-reader";
import { RedObject } from "../../xf-studio/authoring/src/native/red-model";
import { readStreamingSectorCollisions, SECTOR_READER_VERSION } from "../../xf-studio/authoring/src/native/streaming-sector";
import { NativeBudgetError, NativeMalformedError } from "../../xf-studio/authoring/src/native/native-errors";
import type { Solid, SolidRegion, Vec3 } from "./model.ts";
import { boxOf } from "./world.ts";
import { actorPose, nearestSolids, WORLD_SOLID_CAP } from "./solids.ts";
import { ColliderOverlap } from "./solid-overlap.ts";

export interface SolidPort { around(path: readonly Vec3[], margin: number, signal: AbortSignal): Promise<SolidRegion> }
export const SOLID_READER_VERSION = 5;
const counts = () => ({ box: 0, sphere: 0, capsule: 0, convexMesh: 0, triangleMesh: 0 });
export const emptySolids = (): SolidRegion => ({ solids: [], solidInfo: { source: "vanilla", readerVersion: SOLID_READER_VERSION,
  available: false, sectors: 0, counts: counts(), rawCounts: counts(), levels: {}, overlap: { shapes: 0, crossLevelShapes: 0, actors: 0, completeActors: 0, pairs: {}, examples: [] },
  omittedMeshShapes: 0, cut: 0, cap: WORLD_SOLID_CAP, variants: "defaults" } });
type Stamp = { path: string; size: number; mtimeMs: number };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Every source stamp participates: replacement, a new archive and a changed reader all invalidate the region. */
export function solidCacheKey(sources: readonly Stamp[], path: readonly Vec3[], margin: number, readerVersion = SOLID_READER_VERSION): string {
  return digest({ readerVersion, sectorVersion: SECTOR_READER_VERSION, nativeVersion: NATIVE_READER_VERSION, sources, path, margin });
}
const BLOCKS = ["base\\worlds\\03_night_city\\_compiled\\default\\blocks\\all.streamingblock",
  "base\\worlds\\03_night_city\\_compiled\\default\\ep1\\blocks\\all.streamingblock"];
type Descriptor = { data: { DepotPath: { $value: string } }; category?: string; level?: number;
  streamingBox: { Min: { X: number; Y: number; Z: number }; Max: { X: number; Y: number; Z: number } };
  variants?: { rangeIndex: number; enabledByDefault?: number | boolean }[] };
type Job = { ctl: AbortController; promise: Promise<SolidRegion>; waiters: number };

export function vanillaSources(root: string): Stamp[] {
  // Same vanilla archive locations and mount plan as the native tools; no scan through unrelated plugin/mod trees on every open.
  const candidates = ["ep1", "content"].flatMap(group => {
    const dir = join(root, "archive", "pc", group);
    return !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).filter(f => f.isFile() && f.name.toLowerCase().endsWith(".archive")).map(f => ({
      id: join(dir, f.name), virtualPath: `archive/pc/${group}/${f.name}`, provider: "game" as const, providerName: "Installed game", active: true, priority: null }));
  });
  const plan = buildMountPlan(candidates, null);
  return plan.archives.map(a => { const s = statSync(a.id); return { path: a.id, size: s.size, mtimeMs: s.mtimeMs }; });
}

export function createGameSolidSource(cacheDir: string, gameRoot = () => process.env.XFS_TEST_GAME_ROOT ?? new LocalSettingsStore().load().settings.gameRoot): SolidPort {
  const ready = new Map<string, SolidRegion>(), jobs = new Map<string, Job>();
  const write = (key: string, result: SolidRegion) => {
    mkdirSync(cacheDir, { recursive: true });
    const temp = join(cacheDir, `.${randomUUID()}.tmp`);
    try { writeFileSync(temp, JSON.stringify({ key, result })); renameSync(temp, join(cacheDir, `w0-${key}.json`)); }
    finally { rmSync(temp, { force: true }); }
    // Superseded archive/path versions are disposable. This owner removes only its own entries, at most 128 MiB in total.
    const entries = readdirSync(cacheDir).filter(f => /^w0-[a-f0-9]{64}\.json$/.test(f)).map(name => {
      const path = join(cacheDir, name), s = statSync(path); return { path, size: s.size, time: s.mtimeMs };
    }).sort((a, b) => b.time - a.time);
    let held = 0;
    for (const entry of entries) { held += entry.size; if (held > 128 * 1024 * 1024) rmSync(entry.path, { force: true }); }
  };
  async function build(root: string, sources: readonly Stamp[], path: readonly Vec3[], margin: number, signal: AbortSignal): Promise<SolidRegion> {
    const started = performance.now();
    const oodle = loadGameOodle(root), pool = new NativeArchivePool(oodle.decompress);
    try {
    const archives = sources.map(s => ({ path: s.path, archive: pool.get(s.path) }));
    const read = (resource: string, optional = false) => {
      const hash = depotHash(resource);
      for (const a of archives) if (a.archive.has(hash)) { const bytes = pool.read(a.path, hash); if (bytes) return bytes; }
      if (optional) return null;
      throw Error(`Installed game lacks ${resource}.`);
    };
      const b = boxOf([...path]), x0 = b.min[0] - margin, x1 = b.max[0] + margin, y0 = b.min[1] - margin, y1 = b.max[1] + margin;
      const result = emptySolids(); result.solidInfo.available = true;
      const solids: Solid[] = [], seen = new Set<string>(), selectedDescriptors: Descriptor[] = [];
      for (const block of BLOCKS) {
        signal.throwIfAborted();
        const bytes = read(block, block === BLOCKS[1]); if (!bytes) continue;
        const file = new Cr2wFile(bytes);
        if (file.exports[0]?.className !== "worldStreamingBlock") throw new NativeMalformedError("Expected a streaming block.");
        const fields = new Cr2wDecoder(file, oodle.decompress).exportObject(0).fields;
        for (const raw of fields.descriptors as RedObject[]) {
          const f = raw.fields, bb = f.streamingBox;
          if (!(bb instanceof RedObject) || !(bb.fields.Min instanceof RedObject) || !(bb.fields.Max instanceof RedObject) || !f.data)
            throw new NativeMalformedError("Incomplete streaming descriptor.");
          const vector = (v: RedObject) => ({ X: Number(v.fields.X ?? 0), Y: Number(v.fields.Y ?? 0), Z: Number(v.fields.Z ?? 0) });
          const d: Descriptor = { data: f.data as Descriptor["data"], category: String(f.category ?? "Unknown"), level: Number(f.level ?? 0),
            streamingBox: { Min: vector(bb.fields.Min), Max: vector(bb.fields.Max) },
            variants: ((f.variants ?? []) as RedObject[]).map(v => ({ rangeIndex: Number(v.fields.rangeIndex ?? 0), enabledByDefault: Boolean(v.fields.enabledByDefault) })) };
          const box = d.streamingBox;
          if (!(d.category === "Exterior" && (d.level ?? 0) <= 6 || d.category === "Interior") ||
            box.Min.X > x1 || box.Max.X < x0 || box.Min.Y > y1 || box.Max.Y < y0) continue;
          const resource = d.data.DepotPath.$value; if (seen.has(resource)) continue; seen.add(resource);
          selectedDescriptors.push(d);
        }
      }
      // Distance bands are not render LODs. Include every band and remove only geometry-equal measured matches, lowest level first.
      selectedDescriptors.sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.data.DepotPath.$value.localeCompare(b.data.DepotPath.$value));
      const overlap = new ColliderOverlap(); let shapeCount = 0, sectorNumber = 0;
      for (const d of selectedDescriptors) {
          const resource = d.data.DepotPath.$value, resourceHash = depotHash(resource), band = `${d.category}:${d.level ?? 0}`;
          const level = result.solidInfo.levels[band] ??= { sectors: 0, counts: counts() }; level.sectors++;
          if (sectorNumber++ % 8 === 0) await new Promise(resolve => setImmediate(resolve));
          signal.throwIfAborted();
          let sector;
          try { sector = readStreamingSectorCollisions(read(resource)!, oodle.decompress); }
          catch (e) { if (e instanceof Error) e.message += ` (${resource})`; throw e; }
          result.solidInfo.sectors++;
          const ranges = new Set([0, ...(d.variants ?? []).filter(v => v.enabledByDefault).map(v => v.rangeIndex)]);
          const active = new Set<number>();
          for (let i = 0, range = 0; i < sector.placements.length; i++) {
            while (range + 1 < sector.variantIndices.length && i >= sector.variantIndices[range + 1]) range++;
            if (ranges.has(range) || range === sector.persistentNodeIndex) active.add(sector.placements[i].nodeIndex);
          }
          for (const node of sector.collisions) {
            if (!active.has(node.nodeIndex)) continue;
            for (const [ai, actor] of node.actors.entries()) {
             let inside = 0, crossLevel = 0; const matchedActors = new Set<string>(), matchedShapes = new Set<string>(); let sameActorShapeCount = true;
             const actorId = `${resourceHash}:${node.nodeIndex}:${ai}`;
             const transform = actorPose(actor);
             for (const [si, shape] of actor.shapes.entries()) {
              const p = transform.center(shape.position);
              // A mesh has no bound in this record. This is a count of origins in the path's XY box, not invented mesh extents.
              if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue;
              const pose = { center: p, axes: transform.axes(shape.rotation) };
              if (++shapeCount > 500_000) throw new NativeBudgetError("This path region exceeds the 500,000-collider preparation budget.");
              if (shapeCount % 1024 === 0 && performance.now() - started > 30_000) throw new NativeBudgetError("Preparing this path region exceeded 30 seconds.");
              inside++;
              const kind = ({ Box: "box", Sphere: "sphere", Capsule: "capsule", ConvexMesh: "convexMesh", TriangleMesh: "triangleMesh" } as const)[shape.type];
              result.solidInfo.rawCounts[kind]++; level.counts[kind]++;
              const id = `${actorId}:${si}`, duplicate = overlap.add({ id, actor: actorId, actorShapes: actor.shapes.length, level: d.level ?? 0, category: d.category!, kind, ...pose, size: shape.size,
                hash: shape.hash === undefined ? undefined : `${node.sectorHash}:${shape.hash}` });
              if (duplicate) {
                const info = result.solidInfo.overlap; info.shapes++;
                if (duplicate.level !== (d.level ?? 0)) {
                  crossLevel++; info.crossLevelShapes++;
                  matchedActors.add(duplicate.actor); sameActorShapeCount &&= duplicate.actorShapes === actor.shapes.length;
                  matchedShapes.add(duplicate.id);
                  const pair = `${duplicate.category}:${duplicate.level}→${band}`; info.pairs[pair] = (info.pairs[pair] ?? 0) + 1;
                  if (info.examples.length < 8) info.examples.push({ kept: duplicate.id, removed: id, keptLevel: duplicate.level, removedLevel: d.level ?? 0, kind });
                }
                continue;
              }
              result.solidInfo.counts[kind]++;
              if (kind === "convexMesh" || kind === "triangleMesh") { result.solidInfo.omittedMeshShapes++; continue; }
              solids.push({ id, kind, ...pose, size: shape.size! });
             }
             if (crossLevel) result.solidInfo.overlap.actors++;
             if (inside === actor.shapes.length && crossLevel === inside && matchedShapes.size === inside && matchedActors.size === 1 && sameActorShapeCount) result.solidInfo.overlap.completeActors++;
            }
          }
      }
      signal.throwIfAborted();
      for (const source of sources) {
        const now = statSync(source.path);
        if (now.size !== source.size || now.mtimeMs !== source.mtimeMs) throw Error("Game archives changed while reading solid shapes. Open the recording again.");
      }
      const selected = nearestSolids(solids, path);
      result.solids = selected.solids; result.solidInfo.cut = selected.cut;
      return result;
    } finally { pool.close(); oodle.close(); }
  }
  return {
    async around(path, margin, signal) {
      signal.throwIfAborted();
      const root = gameRoot(); if (!root || !path.length) return emptySolids();
      const sources = vanillaSources(root);
      const key = solidCacheKey(sources, path, margin), file = join(cacheDir, `w0-${key}.json`);
      if (ready.has(key)) return ready.get(key)!;
      if (existsSync(file) && statSync(file).size <= 32 * 1024 * 1024) {
        try {
          const cached = JSON.parse(readFileSync(file, "utf8")) as { key: string; result: SolidRegion }, result = cached.result;
          if (cached.key === key && result.solidInfo.readerVersion === SOLID_READER_VERSION && Array.isArray(result.solids) && result.solids.length <= WORLD_SOLID_CAP) {
            ready.clear(); ready.set(key, result); return result;
          }
        } catch { /* An incomplete/old cache is rebuilt; game bytes remain the authority. */ }
      }
      let job = jobs.get(key);
      if (!job) {
        const ctl = new AbortController();
        const promise = build(root, sources, path, margin, ctl.signal).then(result => {
          ctl.signal.throwIfAborted(); write(key, result); ready.clear(); ready.set(key, result); return result;
        });
        job = { ctl, promise, waiters: 0 }; jobs.set(key, job);
        const mine = job;
        void promise.finally(() => { if (jobs.get(key) === mine) jobs.delete(key); }).catch(() => {});
      }
      const mine = job; mine.waiters++;
      return new Promise<SolidRegion>((resolve, reject) => {
        let done = false;
        const finish = (error: unknown, result?: SolidRegion) => {
          if (done) return; done = true; signal.removeEventListener("abort", abort);
          if (--mine.waiters === 0 && signal.aborted && jobs.get(key) === mine) { mine.ctl.abort(); jobs.delete(key); }
          if (error) reject(error); else resolve(result!);
        };
        const abort = () => finish(new DOMException("Cancelled.", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
        mine.promise.then(result => finish(null, result), error => finish(error));
        if (signal.aborted) abort();
      });
    },
  };
}
