/**
 * Folding a stream: a node's state is the fold of its entries, from its type's empty state (or a snapshot), applying
 * each op in order. Folds are deterministic, so snapshots are caches and undo is exact.
 */
import { equal, freeze } from "./json";
import type { Json } from "./json";
import { keyPath, pathKey, TOMBSTONE } from "./paths";
import type { TypeSpec } from "./define";
import type { Entry, Layer, NodeState, Op, PrimitiveOp } from "./types";

type Draft = { name: string; own: Record<string, Json>; layers: readonly Layer[]; trashed: boolean; retracted: boolean };

const draftOf = (state: NodeState): Draft =>
  ({ name: state.name, own: { ...state.own }, layers: state.layers, trashed: state.trashed, retracted: state.retracted });

export function finish(draft: Draft): NodeState {
  const own: Record<string, Json> = {};
  for (const key of Object.keys(draft.own).sort()) own[key] = draft.own[key];
  return freeze({ name: draft.name, own, layers: draft.layers, trashed: draft.trashed, retracted: draft.retracted });
}

export function applyPrimitive(draft: Draft, op: PrimitiveOp): void {
  switch (op.kind) {
    case "set": draft.own[pathKey(op.path)] = op.value; return;
    case "reset": delete draft.own[pathKey(op.path)]; return;
    case "tombstone": draft.own[pathKey(op.path)] = TOMBSTONE; return;
    case "layers": draft.layers = op.layers; return;
    case "rename": draft.name = op.name; return;
    case "trash": draft.trashed = true; return;
    case "restore": draft.trashed = false; return;
    case "retract": draft.retracted = true; return;
    case "unretract": draft.retracted = false; return;
  }
}

/** Applies one op to a draft. Returns the draft to continue with (a state-bearing op replaces it). */
function applyOp(draft: Draft | null, op: Op): Draft | null {
  switch (op.kind) {
    case "create": case "import": case "state": return draftOf(op.state);
    case "tag": case "untag": return draft;
    case "compensate": case "revert":
      if (draft) for (const inner of op.ops) applyPrimitive(draft, inner);
      return draft;
    default:
      if (draft) applyPrimitive(draft, op);
      return draft;
  }
}

/** Folds entries onto a starting state (null before creation). Entries are upcast to the type's schema first. */
export function fold(start: NodeState | null, entries: readonly Entry[], def?: TypeSpec): NodeState | null {
  let draft: Draft | null = start ? draftOf(start) : null;
  for (const entry of entries) draft = applyOp(draft, def ? upcast(def, entry).op : entry.op);
  return draft ? finish(draft) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Upcasting
// ---------------------------------------------------------------------------------------------------------------

function upcastPrimitive(op: PrimitiveOp, set: NonNullable<TypeSpec["upcasters"]>[number]["set"]): PrimitiveOp | null {
  if (op.kind !== "set" || !set) return op;
  const next = set(op.path, op.value);
  return next ? { kind: "set", path: next.path, value: next.value } : null;
}

/**
 * An entry as the type's current schema has it, through its upcasters (pure; the stored entry is untouched). A type's
 * upcasters are checked when it is defined to reach its schema (SPEC §15.3); an entry of a schema no step starts from
 * is read as it is.
 */
export function upcast(def: TypeSpec, entry: Entry): Entry {
  if (entry.schema === def.schema || !def.upcasters?.length) return entry;
  let op = entry.op, schema = entry.schema;
  while (schema !== def.schema) {
    const step = def.upcasters.find(item => item.from === schema);
    if (!step) break;
    switch (op.kind) {
      case "create": case "import": case "state":
        if (step.state) op = { ...op, state: step.state(op.state) };
        if (step.set) op = { ...op, state: { ...op.state, own: upcastOwn(op.state.own, step.set) } };
        break;
      case "compensate": case "revert":
        op = { ...op, ops: op.ops.map(inner => upcastPrimitive(inner, step.set)).filter((inner): inner is PrimitiveOp => !!inner) };
        break;
      default: {
        const next = upcastPrimitive(op as PrimitiveOp, step.set);
        op = next ?? { kind: "compensate", reverses: [], ops: [] };
      }
    }
    schema = step.to;
  }
  return { ...entry, op, schema };
}

function upcastOwn(own: NodeState["own"], set: NonNullable<NonNullable<TypeSpec["upcasters"]>[number]["set"]>): NodeState["own"] {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(own)) {
    const next = set(keyPath(key), value);
    if (next) out[pathKey(next.path)] = next.value;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Differences between states, as primitive ops (compensation, revert, detach)
// ---------------------------------------------------------------------------------------------------------------

/** The primitive ops that turn state `from` into state `to`. */
export function diffStates(from: NodeState, to: NodeState): PrimitiveOp[] {
  const ops: PrimitiveOp[] = [];
  const keys = new Set([...Object.keys(from.own), ...Object.keys(to.own)]);
  for (const key of [...keys].sort()) {
    const a = from.own[key], b = to.own[key];
    if (equal(a, b)) continue;
    if (b === undefined) ops.push({ kind: "reset", path: keyPath(key) });
    else ops.push({ kind: "set", path: keyPath(key), value: b });
  }
  if (!equal(from.layers, to.layers)) ops.push({ kind: "layers", layers: to.layers });
  if (from.name !== to.name) ops.push({ kind: "rename", name: to.name });
  if (from.trashed !== to.trashed) ops.push({ kind: to.trashed ? "trash" : "restore" });
  if (from.retracted !== to.retracted) ops.push({ kind: to.retracted ? "retract" : "unretract" });
  return ops;
}

export const EMPTY_STATE: NodeState = freeze({ name: "", own: {}, layers: [], trashed: false, retracted: false });
