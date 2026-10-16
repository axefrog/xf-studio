/**
 * CPU atlas benchmark and flat-card comparison. No browser, GPU or game.
 * bun tools/hair-atlas-peek.ts [output build folder] [reference build folder] [atlas description JSON]
 * First create an optional private reference with hair-atlas-reference.ts. Outputs stay ignored.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { defaultHairAtlas, generateHairAtlas, decodeHairFlow, measureAtlasRegion,
  type HairAtlasDescription, type HairAtlasLevel } from "../src/features/hair-lab/textures";
import { bakeHairProfile, hairAlbedo, hairDirectLight, hairEnvironmentLight, hairRoughness, hairCoverage,
  hairResolvedCoverage, resolveHairMaterial, linearToSrgb8, srgbToLinear, type ProfileStop, type Rgb } from "../src/hair-colour-model";
import { decodePng, encodePng, type RgbaImage } from "../src/png";

const [outArg = "build/hair-lab-wip", reference, descriptionFile] = process.argv.slice(2), out = resolve(outArg);
if (!out.replaceAll("\\", "/").includes("/build/")) throw Error("Atlas peeks must be in an ignored build folder.");
mkdirSync(out, { recursive: true });
const description = descriptionFile ? JSON.parse(readFileSync(descriptionFile, "utf8")) as HairAtlasDescription : defaultHairAtlas();
const start = performance.now(), atlas = generateHairAtlas(description), generationMs = performance.now() - start;
const base = atlas.levels[0]!;
const save = (name: string, image: RgbaImage) => {
  const bytes = encodePng(image, { alpha: false, level: 3 }); writeFileSync(join(out, name), bytes); return bytes.length;
};
const rgba = (map: Uint8Array, width: number, height: number, channels = 1): RgbaImage => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = map[i * channels + (channels === 1 ? 0 : c)]!;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
};
const pngStart = performance.now(), pngBytes: Record<string, number> = {};
for (const [key, name] of [["alpha", "atlas-01-alpha.png"], ["id", "atlas-02-id.png"],
  ["gradient", "atlas-03-gradient.png"], ["flow", "atlas-04-flow.png"]] as const)
  pngBytes[key] = save(name, rgba(base[key], base.width, base.height, key === "flow" ? 3 : 1));
const pngMs = performance.now() - pngStart;

/** GPU-style bilinear read at normalised image UV, with gamma conversion before interpolation. */
function sample(image: RgbaImage, u: number, v: number, channel: number, gamma = false): number {
  const x = u * image.width - .5, y = v * image.height - .5, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  let value = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const k = (Math.max(0, Math.min(image.height - 1, iy + dy)) * image.width + Math.max(0, Math.min(image.width - 1, ix + dx))) * 4 + channel;
    const b = image.data[k]!; value += (gamma ? srgbToLinear(b) : b / 255) * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
  }
  return value;
}
function referenceLevel(folder: string, size: number): HairAtlasLevel {
  const result: HairAtlasLevel = { width: size, height: size, alpha: new Uint8Array(size * size), id: new Uint8Array(size * size),
    gradient: new Uint8Array(size * size), flow: new Uint8Array(size * size * 3) };
  for (const [key, name] of [["alpha", "Strand_Alpha"], ["id", "Strand_ID"], ["gradient", "Strand_Gradient"], ["flow", "Flow"]] as const) {
    const image = decodePng(readFileSync(join(folder, `atlas-vanilla-${name}.png`))), channels = key === "flow" ? 3 : 1;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let c = 0; c < channels; c++) {
      const v = sample(image, (x + .5) / size, (y + .5) / size, c, key === "flow");
      result[key][(y * size + x) * channels + c] = Math.round(key === "flow" ? linearToSrgb8(v) : 255 * v);
    }
  }
  return result;
}
type Profile = { sampleCount?: number; gradientEntriesID: { value: number; color: { Red: number; Green: number; Blue: number } }[];
  gradientEntriesRootToTip: Profile["gradientEntriesID"] };
const profileFile = reference && join(reference, "atlas-vanilla-profile.json");
const profile: Profile = profileFile && existsSync(profileFile) ? JSON.parse(readFileSync(profileFile, "utf8")) as Profile : {
  sampleCount: 127, gradientEntriesID: [{ value: 0, color: { Red: 100, Green: 90, Blue: 70 } }, { value: 1, color: { Red: 190, Green: 170, Blue: 140 } }],
  gradientEntriesRootToTip: [{ value: 0, color: { Red: 60, Green: 45, Blue: 30 } }, { value: 1, color: { Red: 155, Green: 110, Blue: 65 } }],
};
const stops = (entries: Profile["gradientEntriesID"]): ProfileStop[] => entries.map(e => ({ value: e.value, color: [e.color.Red, e.color.Green, e.color.Blue] }));
const count = profile.sampleCount ?? 64, idRow = bakeHairProfile(stops(profile.gradientEntriesID), count), rootRow = bakeHairProfile(stops(profile.gradientEntriesRootToTip), count);
const material = resolveHairMaterial({ alphaCutoff: description.alphaCutoff }), keyLight: Rgb = [.25, .18, Math.sqrt(1 - .25 ** 2 - .18 ** 2)];
function shade(map: HairAtlasLevel, generated = false): { image: RgbaImage; visibleMean: Rgb; coverage: number } {
  const side = 512, image: RgbaImage = { width: side, height: side, data: new Uint8Array(side * side * 4) };
  const mean: Rgb = [0, 0, 0]; let weight = 0;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    // Point sample the already reconstructed common UV atlas: no asymmetric image resize filter.
    const k = Math.min(map.height - 1, Math.floor((y + .5) / side * map.height)) * map.width
      + Math.min(map.width - 1, Math.floor((x + .5) / side * map.width));
    const id = map.id[k]! / 255, gradient = map.gradient[k]! / 255;
    const a = hairResolvedCoverage(hairCoverage(map.alpha[k]! / 255, material.alphaCutoff));
    const c = hairAlbedo(idRow, rootRow, count, id, gradient, 0, material), rough = hairRoughness(id, 1, material);
    const flow = decodeHairFlow(map.flow[k * 3]!, map.flow[k * 3 + 1]!, map.flow[k * 3 + 2]!);
    const px = k % map.width, py = Math.floor(k / map.width);
    const mirrored = generated && atlas.regions.some(r => r.mirrored && px >= r.cell.x && px < r.cell.x + r.cell.width && py >= r.cell.y && py < r.cell.y + r.cell.height);
    const tangent: Rgb = [flow[0] * (mirrored ? -1 : 1), flow[1], 0], direct = hairDirectLight(keyLight, [0, 0, 1], tangent, [0, 0, 1], c, rough, undefined, id, "local");
    const env = hairEnvironmentLight([0, 0, 1], tangent, [0, 0, 1], c, rough, undefined, id);
    for (let channel = 0; channel < 3; channel++) {
      const lit = direct.diffuse[channel]! + direct.specular[channel]! + .25 * (env.diffuse[channel]! + env.specular[channel]!);
      mean[channel]! += lit * a;
      image.data[(y * side + x) * 4 + channel] = Math.round(linearToSrgb8(4 * (a * lit + (1 - a) * .00625)));
    }
    weight += a; image.data[(y * side + x) * 4 + 3] = 255;
  }
  return { image, visibleMean: mean.map(v => v / (weight || 1)) as Rgb, coverage: weight / (side * side) };
}
const shadeStart = performance.now(), generated = shade(base, true); save("atlas-05-shaded.png", generated.image);
const referenceMap = reference ? referenceLevel(reference, base.width) : null;
const referenceShade = referenceMap ? shade(referenceMap) : null;
if (referenceShade) save("atlas-06-reference-shaded.png", referenceShade.image);
const shadeMs = performance.now() - shadeStart;
const histogramDistance = (a: readonly number[], b: readonly number[]) => a.reduce((n, v, i) => n + Math.abs(v - b[i]!), 0) / 2;
const regions = atlas.regions.map(r => {
  const generated = measureAtlasRegion(base, r.rect, description.alphaCutoff);
  const measured = referenceMap ? measureAtlasRegion(referenceMap, r.rect, description.alphaCutoff) : null;
  return { key: r.key, type: r.type, uv: r.uv, mirrored: r.mirrored, direction: r.direction, generated, reference: measured,
    error: measured ? { coverage: generated.coverage - measured.coverage, idMean: generated.id.mean - measured.id.mean,
      gradientMean: generated.gradient.mean - measured.gradient.mean,
      idTotalVariation: histogramDistance(generated.id.histogram, measured.id.histogram),
      gradientTotalVariation: histogramDistance(generated.gradient.histogram, measured.gradient.histogram),
      shiftTotalVariation: histogramDistance(generated.shift.histogram, measured.shift.histogram) } : null,
    mips: r.coverage };
});
const report = { description, generationMs, pngMs, shadeMs,
  bufferBytes: atlas.levels.reduce((n, m) => n + m.alpha.byteLength + m.id.byteLength + m.gradient.byteLength + m.flow.byteLength, 0),
  pngBytes, maxSafeMip: atlas.maxSafeMip, flowError: atlas.flowError, regions,
  flatCard: { profile: reference ? "resolved vanilla hairstyle 01 profile" : "authored diagnostic brown", keyLight,
    view: [0, 0, 1], normal: [0, 0, 1], environmentIrradiance: .25, displayExposure: 4, path: "local", material,
    generated: { visibleMean: generated.visibleMean, coverage: generated.coverage },
    reference: referenceShade ? { visibleMean: referenceShade.visibleMean, coverage: referenceShade.coverage } : null,
    evidence: "CPU model, one flat card, no compression, TAA history, multi-card k-buffer or game rendering" } };
writeFileSync(join(out, "atlas-report.json"), JSON.stringify(report, null, 2));
writeFileSync(join(out, "atlas-description.json"), JSON.stringify(description, null, 2));
console.log(JSON.stringify({ generationMs, pngMs, shadeMs, bufferBytes: report.bufferBytes, pngBytes,
  maxSafeMip: atlas.maxSafeMip, flowError: atlas.flowError, flatCard: report.flatCard }, null, 2));
console.table(regions.map(r => ({ key: r.key, coverage: r.generated.coverage.toFixed(3),
  reference: r.reference?.coverage.toFixed(3), idError: r.error?.idMean.toFixed(3), gradientError: r.error?.gradientMean.toFixed(3),
  idTV: r.error?.idTotalVariation.toFixed(3), gradientTV: r.error?.gradientTotalVariation.toFixed(3),
  mipError: Math.max(...r.mips.map(m => Math.abs(m.corrected - m.target))).toExponential(1) })));
