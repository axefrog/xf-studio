/**
 * Oracle for the native texture decoder (R&D; read-only towards the game and mods): decodes textures natively (src/native/xbm-texture.ts)
 * and compares their texels with WolvenKit's PNG exports of the same resources, which it makes with `uncook --uext png` in small batches
 * per archive (skipped when the PNG is already in `--out`, so a run can resume).
 *
 *   bun tools/native-texture-oracle.ts --game <game folder> [--mods <MO2 mods folder>] --out <folder> --wolvenkit <WolvenKit.CLI.exe> (or XFS_WOLVENKIT_CLI)
 *     (--record <character record .json> | --paths <file: one depot path per line, optionally "<depot path>\t<archive file name>">)
 *     [--max-side 4096] [--batch 8] [--limit N] [--report <file>]
 *
 * Only textures whose mip 0 fits `--max-side` are exported through WolvenKit (an 8K map costs WolvenKit gigabytes); larger ones are
 * decoded natively and reported with the mip the preview would be served. Run it under tools/memory_guard.py.
 * WolvenKit's PNG is compared with native mip 0 texel by texel, channel by channel, after both are expanded to RGBA8 (a grey PNG to
 * R = G = B), as the browser reads them.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { depotHash } from "../src/depot-path";
import { depotPathRegex } from "../src/eye-plate-wolvenkit";
import { decodePng } from "../src/png";
import { NativeArchivePool } from "../src/native/archive-reader";
import { readCr2w } from "../src/native/cr2w-reader";
import { DecodeSession } from "../src/native/limits";
import { loadGameOodle } from "../src/native/oodle";
import { TEXTURE_READ_LIMITS } from "../src/native/texture-decode";
import { decodeMip, servedMip, textureLayout } from "../src/native/xbm-texture";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const game = option("game"), out = option("out"), mods = option("mods");
const wolvenKit = option("wolvenkit") ?? process.env.XFS_WOLVENKIT_CLI;
const maxSide = Number(option("max-side") ?? 4096), batch = Number(option("batch") ?? 8), limit = Number(option("limit") ?? Infinity);
if (!game || !out || !wolvenKit || !(option("record") || option("paths"))) {
  console.error("usage: bun tools/native-texture-oracle.ts --game <folder> [--mods <MO2 mods>] --out <folder> --wolvenkit <WolvenKit.CLI.exe> (--record <file> | --paths <file>) [--max-side 4096] [--batch 8] [--limit N] [--report file]");
  process.exit(2);
}

// Archives by file name: the game's groups and ArchiveXL bundle, then every MO2 mod's archive/pc/mod.
const byName = new Map<string, string[]>();
const addDir = (dir: string) => { if (!existsSync(dir)) return; for (const name of readdirSync(dir)) if (name.toLowerCase().endsWith(".archive")) byName.set(name.toLowerCase(), [...(byName.get(name.toLowerCase()) ?? []), join(dir, name)]); };
for (const group of ["content", "ep1", "mod"]) addDir(join(game, "archive", "pc", group));
addDir(join(game, "red4ext", "plugins", "ArchiveXL", "Bundle"));
if (mods && existsSync(mods)) for (const mod of readdirSync(mods)) addDir(join(mods, mod, "archive", "pc", "mod"));
const gameArchives = ["content", "ep1"].flatMap(group => { const dir = join(game, "archive", "pc", group); return existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith(".archive")).map(n => join(dir, n)) : []; });

const oodle = loadGameOodle(game);
const pool = new NativeArchivePool(oodle.decompress);

type Wanted = { depotPath: string; archive: string };
const wanted = new Map<string, Wanted>();
const addWanted = (depotPath: string, archiveName: string | null) => {
  const hash = depotHash(depotPath);
  const candidates = archiveName ? byName.get(archiveName.toLowerCase()) ?? [] : gameArchives;
  const archive = candidates.find(path => { try { return pool.get(path).has(hash); } catch { return false; } });
  if (!archive) { console.error(`not found: ${depotPath} (${archiveName ?? "game"})`); return; }
  wanted.set(`${archive}|${hash}`, { depotPath: depotPath.toLowerCase(), archive });
};
if (option("record")) {
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.file === "string" && record.file.endsWith(".png") && Array.isArray(record.sources))
      for (const source of record.sources as { depotPath?: string; archive?: string }[])
        if (source.depotPath?.toLowerCase().endsWith(".xbm")) addWanted(source.depotPath, source.archive ?? null);
    for (const item of Object.values(record)) walk(item);
  };
  walk(JSON.parse(readFileSync(option("record")!, "utf8")));
}
if (option("paths")) for (const line of readFileSync(option("paths")!, "utf8").split(/\r?\n/)) {
  const [path, archive] = line.trim().split("\t");
  if (path) addWanted(path, archive ?? null);
}
const items = [...wanted.values()].slice(0, limit);
console.error(`${items.length} texture(s)`);

// WolvenKit exports, per archive, in batches of `batch`, of textures whose mip 0 fits `maxSide`.
type Native = { item: Wanted; format: string; compression: string; width: number; height: number; served: number; decodeMs: number; error?: string;
  image?: { width: number; height: number; data: Uint8Array } };
const natives: Native[] = [];
for (const item of items) {
  const started = performance.now();
  try {
    const bytes = pool.read(item.archive, depotHash(item.depotPath))!;
    const layout = textureLayout(readCr2w(bytes, oodle.decompress, new DecodeSession(TEXTURE_READ_LIMITS)));
    const served = servedMip(layout, maxSide);
    const image = layout.width <= maxSide && layout.height <= maxSide ? decodeMip(layout, 0) : undefined;
    const servedImage = served === 0 ? image : decodeMip(layout, served);
    natives.push({ item, format: layout.format, compression: layout.compression, width: layout.width, height: layout.height, served, image,
      decodeMs: performance.now() - started });
    void servedImage;
  } catch (error) {
    natives.push({ item, format: "?", compression: "?", width: 0, height: 0, served: -1, decodeMs: performance.now() - started, error: String((error as Error).message ?? error) });
  }
}
const pngOf = (item: Wanted) => join(out, "png", createHash("sha256").update(item.archive.toLowerCase()).digest("hex").slice(0, 12), ...item.depotPath.replace(/\.xbm$/, ".png").split("\\"));
const byArchive = new Map<string, Wanted[]>();
for (const native of natives) if (native.image && !existsSync(pngOf(native.item))) byArchive.set(native.item.archive, [...(byArchive.get(native.item.archive) ?? []), native.item]);
for (const [archive, list] of byArchive) for (let i = 0; i < list.length; i += batch) {
  const slice = list.slice(i, i + batch), dir = join(out, "png", createHash("sha256").update(archive.toLowerCase()).digest("hex").slice(0, 12));
  mkdirSync(dir, { recursive: true });
  const run = Bun.spawnSync([wolvenKit!, "uncook", archive, "-o", dir, "-r", depotPathRegex(slice.map(item => item.depotPath)), "-u", "--uext", "png", "-v", "Minimal"],
    { stdout: "pipe", stderr: "pipe" });
  console.error(`WolvenKit: ${slice.length} from ${archive.split(/[\\/]/).pop()} exit ${run.exitCode}`);
}

// Texel comparison.
type Row = { depotPath: string; archive: string; format: string; compression: string; size: string; served: string; decodeMs: number; result: string;
  maxError?: number; differing?: number; channels?: number; histogram?: Record<string, number> };
const rows: Row[] = [];
for (const native of natives) {
  const base = { depotPath: native.item.depotPath, archive: native.item.archive.split(/[\\/]/).pop()!, format: native.format, compression: native.compression,
    size: `${native.width}x${native.height}`, served: native.served >= 0 ? `mip ${native.served}` : "-", decodeMs: Math.round(native.decodeMs) };
  if (native.error) { rows.push({ ...base, result: `native refused: ${native.error}` }); continue; }
  if (!native.image) { rows.push({ ...base, result: `larger than ${maxSide}: decoded natively only` }); continue; }
  const file = pngOf(native.item);
  if (!existsSync(file)) { rows.push({ ...base, result: "WolvenKit wrote no PNG" }); continue; }
  let theirs: ReturnType<typeof decodePng>;
  try { theirs = decodePng(new Uint8Array(readFileSync(file))); } catch (error) { rows.push({ ...base, result: `PNG unreadable: ${(error as Error).message}` }); continue; }
  const mine = native.image;
  if (theirs.width !== mine.width || theirs.height !== mine.height) { rows.push({ ...base, result: `size differs: WolvenKit ${theirs.width}x${theirs.height}` }); continue; }
  let maxError = 0, differing = 0;
  const histogram: Record<string, number> = {};
  for (let i = 0; i < mine.data.length; i++) {
    const error = Math.abs(mine.data[i]! - theirs.data[i]!);
    if (error) { differing++; histogram[error] = (histogram[error] ?? 0) + 1; if (error > maxError) maxError = error; }
  }
  rows.push({ ...base, result: maxError === 0 ? "identical" : `max error ${maxError}`, maxError, differing, channels: mine.data.length, histogram });
}
const report = { maxSide, wolvenKit, rows };
if (option("report")) writeFileSync(option("report")!, JSON.stringify(report, null, 2));
for (const row of rows) console.log([row.format, row.size, row.served, `${row.decodeMs} ms`, row.result, row.differing ? `${row.differing}/${row.channels} channels` : "", row.depotPath].join("\t"));
const byFormat = new Map<string, { n: number; identical: number; max: number }>();
for (const row of rows) if (row.maxError !== undefined) {
  const entry = byFormat.get(row.format) ?? { n: 0, identical: 0, max: 0 };
  entry.n++; if (!row.maxError) entry.identical++; entry.max = Math.max(entry.max, row.maxError);
  byFormat.set(row.format, entry);
}
console.log("\nby format:", JSON.stringify(Object.fromEntries(byFormat)));
pool.close(); oodle.close();
