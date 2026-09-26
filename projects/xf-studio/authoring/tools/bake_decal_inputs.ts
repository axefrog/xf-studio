import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { initialRecipe, raster } from "../src/engines/layered-makeup/recipe";
const out = resolve(import.meta.dir, "../../../../experiments/003-decal-material-import/generated");
mkdirSync(out, { recursive: true });
const layer = initialRecipe().layers[0];
// Include opacity in the shape mask exactly once; material scalar stays one.
writeFileSync(resolve(out, "shape.rgba"), raster(layer, 1024));
console.log("Wrote deterministic 1024-square coverage for the decal fixture.");
