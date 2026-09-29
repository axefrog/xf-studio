/**
 * Deterministic simulation (design §5.2): 500 seeds of 200 steps for the entity layer (delays, reordering, store
 * failures and lost replies, another window, crash-restart) and for the kernel (random declared subsystems with
 * diamonds, rewiring, drivers, nested processes and aborts), every invariant after every step; an injected bug is found
 * and shrunk; every regression replays. `bun run sim:long` runs more seeds for the review cadence.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { graphScenario, kernelScenario, replay, runSteps, shrink, simulate } from "strata/testing";
import type { Regression, Scenario, SimResult } from "strata/testing";

const SEEDS = 500, STEPS = 200, BATCH = 100;
const describe = (result: SimResult) => result.ok ? "ok" : `seed ${result.seed} failed at step ${result.failure.step}: ${result.failure.problems.slice(0, 3).join(" | ")}`;

async function batch(scenario: Scenario<unknown>, from: number): Promise<string[]> {
  const failures: string[] = [];
  for (let seed = from; seed < from + BATCH; seed++) {
    const result = await simulate(scenario, { seed, steps: STEPS });
    if (!result.ok) failures.push(describe(result));
  }
  return failures;
}

for (let from = 0; from < SEEDS; from += BATCH) {
  test(`entity layer: seeds ${from}-${from + BATCH - 1}, ${STEPS} steps each, hold every invariant`, async () => {
    expect(await batch(graphScenario() as Scenario<unknown>, from)).toEqual([]);
  }, 120_000);
  test(`kernel: seeds ${from}-${from + BATCH - 1}, ${STEPS} steps each, hold every invariant`, async () => {
    expect(await batch(kernelScenario() as Scenario<unknown>, from)).toEqual([]);
  }, 120_000);
}

test("an injected propagation bug is found, shrunk to a minimal trace, and the trace replays clean without the bug", async () => {
  const faulty = graphScenario({ skipInvalidation: ref => /^[0-7]/.test(ref.id) });
  let found: SimResult | undefined;
  for (let seed = 0; seed < 50 && !found; seed++) {
    const result = await simulate(faulty, { seed, steps: STEPS });
    if (!result.ok) found = result;
  }
  if (!found || found.ok) throw new Error("The injected bug went unnoticed.");
  expect(found.failure.problems[0]).toStartWith("stale:");
  const small = await shrink(faulty, found.failure, { budget: 2000 });
  expect(small.steps.length).toBeLessThanOrEqual(12);
  expect(small.problems[0]).toStartWith("stale:");
  // The same seed and trace reproduce it exactly.
  const again = await runSteps(faulty, small.seed, small.steps);
  expect(again.ok ? [] : again.failure.problems).toEqual(small.problems);
  // Without the bug the trace holds every invariant: it is a regression test.
  expect(describe(await runSteps(graphScenario(), small.seed, small.steps))).toBe("ok");
}, 120_000);

const regressions = JSON.parse(readFileSync(join(import.meta.dir, "regressions.json"), "utf8")) as Regression[];
for (const regression of regressions) test(`regression replays clean: ${regression.name}`, async () => {
  const scenario = (regression.scenario === "kernel" ? kernelScenario() : graphScenario()) as Scenario<unknown>;
  expect(describe(await replay(scenario, regression))).toBe("ok");
});
