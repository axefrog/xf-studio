/**
 * This engine's own policies, beyond what the rules require: memory stays bounded (an active node keeps only what its
 * demand covers, a node going dormant lets go of its history), queued changes and observations keep their order, a
 * failing wiring change is reported and the rest still apply, and the activation bound counts consecutive activation
 * cycles only.
 */
import { expect, test } from "bun:test";
import { Aborter, createEnvironment, LATEST } from "strata";
import type { DemandSpec, KEntry, KNode } from "strata";
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
