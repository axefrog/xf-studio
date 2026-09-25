import type { MapAdapter } from "./preview-core-recipe";
import type { RgbaImage } from "./png";

/**
 * Pure adapters from WolvenKit's decoded game textures to the browser preview's map
 * conventions. They are explicit approximations for Three.js's standard material, not
 * REDengine shader parity:
 * - colour-copy: sRGB colour pixels unchanged (alpha dropped; the preview never reads it).
 * - packed-normal: the game packs tangent-space X/Y in R/G with B unused. Keep R/G and
 *   reconstruct a positive Z in B. The preview's normalScale was tuned on a prepared map
 *   with this same channel sign (measured positive R and G correlation), so G is not flipped.
 * - red-to-grey: the skin roughness term is the source R channel; Three samples G.
 */
export function adaptMap(image: RgbaImage, adapter: MapAdapter): RgbaImage {
  const { width, height, data } = image;
  const out = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const at = pixel * 4;
    if (adapter === "colour-copy") {
      out[at] = data[at]!; out[at + 1] = data[at + 1]!; out[at + 2] = data[at + 2]!;
    } else if (adapter === "packed-normal") {
      const x = data[at]! / 255 * 2 - 1, y = data[at + 1]! / 255 * 2 - 1;
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      out[at] = data[at]!; out[at + 1] = data[at + 1]!;
      out[at + 2] = Math.min(255, Math.max(0, Math.round((z + 1) * 127.5)));
    } else if (adapter === "red-to-grey") {
      out[at] = out[at + 1] = out[at + 2] = data[at]!;
    } else throw Error(`Unknown map adapter ${adapter as string}.`);
    out[at + 3] = 255;
  }
  return { width, height, data: out };
}

/** Structural checks a converted map must pass before it is published. */
export function checkMap(image: RgbaImage, adapter: MapAdapter): string[] {
  const problems: string[] = [];
  const { width, height, data } = image;
  if (width !== height || width < 256 || width > 4096 || (width & (width - 1)))
    problems.push(`map is ${width}x${height}; expected a square power of two between 256 and 4096`);
  let min = 255, max = 0, blueMin = 255;
  for (let pixel = 0; pixel < width * height; pixel++) {
    const r = data[pixel * 4]!, g = data[pixel * 4 + 1]!;
    min = Math.min(min, r, g); max = Math.max(max, r, g);
    blueMin = Math.min(blueMin, data[pixel * 4 + 2]!);
  }
  if (max === min) problems.push("map has no variation");
  if (adapter === "packed-normal" && blueMin < 127) problems.push("normal map has back-facing Z");
  return problems;
}
