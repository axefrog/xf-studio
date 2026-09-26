import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runWorkerCheck } from "../../src/platform/export/check-runner";
import { desktopPackageRequest } from "../package";
import { derivePlateDocuments } from "../../src/eye-plate-cut";
import { OFF_PLATE_REASON } from "../../src/package-filter";
import { plateReachInput } from "../../src/plate-uv-footprint-io";
import { plateUvFootprint } from "../../src/engines/layered-makeup/plate-uv-window";
import { fixtureHeadMesh, fixtureHeadMorph, fixtureRecipe, plateLikeUv, withPlateUvs } from "../../tests/eye-plate-fixture";
import { withGlitterKnob } from "../../tests/glitter-knob-fixture";
import { preparePackageCollection } from "../../tests/fixtures/eye-exporter";

const directory = mkdtempSync(resolve(tmpdir(), "xfs-check-worker-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const request = (collection: unknown) => new Request("http://127.0.0.1:4317/api/package", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "check", collection }),
});

test("pathological Check is stopped at its deadline without blocking loopback", async () => {
  const path = resolve(directory, "stalled-worker.js");
  writeFileSync(path, "self.onmessage = () => { while (true) {} };\n");
  const started = performance.now();
  const pending = desktopPackageRequest(request({}), path, 300);
  const busy = await desktopPackageRequest(request({}), path, 300);
  expect(busy.status).toBe(409);
  expect(await busy.json()).toMatchObject({ code: "package_check_busy" });
  let heartbeat = false;
  setTimeout(() => { heartbeat = true; }, 10);
  const response = await pending;
  expect(heartbeat).toBe(true);
  expect(response.status).toBe(504);
  expect(await response.json()).toMatchObject({ code: "package_check_timeout" });
  expect(performance.now() - started).toBeLessThan(2000);
});

test("worker failure and malformed replies publish no Check result", async () => {
  const malformed = resolve(directory, "malformed-worker.js");
  writeFileSync(malformed, "self.onmessage = () => self.postMessage({ kind: 'success', result: null });\n");
  const result = await runWorkerCheck({ collection: {}, prerequisites: {}, collectionSha256: "" }, malformed, 1000);
  expect(result).toMatchObject({ kind: "failure", code: "package_check_worker_failed" });
  const missing = await desktopPackageRequest(request({}), resolve(directory, "missing-worker.js"), 1000);
  expect(missing.status).toBe(503);
  expect(await missing.json()).toMatchObject({ code: "package_check_worker_failed" });
});

test("aborting an in-flight Check discards its worker result", async () => {
  const path = resolve(directory, "abort-worker.js");
  writeFileSync(path, "self.onmessage = () => { while (true) {} };\n");
  const controller = new AbortController();
  const pending = runWorkerCheck({ collection: {}, prerequisites: {}, collectionSha256: "" }, path, 1000, controller.signal);
  controller.abort();
  expect(await pending).toMatchObject({ kind: "failure", code: "package_check_cancelled" });
});

test("the standalone packaged Bun worker runs the shared preflight", async () => {
  const output = mkdtempSync(resolve(tmpdir(), "xfs-packaged-check-"));
  try {
    const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, "../check-worker.ts")],
      target: "bun", outdir: output });
    expect(built.success).toBe(true);
    const collection = JSON.parse(readFileSync(resolve(import.meta.dir,
      "../../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
    const response = await desktopPackageRequest(request(collection), resolve(output, "check-worker.js"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ schema: "xfs/package-check-2", ready: true, originalPresetCount: 4 });
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test("PIPE-33: the worker plans on the prepared plate the host passes, and omits a preset that misses it", async () => {
  const collection = JSON.parse(readFileSync(resolve(import.meta.dir,
    "../../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
  for (const layer of collection.presets[1].recipe.layers) layer.points = layer.points.map((p: { v: number }) => ({ ...p, v: p.v + .4 }));
  const plate = plateReachInput(plateUvFootprint(withPlateUvs(derivePlateDocuments(fixtureHeadMesh(), fixtureHeadMorph(), fixtureRecipe(),
    "a\b.mesh"), plateLikeUv).mesh.Data.RootChunk));
  const worker = resolve(import.meta.dir, "../check-worker.ts");
  const planned = await runWorkerCheck({ collection, prerequisites: { "eye-makeup/plate": plate }, collectionSha256: "" }, worker, 15_000);
  expect(planned.kind).toBe("success");
  if (planned.kind !== "success") return;
  const eyes = planned.result.products[0].features[0];
  // The look that misses the plate is left out whole, in the result (PIPE-88).
  expect(planned.result.omissions).toEqual([{ kind: "preset", presetId: collection.presets[1].id, presetName: collection.presets[1].name,
    reason: OFF_PLATE_REASON }]);
  expect(eyes.omissions).toEqual([]);
  expect((eyes.details.plateUv as { footprintSha256: string }).footprintSha256).toBe(plate.sha256);
  const unplanned = await runWorkerCheck({ collection, prerequisites: {}, collectionSha256: "" }, worker, 15_000);
  expect(unplanned.kind === "success" && unplanned.result.omissions).toEqual([]);
}, 30_000);

test("PIPE-70: a posted collection's glitter knob gives no glitter route and no diagnostics in the desktop Check", async () => {
  const knob = withGlitterKnob(JSON.parse(readFileSync(resolve(import.meta.dir,
    "../../../../../experiments/005-preset-collection/editor-collection.json"), "utf8")));
  expect(preparePackageCollection(knob).plan.presets.some(p => p.route === "glitter")).toBe(true);
  // Through the desktop's own package route: the host drops the knob before the worker plans.
  const response = await desktopPackageRequest(request(knob), resolve(import.meta.dir, "../check-worker.ts"), 15_000);
  expect(response.status).toBe(200);
  const eyes = (await response.json()).products[0].features[0];
  expect(eyes.presets.map((p: { route: string }) => p.route)).not.toContain("glitter");
  expect(eyes.presets.every((p: object) => !("diagnostics" in p))).toBe(true);
  expect(eyes.details.plateLiftsMm).toEqual([.4]);
}, 30_000);
