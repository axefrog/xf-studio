import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { depotPath, expectedPaths, inventoryFromFiles, pathHash } from "../src/archive-inventory";
import { archiveInventory } from "../src/archive-inventory-fs";
import { oracleTest } from "./optional-oracles";

const study = resolve(import.meta.dir, "../../../../experiments/005-preset-collection");
const plan = {
  mesh: "xfs/eye/xfs_plate.mesh", morph: "xfs/eye/xfs_plate.morphtarget", app: "xfs/eye/xfs_eye.app",
  customization: "xfs/eye/xfs_eye.inkcharcustomization",
  presets: ["a", "b"].map(id => ({ textures: {
    diffuse: `xfs/eye/textures/xfs_${id}_diffuse.xbm`, roughness: `xfs/eye/textures/xfs_${id}_roughness.xbm`,
    metalness: `xfs/eye/textures/xfs_${id}_metalness.xbm` } })),
};
const allPaths = [...expectedPaths(plan)];

test("canonical depot paths convert to WolvenKit's backslash form", () => {
  expect(depotPath("xfs/eye/xfs_plate.mesh")).toBe("xfs\\eye\\xfs_plate.mesh");
  expect(depotPath("a/b-c/d.e_f.xbm")).toBe("a\\b-c\\d.e_f.xbm");
});

test("noncanonical, aliased, hash-override and unsupported paths are refused", () => {
  for (const bad of ["", "/abs/x.xbm", "a\\b.xbm", "A/b.xbm", "a/./b.xbm", "a/../b.xbm", "a//b.xbm", "a/b..xbm/.",
    "a /b.xbm", "a/-b.xbm", "a/b.xbm.", "a/b.", "a/é.xbm", 42, null])
    expect(() => depotPath(bad)).toThrow();
  expect(() => depotPath("123.xbm")).toThrow("hash-override");
  expect(() => depotPath("1/x.xbm")).not.toThrow();
  for (const bad of ["a/b.png", "a/b.json", "a/b", "a/.xbm", "a/b.XBM"]) expect(() => depotPath(bad)).toThrow();
});

test("FNV-1a 64 path hashes use the backslash path's UTF-8 bytes", () => {
  const manual = (text: string) => {
    let h = 0xcbf29ce484222325n;
    for (const byte of Buffer.from(text, "utf8")) h = ((h ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
    return h;
  };
  for (const path of allPaths) expect(pathHash(path)).toBe(manual(path.replaceAll("/", "\\")));
  expect(pathHash("a/b.xbm")).not.toBe(manual("a/b.xbm"));
});

test("plans with duplicate or invalid paths are refused", () => {
  expect(() => expectedPaths({ ...plan, morph: plan.mesh })).toThrow("duplicate");
  expect(() => expectedPaths({ ...plan, app: "Bad/x.app" })).toThrow("Noncanonical");
  expect(expectedPaths(plan).size).toBe(4 + 3 * plan.presets.length);
});

const files = (paths: string[]) => paths.map((path, i) => ({ path, bytes: i, sha256: String(i).padStart(64, "0") }));

test("the inventory equals the plan exactly and is sorted by code point", () => {
  const entries = inventoryFromFiles(files([...allPaths].reverse()), plan);
  expect(entries.map(e => e.path)).toEqual([...allPaths].sort());
  expect(entries[0].depotPathHash64).toBe(pathHash(entries[0].path).toString());
  expect(() => inventoryFromFiles(files(allPaths.slice(1)), plan)).toThrow(`missing=["${allPaths[0]}"]`);
  expect(() => inventoryFromFiles(files([...allPaths, "xfs/eye/extra.xbm"]), plan)).toThrow('extra=["xfs/eye/extra.xbm"]');
  expect(() => inventoryFromFiles(files([...allPaths, "xfs/eye/stray.png"]), plan)).toThrow("Unsupported");
  expect(() => inventoryFromFiles(files([...allPaths, allPaths[0]]), plan)).toThrow("collision");
});

function tree() {
  const root = mkdtempSync(resolve(tmpdir(), "xfs-inventory-"));
  for (const [i, path] of allPaths.entries()) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), `payload ${i}`);
  }
  return root;
}

test("the filesystem adapter hashes real files and refuses links", () => {
  const root = tree();
  try {
    const entries = archiveInventory(root, plan);
    expect(entries).toHaveLength(allPaths.length);
    const first = entries.find(e => e.path === plan.mesh)!;
    expect(first.bytes).toBe(`payload 0`.length);
    expect(first.sha256).toBe(new Bun.CryptoHasher("sha256").update("payload 0").digest("hex"));
    writeFileSync(resolve(root, "xfs/eye/notes.txt"), "x");
    expect(() => archiveInventory(root, plan)).toThrow("Unsupported");
    rmSync(resolve(root, "xfs/eye/notes.txt"));
    const target = mkdtempSync(resolve(tmpdir(), "xfs-inventory-target-"));
    try {
      symlinkSync(target, resolve(root, "xfs/linked"), "junction");
      expect(() => archiveInventory(root, plan)).toThrow("symlink");
    } finally { rmSync(resolve(root, "xfs/linked"), { force: true }); rmSync(target, { recursive: true, force: true }); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const python = process.env.XFS_PYTHON || "python";
const oracle = (() => {
  try { return Bun.spawnSync([python, "-c", "import sys"], { cwd: study, stdout: "pipe", stderr: "pipe" }).exitCode === 0; }
  catch { return false; }
})();
const oracleCase = oracleTest(oracle, "the archive_inventory.py oracle comparison needs Python (set XFS_PYTHON).");

oracleCase("inventory records are identical to the Python archive_inventory.py oracle", () => {
  const root = tree();
  try {
    const run = Bun.spawnSync([python, "-c",
      "import json,sys\nfrom archive_inventory import inventory\nprint(json.dumps(inventory(sys.argv[1],json.loads(sys.argv[2]))))",
      root, JSON.stringify(plan)], { cwd: study, stdout: "pipe", stderr: "pipe" });
    expect(run.stderr.toString()).toBe("");
    expect(archiveInventory(root, plan)).toEqual(JSON.parse(run.stdout.toString()));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

oracleCase("path acceptance and hashes agree with the Python oracle", () => {
  const candidates = [...allPaths, "", "/a.xbm", "a\b.xbm", "A/b.xbm", "a/./b.xbm", "a/../b.xbm", "a//b.xbm", "a/b.xbm.",
    "a/-b.xbm", "a/b.png", "a/.xbm", "a/b.XBM", "123.xbm", "1/x.xbm", "a/b.c.app", "a/é.xbm", "a/b c.xbm", "_/_.mesh"];
  const run = Bun.spawnSync([python, "-c", `
import json,sys
from archive_inventory import path_hash
out=[]
for p in json.loads(sys.argv[1]):
    try: out.append(str(path_hash(p)))
    except ValueError: out.append(None)
print(json.dumps(out))`, JSON.stringify(candidates)], { cwd: study, stdout: "pipe", stderr: "pipe" });
  expect(run.stderr.toString()).toBe("");
  const typescript = candidates.map(path => { try { return pathHash(path).toString(); } catch { return null; } });
  expect(typescript).toEqual(JSON.parse(run.stdout.toString()));
});
