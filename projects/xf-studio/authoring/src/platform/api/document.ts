/**
 * The look/part document model (feature-module platform §2): a collection holds looks, and a
 * look holds one part per feature that is part of it. Each part carries its own schema, so a
 * feature versions its data without a whole-look schema bump. Types and small pure helpers only.
 */

import type { ModPackagePlan } from "./export";

/** One feature's stored data in a look: the part schema it was written in and its body. */
export type PartEnvelope = { readonly schema: string; readonly body: unknown };

/**
 * A feature's part codec. `parse` validates and migrates on read without changing appearance;
 * `serialize` always writes `current`. A parsed part must be plain, structured-cloneable data
 * (`serialize(p).body` is `p` itself or an exact copy), so looks can be cloned and compared.
 */
export interface PartCodec<P> {
  readonly current: string;
  /** Every part schema `parse` reads. */
  readonly accepts: readonly string[];
  /** Validate and migrate on read; pure; throws on invalid input. */
  parse(envelope: PartEnvelope): P;
  serialize(part: P): PartEnvelope;
  /** A bare legacy file of this feature (for eye makeup, a recipe), or undefined when it is not one. */
  lift?(file: unknown): P | undefined;
  /** The part in an older schema it accepts, when that schema holds it exactly; undefined otherwise. */
  downgrade?(part: P, schema: string): PartEnvelope | undefined;
  empty(): P;
  starter(): P;
  /** Primitive facts for cheap views (CORE-05): never a clone of the part. */
  summary(part: P): Readonly<Record<string, number | string | boolean>>;
  /**
   * Stable content chunks of a parsed part for the look history (feature-module platform §3): an edit
   * of one item then stores only that item's chunk again. Plain JSON values; without `chunks` a part is
   * one chunk. `join(chunks(p))` must give `p` back exactly, key order included.
   */
  chunks?(part: P): readonly unknown[];
  join?(chunks: readonly unknown[]): P;
  /** Largest serialized part (UTF-16 code units) a collection may hold; larger parts are refused on read. */
  readonly maxBytes: number;
  /**
   * `xfas/collection-1` compatibility: that format's presets held this feature's data in one
   * field (eye makeup: `recipe`), read as a part of `schema`. At most one feature claims it.
   */
  readonly legacy?: { readonly presetField: string; readonly schema: string };
}

/** Per-look editor memory of a feature (for eye makeup: active layer, selected point, warp selection). */
export interface EditorCodec<E, P> {
  empty(): E;
  /** Tolerant: invalid or stale values fall back to defaults for this part. */
  parse(value: unknown, part: P): E;
  serialize(editor: E): unknown;
}

/** Feature-wide workspace memory (for eye makeup: remembered Glitter-model and Colour-shift settings). */
export interface MemoryCodec<M> {
  empty(): M;
  /** Tolerant: invalid entries are dropped. */
  parse(value: unknown): M;
  serialize(memory: M): unknown;
}

/**
 * A look. In memory, each registered feature's part is `{ schema: current, body: parsed }`;
 * parts of unregistered features (for example from a newer build) are kept verbatim. The
 * stored form (`StoredPreset`) has the same shape. A missing part means the feature is not
 * part of this look, not an empty part.
 */
export type Look = { id: string; name: string; revision: number; parts: Record<string, PartEnvelope>;
  /**
   * Present when this build cannot read the look (a newer build's part schema or model, in its parts or
   * its Undo history): its parts and editor memory are then kept exactly as stored (`KEPT_MEMORY`) and
   * it is not editable in this version; the text says so in plain words. Never stored: a reader finds
   * it again.
   */
  locked?: string };
export type StoredPreset = Look;
export const COLLECTION_1 = "xfas/collection-1";
export const COLLECTION_2 = "xfs/collection-2";
/**
 * A collection of looks. `packagePlan` groups its exportable features into mods (feature-module platform §6);
 * absent means the default, one mod holding them all. Only a plan that differs from the default is stored.
 */
export type LookCollection = { schema: typeof COLLECTION_2; id: string; name: string; presets: Look[]; packagePlan?: ModPackagePlan };
export type StoredLookCollection = LookCollection;

/**
 * One feature's editor memory for one look in a workspace: its editor state. Workspaces written
 * before the look history (and a newer build's feature this build does not register) also keep that
 * feature's Undo history here as whole parts, oldest first (`history`; `historyTrimmed` present, true,
 * only when older entries were dropped); readers turn it into the look's history.
 */
export type PartMemory<E = unknown, P = unknown> = { editor: E; history?: P[]; historyTrimmed?: true };
/**
 * Editor memory of one look: each feature's memory by feature ID, and the look's own memory under
 * `LOOK_MEMORY` (never a feature ID), whose editor state is the look's one Undo history
 * (`LookHistoryData`; absent while the history is empty). Read it with the part registry's `lookHistory`.
 */
export type LookMemory = Record<string, PartMemory>;
/** The key of a look's own memory (its Undo history) beside its features' memory; not a valid feature ID. */
export const LOOK_MEMORY = "@look";
/**
 * The key under which a locked look's stored editor memory is kept verbatim (its editor state is the
 * stored memory as it was read); writers write it back unchanged. Not a valid feature ID.
 */
export const KEPT_MEMORY = "@kept";
/** Why a look is locked, for the person: what happened, that nothing is lost, and the one next step. */
export const NEWER_LOOK_MESSAGE = "This look was made with a newer version of XF Studio, so this version can't show or change it. " +
  "It's kept exactly as it was: update XF Studio to edit it.";

/** What an action reads: the feature's part and its editor state. */
export type FeatureState<P, E> = { readonly part: P; readonly editor: E };
/**
 * What an action produced. `effect` is opaque to the platform (the feature's renderer reads it);
 * `changed` is false when nothing changed, and then no Undo entry is recorded.
 */
export type FeatureResult<P, E, X = unknown> = { part: P; editor: E; effect: X; changed: boolean };

/**
 * Data written by a newer XF Studio than this build: a part schema its feature does not accept yet,
 * or (inside a part) a model this build does not register. Readers never treat it as damage: a
 * store holding it is never overwritten, and nothing in it is dropped (feature-module platform §2).
 */
export class NewerDataError extends Error {
  readonly code = "newer_data";
  constructor(message: string) { super(message); this.name = "NewerDataError"; }
}
export const isNewerData = (error: unknown): error is NewerDataError => error instanceof NewerDataError;

/** Deterministic JSON with object keys sorted: the canonical text two equal parts share. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item as object).sort().map(key => [key, (item as Record<string, unknown>)[key]])) : item);
}
