/** Offline curved-card comparison. Usage: bun tools/hair-atlas-compare.ts PATH_TO_IGNORED_REFERENCE_AND_OUTPUT */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { defaultHairAtlas, generateHairAtlas, measureAtlasRegion, type HairAtlasLevel } from "../src/features/hair-lab/textures";
import { prepareHairAtlasStrips, type HairAtlasStrip } from "../src/features/hair-lab/strand-strips";
import { bakeHairProfile, hairAlbedo, hairCoverage, hairResolvedCoverage, hairRoughness, hairDirectLight, hairEnvironmentLight,
  resolveHairMaterial, srgbToLinear, linearToSrgb8, type Rgb } from "../src/hair-colour-model";
import { decodePng, encodePng, type RgbaImage } from "../src/png";

const out = resolve(process.argv[2] ?? "build/hair-lab-wip");
if (!out.replaceAll("\\", "/").includes("/build/")) throw Error("Comparison output must stay in an ignored build folder.");
// Run the second full-size oracle in its own process, not alongside both comparison map sets (1 GB budget).
if (process.argv.includes("--cutoff-probe")) {
  const d = defaultHairAtlas(); d.alphaCutoff = .33;
  const t = performance.now(), set = prepareHairAtlasStrips(generateHairAtlas(d));
  const report = { cutoff: .33, elapsedMs: performance.now() - t,
    maxMipError: Math.max(...set.strips.flatMap(s => s.coverage.map(c => Math.abs(c.corrected - c.target)))),
    saturated: set.strips.flatMap(s => s.coverage).filter(c => c.saturated).length };
  if (report.maxMipError > .004 || report.saturated) throw Error("Cutoff mip oracle failed.");
  writeFileSync(join(out, "atlas-cutoff-report.json"), JSON.stringify(report, null, 2)); console.log(report); process.exit(0);
}
const flowProposal = process.argv.includes("--flow-proposal");
const start = performance.now(), description = defaultHairAtlas(), atlas = generateHairAtlas(description), generated = prepareHairAtlasStrips(atlas);
const referenceMap: HairAtlasLevel = { width: 2048, height: 2048, alpha: new Uint8Array(2048 ** 2), id: new Uint8Array(2048 ** 2),
  gradient: new Uint8Array(2048 ** 2), flow: new Uint8Array(2048 ** 2 * 3) };

function bilinear(data: Uint8Array, width: number, height: number, channels: number, u: number, v: number, channel: number, gamma = false): number {
  const x = u * width - .5, y = v * height - .5, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy; let value = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const k = (Math.max(0, Math.min(height - 1, iy + dy)) * width + Math.max(0, Math.min(width - 1, ix + dx))) * channels + channel;
    value += (gamma ? srgbToLinear(data[k]!) : data[k]! / 255) * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
  }
  return value;
}
for (const [key, name] of [["alpha", "Strand_Alpha"], ["id", "Strand_ID"], ["gradient", "Strand_Gradient"], ["flow", "Flow"]] as const) {
  const image = decodePng(readFileSync(join(out, `atlas-vanilla-${name}.png`))), n = key === "flow" ? 3 : 1;
  for (let y = 0; y < 2048; y++) for (let x = 0; x < 2048; x++) for (let c = 0; c < n; c++) {
    const value = bilinear(image.data, image.width, image.height, 4, (x + .5) / 2048, (y + .5) / 2048, c, key === "flow");
    referenceMap[key][(y * 2048 + x) * n + c] = Math.round(key === "flow" ? linearToSrgb8(value) : 255 * value);
  }
}
// Both sides use identical isolated content domains and the same mip policy: comparison is of the source fibres/maps.
const native = prepareHairAtlasStrips({ ...atlas, levels: [referenceMap], regions: atlas.regions.map(r => ({ ...r, mirrored: false })) });
const rawProfile = JSON.parse(readFileSync(join(out, "atlas-vanilla-profile.json"), "utf8")) as {
  sampleCount: number; gradientEntriesID: { value: number; color: { Red: number; Green: number; Blue: number } }[];
  gradientEntriesRootToTip: { value: number; color: { Red: number; Green: number; Blue: number } }[];
};
const stops = (s: typeof rawProfile.gradientEntriesID) => s.map(e => ({ value: e.value, color: [e.color.Red, e.color.Green, e.color.Blue] as Rgb }));
const count = rawProfile.sampleCount, idRow = bakeHairProfile(stops(rawProfile.gradientEntriesID), count), rootRow = bakeHairProfile(stops(rawProfile.gradientEntriesRootToTip), count);
const material = resolveHairMaterial({ alphaCutoff: atlas.alphaCutoff }), unit = (v: Rgb): Rgb => { const length = Math.hypot(...v); return v.map(x => x / length) as Rgb; };
const front: Rgb = unit([.3, .25, 1]), back: Rgb = unit([-.3, .25, -1]), V: Rgb = [0, 0, 1];
const keys = ["dense-a", "clump-a", "wisp-a", "singles", "wisp-d", "short-wisp-b"], labels = ["DENSE", "CLUMP", "WISP", "FLYAWAY", "CURL", "SHORT"];
const width = 1536, height = 1120, image: RgbaImage = { width, height, data: new Uint8Array(width * height * 4).fill(255) };
for (let i = 0; i < width * height; i++) image.data.set([22, 22, 22, 255], i * 4);
const FONT: Record<string, string> = {
  A:"01110/10001/10001/11111/10001/10001/10001", B:"11110/10001/10001/11110/10001/10001/11110", C:"01111/10000/10000/10000/10000/10000/01111",
  D:"11110/10001/10001/10001/10001/10001/11110", E:"11111/10000/10000/11110/10000/10000/11111", F:"11111/10000/10000/11110/10000/10000/10000",
  G:"01111/10000/10000/10111/10001/10001/01111", H:"10001/10001/10001/11111/10001/10001/10001", I:"11111/00100/00100/00100/00100/00100/11111",
  K:"10001/10010/10100/11000/10100/10010/10001", L:"10000/10000/10000/10000/10000/10000/11111", M:"10001/11011/10101/10101/10001/10001/10001",
  N:"10001/11001/10101/10011/10001/10001/10001", O:"01110/10001/10001/10001/10001/10001/01110", P:"11110/10001/10001/11110/10000/10000/10000",
  R:"11110/10001/10001/11110/10100/10010/10001", S:"01111/10000/10000/01110/00001/00001/11110", T:"11111/00100/00100/00100/00100/00100/00100",
  U:"10001/10001/10001/10001/10001/10001/01110", V:"10001/10001/10001/10001/10001/01010/00100", W:"10001/10001/10001/10101/10101/10101/01010",
  X:"10001/10001/01010/00100/01010/10001/10001", Y:"10001/10001/01010/00100/00100/00100/00100", "1":"00100/01100/00100/00100/00100/00100/01110",
  "-":"00000/00000/00000/11111/00000/00000/00000",
};
function text(label: string, x: number, y: number, scale = 2) {
  for (const char of label) {
    FONT[char]?.split("/").forEach((row, dy) => [...row].forEach((bit, dx) => {
      if (bit === "1") for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) image.data.set([190, 200, 211, 255], ((y + dy * scale + sy) * width + x + dx * scale + sx) * 4);
    })); x += scale * 6;
  }
}
function sample(strip: HairAtlasStrip, key: "alpha" | "id" | "gradient" | "flow", c: number, u: number, v: number, lod: number): number {
  const lower = Math.min(strip.levels.length - 1, Math.max(0, Math.floor(lod))), upper = Math.min(strip.levels.length - 1, lower + 1), f = Math.max(0, lod - lower);
  const read = (i: number) => { const l = strip.levels[i]!; return bilinear(l[key], l.width, l.height, key === "flow" ? 3 : 1, u, v, c, key === "flow"); };
  return read(lower) * (1 - Math.min(1, f)) + read(upper) * Math.min(1, f);
}
type ShadeStats = { label: string; coverage: number; visibleMean: Rgb };
function card(strip: HairAtlasStrip, x0: number, y0: number, w: number, h: number, light: Rgb, withFlow = true): ShadeStats {
  const lod = Math.max(0, Math.log2(Math.max(strip.levels[0]!.width / w, strip.levels[0]!.height / h)));
  let coverageSum = 0, area = 0; const mean: Rgb = [0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = -18; x < w + 18; x++) {
    const rgb: Rgb = [0, 0, 0];
    for (const dy of [.25, .75]) for (const dx of [.25, .75]) {
      const v = (y + dy) / h, sway = 12 * (w / 74) * Math.sin(Math.PI * v), u = (x + dx - sway) / w;
      const background = .002;
      if (u < 0 || u > 1) { for (let c = 0; c < 3; c++) rgb[c]! += background / 4; continue; }
      const id = sample(strip, "id", 0, u, v, lod), gradient = sample(strip, "gradient", 0, u, v, lod);
      const a = hairResolvedCoverage(hairCoverage(sample(strip, "alpha", 0, u, v, lod), material.alphaCutoff));
      // A gently cupped and lengthwise bowed sheet, with the same geometry on both sides of the comparison.
      const dzdx = (u - .5) * .8, dzdy = .18 * Math.cos(Math.PI * v), T = unit([1, 0, dzdx]), N = unit([-dzdx, -dzdy, 1]);
      const B: Rgb = unit([N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0]]);
      const tx = Math.max(2 * sample(strip, "flow", 0, u, v, lod) - 1, .01) * (strip.mirrored ? -1 : 1), by = Math.max(2 * sample(strip, "flow", 1, u, v, lod) - 1, .01);
      const direction = withFlow ? unit(T.map((t, k) => t * tx + B[k]! * by) as Rgb) : B;
      const albedo = hairAlbedo(idRow, rootRow, count, id, gradient, 0, material);
      const roughness = hairRoughness(id, 1, material), direct = hairDirectLight(light, V, direction, N, albedo, roughness, undefined, id, "local");
      const env = hairEnvironmentLight(V, direction, N, albedo, roughness, undefined, id);
      for (let c = 0; c < 3; c++) {
        const lit = direct.diffuse[c]! + direct.specular[c]! + .12 * (env.diffuse[c]! + env.specular[c]!);
        rgb[c]! += (lit * a + background * (1 - a)) / 4; mean[c]! += lit * a;
      }
      coverageSum += a; area++;
    }
    const px = Math.round(x0 + x), py = Math.round(y0 + y);
    for (let c = 0; c < 3; c++) image.data[(py * width + px) * 4 + c] = Math.round(linearToSrgb8(4 * rgb[c]!));
  }
  return { label: strip.key, coverage: coverageSum / (area || 1), visibleMean: mean.map(v => v / (coverageSum || 1)) as Rgb };
}
const panels: object[] = [];
for (const [row, light] of [front, back].entries()) for (const [column, set] of (flowProposal ? [native, native] : [generated, native]).entries()) {
  const ox = column * 768, oy = row * 560;
  const source = flowProposal ? `VANILLA ${column ? "FLOW" : "B ONLY"}` : column ? "VANILLA" : "GENERATED", withFlow = !flowProposal || column === 1;
  text(`${source} - ${row ? "BACK" : "FRONT"}`, ox + 30, oy + 18);
  const stats: ShadeStats[] = [];
  for (const [i, key] of keys.entries()) {
    const strip = set.strips.find(s => s.key === key)!, x = ox + 38 + i * 122;
    text(labels[i]!, x - 8, oy + 55, 1);
    stats.push(card(strip, x, oy + 78, 74, key.startsWith("short") ? 180 : 345, light, withFlow));
    card(strip, x + 25, oy + 450, 13, key.startsWith("short") ? 32 : 64, light, withFlow);
  }
  text("FAR CARDS", ox + 30, oy + 530, 1); panels.push({ source, withFlow, lighting: row ? "back" : "front", stats });
}
writeFileSync(join(out, flowProposal ? "atlas-08-flow-proposal.png" : "atlas-07-compare.png"), encodePng(image, { alpha: false, level: 3 }));
const variation = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0) / 2;
const regions = atlas.regions.map(r => {
  const a = measureAtlasRegion(atlas.levels[0]!, r.rect, 0), b = measureAtlasRegion(referenceMap, r.rect, 0), strip = generated.strips.find(s => s.key === r.key)!;
  return { key: r.key, type: r.type, variant: r.variant, fibres: r.fibreCount, coverage: a.coverage, nativeCoverage: b.coverage,
    idTV: variation(a.id.histogram, b.id.histogram), idMeanError: a.id.mean - b.id.mean, gradientMeanError: a.gradient.mean - b.gradient.mean,
    mipCount: strip.levels.length, lastMip: strip.levels.at(-1)!.alpha[0], maxMipError: Math.max(...strip.coverage.map(c => Math.abs(c.corrected - c.target))) };
});
// Original four-fibre fixture, including its original width (so coverage remains comparable).
const fourDescription = defaultHairAtlas(); fourDescription.regions = [{ ...fourDescription.regions.find(r => r.key === "singles")!, count: 4, width: .02 }];
const four = generateHairAtlas(fourDescription), fourRegion = four.regions[0]!;
const fourFibreIdTV = variation(measureAtlasRegion(four.levels[0]!, fourRegion.rect, 0).id.histogram, measureAtlasRegion(referenceMap, fourRegion.rect, 0).id.histogram);
if (fourFibreIdTV > .1 || Math.max(...regions.map(r => r.idTV)) > .1) throw Error("Atlas distribution oracle failed.");
const report = { elapsedMs: performance.now() - start, panels, regions, fourFibreIdTV,
  setup: { profile: "resolved vanilla brown_liquorice", front, back, environmentIrradiance: .12, exposure: 4, coverage: "time-resolved single card",
    view: V, mipPolicy: "same compensated isolated full chains, trilinear, 2x2 supersampling", geometry: "separate bowed/cupped cards, same UVs and geometry per source",
    limits: "CPU lighting equations; no GPU/shadows, overlap/k-buffer, compressed output, TAA history or game proof" } };
writeFileSync(join(out, flowProposal ? "atlas-flow-proposal-report.json" : "atlas-compare-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ elapsedMs: report.elapsedMs, fourFibreIdTV }, null, 2)); console.table(regions);
