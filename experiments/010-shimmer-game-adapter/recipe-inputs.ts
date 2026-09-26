/** Offline Shimmer material inputs. This does not enable production export. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bakeFlakes, defaultFlakes } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/finish";
import { raster } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/recipe";
import { readRecipeFile } from "../../projects/xf-studio/authoring/src/recipe-schema";
import { EYE_MAKEUP_REGION, initialRecipe } from "../../projects/xf-studio/authoring/src/features/eye-makeup/region";

const [source, layerId, out, sizeArg] = process.argv.slice(2);
if (!out) throw Error("Usage: bun recipe-inputs.ts <recipe.json|--sample> <layer-id> <output-dir> [size]");
const size = Number(sizeArg ?? 1024);
if (!Number.isInteger(size) || size < 256 || size > 2048 || (size & (size - 1)))
  throw Error("Size must be a power of two from 256 to 2048.");
const sample = initialRecipe();
sample.layers = [{ ...sample.layers[0]!, id: "sample-shimmer", name: "Shimmer material sample",
  finish: "shimmer", flakes: defaultFlakes(), opacity: 0.85, enabled: true }];
const bytes = source === "--sample" ? Buffer.from(JSON.stringify(readRecipeFile(sample))) : readFileSync(source);
// The in-memory recipe carries no schema; read the source as a recipe file so `schema` is recorded as before.
const recipe = readRecipeFile(JSON.parse(bytes.toString("utf8")));
const layer = recipe.layers.find(item => item.id === layerId);
if (!layer || !layer.enabled || layer.finish !== "shimmer" || layer.opacity <= 0)
  throw Error("Select an enabled Shimmer layer with positive opacity.");
const flakes = layer.flakes ?? defaultFlakes();
if ("model" in flakes) throw Error("This stock-material study covers legacy Shimmer cells only.");
const shape = raster(layer, size, EYE_MAKEUP_REGION.mirror);
const optics = bakeFlakes(size, "shimmer", flakes);
mkdirSync(out, { recursive: true });
for (const [name, data] of [["shape", shape], ["normal", optics.normal], ["surface", optics.surface]] as const)
  writeFileSync(join(out, `${name}.rgba`), data);
const sha = (data: NodeJS.ArrayBufferView) => createHash("sha256").update(data).digest("hex");
let coveredTexels = 0;
for (let i = 3; i < shape.length; i += 4) if (shape[i] > 0) coveredTexels++;
writeFileSync(join(out, "source.json"), JSON.stringify({ schema: recipe.schema, layerId: layer.id,
  size, color: layer.color, opacity: layer.opacity, flakes, recipeSha256: sha(bytes),
  shapeSha256: sha(shape), normalSha256: sha(optics.normal), surfaceSha256: sha(optics.surface),
  coveredTexels,
  note: "Exact Studio recipe raster and legacy Shimmer optical bake; material translation remains experimental."
}, null, 2) + "\n");
writeFileSync(join(out, "selected-recipe.json"), JSON.stringify(recipe, null, 2) + "\n");
