import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { encodeSector, decodeSector, SECTOR_BYTES_LIMIT } from "../src/sector-data.ts";
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
  decoded.rows[5] = 1234.123456789; decoded.rows[8] = -0.000000000123456789;
  expect(Array.from(decodeSector(encodeSector(decoded)).rows)).toEqual(Array.from(decoded.rows));
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
test("a competing writer never waits on region decoding; BUSY writes fall back to uncached sectors", async () => {
  const s = scratch(); let release!: (b: Uint8Array) => void;
  const owner = createSectorCache(s.dir, async () => new Promise(resolve => { release = resolve; }));
  let other: Database | undefined;
  try {
    owner.begin();
    expect(owner.has(request)).toBe(false);
    other = new Database(join(s.dir, "sectors-v4.sqlite"));
    expect((other.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    const pending = owner.read(request, new AbortController().signal);
    // This succeeds while the cache's reader is still decoding the sector.
    other.exec("BEGIN IMMEDIATE");
    other.exec("INSERT INTO sectors (key, bytes, size, written) VALUES ('other', x'00', 1, 0)");
    release(bytes());
    expect((await pending).rows.length).toBe(COLLIDER_STRIDE);
    other.exec("COMMIT");
    owner.end();
    const later = createSectorCache(s.dir, async () => bytes());
    expect(later.has(request)).toBe(false);
    // A successful sector insert also releases its write lock before the region lease ends.
    later.begin();
    const next = { ...request, resource: "world/next.streamingsector" };
    expect((await later.read(next, new AbortController().signal)).rows.length).toBe(COLLIDER_STRIDE);
    other.exec("BEGIN IMMEDIATE");
    other.exec("COMMIT");
    later.end();
  } finally {
    try { other?.exec("ROLLBACK"); } catch { /* No open transaction. */ }
    other?.close();
    s.dispose();
  }
});
test("damaged SQLite files and invalid schemas are quarantined and rebuilt", async () => {
  for (const damage of ["file", "schema"] as const) {
    const s = scratch(), file = join(s.dir, "sectors-v4.sqlite");
    try {
      if (damage === "file") writeFileSync(file, "not a SQLite database");
      else { const d = new Database(file); d.exec("CREATE TABLE sectors (wrong_column TEXT)"); d.close(); }
      writeFileSync(file + ".corrupt-older", "old quarantine");
      let reads = 0;
      const cache = createSectorCache(s.dir, async () => { reads++; return bytes(); });
      expect((await cache.read(request, new AbortController().signal)).rows.length).toBe(COLLIDER_STRIDE);
      expect(reads).toBe(1);
      const quarantined = readdirSync(s.dir).filter(name => name.startsWith("sectors-v4.sqlite.corrupt-"));
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0]).not.toBe("sectors-v4.sqlite.corrupt-older");
      const later = createSectorCache(s.dir, async () => { throw Error("Fresh cache was not reused"); });
      expect((await later.read(request, new AbortController().signal)).placements[0]).toBe(0);
    } finally { s.dispose(); }
  }
});
test("a cache path that cannot be opened or quarantined still yields decoded sectors", async () => {
  const s = scratch(), blocked = join(s.dir, "not-a-directory");
  try {
    writeFileSync(blocked, "blocks the cache directory");
    const cache = createSectorCache(blocked, async () => bytes());
    cache.begin();
    expect(cache.has(request)).toBe(false);
    expect((await cache.read(request, new AbortController().signal)).rows.length).toBe(COLLIDER_STRIDE);
    cache.end();
  } finally { s.dispose(); }
});
test("SQL checks actual blob length before fetching a sector with a false small size column", async () => {
  const s = scratch(), file = join(s.dir, "sectors-v4.sqlite");
  try {
    const d = new Database(file);
    d.exec("CREATE TABLE sectors (key TEXT PRIMARY KEY, bytes BLOB NOT NULL, size INTEGER NOT NULL, written INTEGER NOT NULL)");
    d.query("INSERT INTO sectors (key, bytes, size, written) VALUES (?, zeroblob(?), 1, 0)").run(sectorCacheKey(request.source, request.resource), SECTOR_BYTES_LIMIT + 1);
    d.close();
    let reads = 0;
    const cache = createSectorCache(s.dir, async () => { reads++; return bytes(); });
    expect(cache.has(request)).toBe(false);
    expect((await cache.read(request, new AbortController().signal)).rows.length).toBe(COLLIDER_STRIDE);
    expect(reads).toBe(1);
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
