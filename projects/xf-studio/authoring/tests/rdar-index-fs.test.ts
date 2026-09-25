import { afterAll, expect, test } from "bun:test";
import { readdirSync, readFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { depotHash } from "../src/depot-path";
import { archiveSourceContains, readRdarIndexCount, readRdarIndexHashes, sortedHashesContain } from "../src/rdar-index-fs";
import { readArchiveIndex } from "../src/resolver-host";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** A minimal RDAR file: header, a payload gap and an index block listing `paths`. */
function rdar(paths: string[]): Uint8Array {
  const indexOffset = 64, indexSize = 28 + paths.length * 56;
  const bytes = new Uint8Array(indexOffset + indexSize);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x44, 0x41, 0x52]);
  view.setBigUint64(8, BigInt(indexOffset), true);
  view.setUint32(16, indexSize, true);
  view.setUint32(indexOffset + 16, paths.length, true);
  paths.forEach((path, i) => view.setBigUint64(indexOffset + 28 + i * 56, BigInt(depotHash(path)), true));
  return bytes;
}

test("the game's own archive indexes say whether a resource exists, without reading payloads", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-rdar-")); roots.push(root);
  writeFileSync(join(root, "basegame_1.archive"), rdar(["base\\a.mesh", "base\\b.mesh"]));
  writeFileSync(join(root, "basegame_2.archive"), rdar(["base\\c.morphtarget"]));
  writeFileSync(join(root, "notes.txt"), "ignored");
  const hashes = readRdarIndexHashes(join(root, "basegame_1.archive"));
  expect(hashes).toHaveLength(2);
  expect(sortedHashesContain(hashes, BigInt(depotHash("base\\b.mesh")))).toBe(true);
  expect(sortedHashesContain(hashes, BigInt(depotHash("base\\z.mesh")))).toBe(false);
  const wanted = ["base\\a.mesh", "base\\c.morphtarget", "base\\missing.mesh"].map(depotHash);
  expect([...archiveSourceContains(root, wanted)].sort()).toEqual([wanted[0], wanted[1]].sort());
  expect([...archiveSourceContains(join(root, "basegame_2.archive"), wanted)]).toEqual([wanted[1]]);
  // A source with no readable index is an error, never "not present".
  const broken = mkdtempSync(join(tmpdir(), "xfs-rdar-broken-")); roots.push(broken);
  writeFileSync(join(broken, "basegame_1.archive"), "not an archive");
  expect(() => archiveSourceContains(broken, wanted)).toThrow("No readable archive index");
});

test("the resolver's index cache holds only complete indexes; a short one is deleted and read again (PREV-47)", () => {
  const root = mkdtempSync(join(tmpdir(), "xfs-rdar-cache-")); roots.push(root);
  const archive = join(root, "mod.archive"), cache = join(root, "cache");
  writeFileSync(archive, rdar(["base\\a.mesh", "base\\b.mesh", "base\\c.mesh"]));
  expect(readRdarIndexCount(archive)).toBe(3);
  expect(readArchiveIndex(archive, cache)).toHaveLength(3);
  const [name] = readdirSync(join(cache, "index"));
  const file = join(cache, "index", name!);
  expect(statSync(file).size).toBe(24);
  expect(readdirSync(join(cache, "index"))).toEqual([name]); // no staging files left behind
  // A first scan killed mid-write left an empty or partial file: it is not trusted, and the complete index replaces it.
  for (const damaged of [new Uint8Array(0), readFileSync(file).subarray(0, 8)]) {
    writeFileSync(file, damaged);
    const hashes = readArchiveIndex(archive, cache);
    expect(hashes).toHaveLength(3);
    expect(sortedHashesContain(hashes, BigInt(depotHash("base\\c.mesh")))).toBe(true);
    expect(statSync(file).size).toBe(24);
  }
});
