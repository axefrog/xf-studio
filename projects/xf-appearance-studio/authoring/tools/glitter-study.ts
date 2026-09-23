/** Reproducible owned-pixel study; no game assets, browser state or installation. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createFlakeJob, defaultFlakes } from "../src/finish";
import { createFlakeCatalogue, createFlakeBakeJob, composeFlakeColour, defaultIrregularFlakes } from "../src/flake-field";

const output = resolve(import.meta.dir, "../../../../experiments/007-irregular-glitter/generated");
mkdirSync(output, { recursive: true });
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const base = "#592640", candidate = defaultIrregularFlakes();
const specs = [
  { name: "legacy", settings: null, sizes: [1024, 2048] },
  { name: "sparse", settings: { ...candidate, count: 6000 }, sizes: [1024, 2048] },
  { name: "default", settings: candidate, sizes: [1024, 2048] },
  { name: "default-16sample", settings: candidate, sizes: [1024, 2048], sampleAxis: 4 as const },
  { name: "dense", settings: { ...candidate, count: 30000 }, sizes: [1024, 2048] },
  { name: "maximum", settings: { ...candidate, count: 32768, radius: 0.003, spread: 1, tilt: 1 }, sizes: [1024, 2048] },
];
const records = [];
for (const spec of specs) {
  const startCatalogue = performance.now();
  const catalogue = spec.settings ? createFlakeCatalogue(spec.settings) : null;
  const catalogueMs = performance.now() - startCatalogue;
  const radii = catalogue?.flakes.map(f => f.radius).sort((a,b) => a-b);
  const quantiles = radii ? [0, .1, .5, .9, 1].map(q => radii[Math.floor(q * (radii.length - 1))]) : null;
  for (const size of spec.sizes) {
    const started = performance.now();
    const job = catalogue ? createFlakeBakeJob(catalogue, size, spec.sampleAxis ?? 2) : createFlakeJob(size, "glitter", defaultFlakes());
    let slices = 0, maxSliceMs = 0;
    while (!job.done) {
      const slice = performance.now();
      job.advance(4096);
      maxSliceMs = Math.max(maxSliceMs, performance.now() - slice);
      slices++;
    }
    const bakeMs = performance.now() - started;
    const color = composeFlakeColour(job.surface, base, spec.settings?.color ?? base);
    const files = [];
    for (const [kind, data] of [["normal", job.normal], ["surface", job.surface], ["color", color]] as const) {
      const name = `${spec.name}-${size}-${kind}.rgba`;
      writeFileSync(resolve(output, name), data);
      files.push({ name, bytes: data.byteLength, sha256: sha(data) });
    }
    const record = { name: spec.name, size, settings: spec.settings ?? defaultFlakes(), sampleAxis: spec.sampleAxis ?? 2, base, catalogueMs, radiusQuantiles: quantiles,
      bakeMs, maxSliceMs, slices, diagnostics: "diagnostics" in job ? job.diagnostics : null, files };
    records.push(record);
    console.log(JSON.stringify({ name: spec.name, size, bakeMs, maxSliceMs }));
  }
}
writeFileSync(resolve(output, "manifest.json"), JSON.stringify({ study: "irregular-planar-1 prototype", records }, null, 2) + "\n");
console.log(output);
