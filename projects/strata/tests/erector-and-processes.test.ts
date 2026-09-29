/**
 * More of the erector and processes: a model in another format, seed operators with an activation, and a process's
 * progress reports while it runs and after it ends.
 */
import { expect, test } from "bun:test";
import { Aborter, createEnvironment, erector, standardOperators } from "strata";
import type { DemandSpec, Environment, GraphModel, Json, KEntry, KNode, Operators } from "strata";
import { Scheduler, settle, simClock } from "strata/testing";

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
const watch = (node: KNode, spec: DemandSpec = { latest: true }) => { const token = new Aborter(); node.demand(spec, token.signal); return token; };
const erect = (env: Environment, model: KNode<GraphModel>, operators: Operators = standardOperators) => {
  const built = erector(env, model, operators);
  const token = new Aborter();
  built.driver.start(token.signal);
  return { ...built, token };
};

test("a model in another format is refused whole with the code schema, keeping what was erected; one without a format is read", () => {
  const { env, codes } = world();
  const model = env.seed<GraphModel>({ initial: { nodes: [{ id: "a", kind: "seed", initial: 1 }] } });
  const built = erect(env, model);
  const a = built.live("a");
  expect(a?.value()).toBe(1);
  env.observe(model, { schema: "xf-strata/graph-model/9", nodes: [{ id: "b", kind: "seed", initial: 2 }] } as unknown as GraphModel);
  expect(codes()).toEqual(["schema"]);
  expect([built.live("a"), built.live("b")]).toEqual([a, undefined]);
  env.observe(model, { schema: "xf-strata/graph-model/1", nodes: [{ id: "b", kind: "seed", initial: 2 }] });
  expect([codes(), built.live("a"), built.live("b")?.value()]).toEqual([["schema"], undefined, 2]);
  built.token.abort();
});

test("a seed operator's activation runs while its erected seed is demanded, and ends with that demand", () => {
  const { env } = world();
  const log: string[] = [];
  const operators: Operators = { ...standardOperators, ticker: { kind: "seed", create: () => ({ activate: ({ signal, observe }) => {
    log.push("on"); observe(7); signal.addEventListener("abort", () => log.push("off"));
  } }) } };
  const model = env.seed<GraphModel>({ initial: { nodes: [{ id: "t", kind: "seed", op: "ticker", initial: 0 }] } });
  const built = erect(env, model, operators);
  const node = built.live("t")!;
  expect(log).toEqual([]);
  const demand = watch(node);
  expect([log, node.value()]).toEqual([["on"], 7]);
  demand.abort();
  expect(log).toEqual(["on", "off"]);
  built.token.abort();
});

test("a process's progress reports are its entries while it runs; reports after it ends or aborts are dropped", async () => {
  const { env, stream } = world({ retainAll: true });
  let report!: (progress: Json) => void;
  let finish!: (value: Json) => void;
  const process = env.spawn("work", (_signal, r) => { report = r; return new Promise<Json>(resolve => { finish = resolve; }); });
  const demand = watch(process as unknown as KNode);
  await settle();
  report(1); report({ step: 2 });
  await settle();
  finish("ok");
  await settle();
  report(3);
  await settle();
  expect(stream(process as unknown as KNode)).toEqual([{ status: "running" }, { status: "progress", progress: 1 }, { status: "progress", progress: { step: 2 } }, { status: "done", result: "ok" }]);
  let late!: (progress: Json) => void;
  const aborted = env.spawn("aborted", (_signal, r) => { late = r; return new Promise<Json>(() => undefined); });
  const demand2 = watch(aborted as unknown as KNode);
  await settle();
  aborted.abort("stop");
  late(4);
  await settle();
  expect(stream(aborted as unknown as KNode).map(entry => (entry as { status: string }).status)).toEqual(["running", "aborted"]);
  demand.abort(); demand2.abort();
});
