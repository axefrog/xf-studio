// Board 2's flake normals through WolvenKit's BC5 (experiment 032). Offline; reads one verified build's packed textures.
//
//   bun experiments/033-finishes-rework/bc5-fade.ts <eye-build-dir> PATH_TO_GAME   # bc5-result.json (asset-free numbers)
//
// The eye build of the Glitter board (the showroom's `eye-build/…` folder) holds each preset's baked chains (`features/
// eye-makeup/baked/*.raw`, what Build supplied) and the .xbm files WolvenKit 9.0.1 made from them (`archive/…/textures`).
// For every fully covered flake texel (flake mask 255) that was supplied at glitter flakes 2's floor or steeper, this
// decodes level 0 with the Studio's reader and reports how many keep mode 1's full weight saturate(50 − 50z) after BC5,
// and how many fall below half. The game folder is read only for its Oodle library. This is WolvenKit's encoder decoded
// by the Studio's reader, not the GPU's sampler.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readCr2w } from "../../projects/xf-studio/authoring/src/native/cr2w-reader";
import { DecodeSession } from "../../projects/xf-studio/authoring/src/native/limits";
import { loadGameOodle } from "../../projects/xf-studio/authoring/src/native/oodle";
import { TEXTURE_READ_LIMITS } from "../../projects/xf-studio/authoring/src/native/texture-decode";
import { decodeMip, textureLayout } from "../../projects/xf-studio/authoring/src/native/xbm-texture";

const here = dirname(fileURLToPath(import.meta.url));
const [build, game] = process.argv.slice(2);
if (!build || !game) throw Error("Usage: bun bc5-fade.ts <eye-build-dir> PATH_TO_GAME");
const oodle = loadGameOodle(game).decompress;
const W = 4096, H = 1024, FLOOR_DEG = 14;
const unorm = (b: number) => b / 255 * 2 - 1;
const tiltDeg = (x: number, y: number) => Math.asin(Math.min(1, Math.hypot(unorm(x), unorm(y)))) * 180 / Math.PI;
const gate = (x: number, y: number) => { const a = unorm(x), b = unorm(y); return Math.max(0, Math.min(1, 50 - 50 * Math.sqrt(Math.max(0, 1 - a * a - b * b)))); };
const find = (dir: string, suffix: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? find(join(dir, e.name), suffix) : e.name.endsWith(suffix) ? [join(dir, e.name)] : []);

const record = JSON.parse(readFileSync(join(build, "features", "eye-makeup", "build.json"), "utf8").replace(/^﻿/, ""));
const xbms = find(join(build, "archive"), "_normal.xbm");
const presets = record.plan.presets.map((preset: { name: string; appearance: string }) => {
  const baked = join(build, "features", "eye-makeup", "baked");
  const normal = new Uint8Array(readFileSync(join(baked, `${preset.appearance}_normal.raw`))).subarray(0, W * H * 2);
  const flakes = new Uint8Array(readFileSync(join(baked, `${preset.appearance}_flakes.raw`))).subarray(0, W * H);
  const xbm = xbms.find(path => path.endsWith(`${preset.appearance}_normal.xbm`))!;
  const decoded = decodeMip(textureLayout(readCr2w(new Uint8Array(readFileSync(xbm)), oodle, new DecodeSession(TEXTURE_READ_LIMITS))), 0);
  if (decoded.width !== W || decoded.height !== H) throw Error(`${preset.name}: decoded level 0 is ${decoded.width} × ${decoded.height}`);
  let texels = 0, full = 0, half = 0, drop = 0;
  for (let t = 0; t < W * H; t++) {
    if (flakes[t] !== 255 || tiltDeg(normal[2 * t], normal[2 * t + 1]) < FLOOR_DEG - .3) continue;
    // The reader returns rows in the supplied order (a flipped mapping lands flake texels on flat ones: 0 % would keep their weight).
    const d = t * 4;
    texels++;
    const g = gate(decoded.data[d], decoded.data[d + 1]);
    if (g >= 1) full++; if (g < .5) half++;
    drop += tiltDeg(normal[2 * t], normal[2 * t + 1]) - tiltDeg(decoded.data[d], decoded.data[d + 1]);
  }
  return { name: preset.name, floorTexels: texels, keepFullWeight: texels ? +(full / texels).toFixed(4) : null,
    belowHalfWeight: texels ? +(half / texels).toFixed(5) : null, meanTiltLossDeg: texels ? +(drop / texels).toFixed(3) : null };
});
const result = { build: "the board 2 eye build (WolvenKit CLI 9.0.1)", floorDeg: FLOOR_DEG, presets };
writeFileSync(join(here, "bc5-result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 1));
