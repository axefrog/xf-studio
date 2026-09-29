/**
 * The erector's edges and more kernel lifetimes: prefixes and names, inputs naming live nodes outside the model,
 * operators that fail to make their node, IDs already taken, models that are absent, null or errors, demand changing
 * between a spec and a spec node, a model change racing the erector's end, host demand through a spec node, runs that
 * end while starting, and work that resolves with nothing.
 */
import { expect, test } from "bun:test";
import { Aborter, createEnvironment, erector, ErrorValue, standardOperators } from "strata";
import type { ComputeContext, DemandSpec, Environment, GraphModel, Json, KEntry, KNode, Operators, Process } from "strata";
import { Scheduler, settle, simClock } from "strata/testing";
import { modelProblem } from "../src/kernel/erector";

const world = (options: { retainAll?: boolean } = {}) => {
  const scheduler = new Scheduler();
  const appended = new Map<string, KEntry[]>();
  const env = createEnvironment({ clock: simClock(scheduler), ...options, onAppend: (node, entry) => {
    const list = appended.get(node.id) ?? []; list.push(entry); appended.set(node.id, list);
  } });
  const stream = (node: KNode) => (appended.get(node.id) ?? []).map(entry => entry.error ? { error: entry.error.message } : entry.value);
  const codes = () => (appended.get("$errors") ?? []).map(entry => (entry.value as { code?: string }).code ?? null);
  return { scheduler, env, stream, codes, appended };
};
const watch = (node: KNode, spec: DemandSpec | KNode<DemandSpec> = { latest: true }) => { const token = new Aborter(); node.demand(spec, token.signal); return token; };
const erect = (env: Environment, model: KNode<GraphModel>, operators: Operators = standardOperators, options: { prefix?: string; name?: string } = {}) => {
  const built = erector(env, model, operators, options);
  const token = new Aborter();
  built.driver.start(token.signal);
  return { ...built, token };
};

test("an erector takes a prefix for its node IDs and a name; inputs may name live nodes outside the model; a node without inputs is erected unwired", () => {
  const { env, codes } = world();
  const outside = env.seed<number>({ id: "outside", initial: 5 });
  const model = env.seed<GraphModel>({ initial: { nodes: [
    { id: "s", kind: "seed" },
    { id: "copy", kind: "combinator", op: "identity", inputs: [{ $node: "outside" }] },
    { id: "lonely", kind: "combinator", op: "identity" },
    { id: "noop", kind: "combinator" },
  ] } });
  const built = erect(env, model, standardOperators, { prefix: "sub/", name: "sub" });
  expect(built.nodes.name).toBe("sub nodes");
  expect(env.node("sub/s")).toBe(built.live("s"));
  expect(built.live("copy")!.inputs.map(input => input.node)).toEqual([outside]);
  expect(built.live("lonely")!.inputs).toEqual([]);
  expect(built.live("noop")).toBeUndefined();
  expect(codes()).toEqual(["operator"]);
  expect(env.read(built.live("copy")!)?.value).toBe(5);
  expect(built.live("s")!.latest()).toBeUndefined();
  built.token.abort();
});

test("an operator that fails to make its node is reported with its message, whatever it throws", () => {
  const { env, appended } = world();
  const operators: Operators = { ...standardOperators,
    broken: { kind: "combinator", create: () => { throw new Error("bad params"); } },
    odd: { kind: "combinator", create: () => { throw "just text"; } } };
  const model = env.seed<GraphModel>({ initial: { nodes: [{ id: "a", kind: "combinator", op: "broken" }, { id: "b", kind: "combinator", op: "odd" }] } });
  erect(env, model, operators).token.abort();
  const messages = (appended.get("$errors") ?? []).map(entry => (entry.value as { message: string }).message);
  expect(messages.some(message => message.includes("bad params"))).toBe(true);
  expect(messages.some(message => message.includes("just text"))).toBe(true);
});

test("an ID another node already holds is refused; a model with no entry erects nothing; null or an error as the model keeps what was erected", () => {
  const { env, codes } = world();
  env.seed({ id: "taken" });
  const source = env.seed<GraphModel | null>();
  const model = env.combinator<GraphModel>({ inputs: [source], compute: context => {
    const value = context.inputs[0].value;
    return value === undefined ? { nodes: [] } : value === "fail" as never ? new ErrorValue({ message: "no model" }) : value as GraphModel;
  } });
  const built = erect(env, model);
  expect(built.nodes.value()).toEqual({});
  env.observe(source, { nodes: [{ id: "taken", kind: "seed" }] });
  expect(codes()).toEqual(["model"]);
  env.observe(source, { nodes: [{ id: "a", kind: "seed", initial: 1 }] });
  const a = built.live("a");
  expect(a).toBeDefined();
  env.observe(source, null);
  expect(built.live("a")).toBe(a);
  env.observe(source, "fail" as never);
  expect(built.live("a")).toBe(a);
  expect(codes()).toEqual(["model", "model", "model"]);
  expect(modelProblem({ nodes: [{ id: "x", kind: "seed" }] })).toBeNull();
  expect(modelProblem({ nodes: [{ id: "x", kind: "seed" }] }, id => id === "x")).toContain("already taken");
  built.token.abort();
});

test("an erector rewires a node whose demand changes between a spec and a spec node, and leaves one whose inputs and demand are the same", () => {
  const { env } = world();
  const nodes = (w: Record<string, Json>, extra: Record<string, Json>[] = []) => ({ nodes: [
    { id: "s", kind: "seed", initial: 1 }, { id: "spec", kind: "seed", initial: { rolling: { entries: 2 } } },
    { id: "w", kind: "combinator", op: "collect", inputs: ["s"], ...w }, ...extra] }) as GraphModel;
  const model = env.seed<GraphModel>({ initial: nodes({ demand: { rolling: { entries: 1 } } }) });
  const built = erect(env, model);
  const w = built.live("w")!;
  const inputs = w.inputs;
  env.observe(model, nodes({ demand: { rolling: { entries: 1 } } }, [{ id: "x", kind: "seed" }]));
  expect(w.inputs).toBe(inputs);
  env.observe(model, nodes({ demand: "spec" }));
  expect(w.inputs[0].demand).toBe(built.live("spec") as never);
  const again = w.inputs;
  env.observe(model, nodes({ demand: "spec" }, [{ id: "y", kind: "seed" }]));
  expect(w.inputs).toBe(again);
  env.observe(model, nodes({ demand: { latest: true } }));
  expect(w.inputs[0].demand).toEqual({ latest: true });
  built.token.abort();
  expect(env.node("w")).toBeUndefined();
});

test("a model change and the erector's end in one cycle: the end wins and nothing is erected after it", () => {
  const { env } = world();
  const model = env.seed<GraphModel>({ initial: { nodes: [{ id: "a", kind: "seed" }, { id: "e", kind: "effect", op: "noop", inputs: ["a"] }] } });
  const built = erect(env, model, { ...standardOperators, noop: { kind: "effect", create: () => () => undefined } });
  const trigger = env.seed<number>({ initial: 0 });
  const stopper = env.effect({ inputs: [trigger], run: context => { if (context.inputs[0].value === 1) built.token.abort(); } });
  const life = new Aborter();
  env.connect(stopper, life.signal);
  // The model and the trigger change together: the erector's end and the new model meet in one cycle.
  env.transaction(() => { env.observe(model, { nodes: [{ id: "b", kind: "seed" }] }); env.observe(trigger, 1); });
  expect(built.live("b")).toBeUndefined();
  expect(env.node("a")).toBeUndefined();
  expect(env.node("e")).toBeUndefined();
  life.abort();
});

test("a node forgotten by its token also ends the host demand on it", () => {
  const { env } = world();
  const seed = env.seed<number>({ initial: 1 });
  const token = new Aborter();
  const node = env.combinator({ inputs: [seed], compute: context => context.inputs[0].value, signal: token.signal });
  watch(node);
  expect(seed.active).toBe(true);
  token.abort();
  expect(node.active).toBe(false);
  expect(seed.active).toBe(false);
  expect(env.node(node.id)).toBeUndefined();
});

test("host demand through a spec node follows it; a spec change for a demand ended in the same cycle is dropped", () => {
  const { env } = world();
  const source = env.seed<number>({ initial: 1 });
  const spec = env.seed<DemandSpec>({ initial: { rolling: { entries: 1 } } });
  const token = watch(source, spec);
  for (let i = 2; i <= 4; i++) env.observe(source, i);
  env.observe(spec, { rolling: { entries: 3 } });
  for (let i = 5; i <= 7; i++) env.observe(source, i);
  expect(source.entries.map(entry => entry.seq)).toEqual([5, 6, 7]);
  const trigger = env.seed<number>({ initial: 0 });
  const ender = env.effect({ inputs: [trigger], run: context => { if (context.inputs[0].value === 1) token.abort(); } });
  const life = new Aborter();
  env.connect(ender, life.signal);
  // One transaction: the demand ends (its release is asked for first) and the spec changes; the spec change finds no edge.
  env.transaction(() => { env.observe(trigger, 1); env.observe(spec, { rolling: { entries: 5 } }); });
  expect(source.active).toBe(false);
  expect(spec.active).toBe(false);
  life.abort();
});

test("a run that ends while starting never connects its effects; a child driver may be started under another parent", () => {
  const { env } = world();
  const seed = env.seed<number>({ initial: 1 });
  const token = new Aborter();
  let runs = 0;
  const driver = env.driver({ name: "self-ending", start(run) { token.abort("changed my mind"); run.effect({ inputs: [seed], run: () => { runs++; } }); } });
  const process = driver.start(token.signal);
  expect(runs).toBe(0);
  expect(process.status()).toBe("aborted");
  let child: Process | undefined;
  const holder = env.spawn("holder", () => new Promise<Json>(() => undefined));
  const inner = env.driver({ name: "inner", start: () => undefined });
  const outer = env.driver({ name: "outer", start(run) { child = run.start(inner, { parent: holder }); } });
  const life = new Aborter();
  outer.start(life.signal);
  expect(child!.parent).toBe(holder);
  holder.abort("done");
  expect(child!.status()).toBe("aborted");
  life.abort();
});

test("an environment keeping everything keeps a finished child in its parent's children, and the parent's end leaves it alone", async () => {
  const { env, scheduler, stream } = world({ retainAll: true });
  const parent = env.spawn("p", signal => new Promise<Json>(resolve => env.clock.after(20, () => resolve("p"), signal)));
  const child = env.spawn("c", async () => "c", parent);
  await settle();
  scheduler.advance(30);
  await settle();
  expect(stream(child)).toEqual([{ status: "running" }, { status: "done", result: "c" }]);
  expect(parent.children).toContain(child);
  expect(stream(parent).at(-1)).toEqual({ status: "done", result: "p" });
});

test("work that resolves with nothing is done with null; the product counts a value that isn't a number as 1", async () => {
  const { env } = world();
  const process = env.spawn("nothing", async () => undefined as unknown as Json);
  await settle();
  expect(process.value()).toEqual({ status: "done", result: null });
  const api = { id: "p", env, node: () => undefined, run: undefined as never };
  const product = (standardOperators.product as { create(params: undefined, api: never): (context: ComputeContext) => unknown }).create(undefined, api as never);
  const input = (value: Json) => ({ node: undefined as never, latest: { seq: 1, cycle: 1, at: 0, value }, value, changed: true, fresh: [], window: [] });
  expect(product({ inputs: [input(3), input("x"), input(2)], cycle: 1, at: 0, env })).toBe(6);
});

test("a model node is replaced when its kind, operator, parameters or a seed's first entry change, and kept otherwise", () => {
  const { env } = world();
  const nodes = (extra: { seedInitial?: number; combinatorInitial?: number; add?: number; op?: string }) => ({ nodes: [
    { id: "s", kind: "seed", initial: extra.seedInitial ?? 1 },
    { id: "c", kind: "combinator", op: extra.op ?? "sum", inputs: ["s"], params: { add: extra.add ?? 1 }, ...(extra.combinatorInitial !== undefined ? { initial: extra.combinatorInitial } : {}) },
  ] }) as unknown as GraphModel;
  const model = env.seed<GraphModel>({ initial: nodes({}) });
  const built = erect(env, model);
  const [s, c] = [built.live("s"), built.live("c")];
  // A first entry on a combinator means nothing: it is kept.
  env.observe(model, nodes({ combinatorInitial: 5 }));
  expect([built.live("s"), built.live("c")]).toEqual([s, c]);
  env.observe(model, nodes({ add: 2 }));
  expect(built.live("c")).not.toBe(c);
  const c2 = built.live("c");
  env.observe(model, nodes({ add: 2, op: "product" }));
  expect(built.live("c")).not.toBe(c2);
  env.observe(model, nodes({ add: 2, op: "product", seedInitial: 9 }));
  expect(built.live("s")).not.toBe(s);
  expect(built.nodes.value()).toEqual({ s: { $node: built.live("s")!.id }, c: { $node: built.live("c")!.id } });
  built.token.abort();
});

test("a model seed with no entry erects nothing until its first model arrives", () => {
  const { env } = world();
  const model = env.seed<GraphModel>();
  const built = erect(env, model);
  expect(built.nodes.value()).toEqual({});
  env.observe(model, { nodes: [{ id: "a", kind: "seed", initial: 1 }] });
  expect(built.live("a")?.value()).toBe(1);
  built.token.abort();
});

