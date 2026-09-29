/**
 * This engine's own policies, beyond what the rules require: memory stays bounded (an active node keeps only what its
 * demand covers, a node going dormant lets go of its history), queued changes and observations keep their order, a
 * failing wiring change is reported and the rest still apply, and the activation bound counts consecutive activation
 * cycles only.
 */
import { expect, test } from "bun:test";
import { Aborter, createEnvironment, LATEST } from "strata";
import { kernelInternals } from "../src/kernel/kernel";
import type { CycleReport, DemandSpec, Json, KEntry, KNode, Process } from "strata";
import { Scheduler, simClock } from "strata/testing";

const world = (activationBound?: number) => {
  const appended = new Map<string, KEntry[]>();
  const env = createEnvironment({ clock: simClock(new Scheduler()), ...(activationBound ? { activationBound } : {}), onAppend: (node, entry) => {
    const list = appended.get(node.id) ?? []; list.push(entry); appended.set(node.id, list);
  } });
  const codes = () => (appended.get("$errors") ?? []).map(entry => (entry.value as { code?: string }).code ?? null);
  return { env, codes };
};
const watch = (node: KNode, spec: DemandSpec = LATEST) => { const token = new Aborter(); node.demand(spec, token.signal); return token; };
const seqs = (node: KNode) => node.entries.map(entry => entry.seq);

test("an active node keeps only what its demand covers, however long it runs", () => {
  const { env } = world();
  const seed = env.seed<number>({ initial: 0 });
  const doubled = env.combinator<number>({ inputs: [seed], compute: context => (context.inputs[0].value as number ?? 0) * 2 });
  const token = watch(doubled);
  const rolling = watch(seed, { rolling: { entries: 3 } });
  for (let i = 1; i <= 100; i++) env.observe(seed, i);
  expect(seqs(seed)).toEqual([99, 100, 101]);
  expect(seqs(doubled)).toEqual([101]);
  rolling.abort();
  env.observe(seed, 101);
  expect(seqs(seed)).toEqual([102]);
  // A range keeps its entries; an entry spec keeps that entry and the latest.
  const range = watch(seed, { range: { from: 102, to: 103 } });
  const one = watch(seed, { entry: 104 });
  for (let i = 0; i < 5; i++) env.observe(seed, 200 + i);
  expect(seqs(seed)).toEqual([102, 103, 104, 107]);
  range.abort(); one.abort(); token.abort();
});

test("a node going dormant lets go of its history, keeping its latest entry", () => {
  const { env } = world();
  const seed = env.seed<number>({ initial: 0 });
  const echo = env.combinator<number>({ inputs: [{ node: seed, demand: { rolling: { entries: 5 } } }], compute: context => context.inputs[0].window.length });
  const token = watch(echo, { rolling: { entries: 4 } });
  for (let i = 1; i <= 6; i++) env.observe(seed, i);
  expect(seqs(echo).length).toBeGreaterThan(1);
  token.abort();
  expect(seqs(echo)).toEqual([echo.latest()!.seq]);
  // A dormant seed keeps what it had until it next appends; then only its latest.
  expect(seqs(seed).length).toBe(5);
  env.observe(seed, 7);
  expect(seqs(seed)).toEqual([8]);
});

test("a shrinking window trims at once; the entries it gave up are not recovered when it grows again", () => {
  const { env } = world();
  const seed = env.seed<number>({ initial: 0 });
  const spec = env.seed<DemandSpec>({ initial: { rolling: { entries: 4 } } });
  const window = env.combinator<number[]>({ inputs: [{ node: seed, demand: spec }], compute: context => context.inputs[0].window.map(entry => entry.value as number) });
  const token = watch(window);
  for (let i = 1; i <= 5; i++) env.observe(seed, i);
  expect(window.value()).toEqual([2, 3, 4, 5]);
  env.observe(spec, { rolling: { entries: 2 } });
  expect(seqs(seed)).toEqual([5, 6]);
  env.observe(spec, { rolling: { entries: 4 } });
  expect(window.value()).toEqual([4, 5]);
  token.abort();
});

test("queued changes apply in the order they were asked for; queued observations each start a cycle, in order", () => {
  const { env } = world();
  const a = env.seed<string>({ initial: "a" }), b = env.seed<string>({ initial: "b" }), c = env.seed<string>({ initial: "c" });
  const target = env.combinator<string>({ inputs: [a], compute: context => context.inputs[0].value as never });
  const echoed = env.seed<number>();
  const seen: number[] = [];
  const listener = env.effect({ inputs: [echoed], run: context => { if (context.inputs[0].changed) seen.push(context.inputs[0].value as number); } });
  const trigger = env.seed<number>({ initial: 0 });
  const effect = env.effect({ inputs: [trigger], run: context => {
    if (context.inputs[0].value !== 1) return;
    env.setInputs(target, [b]);
    env.setInputs(target, [c]);
    env.observe(echoed, 1);
    env.observe(echoed, 2);
  } });
  const life = new Aborter();
  env.connect(listener, life.signal);
  env.connect(effect, life.signal);
  watch(target);
  const before = env.cycle;
  env.observe(trigger, 1);
  expect(target.value()).toBe("c");
  expect(seen).toEqual([1, 2]);
  // The trigger's cycle, one activation cycle for the rewiring, then one cycle per observation.
  expect(env.cycle - before).toBe(4);
  life.abort();
});

test("a wiring change that throws is reported with code wiring, and the changes queued after it still apply", () => {
  const { env, codes } = world();
  const seed = env.seed<number>({ initial: 1 });
  const node = env.combinator<number>({ inputs: [seed], compute: context => context.inputs[0].value as never });
  env.change(() => { throw new Error("broken change"); });
  const token = watch(node);
  expect(codes()).toEqual(["wiring"]);
  expect(node.active).toBe(true);
  token.abort();
});

test("the activation bound counts consecutive activation cycles: observations between them start the count again", () => {
  const { env, codes } = world(3);
  const a = env.seed<number>({ initial: 1 }), b = env.seed<number>({ initial: 2 });
  const flip = env.combinator<number>({ inputs: [a], compute: context => context.inputs[0].value as never });
  // Each run rewires the node it reads, which primes it again: wiring that never settles.
  const flipper = env.effect({ inputs: [flip], run: () => env.setInputs(flip, [flip.inputs[0].node === a ? b : a]) });
  const life = new Aborter();
  env.connect(flipper, life.signal);
  expect(codes()).toEqual(["activation-bound"]);
  life.abort();
  // Two activation cycles, an observation, two more: under a bound of three, nothing is dropped.
  const { env: calm, codes: calmCodes } = world(3);
  const s = calm.seed<number>({ initial: 0 });
  const n1 = calm.combinator<number>({ inputs: [s], compute: context => context.inputs[0].value as never });
  const n2 = calm.combinator<number>({ inputs: [n1], compute: context => context.inputs[0].value as never });
  const t1 = watch(n1); const t2 = watch(n2);
  calm.observe(s, 1);
  calm.setInputs(n2, [s]); calm.setInputs(n2, [n1]);
  expect(calmCodes()).toEqual([]);
  t1.abort(); t2.abort();
});

/** A world whose cycles are reported, for the tests that read the reports. */
const reported = (activationBound?: number) => {
  const reports: CycleReport[] = [];
  const scheduler = new Scheduler();
  const env = createEnvironment({ clock: simClock(scheduler), ...(activationBound ? { activationBound } : {}), onCycle: report => reports.push(report) });
  const codes = () => env.errors.entries.map(entry => (entry.value as { code?: string }).code ?? null);
  return { env, reports, scheduler, codes };
};
const shape = (report: CycleReport) => [report.kind, report.finished.map(item => [item.node.name, item.computed, item.appended])];

test("a fresh environment: no cycle yet, its root registered and running, entries outside a cycle stamped with the clock's time", () => {
  const { env, scheduler } = reported();
  expect([env.cycle, LATEST, env.node("$root"), env.root.status()]).toEqual([0, { latest: true }, env.root, "running"]);
  scheduler.advance(50);
  const late = env.seed<number>({ initial: 1 });
  expect(late.latest()!.at).toBe(scheduler.epoch + 50);
});

test("a cycle reports each node that finished, in order, whether it computed and whether it appended", () => {
  const { env, reports } = reported();
  const s = env.seed<number>({ name: "s", initial: 1 });
  const c = env.combinator<number>({ name: "c", inputs: [s], compute: context => Math.min(context.inputs[0].value as number, 5) });
  const e = env.effect({ name: "e", inputs: [c], run: () => undefined });
  const life = new Aborter();
  env.connect(e, life.signal);
  expect(shape(reports.at(-1)!)).toEqual(["activate", [["c", true, true], ["e", true, false]]]);
  env.observe(s, 2);
  expect(shape(reports.at(-1)!)).toEqual(["observe", [["s", false, true], ["c", true, true], ["e", true, false]]]);
  env.observe(s, 9);
  env.observe(s, 10);
  // c computes but its value doesn't change: e isn't run.
  expect(shape(reports.at(-1)!)).toEqual(["observe", [["s", false, true], ["c", true, false], ["e", false, false]]]);
  expect(reports.every(report => report.unbalanced.length === 0)).toBe(true);
  life.abort();
});

test("a node forgotten by its token: an effect stops running, a host demand through a spec node goes, an active combinator lets go of its inputs", () => {
  const { env } = world();
  const s = env.seed<number>({ initial: 1 });
  const effectToken = new Aborter();
  let runs = 0;
  const e = env.effect({ inputs: [s], run: () => { runs++; }, signal: effectToken.signal });
  const life = new Aborter();
  env.connect(e, life.signal);
  effectToken.abort();
  const before = runs;
  env.observe(s, 2);
  expect([runs, env.node(e.id), e.active]).toEqual([before, undefined, false]);
  // A combinator demanded by the host through a spec node, and by an effect.
  let activations = 0, dormant = 0;
  const source = env.seed<number>({ initial: 1, activate: context => { activations++; context.signal.addEventListener("abort", () => { dormant++; }); } });
  const nodeToken = new Aborter();
  const c = env.combinator<number>({ inputs: [source], compute: context => context.inputs[0].value as never, signal: nodeToken.signal });
  const spec = env.seed<DemandSpec>({ initial: { latest: true } });
  const host = new Aborter();
  c.demand(spec, host.signal);
  const reader = env.effect({ inputs: [c], run: () => undefined });
  env.connect(reader, life.signal);
  expect([activations, c.active, env.allNodes().some(node => node.name === `demand of ${c.name}`)]).toEqual([1, true, true]);
  nodeToken.abort();
  expect([c.active, dormant, env.allNodes().some(node => node.name === `demand of ${c.name}`)]).toEqual([false, 1, false]);
  host.abort(); life.abort();
});

test("queued failures and transactions keep their place behind observations queued before them", () => {
  const { env } = world();
  const trigger = env.seed<number>({ initial: 0 });
  const x = env.seed<number>(), y = env.seed<number>();
  const effect = env.effect({ inputs: [trigger], run: context => {
    if (context.inputs[0].value !== 1) return;
    env.observe(x, 1);
    env.transaction(() => env.observe(y, 1));
    throw new Error("after both");
  } });
  const life = new Aborter();
  env.connect(effect, life.signal);
  env.observe(trigger, 1);
  expect(x.latest()!.cycle).toBeLessThan(y.latest()!.cycle);
  expect(y.latest()!.cycle).toBeLessThan(env.errors.latest()!.cycle);
  life.abort();
});

test("a cycle finishes two observed seeds and their consumers in the order they were observed", () => {
  const { env, reports } = reported();
  const s1 = env.seed<number>({ name: "s1", initial: 0 }), s2 = env.seed<number>({ name: "s2", initial: 0 });
  const c1 = env.combinator<number>({ name: "c1", inputs: [s1], compute: context => context.inputs[0].value as never });
  const c2 = env.combinator<number>({ name: "c2", inputs: [s1], compute: context => (context.inputs[0].value as number) + 1 });
  const c3 = env.combinator<number>({ name: "c3", inputs: [s2], compute: context => context.inputs[0].value as never });
  const tokens = [c1, c2, c3].map(node => watch(node));
  env.transaction(() => { env.observe(s1, 1); env.observe(s2, 1); });
  expect(reports.at(-1)!.finished.map(item => item.node.name)).toEqual(["s1", "c1", "c2", "s2", "c3"]);
  for (const token of tokens) token.abort();
});

test("a host callback throwing between two consumers leaves the second one counted afresh in the next cycle", () => {
  let fail = false;
  const env = createEnvironment({ clock: simClock(new Scheduler()), onAppend: node => { if (fail && node.name === "first") { fail = false; throw new Error("host"); } } });
  const s = env.seed<number>({ initial: 1 });
  const first = env.combinator<number>({ name: "first", inputs: [s], compute: context => (context.inputs[0].value as number) * 10 });
  const second = env.combinator<number>({ name: "second", inputs: [s], compute: context => (context.inputs[0].value as number) * 100 });
  const tokens = [watch(first), watch(second)];
  fail = true;
  expect(() => env.observe(s, 2)).toThrow("host");
  env.observe(s, 3);
  expect([first.value(), second.value()]).toEqual([30, 300]);
  for (const token of tokens) token.abort();
});

test("the activation bound: exactly as many consecutive activation cycles as it names; past it, the activation is dropped and releases still apply", () => {
  const flips = (bound: number, times: number) => {
    const { env, codes } = world(bound);
    const a = env.seed<number>({ initial: 1 }), b = env.seed<number>({ initial: 2 });
    const flip = env.combinator<number>({ inputs: [a], compute: context => context.inputs[0].value as never });
    const other = env.seed<number>({ initial: 0 });
    const doomed = new Aborter();
    const victim = env.combinator<number>({ inputs: [other], compute: context => context.inputs[0].value as never, signal: doomed.signal });
    let left = times, rewired = 0;
    const flipper = env.effect({ inputs: [flip], run: () => {
      if (left-- <= 0) return;
      rewired++;
      env.setInputs(flip, [flip.inputs[0].node === a ? b : a]);
      if (left === 0) doomed.abort();
    } });
    const life = new Aborter();
    env.connect(flipper, life.signal);
    return { codes: codes(), rewired, input: flip.inputs[0].node === a ? "a" : "b", victim: env.node(victim.id) };
  };
  expect(flips(3, 2).codes).toEqual([]);
  expect(flips(4, 3).codes).toEqual([]);
  const over = flips(3, 3);
  // The third rewiring applies, but the activation cycle it asks for is one too many: dropped. The release asked for
  // with it applied.
  expect(over).toEqual({ codes: ["activation-bound"], rewired: 3, input: "b", victim: undefined });
});

test("consecutive activation cycles are counted afresh after every observation, however many one drain runs", () => {
  const { env, codes } = world(3);
  const a = env.seed<number>({ initial: 0 }), trigger = env.seed<number>({ initial: 0 });
  let computes = 0, seen: number | undefined = 0, budget = 0;
  const f = env.combinator<number>({ inputs: [a], compute: () => ++computes });
  const g = env.effect({ inputs: [f], run: () => {
    const now = a.value();
    if (now !== seen) { seen = now; budget = 3; }
    if (budget-- > 0) env.setInputs(f, [a]);
  } });
  const e = env.effect({ inputs: [trigger], run: context => { if (context.inputs[0].value === 1) for (let i = 1; i <= 3; i++) env.observe(a, i); } });
  const life = new Aborter();
  env.connect(g, life.signal);
  env.connect(e, life.signal);
  env.observe(trigger, 1);
  expect([codes(), a.value()]).toEqual([[], 3]);
  life.abort();
});

test("rewiring a kept input: the same spec node keeps its follower, a new plain spec or spec node takes over, and a shrinking window trims at once", () => {
  const { env } = world();
  const x = env.seed<number>({ initial: 0 });
  const node = env.combinator<number>({ inputs: [{ node: x, demand: { rolling: { entries: 4 } } }], compute: context => context.inputs[0].value as never });
  const token = watch(node);
  for (let i = 1; i <= 5; i++) env.observe(x, i);
  const followers = () => env.allNodes().filter(item => item.name === `demand of ${x.name}`);
  const retained = () => x.entries.map(entry => entry.value);
  expect(retained()).toEqual([2, 3, 4, 5]);
  // A plain spec for another: applied, and the window shrinks at once.
  kernelInternals.setInputsNow(env, node, [{ node: x, demand: { rolling: { entries: 2 } } }]);
  expect(retained()).toEqual([4, 5]);
  // A spec node: followed; the same spec node again keeps the same follower.
  const specA = env.seed<DemandSpec>({ initial: { rolling: { entries: 2 } } });
  env.setInputs(node, [{ node: x, demand: specA }]);
  const follower = followers();
  expect(follower.length).toBe(1);
  env.setInputs(node, [{ node: x, demand: specA }]);
  expect(followers()).toEqual(follower);
  // Another spec node: followed instead.
  const specB = env.seed<DemandSpec>({ initial: { rolling: { entries: 3 } } });
  env.setInputs(node, [{ node: x, demand: specB }]);
  env.observe(x, 6); env.observe(x, 7);
  expect(retained()).toEqual([5, 6, 7]);
  // A plain spec equal to the spec node's: the spec node is no longer followed.
  env.setInputs(node, [{ node: x, demand: { rolling: { entries: 3 } } }]);
  env.observe(specB, { rolling: { entries: 1 } });
  env.observe(x, 8);
  expect(retained()).toEqual([6, 7, 8]);
  expect(followers()).toEqual([]);
  // Back to that spec node: followed again, from its current spec.
  env.setInputs(node, [{ node: x, demand: specB }]);
  env.observe(x, 9);
  expect(retained()).toEqual([9]);
  // An input named twice is demanded once, with the first demand.
  env.setInputs(node, [{ node: x, demand: { rolling: { entries: 2 } } }, { node: x, demand: { latest: true } }]);
  env.observe(x, 10);
  expect(retained()).toEqual([9, 10]);
  token.abort();
});

test("demand and connections asked for and ended within one cycle never start anything; a read during a change or a cycle activates nothing", () => {
  const { env } = world();
  let activations = 0;
  const seed = env.seed<number>({ initial: 1, activate: () => { activations++; } });
  let runs = 0;
  const late = env.effect({ inputs: [seed], run: () => { runs++; } });
  const trigger = env.seed<number>({ initial: 0 });
  const read: unknown[] = [];
  const effect = env.effect({ inputs: [trigger], run: context => {
    if (context.inputs[0].value !== 1) return;
    const token = new Aborter();
    seed.demand(LATEST, token.signal);
    env.connect(late, token.signal);
    token.abort();
    read.push(env.read(seed)?.value);
  } });
  const life = new Aborter();
  env.connect(effect, life.signal);
  env.observe(trigger, 1);
  expect([activations, runs, read]).toEqual([0, 0, [1]]);
  env.change(() => { read.push(env.read(seed)?.value); });
  expect([activations, read]).toEqual([0, [1, 1]]);
  life.abort();
});

test("a run's effect ended before it connects is forgotten; one ended twice in a batch leaves the run's other effects to its end", () => {
  const { env } = world();
  const s = env.seed<number>({ initial: 1 });
  const ended = new Aborter();
  ended.abort();
  let early: KNode | undefined, other: KNode | undefined, twice: KNode | undefined;
  const driver = env.driver({ name: "d", start: run => {
    early = run.effect({ name: "early", inputs: [s], run: () => undefined, signal: ended.signal });
    const soon = new Aborter();
    twice = run.effect({ name: "twice", inputs: [s], run: () => undefined, signal: soon.signal });
    other = run.effect({ name: "other", inputs: [s], run: () => undefined });
    soon.abort();
  } });
  const life = new Aborter();
  driver.start(life.signal);
  expect([env.node(early!.id), env.node(twice!.id), other!.active]).toEqual([undefined, undefined, true]);
  life.abort();
  expect([env.node(other!.id), other!.active]).toEqual([undefined, false]);
});

test("a driver's stream holds its latest run, one entry however often it starts; the tree lists runs and children in start order, a role only when given", () => {
  const { env } = world();
  const driver = env.driver({ name: "d", start: run => { run.spawn("first", () => new Promise<Json>(() => undefined)); run.spawn("second", () => new Promise<Json>(() => undefined)); } });
  const lives = [new Aborter(), new Aborter(), new Aborter()];
  const runs = lives.map(life => driver.start(life.signal));
  expect([driver.value(), driver.entries.length]).toEqual([runs[2].id, 1]);
  const tree = env.processTree();
  const node = tree.children.find(child => child.id === runs[0].id)!;
  expect(node.children.map(child => child.name)).toEqual(["first", "second"]);
  expect(node).toStrictEqual({ id: runs[0].id, name: "d run", status: "running", actor: driver.id, children: node.children });
  for (const life of lives) life.abort();
});

test("with everything retained, a finished child stays finished (its token isn't aborted) when its parent ends", async () => {
  const env = createEnvironment({ clock: simClock(new Scheduler()), retainAll: true });
  let child: Process | undefined;
  let finish: (value: Json) => void = () => undefined;
  const driver = env.driver({ name: "d", start: run => { child = run.spawn("child", () => Promise.resolve(1)); return new Promise<Json>(resolve => { finish = resolve; }); } });
  const run = driver.start(new Aborter().signal);
  await Promise.resolve(); await Promise.resolve();
  expect(child!.status()).toBe("done");
  finish(2);
  await Promise.resolve(); await Promise.resolve();
  expect([run.status(), child!.signal.aborted]).toEqual(["done", false]);
});

test("a spec node's malformed rolling bounds are ignored, and a rolling time window keeps an entry exactly its length old", () => {
  const { env, scheduler } = reported();
  const x = env.seed<number>({ initial: 0 });
  // A count that isn't an integer and a time that isn't a number: each ignored beside a valid other bound.
  const spec = env.seed<DemandSpec>({ initial: { rolling: { entries: "3", ms: 0 } } as never });
  const node = env.combinator<number>({ inputs: [{ node: x, demand: spec }], compute: context => context.inputs[0].value as never });
  const token = watch(node);
  for (let i = 1; i <= 4; i++) { scheduler.advance(1); env.observe(x, i); }
  expect(x.entries.map(entry => entry.value)).toEqual([4]);
  env.observe(spec, { rolling: { entries: 1, ms: "100000" } } as never);
  env.observe(x, 5);
  expect(x.entries.map(entry => entry.value)).toEqual([5]);
  env.observe(spec, { rolling: { ms: 10 } });
  scheduler.advance(1);
  env.observe(x, 6);
  scheduler.advance(10);
  env.observe(x, 7);
  expect(x.entries.map(entry => entry.value)).toEqual([6, 7]);
  token.abort();
});
