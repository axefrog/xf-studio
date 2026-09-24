/** Read-only selection of the installed mesh_decal_particles MeshSkinned programs.
 * Binary outputs are private local research, never part of a package.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const source = "F:/Games/Cyberpunk 2077/engine/shader_final.cache";
const bytes = readFileSync(source);
const footer = bytes.subarray(-112);
if (footer.toString("ascii", 104, 108) !== "RDHS" || footer.readUInt32LE(108) !== 10)
  throw Error("Unsupported shader cache");
const extraStart = Number(footer.readBigUInt64LE(72));
const paramsStart = Number(footer.readBigUInt64LE(80));
const shaderCount = footer.readUInt32LE(0), compilationCount = footer.readUInt32LE(4);
const shaders = new Map<string, { at: number; size: number; stage: string }>();
let at = 0;
const take = (size: number) => { const chunk = bytes.subarray(at, at + size); if (chunk.length !== size || at + size > bytes.length - 112) throw Error("Truncated cache"); at += size; return chunk; };
const u8 = () => take(1)[0], u32 = () => take(4).readUInt32LE(), u64 = () => take(8).readBigUInt64LE().toString();
for (let i = 0; i < shaderCount; i++) {
  const id = u64(); u64(); const size = u32(), start = at, binary = take(size);
  if (binary.toString("ascii", 0, 4) !== "DXBC" || binary.readUInt32LE(24) !== size) throw Error("Invalid DXBC");
  let stage = "unknown";
  for (let c = 0; c < binary.readUInt32LE(28); c++) {
    const offset = binary.readUInt32LE(32 + c * 4);
    if (binary.toString("ascii", offset, offset + 4) === "DXIL") {
      const kind = binary.readUInt32LE(offset + 8) >>> 16;
      stage = ({ 0: "pixel", 1: "vertex" } as Record<number, string>)[kind] ?? `kind-${kind}`;
    }
  }
  shaders.set(id, { at: start, size, stage });
}
if (at !== extraStart) throw Error("Shader region mismatch");
const chosen = [] as { info: string; first: string; second: string }[];
for (let i = 0; i < compilationCount; i++) {
  const start = u32(), end = u32(), a = u8(), b = u8();
  const info = take((a & 191) | ((b & 1) << 6)).toString("utf8");
  if (u32() !== start) throw Error("Compilation offset mismatch");
  const first = u64(), second = u64(), material = u64();
  if (u64() !== material) throw Error("Material ID mismatch");
  u64(); if (u32() !== end) throw Error("Compilation end mismatch");
  for (let list = 0; list < 2; list++) { const n = u32(); if (n > 65536) throw Error("Invalid flag count"); for (let j = 0; j < n; j++) u64(); }
  if (info.startsWith("mesh_decal_particles ") && info.includes("VF: MeshSkinned]")) chosen.push({ info, first, second });
}
if (at !== paramsStart) throw Error("Compilation region mismatch");
const output = resolve(import.meta.dir, "generated/particle-cache");
mkdirSync(output, { recursive: true });
const programs = [...new Set(chosen.flatMap(item => [item.first, item.second]).filter(id => id !== "0"))].map(id => {
  const entry = shaders.get(id); if (!entry) throw Error(`Missing shader ${id}`);
  const binary = bytes.subarray(entry.at, entry.at + entry.size);
  writeFileSync(resolve(output, `${id}.dxbc`), binary);
  return { id, stage: entry.stage, sha256: createHash("sha256").update(binary).digest("hex"), bytes: entry.size };
});
const report = { source, sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  template: "mesh_decal_particles", chosen, programs };
writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
