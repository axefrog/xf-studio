/** Every conformance vector in conformance/ (SPEC §22) passes. */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runKernelVector } from "strata/testing";
import type { KernelVector, VectorSuite } from "strata/testing";

const folder = join(import.meta.dir, "..", "conformance");
for (const file of readdirSync(folder).filter(name => name.endsWith(".json")).sort()) {
  const suite = JSON.parse(readFileSync(join(folder, file), "utf8")) as VectorSuite<KernelVector>;
  for (const vector of suite.vectors) {
    if (vector.kind !== "kernel") continue;
    test(`${suite.suite}: ${vector.name}`, async () => {
      expect(await runKernelVector(vector)).toEqual([]);
    });
  }
}
