import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { raster } from "../src/engines/layered-makeup/recipe";
import { EYE_MAKEUP_REGION, initialRecipe } from "../src/features/eye-makeup/region";
const out = resolve(import.meta.dir, "../../../../experiments/003-decal-material-import/generated");
mkdirSync(out, { recursive: true });
const layer = initialRecipe().layers[0];
// Include opacity in the shape mask exactly once; material scalar stays one.
writeFileSync(resolve(out, "shape.rgba"), raster(layer, 1024, EYE_MAKEUP_REGION.mirror));
console.log("Wrote deterministic 1024-square coverage for the decal fixture.");
