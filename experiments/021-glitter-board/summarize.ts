// Summarises one verified glitter-board build into asset-free numbers (result.json): per preset, the nested
// flake counts per level from the compiler's record, and the independent verifier's offline checks (plate
// mapping and V sign, BC5 error on flake normals, BC4 error on flake edges, whether WolvenKit kept the supplied
// nested chain, resolved/nested flake components, BOX and sheen rules, flake contents and pigment, the accent chunk
// with its stored rows and placement at the plate's UVs).
//
//   bun experiments/021-glitter-board/summarize.ts <build-dir> [--json experiments/021-glitter-board/result.json]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [build, flag, out] = process.argv.slice(2);
if (!build) throw Error("Usage: bun experiments/021-glitter-board/summarize.ts <build-dir> [--json <file>]");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
// Product builds keep each feature's record under features/<feature>/ and its verifier report in the product's
// verification.json; earlier single-feature builds kept both at the build root.
const featureRecord = join(build, "features", "eye-makeup", "build.json");
const record = read(existsSync(featureRecord) ? featureRecord : join(build, "build.json"));
const verification = read(join(build, "verification.json"));
const report = verification.features?.find((f: { feature: string }) => f.feature === "eye-makeup") ?? verification;
const round = (v: unknown, digits = 4): unknown => typeof v === "number" ? Math.round(v * 10 ** digits) / 10 ** digits
  : Array.isArray(v) ? v.map(x => round(x, digits)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x, digits)])) : v;

const presets = record.plan.presets.map((preset: { name: string; appearance: string }, i: number) => {
  const compiled = record.compiled[i], pixel = report.decodedPixelChecks[i];
  return {
    name: preset.name,
    compiled: compiled.metadata.levels.slice(0, 6).map((level: { level: number; width: number; height: number; texelMm: number[]; regions: { layer: string; mips: string; catalogue: number; represented: number; minWidthTexels: number | null; targetCover: number; maskMean: number }[] }) => ({
      level: level.level, size: `${level.width}x${level.height}`, texelMm: level.texelMm,
      regions: level.regions.map(r => ({ layer: r.layer, mips: r.mips, catalogue: r.catalogue, represented: r.represented, minWidthTexels: r.minWidthTexels, targetCover: r.targetCover, maskMean: r.maskMean })),
    })),
    ...(compiled.metadata.accent ? { accentCompiled: compiled.metadata.accent } : {}),
    mapping: round({ mean: pixel.mapping.mean, farShare: pixel.mapping.farShare, offsetTexels: pixel.mapping.offsetTexels, samples: pixel.mapping.samples }),
    storedRows: pixel.storedRows,
    flakeNormalDegrees: round(pixel.decoded.flakeNormalDegrees, 3),
    flakeEdgeError: round(pixel.decoded.flakeEdgeError),
    keptChain: round(pixel.decoded.keptChain),
    decodedLevelErrorMax: round(pixel.decoded.levels.slice(0, 6).map((row: Record<string, number>) =>
      Math.max(...["diffuse", "alpha", "roughness", "metalness", "flakes", "normal"].map(k => row[k])))),
    chains: round({ levels: pixel.chains.levels.slice(0, 6), regionCover: pixel.chains.regionCover, boxTexelsChecked: pixel.chains.boxTexelsChecked,
      sheenTexelsChecked: pixel.chains.sheenTexelsChecked, maxTiltSine: pixel.chains.maxTiltSine, flakeTexelsChecked: pixel.chains.flakeTexelsChecked,
      minNormalMatch: pixel.chains.minNormalMatch, minTiltedShare: pixel.chains.minTiltedShare, pigmentTexelsChecked: pixel.chains.pigmentTexelsChecked }),
    ...(pixel.accent ? { accent: round({ levels: pixel.accent.levels.slice(0, 3), onFlakes: pixel.accent.onFlakes, components: pixel.accent.components, judged: pixel.accent.judged,
      flakeComponents: pixel.accent.flakeComponents, decodedError: pixel.accent.decodedError, storedRows: pixel.accent.storedRows,
      placement: pixel.accent.placement }) } : {}),
  };
});
const result = {
  experiment: "021-glitter-board", archiveSha256: report.archiveSha256, archiveBytes: report.archiveBytes, archiveXlSha256: report.archiveXlSha256,
  members: report.unpackedFilesVerified, textures: report.textureCount, materialEntries: report.materialTemplates,
  plate: { liftsMm: report.plateGeometry.liftsMm, chunks: report.plateGeometry.chunks, inputs: report.plateInputs },
  window: round(report.plateUvWindow, 6), presets,
};
if (flag === "--json" && out) { writeFileSync(out, JSON.stringify(result, null, 1) + "\n"); console.log(`Wrote ${out}`); }
else console.log(JSON.stringify(result, null, 1));
