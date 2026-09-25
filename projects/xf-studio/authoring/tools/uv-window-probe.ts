// Development probe for the plate-local UV window (experiments/019-uv-window). Reads one finished,
// verified intermediate build and, for each window preset, reports how well the decoded window maps
// match the authored head-UV coverage at the plate's own UVs under the packaged transform and under
// deliberately wrong alternatives (V sign flipped, V mirrored, rows not reversed, offset by 2 and 8 texels),
// with the gate's signed offset estimate. It shows that the verifier's mapping gate separates the right
// mapping from plausible mistakes.
//
//   bun tools/uv-window-probe.ts <build-dir>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDdsChain } from "../src/mod-verifier/dds-reader";
import { mappingOffset, mappingStats, plateUvSamples } from "../src/mod-verifier/uv-window";

const build = process.argv[2];
if (!build) throw Error("Usage: bun tools/uv-window-probe.ts <build-dir>");
const record = JSON.parse(readFileSync(join(build, "build.json"), "utf8"));
const verification = JSON.parse(readFileSync(join(build, "verification.json"), "utf8"));
const meshName = record.plan.mesh.slice(record.plan.mesh.lastIndexOf("/") + 1);
const mesh = JSON.parse(readFileSync(join(build, "verify", "json", meshName + ".json"), "utf8").replace(/^﻿/, "")).Data.RootChunk;
const samples = plateUvSamples(mesh), right = verification.plateUvWindow.constants;
/** The packaged mapping and wrong alternatives, with offsets in texels of the map being probed (2048 × 512, or a glitter preset's 4096 × 1024). */
const variants = (width: number, height: number): Record<string, Record<string, number>> => ({
  packaged: right,
  "V offset sign flipped": { ...right, UVOffsetY: -right.UVOffsetY },
  "V mirrored in the window": { ...right, UVScaleY: -right.UVScaleY, UVOffsetY: -right.UVOffsetY },
  "U offset by 2 texels": { ...right, UVOffsetX: right.UVOffsetX + 2 / width },
  "V offset by 2 texels": { ...right, UVOffsetY: right.UVOffsetY + 2 / height },
  "U offset by 8 texels": { ...right, UVOffsetX: right.UVOffsetX + 8 / width },
});
const ddsDirs = join(build, "verify", "dds");
for (const [i, preset] of record.plan.presets.entries()) {
  const compiled = record.compiled[i];
  if (compiled.uvSpace !== "plate-window") continue;
  const file = preset.textures.diffuse.slice(preset.textures.diffuse.lastIndexOf("/") + 1).replace(/\.xbm$/, ".dds");
  const chain = readDdsChain(new Uint8Array(readFileSync(join(ddsDirs, "0", file))), "diffuse", file);
  const coverage = new Float64Array(chain.width * chain.height);
  for (let t = 0; t < coverage.length; t++) { const a = chain.levels[0][t * 4 + 3] / 255; coverage[t] = a * a; }
  const unreversed = new Float64Array(coverage.length);
  for (let y = 0; y < chain.height; y++) unreversed.set(coverage.subarray((chain.height - 1 - y) * chain.width, (chain.height - y) * chain.width), y * chain.width);
  const reference = new Uint8Array(readFileSync(join(build, "baked", compiled.reference.file)));
  const rows: Record<string, unknown> = {}, crop = compiled.reference;
  const row = (map: Float64Array, constants: Record<string, number>) => ({ ...mappingStats(map, chain.width, chain.height, constants, reference, crop, samples),
    offsetTexels: mappingOffset(map, chain.width, chain.height, constants, reference, crop, samples) });
  for (const [name, constants] of Object.entries(variants(chain.width, chain.height))) rows[name] = row(coverage, constants);
  rows["rows not reversed"] = row(unreversed, right);
  console.log(JSON.stringify({ preset: preset.name, rows }, (_, v) => typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v));
}
