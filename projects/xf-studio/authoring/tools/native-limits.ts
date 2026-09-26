/**
 * Measures real resources against the native reader's budgets (src/native/limits.ts), so the caps can be derived from data and
 * re-derived after a game patch (R&D; read-only towards the game and mods). Three passes:
 *
 * 1. Every archive's index (game groups, the ArchiveXL bundle and, with `--mods`, every MO2 mod's `archive/pc/mod`): body, buffer
 *    and resource sizes and name-block lengths, read from the indexes alone.
 * 2. Every resource whose body is at least `--big` bytes (default 1 MiB): read and decompressed to learn its root class, so the
 *    largest resource of each verified root class is known.
 * 3. With `--cache`, every resource of the resolver's JSON cache decoded with no caps: decoded bytes, values, JSON values, nesting,
 *    longest name, largest parsed buffer and decode time, plus the notes and watched-default reports the reader makes.
 *
 *   bun tools/native-limits.ts --game <game folder> [--mods <MO2 mods folder>] [--cache <resolver-cache/json>] [--big <bytes>]
 *
 * The output names no mods: archive names are replaced by their group (content, ep1, mod, bundle, mo2).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NativeArchive, NativeArchivePool } from "../src/native/archive-reader";
import { Cr2wFile } from "../src/native/cr2w-file";
import { DecodeSession, UNLIMITED } from "../src/native/limits";
import { NATIVE_ROOTS } from "../src/native/native-fetch-port";
import { loadGameOodle } from "../src/native/oodle";
import { readResource } from "../src/native/resource-document";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const game = option("game"), mods = option("mods"), cache = option("cache"), big = Number(option("big") ?? 2 ** 20);
if (!game) { console.error("usage: bun tools/native-limits.ts --game <folder> [--mods <MO2 mods>] [--cache <json folder>] [--big <bytes>]"); process.exit(2); }

const archives: { path: string; group: string }[] = [];
const addDir = (dir: string, group: string) => { if (existsSync(dir)) for (const name of readdirSync(dir)) if (name.toLowerCase().endsWith(".archive")) archives.push({ path: join(dir, name), group }); };
for (const group of ["content", "ep1", "mod"]) addDir(join(game, "archive", "pc", group), group);
addDir(join(game, "red4ext", "plugins", "ArchiveXL", "Bundle"), "bundle");
if (mods && existsSync(mods)) for (const mod of readdirSync(mods)) addDir(join(mods, mod, "archive", "pc", "mod"), "mo2");

const oodle = loadGameOodle(game);
const max = { body: 0, bodyStored: 0, buffer: 0, bufferStored: 0, resource: 0, segments: 0, nameBlock: 0, nameList: 0, entries: 0 };
const bigOnes: { archive: NativeArchive; group: string; hash: string; body: number; resource: number }[] = [];
let entries = 0, unreadable = 0;
const malformed = new Map<string, number>();
const started = performance.now();
for (const { path, group } of archives) {
  let archive: NativeArchive;
  try { archive = NativeArchive.open(path, oodle.decompress, UNLIMITED); } catch { unreadable++; continue; }
  max.entries = Math.max(max.entries, archive.index.fileCount);
  max.nameBlock = Math.max(max.nameBlock, archive.index.header.customDataLength);
  if (archive.index.header.customDataLength) try { max.nameList = Math.max(max.nameList, archive.names().join("\0").length); } catch { /* not an LXRS block */ }
  for (let i = 0; i < archive.index.fileCount; i++) {
    entries++;
    let entry, segments;
    try { entry = archive.index.entryAt(i); segments = archive.index.segments(entry); }
    catch { malformed.set(group, (malformed.get(group) ?? 0) + 1); continue; }
    const body = segments[0]!;
    let resource = body.size;
    max.body = Math.max(max.body, body.size); max.bodyStored = Math.max(max.bodyStored, body.storedSize);
    max.segments = Math.max(max.segments, segments.length);
    for (const segment of segments.slice(1)) {
      max.buffer = Math.max(max.buffer, segment.size); max.bufferStored = Math.max(max.bufferStored, segment.storedSize);
      resource += segment.storedSize;
    }
    max.resource = Math.max(max.resource, resource);
    if (body.size >= big) bigOnes.push({ archive, group, hash: entry.hash, body: body.size, resource });
  }
}
const indexMs = performance.now() - started;

// Pass 2: the root class of every big resource.
type ClassRow = { count: number; body: number; resource: number; groups: Set<string> };
const byClass = new Map<string, ClassRow>();
for (const item of bigOnes) {
  let root = "(unreadable)";
  try { root = new Cr2wFile(item.archive.read(item.hash)!, new DecodeSession(UNLIMITED)).exports[0]?.className ?? "(no exports)"; } catch { /* not CR2W */ }
  const row = byClass.get(root) ?? { count: 0, body: 0, resource: 0, groups: new Set<string>() };
  row.count++; row.body = Math.max(row.body, item.body); row.resource = Math.max(row.resource, item.resource); row.groups.add(item.group);
  byClass.set(root, row);
}
const verifiedBig = [...byClass].filter(([name]) => NATIVE_ROOTS.has(name));

// Pass 3: the resolver cache, decoded without caps.
const usage = { decodedBytes: 0, nodes: 0, jsonNodes: 0, depth: 0, longestName: 0, largestBuffer: 0, ms: 0, resourceBytes: 0 };
const notes = new Map<string, number>(), defaulted = new Map<string, number>();
let cached = 0;
if (cache) {
  const byName = new Map<string, string[]>();
  for (const { path } of archives) { const name = path.split(/[\\/]/).pop()!; byName.set(name, [...(byName.get(name) ?? []), path]); }
  const pool = new NativeArchivePool(oodle.decompress, 64, UNLIMITED);
  const seen = new Set<string>();
  for (const name of readdirSync(cache).filter(file => file.endsWith(".json")).sort()) {
    const { meta } = JSON.parse(readFileSync(join(cache, name), "utf8")) as { meta: { hash: string; archive: string; extractedSha256: string } };
    const key = `${meta.archive}|${meta.hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const path of byName.get(meta.archive) ?? []) {
      const archive = pool.get(path);
      if (!archive.has(meta.hash)) continue;
      const bytes = archive.read(meta.hash)!;
      if (createHash("sha256").update(bytes).digest("hex") !== meta.extractedSha256) continue;
      cached++;
      usage.resourceBytes = Math.max(usage.resourceBytes, bytes.length);
      const start = performance.now();
      try {
        const result = readResource(bytes, oodle.decompress, { buffers: "trim" }, UNLIMITED);
        usage.ms = Math.max(usage.ms, performance.now() - start);
        for (const key of ["decodedBytes", "nodes", "jsonNodes", "depth", "longestName", "largestBuffer"] as const) usage[key] = Math.max(usage[key], result.usage[key]);
        for (const note of result.notes) notes.set(`${note.property}: ${note.stored} (RTTI ${note.rtti})`, (notes.get(`${note.property}: ${note.stored} (RTTI ${note.rtti})`) ?? 0) + 1);
        for (const row of result.defaulted) defaulted.set(row.property, (defaulted.get(row.property) ?? 0) + row.count);
      } catch (error) { notes.set(`refused: ${(error as Error).name}`, (notes.get(`refused: ${(error as Error).name}`) ?? 0) + 1); }
      break;
    }
  }
  pool.close();
}
oodle.close();

const mib = (bytes: number) => Math.round(bytes / 2 ** 20 * 100) / 100;
console.log(JSON.stringify({
  archives: archives.length, unreadable, entries, malformedEntries: Object.fromEntries(malformed), indexMs: Math.round(indexMs),
  indexMaxima: { bodyMiB: mib(max.body), bodyStoredMiB: mib(max.bodyStored), bufferMiB: mib(max.buffer), bufferStoredMiB: mib(max.bufferStored),
    resourceMiB: mib(max.resource), segments: max.segments, entriesInOneArchive: max.entries, nameBlockMiB: mib(max.nameBlock), nameListMiB: mib(max.nameList) },
  bigResources: { threshold: big, count: bigOnes.length,
    verifiedRootClasses: Object.fromEntries(verifiedBig.map(([name, row]) => [name, { count: row.count, bodyMiB: mib(row.body), resourceMiB: mib(row.resource), groups: [...row.groups] }])),
    largestOtherClasses: Object.fromEntries([...byClass].filter(([name]) => !NATIVE_ROOTS.has(name)).sort((a, b) => b[1].body - a[1].body).slice(0, 8)
      .map(([name, row]) => [name, { count: row.count, bodyMiB: mib(row.body), resourceMiB: mib(row.resource) }])) },
  resolverCache: cache ? { resources: cached, maxima: { ...usage, decodedMiB: mib(usage.decodedBytes), largestBufferMiB: mib(usage.largestBuffer), resourceMiB: mib(usage.resourceBytes), ms: Math.round(usage.ms) },
    notes: Object.fromEntries(notes), defaulted: Object.fromEntries(defaulted) } : null,
}, null, 1));
