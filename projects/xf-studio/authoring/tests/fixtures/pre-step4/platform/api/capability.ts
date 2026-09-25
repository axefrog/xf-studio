/**
 * Structured capability results shared by the platform and every feature module
 * ([feature-module platform §1, §4](../../../../../../research/authoring/feature-module-platform.md)).
 * A refusal carries a reason code chosen where the refusal is decided, never inferred
 * from its message text (CORE-15).
 */

/** Why an action is refused. Presentations branch on the code; the reason is for people. */
export type ReasonCode = "missing_target" | "busy" | "limit" | "invalid_value" |
  "incompatible_mode" | "asset_unavailable" | "not_ready" | "unavailable" | "needs_input";

/** Structured validation failure (audit A-8): lets a presentation mark the right field. */
export type ValidationIssueCode = "required" | "name.blank" | "name.too-long" | "range" | "mode" | "format";
export type ValidationIssue = { code: ValidationIssueCode; field?: string; message: string };

export type Capability = { available: boolean; code?: ReasonCode; reason?: string;
  /** Structured validation detail when the refusal concerns one input value or mode. */
  issue?: ValidationIssue };

/** A refusal with its code, decided at the check that refused. */
export const refusal = (code: ReasonCode, reason: string): Capability & { available: false } =>
  ({ available: false, code, reason });

/** The reason code a structured validation issue implies. */
export function issueCode(issue: ValidationIssue): ReasonCode {
  return issue.code === "range" ? "limit" : issue.code === "mode" ? "incompatible_mode" :
    issue.code === "required" ? "needs_input" : "invalid_value";
}

/**
 * A domain check's result with its code: the code the check chose, else the one its
 * validation issue implies. A refusal carrying neither is a defect in that check; it is
 * reported as `invalid_value`, the code every such refusal had before codes were structured.
 */
export function coded(raw: Capability): Capability {
  if (raw.available) return { available: true };
  return { ...raw, code: raw.code ?? (raw.issue ? issueCode(raw.issue) : "invalid_value") };
}
