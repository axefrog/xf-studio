# Profiles, Vs, saves and presets: the Studio graph

**Status:** design, revision 2 (29 September 2026), after the first revision's open questions were answered (§0.1); nothing built. It is the connective tissue the [1.0 bar](../../docs/release-readiness.md) needs between features that exist today in separate places: the Save Explorer, loading a V for editing, the Character panel's V, the collection library, part presets, saved layouts, the view graph and export identities. Everything becomes a **node** in one graph stored in the player's database. Profiles are nodes the interface anchors to; they introduce other nodes but own none. Any node can exist any number of times, and any node can share with, fork from or feed from another. The graph core is a standalone engine package with deterministic simulation testing built in (§1, §5). The maintainer reviews this revision before anything is built.

It extends the [architecture contract](architecture-contract.md), the [feature-module platform](feature-module-platform.md) (§2 document model, §6 export), the [view graph design](view-graph-design.md) (whose nodes join this graph) and the [selectors design](selectors-design.md), and it follows the save-safety rules of [save files](../../knowledge/save-files.md#5-editing-safely), the [save write-back design](../character-customization/save-writeback-design.md) and the [save editor design](../save/save-editor-design.md#7-edit-safety). Code paths are relative to `projects/xf-studio/authoring/src/`.

## Contents

- [0. Summary](#0-summary)
- [1. Layers and the graph engine package](#1-layers-and-the-graph-engine-package) (and the [live game as a remote replica](#13-future-adapter-the-live-game-as-a-remote-replica))
- [2. Graph foundations](#2-graph-foundations)
- [3. Node types](#3-node-types)
- [4. Conflicts, fixes and history](#4-conflicts-fixes-and-history)
- [5. Deterministic simulation testing](#5-deterministic-simulation-testing)
- [6. Flows](#6-flows)
- [7. Mapping to today's code, and migration](#7-mapping-to-todays-code-and-migration)
- [8. UI surfaces (specified for the UI track)](#8-ui-surfaces-specified-for-the-ui-track)
- [9. Phased implementation plan](#9-phased-implementation-plan)
- [10. Proposed architecture-contract addition](#10-proposed-architecture-contract-addition)
- [11. Open questions, with recommended defaults](#11-open-questions-with-recommended-defaults)

## 0. Summary

### 0.1 Decisions this revision is built on (29 September 2026)

| # | Question in revision 1 | Decision |
|---|---|---|
| 1 | Does the edited makeup stay on when flicking Vs? | **No such overlay.** To compare, give each V the same preset. Several Vs can sit in one profile, each with its own 3D view open at once, and one change to a shared preset shows on every V that uses it. There is no "one active V" anywhere; which node a panel reflects is itself a wiring (UI nodes, §2.6). |
| 2 | May a save be overwritten? | Not by default; the player opts in **per save**: *never overwrite*, *ask me first* or *overwrite without asking*, with defaults. Writing a new save is always available. Policies are nodes (§3.6). |
| 3 | Where do profiles and layouts live? | **Everything is a top-level node in the database.** Profiles reference nodes and own none. Distinctness between profiles comes from **deep clone**, **shallow fork** or **reference with selective feed**, layered to any depth (§2.4). |
| 4 | Keep long legacy export identities? | **No.** Nothing is released beyond alphas: migrate everything to the new short IDs, losslessly (§7.3). |
| 5 | Is a preset one feature's part? | Yes: a preset is one feature's node, and a combined look is a node that references several feature presets. |
| 6 | Default V? | Whatever the game presents by default, shipped as **baked-in constant nodes** that new profiles clone, fork or reference, unless the player starts from an existing profile (§3.3). |
| 7 | Several databases? | One for now. A later **system profile** may say where the database and configuration live. |
| 8 | Consider installed mods from elsewhere in deployment warnings? | Yes, as far as is reasonable (§4.1, D2). |
| 9 | (Added requirement) Testing | **Deterministic simulation testing** is a first-class property: every source of non-determinism is a swappable source node, nothing reads the clock, randomness, files, the network or the bridge directly, and the engine ships a seeded simulation harness (§5). |
| 10 | (Added requirement) Reuse | The graph core is a **standalone, reusable engine** in its own neutrally named package with a small documented API, importing nothing from the Studio, so another project can start from it (§1). |

### 0.2 The model in one paragraph

The Studio keeps **one graph**, built on a standalone graph engine (working name **Strata**, §1). Its nodes are typed records of **fields**; some fields are **references** to other nodes. Every node is top-level in the database, with a stable UUID, and any type can have any number of nodes. A node's value can be **layered**: it may **fork** from a base node of its type (inheriting every field it doesn't set itself) and take **feeds** from other nodes of its type (importing only chosen fields), to any depth, without cycles. **Deep clone** makes an independent copy of a node and, by type rules, of what it references. Types include feature presets, looks, Vs, saves and save policies, mods, layouts, views and their scenes, cameras and lights, **pointer** nodes that panels bind to, and profiles. **Constant** nodes shipped with the Studio (the Default Vs, the factory layout, the baseline save policy) are read-only starting points. Derived values (a V's resolved appearance, a mod's identity keys, conflicts) are recomputed only along the edges a change travels.

### 0.3 Key design decisions

1. **A standalone engine, then the Studio on top.** The engine package (`projects/strata/`, MIT) owns identity, fields, references, layering, resolution, propagation, batching, cloning, conflicts, invariants, history, source nodes, the simulation harness, storage interfaces and the inspector's data model; it imports nothing from the Studio and knows no V. The Studio registers its node types, rules and adapters through the engine's public API only.
2. **Deterministic by construction.** Time, randomness, input, storage, files, jobs, the network and the game bridge enter only as source nodes; the same code runs against real adapters in the app and seeded simulated ones in tests, where every failure reproduces from its seed.
3. **No implicit current anything.** Every action names the node it acts on. "The focused V" or "the preset being edited" are pointer nodes a panel is bound to, never state hidden in a service. A ratchet test lists today's singleton assumptions and may only shrink.
4. **Runtimes per node, shared by reference.** A preset's preview textures are made once per revision and used by every V that wears it; a V's character runtime exists once however many views show it. Runtimes are reference-counted by what is visible or bound, and withdrawn when nothing is.
5. **Layering is field-level and explicit.** Resolution order: the node's own value, then its feeds in order, then its base, then the type default. Every panel can say where a value comes from and offer Reset, Override here and Edit the source.
6. **The database is the working store.** Nodes autosave; files are export and import. Storage is additive (new tables, no column added to a released table, `user_version` left at 2), with automatic backups and a pre-migration copy.
7. **Conflicts never block looking, only doing,** and offer undoable fix routes. Deployment conflicts between mods are warnings.
8. **Saves:** a new save is always offered; overwriting follows the save's policy node; every overwrite keeps a restorable copy; the offline writer stays gated on its in-game session, and Apply in game comes first.

**Plan.** Nine slices (G1–G9, §9), about 47 agent-days plus 4 for the gated offline writer. G1 delivers the engine package first (multiplicity, layering, sources and the simulation harness, proved against a brute-force reference model), then the Studio's adapters and store on it.

## 1. Layers and the graph engine package

The graph core is a **standalone, reusable engine**, so another project can start from the same architecture. Its working name is **Strata** (neutral, and it names what the engine is about: layered nodes; question Q5).

### 1.1 Layers

| Layer | Holds | May import | Lives in |
|---|---|---|---|
| **Engine** (Strata) | Nodes, fields and edges; batching and commits; derivation and propagation; cycle detection; layering (reference, fork, feed, clone, detach, rebase, reset, push); constants; the conflict and invariant framework with fix routes; history; **source and sink node interfaces** and their simulated implementations; the DST scheduler and harness; **storage interfaces** (no SQLite or Bun inside); the inspector's data model and query language | Nothing outside its own folder; standard ECMAScript only (no `bun:*`, `node:*`, DOM or host globals) | `projects/strata/` |
| **Adapters** | The SQLite store (`bun:sqlite`) and its host transport; Bun sources (clock, randomness, files, jobs) and browser sources (clock, animation frames, input, the host transport); the runtime bridge source (and, later, its sinks, §1.3) | The engine's public API; host and browser APIs | `projects/xf-studio/authoring/src/platform/graph-adapters/` |
| **Studio domain types** | Node types and rules for V, presets and looks, saves and save policies, profiles, layouts, pointers, mods and export identity, view graph nodes; constants (Default Vs, factory layout, baseline policy) | The engine's public API; the platform API | `projects/xf-studio/authoring/src/platform/graph-types/` |
| **Features** | Their preset types (part codecs, keyed maps, selector types), their conflict rules, runtimes per node | The platform API (which re-exports the engine types a feature needs) | `src/features/<id>/` |
| **UI** | Panels bound to nodes through pointers, the inspector panel | `port.graph` only (detached snapshots, queries, capabilities, dispatch) | `src/studio-ui/` |

### 1.2 The package

- **Its own boundary:** `projects/strata/` with `package.json` (MIT, like the repository), an `index.ts` entry point (the public API) and a `testing.ts` entry point (the simulation harness and reference model, for tests), `tests/`, `README.md` (concepts, API, guarantees) and `examples/minimal/` (two node types, a fork, a feed, a conflict rule and a seeded simulation run, runnable with `bun examples/minimal`). The Studio depends on it as a local path dependency and imports only `strata` and `strata/testing`, never a deep path.
- **The engine imports nothing from the Studio.** A boundary test in the engine's own suite checks that every import resolves inside `projects/strata/` and that no host or DOM global is read; the Studio's import-boundary test checks that Studio code reaches the engine only through its two entry points.
- **A small, stable, documented API.** Roughly: `defineType`, `defineRule`, `defineSource`, `defineSink`, `createGraph({ types, rules, sources, store })`; on a graph: `read`, `resolve`, `origin` (where a value comes from), `commit` (a batch of edits and layering operations), `subscribe`, `undo` and `redo`, `conflicts`, `fix`, `inspect`; the store interface (`GraphStore`: list, get, commit, trash, restore, purge, versions, change counter); the source interfaces (§5.1); and from `strata/testing`: `simulate`, `referenceModel`, the standard invariants and the shrinker. The exported surface is snapshotted from the type declarations (`tests/api-surface.test.ts`), so any change to it is deliberate and noted in the package's changelog; it follows semantic versioning from its first tag.
- **What the engine does not know:** Vs, saves, makeup, profiles, panels, SQLite, Bun, the browser. "Profile" and "pointer" are Studio types built from engine primitives; a project reusing Strata brings its own.

### 1.3 Future adapter: the live game as a remote replica

Not built, not in any slice here, and kept out of G1's scope. The direction: design in the Studio on one screen while the running game updates live on the other, with the runtime bridge as a **two-way edge** of the graph.

- **Game-state source nodes:** the bridge's scene report, V's appearance as the game has it, the in-game XF HUD, ink and (later) ImGui elements' state, the showroom and its lights.
- **Sink nodes:** a sink subscribes to nodes and pushes their effective values into the game as they change: presets, light rigs, face control vectors, HUD layouts.
- **In-game UI** (ink panels, a future ImGui overlay) renders nodes of the same graph, through the same bindings and pointers as Studio panels.

This is **remote graph replication** over a separate process with latency: versioned snapshots, eventual consistency, and conflict rules for edits made on both sides at once (a light moved in game while its rig is edited in the Studio), surfaced and fixed like any other conflict. The DST harness simulates the link's delay, reordering, duplication and disconnection.

What G1 must already guarantee so this stays possible:

- **Identity and versions cross a process boundary:** node IDs are UUIDs (constants have stable string IDs), every node carries a revision, every commit has an ID, an origin (which replica made it) and the base revisions it was made against, and change sets and snapshots are plain serialisable data.
- **Commits are replayable and ordered per node,** so a replica can apply another's commits, detect concurrent edits of the same path by their base revisions, and hand them to a conflict rule.
- **Sources and sinks are one interface pair,** so the bridge adapter is one more source and sink, and the in-memory store's conformance suite applies to a replicated store as well.

## 2. Graph foundations

### 2.1 Nodes and fields

```ts
// strata: public types (sketch)
export type NodeId = string;                      // UUID; constants use "builtin:<type>/<name>"
export type NodeType = string;                    // "preset:eye-makeup", "look", "v", "save", "profile", …
export type NodeRef = { readonly type: NodeType; readonly id: NodeId };
export type Path = readonly string[];             // a field, or a field and map keys: ["layers", "<layerId>", "colour"]

export type FieldKind =
  | { kind: "value" }                                          // atomic JSON value
  | { kind: "ref"; to: NodeType | readonly NodeType[]; clone: "follow" | "share"; follows?: true }
  | { kind: "refs"; to: NodeType | readonly NodeType[]; clone: "follow" | "share"; follows?: true }   // ordered, atomic list
  | { kind: "map"; of: FieldKind };                            // keyed: resolved per key, keys union across layers
export type FieldSpec = FieldKind & { readonly inherit?: false };   // `inherit: false`: identity and bookkeeping, never layered

export interface NodeTypeContribution {
  readonly type: NodeType; readonly owner: ModuleId | "platform"; readonly schema: string;
  readonly fields: Readonly<Record<string, FieldSpec>>;
  defaults(): Record<string, unknown>;
  validate(effective: Readonly<Record<string, unknown>>): readonly Issue[];   // on the resolved value, after layering
  readonly constants?: readonly { id: string; label: string; fields: Record<string, unknown> }[];
}
export type StoredNode = { readonly ref: NodeRef; readonly revision: number; readonly name: string;
  readonly own: Readonly<Record<string, unknown>>;           // only the values this node sets (a tombstone removes an inherited map key)
  readonly layers?: readonly Layer[]; readonly trashedAt?: string; readonly provenance?: Provenance };
export type Layer = { readonly from: NodeRef; readonly role: "base" | "feed"; readonly paths: "*" | readonly Path[] };
```

- **Identity fields never inherit** (`inherit: false`): the node's name defaults from its source but is its own, and export IDs, creation times and provenance are always the node's own.
- **Maps are the unit of fine-grained sharing.** A feature declares which parts of its data are keyed maps. Eye makeup declares its layers as a map by layer ID, so a fork can change one layer's colour and keep following the base's other layers (question Q2). Anything not declared is atomic.
- **References are edges.** A `ref` or `refs` field is an edge to another node. `clone` says whether a deep clone copies the target (`follow`) or keeps pointing at it (`share`). `follows` says whether derivations walk it (a V's `look` does; a V's `origin` save doesn't).

### 2.2 Multiplicity

- Any type can have any number of nodes. Several Vs, looks, presets, views, layouts and profiles all coexist. No service stores "the" V, look, save, layout or view.
- Several nodes may reference one node: two Vs wearing the same look, three looks sharing one eye makeup preset, two views showing one V, two profiles introducing one mod.
- A **profile** holds references (the nodes it introduces, with a role such as `v`, `view`, `layout`, `mod`) and owns nothing. The same V can be introduced by several profiles, and one profile can introduce several Vs.
- **Runtimes follow references.** A runtime (a V's character context and prepared details, a preset's raster jobs and textures, a scene's GPU objects) is created when something visible or bound first needs its node, shared by every consumer and disposed when the last one lets go. Two Vs wearing preset P use P's one set of textures; editing P rasterises once, and both Vs redraw in the same frame.

### 2.3 Resolution

The effective value of node N at path p:

1. N's own value at p, if set (a tombstone means "absent here", which stops the search for that map key);
2. otherwise each **feed** of N, in the order listed, whose paths cover p: that source's **effective** value at p, if it has one;
3. otherwise N's **base**, if any: the base's effective value at p;
4. otherwise the type's default.

For a map field, the keys are the union of the keys found at every step, each key resolved by the same order. Resolution is memoised per (node, path) and invalidated by propagation (§2.5). Validation runs on the effective value, so a fork is always checked as the thing it actually is.

### 2.4 Layering operations

| Operation | Result | Shares with the source afterwards | Typical use |
|---|---|---|---|
| **Reference** | A field of another node points at the source | Everything: it is the same node | Two Vs wear one look; two profiles introduce one mod |
| **Shallow fork** | A new node of the same type with `base: source` and no own values except identity | Every field it hasn't overridden, live | "Like that V, but with a different hair colour"; a new profile from the Default V |
| **Selective feed** | A layer on an existing node taking only chosen paths from a source of the same type | Only those paths, live | "This look's eye makeup follows the evening look's"; "every V's clothing follows this one" |
| **Deep clone** | New nodes with the effective values copied in, no layers, fresh IDs and export IDs, internal references remapped; referenced nodes copied where the field's rule says `follow` (overridable per call) | Nothing | An independent copy to take in another direction |
| **Detach** | Copies every inherited value into own values and drops the layers | Nothing | Freeze a fork before its source changes |
| **Rebase** | Points a fork at another base of the same type | The new base's values | Move a fork onto an updated template |
| **Reset** (per path) | Removes an own value | That path again | Undo an override |
| **Push to source** (per path) | Writes an own value into the node it would inherit from, then resets it | — | Promote a local tweak to everyone sharing the source |

**Rules.**

- **Same type only.** A base or feed source has the fork's type (or a registered compatible schema of it).
- **Layer edges never form a cycle.** At each commit the service walks the new layers' sources (depth-bounded) and refuses a layer that reaches the node itself, with a plain reason ("That V already takes its hair from this one"). Reference edges may form cycles; derivations walk only `follows` edges and stop at a node already on their path, which surfaces as conflict R3 (§4.1) rather than a loop.
- **Constants are layer sources, never targets.** Forking or feeding from a constant is how new work starts; editing a constant is refused, and every "change" to one is offered as fork, clone or override.
- **A source in the trash still resolves.** Forks and feeds keep working and show conflict L1. Purging a node that others layer from or reference first offers **Detach them** or **Point them elsewhere**.
- **Identity is never shared.** A fork or clone gets a fresh UUID and export ID; the export identity of a node is always its own (§3.8).

### 2.5 Change propagation

A commit is a batch of node edits (own values, layers, references, trash). The service turns it into a set of changed `(node, path)` pairs and propagates in one pass:

1. **Along layers.** A reverse layer index maps each source to its dependents and their path masks. A changed `(S, p)` reaches dependent D when D's mask covers p and D has no own value at p; D's `(D, p)` is then changed too, recursively, in topological order.
2. **Along references.** A reverse reference index maps each node to the nodes referencing it through `follows` fields. Derived values of those referrers (a V's resolved appearance, a look's worn set, a mod's identity keys, conflict rules) are marked dirty with the changed paths.
3. **To subscribers.** Runtimes and presentation snapshots subscribe per node. Each is notified once per commit with its changed paths, and redraws only if a path it reads changed.

The cost is proportional to what actually changed and to the fan-out of the touched nodes, never to the size of the database. **Budget:** under 2 ms for a commit touching one preset shared by 20 Vs, with 10,000 nodes and layer chains 8 deep, measured in G1.

### 2.6 Pointers and panel binding

What a panel shows is a wiring, not a service's state.

- A **pointer** is a small node (`pointer`) holding either a fixed reference or a **follow path** from another pointer: `focus.v` follows `focus.view → scene → v`; `focus.preset.eye-makeup` follows `focus.v → look → rows["eye-makeup:own"]`.
- A **panel instance** (in the layout node) has a **binding**: a pointer or a fixed node. By default a profile's panels bind to its focus pointers, so clicking a 3D view makes the Character panel show that view's V and the Layers panel that V's eye makeup preset. **Pin to this** changes a panel's binding to the fixed node, so a second Character panel can stay on V2 while the first follows focus.
- **Several panels of one kind** are instances with their own bindings (the dock's dynamic panel IDs from [view graph P4](view-graph-design.md#61-phases)).
- **Actions carry targets.** Every action names its target node (`{ target: NodeRef }`); a panel dispatches with the node its binding resolved to, and the application refuses a target that no longer exists. Undo acts on the history of the node the focused panel is bound to (§4.4).
- Richer UI nodes (a panel following "the last V I clicked", a comparison layout binding two panels to two looks) are further pointer and binding designs on this same mechanism, answered case by case later.

### 2.7 Storage and the service

- **The engine's graph** (Strata, created by the Studio's composition with its types, rules, sources and store) holds every node's stored form in memory (large preset bodies load on demand), the reverse layer and reference indexes, the resolution cache, derivations, conflicts and the Graph history. It publishes detached snapshots per node and per query, and a change set per commit.
- **The store** is the engine's `GraphStore` interface, implemented by the Studio's SQLite adapter behind the host transport: list, get, commit a batch (revision-guarded per node), trash, restore, purge, versions.
- **Other windows** change the database too: the host bumps a change counter on every commit (and SQLite's `data_version` catches another process); a focused window polls it, reloads changed nodes and propagates. A stale commit gets a plain "changed in another window", and the edit stays in the workspace's recovery copy.
- **Feature code never touches the store.** A feature registers its node types and rules, reads through its facade and edits through its actions.

## 3. Node types

### 3.1 Catalogue

| Type | Holds | References (edge, clone rule) | Constants shipped |
|---|---|---|---|
| `preset:<feature>` | One feature's part (eye makeup look, expression; later hair colour, piercing design, pose) in its part codec, keyed maps declared by the feature; export ID | — | A starter per feature |
| `look` | A combined look: `rows: map<RowKey, ref preset>` | presets (share) | Empty look |
| `v` | A V: `VData` (§3.2); `look` | `look` (follow), `origin` save (share) | Default Vs (§3.3) |
| `save` | A save on disk: `SaveRef`, last fingerprint; `policy` | `policy` (follow) | — |
| `save-policy` | `overwrite: "never" \| "ask" \| "allow"` | — | Baseline *never*; the library's defaults node forks from it |
| `mod` | One installable XF mod: name, key, selectors with preset lists, settings | presets (share) | — |
| `layout` | Dock arrangement per size class, remembered modules, panel instances and their bindings | pointers (follow) | Factory layout |
| `view`, `scene`, `camera`, `lights`, `display`, `tools` | The [view graph's](view-graph-design.md#31-node-types) nodes; a character scene references a V | as the view graph links them; scene → `v` (share) | Default rigs and cameras |
| `pointer` | A fixed reference or a follow path | its target (share) | Focus pointers per profile template |
| `profile` | What the interface anchors to: introduced nodes by role, its layout, its pointers, module overrides, needs | everything it introduces (share by default; §6.8) | The starter profile |

A **subprofile** is any node a profile introduces; the word names a role, not a type.

### 3.2 V (as data)

```ts
export type VData = {
  readonly bodyGender: "female" | "male";
  readonly base: { kind: "default" } | { kind: "save"; saved: SavedV };   // SavedV as today: appearance, loadout, evidence
  readonly choices: map<OptionKey, CharacterChoice>;                    // keyed, so forks override single options
  readonly kept?: Record<string, unknown>; readonly clothing?: ClothingSetting; readonly ownMakeup?: "hidden";
};
```

This is today's character-context state (`StoredCharacter`) with the `SavedV` beside it, as fields of a `v` node. Choices are a map keyed by option, so "like her, but with this hair" is a fork with one own choice. A V from a save carries a copy of the save's decoded appearance, so it is **detached**: it never needs the file again to be shown or edited; its `origin` references the `save` node it came from, for writing back.

### 3.3 The Default V source

- The Default Vs are **constant nodes**, `builtin:v/default-female` and `builtin:v/default-male`: `base: default`, no choices. "Default" means what the game presents by default: the Studio already derives it from the installed creator resource's own defaults per body gender, so the constant holds no appearance data of its own and follows the player's game.
- If the creator presents other defaults (for example per life path), each becomes another constant in the set; the Studio names and chooses the set, as asked.
- New profiles fork, clone or reference a Default V (fork by default, §6.1) unless the player starts from an existing profile. A fork of a Default V stores only what the player changes, and every Reset returns to what the game would show.

### 3.4 Presets and looks

- A preset is one feature's node, autosaved as it is edited. A look is a node that references feature presets by creator row (a row key is the feature type and its target, `eye-makeup:own`, `cheeks:vanilla:makeupCheeks`, the unit the game saves and the [selectors design](selectors-design.md#12-types-targets-and-caps) organises around).
- **Comparing on several Vs:** give each V the same look, or looks that reference the same preset, and open a view per V (§6.3).
- **Versions:** the node's head is mutable; immutable versions are written at the first change of an editing session, before every Build (the manifest records the version built), at most every ten minutes of continued editing, and on **Keep this version**.
- **Trash:** deleting moves a node to the trash, restorable for 30 days; **Delete permanently** acts only there.

### 3.5 Saves

```ts
export type SaveRef = { readonly root: "detected" | "chosen"; readonly folder: string };   // never a path: the saves folder comes from Settings
export type SaveFingerprint = { readonly sha256: string; readonly bytes: number; readonly savedAt: string; readonly gameVersion: number;
  readonly saveVersion: number; readonly presetVersion: number; readonly isMale: boolean; readonly creatorNodeSha256: string };
```

- A `save` node is created the first time the Studio does something with a save: loads its V, writes to it, or the player sets its policy. Merely listing saves creates nothing.
- `creatorNodeSha256` tells "played on since" (harmless: progress is kept when writing) from "her looks were changed at a mirror" (conflict V4).
- A save node records its write history: when, which V, which route, and the hashes before and after.

### 3.6 Save policy nodes

| Node | Is | Effect |
|---|---|---|
| `builtin:save-policy/never` | Constant, `overwrite: never` | The baseline |
| **Save defaults** | One library node, a fork of the constant | Settings › Saves edits it: the default for every save |
| Each save's policy | A fork of Save defaults, created with its save node | The save's own row changes it; **Use the default** resets it |

So changing the defaults changes every save that hasn't been given its own setting, which is layering doing exactly what it is for.

| Policy | Overwrite this save | Write a new save |
|---|---|---|
| **Never overwrite** (default) | Refused, with **Change this save's setting** as the fix | Always offered |
| **Ask me first** | A confirmation sheet each time, listing what changes | Always offered |
| **Overwrite without asking** | Written after the safety checks, no sheet | Always offered |

Every overwrite first copies the save as it was into the Studio's save backups (the last five per save), so **Restore the previous version** is always possible; that copy is not a question put to the player, just what makes "without asking" safe. The offline writer, including overwrite, stays behind the write-back design's gate until its in-game session passes ([§14](../character-customization/save-writeback-design.md#14-batched-in-game-test-plan-one-session)), with one added step: the game loads an overwritten save and lists it correctly.

### 3.7 Profiles

- A profile introduces nodes by role (`v`, `view`, `layout`, `mod`, `look`, module roles such as World's `location`) and holds its pointers, module overrides and **needs** (constraints on what it introduces, for example a masculine-export profile needing a masculine V). Modules contribute needs too: eye makeup, Character, Poses and Expressions need at least one V.
- A profile with no V introduced has V editing off: modules that need a V are unavailable in it, their panels park and their tools withdraw ([view graph §4.3](view-graph-design.md#43-hiding-a-module)).
- Switching profiles is navigation: the workspace's active-profile pointer changes, nothing is edited, nothing asks.

### 3.8 Mods and export identity

| Rule | Detail |
|---|---|
| Mods | A `mod` node is one installable XF mod: its mod-manager name, its key, its selectors (the [selectors design](selectors-design.md#14-document-model)'s, held here) and the presets each offers. By default one mod holds every exportable preset; **Split into a new mod** moves selectors or presets to another. |
| Short IDs | Every preset gets an **export ID** and every mod a **key**: six characters of lower-case Crockford base32 (`0-9a-z` without `i l o u`), random, unique in the library. Forks and clones get their own. |
| In identifiers | Mod `k7m2qd` and preset `p3xv9a`: archive and namespace `xfs_mk7m2qd`, look appearance `xfs_mk7m2qd__xfs_pp3xv9a`, head component `hx_xfs_mk7m2qd_makeup`, depot folder `axefrog/appearance_studio/mods/k7m2qd/`. The [naming contract](../../projects/xf-studio/data/naming.md) is rewritten to this form in slice G6. |
| Chosen IDs | 2–16 characters of `a-z0-9`, for a mod the player publishes. Changing one that was already built says what it costs first: "Players who chose this look in game will need to choose it again." |
| Identity keys | Each mod projects to a set of keys (archive, namespace and option names, `uiSlot`s, appearance and definition names, text keys, component names, depot folders), purely from its fields and its presets' IDs, without building. |
| Deployable units | This library's mods, and the XF mods found installed (the resolver's installation scan, the Studio's build records). An installed build of the same mod node is an earlier version of it, not a conflict. |

## 4. Conflicts, fixes and history

### 4.1 Conflict rules

A conflict is a wiring whose result would be wrong or surprising, produced by a registered **rule** (owner, subject type, severity, the actions it blocks). Nothing blocks switching profiles, changing focus, opening panels, browsing or undoing.

| # | Rule | Severity | Blocks | Fix routes |
|---|---|---|---|---|
| R1 | A reference points at a node in the trash | Warning | Edits through that reference | Restore it; point at another node of its type (each listed); remove the reference |
| R2 | A reference points at a node that no longer exists (purged elsewhere, or a newer build's type) | Blocking where the reference `follows` | The derivations and edits that need it | Point at another node; remove the reference |
| R3 | A derivation walks a circle of references | Blocking | The derived value (a V's appearance that includes itself) | Remove one reference on the circle (a route per edge) |
| L1 | A fork's base or a feed's source is in the trash | Warning | Nothing (it still resolves) | Restore it; detach; rebase onto another node (each listed) |
| L2 | A feed names a path its type no longer has (after a type migration) | Notice | Nothing | Remove the path from the feed |
| P1 | A profile's layout is missing | Warning | Nothing (the factory layout shows meanwhile) | Restore it; use another layout (each listed) |
| P2 | A profile shows a module that needs a V, and introduces none | Blocking | That module's actions | Hide those modules in this profile; introduce a V (each listed, or the Default Vs); use a layout without them |
| P3 | An introduced V doesn't meet the profile's needs (a masculine-export profile with only feminine Vs) | Blocking | The operations the need guards | Introduce a V that meets them; fork a Default V of the needed body; drop the need |
| V1 | A look's row references a preset of another feature, or a V's look is missing | Blocking | Editing that row | Point at a preset of the row's feature (each listed); clear the row |
| V2 | A V's choices name creator options the installation lacks | Notice | Nothing (kept and drawn as saved, today's missing-choice report) | Open the report |
| V3 | A V's origin save can't be found | Warning | Writing back to it | Look in another saves folder (Settings); write to another save; forget the origin |
| V4 | The origin's creator node changed since the V was loaded (changed at a mirror in game) | Warning | Nothing until a write, then asks | **Bring the game's changes in** (re-base: the save's new V as base, own choices kept, overlaps listed); write anyway |
| V5 | A write target's body gender differs from the V's | Blocking | That write | Choose another target (matching saves listed) |
| M1 | A mod lists a preset in the trash or gone | Warning | Nothing (partial export omits and reports it, as today) | Restore it; remove it from the mod |
| M2 | Two presets in one mod share an export ID | Blocking | Building that mod | Give one a new ID (a route per preset) |
| M3 | A V in a profile wears a preset that no mod includes | Notice | Nothing | Add it to a mod (each listed) |
| D1 | Two of this library's mods share an identity key | Warning | Nothing | New key for one (a route per mod); leave it |
| D2 | A mod shares a key with an installed XF mod that isn't an earlier build of it | Warning | Nothing | New key for this mod; leave it |
| D3 | Two deployable mods each carry an XF eye makeup selector (two eye plates may draw in an unknown order) | Warning | Nothing | Move the selectors into one mod; leave out one mod; leave it |
| E1 | A node holds data from a newer build | Notice | Editing it (read-only) | None; kept as stored |

- **Deployment conflicts are warnings** (D1–D3): the Studio says what would happen in game ("Only one of the two would show in the creator") and the player decides. **Leave it** quiets a warning until any node it involves changes.
- **Save policy refusals are capabilities, not conflicts:** "This save is set to never be overwritten" with its one route.

### 4.2 Detection

- Rules are pure functions `evaluate(subject, neighbours) → Conflict[]`, run only for subjects the commit's propagation touched (§2.5).
- D1–D2 use a **key index** (key → owners), updated when a mod or one of its presets' IDs changes; installed mods' keys come from the host once per installation generation.
- A conflict's identity is `hash(rule, subjects)`, stable across re-evaluation, so an acknowledgement or an open fix popover survives unrelated edits.
- Snapshots carry every conflict (sentence, severity, subjects, routes) and a per-node index. **Capabilities consult the index:** an action a blocking conflict covers is refused with reason code `conflict`, its sentence and its routes, and dispatch revalidates.

### 4.3 Fix routes as graph rewrites

```ts
export type FixRoute = { readonly id: string; readonly label: string; readonly consequence: string;
  readonly recommended?: true; readonly patch: GraphPatch };
export type GraphPatch = readonly (
  | { op: "set"; node: NodeRef; path: Path; value: unknown } | { op: "reset"; node: NodeRef; path: Path }
  | { op: "layer"; node: NodeRef; layers: readonly Layer[] } | { op: "create"; type: NodeType; from?: { fork | clone: NodeRef }; as: string }
  | { op: "restore"; node: NodeRef } | { op: "acknowledge"; conflict: string })[];
```

`graph.fix { conflict, route }` checks the conflict still exists with the same subjects and revisions, refuses a patch that would create another blocking conflict (naming it), applies the patch as one commit and records one Graph history step with the route's label. A route needing a choice is one route per candidate, up to six, then **More…**. No fix deletes anything.

### 4.4 History scopes

| History | Covers | Ctrl+Z acts on it in |
|---|---|---|
| Node content (per node) | A preset's part (today's look history, keyed by preset node), a V's choices (today's character history, per V node) | The panels bound to that node; the 3D view acts on the focused view's V and its bound presets |
| View and lighting | As built, per view graph | The Camera & light panel |
| **Graph** (new) | Wiring: references, layers, forks, clones, profiles' introductions, trash, fixes, renames | The profile switcher, the V list, the Saves panel, the Conflicts list, the inspector |

Editing a preset shared by three Vs is one step in that preset's history, whichever V's panel made it. Purging from the trash is the one irreversible action, and says so.

## 5. Deterministic simulation testing

### 5.1 Source nodes

Every source of non-determinism enters the graph as a **source node**: a node whose values and events come from outside. The composition binds each source to a real adapter in the app and to a simulated one in tests; nothing else changes between the two.

| Source | Gives | App adapter | Simulated |
|---|---|---|---|
| `clock` | Wall time, monotonic time, timers (`after`), animation frames | `Date`, `performance.now`, `setTimeout`, `requestAnimationFrame` | Virtual time the scheduler advances |
| `random` | Named, seeded streams: UUIDs, export IDs, jitter | A per-session seed from the platform's cryptographic source | A seed per run, one stream per name |
| `input` | Pointer, keyboard, wheel, focus, file picks and drops, window and theme changes | The DOM adapters (`input-bindings.ts` stays the pure table) | Scripted and generated input |
| `store` | Database reads, commits, change counters, other windows' commits | The SQLite adapter over the host transport | An in-memory store with latency, failures, conflicting writers and crash points |
| `files` | Saves folder listings and bytes, caches, game files through the host | Host endpoints (browser), `node:fs` (host) | An in-memory file tree from fixtures |
| `jobs` | Completion of raster workers, preparation, WolvenKit, bakes, Check and Build | Workers, host jobs and polled host state | Completions the scheduler orders, delays and fails, with results from fixtures or pure fakes |
| `network` | Downloads, update checks | `fetch` | Scripted responses |
| `bridge` | The running game's state, command results and events (and, later, sinks pushing nodes into the game, §1.3) | The runtime bridge client | A scripted game with delay, reordering and disconnection |

**The rule:** application, platform, domain-type and feature code never reads the wall clock, timers, `Math.random`, `crypto.randomUUID`, the file system, `fetch`, browser storage or the bridge directly; only adapter modules implementing a source may. A boundary test scans for these reads (`Date.now`, `new Date(` without an argument, `performance.now`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `Math.random`, `crypto.randomUUID`, `getRandomValues`, `fetch(`, `localStorage`, `node:fs`, the bridge client) outside an allowlist of adapter paths. In the Studio it starts as a ratchet whose offender list may only shrink, and becomes a rule when the list is empty. Inside the engine it is a rule from the first commit.

### 5.2 The simulation harness (in G1)

`strata/testing` ships:

- **A seeded scheduler.** Every pending source event (a timer, a store reply, a job completion, another window's commit, an input event, a crash) sits in one queue. Each step the scheduler picks the next event by a seed-driven policy that explores orderings, delays, repeated retries, failures (a refused write, a failed job, lost host contact) and crash-and-restart (in-memory state dropped, then reloaded from the store and the recovery copy). Given a seed, a run is exactly repeatable.
- **Scripted and generated input.** Scripts for named scenarios (the flows of §6), and generated sequences drawn from the registered actions whose capabilities allow them on the current snapshot, plus some that don't, to check refusals.
- **Invariant checks after every step:**
  1. **No stale derived value:** every memoised effective value, derived node and conflict equals a fresh computation by the reference model from the stored graph.
  2. **Exact undo:** undoing back to any recorded point restores the stored graph byte for byte, and redo returns.
  3. **No silently ignored conflict:** the conflict index equals a full evaluation of every rule; every action a blocking conflict covers is refused with `conflict`; every refusal has a reason code.
  4. **No lost work:** every accepted edit is in the store once acknowledged, or in the recovery copy until then, across crashes; after a restart the effective state equals the last accepted one.
  5. **The person's actions pre-empt background work:** between a user action's dispatch and its first published snapshot no background completion is applied, and a job the action asks for starts before background jobs queued earlier and not yet running.
  6. **Structure holds:** layer edges acyclic, export IDs unique, revisions monotonic, no reference to a type its field doesn't accept.
- **Reproducible failures.** A failing run reports its seed and event trace, and a shrinker reduces the trace to a minimal one. The seed and trace go into the regression list (`tests/sim/regressions.json`), which every suite run replays.
- **Budgets.** The standard suite runs 500 seeds of 200 steps under the memory guard in under a minute; a longer run with more seeds is a separate command for the coordinator's review cadence.

The Studio adds its own invariants on top (a V's resolved request equals a fresh derivation; a preset's published textures match its revision) and simulated sources for its host endpoints, so later slices run whole flows under simulation.

### 5.3 Migrating today's direct reads onto sources

Today's code reads these directly in many places. Across `src/`: 57 files use `Date.now` or `new Date(`, 24 `performance.now`, 70 timers or animation frames, 9 `crypto.randomUUID` or `getRandomValues`, 1 `Math.random`, 25 `fetch`, 68 `node:fs` and 2 `localStorage`. Many are already adapters (host modules reading files, device modules owning frames), and some code already takes injected clocks and IDs (`render-scheduler.ts`, the host pollers' `HostTimers`, `WorkspacePersistence`'s delay, `PartPresetLibrary`'s `newId`). The ratchet classifies each file as an adapter (allowed) or as core code to migrate, and each slice empties the rows it touches:

| Reads | Migrated in | How |
|---|---|---|
| The graph engine, all kinds | G1 | Sources from the first line; a rule, not a ratchet |
| Clock and IDs in the Studio's graph adapters and store | G1 | The engine's `clock` and `random` sources |
| Character context, saved-V and workspace persistence timers, `localStorage` | G2 | `clock`, `store` (the workspace port is already injectable) |
| Saves folder listing and save bytes | G3 | `files` |
| Input bindings, focus and pointer adapters | G4 | `input` |
| Collection service, autosave, preset IDs, raster jobs | G5 | `clock`, `random`, `store`, `jobs` |
| Check, Build and install transports | G6 | `jobs` |
| The bridge client | G7 | `bridge` |
| View graph timing and camera settling | G8 | `clock` |
| The rest of the ratchet (diagnostics, catalogue, choice previews, host pollers) | A cleanup track after G8 | As touched, one module at a time, until the ratchet is empty |

From the page's point of view, host-side services (the resolver, WolvenKit and the package builders) are adapters behind the `files` and `jobs` sources. Giving the host's own internals simulated file systems is a later, separate track.

## 6. Flows

### 6.1 First run with the default V

1. A new library: the migration finds nothing, and the starter profile is created from its constant: it forks `builtin:v/default-female` into "My V", introduces one main view whose scene shows her, forks the factory layout, creates focus pointers and one mod ("XF Eye Artistry", key drawn).
2. The first paint needs nothing from the database: the workspace carries the active profile's wiring as a cached mirror, and the database confirms it moments later (the load-time goal).
3. "My V" stores nothing until changed; her creator rows all say "Default" and Reset returns to the game's default.

### 6.2 Loading a save and making its V the one being edited

1. The **Saves panel** (the converged Save Explorer, §8.3) lists every save, newest first, with its screenshot, level, life path, location and the Vs that come from it.
2. **Edit this V** creates (or reuses) the `save` node, creates a V node with `base: save` and `origin` set, introduces it into the active profile, and points the focused view's scene at her, so she is the V being edited. One Graph step.
3. If a V already comes from this save, the row offers **Show <V name>**, **Bring the save's changes into <V name>** (V4's re-base) and **Load again as a new V**.
4. Several saves can be open at once; each can make its own V. The node explorer stays a research tool.
5. The Character panel's **Load a save** opens the same list, so there is one way to load a V.

### 6.3 Several Vs, flicking and comparing

- **Flick:** the V list switches which V the focused view's scene references. Each V keeps its own content history.
- **Compare side by side:** **Show in a new view** on a V opens a view of her beside the others ([view graph](view-graph-design.md) P4). Give both Vs the same look (or looks referencing the same preset): a change to the preset shows on both at once, because both reference it and one raster serves both.
- **Instant after the first time:** prepared details are cached by the host per request fingerprint; the device keeps the details of recently shown Vs referenced for a grace period (target: under 150 ms to a previously prepared V's first complete frame).

### 6.4 Writing back: a new save, or overwriting by policy

| Route | What happens | Available |
|---|---|---|
| **Apply in game** (first) | The runtime bridge applies the V's creator choices at the mirror or ripperdoc screen; the player confirms and saves | With the bridge and the appearance screen open (write-back phase A) |
| **Write a new save** | A new save folder beside the target (the next `ManualSave-<n>`), holding the target's progress with this V's creator node; the target untouched | Always, after the offline gate |
| **Overwrite this save** | The target itself, after its copy is kept in the Studio's save backups | By the target's policy (§3.6), after the offline gate |

Targets: the V's origin (default) or any save of the V's body gender (V5). Enforced in the domain action (`v.writeSave`), never only in the UI: the identity test (no choices → the target's own node, byte for byte), exact save and preset versions (269 and 12 today), a temporary file then rename, a re-read verifying every other node unchanged, a summary of changes and of the mods whose options are written, a cloud-sync line, and a write record on the save node. V4 asks before writing to an origin whose looks changed in game.

### 6.5 Presets in the database, shared by several Vs and profiles

1. **New preset** creates a node at once with its feature's starter and an export ID, and points the focused look's row at it. There is no Save button: edits autosave, debounced (about half a second after the last change, at once at a commit point such as a gesture's end).
2. Until the database acknowledges a write, the workspace keeps a recovery copy, so nothing is lost if the window closes.
3. The Presets panel lists the library's presets of its bound feature with always-visible filter chips: **Worn here**, **In this mod**, **All**, **Trash**; each row says where it is used ("Worn by 2 Vs in 2 profiles · in XF Eye Artistry").
4. **Make a variant:** Fork (follows the original except what you change), Clone (independent copy), or feed selected layers from another preset. Inherited values show their origin in the panels (§8.5).
5. **Export to a file** and **Import** stay in each list's menu: secondary, never needed to keep work.

### 6.6 Export with short IDs and deployment warnings

1. The Mod package panel is bound to a mod (the profile's introduced mod by default).
2. **Check** plans the mod as a package-only collection built from the mod node, as expression sets already are (`setCollection`, `part-preset-sets.ts`), with identity from the mod key and preset IDs. The pipeline after planning is unchanged.
3. The panel's **Identity** section shows the key and each preset's ID, editable. M2 (blocking) and D1–D3 (warnings) show before Check is pressed, from the key index.
4. **Build** records each preset's version in the manifest; a placed build's keys join the deployment index.

### 6.7 Switching profile

The profile switcher moves the workspace's active-profile pointer. The presentation applies the profile's layout (panel instances with their bindings), module visibility and pointers; the views show the Vs they reference, prepared on demand while the previous content stays on screen. Conflicts of the profile show at once in the switcher and the header indicator; nothing blocks the switch.

### 6.8 Making profiles distinct: reference, fork, clone

**New profile ▸ from this one** shows, per introduced node, the three choices as a button set, with defaults (question Q1): presets, looks and mods **referenced** (the work stays shared), Vs, views, layouts and pointers **forked** (the new profile can rearrange and restyle without disturbing the old one, and still follows what it doesn't change). **New profile ▸ from Default V** forks a Default V and the factory layout. Later, any introduced node's menu has **Make distinct here ▸ Fork · Clone**, which forks or clones it and re-points only this profile's reference.

### 6.9 A world-editing profile with V editing off

**New profile ▸ For world editing** (a constant the World module contributes once it exists) introduces no V, a layout showing World, and a view whose scene is a `location` ([view graph §3.10](view-graph-design.md#310-modules-that-are-not-about-v)). Character modules are unavailable; showing Eye makeup anyway raises P2 with its routes. Switching back to a character profile restores its Vs, views and panels exactly.

## 7. Mapping to today's code, and migration

### 7.1 Singletons to remove

These modules assume one V, one save, one live look, one surface or one subject. A ratchet test (`tests/graph-singletons-audit.test.ts`) lists them and may only shrink, as the view graph's audit does.

| Today | Singleton | Becomes |
|---|---|---|
| `CharacterContextActions` (`character-context-actions.ts`) | One character context, one history | A runtime per V node, created on demand; `character.*` actions gain a `target` V |
| `SavedAppearanceActions`, the workspace's `savedV` | One saved V | The V node's `base.saved`; `savedV.load` becomes `v.fromSave { save }` |
| The live document (`collection-workspace.ts`, `DocumentModel.live`, the eye makeup facade's `view()`) | One live look being edited | An editing session per preset node, opened by whatever binds it; the facade's reads and actions take the preset target |
| `STUDIO_LAYERED_SURFACES` and `liveSurface` ([view graph §2.7](view-graph-design.md#27-preview-jobs)) | One layered surface | Raster jobs per preset node and revision, shared by every V wearing it |
| The scene host's one subject | One V drawn | View graph P3's `SceneRuntime` per scene node, each referencing a V node |
| The Save Explorer's one `open` save | One open save | A list of open saves (session), each with its `save` node when used |
| `PreviewActions` defaulting to the focused view | Implicit target | Already takes an optional view; the view's nodes are graph nodes (G8) |

### 7.2 What changes

| Today | Becomes |
|---|---|
| Collection drafts and Save / Save copy / Open (`collection-service.ts`, `collection-workspace.ts`) | Autosaved preset, look and mod nodes; per-node editor memory and Undo stay in the workspace; the recovery queue stays for unacknowledged writes |
| `CollectionLibrary` (`collection-store.ts`) | Read once by the migration; its tables untouched |
| `PartPresetLibrary` and sets (`part-preset-store.ts`, `part-preset-sets.ts`) | Preset nodes of every feature; sets become mod nodes |
| Layout library (`layout-library.ts`, `UIPreferences.layouts`) | Layout nodes with panel instances and bindings; the workspace keeps the live arrangement |
| View graph (`platform/core/view-graph.ts`, workspace `views`) | Its node types registered in the graph and stored in the database (G8); its link and unlink become reference and fork or clone |
| Package plan (`platform/core/package-plan.ts`) | Mod nodes (one product each) |
| Export names (`features/eye-makeup/export`, `features/expressions/export`) | From the plan's identity (mod key and preset IDs); no UUID-derived names |
| Selectors design (proposed) | Selectors are held by mods; what a V wears is her look; activation is a pointer |

**New code:** the engine package `projects/strata/` (§1.2); in the Studio, `platform/graph-adapters/` (the SQLite store and host transport, Bun and browser sources, later the bridge), `platform/graph-types/` (`v`, `save`, `save-policy`, `look`, `mod`, `profile`, `layout`, `pointer`, export identity and their rules), and the presentation port's `graph` facade.

### 7.3 Storage and migration

**Tables** (new, `CREATE TABLE IF NOT EXISTS`, `user_version` left at 2 because alpha.2's stores refuse any other; no column added to a released table, because today's code and alpha.2 insert into `part_presets` positionally):

| Table | Holds |
|---|---|
| `library_info(key, value)` | Library UUID; the migration record (what was read from which revisions, the old-to-new identity map) |
| `nodes(type, id, name, revision, schema, own, layers, trashed_at, provenance, created_at, updated_at)` | Every node; `own` and `layers` as JSON |
| `node_versions(type, id, revision, schema, own, layers, created_at, reason)` | Kept versions |
| `export_ids(id PRIMARY KEY, kind, node)` | Unique export IDs and mod keys |
| `save_backups(save, taken_at, sha256, file)` | The copies kept before overwrites (files in the Studio's data folder) |

Presets move into `nodes` like everything else; `part_presets` and the collection tables are read by the migration and never written again by this build.

**Migration: runs once per library, lossless, no legacy identities.**

| Source | Becomes |
|---|---|
| Each collection's latest revision | A mod node with the **same UUID** (so the install host still recognises its installed build as the same mod and replaces it), a new key, its name, selector settings and package-plan choices; a multi-product plan becomes one mod per product |
| Each look | A preset node with the look's UUID and a new export ID, in that mod's selector in the same order; its other parts (an expression tried on it) become presets of their own, referenced with it by a look node named after it |
| Earlier revisions of each look | Its kept versions |
| Removed presets and recovery drafts | Nodes in the trash |
| Expression presets and sets | Preset nodes (same UUIDs, new export IDs) and mod nodes |
| The workspace's `savedV` and `preview.character` | A V node ("My V", or "V from <save>" with a `save` node when the save is found), wearing a look of the selected preset |
| The workspace's layouts and view graph | Layout nodes and view graph nodes |
| The workspace's unsaved collection draft | Applied to the migrated presets as their first autosave, each marked "brought in from your unsaved draft" |

**Gates and safety.**

- **Before writing**, the library is copied to `library.pre-graph.sqlite` beside it (kept until removed from Settings), and the migration runs as a dry run: counts of collections, looks, versions, sets, presets and workspace entries read versus planned. A mismatch writes nothing; the Studio keeps the legacy panels and reports the problem through Report a problem.
- **Lossless round trip:** every migrated preset's part serialises to the same canonical bytes as its source row (the platform §2 parity gate: identical `raster()` masks at 512, 1K and 2K and identical compiled presets).
- **Equivalent export:** a migrated collection builds the same files and contents as before under the new names (`tools/compare-package-candidates.ts` with the migration's identity map).
- **The names change once, and the Studio says so:** the first Build after migration notes that the mod's in-game names changed with this version, so a look chosen in game with an earlier build must be chosen again, and **Add to my mod manager** replaces the earlier build of the same mod rather than installing beside it.
- **Alpha.2 still opens the library,** seeing its collections as they were before migration (a test runs alpha.2's vendored stores on a migrated fixture). If alpha.2 later saves a newer collection revision, the new build offers **Bring in changes from the older XF Studio**, per look, keeping the replaced head as a version; it never merges silently.
- **Workspace downgrade:** the workspace keeps writing its legacy fields as mirrors of the active profile's focused V, live layout and focused mod's presets, so alpha.2 opening it shows the same V, layout and looks; the new `graph` session block is written only when it differs from what the mirrors imply.

### 7.4 Automatic database backups

The database is the only home of the work, so it is backed up without asking: SQLite's online backup into a `backups` folder beside it at the first start of each day and before every migration, keeping seven daily and four weekly copies. Settings has **Restore a backup…** with each copy's date and counts.

## 8. UI surfaces (specified for the UI track)

Functional specifications: the UI component track builds or extends the components with style-guide entries and light, dark, narrow and wide captures, and the UI design lead reviews them. Every surface shows its options as lists and button sets rather than dropdowns.

### 8.1 Profile switcher

- The header's leading slot shows the active profile's name (icon alone when narrow). Its menu lists every profile as a row (name, a summary line "2 Vs · Layout: Makeup · XF Eye Artistry", a conflict marker), then **This profile** as sections: its introduced Vs, its layout (the layouts as rows), its mod; then New profile ▸ (from this one, from Default V, the module-contributed templates), Rename, Delete.
- The saved-layout choice moves into this menu, since a layout is part of a profile; its palette commands stay.
- Switching shows its effect at once; a profile with conflicts opens with them visible, never with a dialog.

### 8.2 V list

- A shell panel `graph.vs` in the `inspect` slot, and a V chip in each 3D view's header opening it as a popover for that view.
- Two groups: **In this profile** and **In your library**, with **Start from** (the Default V constants). Each row: name, source line ("From ManualSave-12 · level 34 · Nomad", "Fork of Default V (feminine)"), usage ("In 2 profiles · shown in 1 view"), badges only when something needs attention.
- Clicking a row shows her in the view the list was opened for (the focused view from the panel). The row's menu offers only what applies: Show in a new view, Add to this profile, Make distinct here ▸ Fork · Clone, Reset to the Default V, Write back…, Show her save, Rename, Delete.
- Keyboard: list pattern; next and previous V bindings in the [input bindings](input-bindings.md) catalogue.

### 8.3 Saves panel

- A shell panel `graph.saves`, the Save Explorer's panel converged. It shows the saves folder in use and every save, newest first: thumbnail, kind, level, life path, location, time, the Vs from it, and its overwrite policy when not the default. **Open** groups the saves opened this session.
- Per save: **Edit this V** (primary) or **Show <V>**; **Write a V here…**; the policy as a three-button set (Never overwrite · Ask me first · Overwrite without asking) with **Use the default**; **Explore** (research tools only).
- The write sheet: the route as a button set (Apply in game · Write a new save · Overwrite this save, the last disabled with its reason under a *never* policy), the target, the plain summary of changes, the safety line, one confirm button named for the action. Progress in place; the result names the new or overwritten save and offers **Restore the previous version** after an overwrite.
- Settings › Saves holds the defaults node's policy as the same three-button set.

### 8.4 Conflict indicators and fix affordances

- **Header indicator:** a fixed-width slot (never shifting layout) with a count badge coloured by the worst severity, opening the **Conflicts list**: Blocking, Warnings, Notices; each item's sentence, subjects as links, and routes as buttons with consequence lines, the recommended one first; **Leave it** on warnings.
- **In place:** list rows carry a marker with the sentence in its tooltip; a blocked action's disabled reason shows the sentence with a **Fix…** affordance beside the control. After a fix, the notice names it with **Undo**.
- **Component asks:** `ConflictBadge`, `ConflictItem`, `FixRouteButton`, `EntityRow` (name, source line, usage, badges, marker, row menu).

### 8.5 Layering affordances

- **Field origin marker** (`FieldOrigin` component): beside any control whose value is inherited, a small marker says where it comes from ("From Default V", "Fed from Evening look"). An overridden value shows a distinct mark. The control's menu offers only what applies: **Reset to inherited**, **Edit <source>** (rebinds the panel to the source), **Push to <source>**, **Override here** (for a value edited while inherited, the default action of editing is to override here; editing the source is the explicit choice).
- **Distinctness chooser** (`ShareModeChooser`): Reference · Fork · Clone as a three-button set with one consequence line each, used by New profile, Add to profile, Make distinct and Make a variant.
- **Feed editor**: on a node's menu, **Take values from ▸** a node of its type, then the paths as a checklist tree (for a V: creator sections and rows; for eye makeup: its layers), in the list the feed will resolve in.

### 8.6 Graph inspector

An optional panel, `graph.inspector`: a developer's diagnostic view and an **Advanced** view for players who want to see how everything is wired. Listed under Modules › Tools (Preview stage, hidden by default).

- **Content:** a tree list of everything in the graph or available to it, grouped **In your library** (profiles, Vs, looks, presets by feature, mods, layouts, views, saves and policies, pointers, the trash), **Available** (saves on disk, installed XF mods, constants, registered features and modules) and **This session** (the active profile, open saves, focus). With *Show research tools* on: derived values (a V's request fingerprint, identity keys, requirement sets), stored `own` and `layers`, revisions and rule IDs.
- **Rows:** type (icon and label), name, ID and export ID, usage count, layer mark (fork, fed), conflict marker. Expanding shows **Uses**, **Used by**, **Based on**, **Feeds from** and **Fed into**, each child a link.
- **Type-aware actions:** the context menu lists only what can be done to that node, from the application: Switch to (profile), Show in a view (V), Wear or Add to mod (preset), Edit this V (save), Fork, Clone, Detach, Rebase, Restore or Delete permanently (trash), Reveal in its panel, Copy ID, the node's fix routes.
- **Search and filters:** one field over name, type, ID and export ID, origin save, mod, profile membership and wiring, plus always-visible facet chips that combine: type, feature, "in the active profile" (reachable from it), "has conflicts" (by severity), "unused" (nothing references it), "orphaned" (references to missing nodes), "forked" or "fed", "from a save", "newer build". Typed facets work too (`type:preset used:0`, `origin:ManualSave-12`, `id:k7m2qd`, `uses>2`, `depth>3`).
- **Smart behaviour:** **Show what depends on this** (transitive referrers and layer dependents); **Highlight conflicts** along the paths from the active profile; **Focus the active profile**; **Unused presets** with a bulk **Move to the trash** (one Graph step).
- **No coupling:** the panel calls `port.graph.inspect(query) → InspectorPage` (the application builds the index and returns detached rows and edges, paged 200 at a time), `port.graph.actionsFor(ref) → ActionOffer[]` (each with its capability) and `port.graph.dispatch(action)`. It never receives the store, the service or an editable body; research-view bodies are detached JSON copies. The index is built when the panel is first shown and withdrawn when it is hidden.

### 8.7 Changes to existing panels

- **Presets panel:** bound to a feature and a look row (by default the focused V's); the chips of §6.5; New, Make a variant (the chooser), Wear, Add to mod, Export to a file.
- **Mod package panel:** bound to a mod; the other mods as rows; **Identity**; **Split into a new mod**.
- **Character panel:** bound to a V (focus by default, pinnable); origin markers on inherited choices; Load a save and Default V open the shared lists.

## 9. Phased implementation plan

Each slice leaves `main` green (suite, typecheck, browser and desktop builds, their gates) and is testable on its own. Effort in agent-days.

| # | Slice | Scope | Tests and gates | Effort | Needs |
|---|---|---|---|---|---|
| G1 | **The graph engine, then the Studio's store on it** | **Stage 1, the engine package** (`projects/strata/`): node types with field specs (value, ref, refs, keyed maps, `inherit: false`), constants, references and the reverse reference index, layers (base and ordered feeds with path masks) and the reverse layer index, resolution with memoisation, the layer-cycle refusal, batched commits and propagation, fork, feed, deep clone with per-field rules, detach, rebase, reset, push to source, trash semantics, the conflict and invariant framework with fix routes, history, source and sink interfaces with simulated implementations, the storage interface with an in-memory store, the inspector data model and query language, `strata/testing` (seeded scheduler, scripted and generated input, invariants, shrinker, regression replay), README, API surface snapshot and the minimal example. **Stage 2, the Studio on it:** the SQLite store adapter and host transport (`nodes` tables), Bun and browser clock and random sources, pointers and follow paths as Studio types, rules R1–R3 and L1–L2, automatic backups and Restore, the inspector's read-only developer view, and the ratchets (singletons, direct reads) with their starting lists | **Engine:** property tests against a brute-force reference model on random graphs of synthetic types (up to 200 nodes, layer chains 8 deep, several feeds per node, map tombstones): effective values equal the naive resolver's after every random operation sequence, propagation reports exactly the (node, path) pairs whose effective value changed, and Undo of every operation restores the stored graph byte for byte. Named cases: 20 nodes referencing one node get one notification each per commit; a fork follows its base until overridden; a feed takes only its paths; a three-level fork of a fork of a constant; a layer cycle is refused and a reference cycle raises its conflict; a clone is independent and remaps internal references; purging a layer source offers detach. **Simulation:** 500 seeds of 200 steps with delays, reordering, failures and crash-restart, all six invariants after every step; a deliberately injected propagation bug is found and shrunk to a minimal trace, which then replays as a regression. **Boundaries:** the engine imports nothing outside its folder and reads no clock, randomness, file, network or host global; the API surface snapshot; the example runs. Budget: a commit touching one node shared by 20 others under 2 ms with 10,000 nodes. **Studio:** the store adapter passes the engine's store conformance suite (the same tests the in-memory store passes); Studio code imports only the engine's entry points; alpha.2's vendored stores open a library with the new tables | 10 (7 + 3) | — |
| G2 | **V nodes and the Default V source** | `v` type and `VData`; the Default V constants; the character runtime per V node (the singleton ratchet's character rows emptied); `character.*` with targets; several Vs in a profile, flicking in the focused view; the V list and chips; origin markers in the Character panel; first-start migration of the workspace V; legacy mirrors | Codec and layering tests on `VData` (a forked V overriding one option); two V runtimes alive at once with independent histories; mirror read by the alpha.2 workspace reader; flick timing on the reference save in `?verify=1` | 5 | G1 |
| G3 | **Saves and save policies** | `save` and `save-policy` types, the baseline constant and Save defaults; the Saves panel (converged Save Explorer, several open saves, Edit this V, Show, Bring changes in, Load again); fingerprints in `saves-server.ts`; policy controls; V3 and V4 | Policy resolution through the default (changing the default changes un-overridden saves only); fingerprint tests on synthetic saves (never private ones); re-base keeps own choices and lists overlaps; `?verify=1`: two saves open, two Vs | 3 | G2 |
| G4 | **Profiles, pointers and panel binding** | `profile`, `layout` and `pointer` types; panel instances with bindings; focus pointers and follow paths; Pin to this; the profile switcher with layouts folded in; New profile with the distinctness chooser; module needs; P1–P3; the conflict indicator, list and in-place Fix | Binding tests: two Character panels on two Vs, focus changes only the unpinned one; pointer follow updates on a scene rewire; rule tests with each route applied and undone; capability refusals carry `conflict`; boundary: actions carry targets, `studio-ui` reads only `port.graph`; `?verify=1`: a profile without a V showing Eye makeup, fixed each way | 6 | G2 |
| G5 | **Presets and looks in the database** | Preset and look nodes, autosave with revision guards and the recovery copy, versions, trash; editing sessions and raster jobs per preset node (the live-document and single-surface rows of the ratchet emptied); eye makeup's layers declared as a keyed map; the Presets panel; Make a variant; the lossless migration of collections, sets and drafts with its dry run and pre-migration copy; M1 and M3; file export and import | The parity gate on every migrated preset; migration fixtures (collection-1, collection-2, a multi-product plan, expression sets, an unsaved draft, removed presets); two Vs wearing one preset get one raster per edit; a fork overriding one makeup layer follows the base's other layers; alpha.2 reads the migrated library; autosave crash recovery; write load under one database write per 500 ms during a long gesture | 7 | G1, G2 |
| G6 | **Mods and export identity** | `mod` type with keys and selectors; export IDs; identity projection and the key index; installed XF mods' keys from the installation scan; M2 and D1–D3; the Identity section and Split; exporters named from the plan's identity; the naming contract and the [pipeline guide](studio-to-mod-pipeline.md) (with its diagram review) rewritten | Equivalent builds of migrated collections under the identity map; new-identity builds pass the independent verifiers; key projection equals each built inventory's names; "an earlier build of the same mod is not a conflict"; the install host replaces the pre-migration build | 5 | G5 |
| G7 | **Write-back** | `v.writeSave` with new-save and overwrite routes by policy, save backups and Restore; Apply in game on the bridge (write-back phase A); the write sheet; V5. The offline writer (phase B) behind a developer flag until the write-back session passes | Phase A: the bridge-driven session step R1. Phase B: the identity test and post-write checks on synthetic saves, policy refusals, backup and restore of an overwritten synthetic save; then the batched in-game session W0–W3 with the overwrite step | 5 (A) + 4 (B, gated) | G3, G4 |
| G8 | **The view graph joins the graph** | View, scene, camera, lights, display and tools as graph node types stored in the database (camera navigation debounced and not versioned); link and unlink as reference and fork or clone; a scene per V; **Show in a new view** for side-by-side Vs | The view graph's own tests on the new store; two views of two Vs sharing one preset redraw from one raster; the P4 GPU probe | 4 | G2, [view graph](view-graph-design.md) P3–P4 |
| G9 | **Inspector, advanced view** | Search facets, type-aware menus, dependents, highlighting, active-profile focus, unused and orphaned presets with bulk trash | Pure query tests (each facet and combinations, paging); `?verify=1` walkthrough; UI review | 2 | G4, G5 |

About **47 days** in all, plus 4 for the gated offline writer and a cleanup track that empties the direct-read ratchet (§5.3). G3 and G4 run in parallel after G2; G5 can run beside them once G2 lands; G6 follows G5; G7 needs G3 and G4; G8 waits for view graph P3–P4; G9 last. Every UI change goes through the UI/UX review gate.

**Boundary rules to add** (each shown to fail on an injected violation):

1. The engine (`projects/strata/`) imports nothing outside its folder and reads no host or DOM global; the Studio imports it only through `strata` and `strata/testing`.
2. Only the graph writes nodes; no feature, device or presentation module imports the store adapter.
3. No clock, timer, randomness, file, network, browser-storage or bridge read outside adapter modules (the direct-read ratchet, §5.1).
4. `studio-ui` reads the graph only through `port.graph` (snapshots, `inspect`, `actionsFor`, capabilities).
5. Every action that edits a node carries its target; no application service holds an implicit current V, look, preset, save, surface or subject (the singleton ratchet, emptied slice by slice).
6. Every node type, field, clone rule, conflict rule and constant names a registered owner; a golden snapshot guards their IDs.
7. Conflict blocks are enforced in capabilities, and fix routes change the graph only through `graph.fix`.
8. Nothing outside the V service reads or writes the workspace's legacy V fields.
9. Exporters take names only from the plan's identity.

**Risks.**

| Risk | Mitigation |
|---|---|
| Layering is subtle and wrong answers are silent | The brute-force reference model, property tests and seeded simulation in G1 before anything uses it; origin markers so every inherited value is visible |
| The engine drifts into Studio specifics | Its own package, boundary test and API snapshot; its minimal example must keep running without any Studio code |
| Simulation drifts from reality | Sources are the only seam, so app and test run the same code; the store adapter passes the same conformance suite as the simulated store |
| Several Vs and views cost memory and GPU time | Runtimes per node shared by reference; one raster per preset revision; the view graph's frame budget and hidden-view pause; details released after the grace period |
| Migration loses work | Additive tables; source rows never rewritten; a pre-migration copy and backups; a dry run with counts; the parity gate |
| Names change for players of earlier builds | Said once at the first Build; the install host replaces the earlier build; nothing is released yet beyond alphas |
| Autosave pressure and concurrency | Debounce and commit points; WAL; revision guards; the recovery copy; the write-load test |
| An overwrite damages a save | Never by default; per-save opt-in; a copy kept first; the identity test, version gate and re-read; the offline writer gated on the session |
| Panels feel unpredictable with several Vs | Focus pointers as the default binding; Pin to this; every panel header names the node it shows |
| Profiles add friction for someone who only wants makeup | One starter profile, never required; nothing asks on switch |

**How later domains plug in.** A new V feature registers a preset type (with its keyed maps) and a selector type: its presets are worn through looks and exported by mods. Body customisation extends `VData`. World editing registers `location` and a profile role; a quest editor registers `quest`. Lighting setups become a node type shared across profiles. A **system profile** (a constant-backed node saying where the database and configuration files live) can arrive when a second database is wanted. Each adds registrations and `compose/` entries only, the platform's acceptance test.

## 10. Proposed architecture-contract addition

For [the architecture contract](architecture-contract.md), under "Ownership and dependency direction", to apply after review:

> **The graph engine and deterministic sources.** Studio state that people create, share or wire lives in the graph, built on the standalone graph engine (`projects/strata/`), which imports nothing from the Studio and is used only through its public entry points (`strata`, and `strata/testing` in tests). Adapters (SQLite storage, Bun and browser sources, the bridge) implement the engine's interfaces; Studio domain types (V, presets and looks, saves and policies, profiles, layouts, pointers, mods) are registered through its API; features register their own types and rules; the presentation reads only detached snapshots, queries and capabilities through `port.graph`. Every action names the node it targets; no service holds an implicit current V, look, preset, save or view. Every source of non-determinism (clock and timers, randomness and IDs, input, storage, files, jobs and workers, the network, the game bridge) enters as a source node that the composition binds to a real adapter in the app and a simulated one in tests; only adapter modules may read them directly (boundary tests enforce both rules), and new behaviour ships with a seeded simulation of its flow whose invariants hold after every step.

## 11. Open questions, with recommended defaults

| # | Question | Recommended default |
|---|---|---|
| Q1 | **New profile from this one:** what does each introduced node become by default? | Presets, looks and mods **referenced** (the work stays shared); Vs, views, layouts and pointers **forked** (the new profile can rearrange and restyle, and still follows whatever it doesn't change). The chooser shows and changes each. |
| Q2 | **Fine-grained sharing inside a preset:** should eye makeup's layers be a keyed map from the start of G5, so a fork can change one layer and keep following the others, or should a preset's part stay one atomic value at first? | **Keyed by layer from G5.** It is what makes forks useful for makeup; each layer stays atomic inside. |
| Q3 | **Editing an inherited value in a panel:** does it override on this node (the source unchanged), or edit the source for everyone? | **Override here**, with **Edit <source>** and **Push to <source>** one click away, so shared work never changes by accident. |
| Q4 | **Replayable problem reports:** should Report a problem include the session's random seed and a bounded trace of source events (event kinds, timings and node IDs; no file contents, save data or paths), so a reported bug can be replayed in the simulation harness? | **Yes, as a listed item of the report the person can untick,** like every other item; the trace window is bounded and redacted with the diagnostics rules. |
| Q5 | **The engine's name:** Strata (working name), or another neutral name? | **Strata**; renaming is cheap until its first tag. |

## Related pages

- [Architecture contract](architecture-contract.md) and [presentation boundary](ui-architecture-boundary.md): the layers and exceptions this design follows
- [Feature-module platform](feature-module-platform.md): parts, the document model and export
- [View graph design](view-graph-design.md): its nodes join this graph in G8
- [Selectors design](selectors-design.md): selectors, now held by mods
- [UI workspace preferences](ui-workspace-preferences.md): the workspace record that keeps the live layout
- [Save files](../../knowledge/save-files.md), [save import](../eye-artistry/save-import.md), [save write-back design](../character-customization/save-writeback-design.md) and [save editor design](../save/save-editor-design.md): what a save is and how writing stays safe
- [CC controls and presets](../backlog/cc-controls-and-presets.md): the character context a V node holds
- [1.0 readiness](../../docs/release-readiness.md) and [where XF Studio is going](../../docs/vision.md): why this is 1.0 connective tissue, and the domains it must extend to
