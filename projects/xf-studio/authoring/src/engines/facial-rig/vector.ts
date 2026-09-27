/**
 * Control vectors (research/animation/expression-editor-design.md §3.1): a face pose stored as a sparse record of named main-pose
 * weights in 0–1 (absent = 0). Zero weights are omitted and every stored value is float32-representable, so a later clip export
 * round-trips exactly. Pure.
 */
import type { FacialVocabulary } from "./vocabulary";
import { mirrorName } from "./vocabulary";

export type ControlVector = Readonly<Record<string, number>>;
/** A control name as clips key it: a letter first, then letters, digits and underscores. */
export const CONTROL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,95}$/;
/** More controls than any rig has (the player face has 141 main poses); a vector past this is damaged. */
export const MAX_CONTROLS = 512;

const F32 = new Float32Array(1);
/** The nearest float32 value. */
export function f32(value: number): number { F32[0] = value; return F32[0]; }
/** A weight as stored: clamped to 0–1, float32, and 0 for anything non-finite. */
export function storedWeight(value: number): number {
  return Number.isFinite(value) ? f32(Math.min(1, Math.max(0, value))) : 0;
}

/** Why a vector can't be stored, or undefined when it can. Refuses non-finite values, values outside 0–1 and odd names. */
export function vectorIssue(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "An expression's controls must be a list of named weights.";
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_CONTROLS) return "An expression names more controls than any face has.";
  for (const [name, weight] of entries) {
    if (!CONTROL_NAME.test(name)) return `"${name}" isn't a face control name.`;
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 1)
      return `${name} must be a weight from 0 to 1.`;
  }
  return undefined;
}

/** The canonical stored form: zeros dropped, weights float32, names sorted (so equal poses are equal JSON). Throws on a bad vector. */
export function normaliseVector(value: unknown): ControlVector {
  const issue = vectorIssue(value);
  if (issue) throw Error(issue);
  const out: Record<string, number> = {};
  for (const name of Object.keys(value as object).sort()) {
    const weight = f32((value as Record<string, number>)[name]!);
    if (weight > 0) out[name] = weight;
  }
  return out;
}

/** Set one control (0 removes it), keeping the canonical form. */
export function withControl(vector: ControlVector, name: string, value: number): ControlVector {
  const weight = storedWeight(value), out: Record<string, number> = {};
  for (const key of new Set([...Object.keys(vector), name].sort())) {
    const next = key === name ? weight : f32(vector[key]!);
    if (next > 0) out[key] = next;
  }
  return out;
}

/** Whether two vectors hold the same weights. */
export function sameVector(a: ControlVector, b: ControlVector): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

/**
 * Copy one side onto the other for every mirror pair (`from` "left": each left control's weight to its right partner). Centre
 * controls and direction pairs (see `isDirectionPair`) are left alone: mirroring a turn to the left is not a turn to the right.
 */
export function mirrorVector(vector: ControlVector, from: "left" | "right", pairs: readonly { name: string; partner: string; side: "left" | "right"; direction: boolean }[]): ControlVector {
  let out = vector;
  for (const pair of pairs) {
    if (pair.side !== from || pair.direction) continue;
    out = withControl(out, pair.partner, vector[pair.name] ?? 0);
  }
  return out;
}

/**
 * The rig's absolute track values for a pose: the reference tracks, plus each known control's weight (main poses rest at 0, so the
 * weight is the value), plus any additive `extra` values by track index (a blink clip's deltas), with main poses clamped to 0–1 as
 * the solver clamps them. Controls the vocabulary lacks are skipped and returned.
 */
export function denseTracks(vocabulary: FacialVocabulary, vector: ControlVector, extra?: ReadonlyMap<number, number>):
  { tracks: Float32Array; skipped: string[] } {
  const tracks = Float32Array.from(vocabulary.reference), skipped: string[] = [];
  const index = new Map(vocabulary.controls.map(control => [control.name, control.track]));
  for (const [name, weight] of Object.entries(vector)) {
    const track = index.get(name);
    if (track === undefined) { skipped.push(name); continue; }
    tracks[track] = tracks[track]! + weight;
  }
  if (extra) for (const [track, value] of extra) if (track >= 0 && track < tracks.length) tracks[track] = tracks[track]! + value;
  const { start, count } = vocabulary.main;
  for (let i = start; i < start + count; i++) tracks[i] = Math.min(1, Math.max(0, tracks[i]!));
  return { tracks, skipped };
}

export { mirrorName };
