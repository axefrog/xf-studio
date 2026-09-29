# Mutants no test can tell from the engine

`bun tools/mutate.ts` counts a mutant the suite survives as a missing test unless it is listed here, by its key, with the reason no test can tell it apart from the engine: the change is unreachable, or it changes nothing a caller can observe. A mutant that changes only a message a person reads is not listed: a test checks the message instead.

A key is the file (from the repository root), the function, the kind of change, the code changed, its replacement, and which occurrence of that change in the function it is (see `tools/mutate.ts`). Keys survive edits elsewhere in a file; a key that no longer matches a mutant is ignored, so remove it with the code it described. Line numbers aren't kept for the same reason.

## projects/strata/src/kernel/abort.ts

- ``projects/strata/src/kernel/abort.ts|Aborter.constructor.once|boolean flip|!0|!1|0``
  Aborting a controller releases its link to every parent (`release`), so whether a parent also drops the listener after firing changes nothing.
- ``projects/strata/src/kernel/abort.ts|Aborter.constructor|push → unshift|push|unshift|0``
  Each unlink removes one listener from one parent; the order they run in doesn't matter.
- ``projects/strata/src/kernel/abort.ts|Aborter.abort|test → false|this.signal.aborted|false|0``
  A second abort then releases nothing (the links are already gone) and the signal ignores a second fire, keeping its first reason.
- ``projects/strata/src/kernel/abort.ts|Aborter.abort|early return removed|return;|;|0``
  As above: a second abort finds nothing to release and nothing to fire.
- ``projects/strata/src/kernel/abort.ts|Aborter.release|statement removed|this.unlink = [];|;|0``
  Unlinking is idempotent (removing a listener twice removes it once), and the kept closures only point from the child to parents that outlive it.

## projects/strata/src/kernel/operators.ts

- ``projects/strata/src/kernel/operators.ts|inputError|early return removed|return;|;|0``
  The function ends there anyway (the transpiled `return undefined`), returning undefined either way.
- ``projects/strata/src/kernel/operators.ts|scan.compute|test → true|!entry.error|true|0``
  Unreachable: the input-error guard before it returns an input's error first, so no error entry reaches the fold (see `uncovered-branches.md`).
- ``projects/strata/src/kernel/operators.ts|node.compute|test → false|innerView.error|false|0``
  Unreachable for the same reason: an error on the inner node is an input error, returned by the guard first.
- ``projects/strata/src/kernel/operators.ts|record|&& → |||&&||||1``
  With the second test loosened, a string, number or array passes through as the record; every member the operators read of it (`add`, `path`, `at`, `initial`, `inputs`, `states`) is then absent or not a number or list, exactly as on the empty record.
- ``projects/strata/src/kernel/operators.ts|own|&& → |||&&||||1``
  A state machine's states or events that aren't an object then yield a character or nothing; a character has no `on` or `target`, so no transition fires either way.

## projects/strata/src/kernel/erector.ts

- ``projects/strata/src/kernel/erector.ts|name|test → true|item.kind === "seed"|true|0``
  A node of another kind without an operator name then finds the seed operator, whose kind doesn't match its own: it is refused with the same code and message.
- ``projects/strata/src/kernel/erector.ts|operator|test → true|Object.hasOwn(operators, name)|true|0``
  An inherited member of the catalogue (a name such as `toString`) is a function with no kind: refused as no operator of that kind, with the same message.
- ``projects/strata/src/kernel/erector.ts|erect|test → true|item.initial !== void 0|true|0``
  An `initial` of undefined is treated as none (`seed` appends only a defined first entry).
- ``projects/strata/src/kernel/erector.ts|erect|test → true|spec.activate|true|0``
  An `activate` of undefined is the same as none.
- ``projects/strata/src/kernel/erector.ts|erect|statement removed|current.model = item;|;|0``
  A kept node's model is compared only by its shape (kind, operator, parameters, first entry), which the kept model already has: only inputs and demand can differ, and those are read from the new model.
- ``projects/strata/src/kernel/erector.ts|driver.start|test → true|item.node.kind !== "effect"|true|0``
  The erected effects belong to the run, which disconnects them when it ends; disconnecting one again changes nothing.

## projects/strata/src/kernel/kernel.ts

- ``projects/strata/src/kernel/kernel.ts|KNode.retainAll|boolean flip|!1|!0|0``
  Every node is registered before use, and registering sets `retainAll` from the environment.
- ``projects/strata/src/kernel/kernel.ts|Scope.constructor|statement removed|this.env = env;|;|0``
  Nothing reads a scope's environment: scopes never leave the kernel.
- ``projects/strata/src/kernel/kernel.ts|KNode.dirty|boolean flip|!1|!0|0``
  A node's first computation always follows its priming (activation primes it), which marks it dirty; the initial flag is never read.
- ``projects/strata/src/kernel/kernel.ts|HostDemand.constructor|statement removed|this.label = label;|;|0``
  A host demand's label is kept for a person inspecting it; nothing reads it.
- ``projects/strata/src/kernel/kernel.ts|Environment.cycleAt|number changed|0|1|0``
  `cycleAt` is set when each cycle starts and read only while one runs.
- ``projects/strata/src/kernel/kernel.ts|Environment.constructor|statement removed|this.scopes.set(this.root, this.rootScope);|;|0``
  The root never finishes, and only a finishing process looks its scope up; the root's scope is used directly.
- ``projects/strata/src/kernel/kernel.ts|Environment.removeNow|test → true|consumer instanceof HostDemand|true|0``
  Releasing a node consumer's edge on a node being forgotten changes nothing observable: the forgotten node is deactivated either way, and a consumer releasing it later finds no edge.
- ``projects/strata/src/kernel/kernel.ts|Environment.removeNow|test → true|node.kind === "effect"|true|0``
  Disconnecting a node that isn't a connected effect returns at once (it has no scope).
- ``projects/strata/src/kernel/kernel.ts|Environment.removeNow|test → true|node.active && node.kind !== "effect"|true|0``
  Deactivating a node that is already inactive, or an effect just disconnected, changes nothing.
- ``projects/strata/src/kernel/kernel.ts|Environment.removeNow|&& → |||&&||||0``
  As above: the extra cases are inactive nodes, which deactivating again leaves as they are.
- ``projects/strata/src/kernel/kernel.ts|Environment.release|push → unshift|push|unshift|0``
  Every change that adds something (a demand, a connection, an effect) checks its token before it applies, and rewiring an inactive node demands nothing: releases running first end in the same state.
- ``projects/strata/src/kernel/kernel.ts|Environment.change.release|boolean flip|!1|!0|0``
  When the activation bound is reached no change is pending (the loop applies every pending change before it counts an activation), so which changes would be dropped is never asked.
- ``projects/strata/src/kernel/kernel.ts|Environment.release.release|boolean flip|!0|!1|0``
  When the activation bound is reached no change is pending (the loop applies every pending change before it counts an activation), so which changes would be dropped is never asked.
- ``projects/strata/src/kernel/kernel.ts|Environment.drain|continue removed|continue;|;|1``
  After the bound, the primed set is empty, so the rest of the loop body does nothing before the loop continues.
- ``projects/strata/src/kernel/kernel.ts|Environment.drain|test → true|primed.length|true|0``
  A deactivated node leaves the primed set (`deactivate`), so the active filter never empties a non-empty set.
- ``projects/strata/src/kernel/kernel.ts|Environment.drain|statement removed|this.pendingChanges = this.pendingChanges.filter((change) => change.release);|;|0``
  When the activation bound is reached no change is pending (the loop applies every pending change before it counts an activation), so which changes would be dropped is never asked.
- ``projects/strata/src/kernel/kernel.ts|Environment.consumersOf|test → true|consumer instanceof KNode && consumer.active|true|0``
  Every node consumer on an edge is active (edges are added on activation and released on deactivation); a host demand let through is filtered out again (it has no count or activity), so no extra node takes part in a cycle.
- ``projects/strata/src/kernel/kernel.ts|Environment.consumersOf|&& → |||&&||||0``
  Every node consumer on an edge is active (edges are added on activation and released on deactivation); a host demand let through is filtered out again (it has no count or activity), so no extra node takes part in a cycle.
- ``projects/strata/src/kernel/kernel.ts|start|push → unshift|push|unshift|0``
  The participants list is only walked to trim and to find unbalanced nodes; its order doesn't matter.
- ``projects/strata/src/kernel/kernel.ts|finish|statement removed|node.startedTo = [];|;|0``
  A node's `startedTo` is set afresh whenever a cycle first starts it; the old list is never read.
- ``projects/strata/src/kernel/kernel.ts|Environment.runCycle|push → unshift|push|unshift|1``
  The participants list is only walked to trim and to find unbalanced nodes; its order doesn't matter.
- ``projects/strata/src/kernel/kernel.ts|Environment.runCycle|statement removed|node.dirty = !0;|;|0``
  A primed node is marked dirty twice: when it starts and when the wiring seed ends at it with a change; either alone makes it compute.
- ``projects/strata/src/kernel/kernel.ts|Environment.runCycle|boolean flip|!0|!1|1``
  A primed node is marked dirty twice: when it starts and when the wiring seed ends at it with a change; either alone makes it compute.
- ``projects/strata/src/kernel/kernel.ts|Environment.runCycle|statement removed|seed.startedTo = [];|;|0``
  A node's `startedTo` is set afresh whenever a cycle first starts it; the old list is never read.
- ``projects/strata/src/kernel/kernel.ts|Environment.runCycle|boolean flip|!0|!1|3``
  A primed node is marked dirty twice: when it starts and when the wiring seed ends at it with a change; either alone makes it compute.
- ``projects/strata/src/kernel/kernel.ts|Environment.runCycle|statement removed|node.startedTo = [];|;|0``
  A node's `startedTo` is set afresh whenever a cycle first starts it; the old list is never read.
- ``projects/strata/src/kernel/kernel.ts|Environment.runCycle|boolean flip|!1|!0|0``
  An unbalanced node (only when a host callback throws mid-cycle) keeping its dirty flag computes once more from unchanged inputs: a pure computation gives the same value, so nothing is appended or reported.
- ``projects/strata/src/kernel/kernel.ts|Environment.runCycle|statement removed|node.dirty = !1;|;|0``
  An unbalanced node (only when a host callback throws mid-cycle) keeping its dirty flag computes once more from unchanged inputs: a pure computation gives the same value, so nothing is appended or reported.
- ``projects/strata/src/kernel/kernel.ts|follower.run|test → true|consumer instanceof KNode && consumer.active|true|0``
  Every node consumer on an edge is active (edges are added on activation and released on deactivation); a host demand let through is filtered out again (it has no count or activity), so no extra node takes part in a cycle.
- ``projects/strata/src/kernel/kernel.ts|fresh|test → true|changed|true|0``
  When an input didn't change in this cycle it has no entry from this cycle, so the filter finds none either way.
- ``projects/strata/src/kernel/kernel.ts|follower.run|&& → |||&&||||0``
  Every node consumer on an edge is active (edges are added on activation and released on deactivation); a host demand let through is filtered out again (it has no count or activity), so no extra node takes part in a cycle.
- ``projects/strata/src/kernel/kernel.ts|Environment.updateDemand|test → true|demand instanceof KNode|true|0``
  For a plain spec, comparing its source (none) with the spec never matches, so the edge is set again to the same spec: the same state.
- ``projects/strata/src/kernel/kernel.ts|Environment.dropFollower|statement removed|edge.follower = void 0;|;|0``
  A dropped follower is disconnected and forgotten; doing it again, or deleting an ID it no longer holds, changes nothing (IDs aren't reused within a batch).
- ``projects/strata/src/kernel/kernel.ts|Environment.dropFollower|test → true|this.nodes.get(edge.follower.id) === edge.follower|true|0``
  A dropped follower is disconnected and forgotten; doing it again, or deleting an ID it no longer holds, changes nothing (IDs aren't reused within a batch).
- ``projects/strata/src/kernel/kernel.ts|Environment.deactivate|statement removed|this.primed.delete(node);|;|0``
  The drain filters the primed set by activity before running it, so an inactive node left in it never runs.
- ``projects/strata/src/kernel/kernel.ts|Environment.deactivate|test → true|node.kind === "combinator" || node.kind === "effect"|true|0``
  Seeds, drivers and processes have no inputs to release.
- ``projects/strata/src/kernel/kernel.ts|Environment.deactivate|statement removed|node.activationAborter = void 0;|;|0``
  The aborter kept is already aborted; aborting it again does nothing, and the next activation replaces it.
- ``projects/strata/src/kernel/kernel.ts|Environment.deactivate|slice → splice|slice|splice|0``
  `splice(-1)` returns the same one-entry list that `slice(-1)` does, and the held list is replaced by it.
- ``projects/strata/src/kernel/kernel.ts|Environment.hostDemand|early return removed|return;|;|0``
  With the token already aborted, the queued change checks it and adds nothing, and `onAbort` registers nothing.
- ``projects/strata/src/kernel/kernel.ts|Environment.hostDemand|test → false|signal.aborted|false|0``
  With the token already aborted, the queued change checks it and adds nothing, and `onAbort` registers nothing.
- ``projects/strata/src/kernel/kernel.ts|Environment.reaches|test → false|seen.has(node)|false|0``
  The cycle check walks an acyclic graph (cycles are refused), so revisiting nodes, or visiting them in another order, only costs time.
- ``projects/strata/src/kernel/kernel.ts|Environment.reaches|continue removed|continue;|;|0``
  The cycle check walks an acyclic graph (cycles are refused), so revisiting nodes, or visiting them in another order, only costs time.
- ``projects/strata/src/kernel/kernel.ts|Environment.connectEffect|statement removed|scope.effects.push(effect);|;|0``
  A run's connected effects are also its own nodes (`run.effect` is the only way into a run's scope), and a run's end forgets every one of those, which disconnects them; the root scope never ends.
- ``projects/strata/src/kernel/kernel.ts|Environment.reaches|statement removed|seen.add(node);|;|0``
  The cycle check walks an acyclic graph (cycles are refused), so revisiting nodes, or visiting them in another order, only costs time.
- ``projects/strata/src/kernel/kernel.ts|Environment.reaches|push → unshift|push|unshift|0``
  The cycle check walks an acyclic graph (cycles are refused), so revisiting nodes, or visiting them in another order, only costs time.
- ``projects/strata/src/kernel/kernel.ts|Environment.connectEffect|push → unshift|push|unshift|0``
  A run's connected effects are also its own nodes (`run.effect` is the only way into a run's scope), and a run's end forgets every one of those, which disconnects them; the root scope never ends.
- ``projects/strata/src/kernel/kernel.ts|Environment.disconnect|test → true|index >= 0|true|0``
  A connected effect is always in its scope's list (it is pushed when connected), so the index is never -1.
- ``projects/strata/src/kernel/kernel.ts|Environment.disconnect|test → true|effect.active|true|0``
  Deactivating an inactive effect changes nothing.
- ``projects/strata/src/kernel/kernel.ts|Environment.forgetEffect|test → false|index >= 0|false|0``
  Only the run's own list of its effects differs: an effect forgotten early stays in it until the run ends, whose end forgets it again (idempotently); nothing else reads the list, and the effect is disconnected and out of the environment either way.
- ``projects/strata/src/kernel/kernel.ts|Environment.forgetEffect|>= → <|>=|<|0``
  Only the run's own list of its effects differs: an effect forgotten early stays in it until the run ends, whose end forgets it again (idempotently); nothing else reads the list, and the effect is disconnected and out of the environment either way.
- ``projects/strata/src/kernel/kernel.ts|Environment.forgetEffect|number changed|0|1|0``
  Only the run's own list of its effects differs: an effect forgotten early stays in it until the run ends, whose end forgets it again (idempotently); nothing else reads the list, and the effect is disconnected and out of the environment either way.
- ``projects/strata/src/kernel/kernel.ts|Environment.forgetEffect|>= → >|>=|>|0``
  Only the run's own list of its effects differs: an effect forgotten early stays in it until the run ends, whose end forgets it again (idempotently); nothing else reads the list, and the effect is disconnected and out of the environment either way.
- ``projects/strata/src/kernel/kernel.ts|Environment.forgetEffect|statement removed|scope.nodes.splice(index, 1);|;|0``
  Only the run's own list of its effects differs: an effect forgotten early stays in it until the run ends, whose end forgets it again (idempotently); nothing else reads the list, and the effect is disconnected and out of the environment either way.
- ``projects/strata/src/kernel/kernel.ts|Environment.forgetEffect|test → true|this.nodes.get(effect.id) === effect|true|0``
  Only the run's own list of its effects differs: an effect forgotten early stays in it until the run ends, whose end forgets it again (idempotently); nothing else reads the list, and the effect is disconnected and out of the environment either way.
- ``projects/strata/src/kernel/kernel.ts|Environment.forgetEffect|number changed|1|0|0``
  Only the run's own list of its effects differs: an effect forgotten early stays in it until the run ends, whose end forgets it again (idempotently); nothing else reads the list, and the effect is disconnected and out of the environment either way.
- ``projects/strata/src/kernel/kernel.ts|Environment.connect|test → false|signal.aborted|false|0``
  With the token already aborted, the queued change checks it and connects nothing, and `onAbort` registers nothing.
- ``projects/strata/src/kernel/kernel.ts|Environment.connect|early return removed|return;|;|0``
  With the token already aborted, the queued change checks it and connects nothing, and `onAbort` registers nothing.
- ``projects/strata/src/kernel/kernel.ts|Environment.read|test → false|node.active || this.inCycle || this.applying|false|0``
  Taking the one-shot path while a cycle or a change runs queues a demand that checks its token when it applies, and the token is aborted before then: nothing activates, and the latest entry read is the same.
- ``projects/strata/src/kernel/kernel.ts|Environment.read||| → &&||||&&|0``
  Taking the one-shot path while a cycle or a change runs queues a demand that checks its token when it applies, and the token is aborted before then: nothing activates, and the latest entry read is the same.
- ``projects/strata/src/kernel/kernel.ts|Environment.read||| → &&||||&&|1``
  Taking the one-shot path while a cycle or a change runs queues a demand that checks its token when it applies, and the token is aborted before then: nothing activates, and the latest entry read is the same.
- ``projects/strata/src/kernel/kernel.ts|Environment.trim|<= → <|<=|<|0``
  With at most one entry, filtering keeps the latest anyway: the same entries.
- ``projects/strata/src/kernel/kernel.ts|Environment.trim|number changed|1|0|0``
  With at most one entry, filtering keeps the latest anyway: the same entries.
- ``projects/strata/src/kernel/kernel.ts|Environment.startDriver|test → true|options.role|true|0``
  A role of undefined is left out of the process tree like no role.
- ``projects/strata/src/kernel/kernel.ts|Environment.startDriver|early return removed|return;|;|0``
  It is the only statement of a function that does nothing (the run of a definition returning nothing waits for its token).
- ``projects/strata/src/kernel/kernel.ts|Environment.runContext.effect|push → unshift|push|unshift|0``
  The order of a run's own effects doesn't matter: its end forgets all of them.
- ``projects/strata/src/kernel/kernel.ts|finish|statement removed|this.scopes.delete(process);|;|0``
  A finished process never finishes again (`terminal`), so its scope entry is never looked up again.
- ``projects/strata/src/kernel/kernel.ts|Environment.begin|test → true|!signal.aborted|true|1``
  A finish after the token aborted returns at once: the process already finished as aborted.
- ``projects/strata/src/kernel/kernel.ts|finish|statement removed|this.disconnect(effect);|;|0``
  A run's connected effects are also its own nodes (`run.effect` is the only way into a run's scope), and a run's end forgets every one of those, which disconnects them; the root scope never ends.
- ``projects/strata/src/kernel/kernel.ts|Environment.begin|test → true|!signal.aborted|true|0``
  A finish after the token aborted returns at once: the process already finished as aborted.
- ``projects/strata/src/kernel/kernel.ts|index|test → true|siblings|true|0``
  Every process but the root has a parent that lists it until it is forgotten, which happens once (`terminal`), and the root is never forgotten: the guarded cases never occur.
- ``projects/strata/src/kernel/kernel.ts|Environment.forgetProcess|test → true|this.nodes.get(process.id) === process|true|0``
  Every process but the root has a parent that lists it until it is forgotten, which happens once (`terminal`), and the root is never forgotten: the guarded cases never occur.
- ``projects/strata/src/kernel/kernel.ts|Environment.forgetProcess|test → true|siblings && index >= 0|true|0``
  Every process but the root has a parent that lists it until it is forgotten, which happens once (`terminal`), and the root is never forgotten: the guarded cases never occur.
- ``projects/strata/src/kernel/kernel.ts|Environment.forgetProcess|&& → |||&&||||0``
  Every process but the root has a parent that lists it until it is forgotten, which happens once (`terminal`), and the root is never forgotten: the guarded cases never occur.
- ``projects/strata/src/kernel/kernel.ts|validSpec|test → false|spec.latest === !0|false|0``
  A spec that falls through every other form is read as latest anyway.
- ``projects/strata/src/kernel/kernel.ts|validSpec|boolean flip|!0|!1|0``
  A spec that falls through every other form is read as latest anyway.
- ``projects/strata/src/kernel/kernel.ts|validSpec.range|test → true|range.to !== void 0|true|0``
  A range with `to` undefined keeps what one without `to` keeps (an absent member).
- ``projects/strata/src/kernel/kernel.ts|validSpec|test → true|"query" in spec|true|0``
  A query spec and the latest spec keep and cover the same entries (only the latest).
- ``projects/strata/src/kernel/kernel.ts|validSpec|test → false|"query" in spec|false|0``
  A query spec and the latest spec keep and cover the same entries (only the latest).


## projects/strata/src/graph.ts

- ``projects/strata/src/graph.ts|StrataGraph.token|number changed|0|1|0``
  The append token is only compared with itself (the reply of the append in flight); its starting value is never seen.
- ``projects/strata/src/graph.ts|StrataGraph.storeHead|number changed|0|1|0``
  It is read only while handling a store reply, after the reply's positions (which start at 1) have raised it.
- ``projects/strata/src/graph.ts|StrataGraph.constructor.session|boolean flip|!1|!0|0``
  A constant is never edited, stored, trimmed or collapsed, so whether it is marked as a session node is never read.
- ``projects/strata/src/graph.ts|StrataGraph.constructor|statement removed|this.head.referrers = (ref) => this.referrers(ref);|;|0``
  Without it the head model finds referrers by scanning the live nodes, which gives what the reference index holds (the simulation checks the index against such a scan).
- ``projects/strata/src/graph.ts|actor|test → true|options.members|true|0``
  Without members, the driver definition gets `members: undefined`, which the inspector reads exactly as absent.
- ``projects/strata/src/graph.ts|store.start.once|boolean flip|!0|!1|0``
  An abort signal fires once; the listener runs once either way.
- ``projects/strata/src/graph.ts|StrataGraph.defaultsOf|test → true|!this.defaultsMemo.has(type)|true|0``
  A memo: a type's defaults are computed afresh as an equal, frozen value.
- ``projects/strata/src/graph.ts|StrataGraph.load|statement removed|this.loaded = !0;|;|0``
  A graph without a store is loaded from construction; the flag is already set.
- ``projects/strata/src/graph.ts|StrataGraph.load|boolean flip|!0|!1|0``
  As above: the constructor has already set the flag, and nothing clears it.
- ``projects/strata/src/graph.ts|StrataGraph.load|push → unshift|push|unshift|0``
  Only the order the stale-snapshot streams are read in changes; each is installed whole.
- ``projects/strata/src/graph.ts|StrataGraph.load|statement removed|this.storeHead = Math.max(this.storeHead, stored.head);|;|0``
  It is read only while handling a store reply, after the reply's positions (all above the loaded head) have raised it past the loaded head.
- ``projects/strata/src/graph.ts|StrataGraph.load|max → min|max|min|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.load|test → true|rec|true|0``
  Unreachable: a node noted as slow to fold was installed by this load, and nothing removes records during it.
- ``projects/strata/src/graph.ts|StrataGraph.load|statement removed|this.slowFolds.clear();|;|0``
  A node snapshotted by one load has nothing to snapshot again at the next unless it has newer acknowledged entries, and those are snapshotted at the interval anyway. The set is only read by load.
- ``projects/strata/src/graph.ts|StrataGraph.installRecord|test → true|entry.pos > this.headPos|true|0``
  A load and a sync both raise the head position to the store's head, which is at or past every stored entry, before anything reads it.
- ``projects/strata/src/graph.ts|StrataGraph.installRecord|test → false|entry.pos > this.headPos|false|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.installRecord|> → >=|>|>=|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.installRecord|> → <=|>|<=|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.installRecord|statement removed|this.headPos = entry.pos;|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.installRecord|test → false|item.host.node.id === ref.id|false|0``
  A reinstalled host holds the same inlined streams as before (they can't be edited, and compaction keeps every entry holding them), so dropping and adding them again gives the same state and index.
- ``projects/strata/src/graph.ts|StrataGraph.installRecord|statement removed|this.inlined.delete(id);|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.installRecord|statement removed|this.indexLayers(id, item.state, null);|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.loadReachable|> → >=|>|>=|0``
  A base at seq 0 is at position 0, which is never after a point read.
- ``projects/strata/src/graph.ts|StrataGraph.loadReachable|number changed|0|1|0``
  A snapshot at seq 1 is at the node's first entry; no state before that entry names the node as a source (a layer names only a source that exists when committed), and the node's own entries in memory all follow it.
- ``projects/strata/src/graph.ts|StrataGraph.loadReachable|push → unshift|push|unshift|0``
  Only the order in which the needed histories are visited changes; `seen` makes the set loaded the same.
- ``projects/strata/src/graph.ts|StrataGraph.historyAt|> → >=|>|>=|0``
  A base at seq 0 is at position 0, which is never after a point read.
- ``projects/strata/src/graph.ts|StrataGraph.historyAt|number changed|0|1|0``
  As for `loadReachable`: a snapshot at seq 1 is at the node's first entry, before which nothing names it.
- ``projects/strata/src/graph.ts|StrataGraph.historyAt|> → >=|>|>=|1``
  The point is the position of an entry in memory, and the entry at a node's base position is held only by its snapshot, never in memory: the two are never equal.
- ``projects/strata/src/graph.ts|StrataGraph.loadHistory|&& → |||&&||||0``
  A base is either no snapshot (seq 0, state null) or a snapshot's state (seq > 0, never null), so either test alone decides.
- ``projects/strata/src/graph.ts|StrataGraph.loadHistory|test → false|!this.store|false|0``
  Unreachable: only a stored graph loads records from snapshots (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.loadHistory|early return removed|return;|;|1``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.loadHistory|test → false|!current || current !== rec|false|0``
  The check keeps a history read from being written into a record that was dropped or replaced meanwhile; nothing reads a detached record, and forgetting cached points and refreshing pins recompute the same answers.
- ``projects/strata/src/graph.ts|StrataGraph.loadHistory||| → &&||||&&|3``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.loadHistory|early return removed|return;|;|2``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.loadHistory|> → >=|>|>=|0``
  The entries in memory all follow the base, so none has the base's seq.
- ``projects/strata/src/graph.ts|StrataGraph.after|test → false|rec && rec.base.seq <= seq|false|0``
  The fallback loads the node's history first and filters the same entries; only the extra load differs, which changes nothing read.
- ``projects/strata/src/graph.ts|StrataGraph.after|<= → <|<=|<|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.pointOf|test → true|!this.commitEnds.has(entry.commit)|true|0``
  A cache: the commit ends are computed again from the same entries.
- ``projects/strata/src/graph.ts|StrataGraph.pointOf|statement removed|this.commitEnds.clear();|;|0``
  Every change to entries or positions clears the commit ends (`forgetTimes`); ends kept from before are still right, and positions only ever move up.
- ``projects/strata/src/graph.ts|note|> → >=|>|>=|0``
  Two entries never share a position.
- ``projects/strata/src/graph.ts|StrataGraph.toPos|< → <=|<|<=|0``
  Positions start at 1: a commit in memory never has its greatest position at 0.
- ``projects/strata/src/graph.ts|StrataGraph.toPos|number changed|0|1|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.stateAt|test → false|rec.constant|false|0``
  A constant has no entries and a base at position 0, so the next test returns its head as well.
- ``projects/strata/src/graph.ts|StrataGraph.stateAt|test → false|last ? last.pos <= pos : rec.base.pos <= pos|false|0``
  Folding every entry up to the point gives the head when the point is at or past the last entry.
- ``projects/strata/src/graph.ts|StrataGraph.stateAt|<= → <|<=|<|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.stateAt|<= → <|<=|<|1``
  As above (with no entries, the fold is the base's state, which is the head).
- ``projects/strata/src/graph.ts|StrataGraph.stateAt|> → >=|>|>=|0``
  A base at seq 0 is at position 0, which is never after a point read.
- ``projects/strata/src/graph.ts|StrataGraph.modelAt|test → false|model|false|0``
  A cache: the model at a point is built again from the same records.
- ``projects/strata/src/graph.ts|reader.state|test → true|!states.has(ref.id)|true|0``
  A memo: the state is folded again from the same entries.
- ``projects/strata/src/graph.ts|reader.state|test → true|!states.has(ref.id)|true|1``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.modelAt|test → true|this.timeModels.size > 16|true|0``
  The views cache only bounds its size; what it evicts is built again from the same records.
- ``projects/strata/src/graph.ts|StrataGraph.modelAt|test → false|this.timeModels.size > 16|false|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.modelAt|> → >=|>|>=|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.modelAt|> → <=|>|<=|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.modelAt|statement removed|this.timeModels.delete(this.timeModels.keys().next().value);|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.modelAt|statement removed|this.timeModels.set(pos, model);|;|0``
  As above: a model not cached is built again when asked for.
- ``projects/strata/src/graph.ts|StrataGraph.pinnedModel|test → false|!layer.at|false|0``
  Unreachable: the resolver asks for a pinned model only for a layer with a pin (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.at|test → true|typeof point !== "number" && point !== "head"|true|0``
  A position or the head names the same position after the loads as before: loading history moves neither.
- ``projects/strata/src/graph.ts|StrataGraph.at|&& → |||&&||||2``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.viewOf.referrers|test → false|model === this.head|false|0``
  The head model's referrers are the graph's reference index, set in the constructor.
- ``projects/strata/src/graph.ts|StrataGraph.range|test → true|rec.base.seq > 0 && rec.base.pos > from|true|0``
  Only loads more history; the entries in the range are the same.
- ``projects/strata/src/graph.ts|StrataGraph.range|&& → |||&&||||0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.range|> → >=|>|>=|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.range|> → >=|>|>=|1``
  As above: a node whose base is at `from` has nothing in the range before it.
- ``projects/strata/src/graph.ts|StrataGraph.range|push → unshift|push|unshift|0``
  The range is sorted by position before it is returned.
- ``projects/strata/src/graph.ts|StrataGraph.build|test → false|!state|false|0``
  Unreachable: every node a change orders has a working state (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.build|continue removed|continue;|;|0``
  As above.
- ``projects/strata/src/graph.ts|clash|find → findLast|find|findLast|0``
  Only whether a clash exists is used.
- ``projects/strata/src/graph.ts|at|every → some|every|some|0``
  A path with a part that isn't text names no field: `kindAt` finds nothing for it either.
- ``projects/strata/src/graph.ts|StrataGraph.buildEdit|test → true|state.own[pathKey(edit.path)] !== void 0|true|0``
  An op that changes nothing is dropped when it is pushed (no entry, nothing to undo), so the early test only saves work.
- ``projects/strata/src/graph.ts|StrataGraph.buildEdit|test → true|edit.name !== state.name|true|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.buildEdit|test → false|!state.layers.length|false|0``
  As above: detaching a node without layers pushes nothing that changes it.
- ``projects/strata/src/graph.ts|StrataGraph.buildEdit|early return removed|return;|;|9``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.buildCreate|statement removed|work.refs.set(id, ref);|;|0``
  Pushing the create op records the reference as well; before it, the layer checks never look the new node up by its reference.
- ``projects/strata/src/graph.ts|checked|test → true|layers.length|true|0``
  Checking an empty list of layers gives an empty list.
- ``projects/strata/src/graph.ts|visit|test → false|!state|false|0``
  Unreachable: the clone's root is checked when the edit names it, and a followed target only when it has a state (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|visit|statement removed|refuse("missing", "Something to clone no longer exists.");|;|0``
  As above.
- ``projects/strata/src/graph.ts|visit|push → unshift|push|unshift|0``
  The reference paths are only remapped one by one; their order doesn't matter.
- ``projects/strata/src/graph.ts|StrataGraph.buildClone|statement removed|work.refs.set(plan.ref.id, plan.ref);|;|0``
  Pushing the create op records the reference as well.
- ``projects/strata/src/graph.ts|StrataGraph.checkLayers||| → &&||||&&|3``
  An empty path or one that isn't a list names no field: `kindAt` finds nothing for it either, and the path is refused the same way.
- ``projects/strata/src/graph.ts|StrataGraph.checkLayers|push → unshift|push|unshift|1``
  The cycle walk visits every source either way; only the order differs.
- ``projects/strata/src/graph.ts|StrataGraph.layerCycle|push → unshift|push|unshift|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.restoreRecords|statement removed|this.records.set(id, rec);|;|0``
  The saved record is the one still in the map (applying a change updates records in place).
- ``projects/strata/src/graph.ts|StrataGraph.restoreRecords|test → true|current|true|0``
  Unreachable: every node of the refused change has a record by then (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.touchOf|push → unshift|push|unshift|0``
  The paths touched are a set; their order doesn't matter.
- ``projects/strata/src/graph.ts|StrataGraph.touchOf|test → true|inner === "all"|true|0``
  Only widens: treating a compensation or revert as touching everything invalidates more, which reads the same values.
- ``projects/strata/src/graph.ts|StrataGraph.touchOf|push → unshift|push|unshift|1``
  The paths touched are a set; their order doesn't matter.
- ``projects/strata/src/graph.ts|StrataGraph.touchOf|break removed|break;|;|0``
  The case it falls into next only breaks.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|test → false|!this.refIndexReady && this.conflictsReady|false|0``
  Unreachable: building the conflict index builds the reference index first (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.refresh|negation removed|!this.refIndexReady|(this.refIndexReady)|0``
  Building an index that is already built changes nothing.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|statement removed|this.ensureRefIndex();|;|0``
  Unreachable, as above.
- ``projects/strata/src/graph.ts|add|boolean flip|!1|!0|0``
  Only more work: a candidate taking every path is queued again, and layers are acyclic, so the walk still ends with the same candidates.
- ``projects/strata/src/graph.ts|add|test → true|paths === "all"|true|0``
  Only widens: every candidate is invalidated and re-indexed whole, which reads the same values.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|push → unshift|push|unshift|0``
  The candidates are a fixed point (a candidate that gains paths is queued again), whatever order they are visited in.
- ``projects/strata/src/graph.ts|id|shift → pop|shift|pop|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|test → false|!dep?.def|false|0``
  Unreachable: every layer dependent is recorded or collapsed with a registered type (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.refresh|continue removed|continue;|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|test → false|layer.at|false|0``
  Only widens: changes are passed through pinned layers too, which invalidates more and reads the same values.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|continue removed|continue;|;|1``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|test → true|paths === "all"|true|0``
  Only widens: a dependent takes every path, as above.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|test → false|dep.def.fields[path[0]]?.inherit === !1|false|0``
  Only widens: paths that dependents don't inherit are passed on too.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|boolean flip|!1|!0|0``
  Only widens: a field's `inherit` is `false` or absent (its type allows nothing else), so the flipped test lets every path through.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|continue removed|continue;|;|2``
  Only widens: paths that dependents don't inherit are passed on too.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|test → true|layer.role === "base" || covers(layer.paths, path)|true|0``
  Only widens: feeds pass on paths their mask doesn't cover.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|=== → !==|===|!==|2``
  A base's mask is every path, so testing the mask instead of the role gives the same answer for a base, and a feed then passes on everything (only widening).
- ``projects/strata/src/graph.ts|StrataGraph.refresh|push → unshift|push|unshift|1``
  The paths passed on are a set; their order doesn't matter.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|=== → !==|===|!==|3``
  As for #2.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|push → unshift|push|unshift|2``
  The candidates are a fixed point, whatever order they are visited in.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|test → true|cause === "rollback" || cause === "sync" || cause === "purge"|true|0``
  Only forgets cached points and views more often; they are built again from the same records.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|=== → !==|===|!==|4``
  Forgets for every cause but a rollback. A refused fix is rolled back before anything reads a point above where it started, and a rollback of pending commits happens inside a sync, which forgets for its own cause.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|=== → !==|===|!==|6``
  Only forgets more often (a purge also forgets cached points itself).
- ``projects/strata/src/graph.ts|StrataGraph.refresh|test → true|this.refIndexReady|true|0``
  References indexed before the index is built are replaced when it is built.
- ``projects/strata/src/graph.ts|StrataGraph.refresh||| → &&||||&&|4``
  Unreachable: a candidate with a reference always has a registered type.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|test → true|paths === "all" || [...paths.values()].some((path) => { const at = kindAt(def, path); retu|true|0``
  Only re-indexes more: indexing a node's references again gives the same index.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|test → true|refs.some((item) => item.follows)|true|0``
  Only re-evaluates more subjects; a rule gives the same conflicts for an unchanged subject.
- ``projects/strata/src/graph.ts|StrataGraph.refresh|push → unshift|push|unshift|3``
  The walk visits every referrer either way; only the order differs.
- ``projects/strata/src/graph.ts|StrataGraph.emit|test → false|!ref|false|0``
  Unreachable: every node in a change is recorded or remembered as purged (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.emit|continue removed|continue;|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.emit|push → unshift|push|unshift|0``
  The list is empty when `created` is added.
- ``projects/strata/src/graph.ts|StrataGraph.emit|push → unshift|push|unshift|1``
  The list is empty when `retracted` or `purged` is added.
- ``projects/strata/src/graph.ts|StrataGraph.emit|push → unshift|push|unshift|2``
  The list is empty when `name` is added.
- ``projects/strata/src/graph.ts|StrataGraph.emit|push → unshift|push|unshift|5``
  The change set's nodes are sorted by ID after they are assembled.
- ``projects/strata/src/graph.ts|batch|test → true|label|true|0``
  The batch is internal, and an absent label reads the same as `label: undefined` where it is read.
- ``projects/strata/src/graph.ts|StrataGraph.emit|?? → &&|??|&&|0``
  Only rewires more: after a node loses every layer, its combinator keeps inputs it no longer reads, so it recomputes to an unchanged value.
- ``projects/strata/src/graph.ts|StrataGraph.emit|statement removed|this.assembled.delete(commit);|;|0``
  Only memory: an assembled change set is read once, right after its cycle, and at most 64 are kept.
- ``projects/strata/src/graph.ts|StrataGraph.emit|test → true|label|true|0``
  Unreachable: every change runs its cycle at once, so the assembled change set is always there (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.emit|test → false|label|false|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.onCycle||| → &&||||&&|0``
  Each of the two guards alone keeps a batch from being assembled twice: `onCycle` runs once per cycle, and a batch's entry names the cycle it was observed in.
- ``projects/strata/src/graph.ts|StrataGraph.onCycle|statement removed|this.lastBatchSeq = batchEntry.seq;|;|0``
  As above: the cycle check alone stops a second assembly.
- ``projects/strata/src/graph.ts|StrataGraph.onCycle|push → unshift|push|unshift|0``
  The change set's nodes are sorted by ID after they are assembled.
- ``projects/strata/src/graph.ts|StrataGraph.onCycle|push → unshift|push|unshift|1``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.onCycle|push → unshift|push|unshift|2``
  As above.
- ``projects/strata/src/graph.ts|set.nodes|< → <=|<|<=|0``
  Node IDs in a change set are distinct.
- ``projects/strata/src/graph.ts|set.nodes|test → true|a.node.id > b.node.id|true|0``
  Bun's sort only asks whether a comparison is negative, and IDs are distinct: the positive and zero answers aren't told apart.
- ``projects/strata/src/graph.ts|set.nodes|test → false|a.node.id > b.node.id|false|0``
  As above.
- ``projects/strata/src/graph.ts|set.nodes|> → >=|>|>=|0``
  As above.
- ``projects/strata/src/graph.ts|set.nodes|> → <=|>|<=|0``
  As above.
- ``projects/strata/src/graph.ts|set.nodes|number changed|1|0|0``
  As above (`1 → 0` on the greater case).
- ``projects/strata/src/graph.ts|set.nodes|number changed|0|1|0``
  Node IDs in a change set are distinct: the equal case never occurs.
- ``projects/strata/src/graph.ts|StrataGraph.onCycle|test → false|this.assembled.size > 64|false|0``
  Only memory: an assembled change set is read once, right after its cycle (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.onCycle|> → >=|>|>=|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.onCycle|statement removed|this.assembled.delete(this.assembled.keys().next().value);|;|0``
  As above.
- ``projects/strata/src/graph.ts|value|test → true|state|true|0``
  The resolver's effective value of a node with no state is undefined as well.
- ``projects/strata/src/graph.ts|out.trashed|negation removed|!!state?.trashed|(!state?.trashed)|0``
  The combinator's trashed flag is only compared with its own previous value, which the change inverts the same way.
- ``projects/strata/src/graph.ts|out.trashed|negation removed|!state?.trashed|(state?.trashed)|0``
  As above (undefined where false was, compared only with itself).
- ``projects/strata/src/graph.ts|out|test → true|value|true|0``
  A `value: undefined` member reads as an absent one.
- ``projects/strata/src/graph.ts|paths|test → true|def|true|0``
  Unreachable: only nodes of registered types are recorded (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.computeEffective|push → unshift|push|unshift|0``
  The list is empty when `created` is added.
- ``projects/strata/src/graph.ts|StrataGraph.computeEffective|push → unshift|push|unshift|1``
  The list is empty when `retracted` or `purged` is added.
- ``projects/strata/src/graph.ts|StrataGraph.computeEffective|push → unshift|push|unshift|2``
  The list is empty when `name` is added.
- ``projects/strata/src/graph.ts|StrataGraph.computeEffective|push → unshift|push|unshift|5``
  Reports are keyed by node when the change set is assembled (a combinator reports at most once a cycle), and the change set is sorted.
- ``projects/strata/src/graph.ts|StrataGraph.indexLayers|test → false|before && after && before.layers === after.layers|false|0``
  A shortcut: removing a node's layer rows and adding the same ones back gives the same index.
- ``projects/strata/src/graph.ts|StrataGraph.indexLayers|early return removed|return;|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.indexLayers|test → false|deps && !deps.size|false|0``
  Only memory: an empty set of dependents reads the same as none.
- ``projects/strata/src/graph.ts|StrataGraph.indexLayers|statement removed|this.layerIndex.delete(layer.from.id);|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.indexLayers|push → unshift|push|unshift|0``
  Every reader of a dependent's layers from one source looks at all of them; their order doesn't matter.
- ``projects/strata/src/graph.ts|StrataGraph.indexUnique|test → false|!spec.unique|false|0``
  Only indexes more: the unique checks look up only fields marked unique.
- ``projects/strata/src/graph.ts|StrataGraph.indexUnique|continue removed|continue;|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.indexUnique|test → false|equal(a, b)|false|0``
  An unchanged value is removed and set again, giving the same index.
- ``projects/strata/src/graph.ts|StrataGraph.indexUnique|continue removed|continue;|;|1``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.indexUnique|test → true|a !== void 0 && a !== null|true|0``
  Removing a row for an absent value removes nothing.
- ``projects/strata/src/graph.ts|StrataGraph.indexUnique|&& → |||&&||||0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.indexUnique|test → true|b !== void 0 && b !== null|true|0``
  Only indexes more: a row for an absent value is never looked up (the unique check skips absent values).
- ``projects/strata/src/graph.ts|StrataGraph.indexUnique|&& → |||&&||||1``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.ensureRefIndex|test → false|this.refIndexReady|false|0``
  Building the index again gives the same index: each node's rows are replaced.
- ``projects/strata/src/graph.ts|StrataGraph.ensureRefIndex|early return removed|return;|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.indexRefs|test → false|referrers && !referrers.size|false|0``
  Only memory: an empty set of referrers reads the same as none.
- ``projects/strata/src/graph.ts|StrataGraph.indexRefs|statement removed|this.refIndex.delete(item.target.id);|;|0``
  As above.
- ``projects/strata/src/graph.ts|out|test → true|this.headState(ref)|true|0``
  A node with no state has no references either.
- ``projects/strata/src/graph.ts|StrataGraph.indexRefs|test → true|out.length|true|0``
  An empty list of references reads the same as none.
- ``projects/strata/src/graph.ts|StrataGraph.indexRefs|statement removed|this.refsOut.delete(ref.id);|;|0``
  As above: the empty list is replaced the next time the node is indexed.
- ``projects/strata/src/graph.ts|StrataGraph.subscribeAll|test → true|!rec.constant|true|0``
  Only demands more: a constant never changes, so its combinator never reports.
- ``projects/strata/src/graph.ts|StrataGraph.subscribeAll|statement removed|this.allDemand = null;|;|0``
  The next first subscriber makes a new demand token either way.
- ``projects/strata/src/graph.ts|StrataGraph.subscribeAll.once|boolean flip|!0|!1|0``
  An abort signal fires once; the listener runs once either way.
- ``projects/strata/src/graph.ts|StrataGraph.subscribe|test → false|options.signal.aborted|false|0``
  Connecting an effect with an aborted signal connects nothing, so the listener is never called; nothing else is demanded.
- ``projects/strata/src/graph.ts|StrataGraph.subscribe|early return removed|return;|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.subscribe|test → true|options.follows|true|0``
  Only builds the reference index earlier; it is the same index.
- ``projects/strata/src/graph.ts|via|slice → splice|slice|splice|0``
  The same inputs are returned; the list they are cut from isn't read again.
- ``projects/strata/src/graph.ts|StrataGraph.subscribe.run|test → true|options.follows|true|0``
  Without `follows` the inputs are only the node itself, which never differ, so nothing is rewired.
- ``projects/strata/src/graph.ts|StrataGraph.subscribe.run|test → true|next.length !== effect.inputs.length || next.some((node, i) => node !== effect.inputs[i].n|true|0``
  Only rewires more: setting the same inputs again changes nothing.
- ``projects/strata/src/graph.ts|StrataGraph.subscribe.run|!== → ===|!==|===|1``
  As above: the first input is always the node itself, so the test is always true and the same inputs are set again.
- ``projects/strata/src/graph.ts|effect.run|test → true|context.inputs[0].changed|true|0``
  The effect has one input and runs only when it changed.
- ``projects/strata/src/graph.ts|StrataGraph.storeTask|test → false|!run|false|0``
  Unreachable: every caller checks for a store first, and a graph with a store has its store run from construction (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.storeTask|test → false|run.signal.aborted|false|0``
  A task started under a stopped run is aborted at once, and settles with the same "stopped" failure.
- ``projects/strata/src/graph.ts|StrataGraph.storeTask|&& → |||&&||||0``
  Only a done task has a result: an abort settles the task synchronously, before the work's result could be recorded (a microtask later), and a failed task never records one.
- ``projects/strata/src/graph.ts|StrataGraph.pump||| → &&||||&&|3``
  A graph has a store run exactly when it has a store, so either test alone decides.
- ``projects/strata/src/graph.ts|token|++/-- swapped|++this.token|--this.token|0``
  The append token is only compared with itself; counting down gives distinct tokens as well.
- ``projects/strata/src/graph.ts|StrataGraph.pump|test → false|this.inflight !== token|false|0``
  Unreachable: one append is in flight at a time, and only its own settlement clears it.
- ``projects/strata/src/graph.ts|StrataGraph.pump|early return removed|return;|;|1``
  As above.
- ``projects/strata/src/graph.ts|settle|test → false|settled|false|0``
  A second settlement is stopped three ways (the flag, the removed abort listener and the ended result effect); each alone suffices.
- ``projects/strata/src/graph.ts|settle|early return removed|return;|;|0``
  As above.
- ``projects/strata/src/graph.ts|settle|statement removed|settled = !0;|;|0``
  As above.
- ``projects/strata/src/graph.ts|settle|boolean flip|!0|!1|0``
  As above.
- ``projects/strata/src/graph.ts|settle|statement removed|run.signal.removeEventListener("abort", stopped);|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.whenSettled|test → false|run.signal.aborted|false|0``
  A process spawned under a stopped run is already aborted, and its result effect settles it with that state, which every caller treats as it treats "stopped".
- ``projects/strata/src/graph.ts|StrataGraph.whenSettled|statement removed|stopped();|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.whenSettled|early return removed|return;|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.scheduleRetry|test → false|this.retrying || !this.storeRun|false|0``
  Unreachable: only a failed append schedules a retry, and nothing is sent while one waits (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.scheduleRetry||| → &&||||&&|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.scheduleRetry|early return removed|return;|;|0``
  As above.
- ``projects/strata/src/graph.ts|moved|boolean flip|!1|!0|0``
  Only refreshes pins more often; a pin read again at an unchanged point reads the same.
- ``projects/strata/src/graph.ts|StrataGraph.onReply|test → false|!rec|false|0``
  Unreachable: a node with a pending commit keeps its record until the commit is settled (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.onReply|continue removed|continue;|;|0``
  As above.
- ``projects/strata/src/graph.ts|pos|test → true|entry.commit === item.commit|true|0``
  The positions map holds only this commit's entries, so an entry of another commit finds none either way.
- ``projects/strata/src/graph.ts|StrataGraph.onReply|> → >=|>|>=|0``
  Setting the store head to the value it already has changes nothing.
- ``projects/strata/src/graph.ts|StrataGraph.onReply|> → >=|>|>=|1``
  Setting the head position to the value it already has changes nothing.
- ``projects/strata/src/graph.ts|StrataGraph.onReply|test → true|moved|true|0``
  Only refreshes pins more often, as above.
- ``projects/strata/src/graph.ts|StrataGraph.repositionPending|boolean flip|!1|!0|0``
  Only refreshes pins more often; a pin read again at an unchanged point reads the same.
- ``projects/strata/src/graph.ts|StrataGraph.repositionPending|test → true|rec|true|0``
  Unreachable: a node with a pending commit keeps its record until the commit is settled.
- ``projects/strata/src/graph.ts|StrataGraph.refreshPinned|test → true|rec.head?.layers.some((layer) => layer.at)|true|0``
  Only refreshes more nodes; a node read again with unchanged inputs reads the same.
- ``projects/strata/src/graph.ts|StrataGraph.refreshPinned|test → false|!touched.size|false|0``
  Refreshing no nodes changes nothing and emits a change set with nothing in it, which no subscriber hears.
- ``projects/strata/src/graph.ts|StrataGraph.refreshPinned|early return removed|return;|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.refreshPinned|early return removed|return;|;|1``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.rollbackPending|test → false|this.outbox.length <= from|false|0``
  Unreachable: callers drop from a pending commit they found in the outbox (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.rollbackPending|<= → <|<=|<|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.rollbackPending|early return removed|return;|;|0``
  As above.
- ``projects/strata/src/graph.ts|dropped|slice → splice|slice|splice|0``
  Cutting the dropped commits out of the outbox leaves it holding what the next line assigns it anyway.
- ``projects/strata/src/graph.ts|StrataGraph.rollbackPending|slice → splice|slice|splice|0``
  `splice(0, from)` returns the same commits `slice(0, from)` does, and the outbox is replaced by them.
- ``projects/strata/src/graph.ts|beforeStates|statement removed|rec.ackedSeq = Math.min(rec.ackedSeq, rec.headSeq);|;|0``
  The dropped entries were never acknowledged, so the acknowledged seq is already at or below the new head's.
- ``projects/strata/src/graph.ts|beforeStates|min → max|min|max|0``
  A kept pending entry of the node is acknowledged before anything reads the acknowledged seq: snapshots are written at acknowledgements or after a flush, and compaction flushes first.
- ``projects/strata/src/graph.ts|beforeStates|statement removed|this.purgedRefs.set(id, rec.ref);|;|0``
  A node's purge reaches subscribers through its own combinator, which reports it; without a subscriber the change set reaches no one.
- ``projects/strata/src/graph.ts|StrataGraph.rollbackPending|statement removed|this.commits.delete(id);|;|0``
  The Undo and Redo stacks are filtered of the dropped commits just before, and the commit records are read only through them.
- ``projects/strata/src/graph.ts|StrataGraph.flush||| → &&||||&&|1``
  A graph has a store run exactly when it has a store, so either test alone decides.
- ``projects/strata/src/graph.ts|StrataGraph.flush|push → unshift|push|unshift|0``
  Every waiter is resolved in the same call; only the order their promises settle in differs.
- ``projects/strata/src/graph.ts|StrataGraph.resolveFlush|statement removed|this.flushWaiters = [];|;|0``
  Only memory: resolving a settled promise again does nothing.
- ``projects/strata/src/graph.ts|StrataGraph.recover|push → unshift|push|unshift|0``
  A commit sent back because a snapshot covers it is already stored: the store answers it as a duplicate wherever it stands in the outbox.
- ``projects/strata/src/graph.ts|already|every → some|every|some|0``
  A commit is stored whole, so its entries are in memory all or none (one a snapshot covers is sent back before this test).
- ``projects/strata/src/graph.ts|StrataGraph.recover|test → true|applied|true|0``
  Only loads pinned history when nothing was applied, which loads nothing new.
- ``projects/strata/src/graph.ts|StrataGraph.recover|early return removed|return;|;|0``
  The callback returns undefined either way.
- ``projects/strata/src/graph.ts|layers||| → &&||||&&|0``
  The layer sources of a create, import or state op are in the commit's basis, so a gone source already fails the basis check.
- ``projects/strata/src/graph.ts|StrataGraph.sync|test → false|entry.seq < expected|false|0``
  Unreachable: every entry after the read position is new to this graph except its own, which are filtered out before; a node read again whole is caught up to its head.
- ``projects/strata/src/graph.ts|StrataGraph.sync|continue removed|continue;|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.sync|push → unshift|push|unshift|0``
  Only the order in which nodes with a gap are read again changes; each is installed whole.
- ``projects/strata/src/graph.ts|StrataGraph.sync|continue removed|continue;|;|1``
  The group the gap entry then joins is dropped for the node's reload, which installs its whole stream; the commit is marked as caught up with, which it is.
- ``projects/strata/src/graph.ts|StrataGraph.sync|statement removed|groups.delete(ref.id);|;|0``
  The node's reload afterwards installs its whole stream, replacing what the group applied.
- ``projects/strata/src/graph.ts|StrataGraph.sync|test → true|groups.size|true|0``
  Applying no groups changes nothing.
- ``projects/strata/src/graph.ts|StrataGraph.sync|statement removed|this.readPos = Math.max(this.readPos, head);|;|0``
  Entries read again are recognised by their commit (marked as caught up with) and skipped.
- ``projects/strata/src/graph.ts|StrataGraph.sync|max → min|max|min|1``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.sync|test → true|before.size|true|0``
  An empty change set reaches no subscriber, and pins read again at unchanged points read the same.
- ``projects/strata/src/graph.ts|StrataGraph.writeSnapshot|test → false|!state|false|0``
  Unreachable: a node with acknowledged entries past its snapshot always folds to a state (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.writeSnapshot|boolean flip|!1|!0|2``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.snapshotAll|test → false|!this.store || !this.writeSnapshots|false|0``
  Each node's snapshot write refuses a graph without a store or one that writes none, so the count is 0 either way.
- ``projects/strata/src/graph.ts|StrataGraph.snapshotAll||| → &&||||&&|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.compensate|test → false|!record|false|0``
  Unreachable: the Undo and Redo stacks hold only steps whose records are kept (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.compensate|test → false|!rec|false|0``
  Unreachable: the stacks drop the steps of purged nodes (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.compensate|continue removed|continue;|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.compensate|test → false|!after || !current|false|0``
  Unreachable: a node with a step has a state after it and a head (a retraction is a state, not its absence).
- ``projects/strata/src/graph.ts|StrataGraph.compensate||| → &&||||&&|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.compensate|continue removed|continue;|;|1``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.compensate|test → true|!current.retracted|true|0``
  Unreachable: only a creation step is undone by retracting, and it is undone only while the node is live (undo and redo alternate).
- ``projects/strata/src/graph.ts|StrataGraph.compensate|push → unshift|push|unshift|0``
  The ops of one compensation touch disjoint parts of the state (each path, the layers, the name, the trash flag, retraction), so their order doesn't change the result.
- ``projects/strata/src/graph.ts|StrataGraph.compensate|push → unshift|push|unshift|1``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.compensate|push → unshift|push|unshift|2``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.compensate|push → unshift|push|unshift|3``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.compensate|push → unshift|push|unshift|4``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.compensate|push → unshift|push|unshift|5``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.compensate.kind|test → false|before.retracted|false|0``
  Unreachable true branch: this line runs only when the state before the step wasn't retracted.
- ``projects/strata/src/graph.ts|StrataGraph.compensate|statement removed|work.refs.set(ref.id, rec.ref);|;|0``
  Pushing the op records the reference as well.
- ``projects/strata/src/graph.ts|StrataGraph.compensate|boolean flip|!0|!1|0``
  For a recorded node the working state starts from its head either way, and a compensation isn't a primitive op that pushing can drop.
- ``projects/strata/src/graph.ts|sorted|< → <=|<|<=|0``
  Subject IDs of one conflict are distinct.
- ``projects/strata/src/graph.ts|sorted|< → >=|<|>=|0``
  Any consistent order gives each set of subjects one ID; this one sorts them descending.
- ``projects/strata/src/graph.ts|sorted|test → true|a.id > b.id|true|0``
  Bun's sort only asks whether a comparison is negative: the positive and zero answers aren't told apart.
- ``projects/strata/src/graph.ts|sorted|test → false|a.id > b.id|false|0``
  As above.
- ``projects/strata/src/graph.ts|sorted|> → >=|>|>=|0``
  As above.
- ``projects/strata/src/graph.ts|sorted|> → <=|>|<=|0``
  As above.
- ``projects/strata/src/graph.ts|sorted|number changed|1|0|0``
  As above (`1 → 0`), or the equal case, which distinct IDs never reach (`0 → 1`).
- ``projects/strata/src/graph.ts|sorted|number changed|0|1|0``
  Subject IDs of one conflict are distinct: the equal case never occurs.
- ``projects/strata/src/graph.ts|StrataGraph.evaluateAll|< → <=|<|<=|0``
  Conflict IDs are distinct.
- ``projects/strata/src/graph.ts|StrataGraph.evaluateAll|number changed|1|0|0``
  Bun's sort only asks whether a comparison is negative.
- ``projects/strata/src/graph.ts|StrataGraph.ensureConflicts|test → false|this.conflictsReady|false|0``
  Evaluating every subject again gives the same index.
- ``projects/strata/src/graph.ts|StrataGraph.ensureConflicts|early return removed|return;|;|0``
  As above.
- ``projects/strata/src/graph.ts|all|test → true|global.length|true|0``
  Only visits more nodes; a node outside the subjects is evaluated only by global rules, and there are none then.
- ``projects/strata/src/graph.ts|StrataGraph.reevaluate|test → true|inSubjects|true|0``
  Only re-evaluates more; a rule gives the same conflicts for an unchanged subject.
- ``projects/strata/src/graph.ts|StrataGraph.reevaluate|test → true|ids.size|true|0``
  Only memory: an empty set of produced conflicts drops nothing.
- ``projects/strata/src/graph.ts|StrataGraph.dropProduced|statement removed|this.produced.delete(producer);|;|0``
  Dropping a producer again removes it from sets that no longer hold it; a conflict it no longer produces is gone already or held by its other producers.
- ``projects/strata/src/graph.ts|StrataGraph.dropProduced|statement removed|this.producers.delete(id);|;|0``
  Only memory: an empty set of producers reads the same as none.
- ``projects/strata/src/graph.ts|StrataGraph.conflicts|< → <=|<|<=|0``
  Conflict IDs are distinct.
- ``projects/strata/src/graph.ts|StrataGraph.conflicts|number changed|1|0|0``
  Bun's sort only asks whether a comparison is negative.
- ``projects/strata/src/graph.ts|StrataGraph.conflictIndex|< → <=|<|<=|0``
  Conflict IDs are distinct.
- ``projects/strata/src/graph.ts|StrataGraph.conflictIndex|number changed|1|0|0``
  Bun's sort only asks whether a comparison is negative.
- ``projects/strata/src/graph.ts|StrataGraph.blockingFor|early return removed|return;|;|0``
  The function's last statement: it returns undefined either way.
- ``projects/strata/src/graph.ts|StrataGraph.isAcknowledged|test → false|signature === void 0|false|0``
  With no acknowledgement the signature comparison fails as well, and removing an absent acknowledgement does nothing.
- ``projects/strata/src/graph.ts|StrataGraph.isAcknowledged|statement removed|this.acknowledgements.delete(conflict.id);|;|0``
  Only memory: a signature only moves forward (it names the subjects' seqs), so a stale acknowledgement never matches again.
- ``projects/strata/src/graph.ts|route|find → findLast|find|findLast|0``
  Route IDs of one conflict are distinct.
- ``projects/strata/src/graph.ts|StrataGraph.fix|test → false|!edits.length|false|0``
  A commit of no edits is refused as empty the same way.
- ``projects/strata/src/graph.ts|StrataGraph.record|statement removed|work.refs.set(ref.id, ref);|;|0``
  Pushing the op records the reference as well.
- ``projects/strata/src/graph.ts|StrataGraph.record|test → false|exists|false|0``
  A source is a value stream: every op becomes a whole-state entry (create for a new node, state after), and a create for an existing source holds the same name and value.
- ``projects/strata/src/graph.ts|StrataGraph.compactingConflict|test → false|!this.compacting.size|false|0``
  With nothing being compacted, the loop finds nothing either.
- ``projects/strata/src/graph.ts|StrataGraph.compact|statement removed|await this.flush();|;|0``
  The sync right after flushes first; for a session node there is nothing to flush.
- ``projects/strata/src/graph.ts|StrataGraph.compact|test → true|this.store && !rec.session|true|0``
  A sync of a graph without a store applies nothing, and syncing for a session node's compaction changes nothing it keeps.
- ``projects/strata/src/graph.ts|StrataGraph.compact|&& → |||&&||||0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.compact|number changed|0|1|0``
  After every stream is loaded whole, a base is at seq 0 unless the node was reloaded meanwhile, whose base is then a snapshot's, never at seq 1 alone (see `loadReachable`).
- ``projects/strata/src/graph.ts|StrataGraph.compact|test → false|!acked.length|false|0``
  Unreachable: after a flush and a sync, a stored node has acknowledged entries (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.compact.ok|boolean flip|!0|!1|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.compact|test → true|after|true|0``
  Unreachable: the node is reserved for compaction, so nothing purges or collapses it meanwhile.
- ``projects/strata/src/graph.ts|StrataGraph.compact|statement removed|after.base = { seq: 0, pos: 0, state: null };|;|0``
  Every stream was loaded whole before compacting, so the base is already at 0.
- ``projects/strata/src/graph.ts|StrataGraph.collapseInto|statement removed|host.base = { seq: 0, pos: 0, state: null };|;|0``
  The host was loaded whole before collapsing, so its base is already at 0.
- ``projects/strata/src/graph.ts|StrataGraph.collapseInto|statement removed|host.snapshotSeq = 0;|;|0``
  A stream holding inlined streams is never snapshotted, so the host's snapshot seq doesn't matter while it holds one; when the last goes, a purge resets it.
- ``projects/strata/src/graph.ts|StrataGraph.collapseInto|number changed|0|1|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.inlinedStream|find → findLast|find|findLast|0``
  An entry holds each inlined node once.
- ``projects/strata/src/graph.ts|StrataGraph.purgeInlined|statement removed|await this.flush();|;|0``
  Nothing is pending that the host entry's rewrite depends on: it takes only entries up to the host entry, which are acknowledged.
- ``projects/strata/src/graph.ts|StrataGraph.purgeInlined|statement removed|await this.loadHistory(item.host.node);|;|0``
  A host holding inlined streams is never snapshotted, so its history is always in memory.
- ``projects/strata/src/graph.ts|strip||| → &&||||&&|0``
  Other entries holding inlined streams don't hold this node, so filtering it out leaves them equal.
- ``projects/strata/src/graph.ts|StrataGraph.purgeInlined|test → true|host|true|0``
  Unreachable: a host's purge takes its collapsed nodes with it (see `uncovered-branches.md`).
- ``projects/strata/src/graph.ts|StrataGraph.purgeInlined|statement removed|host.snapshotSeq = 0;|;|0``
  While it held the inlined stream the host wasn't snapshotted, so its snapshot seq is already 0.
- ``projects/strata/src/graph.ts|StrataGraph.purgeInlined|number changed|0|1|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.purgeInlined|test → true|rec.head?.layers.some((layer) => layer.at)|true|0``
  Only refreshes more nodes; a node read again with unchanged inputs reads the same.
- ``projects/strata/src/graph.ts|StrataGraph.purgeInlined|statement removed|this.purgedRefs.set(ref.id, item.ref);|;|0``
  A node's purge reaches subscribers through its own combinator, which reports it; without a subscriber the change set reaches no one.
- ``projects/strata/src/graph.ts|beforeStates|statement removed|this.indexLayers(ref.id, item.state, null);|;|0``
  Only memory: layer dependents are listed from records, and a gone node's rows are skipped when changes propagate.
- ``projects/strata/src/graph.ts|StrataGraph.purgeInlined|statement removed|this.forgetTimes();|;|0``
  The refresh just before, for a purge, forgets cached points and views itself.
- ``projects/strata/src/graph.ts|StrataGraph.purgeNow|test → true|other.head?.layers.some((layer) => layer.at)|true|0``
  Only refreshes more nodes, as above.
- ``projects/strata/src/graph.ts|StrataGraph.purgeNow|statement removed|this.purgedRefs.set(ref.id, rec.ref);|;|0``
  A node's purge reaches subscribers through its own combinator, which reports it; without a subscriber the change set reaches no one.
- ``projects/strata/src/graph.ts|beforeStates|statement removed|this.indexLayers(id, this.inlined.get(id)?.state ?? null, null);|;|0``
  Only memory: layer dependents are listed from records, and a gone node's rows are skipped when changes propagate.
- ``projects/strata/src/graph.ts|beforeStates|?? → &&|??|&&|0``
  As above.
- ``projects/strata/src/graph.ts|beforeStates|statement removed|this.indexLayers(ref.id, before, null);|;|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.purgeNow|statement removed|this.forgetTimes();|;|0``
  The refresh just before, for a purge, forgets cached points and views itself.
- ``projects/strata/src/graph.ts|StrataGraph.depthOf|test → false|seen.has(id)|false|0``
  Unreachable: layers never form a cycle (see `uncovered-branches.md`), so a node is never met again on its own chain.
- ``projects/strata/src/graph.ts|StrataGraph.depthOf|number changed|0|1|0``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.depthOf|statement removed|seen.add(id);|;|0``
  As above: without cycles the guard never fires.
- ``projects/strata/src/graph.ts|StrataGraph.inspectorRow|> → >=|>|>=|0``
  Replacing the worst severity by an equal one changes nothing.
- ``projects/strata/src/graph.ts|StrataGraph.inspect|number changed|1|0|0``
  Bun's sort only asks whether a comparison is negative.
- ``projects/strata/src/graph.ts|StrataGraph.inspect|number changed|1|0|1``
  As above.
- ``projects/strata/src/graph.ts|StrataGraph.inspect|< → <=|<|<=|2``
  Node IDs are distinct.
- ``projects/strata/src/graph.ts|StrataGraph.inspect|number changed|1|0|2``
  Bun's sort only asks whether a comparison is negative.
- ``projects/strata/src/graph.ts|StrataGraph.inspectNode||| → &&||||&&|0``
  A row exists exactly when the node has a live state, so either test alone decides.
- ``projects/strata/src/graph.ts|walk|push → unshift|push|unshift|0``
  The paths are sorted before they are returned.
- ``projects/strata/src/graph.ts|diffLeaves|< → <=|<|<=|0``
  Path keys of one diff are distinct.
- ``projects/strata/src/graph.ts|diffLeaves|test → true|pathKey(p) > pathKey(q)|true|0``
  Bun's sort only asks whether a comparison is negative.
- ``projects/strata/src/graph.ts|diffLeaves|test → false|pathKey(p) > pathKey(q)|false|0``
  As above.
- ``projects/strata/src/graph.ts|diffLeaves|> → >=|>|>=|0``
  As above.
- ``projects/strata/src/graph.ts|diffLeaves|> → <=|>|<=|0``
  As above.
- ``projects/strata/src/graph.ts|diffLeaves|number changed|1|0|0``
  As above (`1 → 0`), or the equal case, which distinct paths never reach (`0 → 1`).
- ``projects/strata/src/graph.ts|diffLeaves|number changed|0|1|0``
  Path keys of one diff are distinct: the equal case never occurs.
- ``projects/strata/src/graph.ts|mid|number changed|1|0|0``
  With `low` at 0, the probe is always `high`: the search walks down from the end and moves `low` only past `high`, which ends it. It finds the same entries, more slowly.
- ``projects/strata/src/graph.ts|entryAt|< → <=|<|<=|0``
  The equal case returns just before.
- ``projects/strata/src/graph.ts|entryAt|early return removed|return;|;|0``
  The function's last statement: it returns undefined either way.
- ``projects/strata/src/graph.ts|Working.push|boolean flip|!1|!0|0``
  For a live node the record's head is its head state; edits of a node that isn't live are refused before they are pushed.
- ``projects/strata/src/graph.ts|Working.push|test → true|raw|true|0``
  As above.
- ``projects/strata/src/graph.ts|Working.push|test → false|raw|false|0``
  A compensation's working state is read only by the layer-cycle check, and a node coming back from retraction can't close a cycle: nothing live could take it as a source meanwhile.
- ``projects/strata/src/graph.ts|Working.drop|statement removed|this.refs.delete(id);|;|0``
  A dropped node's reference is only looked up for nodes with ops, and the next push records it again.
- ``projects/strata/src/graph.ts|Working.drop|statement removed|this.seqs.delete(id);|;|0``
  A dropped node has no seq recorded: seqs are set only after an op is kept.
- ``projects/strata/src/graph.ts|Working.drop|test → true|index >= 0|true|0``
  Unreachable: only a node in the order is dropped.

## projects/strata/src/fold.ts

- ``projects/strata/src/fold.ts|applyPrimitive|early return removed|return;|;|8``
  The last case: the function ends there anyway.
- ``projects/strata/src/fold.ts|diffStates|push → unshift|push|unshift|0``
  The ops touch distinct keys, so the order they are applied in doesn't change the state.

## projects/strata/src/resolve.ts

- ``projects/strata/src/resolve.ts|Resolver.cycleHits|number changed|0|1|0``
  The count is only compared with itself before and after a computation.
- ``projects/strata/src/resolve.ts|Resolver.leaf|test → false|hit|false|0``
  A memo: the leaf is computed again from the same states.
- ``projects/strata/src/resolve.ts|Resolver.leaf|++/-- swapped|this.cycleHits++|this.cycleHits--|0``
  Counting down changes the count as well, which is all the comparison asks.
- ``projects/strata/src/resolve.ts|Resolver.leaf|test → true|this.cycleHits !== hits|true|0``
  Only memoises less: the leaf is computed again from the same states.
- ``projects/strata/src/resolve.ts|Resolver.leaf|test → true|!memo|true|0``
  A memo, as above.
- ``projects/strata/src/resolve.ts|Resolver.leaf|statement removed|memo.set(key, result);|;|0``
  As above.
- ``projects/strata/src/resolve.ts|Resolver.mapKeys|test → false|hit|false|0``
  A memo: the keys are computed again from the same states.
- ``projects/strata/src/resolve.ts|Resolver.mapKeys|++/-- swapped|this.cycleHits++|this.cycleHits--|0``
  Counting down changes the count as well, which is all the comparison asks.
- ``projects/strata/src/resolve.ts|Resolver.mapKeys|test → true|this.cycleHits !== hits|true|0``
  Only memoises less, as above.
- ``projects/strata/src/resolve.ts|Resolver.mapKeys|test → true|!memo|true|0``
  A memo, as above.
- ``projects/strata/src/resolve.ts|Resolver.mapKeys|statement removed|memo.set(key, result);|;|0``
  As above.
- ``projects/strata/src/resolve.ts|Resolver.candidateKeys|test → false|!def || !at || at.leaf|false|0``
  Unreachable: it is called only through `mapKeys` of a map path of a registered type (see `uncovered-branches.md`).
- ``projects/strata/src/resolve.ts|Resolver.candidateKeys||| → &&||||&&|0``
  As above.
- ``projects/strata/src/resolve.ts|Resolver.candidateKeys||| → &&||||&&|1``
  As above.
- ``projects/strata/src/resolve.ts|Resolver.candidateKeys|early return removed|return;|;|1``
  As above.
- ``projects/strata/src/resolve.ts|Resolver.candidateKeys|test → true|ownPath.length > path.length && startsWith(ownPath, path)|true|0``
  Only adds candidates: every candidate is kept only if a value is present under it.
- ``projects/strata/src/resolve.ts|Resolver.candidateKeys|&& → |||&&||||0``
  As above.
- ``projects/strata/src/resolve.ts|Resolver.candidateKeys|> → >=|>|>=|0``
  As above.
- ``projects/strata/src/resolve.ts|Resolver.candidateKeys|test → true|at.spec.inherit !== !1|true|0``
  As above: a key taken from a layer is kept only if the leaf under it resolves, which honours the field's `inherit`.
- ``projects/strata/src/resolve.ts|Resolver.candidateKeys|boolean flip|!1|!0|0``
  As above (a field's `inherit` is `false` or absent).
- ``projects/strata/src/resolve.ts|Resolver.candidateKeys|test → true|layer.role === "base" || layer.paths === "*" || layer.paths.some((mask) => startsWith(chil|true|0``
  As above: a key outside a feed's mask resolves to nothing through it.
- ``projects/strata/src/resolve.ts|Resolver.candidateKeys|=== → !==|===|!==|0``
  As above.
- ``projects/strata/src/resolve.ts|walk|early return removed|return;|;|0``
  The map keys of a leaf path are none, so nothing more is walked.

## projects/strata/src/model.ts

- ``projects/strata/src/model.ts|ReadModel.read||| → &&||||&&|0``
  The effective value is undefined exactly when the node has no state (a node's type is always registered).
- ``projects/strata/src/model.ts|walk|early return removed|return;|;|0``
  The next test returns for a map anyway.
- ``projects/strata/src/model.ts|walk|test → false|kind.kind !== "ref" && kind.kind !== "refs"|false|0``
  Only fields holding references are walked, and a value leaf under one is never an object with an ID.
- ``projects/strata/src/model.ts|walk|early return removed|return;|;|1``
  As above.
- ``projects/strata/src/model.ts|ReadModel.references|test → true|hasRefs(spec)|true|0``
  A field without references yields none when walked.
- ``projects/strata/src/model.ts|visit|slice → splice|slice|splice|0``
  The same edges are returned, and the stack isn't used after.
- ``projects/strata/src/model.ts|visit|test → true|!done.has(edge.target.id)|true|0``
  Only visits more: a finished node has no cycle reachable from it, or it would have returned one.
- ``projects/strata/src/model.ts|visit|statement removed|done.add(ref.id);|;|0``
  As above.
- ``projects/strata/src/model.ts|ReadModel.followCycle|test → true|this.exists(start)|true|0``
  A node that doesn't exist has no references, so no cycle is found from it.
- ``projects/strata/src/model.ts|ReadModel.derive|slice → splice|slice|splice|0``
  The cycle named is the same; the stack is unwound by the pops that follow, and nothing reads it in between.
- ``projects/strata/src/model.ts|context.derived|test → true|found.ok|true|0``
  A result that isn't ok has no value: undefined either way.
- ``projects/strata/src/model.ts|ReadModel.derive|test → true|this.deriving.length === 0 || result.ok|true|0``
  Only memoises more: a nested cycle result names the same cycle as the one the outer derivation returns and memoises.
- ``projects/strata/src/model.ts|ReadModel.derive|=== → !==|===|!==|0``
  As above.
- ``projects/strata/src/model.ts|ReadModel.derive|number changed|0|1|1``
  As above.
- ``projects/strata/src/model.ts|ReadModel.derive|test → true|!memo2|true|0``
  A memo: another derivation of the node is computed again from the same states.

## projects/strata/src/compaction.ts

- ``projects/strata/src/compaction.ts|valuesOfKind|push → unshift|push|unshift|1``
  Node references are used as a set (how many entries reference a node), so their order doesn't matter.
- ``projects/strata/src/compaction.ts|entryReferences|push → unshift|push|unshift|0``
  The list is empty when an op of this kind adds to it.
- ``projects/strata/src/compaction.ts|entryReferences|push → unshift|push|unshift|1``
  As above.
- ``projects/strata/src/compaction.ts|entryReferences|push → unshift|push|unshift|2``
  As above.
- ``projects/strata/src/compaction.ts|entryReferences|push → unshift|push|unshift|3``
  As above.
- ``projects/strata/src/compaction.ts|nodeReferences|push → unshift|push|unshift|0``
  Node references are used as a set (how many entries reference a node), so their order doesn't matter.
- ``projects/strata/src/compaction.ts|nodeReferences|push → unshift|push|unshift|1``
  As above.
- ``projects/strata/src/compaction.ts|nodeReferences|push → unshift|push|unshift|2``
  As above.
- ``projects/strata/src/compaction.ts|nodeReferences|push → unshift|push|unshift|3``
  As above.
- ``projects/strata/src/compaction.ts|keepSet|test → true|entry.op.kind === "untag"|true|0``
  Another op has no tag number, and no tag is looked up by an undefined number.
- ``projects/strata/src/compaction.ts|readingNeeds|test → true|!byId.has(stream.ref.id)|true|0``
  Node IDs are unique across the records and the streams inlined in them.
- ``projects/strata/src/compaction.ts|stateThrough|statement removed|folded.set(stream.ref.id, states);|;|0``
  A memo: the states are folded again from the same entries.
- ``projects/strata/src/compaction.ts|stateThrough|test → true|i|true|0``
  At the first entry the previous state is undefined, which folds like null.
- ``projects/strata/src/compaction.ts|read|test → false|seen.has(`read ${id}@${point}`)|false|0``
  Layers never form a cycle, so reading again what was read gives the same needs.
- ``projects/strata/src/compaction.ts|read|early return removed|return;|;|0``
  As above.
- ``projects/strata/src/compaction.ts|read|statement removed|seen.add(`read ${id}@${point}`);|;|0``
  As above.
- ``projects/strata/src/compaction.ts|read|statement removed|queue.push(layer.at);|;|0``
  A pinned layer's entry is itself among the referenced entries whose needs are read.
- ``projects/strata/src/compaction.ts|read|push → unshift|push|unshift|0``
  The queue is worked through until empty; the order doesn't change what is kept.
- ``projects/strata/src/compaction.ts|entry|find → findLast|find|findLast|0``
  Seqs are unique in a stream.
- ``projects/strata/src/compaction.ts|readingNeeds|statement removed|seen.add(entryKey(entry));|;|0``
  Reading an entry's node again at the same point is skipped by `read` itself.
- ``projects/strata/src/compaction.ts|rollupDeltaStream|statement removed|flush();|;|1``
  The last entry is always kept, which flushes the run before it, so the run is empty at the end.
- ``projects/strata/src/compaction.ts|stream|find → findLast|find|findLast|0``
  Stream IDs are unique.
- ``projects/strata/src/compaction.ts|collapseInline|push → unshift|push|unshift|0``
  Only the count of referring entries matters, and the host is taken only when there is exactly one.

## projects/strata/src/define.ts

- ``projects/strata/src/define.ts|kindAt|test → false|!path.length|false|0``
  An empty path names no field (`fields[undefined]`), so the next test returns null as well.

## projects/strata/src/paths.ts

- ``projects/strata/src/paths.ts|startsWith|test → false|prefix.length > path.length|false|0``
  A longer prefix differs from the path at its first missing part, so the loop returns false as well.

## projects/strata/src/store.ts

- ``projects/strata/src/store.ts|MemoryStore.changes|number changed|0|1|0``
  The change counter is only compared with an earlier reading of itself.
- ``projects/strata/src/store.ts|state|> → >=|>|>=|0``
  Folding the snapshot's own entry again over its state sets the same name and trash flag.
- ``projects/strata/src/store.ts|MemoryStore.listNow.headSeq|number changed|0|1|0``
  Unreachable: a stream is created by its first entry and removed with its last (see `uncovered-branches.md`).
- ``projects/strata/src/store.ts|MemoryStore.loadNow.nodes|test → true|snapshot|true|0``
  A `snapshot: undefined` member reads as an absent one.
- ``projects/strata/src/store.ts|removed|<= → <|<=|<|0``
  The entry at `through` is the last one compaction passes, which always survives at its position, so it is never removed from the log.
