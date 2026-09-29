/**
 * A runner for data-driven test vectors: each vector describes a graph as data, a script of observations and the
 * expected results, and is run against this implementation.
 *
 * The environment keeps only what demand requires (SPEC §4.5): whole streams are recorded as they are appended, so
 * retention itself is under test (a window that loses an entry it must keep changes what `collect` computes, and
 * `retains` checks what is kept). A script naming a node the graph doesn't have fails the vector.
 */
import { canonical, equal } from "../json";
import type { Json } from "../json";
import { Aborter } from "../kernel/abort";
import { Environment, ErrorValue, KNode, UNCHANGED } from "../kernel/kernel";
import type { DemandSpec, Driver, KEntry, Process, ProcessTreeNode } from "../kernel/kernel";
import { erector } from "../kernel/erector";
import type { GraphModel } from "../kernel/erector";
import { inputError, standardOperators } from "../kernel/operators";
import type { Operators } from "../kernel/operators";
import { Scheduler, settle, simClock } from "./sim-sources";

export type KernelStep =
  | { readonly observe: Readonly<Record<string, Json>> | readonly (readonly [string, Json])[] }
  | { readonly start: string; readonly as: string }
  | { readonly abort: string; readonly reason?: Json }
  | { readonly advance: number }
  | { readonly model: GraphModel }
  | { readonly demand: string; readonly spec: DemandSpec | string; readonly as?: string }
  | { readonly read: string; readonly log: string }
  | { readonly token: string; readonly parents?: readonly string[] }
  | { readonly listen: string; readonly log: string; readonly value?: Json };
/** The running part of the process tree: runs by their driver (actor), processes by their work ID. */
export type TreeExpectation = { readonly actor?: string; readonly id?: string; readonly status: string; readonly children?: readonly TreeExpectation[] };
export type KernelVector = {
  readonly name: string; readonly kind: "kernel"; readonly rules?: readonly string[]; readonly description?: string;
  readonly graph: GraphModel; readonly seed?: string; readonly script: readonly KernelStep[];
  readonly expect: {
    readonly streams?: Readonly<Record<string, readonly Json[]>>;
    readonly computes?: Readonly<Record<string, number>>;
    readonly logs?: Readonly<Record<string, readonly Json[]>>;
    readonly processes?: Readonly<Record<string, readonly Json[]>>;
    /** The error seed's entries, as their `code`s. */
    readonly errorCodes?: readonly string[];
    readonly active?: Readonly<Record<string, boolean>>;
    /** Per node, seqs it must still retain at the end (it may retain more, SPEC §4.5). */
    readonly retains?: Readonly<Record<string, readonly number[]>>;
    /** The running runs and processes under the root, at the end (finished ones may have been forgotten, §9.8). */
    readonly tree?: readonly TreeExpectation[];
  };
};
/** A canonical-form vector (SPEC §2.2): a value and its canonical serialisation. */
export type CanonicalVector = {
  readonly name: string; readonly kind: "canonical"; readonly rules?: readonly string[]; readonly description?: string;
  readonly value: Json; readonly canonical: string;
};
export type VectorSuite<V> = { readonly suite: string; readonly vectors: readonly V[] };

/** Process work described as data (SPEC §22.4). */
type Work = { readonly id: string; readonly ms: number; readonly result?: Json; readonly fail?: string; readonly progress?: readonly Json[]; readonly children?: readonly Work[] };

const record = (value: Json | undefined) => (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, Json>;

/** The conformance operators of SPEC §10.5 (the effects and drivers write to `logs`). */
export function conformanceOperators(logs: Map<string, Json[]>): Operators {
  const log = (id: string, value: Json) => { const list = logs.get(id) ?? []; list.push(value); logs.set(id, list); };
  return {
    ...standardOperators,
    probe: { kind: "seed", create: (_params, api) => ({ activate: ({ signal }) => {
      log(api.id, "activate");
      signal.addEventListener("abort", () => log(api.id, "release"));
    } }) },
    "fail-when": { kind: "combinator", create: params => context => {
      const error = inputError(context);
      if (error) return error;
      const value = context.inputs[0]?.value;
      return equal(value, record(params).equals) ? new ErrorValue({ message: String(record(params).message ?? "failed") }) : value === undefined ? UNCHANGED : value;
    } },
    record: { kind: "effect", create: (_params, api) => context => log(api.id, context.inputs.map(input => input.error ? { error: input.error.message } : (input.value ?? null) as Json)) },
    observe: { kind: "effect", create: (params, api) => context => {
      const seed = api.node(String(record(params).seed));
      if (seed) api.env.observe(seed, context.inputs[0].value as Json);
    } },
    while: { kind: "effect", create: (params, api) => {
      let token: Aborter | undefined;
      return context => {
        const on = context.inputs[0].value === true;
        const driver = api.node(String(record(params).driver)) as Driver | undefined;
        // The run it starts ends with the erector's run at the latest (an effect has no way to learn it was released).
        if (on && !token && driver) { token = new Aborter(api.run.signal); driver.start(token.signal); }
        if (!on && token) { token.abort("off"); token = undefined; }
      };
    } },
    rewire: { kind: "effect", create: (params, api) => context => {
      const target = api.node(String(record(params).node));
      const options = record(params).inputs as unknown as Record<string, string[]> | string[][];
      const choice = (options as Record<string, string[]>)?.[String(context.inputs[0].value)];
      const inputs = choice?.map(id => api.node(id)).filter((node): node is KNode => !!node);
      if (target && inputs && !(inputs.length === target.inputs.length && inputs.every((node, i) => node === target.inputs[i].node)))
        api.env.setInputs(target, inputs);
    } },
    work: { kind: "driver", create: params => ({ name: "work", start(run) {
      const spawn = (work: Work, parent: Process) => {
        run.spawn(work.id, (signal, report) => new Promise<Json>((resolve, reject) => {
          const steps = work.progress ?? [];
          steps.forEach((progress, i) => run.env.clock.after(Math.floor(work.ms * (i + 1) / (steps.length + 1)), () => { if (!signal.aborted) report(progress); }));
          run.env.clock.after(work.ms, () => work.fail ? reject(new Error(work.fail)) : resolve(work.result ?? null));
          for (const child of work.children ?? []) spawn(child, run.env.node(work.id) as Process);
        }), { parent, id: work.id });
      };
      for (const work of (record(params).processes ?? []) as unknown as Work[]) spawn(work, run.process);
    } }) },
    explode: { kind: "effect", create: params => context => {
      if (equal(context.inputs[0]?.value, record(params).equals)) throw new Error(String(record(params).message ?? "exploded"));
    } },
    connect: { kind: "driver", create: (params, api) => ({ name: "connect", start(run) {
      for (const [source, name] of (record(params).pairs ?? []) as unknown as [string, string][]) {
        const node = api.node(source);
        if (node) run.effect({ name, inputs: [node], run: context => log(name, [(context.inputs[0].value ?? null) as Json]) });
      }
    } }) },
  };
}

const show = (value: unknown) => canonical(value);
const entryValue = (entry: KEntry) => entry.error ? { error: entry.error.message } : entry.value;

/** The running part of a process tree, in the vector's terms. */
function runningTree(node: ProcessTreeNode, workIds: ReadonlySet<string>): TreeExpectation[] {
  return node.children.filter(child => child.status === "running" || child.status === "progress").map(child => {
    const children = runningTree(child, workIds);
    return { ...(child.actor ? { actor: child.actor } : { id: workIds.has(child.id) ? child.id : child.name }), status: "running", ...(children.length ? { children } : {}) };
  });
}
const normaliseTree = (items: readonly TreeExpectation[]): TreeExpectation[] => items.map(item => ({
  ...(item.actor !== undefined ? { actor: item.actor } : { id: item.id }), status: item.status,
  ...(item.children?.length ? { children: normaliseTree(item.children) } : {}),
}));

/** Runs one kernel vector; returns its problems (empty when it passes). */
export async function runKernelVector(vector: KernelVector): Promise<string[]> {
  const problems: string[] = [];
  const scheduler = new Scheduler();
  // Every node that ever appended, by ID, and its whole stream as appended (retention may drop entries).
  const seen = new Map<string, KNode>();
  const appended = new Map<KNode, KEntry[]>();
  const env = new Environment({ clock: simClock(scheduler), onAppend: (node, entry) => {
    seen.set(node.id, node);
    const list = appended.get(node) ?? [];
    list.push(entry);
    appended.set(node, list);
  } });
  const logs = new Map<string, Json[]>();
  const log = (id: string, value: Json) => { const list = logs.get(id) ?? []; list.push(value); logs.set(id, list); };
  const model = env.seed<GraphModel>({ id: "$model", initial: vector.graph });
  const erected = erector(env, model, conformanceOperators(logs));
  const node = (id: string) => erected.live(id) ?? env.node(id) ?? seen.get(id);
  const need = (id: string, what: string): KNode | undefined => {
    const found = node(id);
    if (!found) problems.push(`${vector.name}: the script ${what} ${id}, which the graph doesn't have`);
    return found;
  };
  const tokens = new Map<string, Aborter>();
  erected.driver.start(new Aborter().signal);
  await settle();
  for (const step of vector.script) {
    if ("observe" in step) {
      // An object observes each seed once; a list of pairs may observe one seed several times, in order.
      const pairs = (Array.isArray(step.observe) ? step.observe as [string, Json][] : Object.entries(step.observe)).map(([id, value]) => [need(id, "observes"), value] as const);
      env.transaction(() => { for (const [seed, value] of pairs) if (seed) env.observe(seed, value); });
    } else if ("start" in step) {
      const driver = need(step.start, "starts");
      if (driver) { const aborter = new Aborter(); tokens.set(step.as, aborter); (driver as Driver).start(aborter.signal); }
    } else if ("abort" in step) {
      const token = tokens.get(step.abort);
      if (!token) problems.push(`${vector.name}: the script aborts ${step.abort}, which no step named`);
      token?.abort(step.reason ?? "aborted");
    } else if ("advance" in step) {
      const until = scheduler.now + step.advance;
      for (;;) {
        const next = scheduler.pending()[0];
        if (!next || next.due > until) break;
        scheduler.deliver(0);
        await settle();
      }
      scheduler.now = until;
    } else if ("model" in step) env.observe(model, step.model);
    else if ("demand" in step) {
      const target = need(step.demand, "demands"), aborter = new Aborter();
      if (step.as) tokens.set(step.as, aborter);
      const spec = typeof step.spec === "string" ? need(step.spec, "demands with the spec node") as KNode<DemandSpec> | undefined : step.spec;
      if (target && spec) target.demand(spec, aborter.signal, "vector");
    } else if ("read" in step) {
      const target = need(step.read, "reads");
      if (target) { const entry = env.read(target); log(step.log, entry ? entryValue(entry) as Json : null); }
    } else if ("token" in step) {
      const parents = (step.parents ?? []).map(name => tokens.get(name)?.signal);
      if (parents.some(parent => !parent)) problems.push(`${vector.name}: token ${step.token} names a parent no step made`);
      tokens.set(step.token, new Aborter(...parents));
    } else if ("listen" in step) {
      const token = tokens.get(step.listen);
      if (!token) problems.push(`${vector.name}: the script listens to ${step.listen}, which no step named`);
      else if (!token.signal.aborted) token.signal.addEventListener("abort", () => log(step.log, { value: step.value ?? null, reason: token.signal.reason as Json }));
    } else problems.push(`${vector.name}: the script has a step this runner doesn't know: ${canonical(step)}`);
    await settle();
  }
  const expect = vector.expect;
  const streamOf = (id: string) => { const found = node(id); return found ? (appended.get(found) ?? []).map(entryValue) : undefined; };
  for (const [id, expected] of Object.entries(expect.streams ?? {})) {
    const actual = streamOf(id);
    if (!equal(actual, expected)) problems.push(`${vector.name}: stream ${id} is ${show(actual)}, expected ${show(expected)}`);
  }
  for (const [id, expected] of Object.entries(expect.computes ?? {})) {
    const actual = node(id)?.computes;
    if (actual !== expected) problems.push(`${vector.name}: ${id} computed ${actual} times, expected ${expected}`);
  }
  for (const [id, expected] of Object.entries(expect.logs ?? {})) {
    const actual = logs.get(id) ?? [];
    if (!equal(actual, expected)) problems.push(`${vector.name}: log ${id} is ${show(actual)}, expected ${show(expected)}`);
  }
  for (const [id, expected] of Object.entries(expect.processes ?? {})) {
    const actual = streamOf(id);
    if (!equal(actual, expected)) problems.push(`${vector.name}: process ${id} is ${show(actual)}, expected ${show(expected)}`);
  }
  for (const [id, expected] of Object.entries(expect.active ?? {})) {
    const actual = !!node(id)?.active;
    if (actual !== expected) problems.push(`${vector.name}: ${id} is ${actual ? "active" : "dormant"}, expected ${expected ? "active" : "dormant"}`);
  }
  for (const [id, expected] of Object.entries(expect.retains ?? {})) {
    const kept = new Set(node(id)?.entries.map(entry => entry.seq) ?? []);
    const lost = expected.filter(seq => !kept.has(seq));
    if (lost.length) problems.push(`${vector.name}: ${id} no longer retains entries ${show(lost)} (it keeps ${show([...kept])})`);
  }
  if (expect.errorCodes) {
    const actual = (appended.get(env.errors) ?? []).map(entry => (entry.value as { code?: string }).code ?? null);
    if (!equal(actual, expect.errorCodes)) problems.push(`${vector.name}: error codes ${show(actual)}, expected ${show(expect.errorCodes)}`);
  }
  if (expect.tree) {
    const workIds = new Set([...seen.values()].filter(item => item.kind === "process").map(item => item.id));
    // The erector's own run is the harness's, not the vector's.
    const actual = runningTree(env.processTree(), workIds).filter(item => item.actor !== erected.driver.id);
    if (!equal(actual, normaliseTree(expect.tree))) problems.push(`${vector.name}: running tree is ${show(actual)}, expected ${show(normaliseTree(expect.tree))}`);
  }
  return problems;
}

/** Runs one canonical-form vector (SPEC §2.2). */
export function runCanonicalVector(vector: CanonicalVector): string[] {
  let actual: string;
  try { actual = canonical(vector.value); } catch (error) { actual = `(refused: ${error instanceof Error ? error.message : String(error)})`; }
  return actual === vector.canonical ? [] : [`${vector.name}: canonical form is ${actual}, expected ${vector.canonical}`];
}
