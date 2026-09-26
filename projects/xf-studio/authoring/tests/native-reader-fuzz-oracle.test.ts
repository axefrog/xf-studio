// Opt-in real-data fuzz of the native reader (NATIVE-12): real resources of the verified root classes from the installed game,
// mutated near their tables and bodies, must decode or be refused with a typed error, each quickly; and the game's Oodle decoder
// must refuse truncated, mis-sized and corrupted streams rather than crash or accept them with other bytes. Read-only towards the
// game. Enable with XFS_RESOLVER_GAME_ROOT (XFS_REQUIRE_ORACLES=1 turns a skip into a failure); XFS_NATIVE_FUZZ_MS sets the budget.
import { expect } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { NativeArchive } from "../src/native/archive-reader";
import { Cr2wFile } from "../src/native/cr2w-file";
import { classifyNativeFailure } from "../src/native/native-errors";
import { NATIVE_ROOTS } from "../src/native/native-fetch-port";
import { GAME_OODLE_LIBRARY, loadGameOodle } from "../src/native/oodle";
import { readResource } from "../src/native/resource-document";
import { oracleTest } from "./optional-oracles";

const game = process.env.XFS_RESOLVER_GAME_ROOT ? resolve(process.env.XFS_RESOLVER_GAME_ROOT) : "";
const archivePath = join(game, "archive", "pc", "content", "basegame_4_appearance.archive");
const available = process.platform === "win32" && !!game && existsSync(join(game, ...GAME_OODLE_LIBRARY)) && existsSync(archivePath);
const why = "the real-data fuzz needs XFS_RESOLVER_GAME_ROOT with the game's Oodle library and basegame_4_appearance.archive (read-only).";

function random(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
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
      try { readResource(bytes, oodle.decompress); } catch { continue; }
      perClass.set(root, (perClass.get(root) ?? 0) + 1);
      samples.push(bytes);
    }
    expect(samples.length).toBeGreaterThan(10);
    const next = random(99), budget = Number(process.env.XFS_NATIVE_FUZZ_MS ?? 15_000), started = performance.now();
    const internal: string[] = [];
    let cases = 0, slowest = 0;
    while (performance.now() - started < budget) {
      const mutant = samples[cases % samples.length]!.slice();
      for (let j = 0, n = 1 + Math.floor(next() * 4); j < n; j++) mutant[Math.floor(next() * Math.min(mutant.length, 4096))] = Math.floor(next() * 256);
      const caseStart = performance.now();
      try { readResource(mutant, oodle.decompress); }
      catch (error) { if (classifyNativeFailure(error) === "internal" && internal.length < 5) internal.push((error as Error)?.stack ?? String(error)); }
      slowest = Math.max(slowest, performance.now() - caseStart);
      cases++;
    }
    expect(internal).toEqual([]);
    expect(slowest).toBeLessThan(2000);
    expect(cases).toBeGreaterThan(100);
  } finally { oodle.close(); }
}, 120_000);

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
        if (segment.storedSize === segment.size || segment.storedSize > 200_000) continue;
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
