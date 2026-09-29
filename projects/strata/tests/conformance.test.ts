/** Every conformance vector in conformance/ (SPEC §22) passes. */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runEntityVector, runKernelVector } from "strata/testing";
import type { EntityVector, KernelVector, VectorSuite } from "strata/testing";

const folder = join(import.meta.dir, "..", "conformance");
for (const file of readdirSync(folder).filter(name => name.endsWith(".json")).sort()) {
  const suite = JSON.parse(readFileSync(join(folder, file), "utf8")) as VectorSuite<KernelVector | EntityVector>;
  for (const vector of suite.vectors) test(`${suite.suite}: ${vector.name}`, async () => {
    expect(vector.kind === "kernel" ? await runKernelVector(vector) : await runEntityVector(vector as EntityVector)).toEqual([]);
  });
}
