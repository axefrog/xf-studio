/**
 * The kernel against its brute-force reference model (`tests/model/kernel-reference.ts`), on random graphs and random
 * interleavings of observations (one seed or several in a transaction), host demand with windows, ending demand,
 * connecting and disconnecting effects, rewiring (by the host, and by an effect in the middle of a cycle), one-shot
 * reads, resizing a window demanded through a spec node, driver runs that connect effects, trees of processes that
 * finish, fail or are aborted, and time. After every step the kernel and the model agree on which nodes are active,
 * every stream, how often each node computed, every effect's log, seed activations, the error codes, the process
 * states and the running tree, and the kernel retains every entry its demand requires. At the end everything is torn
 * down, and the environment returns to the nodes it started with: no demand, effect, process, follower or listener
 * is left behind.
 */
import { expect, test } from "bun:test";
import { Aborter, createEnvironment, equal, ErrorValue, UNCHANGED } from "strata";
import type { Driver, Input, Json, KEntry, KNode, Process } from "strata";
import { prng, Scheduler, settle, simClock } from "strata/testing";
import { covered, KernelModel, operate } from "./model/kernel-reference";
import type { EffectBehaviour, OpInput, Spec } from "./model/kernel-reference";

const RUNS = Number(process.env.STRATA_MODEL_RUNS ?? 300), STEPS = 150;

type World = {
  scheduler: Scheduler; env: ReturnType<typeof createEnvironment>; model: KernelModel;
  nodes: Map<string, KNode>; streams: Map<string, KEntry[]>; logs: Map<string, Json[]>; probeLogs: Map<string, string[]>;
  tokens: Map<string, Aborter>; demandSpecs: Map<string, Spec>;
  /** The kernel's cycle number when each host demand began. */
  since: Map<string, number>;
  processes: Map<string, Process>; runs: Map<string, { process: Process; effect: string; token: Aborter }>;
  seeds: string[]; combinators: string[]; recorders: string[]; baseline: Set<string>;
};

const signalListeners = (signal: unknown) => (signal as { listeners: unknown[] }).listeners.length;
const entryOut = (entry: KEntry) => entry.error ? { error: entry.error.message } : { value: entry.value as Json };

function build(seed: string): World {
  const next = prng(seed);
  const int = (n: number) => Math.floor(next() * n);
  const scheduler = new Scheduler();
  const streams = new Map<string, KEntry[]>();
  const env = createEnvironment({ clock: simClock(scheduler), onAppend: (node, entry) => {
    const list = streams.get(node.id) ?? [];
    list.push(entry);
    streams.set(node.id, list);
  } });
  const model = new KernelModel();
  const nodes = new Map<string, KNode>(), logs = new Map<string, Json[]>(), probeLogs = new Map<string, string[]>();
  const log = (map: Map<string, Json[]>, name: string, value: Json) => { const list = map.get(name) ?? []; list.push(value); map.set(name, list); };
  const world: World = { scheduler, env, model, nodes, streams, logs, probeLogs, tokens: new Map(), demandSpecs: new Map(), since: new Map(), processes: new Map(),
    runs: new Map(), seeds: [], combinators: [], recorders: [], baseline: new Set() };

  // Seeds: a few plain ones (one probed, one without a first entry), the window's source and its spec node, the
  // selector of the rewiring effect, and the seed the echo effect observes.
  const seedCount = 2 + int(3);
  for (let i = 0; i < seedCount; i++) {
    const id = `s${i}`, probe = true, initial = i === 1 && int(2) ? undefined : int(5);
    model.seed(id, initial, probe);
    nodes.set(id, env.seed<Json>({ id, ...(initial !== undefined ? { initial } : {}), ...(probe ? { activate: ({ signal }) => {
      const list = probeLogs.get(id) ?? []; list.push("activate"); probeLogs.set(id, list);
      signal.addEventListener("abort", () => { const again = probeLogs.get(id)!; again.push("release"); });
    } } : {}) }));
    world.seeds.push(id);
  }
  for (const [id, initial] of [["p", 0], ["spec", { rolling: { entries: 1 + int(3) } }], ["sel", 0], ["echoed", undefined]] as [string, Json | undefined][]) {
    model.seed(id, initial);
    nodes.set(id, env.seed<Json>({ id, ...(initial !== undefined ? { initial } : {}) }));
  }
  // Combinators: a random DAG over the seeds (diamonds by construction), and a window over `p` demanded through `spec`.
  const pool = [...world.seeds];
  const ops = ["sum", "product", "max", "threshold", "identity", "fail-when", "combine"];
  const combinator = (id: string, op: string, inputs: string[], params: Record<string, Json>, specNode?: string) => {
    model.combinator(id, op, inputs, params, specNode);
    const compute = (context: Parameters<Parameters<typeof env.combinator>[0]["compute"]>[0]) => {
      const views: OpInput[] = context.inputs.map(input => !input.latest ? { has: false } : input.error ? { has: true, error: input.error.message } : { has: true, value: input.value as Json });
      const result = operate(op, params, views, context.inputs[0]?.window.map(entry => entry.error ? null : entry.value as Json) ?? []);
      return result === "unchanged" ? UNCHANGED : "error" in result ? new ErrorValue({ message: result.error }) : result.value;
    };
    const wired: Input[] = inputs.map(input => specNode ? { node: nodes.get(input)!, demand: nodes.get(specNode) as never } : nodes.get(input)!);
    nodes.set(id, env.combinator<Json>({ id, inputs: wired, compute: compute as never }));
  };
  const count = 3 + int(6);
  for (let i = 0; i < count; i++) {
    const op = ops[int(ops.length)];
    const arity = op === "identity" || op === "threshold" || op === "fail-when" ? 1 : 1 + int(3);
    const inputs = Array.from({ length: arity }, () => pool[int(pool.length)]);
    const params: Record<string, Json> = op === "sum" ? { add: int(3) } : op === "threshold" ? { at: int(6) } : op === "fail-when" ? { equals: int(4), message: `no ${i}` } : {};
    combinator(`c${i}`, op, inputs, params);
    pool.push(`c${i}`);
    world.combinators.push(`c${i}`);
  }
  combinator("win", "collect", ["p"], {}, "spec");
  world.combinators.push("win");
  // Effects: recorders the host connects and disconnects; a rewiring effect, an echo and an exploding effect,
  // connected for the whole run.
  const effect = (id: string, inputs: string[], behaviour: EffectBehaviour) => {
    model.effect(id, inputs, behaviour);
    nodes.set(id, env.effect({ id, inputs: inputs.map(input => nodes.get(input)!), run: context => {
      const values = context.inputs.map(input => !input.latest ? null : input.error ? { error: input.error.message } : (input.value ?? null) as Json);
      switch (behaviour.kind) {
        case "record": log(logs, behaviour.log, values); return;
        case "echo": env.observe(nodes.get(behaviour.seed)!, values[0] && typeof values[0] === "object" && "error" in (values[0] as object) ? null : values[0]); return;
        case "explode": if (equal(values[0], behaviour.equals)) throw new Error("exploded"); return;
        case "rewire": {
          const choice = behaviour.options[Number(values[0])];
          const target = nodes.get(behaviour.target)!;
          if (choice && !equal(choice, target.inputs.map(input => input.node.id))) env.setInputs(target, choice.map(item => nodes.get(item)!));
        }
      }
    } }));
  };
  const later = world.combinators.filter(id => id !== "win");
  for (let i = 0; i < 1 + int(3); i++) { effect(`log${i}`, [pool[int(pool.length)]], { kind: "record", log: `log${i}` }); world.recorders.push(`log${i}`); }
  effect("winlog", ["win"], { kind: "record", log: "winlog" });
  world.recorders.push("winlog");
  const target = later[int(later.length)], early = pool.slice(0, pool.indexOf(target));
  effect("rw", ["sel"], { kind: "rewire", target, options: [[early[int(early.length)]], [early[int(early.length)], early[int(early.length)]]] });
  effect("echo", [later[int(later.length)]], { kind: "echo", seed: "echoed" });
  effect("echolog", ["echoed"], { kind: "record", log: "echolog" });
  effect("explode", [later[int(later.length)]], { kind: "explode", equals: int(6) });
  const life = new Aborter();
  world.tokens.set("life", life);
  for (const id of ["rw", "echo", "echolog", "explode"]) { env.connect(nodes.get(id)!, life.signal); model.connect("life", id); }
  // The window's source keeps its last four entries whatever else demands it, so every window is determined.
  world.since.set("life", env.cycle);
  nodes.get("p")!.demand({ rolling: { entries: 4 } }, life.signal, "keep");
  model.demand("life", "p", { rolling: { entries: 4 } });
  world.demandSpecs.set("life", { rolling: { entries: 4 } });
  world.baseline = new Set(env.allNodes().filter(node => node.kind !== "process").map(node => node.id));
  return world;
}

const runner = (world: World): Driver => {
  let driver = world.nodes.get("$runner") as Driver | undefined;
  if (driver) return driver;
  driver = world.env.driver({ name: "runner", start(run, params) {
    const { node, log } = params as { node: string; log: string };
    run.effect({ inputs: [world.nodes.get(node)!], run: context => {
      const input = context.inputs[0];
      const list = world.logs.get(log) ?? [];
      list.push([!input.latest ? null : input.error ? { error: input.error.message } : (input.value ?? null) as Json]);
      world.logs.set(log, list);
    } });
  } }, "$runner");
  world.nodes.set("$runner", driver);
  world.baseline.add("$runner");
  return driver;
};

let counter = 0;
function step(world: World, next: () => number): void {
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(items: readonly T[]) => items[int(items.length)];
  const { env, model, nodes, tokens } = world;
  const roll = next();
  const everything = [...world.seeds, "p", ...world.combinators];
  if (roll < 0.25) {
    // One observation, or a transaction of several (a seed may be observed twice in one).
    const batch: [string, Json][] = Array.from({ length: 1 + int(3) }, () => [pick([...world.seeds, "p"]), int(6)]);
    env.transaction(() => { for (const [id, value] of batch) env.observe(nodes.get(id)!, value); });
    model.observe(batch);
  } else if (roll < 0.33) {
    const spec: Spec = pick([{ latest: true }, { rolling: { entries: 1 + int(3) } }, { range: { from: 1 + int(4) } }] as Spec[]);
    const node = pick(everything), name = `d${++counter}`, token = new Aborter();
    tokens.set(name, token);
    world.demandSpecs.set(name, spec);
    world.since.set(name, env.cycle);
    nodes.get(node)!.demand(spec as never, token.signal, name);
    model.demand(name, node, spec);
  } else if (roll < 0.41) {
    const names = [...tokens.keys()].filter(name => name.startsWith("d"));
    const name = names.length ? pick(names) : undefined;
    if (!name) return;
    tokens.get(name)!.abort("done");
    tokens.delete(name);
    model.release(name);
  } else if (roll < 0.49) {
    // Connect or disconnect a recorder.
    const id = pick(world.recorders), name = `connect:${id}`;
    const current = tokens.get(name);
    if (current) { current.abort("off"); tokens.delete(name); model.disconnect(id); }
    else { const token = new Aborter(); tokens.set(name, token); env.connect(nodes.get(id)!, token.signal); model.connect(name, id); }
  } else if (roll < 0.54) {
    // The host rewires a combinator (refused, with code cycle, when that would close a cycle).
    const id = pick(world.combinators.filter(item => item !== "win"));
    const inputs = Array.from({ length: 1 + int(2) }, () => pick(everything));
    env.setInputs(nodes.get(id)!, inputs.map(input => nodes.get(input)!));
    model.setInputs(id, inputs);
  } else if (roll < 0.6) {
    const id = pick(everything);
    const entry = env.read(nodes.get(id)!);
    const expected = model.read(id);
    const actual = entry ? (entry.error ? { error: entry.error.message } : entry.value as Json) : null;
    if (!equal(actual, expected)) throw new Error(`read ${id}: the kernel read ${JSON.stringify(actual)}, the model ${JSON.stringify(expected)}`);
  } else if (roll < 0.66) {
    const spec = { rolling: { entries: 1 + int(4) } };
    env.observe(nodes.get("spec")!, spec);
    model.observe([["spec", spec]]);
  } else if (roll < 0.71) {
    const value = int(2);
    env.observe(nodes.get("sel")!, value);
    model.observe([["sel", value]]);
  } else if (roll < 0.76) {
    // A driver run connecting a recorder of some node for as long as it runs.
    const node = pick(everything), n = ++counter, token = new Aborter(), log = `runlog${n}`, effect = `runfx${n}`;
    const process = runner(world).start(token.signal, { node, log });
    const id = `run${n}`;
    world.runs.set(id, { process, effect, token });
    model.spawn(id, "forever", undefined);
    model.effect(effect, [node], { kind: "record", log });
    model.connect(id, effect);
  } else if (roll < 0.8) {
    const running = [...world.runs.entries()].filter(([id]) => !model.processes.get(id)!.terminal);
    if (!running.length) return;
    const [id, run] = pick(running);
    run.token.abort(`stop ${id}`);
    model.abort(id, `stop ${id}`);
    model.disconnect(run.effect);
  } else if (roll < 0.88) {
    // A tree of processes: each finishes, fails or runs until aborted; children are aborted when their parent ends.
    const spawn = (id: string, parent: string | undefined, depth: number) => {
      const ms = 5 + int(80), fail = int(4) === 0;
      const kernelParent = parent ? world.processes.get(parent) : undefined;
      const process = env.spawn(id, signal => new Promise<Json>((resolve, reject) =>
        env.clock.after(ms, () => fail ? reject(new Error(`failed ${id}`)) : resolve(id), signal)), kernelParent ?? env.root, id);
      world.processes.set(id, process);
      model.spawn(id, fail ? { fail: `failed ${id}` } : { done: id }, world.scheduler.now + ms, parent);
      if (depth < 2) for (let i = 0; i < int(3); i++) spawn(`${id}.${i}`, id, depth + 1);
    };
    const running = [...world.processes.keys()].filter(id => !model.processes.get(id)!.terminal);
    spawn(`p${++counter}`, running.length && int(3) === 0 ? pick(running) : undefined, 0);
  } else if (roll < 0.92) {
    const running = [...world.processes.keys()].filter(id => !model.processes.get(id)!.terminal);
    if (!running.length) return;
    const id = pick(running), reason = `abort ${id}`;
    world.processes.get(id)!.abort(reason);
    model.abort(id, reason);
  } else {
    world.scheduler.advance(pick([1, 5, 20, 60, 150]));
    model.advance(world.scheduler.now);
  }
}

function check(world: World): string[] {
  const problems: string[] = [];
  const { env, model, nodes, streams } = world;
  const active = model.activeSet();
  for (const [id, node] of model.nodes) {
    const actual = nodes.get(id) ?? env.allNodes().find(item => item.id === id);
    if (id.startsWith("runfx")) continue;
    if (!actual) { problems.push(`missing: ${id}`); continue; }
    if (actual.active !== active.has(id)) problems.push(`active: ${id} is ${actual.active ? "active" : "dormant"} in the kernel, ${active.has(id) ? "active" : "dormant"} in the model`);
    if (node.kind !== "effect") {
      const stream = (streams.get(id) ?? []).map(entryOut);
      if (!equal(stream, node.history)) problems.push(`stream: ${id} is ${JSON.stringify(stream)} in the kernel, ${JSON.stringify(node.history)} in the model`);
    }
    if (node.kind !== "seed" && actual.computes !== node.runs) problems.push(`computes: ${id} computed ${actual.computes} times in the kernel, ${node.runs} in the model`);
  }
  for (const name of new Set([...world.logs.keys(), ...model.logs.keys()]))
    if (!equal(world.logs.get(name) ?? [], model.logs.get(name) ?? [])) problems.push(`log: ${name} is ${JSON.stringify(world.logs.get(name))} in the kernel, ${JSON.stringify(model.logs.get(name))} in the model`);
  for (const name of new Set([...world.probeLogs.keys(), ...model.probeLogs.keys()]))
    if (!equal(world.probeLogs.get(name) ?? [], model.probeLogs.get(name) ?? [])) problems.push(`activation: ${name} logged ${JSON.stringify(world.probeLogs.get(name))}, the model ${JSON.stringify(model.probeLogs.get(name))}`);
  const codes = (streams.get("$errors") ?? []).map(entry => (entry.value as { code?: string }).code ?? null);
  if (!equal(codes, model.errors)) problems.push(`errors: ${JSON.stringify(codes)} in the kernel, ${JSON.stringify(model.errors)} in the model`);
  // Retention: every entry a host demand requires, appended while it was in place, is still held.
  for (const [name, demand] of model.hostDemands) {
    if (name === "$read") continue;
    const node = nodes.get(demand.node)!, history = streams.get(demand.node) ?? [];
    const since = world.since.get(name)!;
    const required = covered(demand.spec, history.length).filter(seq => history[seq - 1].cycle > since || seq === history.length);
    const held = new Set(node.entries.map(entry => entry.seq));
    const lost = required.filter(seq => !held.has(seq));
    if (lost.length) problems.push(`retention: ${demand.node} lost ${JSON.stringify(lost)} that ${name} (${JSON.stringify(demand.spec)}) requires`);
  }
  // Processes: each state stream, and the running tree.
  const kernelIds = new Map<Process, string>([...world.processes].map(([id, process]) => [process, id]));
  for (const [id, run] of world.runs) kernelIds.set(run.process, id);
  for (const [process, id] of kernelIds) {
    const states = (streams.get(process.id) ?? []).map(entry => entry.value as Json);
    const expected = model.processes.get(id)!.states;
    if (!equal(states, expected)) problems.push(`process: ${id} went ${JSON.stringify(states)} in the kernel, ${JSON.stringify(expected)} in the model`);
  }
  const tree = (node: ReturnType<typeof env.processTree>): Json[] => node.children.filter(child => child.status === "running" || child.status === "progress")
    .map(child => {
      const process = env.node(child.id) as Process | undefined;
      const id = process ? kernelIds.get(process) : undefined;
      return { id: id ?? child.id, children: tree(child) };
    }).sort((a, b) => ((a as { id: string }).id < (b as { id: string }).id ? -1 : 1));
  const actualTree = tree(env.processTree()), expectedTree = model.runningTree();
  if (!equal(actualTree, expectedTree)) problems.push(`tree: ${JSON.stringify(actualTree)} in the kernel, ${JSON.stringify(expectedTree)} in the model`);
  return problems;
}

/** Ends every token and process; then nothing may remain but the nodes the world was built with. */
function teardown(world: World): string[] {
  const problems: string[] = [];
  const { env } = world;
  for (const process of world.processes.values()) process.abort("teardown");
  for (const run of world.runs.values()) run.token.abort("teardown");
  for (const token of world.tokens.values()) token.abort("teardown");
  const left = env.allNodes().filter(node => !world.baseline.has(node.id) && node.id !== "$root");
  if (left.length) problems.push(`leak: ${left.map(node => `${node.kind} ${node.id}`).join(", ")} outlived the teardown`);
  for (const node of env.allNodes()) {
    if (node.active) problems.push(`leak: ${node.id} is still active`);
    if ((node as unknown as { demands: Map<unknown, unknown> }).demands.size) problems.push(`leak: ${node.id} still has demand on it`);
  }
  if (env.root.children.length) problems.push(`leak: the root still has ${env.root.children.length} children`);
  const rootScope = (env as unknown as { rootScope: { effects: unknown[] } }).rootScope;
  if (rootScope.effects.length) problems.push(`leak: ${rootScope.effects.length} effects are still connected in the root scope`);
  if (signalListeners(env.root.signal)) problems.push(`leak: the root's token still has ${signalListeners(env.root.signal)} listeners`);
  return problems;
}

async function simulate(seed: string): Promise<string[]> {
  const world = build(seed);
  await settle();
  const next = prng(`${seed}:steps`);
  const initial = check(world);
  if (initial.length) return [`at setup: ${initial[0]}`];
  for (let i = 0; i < STEPS; i++) {
    step(world, next);
    await settle();
    const problems = check(world);
    if (problems.length) return problems.slice(0, 3).map(problem => `step ${i}: ${problem}`);
  }
  await settle();
  return teardown(world);
}

for (let batch = 0; batch < RUNS; batch += 50) test(`the kernel agrees with its reference model on random graphs (seeds ${batch}-${Math.min(RUNS, batch + 50) - 1})`, async () => {
  const failures: string[] = [];
  for (let seed = batch; seed < Math.min(RUNS, batch + 50); seed++) {
    const problems = await simulate(`kernel-model-${seed}`);
    if (problems.length) failures.push(`seed kernel-model-${seed}: ${problems.join(" | ")}`);
  }
  expect(failures).toEqual([]);
}, 120_000);
