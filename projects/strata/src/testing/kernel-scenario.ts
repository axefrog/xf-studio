/**
 * The simulation scenario for the kernel: random subsystems declared as data (the erector builds them), with
 * reconvergent diamonds, effects that rewire mid-cycle, effects that start and stop drivers, nested processes, aborts,
 * observations from effects and failing combinators; the cycle invariants (SPEC §6.5) checked on every cycle, and
 * glitch freedom, process-tree and abort invariants after every step.
 */
import { equal } from "../json";
import type { Json } from "../json";
import { Aborter } from "../kernel/abort";
import { Environment, ErrorValue, KNode, Process, UNCHANGED } from "../kernel/kernel";
import type { CycleReport, Driver } from "../kernel/kernel";
import { erector, GRAPH_MODEL_SCHEMA } from "../kernel/erector";
import type { GraphModel, NodeModel } from "../kernel/erector";
import type { Operators } from "../kernel/operators";
import { conformanceOperators } from "./conformance";
import { prng, Scheduler, simClock } from "./sim-sources";
import type { Scenario, SimAction } from "./simulate";

export type KernelWorld = {
  scheduler: Scheduler; env: Environment; model: KNode<GraphModel>; operators: Operators;
  live(id: string): KNode | undefined;
  tokens: Aborter[]; problems: string[];
};

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
  return { schema: GRAPH_MODEL_SCHEMA, nodes };
}

function onCycle(world: () => KernelWorld | undefined, report: CycleReport): void {
  const current = world();
  if (!current) return;
  const seen = new Set<KNode>();
  for (const item of report.finished) {
    if (seen.has(item.node)) current.problems.push(`K1: ${item.node.name} finished twice in cycle ${report.cycle}`);
    seen.add(item.node);
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
];

export function kernelScenario(): Scenario<KernelWorld> {
  return {
    name: "kernel",
    setup(seed) {
      const scheduler = new Scheduler();
      let world: KernelWorld | undefined;
      const env = new Environment({ clock: simClock(scheduler), retainAll: true, onCycle: report => onCycle(() => world, report) });
      const logs = new Map<string, Json[]>();
      const operators = conformanceOperators(logs);
      const model = env.seed<GraphModel>({ id: "$model", initial: randomModel(seed) });
      const erected = erector(env, model, operators);
      world = { scheduler, env, model, operators, live: id => erected.live(id), tokens: [], problems: [] };
      erected.driver.start(new Aborter().signal);
      return world;
    },
    actions,
    deliver: (world, pick) => { world.scheduler.deliver(pick); },
    advance: (world, ms) => { world.scheduler.advance(ms); },
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
        if (node instanceof Process) {
          const states = node.entries.map(entry => (entry.value as { status: string }).status);
          const terminal = states.findIndex(status => status === "done" || status === "failed" || status === "aborted");
          if (terminal >= 0 && terminal !== states.length - 1) problems.push(`abort: process ${node.name} changed after ending (${states.join(", ")})`);
          if (states.filter(status => status === "done" || status === "failed" || status === "aborted").length > 1) problems.push(`abort: process ${node.name} ended twice`);
          if (terminal >= 0) for (const child of node.children) if (!child.terminal && child.entries.length)
            problems.push(`abort: ${child.name} still runs after its parent ${node.name} ended`);
        }
      }
      for (const entry of world.env.errors.entries) {
        const code = (entry.value as { code?: string }).code;
        if (code !== "cycle" && code !== "effect") problems.push(`errors: unexpected ${code}: ${(entry.value as { message: string }).message}`);
      }
      return problems;
    },
  };
}
