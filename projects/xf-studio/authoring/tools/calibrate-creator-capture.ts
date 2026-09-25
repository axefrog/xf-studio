/**
 * Read-only calibration helper for the creator lighting preset (knowledge/creator-lighting.md §8).
 *
 *   bun tools/calibrate-creator-capture.ts --game <creator screenshot.png> --studio <Studio render.png>
 *       --patches <patches.json> [--lut <decoded LUT .bin>] [--k <the Studio render's creator exposure>]
 *       [--repeat <second game frame.png>]
 *
 * The Studio render must use the Creator lighting preset and a creator camera page at the screenshot's
 * resolution. `patches.json` holds `{ "game": { name: [x, y, w, h], … }, "studio": { … } }` (the `studio`
 * boxes default to the `game` boxes; values ≤ 1 are fractions of the image). Patch names follow the
 * protocol: forehead, cheek_left, cheek_right, chin, hair_* (front-lit), hair_rim_*, brow_*, lash_*,
 * sclera, background. `--lut` is the decoded cube the host served (the private preview cache's
 * `grading-lut/files/<sha256>.bin`); without it the neutral grade is assumed and the fit is only indicative.
 *
 * It fits the single exposure scalar on the forehead and prints the pass marks. It reads the images and
 * writes nothing; screenshots stay private and are never committed.
 */
import { readFileSync } from "node:fs";
import { decodePng } from "../src/png";
import { passMarks, patchMean, type PatchBox, type PatchMean, type Rgba8Image } from "../src/creator-calibration";
import { DEFAULT_CREATOR_EXPOSURE } from "../src/creator-lighting";
import { decodeGradingLutBinary, neutralGradingLut } from "../src/grading-lut";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
const usage = "Usage: bun tools/calibrate-creator-capture.ts --game <png> --studio <png> --patches <json> [--lut <bin>] [--k <number>] [--repeat <png>]";
if (!args.get("game") || !args.get("studio") || !args.get("patches")) { console.error(usage); process.exit(2); }

const image = (path: string): Rgba8Image => decodePng(new Uint8Array(readFileSync(path)));
const spec = JSON.parse(readFileSync(args.get("patches")!, "utf8")) as { game?: Record<string, PatchBox>; studio?: Record<string, PatchBox> };
if (!spec.game || typeof spec.game !== "object") throw Error("patches.json needs a `game` object of named boxes.");
const measure = (img: Rgba8Image, boxes: Record<string, PatchBox>) =>
  Object.fromEntries(Object.entries(boxes).map(([name, box]) => [name, patchMean(img, box)])) as Record<string, PatchMean>;

const gameImage = image(args.get("game")!), studioImage = image(args.get("studio")!);
if (gameImage.width !== studioImage.width || gameImage.height !== studioImage.height)
  console.warn(`Note: the images differ in size (${gameImage.width}×${gameImage.height} vs ${studioImage.width}×${studioImage.height}); pixel boxes are read from each as given.`);
const game = measure(gameImage, spec.game), studio = measure(studioImage, { ...spec.game, ...(spec.studio ?? {}) });
const repeat = args.get("repeat") ? measure(image(args.get("repeat")!), spec.game) : undefined;
const lut = args.get("lut") ? decodeGradingLutBinary(new Uint8Array(readFileSync(args.get("lut")!))) : neutralGradingLut(32);
if (!args.get("lut")) console.warn("Note: no --lut given; the neutral grade is assumed, so the exposure fit is only indicative.");
const k = args.get("k") ? Number(args.get("k")) : DEFAULT_CREATOR_EXPOSURE;
if (!Number.isFinite(k) || k <= 0) throw Error("--k must be a positive number.");

const byte = (p: PatchMean) => p.srgb.map(v => Math.round(v * 255)).join(", ");
console.log("Patch means (display sRGB 8-bit)");
for (const name of Object.keys(game)) console.log(`  ${name.padEnd(18)} game ${byte(game[name]!).padEnd(14)} studio ${studio[name] ? byte(studio[name]!) : "—"}  (${game[name]!.pixels} px)`);
const { exposure, marks } = passMarks(game, studio, lut, k, repeat);
console.log("\nPass marks (first targets for iteration, not evidence of parity)");
for (const mark of marks)
  console.log(`  ${mark.pass === null ? "  -  " : mark.pass ? " pass" : " FAIL"}  ${mark.measure.padEnd(34)} ${mark.value}  [target ${mark.target}; tests ${mark.tests}]`);
if (exposure !== null) console.log(`\nFitted creator exposure: ${exposure.toPrecision(4)} (set it with preview.setCreatorLighting key "exposure").`);
