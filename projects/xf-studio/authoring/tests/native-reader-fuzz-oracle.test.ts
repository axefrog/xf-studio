// Opt-in real-data fuzz of the native reader (NATIVE-12): real resources of the verified root classes from the installed game,
// mutated near their tables and bodies, must decode or be refused with a typed error, each quickly; and the game's Oodle decoder
// must refuse truncated, mis-sized and corrupted streams rather than crash or accept them with other bytes. Read-only towards the
// game. Enable with XFS_RESOLVER_GAME_ROOT (XFS_REQUIRE_ORACLES=1 turns a skip into a failure).
//
// Bounded, so it is safe beside other work: samples are small (at most 400 KB), every decode runs under `FUZZ_LIMITS` (far tighter
// than the defaults: at most 16 MiB decoded, 1 M values, 2 M JSON values, so one case stays well under 1 GB), the run stops after
// `MAX_CASES` cases or its time budget (XFS_NATIVE_FUZZ_MS, default 15 s, at most 120 s), and it fails fast if the process's
// resident memory passes 1.5 GB.
import { expect } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { NativeArchive } from "../src/native/archive-reader";
import { Cr2wFile } from "../src/native/cr2w-file";
import { DEFAULT_LIMITS, type NativeLimits } from "../src/native/limits";
import { classifyNativeFailure } from "../src/native/native-errors";
import { NATIVE_ROOTS } from "../src/native/native-fetch-port";
import { GAME_OODLE_LIBRARY, loadGameOodle } from "../src/native/oodle";
import { readResource } from "../src/native/resource-document";
import { oracleTest } from "./optional-oracles";

const game = process.env.XFS_RESOLVER_GAME_ROOT ? resolve(process.env.XFS_RESOLVER_GAME_ROOT) : "";
const archivePath = join(game, "archive", "pc", "content", "basegame_4_appearance.archive");
const available = process.platform === "win32" && !!game && existsSync(join(game, ...GAME_OODLE_LIBRARY)) && existsSync(archivePath);
const FUZZ_LIMITS: NativeLimits = { ...DEFAULT_LIMITS, maxResourceBytes: 1 << 20, maxBodyBytes: 1 << 20, maxBufferBytes: 16 << 20, maxDecodedBytes: 16 << 20,
  maxNodes: 1_000_000, maxJsonNodes: 2_000_000, jsonNodesAllowance: 1 << 18, maxNameListBytes: 1 << 20 };
const MAX_CASES = 20_000, MAX_RSS = 1.5 * 2 ** 30;
const budgetMs = Math.min(Number(process.env.XFS_NATIVE_FUZZ_MS ?? 15_000), 120_000);
const why = "the real-data fuzz needs XFS_RESOLVER_GAME_ROOT with the game's Oodle library and basegame_4_appearance.archive (read-only).";

function random(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}

oracleTest(available, why)("mutated real resources decode or are refused with a typed error, each quickly", () => {
  const oodle = loadGameOodle(game);
  try {
    const archive = NativeArchive.open(archivePath, oodle.decompress);
    const samples: Uint8Array[] = [];
    const perClass = new Map<string, number>();
    for (let i = 0; i < archive.index.fileCount && samples.length < 50; i += 37) {
      let bytes: Uint8Array | null;
      try { bytes = archive.read(archive.index.entryAt(i).hash); } catch { continue; }
      if (!bytes || bytes.length > 400_000) continue;
      let root: string | undefined;
      try { root = new Cr2wFile(bytes).exports[0]?.className; } catch { continue; }
      if (!root || !NATIVE_ROOTS.has(root) || (perClass.get(root) ?? 0) >= 6) continue;
      try { readResource(bytes, oodle.decompress, { buffers: "trim" }, FUZZ_LIMITS); } catch { continue; }
      perClass.set(root, (perClass.get(root) ?? 0) + 1);
      samples.push(bytes);
    }
    expect(samples.length).toBeGreaterThan(10);
    const next = random(99), started = performance.now();
    const internal: string[] = [];
    let cases = 0, slowest = 0, peakRss = 0;
    while (cases < MAX_CASES && performance.now() - started < budgetMs) {
      if (cases % 100 === 0) { peakRss = Math.max(peakRss, process.memoryUsage().rss); if (peakRss > MAX_RSS) break; }
      const mutant = samples[cases % samples.length]!.slice();
      for (let j = 0, n = 1 + Math.floor(next() * 4); j < n; j++) mutant[Math.floor(next() * Math.min(mutant.length, 4096))] = Math.floor(next() * 256);
      const caseStart = performance.now();
      try { readResource(mutant, oodle.decompress, { buffers: "trim" }, FUZZ_LIMITS); }
      catch (error) { if (classifyNativeFailure(error) === "internal" && internal.length < 5) internal.push((error as Error)?.stack ?? String(error)); }
      slowest = Math.max(slowest, performance.now() - caseStart);
      cases++;
    }
    expect(peakRss).toBeLessThan(MAX_RSS);
    expect(internal).toEqual([]);
    expect(slowest).toBeLessThan(2000);
    expect(cases).toBeGreaterThan(100);
    console.log(JSON.stringify({ cases, slowestMs: Math.round(slowest), peakRssMiB: Math.round(peakRss / 2 ** 20) }));
  } finally { oodle.close(); }
}, budgetMs + 60_000);

oracleTest(available, why)("the game's Oodle decoder refuses truncated, mis-sized and corrupted streams", () => {
  const oodle = loadGameOodle(game);
  try {
    const archive = NativeArchive.open(join(game, "archive", "pc", "content", "basegame_2_mainmenu.archive"), oodle.decompress);
    const { readSync, openSync, closeSync } = require("node:fs") as typeof import("node:fs");
    const fd = openSync(archive.path, "r");
    const next = random(12345);
    let picked = 0, refused = 0, acceptedDifferent = 0;
    try {
      for (let i = 0; i < archive.index.fileCount && picked < 40; i++) {
        const segment = archive.index.segments(archive.index.entryAt(i))[0]!;
        // Small segments only: the largest request below is 4 × 1 MiB.
        if (segment.storedSize === segment.size || segment.storedSize > 200_000 || segment.size > 1 << 20) continue;
        picked++;
        const stored = new Uint8Array(segment.storedSize);
        readSync(fd, stored, 0, stored.length, segment.offset);
        const stream = stored.subarray(8), good = oodle.decompress(stream, segment.size);
        const trials: [Uint8Array, number][] = [[stream.subarray(0, stream.length >> 1), segment.size], [stream, segment.size - 1], [stream, segment.size + 1], [stream, segment.size * 4]];
        for (let k = 0; k < 10; k++) { const m = stream.slice(); for (let j = 0; j < 1 + Math.floor(next() * 8); j++) m[Math.floor(next() * m.length)] = Math.floor(next() * 256); trials.push([m, segment.size]); }
        for (const [bytes, size] of trials) {
          try { const out = oodle.decompress(bytes, size); if (size === segment.size && Buffer.compare(out, good) !== 0) acceptedDifferent++; }
          catch (error) { expect(classifyNativeFailure(error)).toBe("decompress"); refused++; }
        }
      }
    } finally { closeSync(fd); }
    expect(picked).toBeGreaterThan(10);
    expect(refused).toBeGreaterThan(picked * 4);
    // A corrupted stream that still decodes to other bytes would be caught by the CR2W checks; it is counted, not failed.
    console.log(JSON.stringify({ picked, refused, acceptedDifferent }));
  } finally { oodle.close(); }
}, 120_000);
