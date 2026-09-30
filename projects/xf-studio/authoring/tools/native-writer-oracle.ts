/**
 * The native resource writer's oracle (PIPE-130): WolvenKit's own conversions of a real Build, kept privately, against which the native
 * writer is compared byte for byte (tests/native-writer.test.ts reads the same folder).
 *
 *   bun tools/native-writer-oracle.ts capture <kept Build work folder> <name>
 *   bun tools/native-writer-oracle.ts compare [name]
 *
 * `capture` takes a Build that WolvenKit wrote (run the Build with XFS_NATIVE_WRITER=off and keep its work folder, e.g.
 * `bun tools/build-bench.ts <collection> <scratch> 1 --keep`) and copies into the oracle folder (default: the ignored
 * `data/native-writer-oracle/<name>`): the builder's JSON documents and DDS inputs with each texture group's import settings, WolvenKit's
 * resources (its staging tree) and WolvenKit's archive. The files are game-derived: they stay in ignored private folders.
 * `compare` writes every resource and the archive natively (the game's Oodle from the configured game folder, XF Studio's texture
 * compressor) and reports, per file, whether the bytes are identical; the archive is compared except the file times its index records
 * and the index CRC that covers them.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LocalSettingsStore } from "../src/local-settings-store";
import { loadGameOodle } from "../src/native/oodle";
import { loadBcnLibrary } from "../src/native/write/bcn";
import { writeCr2wDocument } from "../src/native/write/cr2w-writer";
import { archiveEqualExceptTimes, fileTimeOf, packArchive, walkOrder } from "../src/native/write/rdar-writer";
import { karkSegment, LEVEL_OPTIMAL2 } from "../src/native/write/segments";
import { importTexture } from "../src/native/write/xbm-writer";
import { TEXTURE_GROUP_SETTINGS } from "../src/package-resource-builder";

const app = resolve(import.meta.dir, "..");
const DEFAULT_ORACLE = resolve(app, "data", "native-writer-oracle");
const [mode, first, second] = process.argv.slice(2);

const listFiles = (root: string): string[] => readdirSync(root, { recursive: true }).map(String)
  .filter(path => statSync(join(root, path)).isFile()).map(path => path.replaceAll("\\", "/")).sort();

if (mode === "capture") {
  if (!first || !second || !/^[\w-]+$/.test(second)) throw Error("Usage: bun tools/native-writer-oracle.ts capture <kept Build work folder> <name>");
  const kept = resolve(first), out = join(DEFAULT_ORACLE, second);
  const product = readdirSync(kept).map(name => join(kept, name)).find(path => existsSync(join(path, "archive")) && existsSync(join(path, "features")));
  if (!product) throw Error("No product folder with an archive and features in the kept Build.");
  const feature = join(product, "features", "eye-makeup");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "json"), { recursive: true });
  for (const folder of ["models-json", "app-json", "cc-json"])
    for (const name of readdirSync(join(feature, folder))) cpSync(join(feature, folder, name), join(out, "json", name));
  for (const [group] of TEXTURE_GROUP_SETTINGS) {
    const input = join(feature, "input", group);
    if (existsSync(input) && readdirSync(input).length) cpSync(input, join(out, "dds", group), { recursive: true });
  }
  cpSync(join(product, "archive"), join(out, "wolvenkit"), { recursive: true });
  const packed = join(product, "package", "archive", "pc", "mod");
  const archive = readdirSync(packed).find(name => name.endsWith(".archive"));
  if (!archive) throw Error("The kept Build has no packed archive.");
  cpSync(join(packed, archive), join(out, "wolvenkit.archive"));
  const build = JSON.parse(readFileSync(join(product, "build.json"), "utf8"));
  if (build.resourceWriters?.native?.length) throw Error("That Build was written natively; capture one WolvenKit wrote (XFS_NATIVE_WRITER=off).");
  writeFileSync(join(out, "oracle.json"), JSON.stringify({ captured: new Date().toISOString(), resources: listFiles(join(out, "wolvenkit")).length,
    settings: Object.fromEntries(TEXTURE_GROUP_SETTINGS) }, null, 2) + "\n");
  console.log(`Captured ${listFiles(join(out, "wolvenkit")).length} WolvenKit resources and its archive into ${out}`);
} else if (mode === "compare") {
  const names = first ? [first] : readdirSync(DEFAULT_ORACLE).filter(name => existsSync(join(DEFAULT_ORACLE, name, "oracle.json")));
  for (const name of names) { console.log(`== ${name}`); compare(join(DEFAULT_ORACLE, name)); }
} else {
  throw Error("Usage: bun tools/native-writer-oracle.ts capture <kept Build work folder> <name> | compare [name]");
}

function compare(root: string) {
  const settings = new LocalSettingsStore().load().settings;
  if (!settings.gameRoot) throw Error("Set the game folder in Settings first.");
  const oodle = loadGameOodle(settings.gameRoot);
  const bcn = loadBcnLibrary(process.env.XFS_BCN_LIBRARY ?? resolve(app, "data", "tools", "xfs-bcn", "xfs_bcn.dll"));
  const store = (raw: Uint8Array) => karkSegment(raw, LEVEL_OPTIMAL2, oodle.compress!);
  const wolvenkit = listFiles(join(root, "wolvenkit"));
  const byName = new Map(wolvenkit.map(path => [path.slice(path.lastIndexOf("/") + 1), path]));
  let failures = 0;
  const report = (name: string, got: Uint8Array, ms: number) => {
    const want = new Uint8Array(readFileSync(join(root, "wolvenkit", byName.get(name)!)));
    const same = got.length === want.length && got.every((byte, i) => byte === want[i]);
    if (!same) failures++;
    console.log(`${same ? "identical" : "DIFFERENT"}  ${name}  ${got.length} bytes  ${ms.toFixed(0)} ms`);
  };
  for (const name of readdirSync(join(root, "json")).sort()) {
    const started = performance.now();
    report(name.replace(/\.json$/, ""), writeCr2wDocument(JSON.parse(readFileSync(join(root, "json", name), "utf8")), store), performance.now() - started);
  }
  const groups = new Map(TEXTURE_GROUP_SETTINGS);
  for (const group of existsSync(join(root, "dds")) ? readdirSync(join(root, "dds")) : []) for (const name of readdirSync(join(root, "dds", group)).sort()) {
    const started = performance.now();
    report(name.replace(/\.dds$/, ".xbm"), importTexture(new Uint8Array(readFileSync(join(root, "dds", group, name))), groups.get(group)!, bcn, store),
      performance.now() - started);
  }
  const staging = join(root, "wolvenkit");
  const paths = walkOrder(relative => readdirSync(join(staging, ...relative.split("\\").filter(Boolean)), { withFileTypes: true })
    .map(entry => ({ name: entry.name, folder: entry.isDirectory(), link: entry.isSymbolicLink() })));
  const started = performance.now();
  const got = packArchive(paths.map(path => ({ path, bytes: new Uint8Array(readFileSync(join(staging, ...path.split("\\")))),
    fileTime: fileTimeOf(statSync(join(staging, ...path.split("\\")), { bigint: true }).mtimeNs) })), oodle.compress!);
  const ms = performance.now() - started;
  const want = new Uint8Array(readFileSync(join(root, "wolvenkit.archive")));
  const same = archiveEqualExceptTimes(got, want);
  if (!same) failures++;
  console.log(`${same ? "identical except file times" : "DIFFERENT"}  archive  ${got.length} bytes  ${ms.toFixed(0)} ms`);
  oodle.close(); bcn.close();
  if (failures) { console.error(`${failures} file(s) differ.`); process.exitCode = 1; }
}
