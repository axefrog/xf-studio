import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { depotHash } from "../src/depot-path";
import { archiveSourceContains, readRdarIndexHashes, sortedHashesContain } from "../src/rdar-index-fs";

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
