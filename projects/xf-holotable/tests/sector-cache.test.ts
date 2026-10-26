import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { encodeSector, decodeSector } from "../src/sector-data.ts";
import { COLLIDER_STRIDE, createSectorCache, sectorCacheKey, type SectorRequest } from "../src/sector-cache.ts";
import { pathBounds, pathNearBox, segmentBoxDistance2 } from "../src/solids.ts";

const request: SectorRequest = { root: "game", source: { path: "game/archive.archive", size: 100, mtimeMs: 12.3 }, resource: "world/sector.streamingsector" };
const bytes = () => encodeSector({ placements: new Uint16Array([0]), variantIndices: [0], persistentNodeIndex: -1, rows: new Float64Array(COLLIDER_STRIDE), hashes: [] });
function scratch() {
  const parent = join(import.meta.dir, "../../../local/holotable/scratch"); mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, "sector-test-")); return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}
test("typed cache windows refuse corrupt lengths before allocating and preserve exact affine doubles", () => {
  const b = bytes(), decoded = decodeSector(b); expect(decoded.rows.length).toBe(COLLIDER_STRIDE); expect(decoded.persistentNodeIndex).toBe(-1);
  expect(() => decodeSector(b.subarray(0, b.length - 1))).toThrow();
  new DataView(b.buffer).setUint32(16, 0xffffffff, true); expect(() => decodeSector(b)).toThrow();
});
test("sector keys depend on depot path, winning archive stamp and reader version, independently of a recording", () => {
  const key = sectorCacheKey(request.source, request.resource);
  expect(sectorCacheKey({ ...request.source }, request.resource)).toBe(key);
  for (const source of [{ ...request.source, size: 101 }, { ...request.source, mtimeMs: 12.4 }, { ...request.source, path: "other.archive" }]) expect(sectorCacheKey(source, request.resource)).not.toBe(key);
  expect(sectorCacheKey(request.source, "another-sector")).not.toBe(key);
  expect(sectorCacheKey(request.source, request.resource, 99)).not.toBe(key);
});
test("overlapping consumers share one decode and a later service reuses the individual disk entry", async () => {
  const s = scratch(); let reads = 0, release!: (b: Uint8Array) => void;
  try {
    const owner = createSectorCache(s.dir, async () => { reads++; return new Promise(resolve => { release = resolve; }); });
    const a = new AbortController(), b = new AbortController();
    const first = owner.read(request, a.signal), second = owner.read(request, b.signal);
    a.abort(); await expect(first).rejects.toThrow(); release(bytes());
    expect((await second).rows.length).toBe(COLLIDER_STRIDE); expect(reads).toBe(1); expect(owner.has(request)).toBe(true);
    const later = createSectorCache(s.dir, async () => { throw Error("Must reuse the cached sector"); });
    expect((await later.read(request, new AbortController().signal)).placements[0]).toBe(0);
  } finally { s.dispose(); }
});
test("the last cancellation aborts the sector read and prevents abandoned cache publication", async () => {
  const s = scratch(); let signal!: AbortSignal, release!: (b: Uint8Array) => void;
  try {
    const owner = createSectorCache(s.dir, async (_r, cancel) => { signal = cancel; return new Promise(resolve => { release = resolve; }); });
    const ctl = new AbortController(), pending = owner.read(request, ctl.signal);
    ctl.abort(); await expect(pending).rejects.toThrow(); expect(signal.aborted).toBe(true);
    release(bytes()); await new Promise(resolve => setImmediate(resolve)); expect(owner.has(request)).toBe(false);
  } finally { s.dispose(); }
});
test("sector selection uses actual 3D path-to-box distance, including corner cases outside expanded boxes", () => {
  expect(segmentBoxDistance2([0, 0, 0], [10, 0, 0], [4, 3, -1], [6, 5, 1])).toBeCloseTo(9, 10);
  expect(segmentBoxDistance2([0, 0, 0], [10, 10, 0], [4, 4, -1], [6, 6, 1])).toBe(0);
  expect(pathNearBox([[0, 0, 0]], [300, 300, 0], [301, 301, 1], 350)).toBe(false);
  expect(pathNearBox([[0, 0, 0]], [0, 0, 351], [1, 1, 352], 350)).toBe(false);
  expect(pathNearBox([[0, 0, 0]], [0, 0, 350], [1, 1, 351], 350)).toBe(true);
  expect(pathBounds([[1, 2, -10], [3, 4, 20]])).toEqual({ min: [1, 2, -10], max: [3, 4, 20] });
});
