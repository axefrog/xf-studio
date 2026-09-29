# Mutants no test can tell from the engine

`bun tools/mutate.ts` counts a mutant the suite survives as a missing test unless it is listed here, by its key, with the reason no test can tell it apart from the engine: the change is unreachable, or it changes nothing a caller can observe. A mutant that changes only a message a person reads is not listed: a test checks the message instead.

A key is the file, the function, the kind of change, the code changed, its replacement, and which occurrence of that change in the function it is (see `tools/mutate.ts`). Keys survive edits elsewhere in a file; a key that no longer matches a mutant is ignored, so remove it with the code it described. Line numbers aren't kept for the same reason.

## src/kernel/abort.ts

- ``src/kernel/abort.ts|Aborter.constructor.once|boolean flip|!0|!1|0``
  Aborting a controller releases its link to every parent (`release`), so whether a parent also drops the listener after firing changes nothing.
- ``src/kernel/abort.ts|Aborter.constructor|push → unshift|push|unshift|0``
  Each unlink removes one listener from one parent; the order they run in doesn't matter.
- ``src/kernel/abort.ts|Aborter.abort|test → false|this.signal.aborted|false|0``
  A second abort then releases nothing (the links are already gone) and the signal ignores a second fire, keeping its first reason.
- ``src/kernel/abort.ts|Aborter.abort|early return removed|return;|;|0``
  As above: a second abort finds nothing to release and nothing to fire.
- ``src/kernel/abort.ts|Aborter.release|statement removed|this.unlink = [];|;|0``
  Unlinking is idempotent (removing a listener twice removes it once), and the kept closures only point from the child to parents that outlive it.

## src/kernel/operators.ts

- ``src/kernel/operators.ts|inputError|early return removed|return;|;|0``
  The function ends there anyway (the transpiled `return undefined`), returning undefined either way.
- ``src/kernel/operators.ts|scan.compute|test → true|!entry.error|true|0``
  Unreachable: the input-error guard before it returns an input's error first, so no error entry reaches the fold (see `uncovered-branches.md`).
- ``src/kernel/operators.ts|node.compute|test → false|innerView.error|false|0``
  Unreachable for the same reason: an error on the inner node is an input error, returned by the guard first.
- ``src/kernel/operators.ts|record|&& → |||&&||||1``
  With the second test loosened, a string, number or array passes through as the record; every member the operators read of it (`add`, `path`, `at`, `initial`, `inputs`, `states`) is then absent or not a number or list, exactly as on the empty record.
- ``src/kernel/operators.ts|own|&& → |||&&||||1``
  A state machine's states or events that aren't an object then yield a character or nothing; a character has no `on` or `target`, so no transition fires either way.

## src/kernel/erector.ts

- ``src/kernel/erector.ts|name|test → true|item.kind === "seed"|true|0``
  A node of another kind without an operator name then finds the seed operator, whose kind doesn't match its own: it is refused with the same code and message.
- ``src/kernel/erector.ts|operator|test → true|Object.hasOwn(operators, name)|true|0``
  An inherited member of the catalogue (a name such as `toString`) is a function with no kind: refused as no operator of that kind, with the same message.
- ``src/kernel/erector.ts|erect|test → true|item.initial !== void 0|true|0``
  An `initial` of undefined is treated as none (`seed` appends only a defined first entry).
- ``src/kernel/erector.ts|erect|test → true|spec.activate|true|0``
  An `activate` of undefined is the same as none.
- ``src/kernel/erector.ts|erect|statement removed|current.model = item;|;|0``
  A kept node's model is compared only by its shape (kind, operator, parameters, first entry), which the kept model already has: only inputs and demand can differ, and those are read from the new model.
- ``src/kernel/erector.ts|driver.start|test → true|item.node.kind !== "effect"|true|0``
  The erected effects belong to the run, which disconnects them when it ends; disconnecting one again changes nothing.

## src/kernel/kernel.ts

- ``src/kernel/kernel.ts|KNode.retainAll|boolean flip|!1|!0|0``
  Every node is registered before use, and registering sets `retainAll` from the environment.
- ``src/kernel/kernel.ts|Scope.constructor|statement removed|this.env = env;|;|0``
  Nothing reads a scope's environment: scopes never leave the kernel.
- ``src/kernel/kernel.ts|KNode.dirty|boolean flip|!1|!0|0``
  A node's first computation always follows its priming (activation primes it), which marks it dirty; the initial flag is never read.
- ``src/kernel/kernel.ts|HostDemand.constructor|statement removed|this.label = label;|;|0``
  A host demand's label is kept for a person inspecting it; nothing reads it.
- ``src/kernel/kernel.ts|Environment.cycleAt|number changed|0|1|0``
  `cycleAt` is set when each cycle starts and read only while one runs.
- ``src/kernel/kernel.ts|Environment.constructor|statement removed|this.scopes.set(this.root, this.rootScope);|;|0``
  The root never finishes, and only a finishing process looks its scope up; the root's scope is used directly.
- ``src/kernel/kernel.ts|Environment.removeNow|test → true|consumer instanceof HostDemand|true|0``
  Releasing a node consumer's edge on a node being forgotten changes nothing observable: the forgotten node is deactivated either way, and a consumer releasing it later finds no edge.
- ``src/kernel/kernel.ts|Environment.removeNow|test → true|node.kind === "effect"|true|0``
  Disconnecting a node that isn't a connected effect returns at once (it has no scope).
- ``src/kernel/kernel.ts|Environment.removeNow|test → true|node.active && node.kind !== "effect"|true|0``
  Deactivating a node that is already inactive, or an effect just disconnected, changes nothing.
- ``src/kernel/kernel.ts|Environment.removeNow|&& → |||&&||||0``
  As above: the extra cases are inactive nodes, which deactivating again leaves as they are.
- ``src/kernel/kernel.ts|Environment.release|push → unshift|push|unshift|0``
  Every change that adds something (a demand, a connection, an effect) checks its token before it applies, and rewiring an inactive node demands nothing: releases running first end in the same state.
- ``src/kernel/kernel.ts|Environment.change.release|boolean flip|!1|!0|0``
  When the activation bound is reached no change is pending (the loop applies every pending change before it counts an activation), so which changes would be dropped is never asked.
- ``src/kernel/kernel.ts|Environment.release.release|boolean flip|!0|!1|0``
  When the activation bound is reached no change is pending (the loop applies every pending change before it counts an activation), so which changes would be dropped is never asked.
- ``src/kernel/kernel.ts|Environment.drain|continue removed|continue;|;|1``
  After the bound, the primed set is empty, so the rest of the loop body does nothing before the loop continues.
- ``src/kernel/kernel.ts|Environment.drain|test → true|primed.length|true|0``
  A deactivated node leaves the primed set (`deactivate`), so the active filter never empties a non-empty set.
- ``src/kernel/kernel.ts|Environment.drain|statement removed|this.pendingChanges = this.pendingChanges.filter((change) => change.release);|;|0``
  When the activation bound is reached no change is pending (the loop applies every pending change before it counts an activation), so which changes would be dropped is never asked.
- ``src/kernel/kernel.ts|Environment.consumersOf|test → true|consumer instanceof KNode && consumer.active|true|0``
  Every node consumer on an edge is active (edges are added on activation and released on deactivation); a host demand let through is filtered out again (it has no count or activity), so no extra node takes part in a cycle.
- ``src/kernel/kernel.ts|Environment.consumersOf|&& → |||&&||||0``
  Every node consumer on an edge is active (edges are added on activation and released on deactivation); a host demand let through is filtered out again (it has no count or activity), so no extra node takes part in a cycle.
- ``src/kernel/kernel.ts|start|push → unshift|push|unshift|0``
  The participants list is only walked to trim and to find unbalanced nodes; its order doesn't matter.
- ``src/kernel/kernel.ts|finish|statement removed|node.startedTo = [];|;|0``
  A node's `startedTo` is set afresh whenever a cycle first starts it; the old list is never read.
- ``src/kernel/kernel.ts|Environment.runCycle|push → unshift|push|unshift|1``
  The participants list is only walked to trim and to find unbalanced nodes; its order doesn't matter.
- ``src/kernel/kernel.ts|Environment.runCycle|statement removed|node.dirty = !0;|;|0``
  A primed node is marked dirty twice: when it starts and when the wiring seed ends at it with a change; either alone makes it compute.
- ``src/kernel/kernel.ts|Environment.runCycle|boolean flip|!0|!1|1``
  A primed node is marked dirty twice: when it starts and when the wiring seed ends at it with a change; either alone makes it compute.
- ``src/kernel/kernel.ts|Environment.runCycle|statement removed|seed.startedTo = [];|;|0``
  A node's `startedTo` is set afresh whenever a cycle first starts it; the old list is never read.
- ``src/kernel/kernel.ts|Environment.runCycle|boolean flip|!0|!1|3``
  A primed node is marked dirty twice: when it starts and when the wiring seed ends at it with a change; either alone makes it compute.
- ``src/kernel/kernel.ts|Environment.runCycle|statement removed|node.startedTo = [];|;|0``
  A node's `startedTo` is set afresh whenever a cycle first starts it; the old list is never read.
- ``src/kernel/kernel.ts|Environment.runCycle|boolean flip|!1|!0|0``
  An unbalanced node (only when a host callback throws mid-cycle) keeping its dirty flag computes once more from unchanged inputs: a pure computation gives the same value, so nothing is appended or reported.
- ``src/kernel/kernel.ts|Environment.runCycle|statement removed|node.dirty = !1;|;|0``
  An unbalanced node (only when a host callback throws mid-cycle) keeping its dirty flag computes once more from unchanged inputs: a pure computation gives the same value, so nothing is appended or reported.
- ``src/kernel/kernel.ts|follower.run|test → true|consumer instanceof KNode && consumer.active|true|0``
  Every node consumer on an edge is active (edges are added on activation and released on deactivation); a host demand let through is filtered out again (it has no count or activity), so no extra node takes part in a cycle.
- ``src/kernel/kernel.ts|fresh|test → true|changed|true|0``
  When an input didn't change in this cycle it has no entry from this cycle, so the filter finds none either way.
- ``src/kernel/kernel.ts|follower.run|&& → |||&&||||0``
  Every node consumer on an edge is active (edges are added on activation and released on deactivation); a host demand let through is filtered out again (it has no count or activity), so no extra node takes part in a cycle.
- ``src/kernel/kernel.ts|Environment.updateDemand|test → true|demand instanceof KNode|true|0``
  For a plain spec, comparing its source (none) with the spec never matches, so the edge is set again to the same spec: the same state.
- ``src/kernel/kernel.ts|Environment.dropFollower|statement removed|edge.follower = void 0;|;|0``
  A dropped follower is disconnected and forgotten; doing it again, or deleting an ID it no longer holds, changes nothing (IDs aren't reused within a batch).
- ``src/kernel/kernel.ts|Environment.dropFollower|test → true|this.nodes.get(edge.follower.id) === edge.follower|true|0``
  A dropped follower is disconnected and forgotten; doing it again, or deleting an ID it no longer holds, changes nothing (IDs aren't reused within a batch).
- ``src/kernel/kernel.ts|Environment.deactivate|statement removed|this.primed.delete(node);|;|0``
  The drain filters the primed set by activity before running it, so an inactive node left in it never runs.
- ``src/kernel/kernel.ts|Environment.deactivate|test → true|node.kind === "combinator" || node.kind === "effect"|true|0``
  Seeds, drivers and processes have no inputs to release.
- ``src/kernel/kernel.ts|Environment.deactivate|statement removed|node.activationAborter = void 0;|;|0``
  The aborter kept is already aborted; aborting it again does nothing, and the next activation replaces it.
- ``src/kernel/kernel.ts|Environment.deactivate|slice → splice|slice|splice|0``
  `splice(-1)` returns the same one-entry list that `slice(-1)` does, and the held list is replaced by it.
- ``src/kernel/kernel.ts|Environment.hostDemand|early return removed|return;|;|0``
  With the token already aborted, the queued change checks it and adds nothing, and `onAbort` registers nothing.
- ``src/kernel/kernel.ts|Environment.hostDemand|test → false|signal.aborted|false|0``
  With the token already aborted, the queued change checks it and adds nothing, and `onAbort` registers nothing.
- ``src/kernel/kernel.ts|Environment.reaches|test → false|seen.has(node)|false|0``
  The cycle check walks an acyclic graph (cycles are refused), so revisiting nodes, or visiting them in another order, only costs time.
- ``src/kernel/kernel.ts|Environment.reaches|continue removed|continue;|;|0``
  The cycle check walks an acyclic graph (cycles are refused), so revisiting nodes, or visiting them in another order, only costs time.
- ``src/kernel/kernel.ts|Environment.connectEffect|statement removed|scope.effects.push(effect);|;|0``
  A run's connected effects are also its own nodes (`run.effect` is the only way into a run's scope), and a run's end forgets every one of those, which disconnects them; the root scope never ends.
- ``src/kernel/kernel.ts|Environment.reaches|statement removed|seen.add(node);|;|0``
  The cycle check walks an acyclic graph (cycles are refused), so revisiting nodes, or visiting them in another order, only costs time.
- ``src/kernel/kernel.ts|Environment.reaches|push → unshift|push|unshift|0``
  The cycle check walks an acyclic graph (cycles are refused), so revisiting nodes, or visiting them in another order, only costs time.
- ``src/kernel/kernel.ts|Environment.connectEffect|push → unshift|push|unshift|0``
  A run's connected effects are also its own nodes (`run.effect` is the only way into a run's scope), and a run's end forgets every one of those, which disconnects them; the root scope never ends.
- ``src/kernel/kernel.ts|Environment.disconnect|test → true|index >= 0|true|0``
  A connected effect is always in its scope's list (it is pushed when connected), so the index is never -1.
- ``src/kernel/kernel.ts|Environment.disconnect|test → true|effect.active|true|0``
  Deactivating an inactive effect changes nothing.
- ``src/kernel/kernel.ts|Environment.forgetEffect|test → false|index >= 0|false|0``
  Only the run's own list of its effects differs: an effect forgotten early stays in it until the run ends, whose end forgets it again (idempotently); nothing else reads the list, and the effect is disconnected and out of the environment either way.
- ``src/kernel/kernel.ts|Environment.forgetEffect|>= → <|>=|<|0``
  Only the run's own list of its effects differs: an effect forgotten early stays in it until the run ends, whose end forgets it again (idempotently); nothing else reads the list, and the effect is disconnected and out of the environment either way.
- ``src/kernel/kernel.ts|Environment.forgetEffect|number changed|0|1|0``
  Only the run's own list of its effects differs: an effect forgotten early stays in it until the run ends, whose end forgets it again (idempotently); nothing else reads the list, and the effect is disconnected and out of the environment either way.
- ``src/kernel/kernel.ts|Environment.forgetEffect|>= → >|>=|>|0``
  Only the run's own list of its effects differs: an effect forgotten early stays in it until the run ends, whose end forgets it again (idempotently); nothing else reads the list, and the effect is disconnected and out of the environment either way.
- ``src/kernel/kernel.ts|Environment.forgetEffect|statement removed|scope.nodes.splice(index, 1);|;|0``
  Only the run's own list of its effects differs: an effect forgotten early stays in it until the run ends, whose end forgets it again (idempotently); nothing else reads the list, and the effect is disconnected and out of the environment either way.
- ``src/kernel/kernel.ts|Environment.forgetEffect|test → true|this.nodes.get(effect.id) === effect|true|0``
  Only the run's own list of its effects differs: an effect forgotten early stays in it until the run ends, whose end forgets it again (idempotently); nothing else reads the list, and the effect is disconnected and out of the environment either way.
- ``src/kernel/kernel.ts|Environment.forgetEffect|number changed|1|0|0``
  Only the run's own list of its effects differs: an effect forgotten early stays in it until the run ends, whose end forgets it again (idempotently); nothing else reads the list, and the effect is disconnected and out of the environment either way.
- ``src/kernel/kernel.ts|Environment.connect|test → false|signal.aborted|false|0``
  With the token already aborted, the queued change checks it and connects nothing, and `onAbort` registers nothing.
- ``src/kernel/kernel.ts|Environment.connect|early return removed|return;|;|0``
  With the token already aborted, the queued change checks it and connects nothing, and `onAbort` registers nothing.
- ``src/kernel/kernel.ts|Environment.read|test → false|node.active || this.inCycle || this.applying|false|0``
  Taking the one-shot path while a cycle or a change runs queues a demand that checks its token when it applies, and the token is aborted before then: nothing activates, and the latest entry read is the same.
- ``src/kernel/kernel.ts|Environment.read||| → &&||||&&|0``
  Taking the one-shot path while a cycle or a change runs queues a demand that checks its token when it applies, and the token is aborted before then: nothing activates, and the latest entry read is the same.
- ``src/kernel/kernel.ts|Environment.read||| → &&||||&&|1``
  Taking the one-shot path while a cycle or a change runs queues a demand that checks its token when it applies, and the token is aborted before then: nothing activates, and the latest entry read is the same.
- ``src/kernel/kernel.ts|Environment.trim|<= → <|<=|<|0``
  With at most one entry, filtering keeps the latest anyway: the same entries.
- ``src/kernel/kernel.ts|Environment.trim|number changed|1|0|0``
  With at most one entry, filtering keeps the latest anyway: the same entries.
- ``src/kernel/kernel.ts|Environment.startDriver|test → true|options.role|true|0``
  A role of undefined is left out of the process tree like no role.
- ``src/kernel/kernel.ts|Environment.startDriver|early return removed|return;|;|0``
  It is the only statement of a function that does nothing (the run of a definition returning nothing waits for its token).
- ``src/kernel/kernel.ts|Environment.runContext.effect|push → unshift|push|unshift|0``
  The order of a run's own effects doesn't matter: its end forgets all of them.
- ``src/kernel/kernel.ts|finish|statement removed|this.scopes.delete(process);|;|0``
  A finished process never finishes again (`terminal`), so its scope entry is never looked up again.
- ``src/kernel/kernel.ts|Environment.begin|test → true|!signal.aborted|true|1``
  A finish after the token aborted returns at once: the process already finished as aborted.
- ``src/kernel/kernel.ts|finish|statement removed|this.disconnect(effect);|;|0``
  A run's connected effects are also its own nodes (`run.effect` is the only way into a run's scope), and a run's end forgets every one of those, which disconnects them; the root scope never ends.
- ``src/kernel/kernel.ts|Environment.begin|test → true|!signal.aborted|true|0``
  A finish after the token aborted returns at once: the process already finished as aborted.
- ``src/kernel/kernel.ts|index|test → true|siblings|true|0``
  Every process but the root has a parent that lists it until it is forgotten, which happens once (`terminal`), and the root is never forgotten: the guarded cases never occur.
- ``src/kernel/kernel.ts|Environment.forgetProcess|test → true|this.nodes.get(process.id) === process|true|0``
  Every process but the root has a parent that lists it until it is forgotten, which happens once (`terminal`), and the root is never forgotten: the guarded cases never occur.
- ``src/kernel/kernel.ts|Environment.forgetProcess|test → true|siblings && index >= 0|true|0``
  Every process but the root has a parent that lists it until it is forgotten, which happens once (`terminal`), and the root is never forgotten: the guarded cases never occur.
- ``src/kernel/kernel.ts|Environment.forgetProcess|&& → |||&&||||0``
  Every process but the root has a parent that lists it until it is forgotten, which happens once (`terminal`), and the root is never forgotten: the guarded cases never occur.
- ``src/kernel/kernel.ts|validSpec|test → false|spec.latest === !0|false|0``
  A spec that falls through every other form is read as latest anyway.
- ``src/kernel/kernel.ts|validSpec|boolean flip|!0|!1|0``
  A spec that falls through every other form is read as latest anyway.
- ``src/kernel/kernel.ts|validSpec.range|test → true|range.to !== void 0|true|0``
  A range with `to` undefined keeps what one without `to` keeps (an absent member).
- ``src/kernel/kernel.ts|validSpec|test → true|"query" in spec|true|0``
  A query spec and the latest spec keep and cover the same entries (only the latest).
- ``src/kernel/kernel.ts|validSpec|test → false|"query" in spec|false|0``
  A query spec and the latest spec keep and cover the same entries (only the latest).

