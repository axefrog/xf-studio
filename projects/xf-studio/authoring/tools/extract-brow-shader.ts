/** Extract a selected compiled shader from the installed game cache for local
 * material research. The output stays in the ignored research/consumers tree. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { configuredGameRoot } from "./configured-game-root";

const guid = process.argv[2];
if (!guid || !/^\d+$/.test(guid)) throw Error("Pass a decimal shader GUID from shader-cache-index.json");
const root = resolve(import.meta.dir, "../../../..");
const cachePath = join(configuredGameRoot(), "engine", "shader_final.cache");
const bytes = readFileSync(cachePath);
const footer = bytes.subarray(-112);
if (footer.toString("ascii", 104, 108) !== "RDHS" || footer.readUInt32LE(108) !== 10)
  throw Error("Unexpected shader cache format");
const count = footer.readUInt32LE(0);
let at = 0;
let selected: Buffer | undefined;
for (let i = 0; i < count; i++) {
  const shaderGuid = bytes.readBigUInt64LE(at).toString();
  const size = bytes.readUInt32LE(at + 16);
  const start = at + 20;
  if (start + size > bytes.length - 112) throw Error("Shader entry exceeds cache");
  if (shaderGuid === guid) {
    selected = bytes.subarray(start, start + size);
  }
  at = start + size;
}
if (!selected || selected.toString("ascii", 0, 4) !== "DXBC")
  throw Error(`Shader ${guid} not found or invalid`);
const output = resolve(root, "research/consumers/brow-shader/raw");
mkdirSync(output, { recursive: true });
const file = resolve(output, `${guid}.dxbc`);
writeFileSync(file, selected);
console.log(JSON.stringify({ guid, bytes: selected.length,
  sha256: createHash("sha256").update(selected).digest("hex"), file }, null, 2));
