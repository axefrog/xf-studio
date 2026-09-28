// Shimmer grain through WolvenKit's BC5 (experiment 030, PIPE-125). Offline; reads no game content.
//
//   bun experiments/030-shimmer-grain/bc5-roundtrip.ts PATH_TO_WOLVENKIT_CLI PATH_TO_GAME   # bc5-result.json (tracked, asset-free)
//
// The game folder is read only for its Oodle library (WolvenKit's .xbm buffers are Kraken-compressed).
//
// *Shimmer · strong* is compiled on the 2048 × 512 plate window exactly as Build does, its normal chain is built and written as
// the RGBA8 DDS Build hands WolvenKit (facetedMipChain, normalRgba, encodeDds), and WolvenKit's own folder import turns it into an
// .xbm with Build's normal-map settings (TCM_Normalmap: BC5). The .xbm is decoded with the Studio's native reader (bcn.ts) and
// compared with the supplied bytes over each stripe's fully covered interior: the decoded-normal error, and how many tilted
// grains keep NormalsBlendingMode 1's full weight saturate(50 − 50z) after compression. The DDS and .xbm stay in ignored generated/.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePreset } from "../../projects/xf-studio/authoring/tests/fixtures/eye-region";
import { plateUvWindow, type UvWindow } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/plate-uv-window";
import { facetedMipChain, normalRgba } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/route-mip-chains";
import { encodeDds } from "../../projects/xf-studio/authoring/src/engines/layered-makeup/flat-mip-chain";
import { readCr2w } from "../../projects/xf-studio/authoring/src/native/cr2w-reader";
import { DecodeSession } from "../../projects/xf-studio/authoring/src/native/limits";
import { loadGameOodle } from "../../projects/xf-studio/authoring/src/native/oodle";
import { TEXTURE_READ_LIMITS } from "../../projects/xf-studio/authoring/src/native/texture-decode";
import { decodeMip, textureLayout } from "../../projects/xf-studio/authoring/src/native/xbm-texture";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "../..");
const [cli, game] = process.argv.slice(2);
if (!cli || !game) { console.error("usage: bun experiments/030-shimmer-grain/bc5-roundtrip.ts PATH_TO_WOLVENKIT_CLI PATH_TO_GAME"); process.exit(2); }
/** The built-in plate's stored UV0 bounds (game 2.31), as diagnose.ts and tests/plate-uv-window.test.ts record them. */
const BUILT_IN = { uMin: 0.273193359375, uMax: 0.7265625, vMin: 0.67626953125, vMax: 0.8212890625 };
const W = 2048, H = 512, window: UvWindow = plateUvWindow(BUILT_IN);
/** Build's normal-map import settings (package-resource-builder.ts TEXTURE_GROUPS, "dds-normal"). */
const NORMAL_IMPORT = { IsGamma: false, TextureGroup: "TEXG_Generic_Normal", RawFormat: "TRF_TrueColor", Compression: "TCM_Normalmap",
  GenerateMipMaps: false, IsStreamable: true, PremultiplyAlpha: false };
type Rect = [number, number, number, number];
/** The fine and strong stripes' fully covered interiors (diagnose.ts STRIPES). */
const STRIPES: { id: string; rect: Rect }[] = [{ id: "fine", rect: [.352, .216, .392, .244] }, { id: "strong", rect: [.400, .216, .440, .244] }];

const collection = JSON.parse(readFileSync(join(root, "experiments/017-plate-depth/depth-candidate.collection.json"), "utf8"));
const preset = collection.presets.find((p: { name: string }) => p.name === "Shimmer · strong");
const compiled = compilePreset(preset.recipe, { kind: "window", width: W, height: H, window });
const m = compiled.maps as { diffuse: Uint8Array; roughness: Uint8Array; metalness: Uint8Array; normal: Uint8Array };
const chain = facetedMipChain(m.diffuse, m.roughness, m.metalness, m.normal, W, H);

const work = join(here, "generated", "bc5"), input = join(work, "input"), output = join(work, "output");
rmSync(work, { recursive: true, force: true });
mkdirSync(input, { recursive: true }); mkdirSync(output, { recursive: true });
writeFileSync(join(input, "xfs_shimmer_strong_normal.dds"), encodeDds(chain.normal.map(normalRgba), { width: W, height: H }, "rgba8-unorm"));
const run = Bun.spawnSync([cli, "import", input, "-o", output], {
  env: { ...process.env, ...Object.fromEntries(Object.entries(NORMAL_IMPORT).map(([k, v]) => ["XbmImportArgs__" + k, String(v)])) },
  stdout: "pipe", stderr: "pipe" });
const log = run.stdout.toString() + run.stderr.toString();
const find = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? find(join(dir, e.name)) : e.name.endsWith(".xbm") ? [join(dir, e.name)] : []);
const xbm = find(output)[0];
if (!xbm) throw Error(`WolvenKit produced no .xbm (exit ${run.exitCode}):\n${log.slice(-2000)}`);
const layout = textureLayout(readCr2w(new Uint8Array(readFileSync(xbm)), loadGameOodle(game).decompress, new DecodeSession(TEXTURE_READ_LIMITS)));
const decoded = decodeMip(layout, 0);
if (decoded.width !== W || decoded.height !== H) throw Error(`Decoded level 0 is ${decoded.width} × ${decoded.height}.`);

const unorm = (b: number) => b / 255 * 2 - 1;
const gate = (x: number, y: number) => Math.max(0, Math.min(1, 50 - 50 * Math.sqrt(Math.max(0, 1 - x * x - y * y))));
const vector = (x: number, y: number) => [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))];
const stats = (values: number[]) => {
  const s = Float64Array.from(values).sort(), at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { n: s.length, mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(5), p95: +at(.95).toFixed(5), p99: +at(.99).toFixed(5), max: +s[s.length - 1].toFixed(5) };
};
const report = STRIPES.map(({ id, rect }) => {
  const error: number[] = [], degrees: number[] = [], weight: number[] = [], flatDrift: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = window.u0 + (x + .5) / W * (window.u1 - window.u0), v = window.v0 + (y + .5) / H * (window.v1 - window.v0);
    const t = y * W + x;
    if (!(u >= rect[0] && u < rect[2] && v >= rect[1] && v < rect[3]) || m.diffuse[t * 4 + 3] !== 255) continue;
    const sx = unorm(m.normal[t * 2]), sy = unorm(m.normal[t * 2 + 1]), dx = unorm(decoded.data[t * 4]), dy = unorm(decoded.data[t * 4 + 1]);
    error.push(Math.hypot(dx - sx, dy - sy));
    const p = vector(sx, sy), q = vector(dx, dy), dot = p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    degrees.push(Math.acos(Math.min(1, dot / (Math.hypot(...p) * Math.hypot(...q)))) * 180 / Math.PI);
    if (m.normal[t * 2] === 128 && m.normal[t * 2 + 1] === 128) flatDrift.push(gate(dx, dy));
    else weight.push(gate(dx, dy));
  }
  const tilted = weight.length;
  return { stripe: id, texels: error.length, tiltedGrains: tilted,
    normalError: stats(error), angleDegrees: stats(degrees),
    tiltedFullWeight: +(weight.filter(w => w >= 1).length / tilted).toFixed(4),
    tiltedBelowHalfWeight: +(weight.filter(w => w < .5).length / tilted).toFixed(4),
    tiltedWeight: stats(weight),
    // The flat byte (128, 128) itself decodes to a weight of 0.0008; count flat grains that pick up a visible weight.
    flatGrainsAboveTenthWeight: +(flatDrift.filter(w => w > .1).length / Math.max(1, flatDrift.length)).toFixed(4),
    flatWeight: stats(flatDrift) };
});
const result = {
  experiment: "030-shimmer-grain", check: "PIPE-125: grain normals through WolvenKit's BC5 import",
  tool: { cli: "WolvenKit.CLI 9.0.1", command: "import <folder> -o <folder>", settings: NORMAL_IMPORT },
  preset: "Shimmer · strong (experiment 017)", map: { width: W, height: H, window, format: layout.format, mips: layout.mips.length },
  stripes: report,
  limits: "Level 0 only (grains are one texel; lower levels are box means). Decoded with the Studio's BC5 reader (bcn.ts), not the GPU's; a " +
    "flat grain in a block of tilted ones can pick up a small tilt, reported as the share of flat grains whose mode-1 weight exceeds 0.1 (the flat byte itself decodes to 0.0008).",
};
writeFileSync(join(here, "bc5-result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result.stripes, null, 1));
