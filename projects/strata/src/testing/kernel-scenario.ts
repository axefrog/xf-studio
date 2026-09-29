/**
 * The simulation scenario for the kernel: random subsystems declared as data (the erector builds them), with
 * reconvergent diamonds, effects that rewire mid-cycle, effects that start and stop drivers, nested processes, aborts,
 * observations from effects, failing combinators, windows demanded through a spec node, host demand and one-shot reads,
 * and host nodes that end with their token; the environment keeps only what demand requires. The cycle invariants
 * (SPEC §6.5, K2 included) are checked on every cycle, and glitch freedom, process-tree, abort and activity invariants
 * after every step.
 */
import { equal } from "../json";
import type { Json } from "../json";
import { Aborter } from "../kernel/abort";
import { Environment, ErrorValue, kernelInternals, KNode, LATEST, Process, UNCHANGED } from "../kernel/kernel";
import type { CycleReport, Driver, KEntry } from "../kernel/kernel";
import { erector, GRAPH_MODEL_SCHEMA } from "../kernel/erector";
import type { GraphModel, NodeModel } from "../kernel/erector";
import type { Operators } from "../kernel/operators";
import { conformanceOperators } from "./conformance";
import { Scheduler, simClock } from "./sim-sources";
import { prng } from "../random";
import { kernelTableProblems } from "./invariants";
import type { Scenario, SimAction } from "./simulate";

export type KernelWorld = {
  scheduler: Scheduler; env: Environment; model: KNode<GraphModel>; operators: Operators;
  live(id: string): KNode | undefined;
  tokens: Aborter[]; problems: string[];
  /** Every process that ever appended, with its whole stream as appended (finished ones are forgotten by the environment). */
  processes: Map<Process, KEntry[]>;
  /** Host demand and host nodes, each ended by its token. */
  hosted: { token: Aborter; node: KNode; owned: boolean }[];
  /** The erector's token, and the nodes there were before it started (all that may remain after the teardown). */
  life: Aborter; baseline: ReadonlySet<string>;
};

/** How many listeners a token has (its own; the engine's tokens keep them in a list). */
const listenerCount = (signal: unknown) => (signal as { listeners?: unknown[] }).listeners?.length ?? 0;

const PURE = ["sum", "product", "threshold", "identity", "combine", "fail-when"];

/** A random model: seeds, a layered DAG of pure combinators (diamonds by construction), effects, drivers and processes. */
export function randomModel(seed: string): GraphModel {
  const next = prng(seed);
  const int = (n: number) => Math.floor(next() * n);
  const nodes: NodeModel[] = [];
  const seeds = 2 + int(3);
  for (let i = 0; i < seeds; i++) nodes.push({ id: `s${i}`, kind: "seed", initial: int(5) });
  nodes.push({ id: "sel", kind: "seed", initial: 0 }, { id: "flag", kind: "seed", initial: false }, { id: "echoed", kind: "seed" });
  const pool = nodes.filter(item => item.id.startsWith("s")).map(item => item.id);
  const combinators = 3 + int(6);
  for (let i = 0; i < combinators; i++) {
    // Combine and product take seeds only, so values stay small; the rest take any earlier node (diamonds).
    const op = PURE[int(PURE.length)];
    const count = op === "identity" || op === "threshold" || op === "fail-when" ? 1 : 1 + int(3);
    const from = op === "combine" || op === "product" ? pool.filter(id => id.startsWith("s")) : pool;
    const inputs = Array.from({ length: count }, () => from[int(from.length)]);
    nodes.push({ id: `c${i}`, kind: "combinator", op, inputs,
      params: op === "sum" ? { add: int(3) } : op === "threshold" ? { at: int(8) } : op === "fail-when" ? { equals: int(4), message: "no" } : {} });
    pool.push(`c${i}`);
  }
  const later = pool.filter(id => id.startsWith("c"));
  const target = later[int(later.length)];
  const early = pool.slice(0, pool.indexOf(target));
  nodes.push({ id: "rw", kind: "effect", op: "rewire", inputs: ["sel"], params: { node: target, inputs: [[early[int(early.length)]], [early[int(early.length)], early[int(early.length)]]] } });
  for (let i = 0; i < 1 + int(3); i++) nodes.push({ id: `log${i}`, kind: "effect", op: "record", inputs: [later[int(later.length)]] });
  // An effect observing a seed mid-cycle (a later cycle carries it to its own consumer).
  nodes.push({ id: "echo", kind: "effect", op: "observe", inputs: [later[int(later.length)]], params: { seed: "echoed" } });
  nodes.push({ id: "echolog", kind: "effect", op: "record", inputs: ["echoed"] });
  const work = (id: string, depth: number): Json => ({ id, ms: 10 + int(200), ...(int(4) === 0 ? { fail: "failed" } : { result: id }),
    ...(depth < 2 && int(2) ? { children: [work(`${id}.${depth}`, depth + 1)] } : {}), ...(int(2) ? { progress: ["half"] } : {}) });
  nodes.push({ id: "worker", kind: "driver", op: "work", params: { processes: [work(`p${int(1000)}`, 0)] } });
  nodes.push({ id: "watcher", kind: "driver", op: "connect", params: { pairs: [[later[int(later.length)], "watched"]] } });
  nodes.push({ id: "w", kind: "effect", op: "while", inputs: ["flag"], params: { driver: "watcher" } });
  // A window over a seed, demanded through a spec node that the script resizes (SPEC §4.3).
  nodes.push({ id: "spec", kind: "seed", initial: { rolling: { entries: 1 + int(3) } } });
  nodes.push({ id: "win", kind: "combinator", op: "collect", inputs: [pool[int(seeds)]], demand: "spec" });
  nodes.push({ id: "winlog", kind: "effect", op: "record", inputs: ["win"] });
  return { schema: GRAPH_MODEL_SCHEMA, nodes };
}

function onCycle(world: () => KernelWorld | undefined, report: CycleReport): void {
  const current = world();
  if (!current) return;
  const seen = new Set<KNode>();
  const order = new Map(report.finished.map((item, index) => [item.node, index]));
  for (const [index, item] of report.finished.entries()) {
    if (seen.has(item.node)) current.problems.push(`K1: ${item.node.name} finished twice in cycle ${report.cycle}`);
    seen.add(item.node);
    // K2: every input that took part in the cycle finished before this node computed.
    if (item.computed) for (const input of item.node.inputs) {
      const at = order.get(input.node);
      if (at !== undefined && at > index) current.problems.push(`K2: ${item.node.name} computed before its input ${input.node.name} finished in cycle ${report.cycle}`);
    }
    if (item.computed && report.kind === "observe" && !item.node.inputs.some(input => input.node.appendedIn === report.cycle))
      current.problems.push(`K3: ${item.node.name} computed in cycle ${report.cycle} though no input changed`);
    if (item.appended && item.node.kind === "combinator" && item.node.latest()?.cycle !== report.cycle)
      current.problems.push(`K4: ${item.node.name} reported a change it didn't append`);
  }
  for (const node of report.unbalanced) current.problems.push(`K5: ${node.name} was left with an open START in cycle ${report.cycle}`);
}

const actions: SimAction<KernelWorld>[] = [
  { name: "observe", weight: 5, run(world, [a, b, c]) {
    world.env.transaction(() => {
      for (let i = 0; i <= a % 3; i++) {
        const seed = world.live(`s${(b + i) % 5}`);
        if (seed) world.env.observe(seed, (c + i) % 7);
      }
    });
  } },
  { name: "select", run(world, [a]) { const sel = world.live("sel"); if (sel) world.env.observe(sel, a % 2); } },
  { name: "flag", run(world, [a]) { const flag = world.live("flag"); if (flag) world.env.observe(flag, a % 2 === 0); } },
  { name: "remodel", weight: 0.5, run(world, [a]) { world.env.observe(world.model, randomModel(`remodel-${a}`)); } },
  { name: "start", run(world) {
    const driver = world.live("worker") as Driver | undefined;
    if (!driver) return;
    const token = new Aborter();
    world.tokens.push(token);
    driver.start(token.signal);
  } },
  { name: "abort", run(world, [a]) { const token = world.tokens[a % Math.max(1, world.tokens.length)]; token?.abort(`abort ${a % 3}`); } },
  { name: "resize", run(world, [a, b]) {
    const spec = world.live("spec");
    if (spec) world.env.observe(spec, [{ rolling: { entries: 1 + a % 4 } }, { latest: true }, { range: { from: 1 + b % 3 } }, { rolling: { ms: 5 + b % 50 } }][a % 4] as never);
  } },
  { name: "host-demand", run(world, [a, b]) {
    const node = world.live(`c${a % 9}`) ?? world.live("win");
    if (!node) return;
    const token = new Aborter();
    world.hosted.push({ token, node, owned: false });
    node.demand(b % 3 === 0 ? { rolling: { entries: 2 } } : LATEST, token.signal, "sim");
  } },
  { name: "host-node", run(world, [a]) {
    // A host combinator and effect living until their token aborts (SPEC §8.4).
    const input = world.live(`c${a % 9}`) ?? world.live("s0");
    if (!input) return;
    const token = new Aborter();
    const node = world.env.combinator({ name: "host", inputs: [input], compute: context => context.inputs[0].latest ? context.inputs[0].value ?? null : UNCHANGED, signal: token.signal });
    const effect = world.env.effect({ name: "host effect", inputs: [node], run: () => undefined, signal: token.signal });
    world.env.connect(effect, token.signal);
    world.hosted.push({ token, node, owned: true }, { token, node: effect, owned: true });
  } },
  { name: "end-host", weight: 1.5, run(world, [a]) {
    const item = world.hosted[a % Math.max(1, world.hosted.length)];
    item?.token.abort("done");
  } },
  { name: "read", run(world, [a]) { const node = world.live(`c${a % 9}`); if (node) world.env.read(node); } },
];

export function kernelScenario(): Scenario<KernelWorld> {
  return {
    name: "kernel",
    setup(seed) {
      const scheduler = new Scheduler();
      let world: KernelWorld | undefined;
      const processes = new Map<Process, KEntry[]>();
      const env = new Environment({ clock: simClock(scheduler), onCycle: report => onCycle(() => world, report), onAppend: (node, entry) => {
        if (node instanceof Process) { const list = processes.get(node) ?? []; list.push(entry); processes.set(node, list); }
      } });
      const logs = new Map<string, Json[]>();
      const operators = conformanceOperators(logs);
      const model = env.seed<GraphModel>({ id: "$model", initial: randomModel(seed) });
      const erected = erector(env, model, operators);
      const life = new Aborter();
      world = { scheduler, env, model, operators, live: id => erected.live(id), tokens: [], problems: [], processes, hosted: [], life,
        baseline: new Set(env.allNodes().map(node => node.id)) };
      erected.driver.start(life.signal);
      return world;
    },
    actions,
    deliver: (world, pick) => { world.scheduler.deliver(pick); },
    advance: (world, ms) => { world.scheduler.advance(ms); },
    teardown(world) {
      // Everything the host started ends: tokens, host demand and nodes, driver runs, the erector.
      for (const token of world.tokens) token.abort("teardown");
      for (const item of world.hosted) item.token.abort("teardown");
      world.life.abort("teardown");
      world.scheduler.advance(10_000);
      const problems: string[] = [];
      const left = world.env.allNodes().filter(node => !world.baseline.has(node.id));
      if (left.length) problems.push(`leak: ${left.map(node => `${node.kind} ${node.name}`).join(", ")} outlived the teardown`);
      for (const node of world.env.allNodes()) {
        if (node.active) problems.push(`leak: ${node.name} is still active`);
        if (node.demands.size) problems.push(`leak: ${node.name} still has demand on it`);
      }
      if (world.env.root.children.length) problems.push(`leak: the root still has ${world.env.root.children.length} children`);
      if (listenerCount(world.env.root.signal)) problems.push(`leak: the root's token still has ${listenerCount(world.env.root.signal)} listeners`);
      problems.push(...kernelTableProblems(kernelInternals.tables(world.env), { settled: true }));
      if (kernelInternals.tables(world.env).scopes !== 1) problems.push(`leak: ${kernelInternals.tables(world.env).scopes - 1} run scopes outlived the teardown`);
      return problems;
    },
    check(world) {
      const problems = [...world.problems];
      world.problems.length = 0;
      for (const node of world.env.allNodes()) {
        // Glitch freedom settled: every active pure combinator holds the value its inputs give now.
        if (node.kind === "combinator" && node.active && node.compute && node.name.startsWith("c") && node.inputs.every(input => input.node.latest())) {
          const inputs = node.inputs.map(input => { const latest = input.node.latest()!; return { node: input.node, latest, value: latest.value, error: latest.error, changed: false, fresh: [], window: [latest] }; });
          const result = node.compute({ inputs, previous: node.latest(), cycle: world.env.cycle, at: 0, env: world.env });
          const latest = node.latest();
          const expected = result === UNCHANGED ? latest?.value : result instanceof ErrorValue ? undefined : result;
          const expectedError = result instanceof ErrorValue ? result.error : result === UNCHANGED ? latest?.error : undefined;
          if (!equal(latest?.value, expected) || !equal(latest?.error, expectedError))
            problems.push(`stale: ${node.name} holds ${JSON.stringify(latest?.value ?? latest?.error)} but its inputs give ${JSON.stringify(expected ?? expectedError)}`);
        }
        // Activity: an active node is demanded (a seed or combinator by a consumer or the host; an effect by a scope).
        if (node.active && node.kind !== "process" && node.kind !== "driver" && (node.kind === "effect" ? !node.scope : node.demands.size === 0))
          problems.push(`activity: ${node.name} is active with nothing demanding it`);
      }
      for (const [process, entries] of world.processes) {
        const states = entries.map(entry => (entry.value as { status: string }).status);
        const terminal = states.findIndex(status => status === "done" || status === "failed" || status === "aborted");
        if (terminal >= 0 && terminal !== states.length - 1) problems.push(`abort: process ${process.name} changed after ending (${states.join(", ")})`);
        if (states.filter(status => status === "done" || status === "failed" || status === "aborted").length > 1) problems.push(`abort: process ${process.name} ended twice`);
        if (terminal >= 0) for (const child of process.children) if (!child.terminal && world.processes.get(child)?.length)
          problems.push(`abort: ${child.name} still runs after its parent ${process.name} ended`);
        // A finished process is forgotten once its end is observed; a running one is in the tree.
        if (terminal >= 0 && world.env.node(process.id) === process) problems.push(`lifetime: finished process ${process.name} is still held`);
      }
      // A host node whose token ended is forgotten, and holds no demand.
      for (const item of world.hosted) if (item.token.signal.aborted && item.owned && world.env.node(item.node.id) === item.node)
        problems.push(`lifetime: ${item.node.name} outlived its token`);
      world.hosted = world.hosted.filter(item => !item.token.signal.aborted);
      // Lifetimes: every effect in the environment is connected (a run's or the host's), and the root's token has one
      // listener per child it still has (a finished child lets go of its parent).
      for (const node of world.env.allNodes()) if (node.kind === "effect" && !node.scope) problems.push(`lifetime: effect ${node.name} is neither connected nor forgotten`);
      const rootListeners = listenerCount(world.env.root.signal);
      if (rootListeners !== world.env.root.children.length) problems.push(`lifetime: the root's token has ${rootListeners} listeners for ${world.env.root.children.length} children`);
      for (const entry of world.env.errors.entries) {
        const code = (entry.value as { code?: string }).code;
        if (code !== "cycle" && code !== "effect") problems.push(`errors: unexpected ${code}: ${(entry.value as { message: string }).message}`);
      }
      problems.push(...kernelTableProblems(kernelInternals.tables(world.env)));
      return problems;
    },
  };
}
