/**
 * Benchmark and byte-identity check of the native archive reader against WolvenKit CLI `unbundle` (R&D; read-only towards the
 * game). For each archive it picks `--count` entries spread evenly through the index (so types are mixed), extracts them with one
 * `unbundle --hash` launch into a temporary folder, reads the same entries in-process, and compares the bytes.
 *
 *   bun tools/native-archive-bench.ts --game <game folder> --cli <WolvenKit.CLI.exe> [--count 60] [--archive <path>]...
 *
 * Without `--archive` it uses the game's basegame_4_appearance.archive and basegame_1_engine.archive. Prints a JSON summary.
 */
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { depotHash } from "../src/depot-path";
import { NativeArchive } from "../src/native/archive-reader";
import { loadGameOodle } from "../src/native/oodle";
import { runWolvenKit } from "../src/wolvenkit-cli";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const game = option("game"), cli = option("cli"), count = Number(option("count") ?? 60);
if (!game || !cli) { console.error("usage: bun tools/native-archive-bench.ts --game <folder> --cli <WolvenKit.CLI.exe> [--count N] [--archive path]..."); process.exit(2); }
const archives = args.flatMap((arg, i) => arg === "--archive" ? [args[i + 1]!] : []);
if (!archives.length) archives.push(join(game, "archive", "pc", "content", "basegame_4_appearance.archive"), join(game, "archive", "pc", "content", "basegame_1_engine.archive"));

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const walk = (root: string, folder = root, out = new Map<string, { file: string; path: string | null }>()) => {
  for (const name of readdirSync(folder)) {
    const full = join(folder, name);
    if (lstatSync(full).isDirectory()) { walk(root, full, out); continue; }
    const rel = relative(root, full).split(sep).join("\\");
    const numeric = /^(\d+)\.[^.\\]+$/.exec(rel);
    out.set(numeric ? BigInt(numeric[1]!).toString() : depotHash(rel), { file: full, path: numeric ? null : rel });
  }
  return out;
};

const t0 = performance.now();
const oodle = loadGameOodle(game);
const oodleMs = performance.now() - t0;
const results = [];
for (const path of archives) {
  const openStart = performance.now();
  const archive = NativeArchive.open(path, oodle.decompress);
  const openMs = performance.now() - openStart;
  const stride = Math.max(1, Math.floor(archive.index.fileCount / count));
  const picked = Array.from(archive.index.hashes, hash => hash.toString()).filter((_, i) => i % stride === 0).slice(0, count);
  const work = mkdtempSync(join(tmpdir(), "xfs-native-bench-"));
  try {
    writeFileSync(join(work, "hashes.txt"), picked.join("\n") + "\n");
    const wkStart = performance.now();
    const run = await runWolvenKit(cli, ["unbundle", path, "-o", join(work, "out"), "--hash", join(work, "hashes.txt")], { timeoutMs: 600_000, keep: 16_000, accept: () => true });
    const wolvenKitMs = performance.now() - wkStart;
    const written = walk(join(work, "out"));
    const readStart = performance.now();
    const native = new Map(picked.map(hash => [hash, archive.read(hash)!]));
    const nativeMs = performance.now() - readStart;
    const kinds = new Map<string, number>();
    let identical = 0, differ: string[] = [], missing = 0, bytes = 0;
    for (const hash of picked) {
      const hit = written.get(hash);
      if (!hit) { missing++; continue; }
      const mine = native.get(hash)!;
      bytes += mine.length;
      const kind = hit.path ? (/\.([a-z0-9]+)$/i.exec(hit.path)?.[1] ?? "?") : "(unnamed)";
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      if (sha(mine) === sha(readFileSync(hit.file))) identical++; else differ.push(hit.path ?? hash);
    }
    results.push({ archive: archive.name, entries: archive.index.fileCount, picked: picked.length, wolvenKitExit: run.exitCode,
      wolvenKitMs: Math.round(wolvenKitMs), nativeOpenMs: Math.round(openMs * 10) / 10, nativeReadMs: Math.round(nativeMs * 10) / 10,
      nativePerResourceMs: Math.round(nativeMs / picked.length * 1000) / 1000, megabytes: Math.round(bytes / 1e5) / 10,
      identical, differ, missingFromWolvenKit: missing, kinds: Object.fromEntries([...kinds].sort((a, b) => b[1] - a[1])) });
  } finally { archive.close(); rmSync(work, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ oodle: oodle.identity, oodleLoadMs: Math.round(oodleMs * 10) / 10, results }, null, 1));
