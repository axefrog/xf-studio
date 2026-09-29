/**
 * Compaction primitives (pure). Compaction never loses anything something points at: it keeps the latest entry of
 * every stream and every entry something references, and rolls up the rest. Value streams drop unreferenced entries;
 * delta streams replace runs of unreferenced entries with the state at time-bucket boundaries. Inline collapse folds a
 * stream that exactly one entry references into that entry. Policies (when to run, what to keep beyond references)
 * are a later slice; these functions are what they will call.
 */
import { equal } from "./json";
import { kindAt } from "./define";
import type { TypeSpec } from "./define";
import { fold, upcast } from "./fold";
import { keyPath } from "./paths";
import type { Entry, EventRef, FieldKind, NodeRef, NodeState, Op } from "./types";

export type Stream = { readonly ref: NodeRef; readonly entries: readonly Entry[] };
export const entryKey = (ref: EventRef | { readonly node: NodeRef; readonly seq: number }) => `${ref.node.id}@${ref.seq}`;

const isRef = (value: unknown): value is NodeRef => !!value && typeof value === "object" &&
  typeof (value as NodeRef).id === "string" && typeof (value as NodeRef).type === "string";
const isEventRef = (value: unknown): value is EventRef => !!value && typeof value === "object" &&
  isRef((value as EventRef).node) && typeof (value as EventRef).seq === "number";

function valuesOfKind(def: TypeSpec | undefined, state: NodeState, want: FieldKind["kind"]): unknown[] {
  if (!def) return [];
  const out: unknown[] = [];
  for (const [key, value] of Object.entries(state.own)) {
    const at = kindAt(def, keyPath(key));
    if (!at?.leaf) continue;
    if (at.kind.kind === want) out.push(value);
    if (want === "ref" && at.kind.kind === "refs" && Array.isArray(value)) out.push(...value);
  }
  return out;
}

/**
 * The entries an entry references: tags, reverts, pins in layers, entry-valued fields, and (only while its commit is
 * in reach of an undo stack) what a compensation reverses.
 */
export function entryReferences(entry: Entry, def: TypeSpec | undefined, undoReach?: ReadonlySet<string>): EventRef[] {
  const out: EventRef[] = [];
  const op: Op = def ? upcast(def, entry).op : entry.op;
  const pins = (layers: NodeState["layers"]) => { for (const layer of layers) if (layer.at) out.push(layer.at); };
  switch (op.kind) {
    case "tag": out.push(...op.entries); break;
    case "revert": out.push(op.to); break;
    case "compensate": if (undoReach?.has(entry.commit)) out.push(...op.reverses); break;
    case "layers": pins(op.layers); break;
    case "set": {
      const at = def && kindAt(def, op.path);
      if (at?.kind.kind === "entry" && isEventRef(op.value)) out.push(op.value);
      break;
    }
    case "create": case "import": case "state":
      pins(op.state.layers);
      for (const value of valuesOfKind(def, op.state, "entry")) if (isEventRef(value)) out.push(value);
      break;
  }
  for (const inlined of entry.inlined ?? []) for (const inner of inlined.entries) out.push(...entryReferences(inner, def, undoReach));
  return out;
}

/** The nodes an entry references through reference fields (for inline collapse). */
export function nodeReferences(entry: Entry, def: TypeSpec | undefined): NodeRef[] {
  const op: Op = def ? upcast(def, entry).op : entry.op;
  if (op.kind === "set" && def) {
    const at = kindAt(def, op.path);
    if (at?.kind.kind === "ref" && isRef(op.value)) return [op.value];
    if (at?.kind.kind === "refs" && Array.isArray(op.value)) return op.value.filter(isRef);
    return [];
  }
  if (op.kind === "create" || op.kind === "import" || op.kind === "state") return valuesOfKind(def, op.state, "ref").filter(isRef);
  return [];
}

export type KeepOptions = {
  /** Entries kept whatever references them: bookmarks, recordings, manifests held outside the graph. */
  readonly roots?: readonly EventRef[];
  /** Commits on an undo or redo stack: their entries are kept, and what their compensations reverse. */
  readonly undoReach?: ReadonlySet<string>;
};

/**
 * The keep-set: the latest entry of every stream, every live tag, every entry of a commit in undo reach, the given
 * roots, and every entry any entry references. Returned as `nodeId@seq` keys.
 */
export function keepSet(streams: readonly Stream[], defs: (type: string) => TypeSpec | undefined, options: KeepOptions = {}): Set<string> {
  const keep = new Set<string>();
  for (const root of options.roots ?? []) keep.add(entryKey(root));
  for (const stream of streams) {
    const def = defs(stream.ref.type);
    const last = stream.entries[stream.entries.length - 1];
    if (last) keep.add(entryKey(last));
    const untagged = new Set<number>();
    for (const entry of stream.entries) if (entry.op.kind === "untag") untagged.add(entry.op.tag);
    for (const entry of stream.entries) {
      if (entry.op.kind === "tag" && !untagged.has(entry.seq)) keep.add(entryKey(entry));
      if (options.undoReach?.has(entry.commit)) keep.add(entryKey(entry));
      for (const ref of entryReferences(entry, def, options.undoReach)) keep.add(entryKey(ref));
    }
  }
  return keep;
}

/** A value stream rolled up: unreferenced entries dropped. */
export function rollupValueStream(entries: readonly Entry[], keep: ReadonlySet<string>): Entry[] {
  return entries.filter((entry, index) => index === entries.length - 1 || keep.has(entryKey(entry)));
}

/**
 * A delta stream rolled up: each run of unreferenced entries is replaced by the state at the end of each time bucket
 * it spans (`bucketMs`, one second by default), skipping buckets whose end state equals the state before them. Kept
 * entries keep their seq, position and op, so the fold at every kept entry and every emitted boundary is unchanged.
 */
export function rollupDeltaStream(def: TypeSpec | undefined, entries: readonly Entry[], keep: ReadonlySet<string>, bucketMs = 1000): Entry[] {
  const out: Entry[] = [];
  let state: NodeState | null = null, emitted: NodeState | null = null, run: Entry[] = [];
  const flush = () => {
    let i = 0;
    while (i < run.length) {
      const bucket = Math.floor(run[i].at / bucketMs);
      let j = i;
      while (j + 1 < run.length && Math.floor(run[j + 1].at / bucketMs) === bucket) j++;
      state = fold(state, run.slice(i, j + 1), def);
      if (state && !equal(state, emitted)) {
        const { meta: _meta, ...last } = run[j];
        out.push({ ...last, schema: def?.schema ?? last.schema, op: { kind: "state", state } });
        emitted = state;
      }
      i = j + 1;
    }
    run = [];
  };
  entries.forEach((entry, index) => {
    if (index === entries.length - 1 || keep.has(entryKey(entry))) {
      flush();
      out.push(entry);
      state = fold(state, [entry], def);
      emitted = state;
    } else run.push(entry);
  });
  flush();
  return out;
}

/**
 * Inline collapse: when exactly one entry anywhere references node `target` (and no entry references one of its
 * entries), returns that entry rewritten to carry the target's whole stream. Otherwise explains why not.
 */
export function collapseInline(streams: readonly Stream[], defs: (type: string) => TypeSpec | undefined, target: NodeRef):
  { readonly ok: true; readonly host: Entry; readonly stream: Stream } | { readonly ok: false; readonly referrers: number; readonly reason: string } {
  const stream = streams.find(item => item.ref.id === target.id);
  if (!stream) return { ok: false, referrers: 0, reason: "No such stream." };
  const referrers: Entry[] = [];
  let entryRefs = 0;
  for (const other of streams) {
    if (other.ref.id === target.id) continue;
    const def = defs(other.ref.type);
    for (const entry of other.entries) {
      if (nodeReferences(entry, def).some(ref => ref.id === target.id)) referrers.push(entry);
      if (entryReferences(entry, def).some(ref => ref.node.id === target.id)) entryRefs++;
    }
  }
  if (referrers.length !== 1 || entryRefs) return { ok: false, referrers: referrers.length + entryRefs,
    reason: referrers.length + entryRefs === 0 ? "Nothing references it." : "More than one entry references it." };
  const host = referrers[0];
  return { ok: true, stream, host: { ...host, inlined: [...(host.inlined ?? []), { node: stream.ref, entries: stream.entries }] } };
}
