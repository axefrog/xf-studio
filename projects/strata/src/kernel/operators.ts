/**
 * Stream operations as combinators (SPEC §5.3), for code, and the standard operator registry for models (§10.4).
 * Standard operators propagate an input's error (errors are values, §7.2).
 */
import type { Json } from "../json";
import { KNode, UNCHANGED, ErrorValue } from "./kernel";
import type { Compute, ComputeContext, DemandSpec, DriverDefinition, Environment, Input, Run, RunContext } from "./kernel";

/** The first input error, as an error value, if any input's latest entry is an error. */
export function inputError(context: ComputeContext): ErrorValue | undefined {
  for (const input of context.inputs) if (input.error) return new ErrorValue(input.error);
  return undefined;
}

/** `map`: a function of one input's latest value. */
export function map<A, B>(env: Environment, input: KNode<A>, fn: (value: A) => B, name = "map"): KNode<B> {
  return env.combinator<B>({ name, inputs: [input], compute: context => {
    const error = inputError(context);
    if (error) return error;
    const view = context.inputs[0];
    return view.latest ? fn(view.value as A) : UNCHANGED;
  } });
}

/** `filter`: passes the input's latest value when the predicate holds; otherwise unchanged. */
export function filter<A>(env: Environment, input: KNode<A>, predicate: (value: A) => boolean, name = "filter"): KNode<A> {
  return env.combinator<A>({ name, inputs: [input], compute: context => {
    const error = inputError(context);
    if (error) return error;
    const view = context.inputs[0];
    return view.latest && predicate(view.value as A) ? view.value as A : UNCHANGED;
  } });
}

/** `scan`: folds each entry the input appended in this cycle into the accumulated value (a delta consumer, SPEC §3.1). */
export function scan<A, S>(env: Environment, input: KNode<A>, initial: S, step: (state: S, value: A) => S, name = "scan"): KNode<S> {
  return env.combinator<S>({ name, inputs: [input], compute: context => {
    const error = inputError(context);
    if (error) return error;
    let state = (context.previous?.value as S | undefined) ?? initial;
    const view = context.inputs[0];
    const entries = view.changed ? view.fresh : context.previous ? [] : view.latest ? [view.latest] : [];
    for (const entry of entries) if (!entry.error) state = step(state, entry.value as A);
    return state;
  } });
}

/** `combine`: the latest values of several inputs. */
export function combine(env: Environment, inputs: readonly KNode[], name = "combine"): KNode<unknown[]> {
  return env.combinator<unknown[]>({ name, inputs, compute: context => inputError(context) ?? context.inputs.map(input => input.value ?? null) });
}

/**
 * `flatMap`: the inner node is chosen from the outer value; when the choice changes, the combinator is rewired (a
 * queued change, SPEC §6.8), and primed from the new inner node.
 */
export function flatMap<A, B>(env: Environment, outer: KNode<A>, choose: (value: A) => KNode<B>, name = "flatMap"): KNode<B> {
  let inner: KNode<B> | undefined;
  const node: KNode<B> = env.combinator<B>({ name, inputs: [outer], compute: context => {
    const error = inputError(context);
    if (error) return error;
    const view = context.inputs[0];
    if (!view.latest) return UNCHANGED;
    const next = choose(view.value as A);
    if (next !== inner) { inner = next; env.setInputs(node, [outer, next]); return UNCHANGED; }
    const innerView = context.inputs[1];
    return innerView?.latest ? innerView.error ? new ErrorValue(innerView.error) : innerView.value as B : UNCHANGED;
  } });
  return node;
}

// -------------------------------------------------------------------------------------------------------------------
// Operator registry (SPEC §10.4)
// -------------------------------------------------------------------------------------------------------------------

/** What an operator can reach while it is created: the environment, the erected nodes by model ID, and the run. */
export type OperatorApi = {
  /** The model ID of the node being created. */
  readonly id: string;
  readonly env: Environment;
  node(modelId: string): KNode | undefined;
  readonly run: RunContext;
};
export type Operator =
  | { readonly kind: "seed"; create(params: Json | undefined, api: OperatorApi): { readonly activate?: KNode["activation"] } }
  | { readonly kind: "combinator"; create(params: Json | undefined, api: OperatorApi): Compute<unknown> }
  | { readonly kind: "effect"; create(params: Json | undefined, api: OperatorApi): Run }
  | { readonly kind: "driver"; create(params: Json | undefined, api: OperatorApi): DriverDefinition };
export type Operators = Readonly<Record<string, Operator>>;

const numberOf = (value: unknown) => typeof value === "number" ? value : 0;
const record = (params: Json | undefined) => (params && typeof params === "object" && !Array.isArray(params) ? params : {}) as Record<string, Json>;
const guard = (compute: Compute<unknown>): Compute<unknown> => context => inputError(context) ?? compute(context);
/** A member of a plain-data object, only if it is the object's own. */
const own = (object: unknown, key: string): unknown =>
  object && typeof object === "object" && Object.hasOwn(object, key) ? (object as Record<string, unknown>)[key] : undefined;

/**
 * A catalogue of operators: the one registry models are erected from. Built-ins are registered through it exactly as a
 * script's own operators are; there is no privileged back door (SPEC §10.4).
 */
export function catalogue(...parts: readonly Operators[]): Operators {
  const out: Record<string, Operator> = {};
  for (const part of parts) for (const [name, operator] of Object.entries(part)) {
    if (!/^[a-z][\w:.-]*$/i.test(name)) throw new Error(`Operator name ${JSON.stringify(name)} is not a plain identifier.`);
    out[name] = operator;
  }
  return Object.freeze(out);
}

/**
 * A state machine declared as data (SPEC §10.6): `params` names the inputs in order, the initial state, and per state
 * the transitions by event (an input's name): `{ target, guard?, effects? }`. An event fires when its input appends in a
 * cycle; a guard is another input whose latest value must be `true`. The output is `{ state, from?, event?, effects? }`.
 */
function stateMachine(params: Json | undefined): Compute<unknown> {
  type Transition = { target: string; guard?: string; effects?: string[] };
  const spec = record(params) as unknown as { initial: string; inputs?: string[]; states: Record<string, { on?: Record<string, Transition> }> };
  const names = spec.inputs ?? [];
  return context => {
    const previous = context.previous?.value as { state: string } | undefined;
    if (!previous) return { state: spec.initial };
    let state = previous.state, fired: { from: string; event: string; effects?: string[] } | undefined;
    context.inputs.forEach((input, index) => {
      if (!input.changed) return;
      const event = names[index];
      // Only a machine's own states and events count (never inherited object members such as "toString").
      const states = own(spec.states, state) as { on?: Record<string, Transition> } | undefined;
      const transition = event ? own(states?.on, event) as Transition | undefined : undefined;
      if (!transition || typeof transition.target !== "string") return;
      if (transition.guard !== undefined && context.inputs[names.indexOf(transition.guard)]?.value !== true) return;
      fired = { from: state, event, ...(transition.effects ? { effects: transition.effects } : {}) };
      state = transition.target;
    });
    return fired ? { state, ...fired } : UNCHANGED;
  };
}

/** The standard operators: registered through the catalogue like any other. */
export const standardOperators: Operators = {
  seed: { kind: "seed", create: () => ({}) },
  "state-machine": { kind: "combinator", create: params => stateMachine(params) },
  identity: { kind: "combinator", create: () => guard(context => context.inputs[0]?.latest ? context.inputs[0].value : UNCHANGED) },
  sum: { kind: "combinator", create: params => guard(context =>
    context.inputs.reduce((total, input) => total + numberOf(input.value), numberOf(record(params).add))) },
  // An absent input (or one that isn't a number) counts as the operation's identity: 0 for sum, 1 for product (SPEC §10.5).
  product: { kind: "combinator", create: () => guard(context => context.inputs.reduce((total, input) => total * (typeof input.value === "number" ? input.value : 1), 1)) },
  pick: { kind: "combinator", create: params => guard(context => {
    let value: unknown = context.inputs[0]?.value;
    for (const key of (record(params).path ?? []) as string[]) value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
    return value === undefined ? UNCHANGED : value;
  }) },
  "scan-sum": { kind: "combinator", create: () => guard(context => {
    let total = numberOf(context.previous?.value);
    const view = context.inputs[0];
    const entries = view.changed ? view.fresh : context.previous ? [] : view.latest ? [view.latest] : [];
    for (const entry of entries) total += numberOf(entry.value);
    return total;
  }) },
  collect: { kind: "combinator", create: () => guard(context => context.inputs[0].window.map(entry => entry.value ?? null)) },
  combine: { kind: "combinator", create: () => guard(context => context.inputs.map(input => input.value ?? null)) },
  threshold: { kind: "combinator", create: params => guard(context => numberOf(context.inputs[0]?.value) >= numberOf(record(params).at)) },
};

export type { DemandSpec, Input };
