/**
 * The load and commit budgets (design §2.5, §2.8), measured on the full-size case: 10,000 nodes over one million
 * entries, loaded from snapshots and short tails and, separately, folded from empty; commits timed to their return and
 * to the store's acknowledgement.
 */
import { expect, test } from "bun:test";
import { measure } from "./bench/load-budget";

// Shared CI runners are slower and noisier than a workstation: there the budgets get headroom (the numbers are still
// printed); locally they are held exactly.
const slack = process.env.CI ? 3 : 1;

test("10,000 nodes over one million entries load from snapshots under 300 ms and fold from empty under 1 s; a shared-node commit takes under 2 ms, acknowledged under 3 ms", async () => {
  const budgets = await measure(10_000, 100);
  console.log(budgets);
  expect(budgets.foldMs).toBeLessThan(300 * slack);
  expect(budgets.fullFoldMs).toBeLessThan(1000 * slack);
  expect(budgets.firstReadMs).toBeLessThan(20 * slack);
  expect(budgets.commitMedianMs).toBeLessThan(2 * slack);
  expect(budgets.ackMedianMs).toBeLessThan(3 * slack);
}, 120_000);
