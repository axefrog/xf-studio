/**
 * The export cache's rewrites (game-asset-export.ts, PREV-200): a rewrite of an entry (a raw, partial or repaired geometry export) puts
 * its files in a new generation and switches `entry.json` to it atomically, so a reader holding the old paths (another export of the same
 * resource beside it) can still read them; superseded generations, and the flat files of an entry from before generations, are removed
 * on a later write once their grace period has passed.
 */
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileSha256 } from "../src/derived-cache";
import { depotHash } from "../src/depot-path";
import { archiveExportSource, GAME_ASSET_EXPORT_VERSION, GameAssetExportCache } from "../src/game-asset-export";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = mkdtempSync(join(tmpdir(), "xfs-export-generations-")); roots.push(root); return root; };
const MESH = "base\\characters\\hair\\h1.mesh";

function setup(retiredMs?: number) {
  const root = temporary(), archive = join(root, "mod.archive");
  writeFileSync(archive, "archive");
  const source = archiveExportSource(archive, root);
  const cache = new GameAssetExportCache(join(root, "exports"), { key: "tool", label: "Tool" }, "none", retiredMs === undefined ? {} : { retiredMs });
  const files = (tag: string) => {
    const folder = join(root, `in-${tag}`);
    mkdirSync(folder, { recursive: true });
    for (const name of ["raw", "export.glb", "materials.json"]) writeFileSync(join(folder, name), `${name} ${tag}`);
    return { raw: join(folder, "raw"), "export.glb": join(folder, "export.glb"), "materials.json": join(folder, "materials.json") };
  };
  return { root, source, cache, files };
}

test("a rewrite keeps the files a reader already holds, and the entry reads the new ones", () => {
  const { source, cache, files } = setup();
  const first = cache.write(MESH, source, files("one"));
  const held = cache.read(MESH, source)!;
  expect(held.raw).toBe(first.raw!);
  // Another export of the same resource rewrites it (a raw check, a partial count) while the first reader still reads its paths.
  const second = cache.write(MESH, source, files("two"), 1);
  expect(second.raw).not.toBe(first.raw!);
  for (const [name, path] of Object.entries(held)) expect(readFileSync(path, "utf8")).toBe(`${name} one`);
  expect(readFileSync(second.raw!, "utf8")).toBe("raw two");
  expect(cache.partialRuns(MESH, source)).toBe(1);
  const third = cache.write(MESH, source, files("three"), 2);
  expect(cache.read(MESH, source)!.raw).toBe(third.raw!);
  expect(readFileSync(held.raw!, "utf8")).toBe("raw one");
  expect(cache.filePath(MESH, source, "export.glb")).toBe(third["export.glb"]!);
  expect(cache.filePath(MESH, source, "missing")).toBeNull();
});

test("superseded generations are removed on a later write once their grace period has passed", async () => {
  const { source, cache, files } = setup(50);
  const first = cache.write(MESH, source, files("one"));
  const second = cache.write(MESH, source, files("two"), 1);
  // Within the grace period the first generation stays.
  expect(existsSync(first.raw!)).toBe(true);
  await Bun.sleep(80);
  const third = cache.write(MESH, source, files("three"), 2);
  expect(existsSync(first.raw!)).toBe(false);
  // The generation superseded just now is kept for its own grace period.
  expect(existsSync(second.raw!)).toBe(true);
  expect(readdirSync(join(cache.entryDirectory(MESH, source))).sort()).toEqual(["entry.json", second.raw!.split(/[\\/]/).at(-2)!, third.raw!.split(/[\\/]/).at(-2)!].sort());
});

test("an entry written before generations is read as it is, and its flat files are retired, not deleted, by a rewrite", async () => {
  const { source, cache, files } = setup(50);
  // An entry as the cache wrote it before generations: its files beside entry.json.
  const directory = cache.entryDirectory(MESH, source);
  mkdirSync(directory, { recursive: true });
  const old = files("old"), meta: { files: Record<string, { sha256: string; bytes: number }> } & Record<string, unknown> = {
    schema: "xfs/game-asset-export-1", version: GAME_ASSET_EXPORT_VERSION, depotPath: MESH, hash: depotHash(MESH),
    source: (cache as unknown as { sourceKey(source: unknown): string }).sourceKey(source), files: {}, rawChecked: true };
  for (const [name, from] of Object.entries(old)) {
    writeFileSync(join(directory, name), readFileSync(from));
    meta.files[name] = { sha256: fileSha256(from), bytes: readFileSync(from).length };
  }
  writeFileSync(join(directory, "entry.json"), JSON.stringify(meta));
  // Its files look old (written long ago); the rewrite's grace starts when it retires them.
  const long = Date.now() / 1000 - 3600;
  for (const name of Object.keys(old)) utimesSync(join(directory, name), long, long);
  const held = cache.read(MESH, source)!;
  expect(held.raw).toBe(join(directory, "raw"));
  const next = cache.write(MESH, source, files("new"), 1);
  expect(readFileSync(held.raw!, "utf8")).toBe("raw old");
  expect(cache.read(MESH, source)).toBeNull(); // One partial run: not served yet.
  await Bun.sleep(80);
  cache.write(MESH, source, files("newer"), 2);
  expect(existsSync(held.raw!)).toBe(false);
  expect(existsSync(next.raw!)).toBe(true);
});
