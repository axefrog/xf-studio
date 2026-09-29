/**
 * The conformance runner (SPEC §22): runs the JSON vectors in `conformance/` against this implementation. The engine's
 * own suite runs every vector; a native implementation runs the same files with its own runner.
 */
import { canonical, equal } from "../json";
import type { Json } from "../json";
import { Aborter } from "../kernel/abort";
import { Environment, ErrorValue, KNode, UNCHANGED } from "../kernel/kernel";
import type { DemandSpec, Driver, KEntry, Process } from "../kernel/kernel";
import { erector } from "../kernel/erector";
import type { GraphModel } from "../kernel/erector";
import { inputError, standardOperators } from "../kernel/operators";
import type { Operators } from "../kernel/operators";
import { Scheduler, settle, simClock } from "./sim-sources";

export type KernelStep =
  | { readonly observe: Readonly<Record<string, Json>> }
  | { readonly start: string; readonly as: string }
  | { readonly abort: string; readonly reason?: Json }
  | { readonly advance: number }
  | { readonly model: GraphModel }
  | { readonly demand: string; readonly spec: DemandSpec | string; readonly as?: string };
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
  };
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
        if (on && !token && driver) { token = new Aborter(); driver.start(token.signal); }
        if (!on && token) { token.abort("off"); token = undefined; }
      };
    } },
    rewire: { kind: "effect", create: (params, api) => context => {
      const target = api.node(String(record(params).node));
      const options = record(params).inputs as unknown as string[][];
      const choice = options?.[Number(context.inputs[0].value)];
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

/** Runs one kernel vector; returns its problems (empty when it passes). */
export async function runKernelVector(vector: KernelVector): Promise<string[]> {
  const scheduler = new Scheduler();
  const env = new Environment({ clock: simClock(scheduler), retainAll: true });
  const logs = new Map<string, Json[]>();
  const model = env.seed<GraphModel>({ id: "$model", initial: vector.graph });
  const erected = erector(env, model, conformanceOperators(logs));
  const node = (id: string) => erected.live(id) ?? env.node(id);
  const tokens = new Map<string, Aborter>();
  erected.driver.start(new Aborter().signal);
  await settle();
  for (const step of vector.script) {
    if ("observe" in step) env.transaction(() => { for (const [id, value] of Object.entries(step.observe)) { const seed = node(id); if (seed) env.observe(seed, value); } });
    else if ("start" in step) { const aborter = new Aborter(); tokens.set(step.as, aborter); (node(step.start) as Driver).start(aborter.signal); }
    else if ("abort" in step) tokens.get(step.abort)?.abort(step.reason ?? "aborted");
    else if ("advance" in step) {
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
      const target = node(step.demand), aborter = new Aborter();
      if (step.as) tokens.set(step.as, aborter);
      const spec = typeof step.spec === "string" ? node(step.spec) as KNode<DemandSpec> : step.spec;
      if (target && spec) target.demand(spec, aborter.signal, "vector");
    }
    await settle();
  }
  const problems: string[] = [];
  const expect = vector.expect;
  for (const [id, expected] of Object.entries(expect.streams ?? {})) {
    const actual = node(id)?.entries.map(entryValue);
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
    const actual = node(id)?.entries.map(entryValue);
    if (!equal(actual, expected)) problems.push(`${vector.name}: process ${id} is ${show(actual)}, expected ${show(expected)}`);
  }
  for (const [id, expected] of Object.entries(expect.active ?? {})) {
    const actual = !!node(id)?.active;
    if (actual !== expected) problems.push(`${vector.name}: ${id} is ${actual ? "active" : "dormant"}, expected ${expected ? "active" : "dormant"}`);
  }
  if (expect.errorCodes) {
    const actual = env.errors.entries.map(entry => (entry.value as { code?: string }).code ?? null);
    if (!equal(actual, expect.errorCodes)) problems.push(`${vector.name}: error codes ${show(actual)}, expected ${show(expect.errorCodes)}`);
  }
  return problems;
}
