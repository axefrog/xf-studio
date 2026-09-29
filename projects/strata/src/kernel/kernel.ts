/**
 * The execution kernel (SPEC §3–§9): every node is a stream; nothing runs without demand; five node kinds; cycles
 * made glitch-free by START/END counting; wiring changes queued to the end of a cycle; errors as values; drivers whose
 * start returns a process node; child processes; cancellation by abort signals.
 */
import { equal, freeze } from "../json";
import type { Json } from "../json";
import type { Clock } from "../sources";
import { Aborter, onAbort } from "./abort";
import type { AbortSignalLike } from "./abort";

export type NodeKind = "seed" | "combinator" | "effect" | "driver" | "process";
export type ErrorRecord = { readonly message: string; readonly code?: string; readonly data?: Json };
/** A kernel entry (SPEC §3.2). */
export type KEntry<T = unknown> = { readonly seq: number; readonly cycle: number; readonly at: number; readonly value?: T; readonly error?: ErrorRecord };

/** A demand spec (SPEC §4.2). */
export type DemandSpec =
  | { readonly latest: true }
  | { readonly entry: number }
  | { readonly range: { readonly from: number; readonly to?: number } }
  | { readonly rolling: { readonly entries?: number; readonly ms?: number } }
  | { readonly query: Json };
export const LATEST: DemandSpec = Object.freeze({ latest: true as const });
/** A demand: a spec, or a node whose latest entry is the spec (demand as a source, SPEC §4.3). */
export type Demand = DemandSpec | KNode<DemandSpec>;

/** Returned by a computation whose output hasn't changed. */
export const UNCHANGED: unique symbol = Symbol("strata.unchanged");
/** An error value a computation may return instead of throwing. */
export class ErrorValue { constructor(readonly error: ErrorRecord) {} }
export const errorValue = (message: string, extra: Omit<ErrorRecord, "message"> = {}) => new ErrorValue({ message, ...extra });

/** What a computation or effect sees of one input. */
export type InputView<T = unknown> = {
  readonly node: KNode<T>;
  /** The latest entry, if any. */
  readonly latest?: KEntry<T>;
  readonly value?: T;
  readonly error?: ErrorRecord;
  /** Whether the input changed in this cycle. */
  readonly changed: boolean;
  /** Entries appended in this cycle. */
  readonly fresh: readonly KEntry<T>[];
  /** Retained entries the input's demand covers (a range or rolling window). */
  readonly window: readonly KEntry<T>[];
};
export type ComputeContext = {
  readonly inputs: readonly InputView[];
  /** The node's own latest entry before this computation. */
  readonly previous?: KEntry;
  readonly cycle: number; readonly at: number;
  /** The environment (for effects: observations and wiring changes, which are queued). */
  readonly env: Environment;
};
export type Compute<T> = (context: ComputeContext) => T | typeof UNCHANGED | ErrorValue;
export type Run = (context: ComputeContext) => void;
export type Input = KNode | { readonly node: KNode; readonly demand?: Demand };

type Consumer = KNode | HostDemand;
class HostDemand { constructor(readonly label: string) {} }
type Edge = { spec: DemandSpec; source?: KNode<DemandSpec> };

let anonymous = 0;

/** A node: its identity, kind and stream. */
export class KNode<T = unknown> {
  /** Retained entries, oldest first. */
  entries: KEntry<T>[] = [];
  nextSeq = 1;
  inputs: { node: KNode; demand: Demand }[] = [];
  /** Demand edges on this node, by consumer. */
  readonly demands = new Map<Consumer, Edge>();
  active = false;
  // Cycle state.
  counter = 0;
  dirty = false;
  startedTo: KNode[] = [];
  appendedIn = 0;
  computes = 0;
  /** Seeds: their activation and its controller. */
  activation?: (context: { readonly signal: AbortSignalLike; readonly observe: (value: T) => void }) => void;
  activationAborter?: Aborter;
  compute?: Compute<T>;
  run?: Run;
  /** Effects: the run scope connecting them. */
  scope?: Scope;
  /** Keep every entry (conformance, entity streams managed elsewhere). */
  retainAll = false;
  constructor(readonly env: Environment, readonly id: string, readonly kind: NodeKind, readonly name: string) {}
  latest(): KEntry<T> | undefined { return this.entries[this.entries.length - 1]; }
  /** The latest value (undefined when there is none or it is an error). */
  value(): T | undefined { return this.latest()?.value; }
  /** A detached list of retained entries. */
  stream(): readonly KEntry<T>[] { return [...this.entries]; }
  /** The host demands this node until `signal` aborts (SPEC §4.1). */
  demand(demand: Demand, signal: AbortSignalLike, label = "host"): void { this.env.hostDemand(this, demand, signal, label); }
}

/** A running driver's scope: its effects, child runs and processes. */
export class Scope {
  readonly effects: KNode[] = [];
  readonly nodes: KNode[] = [];
  constructor(readonly env: Environment, readonly process: Process, readonly signal: AbortSignalLike) {}
}

/** Process state entries (SPEC §9.2). */
export type ProcessState =
  | { readonly status: "running" }
  | { readonly status: "progress"; readonly progress: Json }
  | { readonly status: "done"; readonly result: Json }
  | { readonly status: "failed"; readonly error: ErrorRecord }
  | { readonly status: "aborted"; readonly reason: Json };

/** A process node: long-running work, observable as the stream of its state. */
export class Process extends KNode<ProcessState> {
  readonly aborter: Aborter;
  readonly children: Process[] = [];
  terminal = false;
  constructor(env: Environment, id: string, name: string, readonly parent: Process | undefined, signal?: AbortSignalLike) {
    super(env, id, "process", name);
    this.aborter = new Aborter(signal, parent?.aborter.signal);
  }
  get signal(): AbortSignalLike { return this.aborter.signal; }
  /** The status of the latest state. */
  status(): ProcessState["status"] | undefined { return this.value()?.status; }
  abort(reason: Json = "aborted"): void { this.aborter.abort(reason); }
}

/** What a driver's definition gets when it runs. */
export interface RunContext {
  readonly env: Environment;
  readonly signal: AbortSignalLike;
  /** The run's process node. */
  readonly process: Process;
  /** An effect connected for the length of the run (it demands its inputs while connected). */
  effect(spec: { readonly name?: string; readonly inputs: readonly Input[]; readonly run: Run; readonly id?: string; readonly signal?: AbortSignalLike }): KNode;
  /** A child process doing long-running work in the context of `parent` (the run's process by default). */
  spawn<R extends Json>(name: string, work: (signal: AbortSignalLike, report: (progress: Json) => void) => Promise<R>, options?: { readonly parent?: Process; readonly id?: string }): Process;
  /** Starts a child driver whose run is a child of `parent` (the run's process by default). */
  start(driver: Driver, options?: { readonly signal?: AbortSignalLike; readonly parent?: Process; readonly params?: Json }): Process;
}

export type DriverDefinition = { readonly name: string; start(run: RunContext, params?: Json): void | Promise<Json | void> };

/** A driver: starting it returns the run's process node. */
export class Driver extends KNode<string> {
  constructor(env: Environment, id: string, readonly definition: DriverDefinition) { super(env, id, "driver", definition.name); }
  /** Starts a run with a token; the run ends when it aborts (SPEC §9.1). */
  start(signal?: AbortSignalLike, params?: Json): Process { return this.env.startDriver(this, { signal, params }); }
}

export interface EnvironmentOptions {
  readonly clock: Clock;
  /** Retain every entry of every node (conformance and debugging). */
  readonly retainAll?: boolean;
  /** Bound on consecutive activation cycles (SPEC §6.11). */
  readonly activationBound?: number;
  /** Called after each cycle (the simulation harness checks invariants here). */
  readonly onCycle?: (report: CycleReport) => void;
}
export type CycleReport = {
  readonly cycle: number; readonly kind: "observe" | "activate";
  /** Every node that finished, in order, and whether it computed and appended. */
  readonly finished: readonly { readonly node: KNode; readonly computed: boolean; readonly appended: boolean }[];
  /** Nodes that received START but never finished (must be empty: K5). */
  readonly unbalanced: readonly KNode[];
};

/** Creates a kernel environment. */
export const createEnvironment = (options: EnvironmentOptions): Environment => new Environment(options);

/** A kernel environment: nodes, cycles and the queue of pending changes and observations. */
export class Environment {
  readonly clock: Clock;
  private readonly nodes = new Map<string, KNode>();
  cycle = 0;
  inCycle = false;
  private applying = false;
  private pendingChanges: (() => void)[] = [];
  private pendingObservations: [KNode, unknown][][] = [];
  private transactionDepth = 0;
  private transactionBuffer: [KNode, unknown][] = [];
  private primed = new Set<KNode>();
  private readonly retainAll: boolean;
  private readonly activationBound: number;
  private readonly onCycle?: (report: CycleReport) => void;
  /** The error seed (SPEC §7.3–7.4). */
  readonly errors: KNode<ErrorRecord>;
  /** The root run: the scope of nodes created outside any driver run. */
  readonly root: Process;
  private rootScope: Scope;
  private readonly scopes = new Map<Process, Scope>();

  constructor(options: EnvironmentOptions) {
    this.clock = options.clock;
    this.retainAll = !!options.retainAll;
    this.activationBound = options.activationBound ?? 64;
    this.onCycle = options.onCycle;
    this.errors = this.seed<ErrorRecord>({ id: "$errors", name: "errors" });
    this.root = new Process(this, "$root", "root", undefined);
    this.register(this.root);
    this.rootScope = new Scope(this, this.root, this.root.signal);
    this.scopes.set(this.root, this.rootScope);
    this.append(this.root, { status: "running" });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Creating nodes
  // ---------------------------------------------------------------------------------------------------------------

  private register<N extends KNode>(node: N): N {
    if (this.nodes.has(node.id)) throw new Error(`A node ${node.id} already exists.`);
    this.nodes.set(node.id, node);
    node.retainAll = this.retainAll;
    return node;
  }
  private newId(prefix: string, id?: string) { return id ?? `${prefix}#${++anonymous}`; }
  node(id: string): KNode | undefined { return this.nodes.get(id); }
  /** Every node, for inspection. */
  allNodes(): readonly KNode[] { return [...this.nodes.values()]; }

  /** A seed: content from outside, through observations. `initial` is appended at once (SPEC §10.2). */
  seed<T>(spec: { readonly id?: string; readonly name?: string; readonly initial?: T; readonly activate?: KNode<T>["activation"]; readonly retainAll?: boolean } = {}): KNode<T> {
    const node = this.register(new KNode<T>(this, this.newId("seed", spec.id), "seed", spec.name ?? spec.id ?? "seed"));
    node.activation = spec.activate;
    if (spec.retainAll) node.retainAll = true;
    if (spec.initial !== undefined) this.append(node, spec.initial);
    return node;
  }

  /** A combinator: inputs and a computation. Dormant until demanded. */
  combinator<T>(spec: { readonly id?: string; readonly name?: string; readonly inputs: readonly Input[]; readonly compute: Compute<T> }): KNode<T> {
    const node = this.register(new KNode<T>(this, this.newId("combinator", spec.id), "combinator", spec.name ?? spec.id ?? "combinator"));
    node.compute = spec.compute;
    node.inputs = spec.inputs.map(normaliseInput);
    return node;
  }

  /** An effect, not yet connected. Connect it within a driver's run (`run.effect`) or with `connect`. */
  effect(spec: { readonly id?: string; readonly name?: string; readonly inputs: readonly Input[]; readonly run: Run }): KNode {
    const node = this.register(new KNode(this, this.newId("effect", spec.id), "effect", spec.name ?? spec.id ?? "effect"));
    node.run = spec.run;
    node.inputs = spec.inputs.map(normaliseInput);
    return node;
  }

  /** A driver: starting it runs its definition and returns the run's process node. */
  driver(definition: DriverDefinition, id?: string): Driver {
    return this.register(new Driver(this, this.newId("driver", id), definition));
  }

  /** Forgets a node (a queued change): an effect is disconnected, host demand on it released. */
  remove(node: KNode): void { this.change(() => this.removeNow(node)); }
  /** @internal Within a change: removes a node at once. */
  removeNow(node: KNode): void {
    if (node.kind === "effect") this.disconnect(node);
    for (const consumer of [...node.demands.keys()]) if (consumer instanceof HostDemand) this.releaseDemand(node, consumer);
    if (node.active && node.kind !== "effect") this.deactivate(node);
    this.nodes.delete(node.id);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Observations and transactions
  // ---------------------------------------------------------------------------------------------------------------

  /** Observes a seed. Outside a cycle it runs a cycle now; during one, it starts a later cycle (SPEC §6.8). */
  observe<T>(seed: KNode<T>, value: T): void {
    if (seed.kind !== "seed" && seed.kind !== "process") throw new Error("Only seeds and processes are observed.");
    if (this.transactionDepth > 0) { this.transactionBuffer.push([seed, value]); return; }
    this.pendingObservations.push([[seed, value]]);
    this.drain();
  }

  /** Makes every observation in `fn` one transaction: one cycle. */
  transaction(fn: () => void): void {
    this.transactionDepth++;
    try { fn(); }
    finally {
      if (--this.transactionDepth === 0) {
        const batch = this.transactionBuffer;
        this.transactionBuffer = [];
        if (batch.length) { this.pendingObservations.push(batch); this.drain(); }
      }
    }
  }

  /** Applies a wiring change now (outside a cycle, followed by an activation cycle) or queues it (SPEC §6.8). */
  change(fn: () => void): void {
    this.pendingChanges.push(fn);
    this.drain();
  }

  /** Runs whatever is pending, unless a cycle (or this drain) is already running. */
  private drain(): void {
    if (this.inCycle || this.applying) return;
    this.applying = true;
    try {
      let activations = 0;
      for (;;) {
        if (this.pendingChanges.length) {
          const changes = this.pendingChanges;
          this.pendingChanges = [];
          for (const change of changes) {
            try { change(); } catch (error) { this.fail(`A wiring change failed: ${messageOf(error)}`); }
          }
          continue;
        }
        if (this.primed.size) {
          if (++activations > this.activationBound) {
            this.primed.clear();
            this.pendingChanges = [];
            this.fail("Wiring kept changing: stopped after the activation bound.", "activation-bound");
            continue;
          }
          const primed = [...this.primed].filter(node => node.active);
          this.primed.clear();
          if (primed.length) this.runCycle([], primed);
          continue;
        }
        activations = 0;
        const next = this.pendingObservations.shift();
        if (!next) break;
        this.runCycle(next, []);
      }
    } finally { this.applying = false; }
  }

  private fail(message: string, code?: string): void {
    this.pendingObservations.push([[this.errors, freeze({ message, ...(code ? { code } : {}) })]]);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The cycle (SPEC §6)
  // ---------------------------------------------------------------------------------------------------------------

  private append<T>(node: KNode<T>, value: T | undefined, error?: ErrorRecord): void {
    const entry: KEntry<T> = freeze({ seq: node.nextSeq++, cycle: this.cycle, at: this.clock.now(),
      ...(error ? { error } : { value: value as T }) });
    node.entries.push(entry);
    node.appendedIn = this.cycle;
  }

  private consumersOf(node: KNode): KNode[] {
    const out: KNode[] = [];
    for (const consumer of node.demands.keys()) if (consumer instanceof KNode && consumer.active) out.push(consumer);
    return out;
  }

  private runCycle(observations: readonly [KNode, unknown][], primed: readonly KNode[]): void {
    this.inCycle = true;
    this.cycle++;
    const participants: KNode[] = [];
    const finished: { node: KNode; computed: boolean; appended: boolean }[] = [];
    const start = (node: KNode) => {
      node.counter++;
      if (node.counter !== 1) return;
      participants.push(node);
      node.startedTo = this.consumersOf(node);
      for (const consumer of node.startedTo) start(consumer);
    };
    const end = (node: KNode, changed: boolean) => {
      node.counter--;
      if (changed) node.dirty = true;
      if (node.counter === 0) finish(node);
    };
    const finish = (node: KNode) => {
      let computed = false;
      const before = node.nextSeq;
      if (node.dirty && (node.kind === "combinator" || node.kind === "effect")) { computed = true; this.work(node); }
      node.dirty = false;
      const appended = node.nextSeq !== before;
      finished.push({ node, computed, appended });
      for (const consumer of node.startedTo) end(consumer, appended);
      node.startedTo = [];
    };
    try {
      // START from each origin seed, and from the wiring seed to each primed node.
      const origins = new Map<KNode, unknown[]>();
      for (const [seed, value] of observations) {
        const list = origins.get(seed) ?? [];
        list.push(value);
        origins.set(seed, list);
      }
      for (const seed of origins.keys()) {
        seed.counter++;
        participants.push(seed);
        seed.startedTo = this.consumersOf(seed);
        for (const consumer of seed.startedTo) start(consumer);
      }
      for (const node of primed) { node.dirty = true; start(node); }
      // END: seeds append their observations; the wiring seed ends at each primed node.
      for (const [seed, values] of origins) {
        for (const value of values) this.append(seed, value);
        seed.counter--;
        finished.push({ node: seed, computed: false, appended: true });
        for (const consumer of seed.startedTo) end(consumer, true);
        seed.startedTo = [];
      }
      for (const node of primed) end(node, true);
    } finally {
      const unbalanced = participants.filter(node => node.counter !== 0);
      for (const node of unbalanced) { node.counter = 0; node.startedTo = []; node.dirty = false; }
      for (const node of participants) this.trim(node);
      this.inCycle = false;
      this.onCycle?.({ cycle: this.cycle, kind: observations.length ? "observe" : "activate", finished, unbalanced });
    }
  }

  private view(input: { node: KNode; demand: Demand }): InputView {
    const node = input.node, latest = node.latest();
    const changed = node.appendedIn === this.cycle && this.inCycle;
    const fresh = changed ? node.entries.filter(entry => entry.cycle === this.cycle) : [];
    const spec = specOf(input.demand);
    return { node, latest, value: latest?.value, error: latest?.error, changed, fresh, window: covered(node, spec, this.clock.now()) };
  }

  private context(node: KNode): ComputeContext {
    return { inputs: node.inputs.map(input => this.view(input)), previous: node.latest(), cycle: this.cycle, at: this.clock.now(), env: this };
  }

  /** A combinator computes (appending only a changed value) or an effect runs; failures are values (SPEC §7). */
  private work(node: KNode): void {
    node.computes++;
    const context = this.context(node);
    if (node.kind === "effect") {
      try { node.run!(context); }
      catch (error) { this.fail(`Effect ${node.name} failed: ${messageOf(error)}`, "effect"); }
      return;
    }
    let result: unknown;
    try { result = node.compute!(context); }
    catch (error) { result = new ErrorValue({ message: messageOf(error) }); }
    if (result === UNCHANGED) return;
    const previous = node.latest();
    if (result instanceof ErrorValue) {
      if (previous?.error && equal(previous.error, result.error)) return;
      this.append(node, undefined, freeze(result.error));
      return;
    }
    if (previous && !previous.error && equal(previous.value, result)) return;
    this.append(node, freeze(result));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Demand and activity (SPEC §4)
  // ---------------------------------------------------------------------------------------------------------------

  private addDemand(producer: KNode, consumer: Consumer, demand: Demand): void {
    const edge: Edge = { spec: specOf(demand) };
    if (demand instanceof KNode) {
      edge.source = demand;
      // Demand as a source: follow the spec node without releasing the edge.
      const follower = this.effect({ name: `demand of ${producer.name}`, inputs: [demand], run: context => {
        const next = validSpec(context.inputs[0].value);
        this.change(() => { const current = producer.demands.get(consumer); if (current) { current.spec = next; this.trim(producer); } });
      } });
      this.connectEffect(follower, this.rootScope);
      (edge as Edge & { follower?: KNode }).follower = follower;
    }
    producer.demands.set(consumer, edge);
    if (!producer.active) this.activate(producer);
  }

  private releaseDemand(producer: KNode, consumer: Consumer): void {
    const edge = producer.demands.get(consumer) as (Edge & { follower?: KNode }) | undefined;
    if (!edge) return;
    producer.demands.delete(consumer);
    if (edge.follower) this.disconnect(edge.follower);
    if (producer.active && producer.demands.size === 0 && producer.kind !== "effect") this.deactivate(producer);
  }

  private activate(node: KNode): void {
    node.active = true;
    if (node.kind === "combinator" || node.kind === "effect") {
      for (const input of node.inputs) this.addDemand(input.node, node, input.demand);
      this.primed.add(node);
    }
    if (node.kind === "seed" && node.activation) {
      const aborter = new Aborter();
      node.activationAborter = aborter;
      const seed = node;
      try { node.activation({ signal: aborter.signal, observe: value => { if (!aborter.signal.aborted) this.observe(seed, value); } }); }
      catch (error) { this.fail(`Seed ${node.name} failed to activate: ${messageOf(error)}`); }
    }
  }

  private deactivate(node: KNode): void {
    node.active = false;
    this.primed.delete(node);
    if (node.kind === "combinator" || node.kind === "effect") for (const input of node.inputs) this.releaseDemand(input.node, node);
    if (node.activationAborter) { node.activationAborter.abort("dormant"); node.activationAborter = undefined; }
    if (!node.retainAll && node.kind !== "seed" && node.kind !== "process") node.entries = node.entries.slice(-1);
  }

  /** The host demands a node until `signal` aborts. */
  hostDemand(node: KNode, demand: Demand, signal: AbortSignalLike, label: string): void {
    if (signal.aborted) return;
    const consumer = new HostDemand(label);
    this.change(() => { if (!signal.aborted) this.addDemand(node, consumer, demand); });
    onAbort(signal, () => this.change(() => this.releaseDemand(node, consumer)));
  }

  /** Changes a node's inputs (a queued wiring change); refuses an input that would close a cycle (SPEC §5.1). */
  setInputs(node: KNode, inputs: readonly Input[]): void { this.change(() => this.setInputsNow(node, inputs)); }
  /** @internal Within a change: rewires at once. */
  setInputsNow(node: KNode, inputs: readonly Input[]): void {
    {
      const next = inputs.map(normaliseInput);
      for (const input of next) if (this.reaches(input.node, node)) {
        this.fail(`${node.name} can't take ${input.node.name} as an input: that would close a cycle.`, "cycle");
        return;
      }
      const wasActive = node.active;
      if (wasActive) for (const input of node.inputs) this.releaseDemand(input.node, node);
      node.inputs = next;
      if (wasActive) { for (const input of next) this.addDemand(input.node, node, input.demand); this.primed.add(node); }
    }
  }

  /** Whether `from` depends (through inputs) on `target`, or is it. */
  private reaches(from: KNode, target: KNode): boolean {
    const seen = new Set<KNode>(), stack = [from];
    while (stack.length) {
      const node = stack.pop()!;
      if (node === target) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const input of node.inputs) stack.push(input.node);
    }
    return false;
  }

  private connectEffect(effect: KNode, scope: Scope): void {
    if (effect.scope) return;
    effect.scope = scope;
    scope.effects.push(effect);
    this.activate(effect);
  }

  private disconnect(effect: KNode): void {
    if (!effect.scope) return;
    const scope = effect.scope;
    effect.scope = undefined;
    const index = scope.effects.indexOf(effect);
    if (index >= 0) scope.effects.splice(index, 1);
    if (effect.active) this.deactivate(effect);
  }

  /** Connects an effect in the root scope (for the host); ended by `signal`. */
  connect(effect: KNode, signal: AbortSignalLike): void {
    if (signal.aborted) return;
    this.change(() => { if (!signal.aborted) this.connectEffect(effect, this.rootScope); });
    onAbort(signal, () => this.change(() => this.disconnect(effect)));
  }

  /** A one-shot read (SPEC §4.8): activates a dormant node, primes it, reads, and releases it. */
  read<T>(node: KNode<T>): KEntry<T> | undefined {
    if (node.active || this.inCycle || this.applying) return node.latest();
    const aborter = new Aborter();
    this.hostDemand(node, LATEST, aborter.signal, "read");
    const latest = node.latest();
    aborter.abort("read");
    return latest;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Retention (SPEC §4.5)
  // ---------------------------------------------------------------------------------------------------------------

  private trim(node: KNode): void {
    if (node.retainAll || node.entries.length <= 1) return;
    const now = this.clock.now();
    const specs = [...node.demands.values()].map(edge => edge.spec);
    const last = node.entries[node.entries.length - 1];
    node.entries = node.entries.filter(entry => entry === last || specs.some(spec => keeps(spec, entry, node, now)));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Drivers and processes (SPEC §9)
  // ---------------------------------------------------------------------------------------------------------------

  /** @internal Starts a driver's run: a queued change; returns the run's process node at once. */
  startDriver(driver: Driver, options: { readonly signal?: AbortSignalLike; readonly parent?: Process; readonly params?: Json }): Process {
    const parent = options.parent ?? this.root;
    const process = this.register(new Process(this, this.newId(`run:${driver.id}`), `${driver.name} run`, parent, options.signal));
    parent.children.push(process);
    this.change(() => {
      this.append(driver, process.id);
      this.begin(process, signal => {
        const scope = new Scope(this, process, signal);
        this.scopes.set(process, scope);
        const context = this.runContext(scope);
        const result = driver.definition.start(context, options.params);
        // A definition that returns nothing runs until its token aborts.
        return result instanceof Promise ? result.then(value => (value ?? null) as Json) : new Promise<Json>(() => undefined);
      });
    });
    return process;
  }

  private runContext(scope: Scope): RunContext {
    return {
      env: this, signal: scope.signal, process: scope.process,
      effect: spec => {
        const effect = this.effect(spec);
        scope.nodes.push(effect);
        this.change(() => { if (!scope.signal.aborted && !spec.signal?.aborted) this.connectEffect(effect, scope); });
        // An effect may end before its run, by its own token.
        onAbort(spec.signal, () => this.change(() => { this.disconnect(effect); this.nodes.delete(effect.id); }));
        return effect;
      },
      spawn: (name, work, options = {}) => this.spawn(name, work, options.parent ?? scope.process, options.id),
      start: (driver, options = {}) => this.startDriver(driver, { ...options, parent: options.parent ?? scope.process }),
    };
  }

  /** Starts a process under `parent` (a queued change); its states arrive as observations. */
  spawn<R extends Json>(name: string, work: (signal: AbortSignalLike, report: (progress: Json) => void) => Promise<R>, parent: Process = this.root, id?: string): Process {
    const process = this.register(new Process(this, this.newId(`process:${name}`, id), name, parent));
    parent.children.push(process);
    this.change(() => this.begin(process, (signal, report) => work(signal, report)));
    return process;
  }

  private begin(process: Process, work: (signal: AbortSignalLike, report: (progress: Json) => void) => Promise<Json>): void {
    const signal = process.aborter.signal;
    const finish = (state: ProcessState) => {
      if (process.terminal) return;
      process.terminal = true;
      // Children end with their parent (SPEC §9.5), before its terminal entry is observed. An aborted parent's children
      // are aborted through their chained tokens, with the parent's reason (§8.3).
      if (state.status !== "aborted") for (const child of process.children) if (!child.terminal) child.abort({ parent: state.status });
      const scope = this.scopes.get(process);
      if (scope) {
        this.scopes.delete(process);
        this.change(() => { for (const effect of [...scope.effects]) this.disconnect(effect); });
      }
      this.observe(process, state);
    };
    if (signal.aborted) { this.observe(process, { status: "running" }); finish({ status: "aborted", reason: toJson(signal.reason) }); return; }
    this.observe(process, { status: "running" });
    onAbort(signal, () => finish({ status: "aborted", reason: toJson(signal.reason) }));
    let promise: Promise<Json>;
    try { promise = work(signal, progress => { if (!process.terminal && !signal.aborted) this.observe(process, { status: "progress", progress }); }); }
    catch (error) { finish({ status: "failed", error: { message: messageOf(error) } }); return; }
    promise.then(
      result => { if (!signal.aborted) finish({ status: "done", result: toJson(result) }); },
      error => { if (!signal.aborted) finish({ status: "failed", error: { message: messageOf(error) } }); });
  }

  /** A token as a node (SPEC §8.5): a seed that is `false`, then `true` when the signal aborts. */
  signalNode(signal: AbortSignalLike, name = "aborted"): KNode<boolean> {
    const node = this.seed<boolean>({ name, initial: signal.aborted });
    onAbort(signal, () => this.observe(node, true));
    return node;
  }
}

// -------------------------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------------------------

function normaliseInput(input: Input): { node: KNode; demand: Demand } {
  return input instanceof KNode ? { node: input, demand: LATEST } : { node: input.node, demand: input.demand ?? LATEST };
}

function validSpec(value: unknown): DemandSpec {
  if (!value || typeof value !== "object") return LATEST;
  const spec = value as Record<string, unknown>;
  if (spec.latest === true) return LATEST;
  if (Number.isSafeInteger(spec.entry)) return { entry: spec.entry as number };
  const range = spec.range as { from?: unknown; to?: unknown } | undefined;
  if (range && Number.isSafeInteger(range.from) && (range.to === undefined || Number.isSafeInteger(range.to)))
    return { range: { from: range.from as number, ...(range.to !== undefined ? { to: range.to as number } : {}) } };
  const rolling = spec.rolling as { entries?: unknown; ms?: unknown } | undefined;
  if (rolling && (Number.isSafeInteger(rolling.entries) || typeof rolling.ms === "number"))
    return { rolling: { ...(Number.isSafeInteger(rolling.entries) ? { entries: rolling.entries as number } : {}), ...(typeof rolling.ms === "number" ? { ms: rolling.ms } : {}) } };
  if ("query" in spec) return { query: spec.query as Json };
  return LATEST;
}

function specOf(demand: Demand): DemandSpec {
  return demand instanceof KNode ? validSpec(demand.value()) : validSpec(demand);
}

function keeps(spec: DemandSpec, entry: KEntry, node: KNode, now: number): boolean {
  if ("entry" in spec) return entry.seq === spec.entry;
  if ("range" in spec) return entry.seq >= spec.range.from && (spec.range.to === undefined || entry.seq <= spec.range.to);
  if ("rolling" in spec) {
    if (spec.rolling.entries !== undefined && entry.seq > node.nextSeq - 1 - spec.rolling.entries) return true;
    if (spec.rolling.ms !== undefined && entry.at >= now - spec.rolling.ms) return true;
    return false;
  }
  return false;
}

/** The retained entries a spec covers. */
function covered(node: KNode, spec: DemandSpec, now: number): readonly KEntry[] {
  if ("latest" in spec || "query" in spec) { const latest = node.latest(); return latest ? [latest] : []; }
  return node.entries.filter(entry => keeps(spec, entry, node, now));
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : typeof error === "string" ? error : "Failed.";
const toJson = (value: unknown): Json => {
  if (value === undefined) return null;
  try { return JSON.parse(JSON.stringify(value)) as Json; } catch { return String(value); }
};
