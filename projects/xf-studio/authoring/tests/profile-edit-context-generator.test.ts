import { expect, test } from "bun:test";
import { generateContextSeeds, generateAsyncContextSeeds } from "./fixtures/profile-session-generator";

test("P3-ii independent generator: several real edit contexts, 80-step trimming and persisted restarts", async () => {
  const started = performance.now(), result = await generateContextSeeds(1, 16);
  expect(result).toEqual({ seeds: 16, count: 5280, restarts: 48 });
  console.log(`P3-ii context generator: ${result.seeds} seeds, ${result.count} application commands, ${result.restarts} persisted restarts in ${((performance.now() - started) / 1000).toFixed(2)} s.`);
}, 120_000);

test("P3-ii async generator: captured import/copy writers survive focus and drawn-view interleavings", async () => {
  const started = performance.now(), result = await generateAsyncContextSeeds(1, 16);
  expect(result).toEqual({ seeds: 16, operations: 96, switches: 160, restarts: 16 });
  console.log(`P3-ii async generator: ${JSON.stringify(result)} in ${((performance.now() - started) / 1000).toFixed(2)} s.`);
}, 120_000);
