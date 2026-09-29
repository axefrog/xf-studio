/**
 * A brute-force reference model of the kernel, written a different way from the kernel so a test can compare the two.
 *
 * The kernel works incrementally: demand edges with counts, activation cascading as edges come and go, START/END
 * messages with per-node counters. The model keeps none of that. After every change it recomputes the whole active
 * set from scratch (what connected effects and the host demand, closed over inputs); a cycle walks every active node
 * in topological order and computes each one whose input appended in the cycle or that is being primed. Queued
 * changes, activation cycles and queued observations follow the drain order: changes, then an activation cycle for
 * what they activated or rewired, then the next queued observation as a cycle of its own.
 *
 * Processes are modelled as a tree with due times: completions are taken in due order (ties in start order); a
 * process that finishes aborts its running children with `{ parent: <status> }`; an abort reaches every running
 * descendant with the same reason; a completion after the end is discarded.
 */
import { canonical, equal } from "strata";
import type { Json } from "strata";

export type ErrorOut = { readonly error: string };
export type OpInput = { readonly has: boolean; readonly value?: Json; readonly error?: string };
export type OpResult = { readonly value: Json } | ErrorOut | "unchanged";
export type Spec = { readonly latest: true } | { readonly rolling: { readonly entries: number } } | { readonly range: { readonly from: number; readonly to?: number } };

/** The combinators the random graphs use: pure functions of their inputs' latest entries (and a window, for `collect`). */
export function operate(op: string, params: Record<string, Json>, inputs: readonly OpInput[], window: readonly Json[]): OpResult {
  const failed = inputs.find(input => input.error !== undefined);
  if (failed) return { error: failed.error! };
  const num = (input: OpInput) => typeof input.value === "number" ? input.value : 0;
  switch (op) {
    case "sum": return { value: inputs.reduce((total, input) => total + num(input), Number(params.add ?? 0)) };
    case "product": return { value: inputs.reduce((total, input) => total * (typeof input.value === "number" ? input.value : 1), 1) };
    case "max": return inputs.some(input => input.has) ? { value: Math.max(...inputs.filter(input => input.has).map(num)) } : "unchanged";
    case "threshold": return { value: num(inputs[0]) >= Number(params.at) };
    case "identity": return inputs[0].has ? { value: inputs[0].value ?? null } : "unchanged";
    case "fail-when": return !inputs[0].has ? "unchanged" : equal(inputs[0].value, params.equals) ? { error: String(params.message) } : { value: inputs[0].value ?? null };
    case "combine": return { value: inputs.map(input => input.value ?? null) };
    case "collect": return { value: [...window] };
    default: throw new Error(`unknown op ${op}`);
  }
}

export type ModelNode = {
  readonly id: string; readonly kind: "seed" | "combinator" | "effect";
  readonly op?: string; readonly params: Record<string, Json>;
  inputs: string[];
  /** For `collect`: the seed whose latest entry is its demand spec (demand as a source). */
  readonly specNode?: string;
  readonly probe?: boolean;
  /** Every entry it appended: a value, or an error. */
  readonly history: ({ value: Json } | ErrorOut)[];
  runs: number;
};
export type EffectBehaviour =
  | { readonly kind: "record"; readonly log: string }
  | { readonly kind: "rewire"; readonly target: string; readonly options: readonly (readonly string[])[] }
  | { readonly kind: "echo"; readonly seed: string }
  | { readonly kind: "explode"; readonly equals: Json };
export type ModelProcess = {
  readonly id: string; readonly parent?: string; readonly due?: number; readonly order: number;
  readonly outcome: { readonly done: Json } | { readonly fail: string } | "forever";
  readonly states: Json[]; terminal: boolean; readonly children: string[];
};
type Change = () => void;

const specOf = (value: Json | undefined): Spec => {
  const spec = value as Record<string, Json> | undefined;
  if (spec && typeof spec === "object" && spec.rolling) return { rolling: { entries: Number((spec.rolling as Record<string, Json>).entries) } };
  if (spec && typeof spec === "object" && spec.range) return spec as unknown as Spec;
  return { latest: true };
};
/** Seqs (1-based) of `count` entries a spec covers, given the node's entry count. */
export function covered(spec: Spec, count: number): number[] {
  const all = Array.from({ length: count }, (_, i) => i + 1);
  if ("rolling" in spec) return all.filter(seq => seq > count - spec.rolling.entries);
  if ("range" in spec) return all.filter(seq => seq >= spec.range.from && (spec.range.to === undefined || seq <= spec.range.to));
  return count ? [count] : [];
}

export class KernelModel {
  readonly nodes = new Map<string, ModelNode>();
  readonly behaviours = new Map<string, EffectBehaviour>();
  readonly logs = new Map<string, Json[]>();
  readonly probeLogs = new Map<string, string[]>();
  readonly errors: string[] = [];
  /** Host demand by token name: the node, its spec, and the cycle it began in. */
  readonly hostDemands = new Map<string, { node: string; spec: Spec; since: number }>();
  /** Effects connected (by the host or a run), by name of what connected them. */
  readonly connected = new Map<string, string>();
  readonly processes = new Map<string, ModelProcess>();
  /** Edge specs of demand-as-source consumers, as last applied. */
  private readonly edgeSpecs = new Map<string, Spec>();
  private changes: Change[] = [];
  private observations: [string, Json][][] = [];
  private primed = new Set<string>();
  private activeNow = new Set<string>();
  private draining = false;
  private inCycle = false;
  cycle = 0;
  private processOrder = 0;

  seed(id: string, initial?: Json, probe = false): void {
    this.nodes.set(id, { id, kind: "seed", params: {}, inputs: [], probe, history: initial === undefined ? [] : [{ value: initial }], runs: 0 });
  }
  combinator(id: string, op: string, inputs: string[], params: Record<string, Json> = {}, specNode?: string): void {
    this.nodes.set(id, { id, kind: "combinator", op, params, inputs: [...inputs], ...(specNode ? { specNode } : {}), history: [], runs: 0 });
  }
  effect(id: string, inputs: string[], behaviour: EffectBehaviour): void {
    this.nodes.set(id, { id, kind: "effect", params: {}, inputs: [...inputs], history: [], runs: 0 });
    this.behaviours.set(id, behaviour);
  }

  // ---- activity, recomputed from scratch ----

  /** Every active node: connected effects and host-demanded nodes, closed over inputs (and a consumer's spec node). */
  activeSet(): Set<string> {
    const active = new Set<string>();
    const stack = [...this.connected.keys(), ...[...this.hostDemands.values()].map(item => item.node)];
    while (stack.length) {
      const id = stack.pop()!;
      if (active.has(id)) continue;
      active.add(id);
      const node = this.nodes.get(id)!;
      stack.push(...node.inputs);
      if (node.specNode) stack.push(node.specNode);
    }
    return active;
  }
  latest(id: string) { const history = this.nodes.get(id)!.history; return history[history.length - 1]; }

  /** One change applied: activity recomputed; what it activated is primed, what it made dormant is not. */
  private applyChange(change: Change): void {
    const before = this.activeNow;
    change();
    const after = this.activeSet();
    for (const id of after) if (!before.has(id)) {
      const node = this.nodes.get(id)!;
      if (node.kind !== "seed") this.primed.add(id);
      if (node.specNode) this.edgeSpecs.set(id, specOf((this.latest(node.specNode) as { value?: Json } | undefined)?.value));
      if (node.probe) this.probeLog(id, "activate");
    }
    for (const id of before) if (!after.has(id)) {
      this.primed.delete(id);
      if (this.nodes.get(id)!.probe) this.probeLog(id, "release");
    }
    this.activeNow = after;
  }
  private probeLog(id: string, event: string) { const list = this.probeLogs.get(id) ?? []; list.push(event); this.probeLogs.set(id, list); }

  // ---- the host's operations ----

  observe(batch: [string, Json][]): void { this.observations.push(batch); this.drain(); }
  change(change: Change): void { this.changes.push(change); this.drain(); }
  demand(token: string, node: string, spec: Spec): void { this.change(() => { this.hostDemands.set(token, { node, spec, since: this.cycle }); }); }
  release(token: string): void { if (this.hostDemands.has(token)) this.change(() => { this.hostDemands.delete(token); }); }
  connect(name: string, effect: string): void { this.change(() => { this.connected.set(effect, name); }); }
  disconnect(effect: string): void { if (this.connected.has(effect)) this.change(() => { this.connected.delete(effect); }); }
  /** A rewiring: refused (error `cycle`) when a new input reaches the node; primes the node when it is active. */
  setInputs(id: string, inputs: string[]): void {
    this.change(() => {
      if (inputs.some(input => this.reaches(input, id))) { this.fail("cycle"); return; }
      this.nodes.get(id)!.inputs = [...inputs];
      if (this.activeSet().has(id)) this.primed.add(id);
    });
  }
  /** A one-shot read: a dormant node is demanded (and primed), read, and released. */
  read(id: string): Json | ErrorOut | null {
    if (this.activeNow.has(id)) return this.readLatest(id);
    this.demand("$read", id, { latest: true });
    const value = this.readLatest(id);
    this.release("$read");
    return value;
  }
  private readLatest(id: string) { const latest = this.latest(id); return latest ? ("error" in latest ? latest : latest.value) : null; }

  private reaches(from: string, target: string): boolean {
    const seen = new Set<string>(), stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...this.nodes.get(id)!.inputs);
    }
    return false;
  }
  private fail(code: string): void { this.observations.push([["$errors", code]]); }

  // ---- cycles ----

  private drain(): void {
    if (this.draining || this.inCycle) return;
    this.draining = true;
    try {
      for (;;) {
        if (this.changes.length) { const changes = this.changes; this.changes = []; for (const change of changes) this.applyChange(change); continue; }
        if (this.primed.size) { const primed = new Set([...this.primed].filter(id => this.activeNow.has(id))); this.primed.clear(); if (primed.size) this.runCycle([], primed); continue; }
        const next = this.observations.shift();
        if (!next) break;
        this.runCycle(next, new Set());
      }
    } finally { this.draining = false; }
  }

  /** Active non-seed nodes, inputs before consumers. */
  private topological(): string[] {
    const out: string[] = [], seen = new Set<string>();
    const visit = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      for (const input of this.nodes.get(id)!.inputs) visit(input);
      out.push(id);
    };
    for (const id of [...this.activeNow].sort()) visit(id);
    return out.filter(id => this.nodes.get(id)!.kind !== "seed" && this.activeNow.has(id));
  }

  private runCycle(origins: readonly [string, Json][], primed: ReadonlySet<string>): void {
    this.cycle++;
    this.inCycle = true;
    try {
      const changed = new Set<string>();
      for (const [id, value] of origins) {
        if (id === "$errors") { this.errors.push(value as string); continue; }
        this.nodes.get(id)!.history.push({ value });
        changed.add(id);
      }
      // A spec node that appended moves its consumers' demand at the end of the cycle.
      for (const id of changed) for (const node of this.nodes.values()) if (node.specNode === id && this.activeNow.has(node.id)) {
        const consumer = node.id;
        this.changes.push(() => {
          const next = specOf((this.latest(id) as { value?: Json }).value);
          if (!this.activeNow.has(consumer) || equal(this.edgeSpecs.get(consumer), next)) return;
          this.edgeSpecs.set(consumer, next);
          this.primed.add(consumer);
        });
      }
      for (const id of this.topological()) {
        const node = this.nodes.get(id)!;
        if (!primed.has(id) && !node.inputs.some(input => changed.has(input))) continue;
        node.runs++;
        if (node.kind === "effect") { this.runEffect(node); continue; }
        const inputs: OpInput[] = node.inputs.map(input => {
          const latest = this.latest(input);
          return !latest ? { has: false } : "error" in latest ? { has: true, error: latest.error } : { has: true, value: latest.value };
        });
        // A window reads the spec node's current spec over the input's entries.
        const source = node.inputs[0] && this.nodes.get(node.inputs[0])!;
        const window = node.specNode && source ? covered(specOf((this.latest(node.specNode) as { value?: Json } | undefined)?.value), source.history.length)
          .map(seq => source.history[seq - 1]).map(entry => "error" in entry ? null : entry.value) : [];
        const result = operate(node.op!, node.params, inputs, window);
        if (result === "unchanged") continue;
        const previous = this.latest(id);
        if (previous && canonical(previous) === canonical(result)) continue;
        node.history.push(result);
        changed.add(id);
      }
    } finally { this.inCycle = false; }
  }

  private runEffect(node: ModelNode): void {
    const behaviour = this.behaviours.get(node.id)!;
    const values = node.inputs.map(input => { const latest = this.latest(input); return !latest ? null : "error" in latest ? latest : latest.value; });
    switch (behaviour.kind) {
      case "record": { const list = this.logs.get(behaviour.log) ?? []; list.push(values as Json); this.logs.set(behaviour.log, list); return; }
      case "echo": { const value = values[0]; this.observations.push([[behaviour.seed, value && typeof value === "object" && "error" in (value as object) ? null : value as Json]]); return; }
      case "explode": if (equal(values[0], behaviour.equals)) this.fail("effect"); return;
      case "rewire": {
        const choice = behaviour.options[Number(values[0])];
        const target = this.nodes.get(behaviour.target)!;
        if (choice && !equal(choice, target.inputs)) this.setInputs(behaviour.target, [...choice]);
        return;
      }
    }
  }

  // ---- processes ----

  spawn(id: string, outcome: ModelProcess["outcome"], due: number | undefined, parent?: string): void {
    const process: ModelProcess = { id, ...(parent ? { parent } : {}), ...(due !== undefined ? { due } : {}), order: this.processOrder++, outcome, states: [{ status: "running" }], terminal: false, children: [] };
    this.processes.set(id, process);
    if (parent) this.processes.get(parent)!.children.push(id);
  }
  /** Aborts a process and every running descendant with the same reason. */
  abort(id: string, reason: Json): void {
    const process = this.processes.get(id)!;
    if (process.terminal) return;
    this.end(process, { status: "aborted", reason });
    for (const child of process.children) this.abort(child, reason);
  }
  private end(process: ModelProcess, state: Json): void { process.terminal = true; process.states.push(state); }
  /** Completes what falls due by `now`, in due order (ties in start order). */
  advance(now: number): void {
    const due = [...this.processes.values()].filter(item => item.due !== undefined && item.due <= now && !item.terminal).sort((a, b) => a.due! - b.due! || a.order - b.order);
    for (const process of due) {
      if (process.terminal) continue;
      const status = "done" in (process.outcome as object) ? "done" : "failed";
      this.end(process, status === "done" ? { status, result: (process.outcome as { done: Json }).done } : { status, error: { message: (process.outcome as { fail: string }).fail } });
      for (const child of process.children) this.abort(child, { parent: status });
    }
  }
  /** Running processes as a tree of IDs (children sorted). */
  runningTree(parent?: string): Json[] {
    return [...this.processes.values()].filter(item => !item.terminal && item.parent === parent).sort((a, b) => a.id < b.id ? -1 : 1)
      .map(item => ({ id: item.id, children: this.runningTree(item.id) }));
  }
}
