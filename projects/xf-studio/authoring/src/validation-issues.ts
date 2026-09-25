/**
 * Structured validation failures (audit A-8). Capability results carry one next to their
 * human reason so a presentation can mark the right field without parsing message text.
 */
import type { ValidationIssue } from "./platform/api";
// The issue shape is the platform's, so feature modules and system families report the same one.
export type { ValidationIssue, ValidationIssueCode } from "./platform/api";

export function nameIssue(name: unknown, maxLength: number, field = "name"): ValidationIssue | undefined {
  if (typeof name !== "string") return { code: "format", field, message: "A name must be text." };
  const trimmed = name.trim();
  if (!trimmed) return { code: "name.blank", field, message: "Enter a name; it cannot be blank." };
  if (trimmed.length > maxLength) return { code: "name.too-long", field, message: `Use ${maxLength} characters or fewer.` };
}

/** A zero-based destination in a list of `count` items; `ends` explains each out-of-range side. */
export function positionIssue(to: unknown, count: number, ends: { below: string; above: string }): ValidationIssue | undefined {
  if (typeof to !== "number" || !Number.isInteger(to)) return { code: "format", field: "to", message: "The position must be a whole number." };
  if (to < 0) return { code: "range", field: "to", message: ends.below };
  if (to >= count) return { code: "range", field: "to", message: ends.above };
}

/** Capability shape shared by domain checks: unavailable results give a reason and, when known, an issue. */
export const refuse = (issue: ValidationIssue) => ({ available: false as const, reason: issue.message, issue });
