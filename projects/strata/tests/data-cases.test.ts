/** Behaviours stated as data (`tests/cases`), run by the testing entry point's runners. */
import { expect, test } from "bun:test";
import { runEntityVector, runKernelVector } from "strata/testing";
import { ENTITY_CASES } from "./cases/entity-cases";
import { KERNEL_CASES } from "./cases/kernel-cases";

for (const item of ENTITY_CASES) test(`entity case: ${item.name}`, async () => { expect(await runEntityVector(item)).toEqual([]); });
for (const item of KERNEL_CASES) test(`kernel case: ${item.name}`, async () => { expect(await runKernelVector(item)).toEqual([]); });
