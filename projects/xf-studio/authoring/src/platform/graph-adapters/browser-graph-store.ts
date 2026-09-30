/**
 * The page's graph store (profiles and graph design §2.7): XF Strata's `GraphStore` over the host transport
 * (`POST <prefix>/store`). The page's graph (G2 onwards) reads and appends through it; `send` is the page's fetch.
 *
 * Compaction and purge are irreversible, so the page can't ask for them (CORE-127): the transport doesn't carry them,
 * and this store refuses them without asking the host. Only the host runs them, through `GraphLibrary.confirmedStore`,
 * after the person confirms and with today's backup taken.
 */
import type { GraphStore } from "strata";

/** The store operations the host transport carries (the host checks the same list). */
export const STORE_OPERATIONS = ["list", "load", "readStream", "append", "changesSince", "counter", "putSnapshot", "dropSnapshots"] as const;
export type StoreOperation = typeof STORE_OPERATIONS[number];
/** The store operations that can't be undone: never carried from the page. */
export const IRREVERSIBLE_OPERATIONS = ["compact", "purge"] as const;
export type IrreversibleOperation = typeof IRREVERSIBLE_OPERATIONS[number];

/** What the page's store answers when asked to compact or purge. */
export const PAGE_IRREVERSIBLE_REFUSAL = "Compacting or permanently deleting can only be done by XF Studio itself, after you confirm it.";

/** The page's graph store: the engine's `GraphStore` over the host transport. */
export class HostGraphStore implements GraphStore {
  constructor(private readonly url: string, private readonly send: (url: string, init: RequestInit) => Promise<Response>) {}
  private async call<T>(op: StoreOperation, ...args: unknown[]): Promise<T> {
    const response = await this.send(this.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, args }) });
    const body = await response.json() as { result?: T; error?: string };
    if (!response.ok) throw new Error(body.error ?? "The graph store failed.");
    return body.result as T;
  }
  list() { return this.call<Awaited<ReturnType<GraphStore["list"]>>>("list"); }
  load() { return this.call<Awaited<ReturnType<GraphStore["load"]>>>("load"); }
  readStream(...args: Parameters<GraphStore["readStream"]>) { return this.call<Awaited<ReturnType<GraphStore["readStream"]>>>("readStream", ...args); }
  append(...args: Parameters<GraphStore["append"]>) { return this.call<Awaited<ReturnType<GraphStore["append"]>>>("append", ...args); }
  changesSince(...args: Parameters<GraphStore["changesSince"]>) { return this.call<Awaited<ReturnType<GraphStore["changesSince"]>>>("changesSince", ...args); }
  counter() { return this.call<number>("counter"); }
  async putSnapshot(...args: Parameters<GraphStore["putSnapshot"]>) { await this.call("putSnapshot", ...args); }
  async dropSnapshots(...args: Parameters<GraphStore["dropSnapshots"]>) { await this.call("dropSnapshots", ...args); }
  async compact(..._args: Parameters<GraphStore["compact"]>): Promise<void> { throw new Error(PAGE_IRREVERSIBLE_REFUSAL); }
  async purge(..._args: Parameters<GraphStore["purge"]>): Promise<void> { throw new Error(PAGE_IRREVERSIBLE_REFUSAL); }
}
