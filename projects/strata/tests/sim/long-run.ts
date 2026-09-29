/** A longer simulation for the review cadence: `bun run sim:long [seeds] [steps]` (run it under the memory guard). */
import { graphScenario, kernelScenario, shrink, simulate } from "strata/testing";
import type { Scenario } from "strata/testing";

const seeds = Number(process.argv[2] ?? 5000), steps = Number(process.argv[3] ?? 400);
for (const scenario of [graphScenario(), kernelScenario()] as Scenario<unknown>[]) {
  const started = performance.now();
  let failures = 0;
  for (let seed = 0; seed < seeds; seed++) {
    const result = await simulate(scenario, { seed: `long-${seed}`, steps });
    if (result.ok) continue;
    failures++;
    const small = await shrink(scenario, result.failure);
    console.log(JSON.stringify({ name: `long-${scenario.name}-${seed}`, scenario: scenario.name, seed: small.seed, steps: small.steps, note: small.problems[0] }));
  }
  console.log(`${scenario.name}: ${seeds} seeds x ${steps} steps, ${failures} failing, ${Math.round(performance.now() - started)} ms`);
}
