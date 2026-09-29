/** Every conformance vector in conformance/ (SPEC §22) passes. */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCanonicalVector, runEntityVector, runKernelVector } from "strata/testing";
import type { CanonicalVector, EntityVector, KernelVector, VectorSuite } from "strata/testing";

const folder = join(import.meta.dir, "..", "conformance");
for (const file of readdirSync(folder).filter(name => name.endsWith(".json")).sort()) {
  const suite = JSON.parse(readFileSync(join(folder, file), "utf8")) as VectorSuite<KernelVector | EntityVector | CanonicalVector>;
  for (const vector of suite.vectors) test(`${suite.suite}: ${vector.name}`, async () => {
    const problems = vector.kind === "kernel" ? await runKernelVector(vector)
      : vector.kind === "canonical" ? runCanonicalVector(vector) : await runEntityVector(vector as EntityVector);
    expect(problems).toEqual([]);
  });
}
