import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MountedArchive } from "../src/archive-precedence";
import { refFromPath } from "../src/depot-path";
import { NativeArchivePool } from "../src/native/archive-reader";
import { DEFAULT_LIMITS } from "../src/native/limits";
import { type NativeDecoder, WorkerDecoder } from "../src/native/native-decode";
import { classifyNativeFailure, NativeBudgetError, NativeDecompressError, NativeMalformedError, NativeUnsupportedError } from "../src/native/native-errors";
import { inProcessDecoder, NATIVE_ROOTS, type NativeFetchedResource, NativeFirstFetcher, NativeInternalError, type NativeReader, nativeReaderIdentity } from "../src/native/native-fetch-port";
import type { FetchedResource, ResourceFetchPort } from "../src/resource-graph";
import { fakeDecompress, syntheticArchive } from "./fixtures/native-archive";
import { Cr2wBuilder, prop, v } from "./fixtures/native-cr2w";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function resource(className: string, props = [prop("sampleCount", "Uint16", v.u16(16))]) {
  const file = new Cr2wBuilder(); file.export(className, props); return file.build();
}

const testWorker = new URL("./fixtures/native-decode-test-worker.ts", import.meta.url);

function setup() {
  const root = mkdtempSync(join(tmpdir(), "xfs-native-port-")); roots.push(root);
  const profile = resource("CHairProfile"), other = resource("animRig", []);
  const path = join(root, "mod.archive");
  writeFileSync(path, syntheticArchive([
    { path: "mod\\hair.hp", segments: [{ bytes: profile }] },
    { path: "mod\\slow.hp", segments: [{ bytes: profile, compress: true }] },
    { path: "mod\\rig.rig", segments: [{ bytes: other }] },
    { path: "mod\\broken.mi", segments: [{ bytes: new Uint8Array([1, 2, 3]) }] },
  ], { names: true }));
  const archive = { id: path, name: "mod.archive" } as MountedArchive;
  const asked: string[] = [];
  const fallback: ResourceFetchPort & { transient(): boolean } = {
    fetch: async (_archive, ref) => { asked.push(ref.path ?? ref.hash); return { document: { from: "fallback" }, extractedSha256: null } as FetchedResource; },
    transient: () => true,
  };
  return { profile, archive, asked, fallback };
}

function readerOver(): NativeReader {
  const pool = new NativeArchivePool(fakeDecompress);
  return { pool, decompress: fakeDecompress, identity: nativeReaderIdentity("test"), oodleSha256: "0".repeat(64), close: () => pool.close() };
}

test("the native-first port answers verified types itself and hands everything else to the fallback, counted by kind", async () => {
  const { profile, archive, asked, fallback } = setup();
  const reader = readerOver();
  const port = new NativeFirstFetcher(inProcessDecoder(reader), fallback);
  try {
    const hair = await port.fetch(archive, refFromPath("mod\\hair.hp"), "hp") as NativeFetchedResource;
    expect((hair.document as any).Data.RootChunk).toMatchObject({ $type: "CHairProfile", sampleCount: 16 });
    expect((hair.document as any).Header.XfsNativeReader).toBe(reader.identity);
    expect(hair.extractedSha256).toBe(createHash("sha256").update(profile).digest("hex"));
    expect(hair.fresh).toBe(false);
    expect(hair.notes).toEqual([]);
    expect(port.transient(archive, refFromPath("mod\\hair.hp"))).toBe(false);
    // A hash-only reference learns its path from the archive's own name list.
    const byHash = await port.fetch(archive, { hash: refFromPath("mod\\hair.hp").hash, path: null }, null);
    expect(byHash!.path).toBe("mod\\hair.hp");
    // Unverified root class, undecodable bytes and a missing hash all go to the fallback, whose transient rule then applies.
    for (const item of ["mod\\rig.rig", "mod\\broken.mi", "mod\\missing.mi"]) expect((await port.fetch(archive, refFromPath(item), null))!.document).toEqual({ from: "fallback" });
    expect(asked).toEqual(["mod\\rig.rig", "mod\\broken.mi", "mod\\missing.mi"]);
    expect(port.transient(archive, refFromPath("mod\\rig.rig"))).toBe(true);
    expect(port.stats).toMatchObject({ native: 2, fallback: 3 });
    expect(port.stats.byKind).toMatchObject({ "not-verified": 1, malformed: 1, "not-indexed": 1, internal: 0 });
    // Only the informative kinds keep a message sample.
    expect(port.stats.samples).toEqual([{ kind: "malformed", resource: "mod.archive: mod\\broken.mi", message: expect.stringContaining("Truncated CR2W") }]);
    expect(reader.identity).toMatch(/^xfs-native:\d+:[0-9a-f]{12}:test$/);
  } finally { port.close(); }
});

test("failures are classified by type, and a reader bug is internal: counted with its stack, and rethrown by a strict port", async () => {
  expect(classifyNativeFailure(new NativeMalformedError("x"))).toBe("malformed");
  expect(classifyNativeFailure(new NativeUnsupportedError("x"))).toBe("unsupported");
  expect(classifyNativeFailure(new NativeBudgetError("x"))).toBe("over-budget");
  expect(classifyNativeFailure(new NativeDecompressError("x"))).toBe("decompress");
  expect(classifyNativeFailure(Object.assign(new Error("locked"), { code: "EBUSY" }))).toBe("io");
  for (const bug of [new TypeError("x is undefined"), new RangeError("Invalid array length"), new Error("plain"), "thrown text"]) expect(classifyNativeFailure(bug)).toBe("internal");

  const { archive, fallback } = setup();
  const buggy: NativeDecoder = { identity: "t", close() {}, decode: async () => ({ ok: false, kind: "internal", message: "x is undefined", errorName: "TypeError", stack: "TypeError: x is undefined\n    at f" }) };
  const lenient = new NativeFirstFetcher(buggy, fallback);
  expect((await lenient.fetch(archive, refFromPath("mod\\hair.hp"), null))!.document).toEqual({ from: "fallback" });
  expect(lenient.stats.byKind.internal).toBe(1);
  expect(lenient.stats.internal).toEqual([{ resource: "mod.archive: mod\\hair.hp", message: "x is undefined", stack: "TypeError: x is undefined\n    at f" }]);
  const seen: string[] = [];
  const strict = new NativeFirstFetcher(buggy, fallback, { strict: true, onFallback: kind => seen.push(kind) });
  expect(strict.fetch(archive, refFromPath("mod\\hair.hp"), null)).rejects.toThrow(NativeInternalError);
  await Bun.sleep(0);
  expect(seen).toEqual(["internal"]);
  // The message sample is bounded.
  const noisy: NativeDecoder = { identity: "t", close() {}, decode: async () => ({ ok: false, kind: "malformed", message: "bad" }) };
  const port = new NativeFirstFetcher(noisy, fallback);
  for (let i = 0; i < 100; i++) await port.fetch(archive, refFromPath(`mod\\${i}.mi`), null);
  expect(port.stats.byKind.malformed).toBe(100);
  expect(port.stats.samples.length).toBe(32);
});

test("a worker decodes with a time budget: a resource over it falls back and the next one gets a fresh worker", async () => {
  const { archive, asked, fallback } = setup();
  const options = { roots: NATIVE_ROOTS, limits: DEFAULT_LIMITS, identity: nativeReaderIdentity("test") };
  const fast = new WorkerDecoder({ ...options, decompressor: { test: "fakeDecompress" }, script: testWorker, timeoutMs: 20_000 });
  const port = new NativeFirstFetcher(fast, fallback, { strict: true });
  try {
    const answers = await Promise.all(["mod\\hair.hp", "mod\\slow.hp"].map(path => port.fetch(archive, refFromPath(path), "hp")));
    for (const answer of answers) expect((answer!.document as any).Data.RootChunk).toMatchObject({ $type: "CHairProfile", sampleCount: 16 });
    expect((await port.fetch(archive, { hash: refFromPath("mod\\hair.hp").hash, path: null }, null))!.path).toBe("mod\\hair.hp");
    expect((await port.fetch(archive, refFromPath("mod\\rig.rig"), null))!.document).toEqual({ from: "fallback" });
    expect(port.stats.byKind["not-verified"]).toBe(1);
  } finally { port.close(); }

  const slow = new WorkerDecoder({ ...options, decompressor: { test: "slowDecompress" }, script: testWorker, timeoutMs: 400 });
  const timed = new NativeFirstFetcher(slow, fallback);
  try {
    const started = performance.now();
    expect((await timed.fetch(archive, refFromPath("mod\\slow.hp"), null))!.document).toEqual({ from: "fallback" });
    expect(performance.now() - started).toBeLessThan(2500);
    expect(timed.stats.byKind["over-budget"]).toBe(1);
    expect(timed.stats.samples[0]!.message).toContain("longer than 400 ms");
    // An uncompressed resource does not call the slow decoder: the replacement worker answers it.
    expect(((await timed.fetch(archive, refFromPath("mod\\hair.hp"), null))!.document as any).Data.RootChunk.$type).toBe("CHairProfile");
    expect(slow.started).toBe(2);
    expect(asked).toContain("mod\\slow.hp");
  } finally { timed.close(); }
}, 30_000);
