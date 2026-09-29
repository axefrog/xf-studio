/**
 * Every internal table of the graph and its kernel is bounded by the live set (deep review 8, STRATA-17 and STRATA-19):
 * after churn that starts and finishes driver runs, creates and deletes nodes, raises, acknowledges and clears
 * conflicts, undoes and redoes, subscribes and unsubscribes and asks for views of the past, every table is back at its
 * size before the churn, and the caches stay within their caps.
 */
import { expect, test } from "bun:test";
import { Aborter } from "strata";
import type { Graph, NodeRef } from "strata";
import { checkTables, tableSizes } from "strata/testing";
import { GROUP, ITEM } from "../src/testing/synthetic";
import { create, drive, harness, ok } from "./helpers";

const tables = (graph: Graph) => tableSizes(graph);

async function churn(graph: Graph, scheduler: Parameters<typeof drive>[0], round: number): Promise<void> {
  // A driver run that finishes, and one that is stopped; the drivers themselves go with the round.
  const roundLife = new Aborter(), stop = new Aborter();
  graph.env.driver({ name: `job ${round}`, start: async () => round }, undefined, roundLife.signal).start();
  graph.env.driver({ name: `held ${round}`, start: () => undefined }, undefined, roundLife.signal).start(stop.signal);
  stop.abort("done");
  const target = create(graph, ITEM, { title: `t${round}`, code: `code-${round}` });
  const holder = create(graph, ITEM, { title: `h${round}`, link: target });
  const fork = ok(graph.commit([{ op: "create", type: ITEM, as: "n", from: { fork: holder } }])).created.n;
  const group = create(graph, GROUP, { label: `g${round}`, members: { a: holder, b: target } });
  // A warning, acknowledged, then gone with what raised it.
  ok(graph.commit([{ op: "trash", node: target }]));
  const warning = graph.conflicts(holder)[0];
  expect(graph.acknowledge(warning.id)).toEqual({ ok: true });
  expect([tables(graph).acknowledgements, tables(graph).conflicts]).toEqual([1, 3]);
  expect(checkTables(graph)).toEqual([]);
  ok(graph.commit([{ op: "restore", node: target }]));
  expect(graph.conflicts(holder, { acknowledged: true })).toEqual([]);
  // Undo, redo and a new commit that ends the redo history.
  ok(graph.commit([{ op: "set", node: holder, path: ["tags", "x"], value: round }]));
  ok(graph.undo()); ok(graph.redo()); ok(graph.undo());
  ok(graph.commit([{ op: "set", node: fork, path: ["title"], value: `f${round}` }]));
  // A subscription that ends, to a node that then goes.
  const watching = new Aborter();
  graph.subscribe(fork, () => undefined, { signal: watching.signal, follows: true });
  await drive(scheduler, graph.flush());
  // Views of the past, more than the cache keeps.
  for (let pos = graph.position - 20; pos <= graph.position; pos++) (await graph.at(pos)).list();
  expect(tables(graph).timeModels).toBe(16);
  expect([tables(graph).commits, tables(graph).onStacks]).toEqual([7, 7]);
  expect([tables(graph).layerRows, tables(graph).refRows > 0, tables(graph).entitySeeds]).toEqual([1, true, 4]);
  expect(checkTables(graph)).toEqual([]);
  watching.abort("done");
  for (const node of [fork, group, holder, target] as NodeRef[]) ok(await drive(scheduler, graph.purge(node, { force: true })));
  graph.forgetHistory();
  await drive(scheduler, graph.flush());
  roundLife.abort("round over");
}

test("every internal table returns to its size before the churn, and the caches stay within their caps", async () => {
  const { graph, scheduler, life } = harness({ store: true });
  await drive(scheduler, graph.load());
  const all = new Aborter();
  graph.subscribeAll(() => undefined, { signal: all.signal });
  await churn(graph, scheduler, 0);
  const before = tables(graph);
  for (let round = 1; round <= 12; round++) await churn(graph, scheduler, round);
  // Every commit is remembered as acknowledged: that set grows with the session (a decision is pending on bounding it).
  const { ackedCommits: _before, ...rest } = before, { ackedCommits: _after, ...now } = tables(graph);
  expect(now).toEqual(rest);
  expect(checkTables(graph, { settled: true })).toEqual([]);
  all.abort("done");
  life.abort();
});
