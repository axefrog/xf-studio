/**
 * The kernel's edges, one behaviour per test: cancellation tokens, node lifetimes and forgetting, observations and
 * transactions, demand specs as data, host demand and connections that end before they begin, drivers whose runs
 * complete or fail, processes that end twice or outlive their parent, the process tree, the stream operators for
 * code (map, filter, scan, combine, flatMap) and the catalogue's operators.
 */
import { expect, test } from "bun:test";
import { AbortedError, Aborter, anySignal, catalogue, combine, createEnvironment, errorValue, filter, flatMap, LATEST, map, scan, standardOperators, StrataSignal, UNCHANGED } from "strata";
import { onAbort } from "../src/kernel/abort";
import type { ComputeContext, DemandSpec, Environment, Json, KEntry, KNode, Process } from "strata";
import { Scheduler, settle, simClock } from "strata/testing";
import { kernelInternals } from "../src/kernel/kernel";

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
const listeners = (signal: unknown) => (signal as { listeners: unknown[] }).listeners.length;
/** Keeps a node demanded (latest) for the rest of the test. */
const watch = (node: KNode, spec: DemandSpec | KNode<DemandSpec> = LATEST) => { const token = new Aborter(); node.demand(spec, token.signal); return token; };

// ---------------------------------------------------------------------------------------------------------------
// Cancellation tokens
// ---------------------------------------------------------------------------------------------------------------

test("a token aborts once, calls listeners in order and then onabort, and throws its reason as an AbortError", () => {
  const aborter = new Aborter();
  const order: string[] = [];
  const first = () => order.push("first"), second = () => order.push("second");
  aborter.signal.addEventListener("abort", first);
  aborter.signal.addEventListener("abort", first);            // the same listener twice: called once
  aborter.signal.addEventListener("abort", second);
  aborter.signal.addEventListener("other" as "abort", () => order.push("other"));
  aborter.signal.onabort = () => order.push("onabort");
  expect(() => aborter.signal.throwIfAborted()).not.toThrow();
  aborter.abort("because");
  aborter.abort("again");
  expect(order).toEqual(["first", "second", "onabort"]);
  expect(aborter.signal.reason).toBe("because");
  expect(() => aborter.signal.throwIfAborted()).toThrow("because");
  try { aborter.signal.throwIfAborted(); } catch (error) { expect(error).toBeInstanceOf(AbortedError); expect((error as AbortedError).name).toBe("AbortError"); }
  // A reason that isn't text gives a plain message and keeps the reason.
  const other = new Aborter();
  other.abort({ code: 7 });
  try { other.signal.throwIfAborted(); } catch (error) { expect((error as Error).message).toBe("Aborted."); expect((error as AbortedError).reason).toEqual({ code: 7 }); }
  // Listening to an aborted token never calls back.
  aborter.signal.addEventListener("abort", () => order.push("late"));
  expect(order).toEqual(["first", "second", "onabort"]);
});

test("a signal fires once even when fired directly twice, and removed listeners are not called", () => {
  const signal = new StrataSignal();
  const calls: string[] = [];
  const listener = () => calls.push("a");
  signal.addEventListener("abort", listener);
  signal.addEventListener("abort", () => calls.push("b"));
  signal.removeEventListener("other" as "abort", listener);   // another event type: nothing removed
  signal.removeEventListener("abort", listener);
  signal.fire("first");
  signal.fire("second");
  expect(calls).toEqual(["b"]);
  expect(signal.reason).toBe("first");
});

test("chained tokens: a child aborts with its parent's reason, at once if the parent already has; release unlinks without aborting", () => {
  const parent = new Aborter(), other = new Aborter();
  const child = new Aborter(parent.signal, undefined, null, other.signal);
  expect(listeners(parent.signal)).toBe(1);
  parent.abort("parent's");
  expect(child.signal.reason).toBe("parent's");
  expect(listeners(other.signal)).toBe(0);   // aborting unlinks from the other parents
  const late = new Aborter(parent.signal);
  expect(late.signal.aborted).toBe(true);
  expect(late.signal.reason).toBe("parent's");
  const root = new Aborter(), kept = new Aborter(root.signal);
  kept.release();
  expect(listeners(root.signal)).toBe(0);
  root.abort("gone");
  expect(kept.signal.aborted).toBe(false);
  // anySignal aborts when any of its signals does; a default reason is "aborted".
  const a = new Aborter(), b = new Aborter();
  const any = anySignal(a.signal, b.signal);
  b.abort();
  expect(any.aborted).toBe(true);
  expect(any.reason).toBe("aborted");
});

// ---------------------------------------------------------------------------------------------------------------
// Nodes: creation, lifetime, observation
// ---------------------------------------------------------------------------------------------------------------

test("nodes take their ID as their name, or a kind name when anonymous; anonymous IDs count per environment", () => {
  const { env } = world();
  const seed = env.seed();
  const named = env.seed({ id: "x" });
  const combinator = env.combinator({ inputs: [seed], compute: () => 1 });
  const effect = env.effect({ inputs: [seed], run: () => undefined });
  expect([seed.name, named.name, combinator.name, effect.name]).toEqual(["seed", "x", "combinator", "effect"]);
  expect(seed.id).toBe("seed#1");
  expect(createEnvironment({ clock: simClock(new Scheduler()) }).seed().id).toBe("seed#1");
  expect(() => env.seed({ id: "x" })).toThrow("already exists");
});

test("only seeds and processes are observed", () => {
  const { env } = world();
  const seed = env.seed<number>({ initial: 1 });
  const combinator = env.combinator({ inputs: [seed], compute: context => context.inputs[0].value });
  expect(() => env.observe(combinator as never, 2)).toThrow("Only seeds and processes are observed.");
});

test("a node created with an aborted token is forgotten at once; forgetting twice never forgets a later node with the same ID", () => {
  const { env } = world();
  const gone = new Aborter();
  gone.abort();
  env.seed({ id: "early", signal: gone.signal });
  expect(env.node("early")).toBeUndefined();
  const token = new Aborter();
  const first = env.seed({ id: "x", signal: token.signal });
  env.change(() => kernelInternals.removeNow(env, first));
  expect(env.node("x")).toBeUndefined();
  const second = env.seed({ id: "x" });
  token.abort();
  expect(env.node("x")).toBe(second);
});

test("nested transactions make one cycle when the outermost ends", () => {
  const { env, stream } = world();
  const a = env.seed<number>({ initial: 0 }), b = env.seed<number>({ initial: 0 });
  const sum = env.combinator<number>({ inputs: [a, b], compute: context => (context.inputs[0].value as number ?? 0) + (context.inputs[1].value as number ?? 0) });
  watch(sum);
  const before = env.cycle;
  env.transaction(() => {
    env.observe(a, 1);
    env.transaction(() => env.observe(b, 2));
    expect(env.cycle).toBe(before);
  });
  expect(env.cycle).toBe(before + 1);
  expect(stream(sum)).toEqual([0, 3]);
  // A transaction that observes nothing runs no cycle.
  env.transaction(() => undefined);
  expect(env.cycle).toBe(before + 1);
});

test("a seed whose activation fails reports it on the error seed with a code, and the seed stays usable", () => {
  const { env, codes, stream } = world();
  const seed = env.seed<number>({ initial: 1, activate: () => { throw new Error("no device"); } });
  const token = watch(seed);
  expect(codes()).toEqual(["activation"]);
  env.observe(seed, 2);
  expect(stream(seed)).toEqual([1, 2]);
  token.abort();
});

test("an activation's observe after its seed went dormant is ignored", () => {
  const { env, stream } = world();
  let later: ((value: number) => void) | undefined;
  const seed = env.seed<number>({ activate: ({ observe }) => { later = observe; observe(1); } });
  const token = watch(seed);
  expect(stream(seed)).toEqual([1]);
  token.abort();
  later!(2);
  expect(stream(seed)).toEqual([1]);
});

test("a thrown value that isn't an Error becomes a message; anything else becomes Failed.", () => {
  const { env, stream, codes } = world();
  const seed = env.seed<number>({ initial: 1 });
  const text = env.combinator({ inputs: [seed], compute: () => { throw "plain text"; } });
  const other = env.combinator({ inputs: [seed], compute: () => { throw 42; } });
  watch(text); watch(other);
  expect(stream(text)).toEqual([{ error: "plain text" }]);
  expect(stream(other)).toEqual([{ error: "Failed." }]);
  // An error value with extra members, returned rather than thrown, keeps them.
  const coded = env.combinator({ inputs: [seed], compute: () => errorValue("coded", { code: "c", data: { n: 1 } }) });
  watch(coded);
  expect(coded.latest()?.error).toEqual({ message: "coded", code: "c", data: { n: 1 } });
  const plain = env.combinator({ inputs: [seed], compute: () => errorValue("plain") });
  watch(plain);
  expect(plain.latest()?.error).toEqual({ message: "plain" });
  expect(codes()).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------
// Demand specs
// ---------------------------------------------------------------------------------------------------------------

test("a spec node's value that isn't a valid spec reads as latest; ranges with an end and queries are honoured as specs", () => {
  const { env } = world();
  const source = env.seed<number>({ initial: 1 });
  for (let i = 2; i <= 6; i++) env.observe(source, i);
  const spec = env.seed<DemandSpec>({ initial: { range: { from: 2, to: 4 } } });
  const window = env.combinator<Json>({ inputs: [{ node: source, demand: spec }], compute: context => context.inputs[0].window.map(entry => entry.value as Json) });
  const token = watch(window);
  // Retained before the demand began: a range reads what is still held.
  expect(window.value()).toEqual([]);
  env.observe(source, 7);
  const shown = () => window.value();
  for (const [value, expected] of [
    [{ range: { from: 7, to: 8 } }, [7]],
    [{ rolling: { entries: 1 } }, [7]],
    [{ query: { anything: true } }, [7]],        // a query the producer doesn't know reads as latest
    [{ latest: true }, [7]],
    [null, [7]],
    ["nonsense", [7]],
    [{ range: { from: "x" } }, [7]],
    [{ range: { from: 1, to: "y" } }, [7]],
    [{ rolling: { entries: "many" } }, [7]],
    [{ entry: 7 }, [7]],
  ] as [unknown, Json][]) {
    env.observe(spec, value as DemandSpec);
    expect([value, shown()]).toEqual([value, expected]);
  }
  env.observe(spec, { rolling: { ms: 1000 } });
  env.observe(source, 8);
  expect(shown()).toEqual([7, 8]);
  token.abort();
});

test("a rolling window by time keeps what is recent, and entries fall out as time passes", () => {
  const { env, scheduler } = world();
  const source = env.seed<number>({ initial: 1 });
  const window = env.combinator<Json>({ inputs: [{ node: source, demand: { rolling: { ms: 100 } } }], compute: context => context.inputs[0].window.map(entry => entry.value as Json) });
  const token = watch(window);
  scheduler.advance(60);
  env.observe(source, 2);
  scheduler.advance(60);
  env.observe(source, 3);
  expect(window.value()).toEqual([2, 3]);
  expect(source.entries.map(entry => entry.seq)).toEqual([2, 3]);
  token.abort();
});

test("an input given without a demand is read with latest; changing only the spec node of a kept input keeps its edge", () => {
  const { env, stream } = world();
  const source = env.seed<number>({ initial: 1 });
  const spec = env.seed<DemandSpec>({ initial: { rolling: { entries: 2 } } });
  const other = env.seed<DemandSpec>({ initial: { rolling: { entries: 3 } } });
  const node = env.combinator<Json>({ inputs: [{ node: source }], compute: context => context.inputs[0].window.length });
  const keep = watch(source, { rolling: { entries: 3 } });
  const token = watch(node);
  expect(node.inputs[0].demand).toBe(LATEST);
  env.observe(source, 2); env.observe(source, 3);
  env.setInputs(node, [{ node: source, demand: spec }]);
  expect(node.value()).toBe(2);
  // The same spec node again: nothing to follow anew.
  env.setInputs(node, [{ node: source, demand: spec }]);
  env.setInputs(node, [{ node: source, demand: other }]);
  expect(node.value()).toBe(3);
  // The same spec as data twice: the edge is left as it is.
  env.setInputs(node, [{ node: source, demand: { rolling: { entries: 1 } } }]);
  env.setInputs(node, [{ node: source, demand: { rolling: { entries: 1 } } }]);
  expect(node.value()).toBe(1);
  expect(stream(node)).toEqual([1, 2, 3, 1]);
  const before = env.allNodes().length;
  token.abort();
  keep.abort();
  expect(env.allNodes().length).toBe(before);
});

test("host demand and connections whose token ends before they are applied never begin", () => {
  const { env } = world();
  const seed = env.seed<number>({ initial: 1 });
  const target = env.combinator({ inputs: [seed], compute: context => context.inputs[0].value });
  const recorder = env.effect({ inputs: [target], run: () => undefined });
  const done = new Aborter();
  done.abort();
  target.demand(LATEST, done.signal);
  env.connect(recorder, done.signal);
  expect(target.active).toBe(false);
  // Asked for during a cycle, then ended in the same cycle: applied after it, and skipped.
  const trigger = env.seed<number>({ initial: 0 });
  const effect = env.effect({ inputs: [trigger], run: () => {
    const token = new Aborter();
    target.demand(LATEST, token.signal);
    env.connect(recorder, token.signal);
    token.abort();
  } });
  const life = new Aborter();
  env.connect(effect, life.signal);
  env.observe(trigger, 1);
  expect(target.active).toBe(false);
  expect(recorder.active).toBe(false);
  life.abort();
});

test("an effect connected twice stays connected once; disconnecting a dormant effect is harmless", () => {
  const { env } = world();
  const seed = env.seed<number>({ initial: 1 });
  let runs = 0;
  const effect = env.effect({ inputs: [seed], run: () => { runs++; } });
  const a = new Aborter(), b = new Aborter();
  env.connect(effect, a.signal);
  env.connect(effect, b.signal);
  expect(runs).toBe(1);
  a.abort();
  expect(effect.active).toBe(false);
  b.abort();
  expect(effect.active).toBe(false);
});

test("an environment that retains everything keeps every entry and finished processes", async () => {
  const { env } = world({ retainAll: true });
  const seed = env.seed<number>({ initial: 1 });
  const node = env.combinator<number>({ inputs: [seed], compute: context => (context.inputs[0].value as number ?? 0) * 2 });
  const token = watch(node);
  env.observe(seed, 2); env.observe(seed, 3);
  token.abort();
  expect(seed.entries.length).toBe(3);
  expect(node.entries.length).toBe(3);
  const process = env.spawn("quick", async () => 1);
  await settle();
  expect(process.status()).toBe("done");
  expect(env.root.children).toContain(process);
  expect(env.node(process.id)).toBe(process);
  // A single seed that retains everything in an ordinary environment.
  const plain = createEnvironment({ clock: simClock(new Scheduler()) });
  const kept = plain.seed<number>({ initial: 0, retainAll: true });
  const reader = plain.combinator({ inputs: [kept], compute: context => context.inputs[0].value });
  const watching = watch(reader);
  for (let i = 1; i < 5; i++) plain.observe(kept, i);
  watching.abort();
  expect(kept.entries.length).toBe(5);
});

// ---------------------------------------------------------------------------------------------------------------
// Drivers, runs and processes
// ---------------------------------------------------------------------------------------------------------------

test("a driver whose definition completes ends its run done with the result (null for none); one that fails ends it failed", async () => {
  const { env, stream } = world();
  const done = env.driver({ name: "done", start: async () => ({ ok: 1 }) });
  const empty = env.driver({ name: "empty", start: async () => undefined });
  const failing = env.driver({ name: "failing", start: async () => { throw new Error("broke"); } });
  const throwing = env.driver({ name: "throwing", start: () => { throw new Error("at once"); } });
  const runs = [done.start(), empty.start(), failing.start(), throwing.start()];
  await settle();
  expect(runs.map(run => stream(run).at(-1))).toEqual([
    { status: "done", result: { ok: 1 } }, { status: "done", result: null },
    { status: "failed", error: { message: "broke" } }, { status: "failed", error: { message: "at once" } },
  ]);
  expect(env.root.children.length).toBe(0);
});

test("a run started with an aborted token ends aborted at once; an effect whose run or token already ended is never connected", async () => {
  const { env, stream } = world();
  const seed = env.seed<number>({ initial: 1 });
  let runs = 0;
  const gone = new Aborter();
  gone.abort("never");
  const driver = env.driver({ name: "d", start(run) { run.effect({ inputs: [seed], run: () => { runs++; }, signal: gone.signal }); } });
  const token = new Aborter();
  const run = driver.start(token.signal);
  expect(runs).toBe(0);
  token.abort("stop");
  const early = new Aborter();
  early.abort("before");
  const never = driver.start(early.signal);
  await settle();
  expect(stream(never)).toEqual([{ status: "running" }, { status: "aborted", reason: "before" }]);
  expect(stream(run).at(-1)).toEqual({ status: "aborted", reason: "stop" });
  expect(env.allNodes().filter(node => node.kind === "effect").length).toBe(0);
});

test("a run's effect whose own token ends first is forgotten then, and again harmlessly when the run ends", () => {
  const { env } = world();
  const seed = env.seed<number>({ initial: 1 });
  const own = new Aborter();
  let effect: KNode | undefined;
  const driver = env.driver({ name: "d", start(run) { effect = run.effect({ inputs: [seed], run: () => undefined, signal: own.signal }); } });
  const token = new Aborter();
  driver.start(token.signal);
  expect(effect!.active).toBe(true);
  own.abort();
  expect(effect!.active).toBe(false);
  expect(env.node(effect!.id)).toBeUndefined();
  token.abort();
  expect(seed.active).toBe(false);
});

test("a run's child driver starts under the run by default, in a role, and the tree shows actors, members and roles", () => {
  const { env } = world();
  const inner = env.driver({ name: "inner", members: ["a", "b"], start: () => undefined }, "inner-actor");
  let child: Process | undefined;
  const outer = env.driver({ name: "outer", start(run) { child = run.start(inner); run.start(inner, { role: "helper" }); } }, "outer-actor");
  const token = new Aborter();
  const run = outer.start(token.signal);
  const tree = env.processTree();
  const node = tree.children.find(item => item.id === run.id)!;
  expect(node.actor).toBe("outer-actor");
  expect(node.children.map(item => [item.actor, item.members, item.role ?? null])).toEqual([["inner-actor", ["a", "b"], null], ["inner-actor", ["a", "b"], "helper"]]);
  expect(child!.parent).toBe(run);
  token.abort();
  expect(env.processTree().children).toEqual([]);
});

test("a process spawned during a cycle is pending until the cycle ends; spawn defaults to the root", async () => {
  const { env } = world();
  const seed = env.seed<number>({ initial: 0 });
  let during: string | undefined, process: Process | undefined;
  const effect = env.effect({ inputs: [seed], run: context => {
    if (context.inputs[0].value !== 1) return;
    process = env.spawn("later", () => new Promise<Json>(() => undefined));
    during = env.processTree().children.find(item => item.id === process!.id)?.status;
  } });
  const life = new Aborter();
  env.connect(effect, life.signal);
  env.observe(seed, 1);
  expect(during).toBe("pending");
  expect(process!.parent).toBe(env.root);
  expect(process!.status()).toBe("running");
  process!.abort();
  await settle();
  expect(process!.value()).toEqual({ status: "aborted", reason: "aborted" });
  life.abort();
});

test("a finished process ignores a later abort; a child that already finished is left alone when its parent ends", async () => {
  const { env, scheduler, stream } = world();
  let child: Process | undefined;
  const parent = env.spawn("parent", signal => new Promise<Json>(resolve => env.clock.after(50, () => resolve("p"), signal)));
  child = env.spawn("child", signal => new Promise<Json>(resolve => env.clock.after(10, () => resolve("c"), signal)), parent);
  scheduler.advance(20);
  await settle();
  expect(stream(child)).toEqual([{ status: "running" }, { status: "done", result: "c" }]);
  scheduler.advance(40);
  await settle();
  expect(stream(parent)).toEqual([{ status: "running" }, { status: "done", result: "p" }]);
  expect(stream(child).length).toBe(2);
  parent.abort("too late");
  child.abort("too late");
  expect(stream(parent).length).toBe(2);
  // A result that isn't plain data is carried as text.
  const odd = env.spawn("odd", async () => ({ toJSON() { throw new Error("no"); } }) as unknown as Json);
  await settle();
  expect((odd.value() as { status: string; result: Json }).result).toBe("[object Object]");
  // Progress reported after the end is ignored.
  let report: ((progress: Json) => void) | undefined;
  const reporter = env.spawn("reporter", async (_signal, progress) => { report = progress; return 1; });
  await settle();
  report!("late");
  expect(stream(reporter).map(state => (state as { status: string }).status)).toEqual(["running", "done"]);
});

test("a token as a node reads false, then true when it aborts", () => {
  const { env, stream } = world();
  const token = new Aborter();
  const node = env.signalNode(token.signal);
  expect(node.name).toBe("aborted");
  const reader = env.combinator({ inputs: [node], compute: context => context.inputs[0].value });
  watch(reader);
  token.abort();
  expect(stream(reader)).toEqual([false, true]);
  const done = new Aborter();
  done.abort();
  expect(env.signalNode(done.signal, "done").value()).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------
// Stream operators for code, and the catalogue's operators
// ---------------------------------------------------------------------------------------------------------------

test("map, filter and combine pass errors through and wait for a first entry", () => {
  const { env, stream } = world();
  const source = env.seed<number>();
  const doubled = map(env, source, value => value * 2);
  const even = filter(env, source, value => value % 2 === 0);
  const both = combine(env, [source, doubled]);
  for (const node of [doubled, even, both]) watch(node);
  expect([doubled.name, even.name, both.name]).toEqual(["map", "filter", "combine"]);
  expect(both.value()).toEqual([null, null]);
  env.observe(source, 1);
  env.observe(source, 2);
  expect(stream(doubled)).toEqual([2, 4]);
  expect(stream(even)).toEqual([2]);
  const failing = map(env, source, value => { if (value > 2) throw new Error("too big"); return value; }, "fragile");
  const after = map(env, failing, value => value + 1);
  const kept = filter(env, failing, () => true);
  const joined = combine(env, [failing, source]);
  for (const node of [after, kept, joined]) watch(node);
  env.observe(source, 3);
  expect(after.latest()?.error?.message).toBe("too big");
  expect(kept.latest()?.error?.message).toBe("too big");
  expect(joined.latest()?.error?.message).toBe("too big");
});

test("scan folds every entry appended in a cycle, starts from the latest when first primed, and skips errors", () => {
  const { env } = world();
  const source = env.seed<number>({ initial: 5 });
  const total = scan(env, source, 0, (sum, value) => sum + value);
  const token = watch(total);
  expect(total.value()).toBe(5);
  env.transaction(() => { env.observe(source, 1); env.observe(source, 2); });
  expect(total.value()).toBe(8);
  // Primed again after dormancy: nothing new to fold.
  token.abort();
  env.observe(source, 100);
  watch(total);
  expect(total.value()).toBe(8);
  const empty = scan(env, env.seed<number>(), 10, (sum, value) => sum + value, "empty");
  watch(empty);
  expect(empty.value()).toBe(10);
  const flaky = map(env, source, value => { if (value === 3) throw new Error("three"); return value; });
  const summed = scan(env, flaky, 0, (sum, value) => sum + value);
  watch(summed);
  env.observe(source, 3);
  expect(summed.latest()?.error?.message).toBe("three");
});

test("flatMap follows the node its outer value chooses, rewiring as the choice changes", () => {
  const { env, stream } = world();
  const a = env.seed<number>({ initial: 1 }), b = env.seed<number>({ initial: 10 });
  const choice = env.seed<string>();
  const failing = map(env, a, value => { if (value > 1) throw new Error("bad a"); return value; });
  const inner = flatMap(env, choice, value => value === "a" ? a : value === "f" ? failing : b);
  watch(inner);
  expect(inner.name).toBe("flatMap");
  expect(stream(inner)).toEqual([]);
  env.observe(choice, "a");
  expect(inner.value()).toBe(1);
  env.observe(a, 2);
  expect(inner.value()).toBe(2);
  env.observe(choice, "b");
  expect(inner.value()).toBe(10);
  env.observe(choice, "f");
  expect(inner.latest()?.error?.message).toBe("bad a");
  const outerError = map(env, a, () => { throw new Error("outer"); });
  const chained = flatMap(env, outerError, () => b);
  watch(chained);
  expect(chained.latest()?.error?.message).toBe("outer");
  // An inner node with no entry yet leaves the output unchanged.
  const blank = env.seed<number>();
  const toBlank = flatMap(env, env.seed<number>({ initial: 0 }), () => blank);
  watch(toBlank);
  expect(stream(toBlank)).toEqual([]);
});

test("the catalogue takes plain operator names only; the catalogue's operators handle missing inputs and paths", () => {
  expect(() => catalogue({ "not a name": standardOperators.seed })).toThrow("not a plain identifier");
  expect(() => catalogue({ "": standardOperators.seed })).toThrow();
  expect(Object.keys(catalogue(standardOperators, { "my:op.v1-2": standardOperators.identity }))).toContain("my:op.v1-2");
  const { env } = world();
  const api = { id: "t", env, node: () => undefined, run: undefined as never };
  const make = (name: string, params?: Json) => (standardOperators[name] as { create(params: Json | undefined, api: never): (context: ComputeContext) => unknown }).create(params, api as never);
  const view = (value?: Json, extra: Partial<ComputeContext["inputs"][number]> = {}) => ({
    node: undefined as never, latest: value === undefined ? undefined : { seq: 1, cycle: 1, at: 0, value }, value, changed: true,
    fresh: value === undefined ? [] : [{ seq: 1, cycle: 1, at: 0, value }], window: value === undefined ? [] : [{ seq: 1, cycle: 1, at: 0, value }], ...extra });
  const context = (inputs: ReturnType<typeof view>[], previous?: Json): ComputeContext =>
    ({ inputs, ...(previous !== undefined ? { previous: { seq: 1, cycle: 1, at: 0, value: previous } } : {}), cycle: 1, at: 0, env });
  expect(make("pick", { path: ["a", "b"] })(context([view({ a: { b: 3 } })]))).toBe(3);
  expect(make("pick", { path: ["a", "b"] })(context([view({ a: 1 })]))).toBe(UNCHANGED);
  expect(make("pick", { path: ["x"] })(context([view(null)]))).toBe(UNCHANGED);
  expect(make("pick")(context([view(4)]))).toBe(4);
  expect(make("pick", { path: [] })(context([]))).toBe(UNCHANGED);
  expect(make("identity")(context([view()]))).toBe(UNCHANGED);
  expect(make("identity")(context([]))).toBe(UNCHANGED);
  expect(make("scan-sum")(context([view(2)]))).toBe(2);
  expect(make("scan-sum")(context([view(2, { changed: false })], 5))).toBe(5);
  expect(make("scan-sum")(context([view(undefined, { changed: false })]))).toBe(0);
  expect(make("scan-sum")(context([view(2, { changed: false })]))).toBe(2);
  expect(make("scan-sum")(context([view("x" as Json)], 1))).toBe(1);
  expect(make("collect")(context([view(undefined, { window: [{ seq: 1, cycle: 1, at: 0 }] })]))).toEqual([null]);
  expect(make("combine")(context([view(), view(1)]))).toEqual([null, 1]);
  expect(make("threshold", { at: 2 })(context([view("x" as Json)]))).toBe(false);
  expect(make("threshold")(context([]))).toBe(true);
  expect(make("sum", [] as never)(context([view(1)]))).toBe(1);
  // Errors on any input pass through every guarded operator.
  const failed = view(undefined, { error: { message: "bad" }, latest: { seq: 1, cycle: 1, at: 0, error: { message: "bad" } } });
  for (const name of ["identity", "sum", "product", "pick", "scan-sum", "collect", "combine", "threshold"])
    expect([name, (make(name, { path: [] }) (context([failed])) as { error?: { message: string } }).error?.message]).toEqual([name, "bad"]);
});

test("a state machine: only its own states and events count, guards read their inputs, and inputs default to none", () => {
  const { env } = world();
  const api = { id: "m", env, node: () => undefined, run: undefined as never };
  const machine = (params: Json) => (standardOperators["state-machine"] as { create(params: Json, api: never): (context: ComputeContext) => unknown }).create(params, api as never);
  const input = (changed: boolean, value?: Json) => ({ node: undefined as never, latest: value === undefined ? undefined : { seq: 1, cycle: 1, at: 0, value }, value, changed, fresh: [], window: [] });
  const at = (state: string, ...inputs: ReturnType<typeof input>[]): ComputeContext => ({ inputs, previous: { seq: 1, cycle: 1, at: 0, value: { state } }, cycle: 1, at: 0, env });
  const spec = { initial: "idle", inputs: ["go", "ready"], states: { idle: { on: { go: { target: "busy", guard: "ready", effects: ["start"] } } }, busy: { on: { go: { target: "idle" } } } } };
  const run = machine(spec as Json);
  expect(run({ inputs: [], cycle: 1, at: 0, env })).toEqual({ state: "idle" });
  expect(run(at("idle", input(true, 1), input(false, false)))).toBe(UNCHANGED);
  expect(run(at("idle", input(true, 1), input(false, true)))).toEqual({ state: "busy", from: "idle", event: "go", effects: ["start"] });
  // No effects: no effects member at all.
  expect(run(at("busy", input(true, 1), input(false)))).toStrictEqual({ state: "idle", from: "busy", event: "go" });
  expect(run(at("idle", input(false, 1), input(true, true)))).toBe(UNCHANGED);
  expect(run(at("toString", input(true, 1)))).toBe(UNCHANGED);
  expect(run(at("idle", input(true, 1), input(false, true), input(true, 1)))).toEqual({ state: "busy", from: "idle", event: "go", effects: ["start"] });
  // An input the machine doesn't name is no event, even where a state has an event called "undefined".
  const odd = machine({ initial: "idle", inputs: ["go"], states: { idle: { on: { undefined: { target: "odd" } } } } } as Json);
  expect(odd(at("idle", input(false, 1), input(true, 1)))).toBe(UNCHANGED);
  const bare = machine({ initial: "only", states: { only: { on: { x: { target: 5 } } } } } as unknown as Json);
  expect(bare(at("only", input(true, 1)))).toBe(UNCHANGED);
});

test("an effect's environment is the one it runs in; computations see the cycle's number and time", () => {
  const { env, scheduler } = world();
  const seed = env.seed<number>({ initial: 1 });
  const seen: [number, number, Environment][] = [];
  const node = env.combinator({ inputs: [seed], compute: context => { seen.push([context.cycle, context.at, context.env]); return context.inputs[0].value; } });
  watch(node);
  scheduler.advance(7);
  env.observe(seed, 2);
  expect(seen.at(-1)).toEqual([env.cycle, scheduler.epoch + 7, env]);
});

test("reading a node during a cycle returns its latest without activating it", () => {
  const { env } = world();
  const seed = env.seed<number>({ initial: 3 });
  const dormant = env.combinator<number>({ inputs: [seed], compute: context => (context.inputs[0].value as number ?? 0) + 1 });
  let read: KEntry<number> | undefined;
  const trigger = env.seed<number>({ initial: 0 });
  const effect = env.effect({ inputs: [trigger], run: () => { read = env.read(dormant); } });
  const life = new Aborter();
  env.connect(effect, life.signal);
  expect(read).toBeUndefined();
  expect(dormant.active).toBe(false);
  expect(env.read(dormant)?.value).toBe(4);
  expect(dormant.active).toBe(false);
  life.abort();
});

/** A host-like signal that honours `once` the way an EventTarget does, and counts what it still holds. */
class HostSignal {
  aborted = false; reason: unknown = undefined;
  held: { listener: () => void; once: boolean }[] = [];
  addEventListener(_type: "abort", listener: () => void, options?: { readonly once?: boolean }): void { this.held.push({ listener, once: !!options?.once }); }
  removeEventListener(_type: "abort", listener: () => void): void { this.held = this.held.filter(item => item.listener !== listener); }
  fire(reason: unknown): void {
    this.aborted = true; this.reason = reason;
    for (const item of [...this.held]) { if (item.once) this.removeEventListener("abort", item.listener); item.listener(); }
  }
}
const listenersOf = (signal: unknown) => (signal as { listeners: unknown[] }).listeners.length;

test("tokens leave nothing behind: a fired signal drops its listeners, an aborted parent links no later parent, a one-time watch leaves a host signal", () => {
  const token = new Aborter();
  const seen: string[] = [];
  const listener = () => seen.push("abort");
  token.signal.addEventListener("abort", listener);
  // Only the abort type is a cancellation listener: removing another type's leaves it.
  token.signal.removeEventListener("other" as "abort", listener);
  token.abort("done");
  expect([seen, listenersOf(token.signal)]).toEqual([["abort"], 0]);
  const gone = new Aborter();
  gone.abort("early");
  const live = new Aborter();
  const child = new Aborter(gone.signal, live.signal);
  expect([child.signal.aborted, child.signal.reason, listenersOf(live.signal)]).toEqual([true, "early", 0]);
  const host = new HostSignal();
  onAbort(host, () => seen.push("host"));
  host.fire("stop");
  expect([seen, host.held.length]).toEqual([["abort", "host"], 0]);
});

test("flatMap reading an inner node that has no entry yet leaves its output unchanged, however often the outer value repeats", () => {
  const { env, stream } = world();
  const outer = env.seed<number>({ initial: 0 });
  const blank = env.seed<number>();
  const node = flatMap(env, outer, () => blank);
  watch(node);
  env.observe(outer, 1);
  env.observe(outer, 2);
  expect(stream(node)).toEqual([]);
  env.observe(blank, 7);
  expect(stream(node)).toEqual([7]);
});
