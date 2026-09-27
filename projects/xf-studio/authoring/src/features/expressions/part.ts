/**
 * The expressions feature's stored data (research/animation/expression-editor-design.md §3.1): a look-level part holding one static
 * face as a sparse vector of named main-pose weights. By name, never by index; unknown names (another rig, a future game version) are
 * kept verbatim and never dropped on save. Export (the photo-mode clip, phase 3) writes the same vector.
 */
import type { EditorCodec, PartCodec, PartEnvelope } from "../../platform/api";
import { normaliseVector, vectorIssue, type ControlVector } from "../../engines/facial-rig/vector";

export const EXPRESSION_PART_1 = "xfs/expression-part-1";
/** Longest photo-mode menu label the part keeps. */
export const MAX_LABEL = 64;

/** Where editing started (provenance only: the vector is the whole truth). */
export type ExpressionOrigin = { readonly kind: "rest" } |
  { readonly kind: "installed"; readonly clip: string; readonly set: string; readonly row?: number; readonly provider?: string } |
  { readonly kind: "preset"; readonly id: string; readonly name: string };
export type ExpressionPart = {
  /** The photo-mode menu text; absent: the preset's name. */
  readonly label?: string;
  /** Sparse: control (track) name → weight in (0, 1], float32. */
  readonly controls: ControlVector;
  /** Per left/right pair key (`eye_brows_raise_in`): whether edits move both sides. Absent: linked for mirror pairs, unlinked for direction pairs. */
  readonly links: Readonly<Record<string, boolean>>;
  readonly origin?: ExpressionOrigin;
};
export type ExpressionEditor = Record<string, never>;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const PAIR = /^[A-Za-z][A-Za-z0-9_]{0,95}$/;

/** Why an origin can't be stored, or undefined. */
export function originIssue(value: unknown): string | undefined {
  if (!isRecord(value)) return "Where an expression started must be rest or an installed expression.";
  if (value.kind === "rest") return Object.keys(value).length === 1 ? undefined : "A rest origin has no other fields.";
  if (value.kind === "preset") return typeof value.id === "string" && value.id.length <= 64 && typeof value.name === "string" && value.name.length <= 120
    && Object.keys(value).length === 3 ? undefined : "A saved expression origin names its preset.";
  if (value.kind !== "installed") return "Where an expression started must be rest or an installed expression.";
  if (typeof value.clip !== "string" || !value.clip || value.clip.length > 256 || typeof value.set !== "string" || value.set.length > 512)
    return "An installed expression names its clip and animation set.";
  if (value.row !== undefined && (!Number.isInteger(value.row) || (value.row as number) < 0)) return "An installed expression's row is a whole number.";
  if (value.provider !== undefined && (typeof value.provider !== "string" || value.provider.length > 256)) return "An installed expression's source is damaged.";
  return undefined;
}

/** Validate a part body; throws a plain error. */
export function parseExpressionPart(body: unknown): ExpressionPart {
  if (!isRecord(body)) throw Error("The expression is damaged.");
  const known = new Set(["label", "controls", "links", "origin"]);
  if (Object.keys(body).some(key => !known.has(key))) throw Error("The expression holds data this version doesn't know.");
  if (body.label !== undefined && (typeof body.label !== "string" || body.label.length > MAX_LABEL)) throw Error("The expression's label is damaged.");
  const issue = vectorIssue(body.controls);
  if (issue) throw Error(issue);
  if (!isRecord(body.links) || Object.entries(body.links).some(([key, linked]) => !PAIR.test(key) || typeof linked !== "boolean"))
    throw Error("The expression's left/right links are damaged.");
  if (body.origin !== undefined) { const bad = originIssue(body.origin); if (bad) throw Error(bad); }
  return {
    ...(body.label ? { label: body.label as string } : {}),
    controls: normaliseVector(body.controls),
    links: Object.fromEntries(Object.keys(body.links).sort().map(key => [key, (body.links as Record<string, boolean>)[key]!])),
    ...(body.origin ? { origin: structuredClone(body.origin) as ExpressionOrigin } : {}),
  };
}

export const emptyExpression = (): ExpressionPart => ({ controls: {}, links: {} });

export const expressionPart: PartCodec<ExpressionPart> = Object.freeze({
  current: EXPRESSION_PART_1,
  accepts: [EXPRESSION_PART_1],
  parse(envelope: PartEnvelope): ExpressionPart {
    if (envelope.schema !== EXPRESSION_PART_1) throw Error(`Unknown expression schema ${envelope.schema}.`);
    return parseExpressionPart(envelope.body);
  },
  serialize: (part: ExpressionPart): PartEnvelope => ({ schema: EXPRESSION_PART_1, body: structuredClone(part) }),
  empty: emptyExpression,
  starter: emptyExpression,
  summary: (part: ExpressionPart) => ({ controls: Object.keys(part.controls).length }),
  // 141 controls of about 40 characters each, far below this.
  maxBytes: 100_000,
});

export const expressionEditor: EditorCodec<ExpressionEditor, ExpressionPart> = Object.freeze({
  empty: (): ExpressionEditor => ({}),
  parse: (): ExpressionEditor => ({}),
  serialize: () => ({}),
});
