import { expect, test } from "bun:test";
import { generateContextSeeds } from "./fixtures/profile-session-generator";

test("P3-ii independent generator: several real edit contexts, 80-step trimming and persisted restarts", async () => {
  const started = performance.now(), result = await generateContextSeeds(1, 16);
  expect(result).toEqual({ seeds: 16, count: 5280, restarts: 48 });
  console.log(`P3-ii context generator: ${result.seeds} seeds, ${result.count} application commands, ${result.restarts} persisted restarts in ${((performance.now() - started) / 1000).toFixed(2)} s.`);
}, 120_000);
