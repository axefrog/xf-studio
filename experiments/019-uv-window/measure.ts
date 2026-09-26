// Measures fine detail in one finished, verified build of uv-window.collection.json (asset-free
// numbers only; reads the private build directory, writes nothing there).
//
//   bun experiments/019-uv-window/measure.ts <build-dir> [--json out.json]
//
// 1. Block-compression error at level 0: WolvenKit's decoded export (BC7 colour, BC4 scalars) against the
//    compiler's exact bytes, split into edge texels (0 < coverage < 1) and interior texels.
// 2. Resolving power: coverage profiles through the line and dot patterns as the game samples them at level 0
//    and levels 1 and 2 (bilinear, through each preset's own UV transform or head UV). Modulation is the peak
//    inside a line or dot minus the mean of the gap beside it (authored: 1). At a given framing the window's
//    level is about two above the head atlas's, because its texels are about 4.3 x 3.3 times denser.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readDdsChain } from "../../projects/xf-studio/authoring/src/features/eye-makeup/verify/dds-reader";

const [build, flag, out] = process.argv.slice(2);
if (!build) throw Error("Usage: bun experiments/019-uv-window/measure.ts <build-dir> [--json out.json]");
const record = JSON.parse(readFileSync(join(build, "build.json"), "utf8"));
const report = JSON.parse(readFileSync(join(build, "verification.json"), "utf8"));
const collection = JSON.parse(readFileSync(new URL("./uv-window.collection.json", import.meta.url), "utf8"));
const uv = report.plateUvWindow.constants as Record<string, number>;
const file = (depot: string) => depot.slice(depot.lastIndexOf("/") + 1).replace(/\.xbm$/, ".dds");
const decoded = (depot: string) => readDdsChain(new Uint8Array(readFileSync(join(build, "verify", "dds", "0", file(depot)))), "diffuse", depot);
const raw = (name: string) => new Uint8Array(readFileSync(join(build, "baked", name)));
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return n ? { n, mean: values.reduce((a, b) => a + b, 0) / n, p95: sorted[Math.floor(.95 * (n - 1))], max: sorted[n - 1] } : { n: 0 };
};

type Grid = { width: number; height: number; coverage: Float64Array };
function bilinear(g: Grid, x: number, y: number) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const at = (i: number, j: number) => g.coverage[Math.min(g.height - 1, Math.max(0, j)) * g.width + Math.min(g.width - 1, Math.max(0, i))];
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}
/** Coverage the game samples at authored (u, v) on mip `level`: window presets through the UV transform and row flip. */
function gameSample(levels: Grid[], windowed: boolean, level: number, u: number, v: number) {
  const g = levels[level];
  if (!windowed) return bilinear(g, u * g.width - .5, v * g.height - .5);
  const V = 1 - v, tu = uv.UVScaleX * (u - .5) + .5 + uv.UVOffsetX, tv = uv.UVScaleY * (V - .5) + .5 + uv.UVOffsetY;
  return bilinear(g, tu * g.width - .5, (1 - tv) * g.height - .5);
}

const rows: Record<string, unknown>[] = [];
const byName = new Map(record.plan.presets.map((p: { name: string }, i: number) => [p.name, i]));
for (const [i, preset] of record.plan.presets.entries()) {
  const compiled = record.compiled[i], chain = decoded(preset.textures.diffuse);
  const source = raw(compiled.maps.find((m: { channel: string }) => m.channel === "diffuse").file);
  const edge: number[] = [], interior: number[] = [], colour: number[] = [];
  for (let t = 0; t < source.length / 4; t++) {
    const a = source[t * 4 + 3] / 255, c = a * a, d = (chain.levels[0][t * 4 + 3] / 255) ** 2;
    if (c <= 0) continue;
    (c < .999 ? edge : interior).push(Math.abs(d - c));
    for (let k = 0; k < 3; k++) colour.push(Math.abs(chain.levels[0][t * 4 + k] - source[t * 4 + k]) / 255);
  }
  rows.push({ preset: preset.name, uvSpace: compiled.uvSpace, size: `${compiled.width}x${compiled.height}`,
    bcCoverageEdge: stats(edge), bcCoverageInterior: stats(interior), bcColour: stats(colour) });
}

// Profiles through the patterns (authored geometry read back from the collection itself).
const lines = collection.presets[0].recipe.layers.filter((l: { name: string }) => l.name.startsWith("Line"));
const dots = collection.presets[0].recipe.layers.filter((l: { name: string }) => l.name.startsWith("Dot"));
const bounds = (l: { points: { u: number; v: number }[] }) => ({ u0: Math.min(...l.points.map(p => p.u)), u1: Math.max(...l.points.map(p => p.u)),
  v0: Math.min(...l.points.map(p => p.v)), v1: Math.max(...l.points.map(p => p.v)) });
const profiles: Record<string, unknown>[] = [];
for (const density of ["new", "old"]) {
  const index = byName.get(`Lines · ${density} density`) as number, preset = record.plan.presets[index], chain = decoded(preset.textures.diffuse);
  const levels: Grid[] = chain.levels.map((level, k) => {
    const width = Math.max(1, chain.width >> k), height = Math.max(1, chain.height >> k), coverage = new Float64Array(width * height);
    for (let t = 0; t < coverage.length; t++) coverage[t] = (level[t * 4 + 3] / 255) ** 2;
    return { width, height, coverage };
  });
  const windowed = record.compiled[index].uvSpace === "plate-window";
  for (const level of [0, 1, 2]) {
    const measure = (inside: [number, number][], gaps: [number, number][]) => {
      const peak = Math.max(...inside.map(([u, v]) => gameSample(levels, windowed, level, u, v)));
      const gap = gaps.map(([u, v]) => gameSample(levels, windowed, level, u, v)).reduce((a, b) => a + b, 0) / gaps.length;
      return { peak: +peak.toFixed(3), modulation: +(peak - gap).toFixed(3) };
    };
    for (const l of lines) {
      const b = bounds(l), h = b.v1 - b.v0, u = (b.u0 + b.u1) / 2;
      const inside = Array.from({ length: 9 }, (_, k): [number, number] => [u, b.v0 + h * (k + .5) / 9]);
      // The gap below each line is as tall as the line (the gap above belongs to the previous, thinner pair).
      profiles.push({ density, level, pattern: l.name, ...measure(inside, [[u, b.v1 + h / 2]]) });
    }
    for (const size of [.5, 1, 2]) {
      const row = dots.filter((d: { points: { u: number; v: number }[] }) => Math.abs((bounds(d).u1 - bounds(d).u0) * 569 - size) < .05);
      const first = bounds(row[0]), w = first.u1 - first.u0, v = (first.v0 + first.v1) / 2;
      const inside = row.flatMap((d: { points: { u: number; v: number }[] }) => { const b = bounds(d); return Array.from({ length: 5 }, (_, k): [number, number] => [b.u0 + w * (k + .5) / 5, v]); });
      const gaps = row.slice(0, -1).map((d: { points: { u: number; v: number }[] }): [number, number] => [bounds(d).u1 + w / 2, v]);
      profiles.push({ density, level, pattern: `Dots ${size} mm`, ...measure(inside, gaps) });
    }
  }
}
const result = { build: record.plan.namespace, archiveSha256: record.archiveSha256, plateUvWindow: report.plateUvWindow, compression: rows, profiles };
if (flag === "--json" && out) writeFileSync(out, JSON.stringify(result, (_, v) => typeof v === "number" ? Math.round(v * 1e5) / 1e5 : v, 2) + "\n");
console.log(JSON.stringify(result, (_, v) => typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v, 1));
