/** Offline mask bridge for the Glitter material study. Never enables export. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultFineSpeckleFlakes } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/direct-glint-settings";
import { raster } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/recipe";
import { readRecipeFile } from "../../projects/xf-studio/authoring/src/recipe-schema";
import { EYE_MAKEUP_REGION, initialRecipe } from "../../projects/xf-studio/authoring/src/features/eye-makeup/region";

const [source, layerId, sizeArg, output] = process.argv.slice(2);
if (!output) throw Error("Usage: bun recipe-mask.ts <recipe.json|--sample> <layer-id> <power-of-two-size> <output-dir>");
const size = Number(sizeArg);
if (!Number.isInteger(size) || size < 64 || size > 2048 || (size & (size - 1)))
  throw Error("Size must be a power of two from 64 to 2048.");
const sample = initialRecipe();
sample.layers = [{ ...sample.layers[0], id: "sample-glitter", name: "Generated Glitter boundary sample",
  finish: "glitter", flakes: defaultFineSpeckleFlakes(), opacity: 1, symmetry: false, fields: [] }];
const sourceBytes = source === "--sample" ? Buffer.from(JSON.stringify({ schema: "xfs/recipe-10", ...sample })) : await readFile(source);
// The in-memory recipe carries no schema; read the source as a recipe file so `schema` is recorded as before.
const recipe = readRecipeFile(JSON.parse(sourceBytes.toString("utf8")));
const layer = recipe.layers.find(candidate => candidate.id === layerId);
if (!layer || !layer.enabled || layer.finish !== "glitter" || !layer.flakes ||
    !("model" in layer.flakes) || !layer.flakes.model.startsWith("uv-cell-direct-"))
  throw Error("Select an enabled direct-glint Glitter layer; raster/legacy optical models need separate analysis.");
const rgba = raster(layer, size, EYE_MAKEUP_REGION.mirror);
const alpha = Buffer.alloc(size * size);
for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
await mkdir(output, { recursive: true });
await writeFile(join(output, "recipe.json"), sourceBytes);
await writeFile(join(output, "coverage-alpha.raw"), alpha);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
await writeFile(join(output, "source.json"), JSON.stringify({
  schema: recipe.schema, layerId: layer.id, size, opticalModel: layer.flakes.model,
  sourceSha256: digest(sourceBytes), coverageSha256: digest(alpha),
  coveredTexels: alpha.reduce((sum, value) => sum + Number(value > 0), 0),
  note: "Exact shared raster coverage only. The direct-light facet model has no stock-material equivalence."
}, null, 2) + "\n");
