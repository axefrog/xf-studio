/**
 * A one-time copy of development data into the document store. Development builds before the first public beta kept the
 * experimental-features preference and Hair Lab's grooms in an event log inside the library file (tables `events`,
 * `snapshots` and `node_index`). This reads those tables with plain SQL, folds each record to its latest value, and writes
 * it into the document store:
 *
 * - the preference (node type `experimental-features`) becomes `experiment-flags` / `preferences`, `{ schema, flags }`;
 * - each Hair Lab groom (node type `experiment-document`, module `hair-lab`) becomes `hair-groom` / its old ID, the groom
 *   with its edited fields applied.
 *
 * It runs at every host start and is idempotent: a document that already exists in the store is never overwritten (the
 * write names revision 0), so after the first run it copies nothing. It never changes or removes the old tables. Released
 * alpha builds never had them, so only development libraries are affected.
 *
 * Removal criterion: delete this file and its call sites after the first public beta.
 */
import type { Database } from "bun:sqlite";
import { EXPERIMENT_FLAGS } from "../api/experiments";
import type { DocumentStore } from "./document-store";
import type { LibraryDatabase } from "./library-database";

/** The document kind Hair Lab's grooms are kept under. */
export const LEGACY_HAIR_GROOM_KIND = "hair-groom";

/** What one import copied. */
export type LegacyImport = { readonly flags: boolean; readonly grooms: number };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type State = { own: Record<string, Json>; trashed: boolean; retracted: boolean };
type Op = { kind: string; state?: State & { own?: Record<string, Json> }; path?: string[]; value?: Json; ops?: Op[] };

/** The old log's "absent here" marker: a one-key object `{ "$…": "tombstone" }`. */
const isTombstone = (value: Json): boolean => !!value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === 1 && Object.keys(value)[0].startsWith("$") && Object.values(value)[0] === "tombstone";

/** Applies one logged change to a record's state (null before it was created). */
function apply(state: State | null, op: Op): State | null {
  switch (op.kind) {
    case "create": case "import": case "state":
      return op.state ? { own: { ...(op.state.own ?? {}) }, trashed: !!op.state.trashed, retracted: !!op.state.retracted } : state;
    case "compensate": case "revert": return (op.ops ?? []).reduce(apply, state);
    default: break;
  }
  if (!state) return state;
  const key = JSON.stringify(op.path ?? []);
  switch (op.kind) {
    case "set": state.own[key] = op.value ?? null; break;
    case "reset": delete state.own[key]; break;
    case "tombstone": delete state.own[key]; break;
    case "trash": state.trashed = true; break;
    case "restore": state.trashed = false; break;
    case "retract": state.retracted = true; break;
    case "unretract": state.retracted = false; break;
    default: break;   // layers, names and tags carry no value the new documents keep
  }
  return state;
}

/** A record's own values as one nested object (keys are JSON-encoded paths). */
function nested(own: Record<string, Json>): Record<string, Json> {
  const root: Record<string, Json> = {};
  for (const [key, value] of Object.entries(own)) {
    if (isTombstone(value)) continue;
    const path = JSON.parse(key) as string[];
    if (!path.length) continue;
    let at = root;
    for (const step of path.slice(0, -1)) {
      const next = at[step];
      at = (at[step] = next && typeof next === "object" && !Array.isArray(next) ? next : {}) as Record<string, Json>;
    }
    at[path[path.length - 1]] = value;
  }
  return root;
}

/** Every live record of the given types, folded from its snapshot (if any) and the log after it. */
function latestRecords(db: Database, types: readonly string[]): { id: string; type: string; value: Record<string, Json> }[] {
  const tables = new Set((db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(row => row.name));
  if (!tables.has("events") || !tables.has("node_index")) return [];
  const marks = types.map(() => "?").join(", ");
  const nodes = db.query(`SELECT node, type FROM node_index WHERE type IN (${marks}) ORDER BY rowid`).all(...types) as { node: string; type: string }[];
  const records: { id: string; type: string; value: Record<string, Json> }[] = [];
  for (const { node, type } of nodes) {
    const snapshot = tables.has("snapshots")
      ? db.query("SELECT seq, value FROM snapshots WHERE node = ?").get(node) as { seq: number; value: string } | null : null;
    let state: State | null = snapshot ? apply(null, { kind: "state", state: JSON.parse(snapshot.value) as State }) : null;
    const ops = db.query("SELECT op FROM events WHERE node = ? AND seq > ? ORDER BY seq").all(node, snapshot?.seq ?? 0) as { op: string }[];
    for (const row of ops) state = apply(state, JSON.parse(row.op) as Op);
    if (state && !state.trashed && !state.retracted) records.push({ id: node, type, value: nested(state.own) });
  }
  return records;
}

/**
 * Copies the old log's latest preference and grooms in library file `library` into `store` (the same file's document
 * store), if the file has that log. Only documents the store doesn't have yet are written.
 */
export function importLegacyExperiments(library: LibraryDatabase, store: DocumentStore, log?: (message: string) => void): LegacyImport {
  const records = library.read(db => latestRecords(db, ["experimental-features", "experiment-document"]));
  let flags = false, grooms = 0;
  for (const record of records) {
    if (record.type === "experimental-features") {
      if (flags) continue;   // the old log kept one preference record
      const values = record.value.flags && typeof record.value.flags === "object" && !Array.isArray(record.value.flags) ? record.value.flags : {};
      const kept = Object.fromEntries(Object.entries(values).filter(([, enabled]) => typeof enabled === "boolean"));
      flags = store.put(EXPERIMENT_FLAGS.kind, EXPERIMENT_FLAGS.id, { schema: EXPERIMENT_FLAGS.schema, flags: kept }, 0).ok;
      continue;
    }
    const { module, document, values } = record.value;
    if (module !== "hair-lab" || !document || typeof document !== "object" || Array.isArray(document)) continue;
    const fields = document.fields && typeof document.fields === "object" && !Array.isArray(document.fields) ? document.fields : {};
    const edits = values && typeof values === "object" && !Array.isArray(values) ? values : {};
    if (store.put(LEGACY_HAIR_GROOM_KIND, record.id, { ...document, fields: { ...fields, ...edits } }, 0).ok) grooms++;
  }
  if (flags || grooms) log?.(`Copied earlier experiment data into the document store: ${flags ? "the experimental-features preference" : "no preference"}, ${grooms} Hair Lab groom${grooms === 1 ? "" : "s"}.`);
  return { flags, grooms };
}
