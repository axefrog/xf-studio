# XF Strata engine specification

**Version 0.1 (draft), 29 September 2026.** This document is the normative, language-neutral statement of the XF Strata engine (Strata for short): its execution model (streams, demand, node kinds, cycles, drivers and processes, cancellation, errors), its entity layer (event-sourced nodes, layering, undo, snapshots, compaction, actors and conflicts) and its data formats. Two implementations are planned: the TypeScript engine in this package, and a native engine for the game side (a C++ kernel in the runtime bridge's RED4ext plugin, with redscript and CET as thin adapters). Both MUST pass the conformance vectors in [`conformance/`](conformance/).

The design rationale lives in the Studio's [profiles and graph design](../../research/authoring/profiles-and-graph-design.md) (§1.4 is the execution model); where the two differ on the execution model or the formats, this specification wins.

## Contents

1. [Conventions](#1-conventions)
2. [Data model](#2-data-model)
3. [Streams and entries](#3-streams-and-entries)
4. [Demand](#4-demand)
5. [Node kinds](#5-node-kinds)
6. [Cycles: the START/END protocol](#6-cycles-the-startend-protocol)
7. [Errors are values](#7-errors-are-values)
8. [Cancellation tokens](#8-cancellation-tokens)
9. [Drivers and processes](#9-drivers-and-processes)
10. [Models, the erector and operators](#10-models-the-erector-and-operators)
11. [Entity streams](#11-entity-streams)
12. [Layering resolution](#12-layering-resolution)
13. [Layering operations](#13-layering-operations)
14. [Undo, redo and revert](#14-undo-redo-and-revert)
15. [Snapshots and upcasting](#15-snapshots-and-upcasting)
16. [Compaction and purge](#16-compaction-and-purge)
17. [Actors, provenance, trust and disagreement](#17-actors-provenance-trust-and-disagreement)
18. [Conflicts](#18-conflicts)
19. [Stores](#19-stores)
20. [Sources and determinism](#20-sources-and-determinism)
21. [What implementations may choose](#21-what-implementations-may-choose)
22. [Conformance vectors](#22-conformance-vectors)
- [Appendix A. Examples (non-normative)](#appendix-a-examples-non-normative)
- [Appendix B. The TypeScript mapping (non-normative)](#appendix-b-the-typescript-mapping-non-normative)

## 1. Conventions

1.1. The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY and OPTIONAL are to be interpreted as described in RFC 2119 and RFC 8174 when, and only when, they appear in capitals.

1.2. Data is described in JSON terms (RFC 8259): *null*, *boolean*, *number*, *string*, *array*, *object*. "A record" means a JSON object with the listed members; members not listed MUST be ignored by readers unless a section says otherwise, and writers MUST NOT emit members this version doesn't define except under a name beginning with `x-`.

1.3. "An implementation" is software claiming conformance. "The host" is the program embedding it. "An adapter" is host code implementing an interface this specification defines (a store, a source).

1.4. Numbers in entries MUST be finite. Integers used as sequence numbers, positions and counters MUST be exact up to 2^53 − 1.

1.5. Non-normative text is marked *Note*, or sits in an appendix.

## 2. Data model

2.1. **Plain data.** Every value that crosses a node boundary (entry values, demand specs, models, errors, process states) MUST be plain data: representable as JSON without loss. Implementations MUST NOT place functions, handles or host objects in entries. A reference to a live node, where data needs one, is the record `{ "$node": <node id> }`.

2.2. **Canonical form.** The canonical serialisation of a value is JSON with object members sorted by the code points of their names, no insignificant whitespace, and numbers in the shortest form that round-trips. Two values are **equal** exactly when their canonical forms are identical. Members whose value is absent are not members; implementations MUST NOT distinguish an absent member from one that was never set.

2.3. **Node IDs.** An entity node's ID is an RFC 4122 UUID in lower case, except a constant's (§11.9), which is `builtin:<type>/<name>`. Kernel node IDs (§5) are strings unique within their environment.

2.4. **Paths.** A path is a non-empty array of strings: a field name, then map keys (§11.2). A path's **key** is its canonical serialisation.

2.5. **Entry references.** An entry of an entity stream is itself addressable: the record `{ "node": { "type": <type>, "id": <id> }, "seq": <integer ≥ 1> }`.

2.6. **Hashes.** Where this specification derives an identity from data (a conflict ID, §18.3), it uses the canonical form of that data. The hash function is implementation-defined but MUST be deterministic and stable across runs and versions of the implementation.

## 3. Streams and entries

3.1. **Every node is a stream:** a chronological, append-only list of entries. There is no distinction between a stream of values and a stream of changes in the stream itself; whether its entries are whole values or deltas is the concern of its consumer (a consumer wanting a state MUST fold the entries in order, §5.3 *scan*).

3.2. **Kernel entries.** An entry of a kernel node is the record:

| Member | Meaning |
|---|---|
| `seq` | 1 for the node's first entry, then consecutive integers. MUST NOT repeat or go backwards. |
| `cycle` | The number of the cycle (§6) in which the entry was appended. |
| `at` | The clock source's wall time (milliseconds since the Unix epoch) at the start of that cycle. |
| `value` | The entry's data (§2.1); absent on an error entry. |
| `error` | Present only on an error entry (§7). |

3.3. A node MUST append at most one entry per cycle, except a seed, which appends one entry per observation (§5.2).

3.4. **Latest.** A node's latest entry is its entry with the greatest `seq` it has appended, whether or not it still retains it. Implementations MUST retain the latest entry of every active node (§4.5).

3.5. **Entity streams** (§11) are streams whose entries carry more members (commit, actor, position). They are seeds' streams in kernel terms (§11.1) and follow this section except where §11 is more specific.

## 4. Demand

4.1. **Nothing happens without demand.** A node computes, activates or retains only because something demands it. Demand is expressed by a **consumer** on a **producer** with a **demand spec**. Consumers are other nodes (a combinator or effect on each of its inputs) or the host (a one-shot read, §4.8).

4.2. **Demand specs.** A demand spec is one of the records:

| Spec | Asks for |
|---|---|
| `{ "latest": true }` | The latest entry. |
| `{ "entry": <seq> }` | One specific entry. |
| `{ "range": { "from": <seq>, "to": <seq> } }` | A static range of entries, inclusive (`to` MAY be absent: up to the latest). |
| `{ "rolling": { "entries": <n> } }` | The latest *n* entries, moving as entries are appended. |
| `{ "rolling": { "ms": <m> } }` | Entries whose `at` is within *m* milliseconds of the clock's current time, moving with time. |
| `{ "query": <data> }` | A producer-defined query (for example a range of positions of an entity stream). A producer that doesn't recognise the query MUST treat it as `latest`. |

4.3. **Demand as a source.** In place of a spec, a consumer MAY give a node whose latest entry is a spec. The implementation MUST then demand `latest` on that spec node, and whenever it appends an entry, MUST treat the consumer's demand as changed to the new spec, as a demand change (§6.8): the demand edge is not released and re-established, the producer never passes through dormancy on its account, and its retention follows the new spec from the end of that cycle. A spec node whose latest entry is not a valid spec, or is an error, MUST be treated as `latest`.

4.4. **Activity.** A node is **active** while it has at least one demand edge from an active consumer or from the host. An effect is active while it is connected by a running driver (§9.3). A node that is not active is **dormant**. A dormant node MUST NOT compute, MUST NOT hold demand on its inputs, and a dormant seed MUST NOT be activated (§5.2). When a combinator or effect becomes active it MUST demand each input (with `latest` unless its operator declares another spec); when it becomes dormant it MUST release those demands. Activation and dormancy therefore cascade upstream.

4.5. **Retention.** An active node MUST retain every entry required by the union of its consumers' specs: the latest entry; each demanded entry; each entry of a demanded range; for a rolling spec, the entries the spec covers. It MAY retain more. A dormant node MAY discard all its entries except the facts §3.2 requires to continue its sequence numbering. An entity stream's retained entries MAY be loaded from its store on demand (§11.12) rather than held in memory.

4.6. **Delivery.** A consumer demanding a range or rolling window MUST be given, when it computes, the retained entries its spec covers, and which of them were appended in the current cycle.

4.7. **Demand changes are wiring changes.** Adding, releasing or changing a demand edge during a cycle is queued (§6.8).

4.8. **One-shot demand.** The host MAY read a node outside any cycle. If the node is active, the read returns its retained entries. If it is dormant, the implementation MUST either activate it, apply the activation (§6.9) and release it again, or compute the same answer by other means; either way the answer MUST equal what an active node would hold after that activation.

## 5. Node kinds

There are exactly five node kinds. Every node has an ID, a kind, and a stream.

5.1. **Common contract.** A node's inputs are an ordered list of nodes. A node MUST NOT be its own input, and the input graph of active nodes MUST be acyclic: an implementation MUST refuse (and leave unwired) an input edge that would close a cycle among nodes, reporting the refusal as an error entry on the node whose inputs changed.

5.2. **Seed.** A seed has no inputs. Its entries come from outside through **observations**: each observation appends one entry whose value is the observed data. Constants, baked-in defaults, sources (the clock, input), entity nodes' entry streams and process results are seeds. A seed MAY have an **activation**: host behaviour run when the seed becomes active, given a cancellation token (§8) that is cancelled when the seed becomes dormant (a clock seed starts ticking; a listener attaches). A seed MAY be observed while dormant; the observation appends an entry but starts no work downstream (nothing is active downstream). A seed MAY declare that an observation equal to its latest entry is ignored; otherwise every observation appends.

5.3. **Combinator.** A combinator has one or more inputs and a computation from its inputs' retained entries (and its own previous output) to either a new output value or **unchanged**. The standard stream operations are combinators: *map*, *filter*, *scan* (a fold of each new input entry into an accumulated value), *flatMap* (whose inner node is chosen by a value, rewired by §6.8), *combine* (the latest of several inputs), *window* rollups, classification, temporal analysis and triggers. A combinator's output is **changed** when it appends an entry: it MUST append when its computed value is not equal (§2.2) to its latest entry's value (or it has none), and MUST NOT append when it is equal.

5.4. **Effect.** An effect has one or more inputs and no stream consumers: its work is synchronous host behaviour, run in the cycle whenever at least one input changed (§6.4). There is no long-running effect: an effect that needs long-running work MUST ask a driver for a process (§9). An effect's stream records its runs (the entries MAY be empty records); implementations MAY omit retaining them.

5.5. **Driver.** A driver coordinates demand. It is a shell around an internal graph environment: **starting** it runs its definition, which creates nodes in the run's scope and connects sources to effects (which is what expresses demand, §4.4), and returns the run's **process node** (§9.1). A driver's stream is the list of its runs' process node references.

5.6. **Process.** A process is long-running work: a node whose stream is the work's state (§9.2). It is started by a driver (a driver's run is itself a process), is observable like any node, and is the parent of any child processes started in its context.

## 6. Cycles: the START/END protocol

6.1. **Cycles.** All computation happens in **cycles**. Cycles are numbered from 1 in the order they run, per environment, and never overlap: an implementation MUST NOT begin a cycle before the previous one has completed (§6.7).

6.2. **Transactions.** A cycle begins with one or more observations at seeds, made together as a **transaction**. Observations made outside a transaction form a transaction of one. The seeds a transaction observes are the cycle's **origins**. (The environment's **wiring seed**, §6.9, is the origin of activation cycles.)

6.3. **Messages.** Within a cycle, nodes exchange two messages along active edges, from an input to its active consumers: **START** and **END**. END carries a flag: **changed** or **unchanged**.

6.4. **The protocol.** Each active node holds a counter, 0 between cycles.

1. Each origin seed appends one entry per observation, then behaves as a node that received and completed one START: it sends START to each active consumer.
2. A node receiving START MUST increment its counter. On the counter's **0→1** transition, and only then, it MUST send START to each of its active consumers.
3. After an origin has sent START to all its consumers, it sends END(changed) to each of them.
4. A node receiving END MUST decrement its counter and, if the END was *changed*, remember that an input changed.
5. On the counter's **1→0** transition, and only then, the node **finishes**: if at least one input changed, a combinator computes and an effect runs; otherwise it does no work. It then sends END to each consumer it sent START to: *changed* if it appended an entry in this cycle, *unchanged* otherwise.
6. A node that computes and finds its output equal to its latest entry MUST NOT append, and MUST send END(unchanged) (**END on unchanged**). Its consumers then do no work on its account.

*Note.* In a reconvergent diamond (A feeds B and C, which both feed D), D receives two STARTs and two ENDs and finishes once, after both B and C, so it computes once and never sees B's new value with C's old one.

6.5. **Cycle invariants.** For every cycle, an implementation MUST guarantee:

- **K1 (once).** Every node finishes at most once.
- **K2 (settled inputs).** When a node computes or runs, each of its inputs that took part in the cycle has already finished; so the inputs it reads are final for the cycle (glitch freedom).
- **K3 (need).** A node computes or runs only if at least one of its inputs sent END(changed) in this cycle, or it is being primed (§6.9).
- **K4 (quiet).** A node that doesn't append sends only END(unchanged), and a node all of whose participating inputs sent END(unchanged) does no work.
- **K5 (balance).** Every START a node receives is matched by exactly one END from the same input, and every counter is 0 when the cycle completes.
- **K6 (scope).** Only nodes downstream of an origin through active edges take part.
- **K7 (containment).** No failure of a computation or an effect escapes the cycle (§7).

6.6. **Order.** The order in which a node's consumers receive their messages, and in which independent nodes finish, is implementation-defined, subject to 6.4 and 6.5. Hosts and conformance vectors MUST NOT depend on the relative order of independent nodes (nodes neither of which is upstream of the other).

6.7. **Completion.** A cycle **completes** when every origin and every node that received START has finished. Then, in order:

1. queued wiring, demand and driver changes (§6.8) are applied, in the order they were requested;
2. if any node was activated or rewired by them, an activation cycle runs (§6.9);
3. queued observations (§6.8) start the next cycle, in the order they were made, each queued transaction a cycle of its own.

6.8. **Queued changes (mid-cycle).** During a cycle, an implementation MUST NOT change the set of active nodes, any node's inputs or any demand edge, and MUST NOT start or stop a driver. Such changes requested during a cycle (by an effect, by a combinator's flatMap, by the host) MUST be queued and applied at completion (6.7). Observations made during a cycle MUST NOT join it; they MUST be queued and start a later cycle.

6.9. **Activation cycles.** When applied changes activate nodes or change nodes' inputs, the environment's wiring seed observes the batch, and the cycle it starts reaches exactly the nodes activated or rewired (each counts the wiring seed as a changed input for this cycle) and, through them, their active consumers. A newly activated combinator therefore computes from its inputs' latest entries (it is **primed**) and appends if its value differs from its latest entry (or it has none); a newly connected effect runs once with its inputs' latest entries. Priming a node with an input that has no entry yet: the combinator's computation receives that input as having none, and MAY return unchanged.

6.10. **Re-entrancy.** An effect or a host callback MAY request changes and observations during a cycle; they are queued (6.8). A request to run a cycle from within a cycle MUST NOT run it immediately.

6.11. **Liveness.** Every cycle MUST complete in a finite number of steps. Implementations MUST bound activation cycles caused by activation cycles (a wiring change that causes another in its own activation cycle); a bound of at least 64 consecutive activation cycles MUST be supported, after which further queued wiring changes are reported as error entries on the environment's error seed (§7.4) and dropped.

## 7. Errors are values

7.1. A combinator whose computation fails MUST append an **error entry** (an entry with an `error` member and no `value`) and send END(changed). The error record is `{ "message": <string>, "code": <string, optional>, "data": <data, optional> }`.

7.2. An error entry is a changed output: consumers compute, receiving the error as that input's latest entry. A standard operator given an error input MUST output an error entry carrying the same error, unless the operator is defined to handle errors. Two error entries are equal when their error records are equal (so a repeated identical failure is END on unchanged).

7.3. An effect whose run fails MUST NOT affect the cycle; the failure MUST be observed, as an error record naming the effect, on the environment's **error seed** in a later cycle (§6.8).

7.4. Failures in the environment itself (a refused edge, an activation bound exceeded, a driver definition failing) are observed on the error seed likewise. No failure escapes a cycle to the host as an exception; a host API that cannot complete (a refused commit, §11.8) returns a refusal value.

## 8. Cancellation tokens

8.1. Cancellation uses **tokens** with the semantics of the web platform's AbortSignal, stated here abstractly so any language can map it. A **controller** owns one token and can **abort** it with a **reason** (data). A token is either not aborted, or aborted with a reason; once aborted it stays aborted, and a later abort MUST be ignored (the first reason stands).

8.2. **Listeners.** A token accepts listeners; when it is aborted, each listener registered before the abort MUST be called exactly once, synchronously, in registration order. A listener registered on an aborted token MUST NOT be called; the registering code MUST check the token first.

8.3. **Chaining.** A controller MAY be created with parent tokens; its token MUST be aborted when any parent is aborted, with that parent's reason, and MUST be aborted at creation if a parent already is. Aborting a child never aborts its parent.

8.4. **Where tokens are used.** Every activation (§5.2), driver run and process (§9) has a token. A process's token is chained to its parent process's token, and a driver run's token to the token it was started with. Hosts end subscriptions, activations and runs by aborting tokens; an implementation's host API MUST NOT offer disposal functions (unsubscribe handles, dispose methods) for these, except in adapters where the other side forces them.

8.5. **Tokens as nodes.** An implementation MUST be able to present a token as a seed whose stream is `false` then (on abort) `true`, and SHOULD offer an effect that, given such a seed, records the abort as an error entry downstream (*throwIfAborted*), for diagnostics.

8.6. **Mapping.** An implementation in a language with a native equivalent (a JavaScript host's AbortSignal, a stop token) SHOULD accept native tokens as parents. An engine forbidden from reading host globals MAY implement its own token satisfying the native interface.

## 9. Drivers and processes

9.1. **Starting a driver** takes a token and returns a **process node** for the run, in state `running`. Starting is a wiring change (§6.8): requested during a cycle, the run begins at completion, and the returned process node exists at once but appends its `running` entry in the activation cycle. The run's definition then creates nodes in the run's **scope**, connects sources to effects (activating them), and may start child processes and child drivers. The run ends (§9.4) when its token is aborted, or when its definition completes or fails, if it is one that completes.

9.2. **Process state.** A process's stream is its state, one entry per change:

| Entry value | Meaning |
|---|---|
| `{ "status": "running" }` | Started (always the first entry). |
| `{ "status": "progress", "progress": <data> }` | Progress reported by the work (any number, while running). |
| `{ "status": "done", "result": <data> }` | Finished with a result. Terminal. |
| `{ "status": "failed", "error": <error record> }` | Failed (§7.1). Terminal. |
| `{ "status": "aborted", "reason": <data> }` | Its token was aborted before it finished. Terminal. |

A process MUST append exactly one terminal entry and nothing after it. Every state change MUST arrive as an observation of the process node, starting a new cycle (§6.8): work's results never enter a cycle already running.

9.3. **Scope.** Nodes created and effects connected by a run belong to its scope. While the run is running its effects are active. When the run ends, the implementation MUST disconnect its effects, release the demand they held, and abort its running child processes and runs.

9.4. **Ending.** A run or process ends: *aborted* when its token is aborted (with the token's reason); *done* or *failed* when its work completes. After a process is aborted, a later completion of its work MUST be discarded: no `done` or `failed` entry follows `aborted`, and the work's results MUST NOT be observed anywhere.

9.5. **Children.** Work started in the context of a process is a **child process**: its token is chained to the parent's (§8.3). Aborting a parent aborts every descendant. When a process reaches a terminal state, its running children MUST be aborted (with the reason `{ "parent": <status> }`), before its terminal entry is observed or in the same cycle.

9.6. **Drivers start and stop through effects.** A child driver is started and stopped by effects (typically one that starts it while a condition node is true and aborts its token when it becomes false), and coordinated through state data in nodes; its start and stop are queued wiring changes.

9.7. **Long-running work from a node.** A node needing new long-running work MUST obtain it as a child process from the driver responsible for the process the node feeds; it MUST NOT run long-running work itself.

## 10. Models, the erector and operators

10.1. **Data first.** A subsystem SHOULD first be modelled as data in a node: its shape, its state machine and its effects. The live machinery is erected from that model.

10.2. **Graph models.** A graph model is the record `{ "nodes": [ <node model>, … ] }`, where each node model is:

| Member | Meaning |
|---|---|
| `id` | Unique within the model. |
| `kind` | `"seed"`, `"combinator"`, `"effect"` or `"driver"`. |
| `op` | For a combinator, effect or driver: the operator's name in the registry (§10.4). |
| `inputs` | For a combinator or effect: the IDs of its inputs, in order (model IDs, or `{ "$node": … }` for live nodes outside the model). |
| `params` | Data given to the operator. |
| `initial` | For a seed: an optional first entry, observed when the seed is erected. |
| `demand` | Optional: the spec the node demands of its inputs, instead of `latest` (a spec, or a model ID of a node whose latest entry is the spec, §4.3). |

10.3. **The erector** is a driver. Started with a model node, its run demands the model node's latest entry and keeps a set of live nodes matching it. At start and whenever the model node appends, it MUST (as queued wiring changes, §6.8): create nodes for new model IDs; release nodes whose IDs disappeared; rewire nodes whose `inputs` or `demand` changed; and replace nodes whose `kind`, `op` or `params` changed (release and create). A node whose model is unchanged MUST keep its identity and retained entries. The erector **delivers a node**: a combinator whose latest entry maps each model ID to its live node reference (`{ "$node": … }`).

10.4. **Operators.** An operator registry maps names to computations: for a combinator, a function of its inputs' entries and previous output to a value or *unchanged*; for an effect, synchronous work; for a driver, a definition. Registries are host code; models name operators so that they stay data. An implementer contributes a feature by delivering a node: a model node, and a node carrying the contributed nodes (which MAY be the same node).

10.5. **Conformance operators.** Every implementation's conformance runner MUST provide these operators (they need not exist in production):

| Name | Kind | Behaviour |
|---|---|---|
| `identity` | combinator | The latest value of its one input. |
| `sum` | combinator | The sum of its inputs' latest values (numbers; absent counts 0) plus `params.add` (default 0). |
| `product` | combinator | The product of its inputs' latest values. |
| `pick` | combinator | `params.path` (an array of member names) read from its one input's latest value; absent if missing. |
| `scan-sum` | combinator | Its previous output (0 at first) plus each of its one input's entries appended in this cycle. |
| `collect` | combinator | The array of its one input's retained entries' values covered by its demand (with `demand` a range or rolling spec). |
| `combine` | combinator | The array of its inputs' latest values (null for an input with none). |
| `threshold` | combinator | `true` when its one input's latest value ≥ `params.at`, else `false`. |
| `fail-when` | combinator | Its one input's latest value, except that it fails (§7.1, message `params.message`) when that value equals `params.equals`. |
| `record` | effect | Appends its inputs' latest values (one array per run) to the vector's log for this effect. |
| `observe` | effect | Observes seed `params.seed` with its one input's latest value (a queued observation, §6.8). |
| `while` | effect | Starts driver `params.driver` (with a token of its own) while its one input's latest value is `true`; aborts that token when it becomes `false`. |
| `rewire` | effect | Changes the inputs of node `params.node` to `params.inputs[<its input's latest value>]` (a queued rewiring). |
| `work` | driver | Starts the processes in `params.processes` as children of its run (§22.4), then keeps running until aborted. |
| `connect` | driver | Connects each `[source, effect]` pair in `params.pairs` (model IDs of existing nodes) for the length of its run. |

## 11. Entity streams

The entity layer is event sourcing on the kernel: every authored node is a seed whose stream is its entries.

11.1. **Entity nodes.** An entity node has a type (§11.2), an ID (§2.3) and a stream of **entity entries**. Its **state** is the fold of its entries (§11.6); its **effective value** is its state resolved through its layers (§12). In kernel terms the node's entry stream is a seed, the fold is a scan combinator over it, and resolution is a combinator over the state and its layer sources' effective values.

11.2. **Types.** A node type is data: `{ "type": <name>, "owner": <name>, "schema": <string>, "stream": "delta" | "value", "persistence": "persistent" | "session", "fields": { <name>: <field spec> }, "defaults": <object>, "constants": [ … ], "compatible": [ <type> … ] }`. A field spec is one of: `{ "kind": "value" }` (atomic data); `{ "kind": "ref", "to": <type or types>, "clone": "follow" | "share", "follows": true? }` (one node reference or null); `{ "kind": "refs", … }` (an ordered, atomic list of references); `{ "kind": "entry" }` (an entry reference, §2.5, or null); `{ "kind": "map", "of": <field kind> }` (keyed values). A field spec MAY add `"inherit": false` (identity: never layered, never cloned) and `"unique": true` (no two live nodes of the type share its own value). A **leaf path** is a field name followed by one key per map level. `stream` names the default consumer (the latest entry, or a scan) and the compaction rule (§16); it does not change the stream.

11.3. **Entity entries.** An entity entry is the record:

| Member | Meaning |
|---|---|
| `node` | `{ "type", "id" }` of the node. |
| `seq` | 1, 2, 3 … within the node's stream; no gaps unless compacted (§16). |
| `pos` | The **position**: the local commit order across all streams (a point in time, §11.10). Assigned by the store (§19.3). |
| `commit` | The ID of the commit that appended it (a UUID); every entry of one commit has the same. |
| `actor` | The actor that made it (§17). |
| `actorSeq` | The actor's own counter at the entry. |
| `at` | The clock source's wall time when committed (for a belief, the other actor's time). |
| `schema` | The type's schema when written (§15.3). |
| `op` | The change (§11.4). |
| `meta` | On a commit's first entry only: `{ "label"?: <string>, "basis": [[<node id>, <seq>] …], "scope"?: <string> }`: the history label, the head seq of every node the commit touched before it (0 for a new node), and the undo scope. |
| `provenance` | On a belief (§17.2): `{ "actor", "actorSeq", "at", "kind"?, "note"? }`. |
| `inlined` | Streams collapsed into this entry (§16.6): `[{ "node", "entries": [ … ] }]`. |

11.4. **Ops.** The op is one of these records (`kind` names it):

| Op | Effect on the state |
|---|---|
| `{ "kind": "create", "state": S }` | The state becomes S (the node's first entry). |
| `{ "kind": "import", "state": S, "source": <data> }` | As create; `source` records where migrated data came from. |
| `{ "kind": "state", "state": S }` | The state becomes S (value streams; rollups, §16.4). |
| `{ "kind": "set", "path": P, "value": V }` | Own value at leaf path P becomes V. |
| `{ "kind": "reset", "path": P }` | Own value at P is removed. |
| `{ "kind": "tombstone", "path": P }` | Own value at map-key path P becomes the tombstone (§11.5). |
| `{ "kind": "layers", "layers": [L …] }` | The layers become the list (§12.1). |
| `{ "kind": "rename", "name": N }` | The name becomes N. |
| `{ "kind": "trash" }`, `{ "kind": "restore" }` | Trashed becomes true, false. |
| `{ "kind": "retract" }`, `{ "kind": "unretract" }` | Retracted becomes true, false (only in compensations, §14.2). |
| `{ "kind": "tag", "label": T, "entries": [E …] }` | No change to the state; references entries (§16.2). |
| `{ "kind": "untag", "tag": <seq> }` | No change; releases a tag of this stream. |
| `{ "kind": "compensate", "reverses": [E …], "ops": [O …] }` | Applies the primitive ops O in order (§14). |
| `{ "kind": "revert", "to": E, "ops": [O …] }` | Applies O in order (§14.4). |

A *primitive op* is set, reset, tombstone, layers, rename, trash, restore, retract or unretract.

11.5. **State.** A state is the record `{ "name": <string>, "own": { <path key>: <value> … }, "layers": [L …], "trashed": <boolean>, "retracted": <boolean> }`. `own` holds what the node sets itself, by leaf path key (§2.4); the value `{ "$strata": "tombstone" }` at a map-key path is the **tombstone**: absent here, and the search for that key stops (§12.2). Serialised states SHOULD list `own` members in path key order.

11.6. **Fold.** The state after a list of entries is obtained by starting from *none* (the node doesn't exist) and applying each entry's op in `seq` order, after upcasting it (§15.3). Applying a primitive op to *none* leaves *none*. The fold MUST be deterministic: the same entries give an equal state.

11.7. **Existence.** A node **exists** at a point when its fold there is not *none* and not retracted. A trashed node exists (it resolves, and is listed as trashed).

11.8. **Commits.** A commit is a batch of edits applied atomically as one kernel transaction: each node it touches gets one or more consecutive entries, all with the commit's ID, and the first entry of the commit carries `meta` (§11.3). A commit either applies entirely or is **refused** with a reason code and nothing changes. Implementations MUST refuse, at least: an edit of a constant (`constant`); a path the type doesn't have (`path`); a value its field doesn't accept (`value`; a reference must name an accepted type); a layer list that would close a layer cycle (`cycle`, §12.5); a layer source of another, incompatible type (`type`); a unique value already held (`unique`); a commit whose stated basis differs from the nodes' head seqs (`stale`); an edit of a node that doesn't exist (`missing`); an action a blocking conflict refuses (`conflict`, §18.4).

11.9. **Constants.** A type MAY declare constants: `{ "name", "label", "fields" }`. A constant is a node with ID `builtin:<type>/<name>`, name `label`, own values from `fields`, no layers and no stream. Constants are layer sources and reference targets, never edit targets.

11.10. **Positions and points in time.** A **point** is a position. It MAY be named by an entry (its position), by a commit (the greatest position of its entries), or by a wall time (the greatest position whose `at` is not after it). The **view at point T** is every node's fold over its entries with `pos` ≤ T (§12.6).

11.11. **Actors and commit identity.** Every entry names its actor and the actor's counter; a commit names the positions it was made against (its basis). §17 defines beliefs.

11.12. **Loading.** An implementation MAY hold only part of a stream in memory: a snapshot (§15) and the entries after it. A demand for an earlier point or range (§4.2 `query`) MUST cause the needed entries to be loaded (through a process of the store driver, §19.5) before it is answered.

## 12. Layering resolution

12.1. **Layers.** A layer is the record `{ "from": <node ref>, "role": "base" | "feed", "paths": "*" | [P …], "at"?: E }`. A node has at most one base, whose `paths` MUST be `"*"`; any number of feeds, in order. `at` **pins** the layer to entry E of the source's stream (E's node MUST be the layer's source); without it the layer follows the source live.

12.2. **Resolution.** The effective value of node N at leaf path p, at point T, is found by the first of these that yields a value:

1. N's own value at p. If it is the tombstone, the value is **absent** and the search stops.
2. If p's field is not `inherit: false`: each **feed** of N in listed order whose `paths` **covers** p (`"*"`, or one listed path is a prefix of p): the feed source's effective value at p, resolved at T (or, for a pinned feed, at the position of its `at` entry). A source whose value is absent yields nothing, and the search continues.
3. If p's field is not `inherit: false`: N's **base**, likewise.
4. The type's default at p (read from `defaults` by following p's members), if there is one.

Otherwise the value is absent.

12.3. **Maps.** The keys of a map at path m of node N are the union of: the keys under m in N's own values (tombstoned or not); for each layer, the source's present keys at m, restricted, for a feed, to keys k where a listed path is a prefix of m + [k] or m + [k] is a prefix of a listed path; and the keys of the type's default at m. A key is **present** when its path resolves to a value (a leaf) or, for a map of maps, when its submap has a present key. The effective value of a map is the object of its present keys, each resolved by §12.2.

12.4. **Effective value.** A node's effective value is the object mapping each field to its effective value (a map field to its object, possibly empty); fields whose value is absent are omitted. A node that doesn't exist has no effective value.

12.5. **Layer cycles.** Layer edges MUST NOT form a cycle: before applying a commit, the implementation MUST walk every layer source reachable from the node's new layers (pinned and live) and refuse the commit (`cycle`) if the node is reached. A cycle that arrives anyway (from another actor's entries) MUST NOT cause infinite resolution: the implementation MUST treat the repeated layer as yielding nothing.

12.6. **Time.** Resolution at point T reads each source at T, except a pinned layer, which reads its source at the position of its `at` entry (and that source's own layers at that position, and so on). Because a pinned entry is always earlier than the layer that pins it, resolution terminates.

12.7. **Origins.** An implementation SHOULD report, for any leaf path, where its effective value comes from: the node's own value; a feed or the base (naming the layer's source and the node whose own value it ultimately is); the default; or absent.

12.8. **Change reports.** When a cycle changes a demanded node's effective value, the change report MUST list exactly the leaf paths whose effective value (or presence) differs from before the cycle, plus bookkeeping changes (`created`, `name`, `layers`, `trashed`, `retracted`, `purged`).

## 13. Layering operations

Each operation is an edit in a commit; its result is normative, its encoding as ops is not (except where stated).

13.1. **Reference:** set a `ref`, `refs` or map-of-`ref` field.

13.2. **Shallow fork:** a new node of the same type whose only layer is `{ "from": source, "role": "base", "paths": "*" }` (pinned when forking from a past point), with fresh identity values (§13.9) and the source's name unless another is given.

13.3. **Selective feed:** adds a feed (replacing an existing feed from the same source).

13.4. **Deep clone:** new nodes holding, as own values, the source's effective values at every present leaf path except `inherit: false` fields, with no layers and fresh identity values. For each reference leaf whose field's `clone` is `follow` (the call MAY override per field), the target is cloned too (once, however often it is reached, and never a constant), and every reference to a cloned node among the new nodes is remapped to its clone.

13.5. **Detach:** every leaf value the node inherits (origin a feed or the base) becomes an own value, and its layers become empty. Its effective value MUST be unchanged.

13.6. **Rebase:** the base layer's source becomes another node of the same type (or a compatible one), subject to §12.5.

13.7. **Reset** (per path): removes the own value.

13.8. **Apply to source** (per path): the own value at p is written into the node it would otherwise inherit p from (the first covering feed or base whose source has a value at p, else the first covering layer), and removed from this node. Refused (`pinned`) if that layer is pinned, (`constant`) if its source is a constant, (`no-source`) if no layer covers p.

13.9. **Identity is never shared.** A created, forked or cloned node gets a fresh ID and fresh values for its `inherit: false` fields (generated from the random source, §20).

## 14. Undo, redo and revert

14.1. **Append only.** Undo, redo and revert append entries; they never remove or rewrite entries.

14.2. **Compensation.** Undoing commit C appends, for each node C touched, one `compensate` entry whose `reverses` lists C's entries on that node and whose ops restore, for each aspect C changed (each own path, the layers, the name, trashed, retracted), the value before C, provided that aspect still has the value C gave it (an aspect changed again since is left as it is). Undoing the creation of a node appends `retract`. When no other entry has touched the node since C, the fold after the compensation MUST equal the fold before C.

14.3. **Redo** compensates the compensation.

14.4. **Revert** to entry E of node N appends one `revert` entry whose ops turn N's current state into its state at E (not retracted).

14.5. **Scopes.** Undo stacks are per scope (a node's content history, or the graph's wiring); undoing acts on the scope's latest commit not yet undone; a new commit in a scope clears its redo stack. Undo stacks are session state, not stored.

## 15. Snapshots and upcasting

15.1. **Snapshots** are caches: `{ "node", "seq", "pos", "schema", "state" }`, the fold of the node's entries through `seq`, folded with the type's schema `schema`. A snapshot MUST equal the fold of the entries it covers, and the fold of a snapshot followed by the entries after it MUST equal the full fold. Snapshots MAY be discarded and rebuilt at any time; a snapshot whose `schema` differs from the type's current schema MUST NOT be used.

15.2. **When.** An implementation SHOULD write a snapshot when a node's entries since its last snapshot exceed a bound (200 is RECOMMENDED) or took long to fold, and for every changed node when the host closes.

15.3. **Upcasting.** A type MAY register **upcasters**, pure transformations from entries of schema *a* to entries of schema *b*, applied on read, never written back. Folding applies the chain from each entry's `schema` to the type's current schema. The declarative form used in vectors is `{ "from": a, "to": b, "rename": [[P, P′] …] }`: every path beginning with P is rewritten to begin with P′, in set, reset and tombstone ops and in states' own values.

## 16. Compaction and purge

16.1. **Nothing anything points at is lost.** Compaction removes only entries nothing references, and only when asked (by a policy, later).

16.2. **Keep set.** The keep set of a set of streams is: the latest entry of every stream; every `tag` entry not released by an `untag` of the same stream; every entry of a commit on an undo or redo stack (the host supplies these); any root entries the host supplies (bookmarks, recordings, manifests); and every entry referenced by any entry: a tag's `entries`, a revert's `to`, a pinned layer's `at` in a `layers`, `create`, `import` or `state` op, an `entry` field's value in a `set` op or a state's own values, the same within `inlined` streams, and a compensation's `reverses` only while its commit is on an undo or redo stack.

16.3. **Value rollup** (streams whose type says `value`): entries not in the keep set are removed.

16.4. **Delta rollup** (streams whose type says `delta`): each maximal run of consecutive entries not in the keep set is replaced as follows. Group the run by **bucket** (`floor(at / bucket)`, one second by default). For each bucket in order, let F be the fold after the bucket's last entry; if F differs from the state before the bucket (the last kept or emitted state), emit one entry that is the bucket's last entry with op `{ "kind": "state", "state": F }`, the type's current schema, and no `meta`. Kept entries are unchanged. Consequently the fold at every kept entry and at every emitted entry is unchanged.

16.5. **References are shallow.** Compaction of one stream MUST NOT change any other stream.

16.6. **Inline collapse.** When exactly one entry, across all other streams, references node X (by a reference value) and no entry references an entry of X, X's whole stream MAY be moved into that entry's `inlined` member and X's own stream removed. X MUST then still resolve exactly as before.

16.7. **Purge** removes a node's stream, snapshots and index rows from the store, and from existing backups (removal, not hiding). References to it by ID remain and read as missing. While other nodes layer from it, purge MUST be refused (`dependents`), naming them, unless forced.

16.8. **Recording compaction.** A store MUST record where each stream was compacted (node, seq, time). Gaps in `seq` are permitted only in compacted streams.

## 17. Actors, provenance, trust and disagreement

17.1. **Actors.** Every process that writes entries (the Studio, the game plugin, the desktop host, an agent) is an actor with a stable ID and its own entry counter (`actorSeq`), which MUST increase by one per entry it writes.

17.2. **Beliefs.** An entry recording another actor's opinion is a **belief**: it carries `provenance` naming that actor, its counter and its time. Beliefs are appended like any entry; nothing is overwritten.

17.3. **Re-engaging.** A stream MUST be readable "after entry N" (by `seq`) so an observer can resume with a cursor.

17.4. **Trust.** Resolving a fact from several actors' claims asks a **trust policy**, `rank(fact kind, actor) → number` (higher wins; 0 is not trusted), never which claim came last. A claim is `{ "actor", "value", "asOf" }`, true as of `asOf`. The resolved value is the latest claim of the highest-ranked actor with rank > 0. Until trust tables exist, an actor trusts only itself.

17.5. **Disagreement** is a state a value can be in: `{ "kind": "disagreement", "factKind", "claims": [ … ], "trusted"?: <claim> }`, present when the actors' latest claims differ. Implementations MUST list disagreements with conflicts (§18) when a rule reports them.

## 18. Conflicts

18.1. **Rules** are registered with an ID, an owner, subject types, a severity (`blocking`, `warning`, `notice`), the action kinds a blocking conflict refuses (`"*"` for every edit) and a pure evaluation from a subject node and read access to the graph to a list of conflicts (subjects, a sentence, fix routes, an optional key, and kind `conflict` or `disagreement`).

18.2. **Index equivalence.** Whenever the conflict index is demanded, it MUST equal the result of evaluating every rule on every existing node.

18.3. **Identity.** A conflict's ID derives from its rule ID, its subjects (sorted by node ID) and its key (§2.6), so it is stable across re-evaluation.

18.4. **Blocking.** A commit naming an action kind MUST be refused (`conflict`, carrying the conflict) when a blocking conflict whose subjects include an edited node refuses that action kind.

18.5. **Fixes** apply a route's patch (a list of edits) as one commit, refused if the conflict no longer exists or the patch would add a blocking conflict. No fix removes anything.

## 19. Stores

19.1. **Contract.** A store holds entity streams, snapshots, the compaction record and an index. It MUST offer: list the index; load every node's latest snapshot and the entries after it; read a stream after entry N; append a commit; read every entry after position N; a change counter; write and discard snapshots; compact a stream; purge a node.

19.2. **Append** is atomic and guarded: the request names, for each node, the head seq it expects; if any differs, the whole append MUST be refused as stale, and nothing written. Appends MUST be idempotent by commit ID: appending a commit already stored returns its positions and writes nothing.

19.3. **Positions** are assigned by the store in append order, strictly increasing across the store, and returned in the order of the request's entries.

19.4. **Compaction** replaces a stream's entries up to the last given entry's `seq` with the given entries (kept and rollup entries, same seqs and positions), keeps any later entry, records the compaction and discards the stream's snapshots.

19.5. **In the kernel,** the store is behind a **store driver**: appends, loads, reads and compactions are processes; an append's acknowledgement (or refusal) is observed as a new cycle. Commits appear in memory at once and are **pending** until acknowledged; a host keeps the pending commits as its recovery copy, and after a restart re-applies those whose basis still matches (skipping any the store already has). A refused (stale) commit, and every pending commit after it, is removed from memory and kept as **rejected**, never silently dropped.

## 20. Sources and determinism

20.1. Every source of non-determinism (wall and monotonic time, timers, randomness and IDs, input, storage, files, jobs, the network, other actors) MUST enter only through sources: seeds and drivers the host binds to adapters. An implementation's engine MUST NOT read them directly.

20.2. **Randomness** is named streams: each purpose (node IDs, commit IDs, identity values) draws from its own stream, so a simulation with a seed is exactly repeatable and adding a use of one stream doesn't shift another.

20.3. **Simulation.** An implementation SHOULD offer simulated sources driven by a seeded scheduler that holds every pending source event and chooses which runs next, so failures reproduce from a seed and a step list.

## 21. What implementations may choose

Implementations MAY choose freely, provided the observable behaviour above holds:

- data structures, memoisation and caching (a resolution memo, snapshot policy within §15.2's recommendation, what a dormant node keeps);
- the order of messages and of independent nodes' work within a cycle (§6.6);
- whether one-shot reads of dormant nodes activate them or compute otherwise (§4.8);
- threading, provided cycles don't overlap and effects run within their cycle;
- how host APIs look (names, error types), except that they MUST NOT expose disposal functions where tokens are specified (§8.4) and MUST return refusals as values;
- store technology, and the physical format of stored entries, provided the records above round-trip exactly;
- retaining more than demand requires (§4.5).

## 22. Conformance vectors

22.1. **Location and format.** Vectors are the JSON files in `conformance/`. Each file is `{ "suite": <name>, "vectors": [ <vector> … ] }`. A vector is `{ "name", "rules": [<section> …], "description", "kind": "kernel" | "entity", … }`. An implementation conforms when every vector passes.

22.2. **Kernel vectors** hold `graph` (a graph model, §10.2, erected at the start in the environment's root run; drivers are listed but not started), `seed` (a string for the random source), and `script`, a list of steps:

| Step | Does |
|---|---|
| `{ "observe": { <seed id>: <value>, … } }` | One transaction observing those seeds. |
| `{ "start": <driver id>, "as": <name> }` | Starts a driver with a fresh token (named, to abort it later). |
| `{ "abort": <name>, "reason"?: <data> }` | Aborts that token. |
| `{ "advance": <ms> }` | Advances virtual time, completing process work that falls due (§22.4), each completion a cycle. |
| `{ "model": <graph model> }` | Observes a new model on the model seed (the erector rewires). |
| `{ "demand": <node id>, "spec": <spec or node id> }` | The host demands the node (for demand vectors). |

and `expect`: `streams` (per node ID, the exact list of entry values or error records, in order), `computes` (per node ID, how many times it computed or ran), `logs` (per `record` effect, its list of runs), `processes` (per process ID, its list of states), and `errors` (the error seed's entries, as `message` strings). Only the members given are checked.

22.3. **Entity vectors** hold `types` (§11.2, with declarative upcasters, §15.3), `script` (steps: `{ "commit": [edits], "options"? }`, `{ "undo": <scope> }`, `{ "redo": <scope> }`, `{ "compact": <node>, "bucket"?: <ms>, "roots"?: [E] }`, `{ "collapse": <node> }`, `{ "purge": <node>, "force"? }`, `{ "advance": <ms> }`, `{ "entries": [ <stored entry> … ] }` to load a stream as stored, e.g. of an older schema) and `expect` (`effective` per node, `refusals` in order as reason codes, `streams` per node as the list of op kinds and seqs, `origins`, `changes` per step as reported paths). Nodes are named in vectors by labels given at creation (`"as"`), which the runner maps to generated IDs.

22.4. **Process work in vectors** is data: `{ "id", "ms": <duration>, "result"?: <data>, "fail"?: <message>, "progress"?: [<data> …], "children"?: [ <work> … ] }`: the process reports each progress item at even intervals, then completes after `ms` with its result (or failure), its children started with it as their parent.

## Appendix A. Examples (non-normative)

**A.1 A diamond.** Seeds `a` (initial 1); combinators `b = sum(a, add 1)`, `c = sum(a, add 2)`, `d = sum(b, c)`; effect `log = record(d)` connected by a running driver. Observing `a = 2`: START reaches b, c (counters 1), d (0→1 from b; 1→2 from c, no further START), log. END: b computes 3, END(changed) to d (2→1); c computes 4, END(changed) to d (1→0): d computes 7 once; log runs once with `[7]`.

**A.2 END on unchanged.** As A.1 but `b = threshold(a, at 10)`, `d = identity(b)`. Observing `a = 3` then `a = 4`: b computes `false` both times; the second time b's value equals its latest, so b sends END(unchanged) and d does not compute.

**A.3 Mid-cycle rewiring.** An effect `rw = rewire(sel)` switches `out`'s inputs between `x` and `y` when `sel` changes. Observing `sel = 1` and `x = 5` in one transaction: `out` computes in that cycle from its old input; the rewiring applies at completion, and the activation cycle primes `out` from `y`.

**A.4 Nested processes.** A `work` driver started as `run` starts process `p` (ms 100) with child `q` (ms 300). At 100, `p` is done; `q` is aborted with reason `{ "parent": "done" }`. Aborting `run` at 50 instead aborts `p` and `q`; their later completions are discarded.

## Appendix B. The TypeScript mapping (non-normative)

In this package: a kernel environment is `createEnvironment({ clock, random })`, with `env.seed`, `env.combinator`, `env.effect`, `env.driver`, `env.transaction`; `driver.start(signal)` returns a process node; cancellation tokens are `Aborter` controllers whose `signal` implements the AbortSignal interface and chains from host `AbortSignal`s; the erector is `erect(env, modelNode, operators)`. The entity layer is `createGraph({ types, rules, sources, store })`. See [README.md](README.md).
