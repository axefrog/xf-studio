/**
 * The graph's host side (profiles and graph design §2.7, §7.4, §8.6): the library's graph store with its automatic
 * backups, the host transport the page's store talks to, and the developer inspector's data feed (read-only pages of
 * rows, 200 at a time). Composition roots construct it with the Studio's graph types and rules.
 */
import { Aborter, createGraph } from "strata";
import type { Clock, Graph, InspectorDetail, InspectorPage, Random, RuleDef, TypeDef } from "strata";
import { LibraryBackups } from "./backups";
import { SqliteGraphStore } from "./sqlite-store";
import { STORE_OPERATIONS } from "./browser-graph-store";
import type { StoreOperation } from "./browser-graph-store";

export type GraphLibraryOptions = {
  readonly types: readonly TypeDef[]; readonly rules: readonly RuleDef[];
  readonly clock: Clock; readonly random: Random;
};

export class GraphLibrary {
  readonly store: SqliteGraphStore;
  readonly backups: LibraryBackups;
  private view?: { counter: number; graph: Graph; life: Aborter };
  constructor(readonly path: string, private readonly options: GraphLibraryOptions) {
    this.backups = new LibraryBackups(path, () => options.clock.now());
    this.store = new SqliteGraphStore(path, { onPurge: node => this.backups.purge(node), now: () => options.clock.now() });
  }

  /** Today's daily backup, if not taken yet (hosts call it soon after starting). A failure never stops the Studio. */
  dailyBackup(): string | undefined {
    try { return this.backups.daily(); } catch { return undefined; }
  }

  /** A graph loaded from the store for reading (the inspector), reloaded when the store's counter has moved. */
  async graph(): Promise<Graph> {
    const counter = await this.store.counter();
    if (this.view && this.view.counter === counter) return this.view.graph;
    this.view?.life.abort("reloaded");
    const life = new Aborter();
    const graph = createGraph({ types: this.options.types, rules: this.options.rules, store: this.store, actor: "host-inspector",
      sources: { clock: this.options.clock, random: this.options.random }, signal: life.signal });
    await graph.load();
    this.view = { counter, graph, life };
    return graph;
  }

  async inspect(query: string, offset = 0): Promise<InspectorPage> { return (await this.graph()).inspect(query, offset); }

  async node(id: string): Promise<InspectorDetail | undefined> {
    const graph = await this.graph();
    const ref = graph.list().find(item => item.id === id);
    return ref ? graph.inspectNode(ref) : undefined;
  }

  close(): void { this.view?.life.abort("closed"); this.store.close(); }
}


/**
 * The graph endpoints under `prefix`: `GET inspect?q=&offset=`, `GET node?id=`, `GET backups` (the inspector's
 * read-only feed and the backups list), and `POST store` (the page's store transport: `{ op, args }`).
 */
export function createGraphHandler(library: GraphLibrary, prefix: string): (request: Request) => Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value ?? null, { status, headers: { "Cache-Control": "no-store" } });
  return async request => {
    const url = new URL(request.url), origin = request.headers.get("Origin"), route = url.pathname.slice(prefix.length);
    if (url.hostname !== "127.0.0.1" || (origin && origin !== url.origin)) return json({ error: "Local studio requests only." }, 403);
    try {
      if (request.method === "GET" && route === "/inspect") {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        return json(await library.inspect(url.searchParams.get("q") ?? "", Number.isSafeInteger(offset) && offset >= 0 ? offset : 0));
      }
      if (request.method === "GET" && route === "/node") return json(await library.node(url.searchParams.get("id") ?? "") ?? null);
      if (request.method === "GET" && route === "/backups") return json(library.backups.list().map(item => ({ ...item, file: item.file.split(/[\\/]/).pop() })));
      if (request.method === "POST" && route === "/store") {
        if (origin !== url.origin || request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return json({ error: "Use the local studio." }, 403);
        const body = await request.text();
        if (body.length > 16_000_000) return json({ error: "The request is too large." }, 413);
        const { op, args } = JSON.parse(body) as { op: StoreOperation; args: unknown[] };
        if (!STORE_OPERATIONS.includes(op) || !Array.isArray(args)) return json({ error: "Unknown store operation." }, 400);
        const store = library.store as unknown as Record<StoreOperation, (...values: unknown[]) => Promise<unknown>>;
        return json({ result: await store[op](...args) });
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "The graph store failed." }, 500);
    }
  };
}
