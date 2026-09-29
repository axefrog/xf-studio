/** The load and commit budgets (design §2.5, §2.8), measured on the full-size case: 10,000 nodes over one million entries. */
import { expect, test } from "bun:test";
import { measure } from "./bench/load-budget";

test("10,000 nodes over one million entries fold from snapshots under 300 ms; a shared-node commit takes under 2 ms", async () => {
  const budgets = await measure(10_000, 100);
  expect(budgets.foldMs).toBeLessThan(300);
  expect(budgets.firstReadMs).toBeLessThan(20);
  expect(budgets.commitMedianMs).toBeLessThan(2);
}, 120_000);
