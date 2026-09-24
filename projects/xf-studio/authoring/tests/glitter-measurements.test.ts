import { expect, test } from "bun:test";
import { defaultIrregularFlakes, FLAKE_LIMITS } from "../src/flake-field";
import { GlitterMeasurements } from "../src/glitter-measurements";
import type { GlitterStats } from "../src/raster-processor";
import { initialRecipe, type Layer } from "../src/recipe";

const stats = (maskCentres: number): GlitterStats => ({ generated: 90000, regionRetained: 40000, maskCentres,
  paintedPixels: 5000, coveredPixels: 1200, quarterCoveragePixels: 300, halfCoveragePixels: 100 });

function fixture() {
  const recipe = initialRecipe();
  const glitter = recipe.layers[0] as Layer;
  glitter.finish = "glitter"; glitter.flakes = { ...defaultIrregularFlakes(), radius: .0005 };
  let size = 1024;
  const measurements = new GlitterMeasurements({ layers: () => recipe.layers, size: () => size });
  return { recipe, glitter, measurements, setSize: (next: number) => { size = next; } };
}

test("reports a measurement as current only while the layer and preview tier are unchanged", () => {
  const { glitter, measurements, setSize } = fixture();
  expect(measurements.snapshot()).toEqual([]);
  measurements.record(glitter, 1024, stats(321));
  expect(measurements.snapshot()).toEqual([{ layerId: glitter.id, size: 1024, maskCentres: 321,
    regionRetained: 40000, coveredPixels: 1200, dense: false, current: true }]);
  setSize(2048);
  expect(measurements.forLayer(glitter)?.current).toBe(false);
  setSize(1024);
  glitter.points[0]!.u += 0.001;
  expect(measurements.forLayer(glitter)?.current).toBe(false);
});

test("an optical change stales the figures and the dense threshold follows the flake count", () => {
  const { glitter, measurements } = fixture();
  measurements.record(glitter, 1024, stats(10));
  if (glitter.flakes && "count" in glitter.flakes) glitter.flakes.count = FLAKE_LIMITS.count + 1;
  const measured = measurements.forLayer(glitter)!;
  expect(measured.dense).toBe(true);
  expect(measured.current).toBe(false);
});

test("only irregular Glitter layers are reported and snapshots are detached", () => {
  const { recipe, glitter, measurements } = fixture();
  const other = recipe.layers[1] as Layer;
  measurements.record(other, 1024, stats(5));
  measurements.record(glitter, 1024, stats(7));
  const snapshot = measurements.snapshot();
  expect(snapshot.map(item => item.layerId)).toEqual([glitter.id]);
  snapshot[0]!.maskCentres = 0;
  expect(measurements.forLayer(glitter)?.maskCentres).toBe(7);
  glitter.finish = "matte";
  expect(measurements.snapshot()).toEqual([]);
});
