/**
 * Strata's public data types. Everything here is plain, serialisable data: nodes, fields, layers, stream entries,
 * change sets and conflicts. Behaviour lives in the graph (`graph.ts`); these types are what crosses its boundary.
 */
import type { Json } from "./json";

/** A node's identity: a UUID, or `builtin:<type>/<name>` for a constant. */
export type NodeId = string;
/** A registered node type, such as `preset:eye-makeup` or `look`. */
export type NodeType = string;
export type NodeRef = { readonly type: NodeType; readonly id: NodeId };
/** A field, or a field and map keys: `["layers", "<layerId>", "colour"]`. */
export type Path = readonly string[];
/** One entry of one stream: node `node`'s entry number `seq`. Entries are nodes too, so anything may reference one. */
export type EventRef = { readonly node: NodeRef; readonly seq: number };

// ---------------------------------------------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------------------------------------------

/**
 * How a field holds data and how it layers.
 * - `value`: an atomic JSON value.
 * - `ref` / `refs`: an edge to one node, or an ordered, atomic list of edges. `clone` says whether a deep clone copies
 *   the target (`follow`) or keeps pointing at it (`share`); `follows` says whether derivations walk the edge.
 * - `entry`: a reference to a stream entry (an `EventRef`); compaction keeps what it points at.
 * - `map`: keyed values, resolved per key; keys union across layers; a tombstone removes an inherited key.
 */
export type FieldKind =
  | { readonly kind: "value" }
  | { readonly kind: "ref"; readonly to: NodeType | readonly NodeType[]; readonly clone: "follow" | "share"; readonly follows?: true }
  | { readonly kind: "refs"; readonly to: NodeType | readonly NodeType[]; readonly clone: "follow" | "share"; readonly follows?: true }
  | { readonly kind: "entry" }
  | { readonly kind: "map"; readonly of: FieldKind };
/**
 * A field of a node type. `inherit: false` marks identity and bookkeeping (a name's export ID, a creation time): never
 * layered, never copied by a clone. `unique: true` refuses two live nodes of the type with the same own value.
 */
export type FieldSpec = FieldKind & { readonly inherit?: false; readonly unique?: true };

/** A validation finding on a node's effective value. */
export type Issue = { readonly path: Path; readonly message: string; readonly code?: string };

// ---------------------------------------------------------------------------------------------------------------
// Layers, own values, node state
// ---------------------------------------------------------------------------------------------------------------

/**
 * A layer: take values from another node of the same type. A `base` supplies every path the node doesn't set; a
 * `feed` supplies only `paths`, ahead of the base. `at` pins the layer to a point of the source's stream; without it
 * the layer follows the source live.
 */
export type Layer = {
  readonly from: NodeRef; readonly role: "base" | "feed"; readonly paths: "*" | readonly Path[]; readonly at?: EventRef;
};

/**
 * What a node sets itself, keyed by path key (`pathKey(path)`, a JSON array string). A tombstone value
 * (`TOMBSTONE`) at a map key means "absent here", which stops the search for that key.
 */
export type OwnValues = Readonly<Record<string, Json>>;

/** The fold of a node's stream: its own values, layers and bookkeeping. */
export type NodeState = {
  readonly name: string; readonly own: OwnValues; readonly layers: readonly Layer[];
  readonly trashed: boolean;
  /** Set by the compensation of the node's creation: the node reads as absent, exactly as before it was created. */
  readonly retracted: boolean;
};

// ---------------------------------------------------------------------------------------------------------------
// Streams and entries
// ---------------------------------------------------------------------------------------------------------------

/** The primitive changes a delta stream applies. */
export type PrimitiveOp =
  | { readonly kind: "set"; readonly path: Path; readonly value: Json }
  | { readonly kind: "reset"; readonly path: Path }
  | { readonly kind: "tombstone"; readonly path: Path }
  | { readonly kind: "layers"; readonly layers: readonly Layer[] }
  | { readonly kind: "rename"; readonly name: string }
  | { readonly kind: "trash" }
  | { readonly kind: "restore" }
  | { readonly kind: "retract" }
  | { readonly kind: "unretract" };

/** A stream entry's change. `state` replaces the whole state (value streams, rollups, creation). */
export type Op =
  | PrimitiveOp
  | { readonly kind: "create"; readonly state: NodeState }
  | { readonly kind: "import"; readonly state: NodeState; readonly source: Json }
  | { readonly kind: "state"; readonly state: NodeState }
  | { readonly kind: "tag"; readonly label: string; readonly entries: readonly EventRef[] }
  | { readonly kind: "untag"; readonly tag: number }
  | { readonly kind: "compensate"; readonly reverses: readonly EventRef[]; readonly ops: readonly PrimitiveOp[] }
  | { readonly kind: "revert"; readonly to: EventRef; readonly ops: readonly PrimitiveOp[] };

/** Where an entry came from when another actor made it (a belief). */
export type Provenance = {
  readonly actor: string; readonly actorSeq: number; readonly at: number; readonly kind?: string; readonly note?: string;
};

/** What the first entry of each commit records about the commit as a whole. */
export type CommitMeta = {
  readonly label?: string;
  /** The position of every node the commit was made against: `[nodeId, seq]`, seq 0 for a node that didn't exist. */
  readonly basis: readonly (readonly [NodeId, number])[];
  readonly scope?: string;
};

/**
 * One entry of a stream. `seq` counts the stream's entries; `pos` is the local commit order (a point in time);
 * `commit` groups one commit's entries; `actor` and `actorSeq` identify who made it; `at` is the clock source's
 * wall time; `schema` is the node type's entry schema when written.
 */
export type Entry = {
  readonly node: NodeRef; readonly seq: number; readonly pos: number; readonly commit: string;
  readonly actor: string; readonly actorSeq: number; readonly at: number; readonly schema: string;
  readonly op: Op; readonly provenance?: Provenance; readonly meta?: CommitMeta;
  /** Streams collapsed into this entry (inline collapse): nothing else referenced them. */
  readonly inlined?: readonly { readonly node: NodeRef; readonly entries: readonly Entry[] }[];
};

/** A cached fold of a stream up to `seq`. Discardable; never the truth. */
export type Snapshot = {
  readonly node: NodeRef; readonly seq: number; readonly pos: number; readonly schema: string; readonly state: NodeState;
};

/** A point in time: a position, an entry, a commit, or `"head"`. */
export type TimePoint = number | EventRef | { readonly commit: string } | "head";

// ---------------------------------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------------------------------

/** What one commit changed on one node. */
export type NodeChange = {
  readonly node: NodeRef;
  /** Leaf paths whose effective value changed. */
  readonly paths: readonly Path[];
  /** Bookkeeping that changed: `created`, `name`, `layers`, `trashed`, `retracted`, `purged`. */
  readonly meta: readonly ("created" | "name" | "layers" | "trashed" | "retracted" | "purged")[];
  /** Nodes this node reaches through `follows` references whose value changed (its derivations are dirty). */
  readonly via: readonly NodeRef[];
};
/** One commit's changes, delivered once to each subscriber. */
export type ChangeSet = {
  readonly commit: string; readonly label?: string; readonly cause: "commit" | "undo" | "redo" | "sync" | "rollback" | "fix" | "recover" | "purge";
  readonly nodes: readonly NodeChange[];
};

/** Where a value comes from. */
export type Origin =
  | { readonly via: "own"; readonly node: NodeRef }
  | { readonly via: "feed" | "base"; readonly layer: NodeRef; readonly owner: NodeRef | "default" }
  | { readonly via: "default" }
  | { readonly via: "absent" };

// ---------------------------------------------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------------------------------------------

export type Severity = "blocking" | "warning" | "notice";
/** A rewrite of the graph, applied as one commit by `graph.fix`. */
export type GraphPatch = readonly Edit[];
export type FixRoute = {
  readonly id: string; readonly label: string; readonly consequence: string; readonly recommended?: true; readonly patch: GraphPatch;
};
/** A wiring whose result would be wrong or surprising, or (kind `disagreement`) two actors' differing claims. */
export type Conflict = {
  readonly id: string; readonly rule: string; readonly owner: string; readonly severity: Severity;
  readonly kind: "conflict" | "disagreement";
  /** Action kinds a blocking conflict refuses on its subjects; `"*"` for every edit. */
  readonly blocks: readonly string[];
  readonly subjects: readonly NodeRef[]; readonly sentence: string; readonly routes: readonly FixRoute[];
};

// ---------------------------------------------------------------------------------------------------------------
// Edits (the commit API)
// ---------------------------------------------------------------------------------------------------------------

/** A node named by reference, or by the `as` label of a node created earlier in the same commit. */
export type Target = NodeRef | { readonly created: string };

/** One edit in a commit. Layering operations are edits too. */
export type Edit =
  | {
    readonly op: "create"; readonly type: NodeType; readonly as?: string; readonly id?: NodeId; readonly name?: string;
    /** Start as a fork (a live base, optionally pinned to `at`) or a deep clone of another node. */
    readonly from?: { readonly fork: Target; readonly at?: number } | { readonly clone: Target; readonly rules?: Readonly<Record<string, "follow" | "share">> };
    /** Own values, by field (map fields as objects of keys). */
    readonly fields?: Readonly<Record<string, unknown>>;
    readonly layers?: readonly Layer[];
  }
  | { readonly op: "import"; readonly type: NodeType; readonly id: NodeId; readonly name: string; readonly fields?: Readonly<Record<string, unknown>>; readonly source: Json }
  | { readonly op: "set"; readonly node: Target; readonly path: Path; readonly value: unknown }
  | { readonly op: "reset"; readonly node: Target; readonly path: Path }
  | { readonly op: "tombstone"; readonly node: Target; readonly path: Path }
  | { readonly op: "layers"; readonly node: Target; readonly layers: readonly Layer[] }
  | { readonly op: "feed"; readonly node: Target; readonly from: NodeRef; readonly paths: "*" | readonly Path[]; readonly at?: number }
  | { readonly op: "rename"; readonly node: Target; readonly name: string }
  | { readonly op: "trash"; readonly node: Target }
  | { readonly op: "restore"; readonly node: Target }
  | { readonly op: "detach"; readonly node: Target }
  | { readonly op: "rebase"; readonly node: Target; readonly base: NodeRef; readonly at?: number }
  | { readonly op: "applyToSource"; readonly node: Target; readonly path: Path }
  | { readonly op: "revert"; readonly node: Target; readonly to: number }
  | { readonly op: "tag"; readonly node: Target; readonly label: string; readonly entries?: readonly EventRef[] }
  | { readonly op: "untag"; readonly node: Target; readonly tag: number }
  | { readonly op: "put"; readonly node: Target; readonly fields: Readonly<Record<string, unknown>> };

/** Why a commit or an action was refused. Every refusal carries one. */
export type RefusalCode =
  | "missing" | "constant" | "type" | "path" | "value" | "cycle" | "unique" | "stale" | "conflict" | "unloaded"
  | "pinned" | "no-source" | "dependents" | "empty" | "exists" | "nothing-to-undo";
export type Refusal = { readonly ok: false; readonly reason: RefusalCode; readonly message: string; readonly conflict?: Conflict; readonly dependents?: readonly NodeRef[] };
export type CommitResult =
  | { readonly ok: true; readonly commit: string; readonly changes: ChangeSet; readonly created: Readonly<Record<string, NodeRef>> }
  | Refusal;
