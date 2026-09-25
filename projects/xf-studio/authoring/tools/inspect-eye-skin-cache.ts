/** Read-only index of installed eye/skin compiled variants. Extracts only selected
 * DXBC programs into ignored research inputs for local disassembly. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { configuredGameRoot } from "./configured-game-root";

const root = resolve(import.meta.dir, "../../../..");
const source = join(configuredGameRoot(), "engine", "shader_final.cache");
const bytes = readFileSync(source);
const sourceHash = createHash("sha256").update(bytes).digest("hex");
if (sourceHash !== "339145371a3b5aaa08eb4ef82d558f445b632e28603ee0f3b4860270dfc3ccfa")
  throw Error("Installed shader cache differs from audited 2.31 input");
const footer = bytes.subarray(-112);
if (footer.toString("ascii", 104, 108) !== "RDHS" || footer.readUInt32LE(108) !== 10)
  throw Error("Unsupported shader cache");
const count = footer.readUInt32LE(0), extraCount = footer.readUInt32LE(4), paramCount = footer.readUInt32LE(8);
const offset = (n: number) => {
  const value = Number(footer.readBigUInt64LE(n));
  if (!Number.isSafeInteger(value) || value < 0 || value > bytes.length - 112)
    throw Error("Invalid cache offset");
  return value;
};
const extrasStart = offset(72), paramsStart = offset(80), mappingStart = offset(88);
let at = 0;
const take = (n: number) => {
  if (n < 0 || at + n > bytes.length - 112) throw Error("Cache entry out of bounds");
  const b = bytes.subarray(at, at + n); at += n; return b;
};
const u8 = () => take(1)[0], u32 = () => take(4).readUInt32LE(), u64 = () => take(8).readBigUInt64LE().toString();
const shaders = new Map<string, { start: number; size: number; stage: string }>();
for (let i = 0; i < count; i++) {
  const guid = u64(); u64(); const size = u32(), start = at, b = take(size);
  if (b.toString("ascii", 0, 4) !== "DXBC" || b.readUInt32LE(24) !== size) throw Error("Invalid shader");
  let stage = "unknown";
  for (let j = 0; j < b.readUInt32LE(28); j++) {
    const p = b.readUInt32LE(32 + j * 4);
    if (p + 12 > b.length || p + 8 + b.readUInt32LE(p + 4) > b.length)
      throw Error("Invalid shader chunk");
    if (b.toString("ascii", p, p + 4) === "DXIL") {
      const kind = b.readUInt32LE(p + 8) >>> 16;
      stage = ({ 0: "pixel", 1: "vertex", 2: "geometry", 3: "hull", 4: "domain", 5: "compute" } as Record<number, string>)[kind] ?? "unknown";
    }
  }
  shaders.set(guid, { start, size, stage });
}
if (at !== extrasStart) throw Error("Shader region mismatch");
at = paramsStart;
for (let i = 0; i < paramCount; i++) {
  u64(); u32(); const n = u32(); if (n > 65536) throw Error("Invalid parameter count");
  for (let j = 0; j < n; j++) { take(u8() & 127); u8(); u8(); }
}
if (at !== mappingStart) throw Error("Parameter region mismatch");
at = extrasStart;
const selected: { template: string; info: string; shaders: { guid: string; stage: string }[] }[] = [];
for (let i = 0; i < extraCount; i++) {
  const start = u32(), end = u32(), a = u8(), b = u8();
  const info = take((a & 191) | ((b & 1) << 6)).toString("utf8");
  if (u32() !== start) throw Error("Extra start mismatch");
  const first = u64(), second = u64(), material = u64();
  if (u64() !== material) throw Error("Material GUID mismatch");
  u64();
  if (u32() !== end) throw Error("Extra end mismatch");
  for (let j = 0; j < 2; j++) { const n = u32(); if (n > 65536) throw Error("Invalid flags"); for (let k = 0; k < n; k++) u64(); }
  const template = info.split(" ")[0];
  if (!/^(eye|skin|skin_morph)$/.test(template) || !info.includes("VF: MeshSkinned]")) continue;
  selected.push({ template, info, shaders: [first, second].map(guid => ({ guid, stage: shaders.get(guid)?.stage ?? "missing" })) });
}
if (at !== paramsStart) throw Error("Compilation region mismatch");
const output = resolve(root, "research/consumers/eye-lip-shader/raw");
mkdirSync(output, { recursive: true });
const unique = new Set(selected.flatMap(v => v.shaders.filter(s => s.stage === "pixel").map(s => s.guid)));
const extracted = [...unique].map(guid => {
  const shader = shaders.get(guid)!;
  const data = bytes.subarray(shader.start, shader.start + shader.size);
  writeFileSync(resolve(output, `${guid}.dxbc`), data);
  return { guid, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
});
const report = { source, sha256: sourceHash,
  selected, extracted };
writeFileSync(resolve(output, "index.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ variants: selected.length, pixelPrograms: extracted.length,
  byTemplate: Object.fromEntries([...new Set(selected.map(s => s.template))].map(t => [t, selected.filter(s => s.template === t).length])),
  output }, null, 2));
