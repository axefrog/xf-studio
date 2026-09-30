# XF Studio's model catalogue

XF Studio runs on a reactive stream graph (XF Strata, `projects/strata/`). This folder is the Studio **described as data**: every piece of stored state, every source of outside input, every piece of work and every flow, as model files. The models come first. Code implements them, tests are derived from them, and a check keeps code and models in agreement. When code and a model disagree, the code is wrong, or the model is changed first, deliberately.

A model file is JSON, one model per file, at `models/<kind>/<id>.json`. Every file has `kind`, `id`, `owner` (a module ID or `platform`), `summary` (one plain sentence) and `status`:
- `current`: the code does this today;
- `target`: the design the Studio is moving to;
- `both`: the model describes both, with `replaces` naming the legacy code.

## Kinds

| Kind | Describes | Main members |
|---|---|---|
| `type` | A stored or session node type | `class` (`authored`, `session`), `schema` (version string), `stream` (`delta` or `value`), `fields` (the engine's field specs: `value`, `ref`, `refs`, `entry`, `map`, with `inherit: false` and `unique`), `defaults`, `constants`, `rules` (conflict rule IDs), `examples`; optional `migration` (where stored data comes from and how) |
| `source` | Where outside input enters (time, randomness, input, files, the host, the game) | `environment` (`page`, `host`, `desktop`, `worker`, `bridge`), `entry` (JSON Schema of an observation), `adapter` (module path of the real adapter), `simulated` (module path or `planned`), `rate` (expected frequency) |
| `sink` | Where the graph sends things out (a log, a file, the game, a mod manager) | `environment`, `input` (JSON Schema), `adapter`, `idempotency` (`none` or the key) |
| `operator` | A named computation a model can use | `nodeKind` (`combinator`, `effect`), `params` (JSON Schema), `inputs`, `output` (JSON Schema), `pure` |
| `driver` | Something that decides what is watched and owns work | `environment`, `serves` (the requests it handles), `demands` (nodes or types it reads), `creates` (families or graph models it erects), `starts` (processes), `runtimes`, `raises` (requests it raises of other drivers), `faults` (see below), `lifetime` (what starts and ends it) |
| `process` | Long-running work | `driver`, `work` (one sentence), `progress`, `result` and `failure` (JSON Schemas; large data as blob references), `cancel` (how an abort reaches the work), `cleanup`, `deadline` (its time budget: a number of ms, or plain words), `lane` (pool and priority), optional `faults`, `results` (JSON Schema of each result it streams) and `suspend` (what happens to the work while it is suspended) |
| `runtime` | A host object kept out of the graph (a GL context, a scene, a worker, a texture set) | `key` (the node tuple it is kept per), `factory` (adapter module), `ready` (the node publishing readiness), `query` (the synchronous answers it gives, plain data only), `linger` (ms), optional `environment` |
| `request` | Something one part asks another to achieve | `goal` (JSON Schema of the goal), `accepts` (JSON Schema of valid input: a request outside it is the requester's fault), `reasons` (the reason tags it may be raised with), `servedBy` (drivers, ranked; later ones are fallbacks), optional `faults`, `key` (what a newer request replaces), `deadline` (ms by which it must be answered), `linger` (ms the work is kept after the last request for it ends), `standIn` (a weaker goal served when the request's own can't be, with a notice), and `root: true` when it is raised from outside the graph (the person opening a window, the operating system) rather than by another model |
| `action` | Something a person can do | `name` (the name it is dispatched by), `target` (type), `input` (JSON Schema of its payload), `capability` (when it's available, and the reason when not), `effect` (the commit it makes or the request it raises), `undo` (scope) |
| `panel` | A panel's contract with the graph | `binding` (pointer or type), `reads` (queries and nodes), `actions` |
| `flow` | A path through the system, end to end | `steps` (models in order, each with what it does), `demand` (where demand comes from), `faults` (where each failure goes), `budget` (latency and memory), `invariants` (checked after every step in its simulation) |

**Field specs.** A type's `fields` map each field name to an engine field spec: `{ "kind": "value" }`, `{ "kind": "ref" | "refs", "to": <type reference, list of them, or "*">, "clone": "follow" | "share", "follows"?: true }`, `{ "kind": "entry" }` or `{ "kind": "map", "of": <field kind> }`, with `inherit: false` for identity and `unique: true`. A field spec may also carry `doc` (one plain sentence) and `shape` (a JSON Schema of its value, or of each map value), which the engine ignores.

**Faults** (drivers, processes, requests, flows): `[{ "code", "when", "fault": "requester" | "owner" | "shared", "goesTo", "then": "suspend" | "fallback" | "fail" }]`. A requester's fault is input outside the request's `accepts`. An owner's fault is a failed approach, which goes to whoever owns the driver and on up to whoever implemented it. A shared fault is a mismatch between the two sides. `goesTo` is a model reference, `person` (shown in plain words with the one next step), or `diagnostics` (the host log, with a reference the person can quote).

**Requests and reasons.** Every driver run serves a request. A request records what it is `for` (the request whose work raised it), its `reason` (why it matters to that work, for example `{ "supplies": ["v", "details"] }` or `{ "blocks": "cleanup" }`) and its `goal`. The chain of `for` links answers "why is this running?" anywhere in the graph. One run can serve several requests with the same goal, and ends only when the last one ends. The rest follows from that:

- **Sharing and replacing.** Requests with the same goal served by the same driver share one run. A request from the same requester with the same `key` replaces the older one; the new one is served first, so shared work never restarts in between. A reason can be something that must stay true (the person's consent to exactly one download): when it changes, the request ends.
- **Ending.** A request ends when whoever raised it withdraws it, when the work it is `for` ends, when it is replaced, or when the run serving it finishes with nothing left to do. A run ends when its last request ends, after the request's `linger`, so asking again soon is free.
- **Failures.** A failed approach tries the next driver in `servedBy`, then the `standIn`, carrying the request's `deadline`. What can't be handled there goes to whoever raised the request, and on up to the person or the diagnostics log. Work that depends on it is suspended, not torn down, and carries on where it stopped once the failure is fixed (for example, by a request raised to fix it, such as setting up WolvenKit).
- **Suspension.** Work is paused while the person's own work runs, or while it waits for a fix; a process's time budget doesn't run while it is paused, a request's `deadline` does.
- **One per key.** Runtimes and derived values made per key (per V and scene, per part, per layer) exist while something asks for them and for their `linger` after.

**Shared shapes.** Descriptors used by several models (a blob reference, a raster key, a character record, an installation, a fault record) are defined once in `schema/shapes.schema.json`; a model's JSON Schemas refer to them with `{ "$ref": "shapes.schema.json#/$defs/<name>" }`.

**Gaps.** Where something doesn't fit the format or the engine cleanly, the model is written as it *should* be, with an `x-friction` member: `[{ "gap", "capability", "closes" }]`, where `capability` is one of the plain capability keys listed in [INDEX.md](INDEX.md) and `closes` says in plain words what that capability would have to do.

## Rules

- **One model per file.** IDs are kebab-case and unique within a kind. References between models use `<kind>:<id>` (`type:v`, `process:v-prepare`), and must resolve.
- **Plain data only.** Host objects appear only as `runtime` models. Large data appears as blob references (`{ "$blob": … }`), never inline.
- **Every legacy piece is accounted for.** `replaces` lists the modules a `target` or `both` model takes over, as paths under `projects/xf-studio/authoring/src/` without the `.ts` (`character-context-actions`, `platform/scene/scene-host`; a module outside `src/` starts with `../`, as in `../desktop/workspace-store`). The check fails if a module in the direct-read or singleton ratchets isn't named by some model's `replaces`, unless [coverage-exclusions.json](coverage-exclusions.json) lists it with a reason.
- **Members starting with `x-`** are notes for reviewers: allowed anywhere, never read by the Studio.
- **Plain words.** Models describe the Studio in ordinary terms, like the rest of this repository.
- `bun test tests/models.test.ts` (in `projects/xf-studio/authoring`) validates every file against its kind's schema (`models/schema/<kind>.schema.json`), resolves every reference, and checks the coverage above and that [INDEX.md](INDEX.md) is current (`bun tools/models-index.ts` regenerates it). From the V slice (G2) onwards, it also checks that the types, drivers and sources the Studio registers are exactly those its `current` models declare.

## Status

The catalogue describes the whole Studio: every stored and session type, source, sink, operator, driver, process, runtime and request, the action catalogue, the panels and ten cross-cutting flows. [INDEX.md](INDEX.md) has the counts and, per legacy module, the models that replace it. [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) lists the design decisions awaiting the model review. Every later slice of the Studio's move onto the graph starts by changing these models (see the development loop in AGENTS.md).
