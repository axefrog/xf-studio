// Vanilla installed-game adapter. Persistent reuse is per sector; assembled regions are retained only in memory.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildMountPlan } from "../../xf-studio/authoring/src/game/archive-precedence";
import { depotHash } from "../../xf-studio/authoring/src/game/depot-path";
import { LocalSettingsStore } from "../../xf-studio/authoring/src/setup/host/local-settings-store";
import { NativeArchivePool } from "../../xf-studio/authoring/src/native/archive-reader";
import { loadGameOodle } from "../../xf-studio/authoring/src/native/oodle";
import { Cr2wFile } from "../../xf-studio/authoring/src/native/cr2w-file";
import { Cr2wDecoder } from "../../xf-studio/authoring/src/native/cr2w-reader";
import { RedObject } from "../../xf-studio/authoring/src/native/red-model";
import { NativeBudgetError, NativeMalformedError } from "../../xf-studio/authoring/src/native/native-errors";
import type { Solid, SolidRegion, Vec3 } from "./model.ts";
import { nearestSolids, pathBounds, pathDistance, pathNearBox, WORLD_SOLID_CAP } from "./solids.ts";
import { ColliderOverlap } from "./solid-overlap.ts";
import { COLLIDER_STRIDE, createSectorCache, SectorWorkers, type SourceStamp, type SectorRequest, type CachedSector } from "./sector-cache.ts";

export interface SolidPort {
  status?(path: readonly Vec3[], signal: AbortSignal): Promise<{ cold: boolean; sectors?: number; missing?: number }>;
  around(path: readonly Vec3[], margin: number, signal: AbortSignal): Promise<SolidRegion>;
}
export const SOLID_READER_VERSION = 6;
export const SOLID_RADIUS = 350;
const counts = () => ({ box: 0, sphere: 0, capsule: 0, convexMesh: 0, triangleMesh: 0 });
export const emptySolids = (): SolidRegion => ({ solids: [], solidInfo: { source: "vanilla", readerVersion: SOLID_READER_VERSION,
  available: false, sectors: 0, counts: counts(), rawCounts: counts(), levels: {}, overlap: { shapes: 0, crossLevelShapes: 0, actors: 0, completeActors: 0, pairs: {}, examples: [] },
  omittedMeshShapes: 0, cut: 0, cap: WORLD_SOLID_CAP, variants: "defaults" } });
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** In-memory identity only; disk entries are individual sectors, independent of recording paths. */
export function solidCacheKey(sources: readonly SourceStamp[], path: readonly Vec3[], radius: number, readerVersion = SOLID_READER_VERSION): string {
  return digest({ readerVersion, sources, path, radius });
}
const BLOCKS = ["base\\worlds\\03_night_city\\_compiled\\default\\blocks\\all.streamingblock", "base\\worlds\\03_night_city\\_compiled\\default\\ep1\\blocks\\all.streamingblock"];
type Descriptor = { resource: string; category: string; level: number; min: Vec3; max: Vec3; ranges: number[]; source: number };
type Context = { key: string; root: string; sources: SourceStamp[]; descriptors: Descriptor[] };
type Job = { ctl: AbortController; promise: Promise<SolidRegion>; waiters: number };
export function vanillaSources(root: string): SourceStamp[] {
  const candidates = ["ep1", "content"].flatMap(group => {
    const dir = join(root, "archive", "pc", group);
    return !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).filter(f => f.isFile() && f.name.toLowerCase().endsWith(".archive")).map(f => ({
      id: join(dir, f.name), virtualPath: `archive/pc/${group}/${f.name}`, provider: "game" as const, providerName: "Installed game", active: true, priority: null }));
  });
  return buildMountPlan(candidates, null).archives.map(a => { const s = statSync(a.id); return { path: a.id, size: s.size, mtimeMs: s.mtimeMs }; });
}
export function createGameSolidSource(cacheDir: string, gameRoot = () => process.env.XFS_TEST_GAME_ROOT ?? new LocalSettingsStore().load().settings.gameRoot): SolidPort {
    const workers = new SectorWorkers(3), cache = createSectorCache(cacheDir, workers.read), ready = new Map<string, SolidRegion>(), jobs = new Map<string, Job>();
  let context: Context | undefined;
  function getContext(signal: AbortSignal): Context | undefined {
    signal.throwIfAborted(); const root = gameRoot(); if (!root) return;
    const sources = vanillaSources(root), key = digest({ sources, metadata: 1 });
    if (context?.key === key) return context;
    const file = join(cacheDir, `descriptors-${key}.json`);
    if (existsSync(file) && statSync(file).size <= 16 * 1024 * 1024) {
      try { const descriptors = JSON.parse(readFileSync(file, "utf8")) as Descriptor[];
        if (Array.isArray(descriptors) && descriptors.length <= 40_000) return context = { key, root, sources, descriptors };
      } catch { /* Rebuild incomplete metadata. */ }
    }
    const oodle = loadGameOodle(root), pool = new NativeArchivePool(oodle.decompress), descriptors: Descriptor[] = [], seen = new Set<string>();
    try {
      const archives = sources.map(s => pool.get(s.path));
      for (const block of BLOCKS) {
        signal.throwIfAborted(); const hash = depotHash(block), at = archives.findIndex(a => a.has(hash));
        if (at < 0) { if (block === BLOCKS[1]) continue; throw Error(`Installed game lacks ${block}.`); }
        const bytes = pool.read(sources[at].path, hash)!, file = new Cr2wFile(bytes);
        if (file.exports[0]?.className !== "worldStreamingBlock") throw new NativeMalformedError("Expected a streaming block.");
        const fields = new Cr2wDecoder(file, oodle.decompress).exportObject(0).fields;
        for (const raw of fields.descriptors as RedObject[]) {
          const f = raw.fields, bb = f.streamingBox;
          if (!(bb instanceof RedObject) || !(bb.fields.Min instanceof RedObject) || !(bb.fields.Max instanceof RedObject) || !f.data) throw new NativeMalformedError("Incomplete streaming descriptor.");
          const category = String(f.category ?? "Unknown"), level = Number(f.level ?? 0);
          if (!(category === "Exterior" && level <= 6 || category === "Interior")) continue;
          const resource = (f.data as { DepotPath: { $value: string } }).DepotPath.$value;
          if (seen.has(resource)) continue; seen.add(resource);
          const resourceHash = depotHash(resource), source = archives.findIndex(a => a.has(resourceHash)); if (source < 0) throw Error(`Installed game lacks ${resource}.`);
          const vector = (v: RedObject): Vec3 => [Number(v.fields.X ?? 0), Number(v.fields.Y ?? 0), Number(v.fields.Z ?? 0)];
          descriptors.push({ resource, category, level, min: vector(bb.fields.Min), max: vector(bb.fields.Max), source,
            ranges: [0, ...((f.variants ?? []) as RedObject[]).filter(v => v.fields.enabledByDefault).map(v => Number(v.fields.rangeIndex ?? 0))] });
        }
      }
      signal.throwIfAborted(); mkdirSync(cacheDir, { recursive: true }); const temp = join(cacheDir, `.${randomUUID()}.tmp`);
      try { writeFileSync(temp, JSON.stringify(descriptors)); renameSync(temp, file); } finally { rmSync(temp, { force: true }); }
      return context = { key, root, sources, descriptors };
    } finally { pool.close(); oodle.close(); }
  }
  const select = (c: Context, path: readonly Vec3[]) => {
    const b = pathBounds(path);
    return c.descriptors.filter(d => {
      let lower = 0; for (let i = 0; i < 3; i++) lower += Math.max(d.min[i] - b.max[i], b.min[i] - d.max[i], 0) ** 2;
      return lower <= SOLID_RADIUS ** 2 && pathNearBox(path, d.min, d.max, SOLID_RADIUS);
    }).sort((a, b) => a.level - b.level || a.resource.localeCompare(b.resource));
  };
  const compactPath = (path: readonly Vec3[]) => path.filter((p, i) => !i || p[0] !== path[i - 1][0] || p[1] !== path[i - 1][1] || p[2] !== path[i - 1][2]);
  const request = (c: Context, d: Descriptor): SectorRequest => ({ root: c.root, source: c.sources[d.source], resource: d.resource });
  async function build(c: Context, path: readonly Vec3[], signal: AbortSignal): Promise<SolidRegion> {
    const started = performance.now(), result = emptySolids(); result.solidInfo.available = true;
    const bounds = pathBounds(path), solids: Solid[] = [], overlap = new ColliderOverlap(), distance = pathDistance(path), descriptors = select(c, path);
    cache.begin();
    const pending = new Map<number, Promise<CachedSector>>();
    const schedule = (i: number) => { if (i < descriptors.length && !signal.aborted) { const p = cache.read(request(c, descriptors[i]), signal); p.catch(() => {}); pending.set(i, p); } };
    for (let i = 0; i < Math.min(4, descriptors.length); i++) schedule(i);
    let shapeCount = 0;
    try {
      for (let i = 0; i < descriptors.length; i++) {
        signal.throwIfAborted(); const d = descriptors[i], sector = await pending.get(i)!; pending.delete(i); schedule(i + 4);
        await new Promise(resolve => setImmediate(resolve)); signal.throwIfAborted();
        const resourceHash = depotHash(d.resource), band = `${d.category}:${d.level}`;
        const level = result.solidInfo.levels[band] ??= { sectors: 0, counts: counts() }; level.sectors++; result.solidInfo.sectors++;
        const active = new Set<number>();
        for (let j = 0, range = 0; j < sector.placements.length; j++) {
          while (range + 1 < sector.variantIndices.length && j >= sector.variantIndices[range + 1]) range++;
          if (d.ranges.includes(range) || range === sector.persistentNodeIndex) active.add(sector.placements[j]);
        }
        const rows = sector.rows;
        let nodeIndex = -1, actorIndex = -1, actorShapes = 0, inside = 0, crossLevel = 0, sameActorShapeCount = true, actorId = "";
        const matchedActors = new Set<string>(), matchedShapes = new Set<string>();
        const finishActor = () => {
          if (crossLevel) result.solidInfo.overlap.actors++;
          if (inside && inside === actorShapes && crossLevel === inside && matchedShapes.size === inside && matchedActors.size === 1 && sameActorShapeCount) result.solidInfo.overlap.completeActors++;
        };
        for (let at = 0; at < rows.length; at += COLLIDER_STRIDE) {
          const ni = rows[at], ai = rows[at + 1]; if (!active.has(ni)) continue;
          if (ni !== nodeIndex || ai !== actorIndex) {
            finishActor(); nodeIndex = ni; actorIndex = ai; actorShapes = rows[at + 2]; inside = crossLevel = 0; sameActorShapeCount = true; actorId = ""; matchedActors.clear(); matchedShapes.clear();
          }
          const x = rows[at + 5], y = rows[at + 6], z = rows[at + 7];
          if (x < bounds.min[0] - SOLID_RADIUS || x > bounds.max[0] + SOLID_RADIUS || y < bounds.min[1] - SOLID_RADIUS || y > bounds.max[1] + SOLID_RADIUS || z < bounds.min[2] - SOLID_RADIUS || z > bounds.max[2] + SOLID_RADIUS) continue;
          const center: Vec3 = [x, y, z]; if (distance(center) > SOLID_RADIUS ** 2) continue;
          if (++shapeCount > 500_000 || shapeCount % 1024 === 0 && performance.now() - started > 30_000) throw new NativeBudgetError("This path exceeds the collider preparation budget.");
          inside++; actorId ||= `${resourceHash}:${ni}:${ai}`;
          const axes: Solid["axes"] = [[rows[at + 8], rows[at + 9], rows[at + 10]], [rows[at + 11], rows[at + 12], rows[at + 13]], [rows[at + 14], rows[at + 15], rows[at + 16]]];
          const kind = (["box", "sphere", "capsule", "convexMesh", "triangleMesh"] as const)[rows[at + 4]];
          const size: Vec3 | undefined = rows[at + 4] < 3 ? [rows[at + 17], rows[at + 18], rows[at + 19]] : undefined;
          result.solidInfo.rawCounts[kind]++; level.counts[kind]++;
          const id = `${actorId}:${rows[at + 3]}`, duplicate = overlap.add({ id, actor: actorId, actorShapes, level: d.level, category: d.category, kind, center, axes, size, hash: rows[at + 20] < 0 ? undefined : sector.hashes[rows[at + 20]] });
          if (duplicate) {
            const info = result.solidInfo.overlap; info.shapes++;
            if (duplicate.level !== d.level) {
              crossLevel++; info.crossLevelShapes++; matchedActors.add(duplicate.actor); matchedShapes.add(duplicate.id); sameActorShapeCount &&= duplicate.actorShapes === actorShapes;
              const pair = `${duplicate.category}:${duplicate.level}→${band}`; info.pairs[pair] = (info.pairs[pair] ?? 0) + 1;
              if (info.examples.length < 8) info.examples.push({ kept: duplicate.id, removed: id, keptLevel: duplicate.level, removedLevel: d.level, kind });
            }
            continue;
          }
          result.solidInfo.counts[kind]++;
          if (kind === "convexMesh" || kind === "triangleMesh") { result.solidInfo.omittedMeshShapes++; continue; }
          solids.push({ id, kind, center, axes, size: size! });
        }
        finishActor();
      }
      signal.throwIfAborted();
      for (const s of c.sources) { const now = statSync(s.path); if (now.size !== s.size || now.mtimeMs !== s.mtimeMs) throw Error("Game archives changed while reading the city. Open the recording again."); }
      const selected = nearestSolids(solids, path); result.solids = selected.solids; result.solidInfo.cut = selected.cut; return result;
    } finally { try { await workers.closeIdle(); cache.trim(); } finally { cache.end(); } }
  }
  return {
    async status(path, signal) {
      path = compactPath(path);
      const c = getContext(signal); if (!c || !path.length) return { cold: false };
      const key = solidCacheKey(c.sources, path, SOLID_RADIUS); if (ready.has(key)) return { cold: false };
      cache.begin(false);
      try { const selected = select(c, path), missing = selected.filter(d => !cache.has(request(c, d))).length;
        return { cold: missing > 0, sectors: selected.length, missing };
      } finally { cache.end(); }
    },
    async around(path, _margin, signal) {
      path = compactPath(path);
      const c = getContext(signal); if (!c || !path.length) return emptySolids();
      const key = solidCacheKey(c.sources, path, SOLID_RADIUS); if (ready.has(key)) return ready.get(key)!;
      let job = jobs.get(key);
      if (!job) {
        const ctl = new AbortController(), promise = build(c, path, ctl.signal).then(result => { ctl.signal.throwIfAborted(); ready.clear(); ready.set(key, result); return result; });
        job = { ctl, promise, waiters: 0 }; jobs.set(key, job); const mine = job;
        void promise.finally(() => { if (jobs.get(key) === mine) jobs.delete(key); }).catch(() => {});
      }
      const mine = job; mine.waiters++;
      return new Promise<SolidRegion>((resolve, reject) => {
        let done = false;
        const finish = (error?: unknown, result?: SolidRegion) => {
          if (done) return; done = true; signal.removeEventListener("abort", abort);
          if (--mine.waiters === 0 && signal.aborted && jobs.get(key) === mine) { mine.ctl.abort(); jobs.delete(key); }
          if (error) reject(error); else resolve(result!);
        };
        const abort = () => finish(signal.reason ?? new DOMException("Cancelled.", "AbortError"));
        signal.addEventListener("abort", abort, { once: true }); mine.promise.then(result => finish(undefined, result), finish); if (signal.aborted) abort();
      });
    },
  };
}
