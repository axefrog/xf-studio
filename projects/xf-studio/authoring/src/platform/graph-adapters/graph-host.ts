/**
 * The graph's host side (profiles and graph design §2.7, §7.4, §8.6): the library's graph store with its automatic
 * backups, the host transport the page's store talks to, and the developer inspector's data feed (read-only pages of
 * rows, 200 at a time). Composition roots construct it with the Studio's graph types and rules.
 */
import { Aborter, createGraph } from "strata";
import type { Clock, Graph, GraphStore, InspectorDetail, InspectorPage, NodeRef, Random, RuleDef, TypeDef } from "strata";
import { LibraryBackups } from "./backups";
import { SqliteGraphStore } from "./sqlite-store";
import { IRREVERSIBLE_OPERATIONS, STORE_OPERATIONS } from "./browser-graph-store";
import type { IrreversibleOperation, StoreOperation } from "./browser-graph-store";

export type GraphLibraryOptions = {
  readonly types: readonly TypeDef[]; readonly rules: readonly RuleDef[];
  readonly clock: Clock; readonly random: Random;
};

/** An irreversible store operation the host is about to run, for the person to confirm. */
export type IrreversibleRequest = { readonly op: IrreversibleOperation; readonly node: NodeRef };
/** Asks the person (a host dialog) whether to go ahead; true only on a clear yes. */
export type ConfirmIrreversible = (request: IrreversibleRequest) => Promise<boolean>;

export class GraphLibrary {
  readonly store: SqliteGraphStore;
  readonly backups: LibraryBackups;
  private view?: { counter: number; graph: Graph; life: Aborter };
  private loading?: Promise<Graph>;
  private readonly life = new Aborter();
  private backupsScheduled = false;
  constructor(readonly path: string, private readonly options: GraphLibraryOptions) {
    this.backups = new LibraryBackups(path, () => options.clock.now());
    this.store = new SqliteGraphStore(path, { onPurge: node => this.backups.purge(node), beforeMigration: label => this.backups.beforeMigration(label),
      now: () => options.clock.now() });
  }

  /**
   * Today's daily backup, if not taken yet, and pending purges retried (hosts call it soon after starting). It then
   * checks again every hour for as long as the library is open, so a Studio left running takes a copy each day. A
   * failure never stops the Studio.
   */
  dailyBackup(): string | undefined {
    if (!this.backupsScheduled && !this.life.signal.aborted) {
      this.backupsScheduled = true;
      const again = () => this.options.clock.after(BACKUP_CHECK_MS, () => { this.dailyBackup(); again(); }, this.life.signal);
      again();
    }
    try { this.store.retryPurges(); } catch { /* retried at the next check */ }
    try { return this.backups.daily(); } catch { return undefined; }
  }

  /**
   * A graph loaded from the store for reading (the inspector). It never writes to the store (no snapshots); when the
   * store's counter moves it catches up with the new entries, and loads again only when a node it holds was purged.
   */
  async graph(): Promise<Graph> {
    const counter = await this.store.counter();
    if (this.view && this.view.counter === counter) return this.view.graph;
    this.loading ??= this.refresh(counter).finally(() => { this.loading = undefined; });
    return this.loading;
  }

  private async refresh(counter: number): Promise<Graph> {
    const view = this.view;
    if (view) {
      const stored = new Set((await this.store.list()).map(row => row.ref.id));
      const purged = view.graph.list().some(ref => !ref.id.startsWith("builtin:") && !stored.has(ref.id));
      if (!purged) {
        await view.graph.sync();
        view.counter = counter;
        return view.graph;
      }
      view.life.abort("reloaded");
    }
    const life = new Aborter(this.life.signal);
    const graph = createGraph({ types: this.options.types, rules: this.options.rules, store: this.store, actor: "host-inspector",
      sources: { clock: this.options.clock, random: this.options.random }, signal: life.signal, writeSnapshots: false });
    await graph.load();
    this.view = { counter, graph, life };
    return graph;
  }

  /**
   * The library's store for a graph the host itself runs (CORE-127): it reads and appends as the store does, and each
   * compaction or purge runs only after `confirm` answers yes and today's backup is taken (a backup that can't be
   * taken refuses it). The page's transport never reaches this store's compaction or purge.
   */
  confirmedStore(confirm: ConfirmIrreversible): GraphStore {
    const store = this.store, backups = this.backups;
    const guarded = async (request: IrreversibleRequest, run: () => Promise<void>): Promise<void> => {
      if (!(await confirm(request))) throw new Error(request.op === "purge" ? "It wasn't deleted: that needs your confirmation." : "It wasn't compacted: that needs your confirmation.");
      backups.daily();
      await run();
    };
    return {
      list: () => store.list(), load: () => store.load(), readStream: (...args) => store.readStream(...args),
      append: request => store.append(request), changesSince: pos => store.changesSince(pos), counter: () => store.counter(),
      putSnapshot: snapshot => store.putSnapshot(snapshot), dropSnapshots: node => store.dropSnapshots(node),
      compact: (node, entries, at) => guarded({ op: "compact", node }, () => store.compact(node, entries, at)),
      purge: node => guarded({ op: "purge", node }, () => store.purge(node)),
    };
  }

  async inspect(query: string, offset = 0): Promise<InspectorPage> { return (await this.graph()).inspect(query, offset); }

  async node(id: string): Promise<InspectorDetail | undefined> {
    const graph = await this.graph();
    const ref = graph.list().find(item => item.id === id);
    return ref ? graph.inspectNode(ref) : undefined;
  }

  close(): void { this.life.abort("closed"); this.store.close(); }
}

/** How often a running host checks whether today's backup has been taken. */
const BACKUP_CHECK_MS = 60 * 60 * 1000;

/** The hosts a local Studio page is served from. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The graph endpoints under `prefix`: `GET inspect?q=&offset=`, `GET node?id=`, `GET backups` (the inspector's
 * read-only feed and the backups list), and `POST store` (the page's store transport: `{ op, args }`). The transport
 * never carries `compact` or `purge` (CORE-127): those run only on the host, through `GraphLibrary.confirmedStore`.
 */
export function createGraphHandler(library: GraphLibrary, prefix: string): (request: Request) => Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value ?? null, { status, headers: { "Cache-Control": "no-store" } });
  return async request => {
    const url = new URL(request.url), origin = request.headers.get("Origin"), route = url.pathname.slice(prefix.length);
    if (!LOCAL_HOSTS.has(url.hostname) || (origin && origin !== url.origin)) return json({ error: "Local studio requests only." }, 403);
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
        if ((IRREVERSIBLE_OPERATIONS as readonly string[]).includes(op)) return json({ error: "Only XF Studio itself can do that, after you confirm it." }, 403);
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
