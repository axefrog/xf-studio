/**
 * Collection and look working copies as library documents (profiles design §1.1, §1.4). Types and pure functions only: the owner is
 * `CollectionOwner` (collection-owner.ts), and every change reaches the library through the outbox.
 *
 * - **A collection working copy** (`collection-working`, ID the collection's `xfs/collection-2` identity): its name, its look order, the
 *   looks removed from it (the last 20, each with when), its package plan, and the named version it was last saved as.
 * - **A look working copy** (`look-working`, ID `<collection>/<look>`): its parts and editor memory (its Undo history with them), and
 *   whether it is live or removed. Parts and memory are kept as stored, opaque here: the part registry reads them where they are used.
 * - **Named versions** (Save version) stay in the released collection tables, which older builds read (`collection-store.ts`).
 *
 * Readers keep fields they don't know, so a newer build's working copy is written back with them.
 */
import { isTombstone } from "../platform/api/document-commands";

export const COLLECTION_WORKING = "collection-working";
export const LOOK_WORKING = "look-working";
export const COLLECTION_WORKING_SCHEMA = "xfs/collection-working-1";
export const LOOK_WORKING_SCHEMA = "xfs/look-working-1";
/** How many removed looks stay restorable, and for how long. */
export const REMOVED_LIMIT = 20;
export const REMOVED_FOR_MS = 30 * 24 * 3600_000;
const NAME_LIMIT = 120;

/** A look, wherever it is named (scenes, bindings, actions): its collection and its ID there. */
export type LookRef = { readonly collection: string; readonly look: string };
export const lookDocumentId = (ref: LookRef) => `${ref.collection}/${ref.look}`;
export const collectionRef = (id: string) => ({ kind: COLLECTION_WORKING, id });
export const lookRef = (ref: LookRef) => ({ kind: LOOK_WORKING, id: lookDocumentId(ref) });
export const sameLook = (a: LookRef, b: LookRef) => a.collection === b.collection && a.look === b.look;
/** The look a `look-working` document ID names (null: not one). */
export function lookOfDocument(id: string): LookRef | null {
  const at = id.indexOf("/");
  return at > 0 && at < id.length - 1 ? { collection: id.slice(0, at), look: id.slice(at + 1) } : null;
}

export type RemovedLook = { readonly look: string; readonly at: number };
export type CollectionWorking = {
  readonly schema: typeof COLLECTION_WORKING_SCHEMA;
  readonly id: string;
  readonly name: string;
  /** The live looks, in order. */
  readonly looks: readonly string[];
  /** Looks removed from it, oldest first: restorable while listed here, for `REMOVED_FOR_MS`. */
  readonly removed: readonly RemovedLook[];
  /** As stored (absent: the default plan). */
  readonly packagePlan?: unknown;
  /** The named version (released tables) it was last saved as. */
  readonly saved?: { readonly revision: number };
  /** The collection it was forked from by the profiles migration (a draft or named version that differed from its working copy). */
  readonly origin?: string;
  readonly createdAt: number;
};
export type LookWorking = {
  readonly schema: typeof LOOK_WORKING_SCHEMA;
  readonly collection: string;
  readonly id: string;
  readonly name: string;
  /** Each feature's part as stored (`{ schema, body }` envelopes). */
  readonly parts: Readonly<Record<string, unknown>>;
  /** The look's editor memory as stored (its Undo history with it); absent while there is none. */
  readonly memory?: unknown;
  readonly state: "live" | "removed";
};

export const nameOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim() && value.trim().length <= NAME_LIMIT ? value.trim() : null;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** A stored collection working copy, validated (null: it isn't one, or it is a tombstone). Unknown fields are kept. */
export function collectionWorkingOf(value: unknown): CollectionWorking | null {
  if (!object(value) || isTombstone(value) || value.schema !== COLLECTION_WORKING_SCHEMA || typeof value.id !== "string") return null;
  const name = nameOf(value.name);
  if (!name || !Array.isArray(value.looks)) return null;
  const looks = [...new Set(value.looks.filter((id): id is string => typeof id === "string" && !!id))];
  const removed = (Array.isArray(value.removed) ? value.removed : []).flatMap(item => object(item) && typeof item.look === "string" &&
    Number.isFinite(item.at) && !looks.includes(item.look) ? [{ look: item.look, at: item.at as number }] : []);
  return { ...value, schema: COLLECTION_WORKING_SCHEMA, id: value.id, name, looks, removed,
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt as number : 0 } as CollectionWorking;
}
/** A stored look working copy, validated (null: it isn't one, or it is a tombstone). Unknown fields are kept. */
export function lookWorkingOf(value: unknown): LookWorking | null {
  if (!object(value) || isTombstone(value) || value.schema !== LOOK_WORKING_SCHEMA || typeof value.id !== "string" ||
    typeof value.collection !== "string" || !object(value.parts)) return null;
  const name = nameOf(value.name);
  if (!name) return null;
  return { ...value, schema: LOOK_WORKING_SCHEMA, id: value.id, collection: value.collection, name, parts: value.parts,
    state: value.state === "removed" ? "removed" : "live" } as LookWorking;
}

/**
 * The removed list a command leaves: the newest `REMOVED_LIMIT` within `REMOVED_FOR_MS` of `now`. `dropped` are the looks that leave
 * it, which the same command writes as tombstones (§1.4).
 */
export function pruneRemoved(removed: readonly RemovedLook[], now: number): { kept: RemovedLook[]; dropped: string[] } {
  const fresh = removed.filter(item => now - item.at < REMOVED_FOR_MS);
  const kept = fresh.slice(Math.max(0, fresh.length - REMOVED_LIMIT));
  return { kept, dropped: removed.filter(item => !kept.includes(item)).map(item => item.look) };
}

/** A copy's name: "<name> (copy)" or "(this window)", within the name limit. */
export const suffixed = (name: string, suffix: string) => `${name.slice(0, NAME_LIMIT - suffix.length - 1)} ${suffix}`;
