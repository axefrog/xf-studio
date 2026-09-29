/**
 * Entity-layer behaviours stated as data: types, a script of commits and other steps, and what must come out. Run by
 * `runEntityVector` from `strata/testing` (tests/data-cases.test.ts).
 */
import type { EntityVector } from "strata/testing";

const item = {
  type: "item", owner: "cases", schema: "1", compatible: ["variant"],
  fields: {
    title: { kind: "value" }, tags: { kind: "map", of: { kind: "value" } },
    link: { kind: "ref", to: "item", clone: "follow" }, list: { kind: "refs", to: "item", clone: "share" },
    pin: { kind: "entry" }, code: { kind: "value", inherit: false, unique: true },
  },
  constants: [{ name: "base", label: "Base", fields: { title: "from the constant" } }],
} as const;
const variant = { type: "variant", owner: "cases", schema: "1", fields: { title: { kind: "value" } } } as const;
const other = { type: "other", owner: "cases", schema: "1", fields: { title: { kind: "value" } } } as const;
const TYPES = [item, variant, other] as unknown as EntityVector["types"];
const a = { $label: "a" }, b = { $label: "b" };
const A = { type: "item", id: "00000000-0000-4000-8000-00000000000a" };
const N = { type: "item", id: "00000000-0000-4000-8000-0000000000bb" };
const MISSING = { type: "item", id: "00000000-0000-4000-8000-0000000000ee" };
const create = (as: string, fields: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ commit: [{ op: "create", type: "item", as, fields, ...extra }] });

export const ENTITY_CASES: EntityVector[] = [
  {
    name: "malformed-edits-are-refused-with-their-reason",
    kind: "entity",
    description: "No edits; a node named by a creation label nothing was created under; a target that isn't a reference; an unknown edit; a path with a part that isn't text; a tombstone on a field that isn't a map key; a name that isn't text; an import whose source isn't plain data; a tag without a label or with entries that aren't entry references. Each is refused with its reason, and nothing changes.",
    types: TYPES,
    script: [
      create("a", { title: "a" }),
      { commit: [] },
      { commit: [{ op: "set", node: { created: "nobody" }, path: ["title"], value: 1 }] },
      { commit: [{ op: "set", node: {}, path: ["title"], value: 1 }] },
      { commit: [{ op: "set", node: { type: "nosuch", id: "x" }, path: ["title"], value: 1 }] },
      { commit: [{ op: "frobnicate", node: a }] },
      { commit: [{ op: "set", node: a, path: [1], value: 1 }] },
      { commit: [{ op: "set", node: a, path: "title", value: 1 }] },
      { commit: [{ op: "tombstone", node: a, path: ["title"] }] },
      { commit: [{ op: "tombstone", node: a, path: ["tags"] }] },
      { commit: [{ op: "rename", node: a, name: 7 }] },
      { commit: [{ op: "import", type: "other", id: "00000000-0000-4000-8000-000000000003", name: "i", source: "\ud800" }] },
      { commit: [{ op: "import", type: "nosuch", id: "00000000-0000-4000-8000-000000000004", name: "i", source: "x" }] },
      { commit: [{ op: "tag", node: a }] },
      { commit: [{ op: "tag", node: a, label: "t", entries: [{ node: a, seq: 0 }] }] },
      { commit: [{ op: "tag", node: a, label: "t", entries: [null] }] },
      { commit: [{ op: "set", node: a, path: ["title"], value: { created: "nobody" } }] },
      { commit: [{ op: "set", node: a, path: ["pin"], value: { node: a, seq: 0 } }] },
      { commit: [{ op: "set", node: a, path: ["tags"], value: 1 }] },
    ] as never,
    expect: {
      refusals: [null, "empty", "missing", "missing", "type", "value", "path", "path", "path", "path", "value", "value", "type", "value", "value", "value", "missing", "value", "path"],
      effective: { a: { title: "a", tags: {} } },
      streams: { a: [[1, "create"]] },
    },
  },
  {
    name: "layers-are-checked-before-they-are-applied",
    kind: "entity",
    description: "A layer list that isn't a list, a layer that is neither base nor feed, two bases, a base naming paths, a feed naming none or a path the type lacks, a source of an incompatible type, a node layering from itself or a node that doesn't exist, and pins naming another node's entry, an entry that doesn't exist, or a node created in the same commit are refused. A source of a compatible type is accepted; a feed and a rebase may pin to an entry.",
    types: TYPES,
    script: [
      create("a", { title: "a", tags: { k: 1 } }),
      create("b"),
      { commit: [{ op: "create", type: "variant", as: "v", fields: { title: "from a variant" } }] },
      { commit: [{ op: "create", type: "other", as: "o", fields: { title: "o" } }] },
      { commit: [{ op: "layers", node: b, layers: "nope" }] },
      { commit: [{ op: "layers", node: b, layers: [{ from: a, role: "side", paths: "*" }] }] },
      { commit: [{ op: "layers", node: b, layers: [null] }] },
      { commit: [{ op: "layers", node: b, layers: [{ from: a, role: "base", paths: "*" }, { from: { $label: "v" }, role: "base", paths: "*" }] }] },
      { commit: [{ op: "layers", node: b, layers: [{ from: a, role: "base", paths: [["title"]] }] }] },
      { commit: [{ op: "layers", node: b, layers: [{ from: a, role: "feed", paths: [] }] }] },
      { commit: [{ op: "layers", node: b, layers: [{ from: a, role: "feed", paths: [["nope"]] }] }] },
      { commit: [{ op: "layers", node: b, layers: [{ from: a, role: "feed", paths: [[]] }] }] },
      { commit: [{ op: "layers", node: b, layers: [{ from: { $label: "o" }, role: "base", paths: "*" }] }] },
      { commit: [{ op: "layers", node: b, layers: [{ from: b, role: "base", paths: "*" }] }] },
      { commit: [{ op: "layers", node: b, layers: [{ from: MISSING, role: "base", paths: "*" }] }] },
      { commit: [{ op: "layers", node: b, layers: [{ from: a, role: "base", paths: "*", at: { node: b, seq: 1 } }] }] },
      { commit: [{ op: "layers", node: b, layers: [{ from: a, role: "base", paths: "*", at: { node: a, seq: 9 } }] }] },
      { commit: [{ op: "layers", node: b, layers: [{ from: a, role: "base", paths: "*", at: { node: a, seq: 0 } }] }] },
      { commit: [{ op: "create", type: "item", as: "n", id: N.id, fields: { title: "n" } }, { op: "layers", node: b, layers: [{ from: N, role: "base", paths: "*", at: { node: N, seq: 1 } }] }] },
      { commit: [{ op: "layers", node: b, layers: [{ from: { $label: "v" }, role: "feed", paths: [["title"]] }] }] },
      { commit: [{ op: "set", node: a, path: ["title"], value: "a later" }] },
      { commit: [{ op: "feed", node: b, from: a, paths: [["tags"]], at: 1 }] },
      { commit: [{ op: "create", type: "item", as: "c" }, { op: "rebase", node: { created: "c" }, base: a, at: 1 }] },
    ] as never,
    expect: {
      refusals: [null, null, null, null, "value", "value", "value", "value", "path", "path", "path", "path", "type", "cycle", "missing", "value", "missing", "value", "pinned", null, null, null, null],
      effective: { b: { title: "from a variant", tags: { k: 1 } }, c: { title: "a", tags: { k: 1 } } },
      origins: { b: { '["title"]': "feed v v", '["tags","k"]': "feed a a" }, c: { '["title"]': "base a a" } },
    },
  },
  {
    name: "creation-forks-and-clones-are-checked",
    kind: "entity",
    description: "A creation label used twice in one commit, an ID already used, a fork of a node that doesn't exist and a clone of another type are refused. A clone takes the fields given with it; its reference rules can be overridden per field, so a shared reference is followed and cloned too.",
    types: TYPES,
    script: [
      create("a", { title: "a" }),
      create("b", { title: "b", link: a, list: [a] }),
      { commit: [{ op: "create", type: "item", as: "x" }, { op: "create", type: "item", as: "x" }] },
      { commit: [{ op: "create", type: "item", as: "y", id: "00000000-0000-4000-8000-0000000000aa" }] },
      { commit: [{ op: "create", type: "item", as: "z", id: "00000000-0000-4000-8000-0000000000aa" }] },
      { commit: [{ op: "create", type: "item", as: "f", from: { fork: MISSING } }] },
      { commit: [{ op: "create", type: "other", as: "g", from: { clone: a } }] },
      { commit: [{ op: "create", type: "item", as: "copy", from: { clone: b, rules: { list: "follow" } }, fields: { title: "copied" } }] },
      { commit: [{ op: "create", type: "item", as: "shared", from: { clone: b, rules: { "item.link": "share" } } }] },
      { commit: [{ op: "create", type: "item", as: "named", name: "Named", from: { clone: a } }] },
    ] as never,
    expect: {
      refusals: [null, null, "exists", null, "exists", "missing", "type", null, null, null],
      effective: { shared: { title: "b", tags: {}, link: a, list: [a] }, named: { title: "a", tags: {} } },
      streams: { copy: [[1, "create"], [2, "set"]] },
    },
  },
  {
    name: "revert-tag-untag-and-put",
    kind: "entity",
    description: "Reverting to entry 0, to a fraction or past the head is refused as missing. A tag with no entries tags the node's head; untag releases it. Put replaces every own value the node sets itself with the given fields, keeping identity (inherit: false) values.",
    types: TYPES,
    script: [
      create("a", { title: "a", tags: { k: 1 }, code: "A" }),
      { commit: [{ op: "set", node: a, path: ["title"], value: "a2" }] },
      { commit: [{ op: "revert", node: a, to: 0 }] },
      { commit: [{ op: "revert", node: a, to: 1.5 }] },
      { commit: [{ op: "revert", node: a, to: 9 }] },
      { commit: [{ op: "tag", node: a, label: "keep" }] },
      { commit: [{ op: "untag", node: a, tag: 3 }] },
      { commit: [{ op: "put", node: a, fields: { title: "put", tags: { other: 2 } } }] },
    ] as never,
    expect: {
      refusals: [null, null, "missing", "missing", "missing", null, null, null],
      effective: { a: { title: "put", tags: { other: 2 }, code: "A" } },
      streams: { a: [[1, "create"], [2, "set"], [3, "tag"], [4, "untag"], [5, "reset"], [6, "set"], [7, "set"]] },
    },
  },
  {
    name: "apply-to-source-refuses-what-it-cannot-write",
    kind: "entity",
    description: "Applying a value the node doesn't set is refused (path); with no layer to take it from, no-source; into a pinned layer, pinned; into a constant, constant.",
    types: TYPES,
    script: [
      create("a", { title: "a" }),
      create("free", { title: "free" }),
      { commit: [{ op: "create", type: "item", as: "k", from: { fork: { type: "item", id: "builtin:item/base" } } }] },
      { commit: [{ op: "create", type: "item", as: "p", from: { fork: a, at: 1 }, fields: { title: "mine" } }] },
      { commit: [{ op: "applyToSource", node: { $label: "free" }, path: ["tags", "x"] }] },
      { commit: [{ op: "applyToSource", node: { $label: "free" }, path: ["title"] }] },
      { commit: [{ op: "applyToSource", node: { $label: "p" }, path: ["title"] }] },
      { commit: [{ op: "set", node: { $label: "k" }, path: ["title"], value: "k" }] },
      { commit: [{ op: "applyToSource", node: { $label: "k" }, path: ["title"] }] },
    ] as never,
    expect: { refusals: [null, null, null, null, "path", "no-source", "pinned", null, "constant"] },
  },
  {
    name: "a-stated-basis-must-match-the-heads",
    kind: "entity",
    description: "A commit made against a stated head seq is refused as stale when the node has moved on, and accepted when it hasn't; a node the basis names that doesn't exist counts as head 0. Undo and redo with nothing to do are refused.",
    types: TYPES,
    script: [
      { commit: [{ op: "create", type: "item", as: "a", id: A.id, fields: { title: "a" } }] },
      { commit: [{ op: "set", node: a, path: ["title"], value: "stale" }], options: { base: { [A.id]: 0 } } },
      { commit: [{ op: "set", node: a, path: ["title"], value: "current" }], options: { base: { [A.id]: 1, [MISSING.id]: 0 } } },
      { undo: "nowhere" },
      { redo: "default" },
    ] as never,
    expect: { refusals: [null, "stale", null, "nothing-to-undo", "nothing-to-undo"], effective: { a: { title: "current", tags: {} } } },
  },
  {
    name: "an-own-acknowledgement-never-skips-another-windows-entries",
    kind: "entity",
    description: "Two windows over one store. Main changes a; then the other window commits a new node, whose position is after main's change, and the store acknowledges it; when the other window then catches up it still reads main's change.",
    types: TYPES,
    script: [
      { commit: [{ op: "create", type: "item", as: "a", fields: { title: "one" } }] },
      { window: "other" }, { sync: true },
      { window: "main" }, { commit: [{ op: "set", node: a, path: ["title"], value: "from main" }] },
      { window: "other" }, { commit: [{ op: "create", type: "item", as: "b", fields: { title: "theirs" } }] }, { sync: true },
    ] as never,
    expect: { refusals: [null, null, null], windows: { other: { effective: { a: { title: "from main", tags: {} }, b: { title: "theirs", tags: {} } } } } } as never,
  },
  {
    name: "a-pin-to-a-purged-source-reads-nothing-from-it",
    kind: "entity",
    description: "A fork pinned to an entry of its source reads the source as it was; once the source is purged (forced, since the fork layers from it), the fork reads nothing from it, and reports the change.",
    types: TYPES,
    script: [
      create("a", { title: "a", tags: { k: 1 } }),
      { commit: [{ op: "create", type: "item", as: "p", from: { fork: a, at: 1 } }] },
      { purge: "a" },
      { purge: "a", force: true },
    ] as never,
    expect: { refusals: [null, null, "dependents", null], effective: { p: { tags: {} } }, changes: [['a ["tags","k"]', 'a ["title"]'], ['p ["tags","k"]', 'p ["title"]'], [], ['a ["tags","k"]', 'a ["title"]', 'p ["tags","k"]', 'p ["title"]']] as never },
  },
  {
    name: "a-pin-reads-its-sources-layers-at-its-point-after-a-reload",
    kind: "entity",
    description: "A fork pinned to an entry of s, itself a fork of b, reads b as it was at that entry. After b changes, the session ends and a graph loads from snapshots taken after the pin: the pin still reads b's old value.",
    types: TYPES,
    script: [
      create("b", { title: "old" }),
      { commit: [{ op: "create", type: "item", as: "s", from: { fork: b } }] },
      { commit: [{ op: "create", type: "item", as: "p", from: { fork: { $label: "s" }, at: 1 } }] },
      { commit: [{ op: "set", node: b, path: ["title"], value: "new" }] },
      { commit: [{ op: "set", node: b, path: ["title"], value: "newer" }] },
      { reload: true },
    ] as never,
    expect: { effective: { p: { title: "old", tags: {} }, s: { title: "newer", tags: {} } } },
  },
];

