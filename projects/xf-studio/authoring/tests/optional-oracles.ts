import { describe, test } from "bun:test";

/**
 * Tests that need an optional local oracle (Python/NumPy running the Experiment 005 research
 * programs) or a real installation (game, WolvenKit, MO2). Public CI has none of these, so they
 * are skipped there with a printed reason. Before a release, run the suite on the development
 * machine with XFS_REQUIRE_ORACLES=1: every such skip then becomes a failing test naming the
 * missing prerequisite, so a quiet skip can never pass for a checked oracle.
 */
export const requireOracles = process.env.XFS_REQUIRE_ORACLES === "1";

const missing = (why: string) => () => {
  throw Error(`XFS_REQUIRE_ORACLES=1 requires this check, but ${why}`);
};

/** `test` when the prerequisite is available; otherwise a skip, or a failure under XFS_REQUIRE_ORACLES=1. */
export function oracleTest(available: boolean, why: string): typeof test {
  if (available) return test;
  if (requireOracles) return ((name: string) => test(name, missing(why))) as unknown as typeof test;
  console.warn(`Skipped: ${why}`);
  return test.skip;
}

/** `describe` counterpart of `oracleTest`: one failing test replaces the block under XFS_REQUIRE_ORACLES=1. */
export function oracleDescribe(available: boolean, why: string): typeof describe {
  if (available) return describe;
  if (requireOracles) return ((name: string) => describe(name, () => test("prerequisites are available", missing(why)))) as unknown as typeof describe;
  console.warn(`Skipped: ${why}`);
  return describe.skip;
}
