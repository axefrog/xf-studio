/**
 * Shared evidence vocabulary for resolver output, matching the knowledge-base grades
 * (knowledge/README.md): source, resource, wiki, runtime, hypothesis. Pure types only.
 */
export type EvidenceGrade = "source" | "resource" | "wiki" | "runtime" | "hypothesis";

/** Why a decision was made: the rule applied and how well it is established. */
export interface RuleNote {
  readonly rule: string;
  readonly grade: EvidenceGrade;
  readonly basis: string;
}

/** A decision the resolver could not settle from proven rules. It still records what it chose, if anything. */
export interface Ambiguity {
  readonly code: string;
  readonly subject: string;
  readonly detail: string;
  readonly grade: EvidenceGrade;
  readonly chosen?: string;
  readonly alternatives?: readonly string[];
}

export const note = (rule: string, grade: EvidenceGrade, basis: string): RuleNote => ({ rule, grade, basis });
