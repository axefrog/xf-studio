import { NativeBudgetError, NativeMalformedError } from "../../xf-studio/authoring/src/native/native-errors";

export interface ContentUsage { records: number; nested: number; links: number; bytes: number }
export const CONTENT_LIMITS: Readonly<ContentUsage> = Object.freeze({ records: 50_000, nested: 100_000, links: 200_000, bytes: 32 * 1024 * 1024 });
const BUDGET_KEYS = ["records", "nested", "links", "bytes"] as const;
/** Conservative JSON string size, including worst-case escaping, without allocating escaped strings. */
export const stringBytes = (s: string | undefined) => s === undefined ? 0 : 6 * s.length + 2;
export class ContentBudget {
  private used: ContentUsage = { records: 0, nested: 0, links: 0, bytes: 0 };
  constructor(private readonly limits: Readonly<ContentUsage> = CONTENT_LIMITS) {}
  snapshot(): ContentUsage { return { ...this.used }; }
  charge(cost: Partial<ContentUsage>) {
    for (const key of BUDGET_KEYS) {
      const n = cost[key] ?? 0;
      if (!Number.isSafeInteger(n) || n < 0) throw new NativeMalformedError("Invalid content budget charge.");
      if (this.used[key] + n > this.limits[key]) throw new NativeBudgetError(`Content ${key} budget exceeded; use a smaller slice.`);
    }
    for (const key of BUDGET_KEYS) this.used[key] += cost[key] ?? 0;
  }
}

// Validation operates on unknown JSON and never assumes a cast made it well formed.
export function shape(value: unknown, what: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new NativeMalformedError(`Invalid ${what}.`);
}
export function array(value: unknown, what: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new NativeMalformedError(`Invalid ${what}.`);
  if (value.length > 200_000) throw new NativeBudgetError(`Too many ${what}.`);
}
export function string(value: unknown, what: string): asserts value is string {
  if (typeof value !== "string" || !value.length) throw new NativeMalformedError(`Invalid ${what}.`);
}
export function optionalString(value: unknown, what: string) { if (value !== undefined) string(value, what); }
export function finiteTuple(value: unknown, size: number, what: string): asserts value is number[] {
  if (!Array.isArray(value) || value.length !== size || !value.every(n => typeof n === "number" && Number.isFinite(n))) throw new NativeMalformedError(`Invalid ${what}.`);
}
export function integer(value: unknown, min: number, max: number, what: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new NativeMalformedError(`Invalid ${what}.`);
}
export function stringList(value: unknown, what: string, budget: ContentBudget) {
  array(value, what);
  for (const item of value) { string(item, what); budget.charge({ links: 1, bytes: 8 + stringBytes(item) }); }
}
