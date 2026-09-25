import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bakeCollection, type BakedRecord } from "../src/package-bake";
import { describePackageOmissions, OFF_PLATE_REASON, preparePackageCollection } from "../src/package-filter";
import { preflightPackageCollection } from "../src/package-preflight";
import { PLATE_REACH_MIN_BYTE, presetReachesPlate } from "../src/plate-reach";
import { plateReachInput } from "../src/plate-uv-footprint-io";
import { parsePlateUvFootprint, plateSamplePoints, plateUvBounds, plateUvFootprint, plateUvWindow, PLATE_UV_FOOTPRINT_SCHEMA,
  type PlateUvFootprint } from "../src/plate-uv-window";
import { initialRecipe, type Layer } from "../src/recipe";
import { derivePlateDocuments } from "../src/eye-plate-cut";
import { VerificationError } from "../src/mod-verifier/resource-checks";
import { errorStats } from "../src/mod-verifier/texture-checks";
import { expectedUvConstants, expectedWindow, mappingOffset, mappingStats, plateUvSamples, type PlateUvSamples } from "../src/mod-verifier/uv-window";
import { checkMapping, MAPPING_LIMITS } from "../src/mod-verifier/verify-build";
import { fixtureHeadMesh, fixtureHeadMorph, fixtureRecipe, plateLikeUv, withPlateUvs } from "./eye-plate-fixture";

/** A synthetic plate with UVs over the built-in plate's lid area (stored U .3–.7, V .7–.8; authored v .2–.3). */
const PLATE = withPlateUvs(derivePlateDocuments(fixtureHeadMesh(), fixtureHeadMorph(), fixtureRecipe(), "xfs\\eye_plate\\xfs_eye_plate.mesh"), plateLikeUv);
const MESH = PLATE.mesh.Data.RootChunk;
const FOOTPRINT = plateUvFootprint(MESH);

const lid = (): Layer => ({ ...initialRecipe().layers[0], opacity: 1, enabled: true } as Layer);
/** The same layer moved by (du, dv) in authored UV. */
const moved = (du: number, dv: number): Layer => {
  const layer = lid();
  return { ...layer, id: "moved", symmetry: false, points: layer.points.map(p => ({ ...p, u: p.u + du, v: p.v + dv })) };
};
const recipe = (...layers: Layer[]) => ({ schema: "xfs/recipe-11", uv: "gltf-uv0-top-left", layers });
const id = (n: number) => `33333333-4444-4555-8666-00000000000${n}`;
const collection = (...recipes: ReturnType<typeof recipe>[]) => ({ schema: "xfas/collection-1", id: "33333333-4444-4555-8666-000000000000",
  name: "Reach", presets: recipes.map((r, i) => ({ id: id(i + 1), name: `Preset ${i + 1}`, revision: 1, recipe: r })) });

test("the plate UV footprint: every vertex UV and triangle, the verifier's sample points, and a checked record", () => {
  expect(FOOTPRINT.schema).toBe(PLATE_UV_FOOTPRINT_SCHEMA);
  expect(FOOTPRINT.bounds).toEqual(plateUvBounds(MESH));
  const chunk = MESH.renderResourceBlob.Data.header.renderChunkInfos[0];
  expect(FOOTPRINT.uv.length).toBe(chunk.numVertices * 2);
  expect(FOOTPRINT.triangles.length).toBe(chunk.numIndices);
  // The builder's sample points are the verifier's (independently restated), with V flipped to authored v.
  const verifier = plateUvSamples(MESH), builder = plateSamplePoints(FOOTPRINT);
  expect(builder.length).toBe(verifier.uv.length);
  for (let i = 0; i < builder.length; i += 2) {
    expect(builder[i]).toBeCloseTo(verifier.uv[i], 12);
    expect(builder[i + 1]).toBeCloseTo(1 - verifier.uv[i + 1], 12);
  }
  // A JSON round trip keeps the hash; damage is refused.
  const copy = parsePlateUvFootprint(JSON.parse(JSON.stringify(FOOTPRINT)));
  expect(plateReachInput(copy).sha256).toBe(plateReachInput(FOOTPRINT).sha256);
  expect(() => parsePlateUvFootprint({ ...FOOTPRINT, triangles: [0, 1, FOOTPRINT.uv.length] })).toThrow("damaged");
  expect(() => parsePlateUvFootprint({ ...FOOTPRINT, schema: "other" })).toThrow("damaged");
});

test("PIPE-33: a preset reaches the plate only where a plate triangle is, not merely inside its rectangle", () => {
  expect(presetReachesPlate(recipe(lid()), FOOTPRINT)).toBe(true);
  expect(presetReachesPlate(recipe(moved(0, .4)), FOOTPRINT)).toBe(false);                 // below the plate's rectangle
  // A plate with a hole: two triangles, left and right, with nothing between u .45 and .55.
  const holed: PlateUvFootprint = { schema: PLATE_UV_FOOTPRINT_SCHEMA, bounds: { uMin: .3, uMax: .7, vMin: .7, vMax: .8 },
    window: FOOTPRINT.window, uv: [.3, .7, .45, .7, .3, .8, .55, .7, .7, .7, .7, .8], triangles: [0, 1, 2, 3, 4, 5] };
  const square = (u0: number, u1: number): Layer => ({ ...lid(), symmetry: false, feather: .002, pathMode: "catmull-rom",
    points: [[u0, .23], [u1, .23], [u1, .27], [u0, .27]].map(([u, v]) => ({ u, v, weight: 1 })) } as Layer);
  expect(presetReachesPlate(recipe(square(.47, .53)), holed)).toBe(false);                 // in the hole: on no triangle
  expect(presetReachesPlate(recipe(square(.32, .40)), holed)).toBe(true);
  // Only exportable active layers count: a Glitter layer on the plate does not make an off-plate preset reach it.
  expect(presetReachesPlate(recipe(moved(0, .4), { ...lid(), finish: "glitter" } as Layer), FOOTPRINT)).toBe(false);
  // Barely-there coverage (below the threshold everywhere) does not count as reaching the plate.
  expect(presetReachesPlate(recipe({ ...lid(), opacity: (PLATE_REACH_MIN_BYTE - 1) / 255 / 2 }), FOOTPRINT)).toBe(false);
});

test("PIPE-33: Check and Build omit presets off the plate as reported omissions, and record the plate they planned on", () => {
  const value = collection(recipe(lid()), recipe(moved(0, .4)), recipe(lid(), moved(0, .4)));
  const plate = plateReachInput(FOOTPRINT);
  const planned = preparePackageCollection(value, plate);
  expect(planned.omissions).toEqual([{ kind: "preset", presetId: id(2), presetName: "Preset 2", reason: OFF_PLATE_REASON }]);
  expect(planned.packaged.presets.map(p => p.id)).toEqual([id(1), id(3)]);
  expect(planned.plateUv).toEqual({ window: FOOTPRINT.window, bounds: FOOTPRINT.bounds, footprintSha256: plate.sha256 });
  expect(describePackageOmissions(planned.omissions)).toContain("omitted whole preset “Preset 2” because its makeup doesn't reach the eye plate");
  // Check through the shared preflight agrees with the filter; without a plate nothing is judged against it.
  const check = preflightPackageCollection(value, plate);
  expect(check.omissions).toEqual(planned.omissions);
  expect(check.plateUv).toEqual(planned.plateUv);
  const unplanned = preparePackageCollection(value);
  expect(unplanned.omissions).toEqual([]);
  expect(unplanned.plateUv).toBeNull();
  // Nothing on the plate: a plain refusal that says what to do.
  expect(() => preparePackageCollection(collection(recipe(moved(0, .4))), plate)).toThrow(/^No mod files can be made: none of the presets' makeup reaches the eye plate/);
});

/**
 * The mapping gate's inputs at realistic density: the built-in plate's stored UV rectangle (game 2.31) sampled on
 * a 240 × 82 grid (about the 19,680 points of the real plate), its window and the verifier's constants.
 */
const BUILT_IN = { uMin: 0.273193359375, uMax: 0.7265625, vMin: 0.67626953125, vMax: 0.8212890625 };
const WINDOW = plateUvWindow(BUILT_IN);
const SAMPLES: PlateUvSamples = (() => {
  const uv: number[] = [];
  for (let j = 0; j < 82; j++) for (let i = 0; i < 240; i++)
    uv.push(BUILT_IN.uMin + (BUILT_IN.uMax - BUILT_IN.uMin) * i / 239, BUILT_IN.vMin + (BUILT_IN.vMax - BUILT_IN.vMin) * j / 81);
  return { uv: Float64Array.from(uv), bounds: BUILT_IN };
})();
const UV = expectedUvConstants(expectedWindow(SAMPLES.bounds));

/** A one-preset collection on the lids, baked into the built-in plate's window; returns the map and reference as the verifier reads them. */
async function bakeLid(mirror: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "xfs-plate-reach-")), value = collection(recipe(lid()));
  try {
    if (mirror) {
      writeFileSync(join(dir, "collection.json"), JSON.stringify(value));
      const run = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "mirrored-window-bake.ts"), join(dir, "collection.json"),
        join(dir, "out"), JSON.stringify(WINDOW), "mirror"], { stdout: "pipe", stderr: "pipe" });
      if (run.exitCode !== 0) throw Error(run.stderr.toString());
    } else await bakeCollection(value, join(dir, "out"), () => {}, { window: WINDOW });
    const record: BakedRecord = JSON.parse(readFileSync(join(dir, "out", "compiled.json"), "utf8"))[0];
    const diffuse = readFileSync(join(dir, "out", record.maps.find(m => m.channel === "diffuse")!.file));
    const coverage = Float64Array.from({ length: record.width * record.height }, (_, t) => (diffuse[t * 4 + 3] / 255) ** 2);
    return { record, coverage, reference: new Uint8Array(readFileSync(join(dir, "out", record.reference!.file))) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const gate = (baked: Awaited<ReturnType<typeof bakeLid>>, coverage = baked.coverage) =>
  checkMapping("Lid", coverage, baked.record, UV, baked.reference, baked.record.reference!, SAMPLES);

test("PIPE-32: the coverage reference comes from the head-atlas raster, so a mirrored rasterWindow fails the mapping gate", async () => {
  const good = await bakeLid(false);
  expect(gate(good).mean).toBeLessThan(MAPPING_LIMITS.mean);
  // The same bake with `rasterWindow` mirrored in its own process: the map moves, the reference does not.
  const mirrored = await bakeLid(true);
  expect(mirrored.reference).toEqual(good.reference);
  expect(mirrored.coverage).not.toEqual(good.coverage);
  expect(() => gate(mirrored)).toThrow(VerificationError);
  expect(() => gate(mirrored)).toThrow("does not match its authored head-UV content");
}, 60_000);

test("PIPE-35: a signed offset estimate catches shifts of 2 and 4 texels that the mean-error gate lets through", async () => {
  const baked = await bakeLid(false), { width, height } = baked.record;
  const report = gate(baked);
  expect(Math.abs(report.offsetTexels.u!)).toBeLessThan(.25);
  expect(Math.abs(report.offsetTexels.v!)).toBeLessThan(.25);
  const shift = (dx: number, dy: number) => {
    const out = new Float64Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sx = x - dx, sy = y - dy;
      if (sx >= 0 && sx < width && sy >= 0 && sy < height) out[y * width + x] = baked.coverage[sy * width + sx];
    }
    return out;
  };
  for (const texels of [2, 4]) for (const [dx, dy] of [[texels, 0], [-texels, 0], [0, texels], [0, -texels]]) {
    const coverage = shift(dx, dy);
    // The estimate recovers the shift with its sign, well beyond the one-texel bound…
    const offset = mappingOffset(coverage, width, height, UV, baked.reference, baked.record.reference!, SAMPLES);
    expect(offset.u).toBeCloseTo(dx, 0);
    expect(offset.v).toBeCloseTo(dy, 0);
    expect(() => gate(baked, coverage)).toThrow(VerificationError);
    // …and at 2 texels the mean and far-off limits alone would have accepted the shifted map.
    if (texels === 2) {
      const stats = mappingStats(coverage, width, height, UV, baked.reference, baked.record.reference!, SAMPLES);
      expect(stats.mean < MAPPING_LIMITS.mean && stats.farShare < MAPPING_LIMITS.farShare).toBe(true);
      expect(() => gate(baked, coverage)).toThrow(/is shifted from its authored head-UV content/);
    }
  }
}, 60_000);

test("PIPE-33: a window map with no content at the plate, and an empty decoded check, are plain verification errors", async () => {
  const baked = await bakeLid(false);
  expect(() => gate(baked, new Float64Array(baked.coverage.length))).toThrow(VerificationError);
  expect(() => errorStats(new Float64Array())).toThrow(VerificationError);
  expect(() => errorStats(new Float64Array())).not.toThrow("No values to summarise");
}, 60_000);

test("PIPE-34: a bake without a window plans every preset on head UV, as its maps are", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-oracle-bake-"));
  try {
    const shimmer = { ...lid(), finish: "shimmer", optics: { model: "game-matched-1" } } as Layer;
    const { plan, records } = await bakeCollection(collection(recipe(lid()), recipe(shimmer)), dir);
    const written = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"));
    expect(written.presets.map((p: { uvSpace: string }) => p.uvSpace)).toEqual(["head", "head"]);
    expect(plan.presets.map(p => p.uvSpace)).toEqual(["head", "head"]);
    expect(records.map(r => [r.uvSpace, r.width, r.height, r.reference])).toEqual([["head", 1024, 1024, undefined], ["head", 1024, 1024, undefined]]);
    // With the window, the same collection plans and compiles on the plate window.
    const windowed = await bakeCollection(collection(recipe(lid())), join(dir, "window"), () => {}, { window: FOOTPRINT.window });
    expect([windowed.plan.presets[0].uvSpace, windowed.records[0].uvSpace]).toEqual(["plate-window", "plate-window"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);
