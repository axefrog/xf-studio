/** Offline Glossy material inputs. Production export remains guarded. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initialRecipe, parseRecipe, raster } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/recipe";

const [source, layerId, out, sizeArg] = process.argv.slice(2);
if (!out) throw Error("Usage: bun recipe-inputs.ts <recipe.json|--sample> <layer-id> <output-dir> [size]");
const size = Number(sizeArg ?? 1024);
if (!Number.isInteger(size) || size < 256 || size > 2048 || (size & (size - 1)))
  throw Error("Size must be a power of two from 256 to 2048.");
const sample = initialRecipe();
sample.layers = [{ ...sample.layers[0]!, id: "sample-glossy", name: "Glossy material sample",
  finish: "glossy", opacity: 0.85, enabled: true }];
const bytes = source === "--sample" ? Buffer.from(JSON.stringify(sample)) : readFileSync(source);
const recipe = parseRecipe(JSON.parse(bytes.toString("utf8")));
const layer = recipe.layers.find(item => item.id === layerId);
if (!layer || !layer.enabled || layer.finish !== "glossy" || layer.opacity <= 0)
  throw Error("Select an enabled Glossy layer with positive opacity.");
const shape = raster(layer, size);
let coveredTexels = 0, partialTexels = 0;
for (let i = 3; i < shape.length; i += 4) {
  if (shape[i] > 0) coveredTexels++;
  if (shape[i] > 0 && shape[i] < 255) partialTexels++;
}
if (!coveredTexels || !partialTexels) throw Error("Selected Glossy layer needs nonempty and partial coverage.");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "shape.rgba"), shape);
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
writeFileSync(join(out, "source.json"), JSON.stringify({ schema: recipe.schema, layerId: layer.id,
  size, color: layer.color, opacity: layer.opacity, recipeSha256: sha(bytes),
  shapeSha256: sha(shape), coveredTexels, partialTexels,
  note: "Exact Studio recipe raster. Browser Glossy uses base roughness 0.16, clearcoat 1, coat roughness 0.08."
}, null, 2) + "\n");
