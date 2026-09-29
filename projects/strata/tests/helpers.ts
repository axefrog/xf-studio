/** Shared set-up for the engine's tests: a graph over the synthetic types with simulated, seeded sources. */
import { createGraph, MemoryStore } from "strata";
import type { Graph, GraphOptions, NodeRef } from "strata";
import { Aborter } from "../src/kernel/abort";
import { Scheduler, seededRandom, settle, simClock, SimStore } from "strata/testing";
import { SYNTHETIC_RULES, SYNTHETIC_TYPES } from "../src/testing/synthetic";

export type Harness = { graph: Graph; scheduler: Scheduler; memory?: MemoryStore; store?: SimStore; life: Aborter };

export function harness(options: { readonly store?: boolean; readonly seed?: string; readonly extra?: Partial<GraphOptions> } = {}): Harness {
  const scheduler = new Scheduler();
  const life = new Aborter();
  const memory = options.store ? new MemoryStore() : undefined;
  const store = memory ? new SimStore(memory, scheduler) : undefined;
  const graph = createGraph({ types: SYNTHETIC_TYPES, rules: SYNTHETIC_RULES, sources: { clock: simClock(scheduler), random: seededRandom(options.seed ?? "tests") },
    ...(store ? { store } : {}), signal: life.signal, ...options.extra });
  return { graph, scheduler, memory, store, life };
}

/** Runs pending scheduler events (store replies, timers) until `promise` settles. */
export async function drive<T>(scheduler: Scheduler, promise: Promise<T>, limit = 10_000): Promise<T> {
  let done = false, value: T | undefined, failure: unknown, failed = false;
  promise.then(result => { done = true; value = result; }, error => { done = true; failed = true; failure = error; });
  for (let i = 0; i < limit; i++) {
    await settle();
    if (done) break;
    if (!scheduler.deliver(0)) { await settle(); if (!done) throw new Error("Nothing left to deliver, and the promise is still pending."); }
  }
  if (!done) throw new Error("The promise didn't settle.");
  if (failed) throw failure;
  return value as T;
}

/** Creates a node and returns its reference. */
export function create(graph: Graph, type: string, fields: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): NodeRef {
  const result = graph.commit([{ op: "create", type, as: "n", fields, ...extra } as never]);
  if (!result.ok) throw new Error(`create refused: ${result.reason} ${result.message}`);
  return result.created.n;
}

export function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}
