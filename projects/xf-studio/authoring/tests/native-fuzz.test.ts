// NATIVE-12: a deterministic, time-budgeted mutation fuzz of the native reader in the normal suite. Synthetic seeds cover every
// container and value path (CR2W tables, property records, material appendices, parsed buffers, packages with path and hash
// references, embedded files, archives with name lists). Each mutant must decode or be refused with a typed error (never an
// internal one: TypeError, a plain RangeError, a stack overflow), each within a time budget. The case sequence is fixed; the time
// budget only decides how many of its cases run (about 100,000 in 1.5 s). The real-data fuzz is opt-in
// (native-reader-fuzz-oracle.test.ts).
import { expect, test } from "bun:test";
import { decodeSegment } from "../src/native/kark";
import { DEFAULT_LIMITS } from "../src/native/limits";
import { classifyNativeFailure } from "../src/native/native-errors";
import { parseLxrsNames, parseRdarHeader, RDAR_CUSTOM_DATA_OFFSET, RdarIndex } from "../src/native/rdar-archive";
import { readResource } from "../src/native/resource-document";
import { fakeDecompress, kark, syntheticArchive } from "./fixtures/native-archive";
import { buildPackage, Cr2wBuilder, materialValues, prop, v } from "./fixtures/native-cr2w";

/** A 32-bit linear congruential generator: deterministic, and enough to pick mutations. */
function random(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}

function materialInstance(): Uint8Array {
  const file = new Cr2wBuilder();
  const base = file.import("base\\materials\\skin.mt");
  const texture = file.import("Base/Textures//Albedo.xbm", 4);
  file.export("CMaterialInstance", [prop("baseMaterial", "rRef:IMaterial", v.ref(base)), prop("enableMask", "Bool", v.bool(true)),
    prop("audioTag", "CName", v.cname("skin")), prop("tags", "array:String", v.array([v.string("a"), v.string("bc")]))],
    materialValues([
      { name: "Roughness", type: "Float", write: v.f32(0.15) },
      { name: "Albedo", type: "rRef:ITexture", write: v.ref(texture) },
      { name: "Tint", type: "Color", write: v.struct([prop("Red", "Uint8", v.u8(255)), prop("Alpha", "Uint8", v.u8(128))]) },
    ]));
  return file.build();
}

function mesh(): Uint8Array {
  const file = new Cr2wBuilder();
  const local = materialInstance();
  const buffer = file.buffer(kark(local), local.length);
  const render = file.buffer(new Uint8Array([1, 2, 3, 4, 5]));
  const chunk = (...flags: string[]) => v.struct([prop("lodMask", "Uint8", v.u8(1)), ...(flags.length ? [prop("renderMask", "EMeshChunkFlags", v.bitfield(...flags))] : [])]);
  file.export("CMesh", [
    prop("appearances", "array:handle:meshMeshAppearance", v.array([v.handle(1), v.handle(1)])),
    prop("localMaterialBuffer", "meshMeshMaterialBuffer", v.struct([prop("rawData", "DataBuffer", v.buffer(buffer))])),
    prop("renderResourceBlob", "handle:IRenderResourceBlob", v.handle(2)),
  ]);
  file.export("meshMeshAppearance", [prop("name", "CName", v.cname("red")), prop("chunkMaterials", "array:CName", v.array([v.cname("a"), v.cname("b")]))]);
  file.export("rendRenderMeshBlob", [prop("header", "rendRenderMeshBlobHeader", v.struct([prop("renderChunkInfos", "array:rendChunk", v.array([chunk("MCF_RenderInScene"), chunk()]))])),
    prop("renderBuffer", "DataBuffer", v.buffer(render))]);
  return file.build();
}

function packageOwner(owner: "entEntityTemplate" | "appearanceAppearanceDefinition"): Uint8Array {
  const names = ["entEntity", "entSkinnedMeshComponent", "entHardTransformBinding", "name", "CName", "mesh", "raRef:CMesh", "parentTransform",
    "handle:entITransformBinding", "bindName", "root", "hair", "chunkMask", "Uint64", "castShadows", "Bool"];
  const n = (value: string) => names.indexOf(value);
  const compiled = buildPackage({ names, refs: [{ path: owner === "entEntityTemplate" ? "Base\\Hair.mesh" : "12345678", sync: false }], cruids: [0n, 42n], rootIndex: 0, objects: [
    { type: "entEntity", fields: [] },
    { type: "entSkinnedMeshComponent", fields: [
      { name: "name", type: "CName", write: w => { w.u16(n("hair")); } },
      { name: "mesh", type: "raRef:CMesh", write: w => { w.i16(0); } },
      { name: "chunkMask", type: "Uint64", write: w => { w.u64(5n); } },
      { name: "castShadows", type: "Bool", write: w => { w.u8(1); } },
      { name: "parentTransform", type: "handle:entITransformBinding", write: w => { w.i32(2); } }] },
    { type: "entHardTransformBinding", fields: [{ name: "bindName", type: "CName", write: w => { w.u16(n("root")); } }] },
  ] });
  const file = new Cr2wBuilder();
  const buffer = file.buffer(kark(compiled), compiled.length);
  file.export(owner, [prop("compiledData", "DataBuffer", v.buffer(buffer))]);
  return file.build();
}

function materialTemplate(): Uint8Array {
  const file = new Cr2wBuilder();
  file.export("CMaterialTemplate", [prop("canHaveTangentUpdate", "Bool", v.bool(true))], (w, f) => { w.u8(2).u8(1).u16(0).u16(f.name("Roughness")).u8(2).u16(4).u16(f.name("Albedo")); });
  return file.build();
}

function embedded(): Uint8Array {
  const file = new Cr2wBuilder();
  file.export("CMaterialInstance", [prop("x", "handle:CMaterialInstance", v.handle(1))]);
  file.export("CMaterialInstance", [prop("enableMask", "Bool", v.bool(false))]);
  file.import("base\\embedded.mi");
  const body = file.build();
  const out = new Uint8Array(body.length + 16);
  out.set(body);
  const view = new DataView(out.buffer);
  view.setUint32(40 + 6 * 12, body.length, true); view.setUint32(40 + 6 * 12 + 4, 1, true);
  view.setUint32(body.length, 1, true); view.setUint32(body.length + 4, 1, true);
  return out;
}

const RESOURCE_SEEDS = [materialInstance(), mesh(), packageOwner("entEntityTemplate"), packageOwner("appearanceAppearanceDefinition"), materialTemplate(), embedded()];
const ARCHIVE_SEED = syntheticArchive([
  { path: "base\\a.mi", segments: [{ bytes: materialInstance(), compress: true }] },
  { path: "base\\b.mesh", segments: [{ bytes: mesh(), compress: true }, { bytes: new Uint8Array([7, 8, 9]), compress: true }], dependencies: ["base\\a.mi"] },
], { names: true });

/** Decode an archive held in memory, the way archive-reader.ts reads one from disk. */
function readArchive(bytes: Uint8Array): void {
  const header = parseRdarHeader(bytes.subarray(0, 44));
  if (header.indexOffset + header.indexSize > bytes.length) throw Object.assign(new Error("index outside"), { fuzzExpected: true });
  const index = new RdarIndex(header, bytes.subarray(header.indexOffset, header.indexOffset + header.indexSize), bytes.length);
  if (header.customDataLength && header.customDataLength <= DEFAULT_LIMITS.maxNameListBytes && RDAR_CUSTOM_DATA_OFFSET + header.customDataLength <= bytes.length)
    parseLxrsNames(bytes.subarray(RDAR_CUSTOM_DATA_OFFSET, RDAR_CUSTOM_DATA_OFFSET + header.customDataLength), fakeDecompress, DEFAULT_LIMITS.maxNameListBytes);
  for (let i = 0; i < Math.min(index.fileCount, 4); i++) {
    const entry = index.entryAt(i);
    index.dependencies(entry);
    const [body] = index.segments(entry);
    const decoded = decodeSegment(bytes.subarray(body!.offset, body!.offset + body!.storedSize), body!.size, fakeDecompress, DEFAULT_LIMITS.maxBodyBytes);
    readResource(decoded, fakeDecompress);
  }
}

const INTERESTING = [0, 1, 2, 0x7f, 0x80, 0xff, 0x7fff, 0xffff, 0x7fffffff, 0x80000000, 0xfffffff0, 0xffffffff];

function mutate(seed: Uint8Array, next: () => number): Uint8Array {
  const pick = (n: number) => Math.floor(next() * n);
  const position = (length: number) => next() < 0.5 ? pick(Math.min(length, 512)) : pick(length);
  let bytes = seed.slice();
  const steps = 1 + pick(4);
  for (let s = 0; s < steps; s++) {
    const how = pick(10);
    if (how < 5) for (let i = 0, n = 1 + pick(8); i < n; i++) bytes[position(bytes.length)] = pick(256);
    else if (how < 8) {
      const at = position(bytes.length) & ~1;
      if (at + 4 <= bytes.length) new DataView(bytes.buffer).setUint32(at, next() < 0.8 ? INTERESTING[pick(INTERESTING.length)]! : pick(2 ** 32), true);
    } else if (how < 9) bytes = bytes.subarray(0, pick(bytes.length));
    else {
      const from = pick(bytes.length), length = Math.min(64, bytes.length - from), at = pick(bytes.length);
      const out = new Uint8Array(bytes.length + length);
      out.set(bytes.subarray(0, at)); out.set(bytes.subarray(from, from + length), at); out.set(bytes.subarray(at), at + length);
      bytes = out;
    }
  }
  return bytes;
}

test("every seed decodes before mutation", () => {
  for (const seed of RESOURCE_SEEDS) expect(() => readResource(seed, fakeDecompress)).not.toThrow();
  expect(() => readArchive(ARCHIVE_SEED)).not.toThrow();
});

test("mutated resources and archives decode or are refused with a typed error, each quickly", () => {
  // A longer or different run: XFS_NATIVE_FUZZ_MS=60000 XFS_NATIVE_FUZZ_SEED=7 bun test tests/native-fuzz.test.ts
  const seed = Number(process.env.XFS_NATIVE_FUZZ_SEED ?? 0x5eed);
  const next = random(seed);
  const budgetMs = Number(process.env.XFS_NATIVE_FUZZ_MS ?? 1500), caseLimitMs = 500, maxCases = process.env.XFS_NATIVE_FUZZ_MS ? Infinity : 100_000;
  const started = performance.now();
  const outcomes = new Map<string, number>();
  const internal: string[] = [];
  let slowest = 0, cases = 0;
  while (cases < maxCases && performance.now() - started < budgetMs) {
    const which = Math.floor(next() * (RESOURCE_SEEDS.length + 1));
    const archive = which === RESOURCE_SEEDS.length;
    const mutant = mutate(archive ? ARCHIVE_SEED : RESOURCE_SEEDS[which]!, next);
    const caseStart = performance.now();
    let outcome = "decoded";
    try { if (archive) readArchive(mutant); else readResource(mutant, fakeDecompress); }
    catch (error) {
      if ((error as { fuzzExpected?: boolean }).fuzzExpected) outcome = "outside";
      else {
        outcome = classifyNativeFailure(error);
        if (outcome === "internal" && internal.length < 5) internal.push(`case ${cases} (seed ${which}): ${(error as Error)?.stack ?? error}`);
      }
    }
    slowest = Math.max(slowest, performance.now() - caseStart);
    outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
    cases++;
  }
  if (process.env.XFS_NATIVE_FUZZ_MS) console.log(JSON.stringify({ seed, cases, slowestMs: Math.round(slowest), outcomes: Object.fromEntries(outcomes) }));
  expect(internal).toEqual([]);
  expect(cases).toBeGreaterThan(300);
  expect(slowest).toBeLessThan(caseLimitMs);
  // Most mutants are refused, and some still decode (the seeds exercise real paths, not just the header checks).
  expect(outcomes.get("malformed") ?? 0).toBeGreaterThan(cases / 10);
  expect(outcomes.get("decoded") ?? 0).toBeGreaterThan(0);
}, Number(process.env.XFS_NATIVE_FUZZ_MS ?? 0) + 30_000);
