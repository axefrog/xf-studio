/**
 * The creator catalogue shared by every character on the page (profiles design §7, step 1). It holds only installation and body data:
 * each body's panel (its options, sections and swatch groups), the choices of each row page by page, colour rows' swatch and icon
 * tables, and search answers. Everything per character or per panel instance (which rows are open and how far they are loaded, the
 * search typed, choices prepared ahead, previews) stays with the requester that asked (creator-requester.ts).
 *
 * - **Keyed results.** Every answer is keyed by what it depends on: body, catalogue identity, option, offset and query. A ready panel,
 *   a page, a settled swatch table and a search answer are immutable for their identity and are kept; three characters of one body share
 *   one copy, and characters of different bodies never share one.
 * - **In-flight deduplication.** The same key asked by several requesters is one host question. Each requester's `AbortSignal` lets go
 *   of its own interest only: the host question is stopped when the last requester holding it lets go, and a requester that let go is
 *   answered with an abort at once, whatever the others do.
 * - **A catalogue that changed** (another mod set, PIPE-81): an answer naming another identity than the kept panel's drops everything
 *   kept for that body, so the next question of any requester reaches the host; `retry` (Try again) does the same. Each body has a
 *   generation, raised whenever its answers are dropped: an answer to a question asked before that is handed to its asker but never kept.
 * - **Rows** are assembled from their pages by one path, kept page or fresh. Typed searches are kept only up to a bound, each with its
 *   searched rows and their pages, dropped together.
 * - **Prepared ahead** is per requester, down to the host (its own job there, choice-prefetch.ts); `release` lets go of a requester.
 *
 * The page has no job scheduler: the scheduler (platform/core/jobs.ts) is the host's, runs one job at a time and already builds each
 * body's catalogue once for everyone asking, and keeps each requester's preparing ahead as its own want. Here deduplication is per key
 * and concurrent, which a page's reads need.
 */
import type { BodyGender } from "./cc-catalogue";
import type { CcChoicePage, CcChoiceSearch, CcPanelChoice, CcSwatches, CreatorState } from "./cc-panel";
import type { CreatorPort } from "./character-context-actions";

/** Typed searches kept (each with its searched rows): a person types many queries in a session, each small but none final. */
const QUERIES_KEPT = 128;
type Flight = { readonly promise: Promise<unknown>; readonly controller: AbortController; holders: number };
/** A row's choices loaded so far for one body, identity and query: contiguous from the first, shared by every requester. */
export type CatalogueRow = { readonly choices: readonly CcPanelChoice[]; readonly total: number };

const abortError = (signal: AbortSignal) => signal.reason instanceof Error ? signal.reason : new DOMException("The question was let go.", "AbortError");
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
};

export class CreatorCatalogue {
  private readonly flights = new Map<string, Flight>();
  /** Each body's ready panel as the host last answered it. */
  private readonly panels = new Map<BodyGender, CreatorState>();
  /** Raised each time a body's answers are dropped: answers to questions asked before are never kept. */
  private readonly generations = new Map<BodyGender, number>();
  /** Immutable answers by key (`<what>\n<body>\n<identity>\n…`). */
  private readonly results = new Map<string, unknown>();
  private readonly rows = new Map<string, CatalogueRow>();
  /** Kept searches, oldest first: each search's own key, and its searched rows' keys and pages' keys, dropped together. */
  private readonly searches = new Map<string, Set<string>>();
  /** Requesters preparing a row's choices ahead now. */
  private readonly preparing = new Set<string>();
  /** Host questions asked, by kind (measurement and the multi-subject tests). */
  readonly asked = { panel: 0, page: 0, search: 0, swatches: 0, view: 0 };

  constructor(readonly host: CreatorPort) {}

  /** The identity of the body's kept panel ("" while none is kept). */
  identity(gender: BodyGender): string { return this.panels.get(gender)?.panel?.identity ?? ""; }
  private generation(gender: BodyGender) { return this.generations.get(gender) ?? 0; }

  /** A row's choices loaded so far (from the first, contiguous) for a body and catalogue identity, or null when none are. */
  rowOf(gender: BodyGender, identity: string, option: string, query = ""): CatalogueRow | null {
    return this.rows.get(this.rowKey(gender, identity, option, query)) ?? null;
  }

  /** The same key asked by several requesters is one host question; each requester's signal lets go of its own interest only. */
  private shared<T>(key: string, signal: AbortSignal, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(abortError(signal));
    let flight = this.flights.get(key);
    if (!flight) {
      const controller = new AbortController();
      let promise: Promise<unknown>;
      try { promise = Promise.resolve(run(controller.signal)); } catch (error) { promise = Promise.reject(error); }
      const made: Flight = { promise, controller, holders: 0 };
      flight = made;
      this.flights.set(key, made);
      promise.then(() => {}, () => {}).finally(() => { if (this.flights.get(key) === made) this.flights.delete(key); });
    }
    const held = flight;
    held.holders++;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const leave = () => { done = true; signal.removeEventListener("abort", aborted); held.holders--; };
      const aborted = () => {
        if (done) return;
        leave();
        reject(abortError(signal));
        // The last requester let go: the host question stops, and the next one asked starts afresh.
        if (held.holders === 0) {
          held.controller.abort();
          if (this.flights.get(key) === held) this.flights.delete(key);
        }
      };
      signal.addEventListener("abort", aborted, { once: true });
      held.promise.then(value => { if (!done) { leave(); resolve(value as T); } }, error => { if (!done) { leave(); reject(error); } });
    });
  }

  /** An answer from another catalogue than the kept panel's: the installation changed, so nothing kept for the body stands. */
  private seen(gender: BodyGender, identity: string | undefined) {
    const kept = this.identity(gender);
    if (identity && kept && identity !== kept) this.forget(gender);
  }
  /** Drop everything kept for a body (a changed catalogue, Try again); answers still on their way are not kept either. */
  forget(gender: BodyGender): void {
    this.generations.set(gender, this.generation(gender) + 1);
    this.panels.delete(gender);
    const marker = `\n${gender}\n`;
    for (const key of [...this.results.keys()]) if (key.includes(marker)) this.results.delete(key);
    for (const key of [...this.rows.keys()]) if (key.startsWith(`${gender}\n`)) this.rows.delete(key);
    // Flights already asked are joined only by their own askers: a question asked from now on reaches the host.
    for (const key of [...this.flights.keys()]) if (key.includes(marker)) this.flights.delete(key);
    for (const key of [...this.searches.keys()]) if (key.includes(marker)) this.searches.delete(key);
  }
  private rowKey(gender: BodyGender, identity: string, option: string, query: string) { return `${gender}\n${identity}\n${option}\n${query}`; }
  /** Keep a typed search's answer, or a searched row's page under its search; the oldest searches go past the bound, with their rows. */
  private keepSearched(search: string, key: string, value: unknown, row?: string) {
    this.results.set(key, value);
    const group = this.searches.get(search) ?? new Set<string>();
    this.searches.delete(search);
    this.searches.set(search, group.add(key));
    if (row) group.add(`row\n${row}`);
    while (this.searches.size > QUERIES_KEPT) {
      const [oldest, keys] = this.searches.entries().next().value!;
      this.searches.delete(oldest);
      for (const item of keys) if (item.startsWith("row\n")) this.rows.delete(item.slice(4)); else this.results.delete(item);
    }
  }
  private keepPanel(gender: BodyGender, state: CreatorState, generation: number): CreatorState {
    // Labels that may read next time, or need WolvenKit, are served but not final (NATIVE-46): the next question asks the host again.
    if (state.phase !== "ready" || !state.panel || state.next || generation !== this.generation(gender)) return state;
    if (this.identity(gender) !== state.panel.identity) this.forget(gender);
    const kept = deepFreeze(state);
    this.panels.set(gender, kept);
    return kept;
  }

  panel(gender: BodyGender, signal: AbortSignal): Promise<CreatorState> {
    const kept = this.panels.get(gender);
    if (kept) return Promise.resolve(kept);
    const generation = this.generation(gender);
    return this.shared(`panel\n${gender}\n${generation}`, signal, inner => { this.asked.panel++; return this.host.panel(gender, inner); })
      .then(state => this.keepPanel(gender, state, generation));
  }
  retry(gender: BodyGender, signal: AbortSignal): Promise<CreatorState> {
    this.forget(gender);
    const host = this.host, generation = this.generation(gender);
    return (host.retry ? host.retry(gender, signal) : host.panel(gender, signal)).then(state => this.keepPanel(gender, state, generation));
  }
  page(gender: BodyGender, option: string, offset: number, signal: AbortSignal, query?: string): Promise<CcChoicePage> {
    return this.loadRow(gender, this.identity(gender), option, query ?? "", offset, signal);
  }
  /**
   * The page of a row at `offset` for the catalogue `identity` a requester's panel came from. Kept or fresh, it joins that row (`rowOf`)
   * when it is the next one and came from the same catalogue.
   */
  loadRow(gender: BodyGender, identity: string, option: string, query: string, offset: number, signal: AbortSignal): Promise<CcChoicePage> {
    const key = `page\n${gender}\n${identity}\n${option}\n${offset}\n${query}`, rowKey = this.rowKey(gender, identity, option, query);
    const kept = this.results.get(key) as CcChoicePage | undefined;
    if (kept) { this.join(rowKey, offset, kept); return Promise.resolve(kept); }
    const generation = this.generation(gender);
    return this.shared(key, signal, inner => { this.asked.page++; return this.host.page(gender, option, offset, inner, query || undefined); }).then(page => {
      // An answer to a question asked before the body's answers were dropped tells nothing about the catalogue now.
      if (generation !== this.generation(gender)) return page;
      this.seen(gender, page.identity);
      if (page.identity && identity && page.identity !== identity) return page;
      const frozen = deepFreeze(page);
      if (identity && query) this.keepSearched(`search\n${gender}\n${identity}\n${query}`, key, frozen, rowKey);
      else if (identity) this.results.set(key, frozen);
      this.join(rowKey, offset, frozen);
      return page;
    });
  }
  /** Pages are asked from the first, each at the length loaded so far; a page already joined is not joined again. */
  private join(rowKey: string, offset: number, page: CcChoicePage) {
    const row = this.rows.get(rowKey);
    if ((row?.choices.length ?? 0) !== offset) return;
    this.rows.set(rowKey, Object.freeze({ choices: Object.freeze([...row?.choices ?? [], ...page.choices]), total: page.total }));
  }
  search(gender: BodyGender, query: string, signal: AbortSignal): Promise<CcChoiceSearch> {
    const identity = this.identity(gender), key = `search\n${gender}\n${identity}\n${query}`;
    const kept = this.results.get(key) as CcChoiceSearch | undefined;
    if (kept) return Promise.resolve(kept);
    const host = this.host;
    if (!host.search) return Promise.reject(Error("The creator options can't be searched here."));
    const generation = this.generation(gender);
    return this.shared(key, signal, inner => { this.asked.search++; return host.search!(gender, query, inner); }).then(found => {
      if (generation !== this.generation(gender)) return found;
      this.seen(gender, found.identity);
      if (identity && (!found.identity || found.identity === identity)) this.keepSearched(key, key, deepFreeze(found));
      return found;
    });
  }
  swatches(gender: BodyGender, option: string, signal: AbortSignal): Promise<CcSwatches> {
    const identity = this.identity(gender), key = `swatches\n${gender}\n${identity}\n${option}`;
    const kept = this.results.get(key) as CcSwatches | undefined;
    if (kept) return Promise.resolve(kept);
    const host = this.host;
    if (!host.swatches) return Promise.reject(Error("This host has no swatches."));
    const generation = this.generation(gender);
    return this.shared(key, signal, inner => { this.asked.swatches++; return host.swatches!(gender, option, inner); }).then(answer => {
      if (generation !== this.generation(gender)) return answer;
      this.seen(gender, answer.identity);
      // A table still being worked out is asked again; a settled one is kept.
      if (!answer.pending && identity && (!answer.identity || answer.identity === identity))
        this.results.set(key, deepFreeze(answer));
      return answer;
    });
  }

  /** A requester is gone: the host stops preparing its row ahead. */
  release(requester: string): void {
    if (!this.preparing.delete(requester)) return;
    void this.host.stopPrefetch?.(requester).catch(() => {});
  }

  /**
   * The port one requester uses (a character's panel instance, `<character>/<instance>`): the shared answers above, its own interest
   * in each, and its own row prepared ahead on the host.
   */
  port(requester: string): CreatorPort {
    const host = this.host;
    const port: CreatorPort = {
      panel: (gender, signal) => this.panel(gender, signal),
      page: (gender, option, offset, signal, query) => this.page(gender, option, offset, signal, query),
      // The same request asked at once by two requesters (two scenes of one V) is one question; views are never kept.
      view: (request, signal) => {
        const generation = this.generation(request.bodyGender);
        return this.shared(`view\n${generation}\n${JSON.stringify(request)}`, signal, inner => { this.asked.view++; return host.view(request, inner); })
          .then(view => { if (generation === this.generation(request.bodyGender)) this.seen(request.bodyGender, view.identity); return view; });
      },
      preset: (request, name, kept) => host.preset(request, name, kept),
      wait: (ms, signal) => host.wait(ms, signal),
      retry: (gender, signal) => this.retry(gender, signal),
    };
    if (host.search) port.search = (gender, query, signal) => this.search(gender, query, signal);
    if (host.legacy) port.legacy = (gender, style, definition) => host.legacy!(gender, style, definition);
    if (host.swatches) port.swatches = (gender, option, signal) => this.swatches(gender, option, signal);
    if (host.sheetUrl) port.sheetUrl = (gender, id, key) => host.sheetUrl!(gender, id, key);
    if (host.preparedFiles) port.preparedFiles = signal => host.preparedFiles!(signal);
    if (host.clearPrepared) port.clearPrepared = () => host.clearPrepared!();
    if (host.prefetch) port.prefetch = (request, option, positions, focus, signal) => {
      this.preparing.add(requester);
      return host.prefetch!(request, option, positions, focus, signal, requester);
    };
    if (host.stopPrefetch) port.stopPrefetch = async () => {
      this.preparing.delete(requester);
      await host.stopPrefetch!(requester);
    };
    return port;
  }
}
