/**
 * The page's graph store (profiles and graph design §2.7): XF Strata's `GraphStore` over the host transport
 * (`POST <prefix>/store`). The page's graph (G2 onwards) reads and appends through it; `send` is the page's fetch.
 */
import type { GraphStore } from "strata";

/** The store operations the host transport carries (the host checks the same list). */
export const STORE_OPERATIONS = ["list", "load", "readStream", "append", "changesSince", "counter", "putSnapshot", "dropSnapshots", "compact", "purge"] as const;
export type StoreOperation = typeof STORE_OPERATIONS[number];

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
  async compact(...args: Parameters<GraphStore["compact"]>) { await this.call("compact", ...args); }
  async purge(...args: Parameters<GraphStore["purge"]>) { await this.call("purge", ...args); }
}
