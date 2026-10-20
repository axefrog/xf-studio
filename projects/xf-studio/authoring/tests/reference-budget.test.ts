import { expect, test } from "bun:test";
import { preparedBudgetPartitions, PREPARED_BUDGET_BYTES } from "../src/prepared-files";

test("reference and character partitions stay separate without increasing the configured total", () => {
  for (const total of [1024, 512 * 1024 ** 2, PREPARED_BUDGET_BYTES]) {
    const parts = preparedBudgetPartitions(total);
    expect(parts.character + parts.reference).toBe(total);
    expect(parts.reference).toBeLessThanOrEqual(256 * 1024 ** 2);
    expect(parts.character).toBeGreaterThan(parts.reference);
  }
  expect(preparedBudgetPartitions(Infinity)).toEqual({ character: Infinity, reference: Infinity });
  expect(() => preparedBudgetPartitions(0)).toThrow();
});
