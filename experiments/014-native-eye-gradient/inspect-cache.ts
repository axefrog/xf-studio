/** Read-only, bounded index of the installed 2.31 eye_gradient compiled variants.
 * DXBC extracts and full index remain under ignored generated/.
 * Cache layout follows the repository's existing independently gated inspectors.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve(process.argv[2] ?? "");
const output = resolve(process.argv[3] ?? "");
const privateRoot = resolve(import.meta.dir, "generated");
if (!output.startsWith(privateRoot + "\\") && output !== privateRoot)
  throw Error("Output must stay under this experiment's ignored generated/ folder");
const bytes = readFileSync(source);
const sourceHash = createHash("sha256").update(bytes).digest("hex");
if (sourceHash !== "339145371a3b5aaa08eb4ef82d558f445b632e28603ee0f3b4860270dfc3ccfa")
  throw Error("Shader cache differs from audited installed 2.31 input");
const footer = bytes.subarray(-112);
if (footer.toString("ascii", 104, 108) !== "RDHS" || footer.readUInt32LE(108) !== 10)
  throw Error("Unsupported shader cache footer");
const shaderCount = footer.readUInt32LE(0), extraCount = footer.readUInt32LE(4), paramCount = footer.readUInt32LE(8);
const offset = (n: number) => {
  const value = Number(footer.readBigUInt64LE(n));
  if (!Number.isSafeInteger(value) || value < 0 || value > bytes.length - 112) throw Error("Invalid cache offset");
  return value;
};
const extrasStart = offset(72), paramsStart = offset(80), mappingStart = offset(88);
let at = 0;
const take = (size: number) => {
  if (size < 0 || at + size > bytes.length - 112) throw Error("Cache bounds exceeded");
  const value = bytes.subarray(at, at + size); at += size; return value;
};
const u8 = () => take(1)[0]!;
const u32 = () => take(4).readUInt32LE();
const u64 = () => take(8).readBigUInt64LE().toString();
const shaders = new Map<string, { start: number; size: number; stage: string }>();
for (let i = 0; i < shaderCount; i++) {
  const guid = u64(); u64(); const size = u32(), start = at, data = take(size);
  if (data.toString("ascii", 0, 4) !== "DXBC" || data.readUInt32LE(24) !== size)
    throw Error("Invalid DXBC header");
  let stage = "unknown";
  for (let j = 0; j < data.readUInt32LE(28); j++) {
    const chunk = data.readUInt32LE(32 + j * 4);
    if (chunk + 12 > data.length || chunk + 8 + data.readUInt32LE(chunk + 4) > data.length)
      throw Error("Invalid DXBC chunk");
    if (data.toString("ascii", chunk, chunk + 4) === "DXIL") {
      const kind = data.readUInt32LE(chunk + 8) >>> 16;
      stage = ({ 0: "pixel", 1: "vertex", 2: "geometry", 3: "hull", 4: "domain", 5: "compute" } as Record<number, string>)[kind] ?? "unknown";
    }
  }
  if (shaders.has(guid)) throw Error("Duplicate shader GUID");
  shaders.set(guid, { start, size, stage });
}
if (at !== extrasStart) throw Error("Shader region mismatch");
at = paramsStart;
for (let i = 0; i < paramCount; i++) {
  u64(); u32(); const n = u32();
  if (n > 65536) throw Error("Invalid parameter count");
  for (let j = 0; j < n; j++) { take(u8() & 127); u8(); u8(); }
}
if (at !== mappingStart) throw Error("Parameter region mismatch");
at = extrasStart;
const selected: { info: string; shaders: { guid: string; stage: string }[]; material: string }[] = [];
let total = 0;
for (let i = 0; i < extraCount; i++) {
  const start = u32(), end = u32(), a = u8(), b = u8();
  const info = take((a & 191) | ((b & 1) << 6)).toString("utf8");
  if (u32() !== start) throw Error("Extra start mismatch");
  const first = u64(), second = u64(), material = u64();
  if (u64() !== material) throw Error("Material GUID mismatch");
  u64();
  if (u32() !== end) throw Error("Extra end mismatch");
  for (let k = 0; k < 2; k++) {
    const n = u32(); if (n > 65536) throw Error("Invalid flags count");
    for (let j = 0; j < n; j++) u64();
  }
  if (info.split(" ")[0] !== "eye_gradient") continue;
  total++;
  if (!info.includes("VF: MeshSkinned]")) continue;
  const pairs = [first, second].map(guid => ({ guid, stage: shaders.get(guid)?.stage ?? "missing" }));
  selected.push({ info, shaders: pairs, material });
}
if (at !== paramsStart) throw Error("Compilation region mismatch");
mkdirSync(output, { recursive: true });
const extracted = [...new Set(selected.flatMap(entry => entry.shaders.filter(item => item.stage === "pixel").map(item => item.guid)))].map(guid => {
  const shader = shaders.get(guid)!;
  const data = bytes.subarray(shader.start, shader.start + shader.size);
  writeFileSync(resolve(output, `${guid}.dxbc`), data);
  return { guid, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
});
const report = { sourceSha256: sourceHash, cacheVersion: 10, eyeGradientCompilations: total,
  meshSkinnedCompilations: selected, extractedPixelPrograms: extracted };
writeFileSync(resolve(output, "index.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ total, meshSkinned: selected.length, extracted }, null, 2));
