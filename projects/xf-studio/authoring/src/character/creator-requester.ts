/**
 * What one panel instance of one character asks of the creator catalogue (profiles design §7, step 2): the rows it has open and how far
 * each is loaded, the search typed into it, the row it prepares ahead and the choice under its pointer, and its choice previews. The
 * data itself is the shared catalogue's (creator-catalogue.ts); a requester holds only its own wants, loading and failure states.
 *
 * - **Cancellation is the requester's.** Each question carries the context's catalogue session, or the requester's own controller;
 *   letting go stops only this requester's interest, never another's (the catalogue stops a host question once nobody holds it).
 * - **A catalogue follow** (another body, a catalogue that changed, Try again) resets every requester of the character (`reset`).
 * - Its character is reached only through `RequesterHost`, so several requesters of one character see one V and one panel.
 */
import type { BodyGender } from "./cc-catalogue";
import { type CcPanel, type CcPanelOption, CC_PAGE_SIZE, searchQuery } from "./cc-panel";
import type { CharacterChoice } from "./character-context";
import type { CharacterRequest } from "./character-detail-request";
import { type DisplayedSwatchState, SwatchDisplayMemo } from "./cc-swatch-display";
import { type ChoicePreviewPort, type ChoicePreviewRow, ChoicePreviewService } from "./choice-preview-service";
import type { CatalogueRow, CreatorCatalogue } from "./creator-catalogue";
import type { CharacterChoicesState, CharacterFetchState, CharacterSearchState, CharacterSwatchState, ChoiceFetch, CreatorPort } from "./character-context-actions";

/** Most positions one question about a row's choices names. */
const CHOICE_PREFETCH_POSITIONS = 512;
/**
 * How long the pointer (or focus) rests on a prepared choice before its parts are loaded ahead (PREV-189): long enough that sweeping
 * across a row loads nothing, short enough that the load is done before most clicks.
 */
export const PRELOAD_DWELL_MS = 150;
/** Polling while the host has work: while the panel is being looked at, and otherwise (PIPE-78). */
const POLL_MS = 800, POLL_IDLE_MS = 4000, WATCHED_MS = 3000;
/** How often an open colour row asks again while the host is still working out its swatches. */
const SWATCH_POLL_MS = 1500;
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
};
export const pageKey = (option: string, query: string) => `${option}\n${query}`;

/** The character a requester asks for, as its context answers. */
export type RequesterHost = {
  /** The catalogue follow's phase and body, and its panel (whatever body it is for). */
  phase(): "idle" | "preparing" | "ready" | "failed";
  gender(): BodyGender;
  panel(): CcPanel | null;
  option(id: string): CcPanelOption | undefined;
  /** Ready for the shown V's body. */
  ready(): boolean;
  /** The catalogue session's signal and generation (a follow replaces both); null before the first follow. */
  session(): { readonly signal: AbortSignal; readonly generation: number } | null;
  generation(): number;
  disposed(): boolean;
  /** An answer from another catalogue: true when the context started again (PIPE-81). */
  stale(identity: string): boolean;
  publish(): void;
  /** The request the preview prepares for the V as it is now. */
  detailRequest(): CharacterRequest;
  /** The request with one more change set (a choice loaded ahead), or null when it changes nothing or is refused. */
  aheadRequest(change: CharacterChoice): CharacterRequest | null;
  /** Load a prepared change's parts ahead without showing it (PREV-189). */
  preload?(request: CharacterRequest, signal: AbortSignal): Promise<void>;
  previews?: ChoicePreviewPort;
  /** The view of the V is on its way (previews wait). */
  viewing(): boolean;
  /** The prepared files grew: read their size again. */
  refreshPrepared(): void;
  /** When the panel was last looked at (polling quickly while it is). */
  watchedAt(): number;
};

type Fetch = { key: string; option: string; positions: number[]; focus: number | null; sent: string; states: Map<number, ChoiceFetch>;
  stopped: "time" | "disk" | "setup" | null; busy: boolean; asking: AbortController | null; again: boolean; view: CharacterFetchState };
type Ahead = { option: string; position: number; timer: ReturnType<typeof setTimeout> | null; waiting: boolean; controller: AbortController | null };

export class CreatorRequester {
  /** Each open row's (and search's) loading and failure, by `pageKey`; the choices are the catalogue's row. */
  private status = new Map<string, { loading: boolean; error: string | null; total: number }>();
  private shown = new Map<string, { row: CatalogueRow | null; status: unknown; value: CharacterChoicesState }>();
  private swatchRows = new Map<string, CharacterSwatchState>();
  private readonly swatchDisplay = new SwatchDisplayMemo();
  private swatchLoading = new Set<string>();
  private searching: (CharacterSearchState & { controller: AbortController | null }) | null = null;
  private fetch: Fetch | null = null;
  private ahead: Ahead | null = null;
  private previewService: ChoicePreviewService | null = null;

  constructor(readonly id: string, private readonly catalogue: CreatorCatalogue, private readonly port: CreatorPort, private readonly host: RequesterHost) {}

  /** A catalogue follow started: nothing loaded, searched or asked about for the previous one stands. */
  reset(): void {
    this.searching?.controller?.abort();
    this.searching = null;
    this.status.clear(); this.shown.clear(); this.swatchRows.clear(); this.swatchLoading.clear(); this.swatchDisplay.clear();
  }

  private identity() { return this.host.panel()?.identity ?? ""; }
  /** A row's choices loaded so far for this requester's character (shared with every requester of its body and catalogue). */
  row(option: string, query = ""): CatalogueRow | null { return this.catalogue.rowOf(this.host.gender(), this.identity(), option, query); }
  private page(key: string, option: string, query: string): CharacterChoicesState | undefined {
    const row = this.row(option, query), status = this.status.get(key);
    if (!row && !status) return undefined;
    const memo = this.shown.get(key);
    if (memo && memo.row === row && memo.status === status) return memo.value;
    const value: CharacterChoicesState = { choices: row?.choices ?? [], total: row?.total ?? status?.total ?? 0, loading: status?.loading ?? false,
      error: status?.error ?? null };
    this.shown.set(key, { row, status, value });
    return value;
  }

  /** An option's choices loaded so far (with `query`, its choices matching it); asking starts loading the next page. */
  choices(option: string, want = CC_PAGE_SIZE, query = ""): CharacterChoicesState {
    const wanted = searchQuery(query), key = pageKey(option, wanted);
    const page = this.page(key, option, wanted);
    if (!page || (!page.loading && !page.error && page.choices.length < Math.min(want, page.total))) void this.loadPage(option, wanted);
    return this.page(key, option, wanted) ?? { choices: [], total: this.host.option(option)?.count ?? 0, loading: true, error: null };
  }
  private async loadPage(option: string, query: string) {
    const key = pageKey(option, query), current = this.page(key, option, query), session = this.host.session();
    if (current?.loading || this.host.phase() !== "ready" || !session) return;
    const generation = this.host.generation(), gender = this.host.gender(), identity = this.identity();
    const offset = current?.choices.length ?? 0, total = current?.total ?? this.host.option(option)?.count ?? 0;
    this.status.set(key, { loading: true, error: null, total });
    try {
      const page = await this.catalogue.loadRow(gender, identity, option, query, offset, session.signal);
      if (generation !== this.host.generation() || this.host.disposed() || this.host.stale(page.identity)) return;
      this.status.set(key, { loading: false, error: null, total: page.total });
    } catch (error) {
      if (generation !== this.host.generation() || this.host.disposed()) return;
      this.status.set(key, { loading: false, error: (error as Error)?.message || "The choices couldn't be read.", total });
    }
    this.host.publish();
  }

  /**
   * A colour row's swatches and icons (derived on the host from what wins for each choice; cc-swatch.ts), or null before they arrive or
   * when the host doesn't offer them. Asking loads them, and asks again while the host is still working them out.
   */
  swatches(option: string): DisplayedSwatchState | null {
    if (!this.swatchRows.has(option) || this.swatchRows.get(option)!.pending) void this.loadSwatches(option);
    const state = this.swatchRows.get(option);
    if (!state) return null;
    // Shown per set (maker group, or the whole row), each tightly clustered set contrast-enhanced (cc-swatch-display.ts); the true
    // colours stay in `truth`. Recomputed only when the swatches, the loaded choices or the grouping change.
    const entry = this.host.option(option), panel = this.host.panel();
    const choices = this.row(option)?.choices ?? [];
    const grouping = entry && panel && entry.groups > 1 ? { modGroups: panel.modGroups, pooled: panel.pools[entry.pool] ?? [] } : null;
    return this.swatchDisplay.get(option, state, choices, grouping);
  }
  private async loadSwatches(option: string) {
    const port = this.port, session = this.host.session();
    if (!port.swatches || this.swatchLoading.has(option) || this.host.phase() !== "ready" || !session) return;
    const generation = this.host.generation(), gender = this.host.gender(), signal = session.signal;
    this.swatchLoading.add(option);
    try {
      // A row asked about again while its swatches are pending waits a moment first.
      if (this.swatchRows.get(option)?.pending) await port.wait(SWATCH_POLL_MS, signal);
      if (generation !== this.host.generation() || this.host.disposed()) return;
      const answer = await port.swatches(gender, option, signal);
      if (generation !== this.host.generation() || this.host.disposed() || this.host.stale(answer.identity)) return;
      const sheets = new Map(answer.sheets.map(sheet => [sheet.id, { url: port.sheetUrl?.(gender, sheet.id, sheet.key) ?? "", columns: sheet.columns, rows: sheet.rows }]));
      this.swatchRows.set(option, deepFreeze({ swatches: [...answer.swatches], icons: [...answer.icons], sheets, pending: answer.pending }));
    } catch {
      // Swatches are a nicety: without them the row shows the definitions' own colours.
      if (generation === this.host.generation() && !this.host.disposed()) this.swatchRows.set(option, { swatches: [], icons: [], sheets: new Map(), pending: false });
    } finally { this.swatchLoading.delete(option); }
    if (generation === this.host.generation() && !this.host.disposed()) this.host.publish();
  }

  /** The options with a choice matching `query` (the host searches every choice, not only those loaded; UI-72). */
  search(query: string): CharacterSearchState {
    const wanted = searchQuery(query);
    if (!wanted) return { query: "", options: null, more: false, loading: false, error: null };
    if (this.searching?.query !== wanted) this.startSearch(wanted);
    const found = this.searching!;
    return { query: found.query, options: found.options, more: found.more, loading: found.loading, error: found.error };
  }
  private startSearch(query: string) {
    this.searching?.controller?.abort();
    if (!this.port.search || this.host.phase() !== "ready") {
      this.searching = { query, options: null, more: false, loading: false, error: null, controller: null };
      return;
    }
    const controller = new AbortController(), generation = this.host.generation();
    this.searching = { query, options: null, more: false, loading: true, error: null, controller };
    this.port.search(this.host.gender(), query, controller.signal).then(found => {
      if (controller.signal.aborted || generation !== this.host.generation() || this.host.stale(found.identity)) return;
      this.searching = { query, options: new Set(found.options), more: found.more, loading: false, error: null, controller: null };
      this.host.publish();
    }, error => {
      if (controller.signal.aborted || generation !== this.host.generation()) return;
      this.searching = { query, options: null, more: false, loading: false, error: (error as Error)?.message || "The search couldn't be run.", controller: null };
      this.host.publish();
    });
  }

  /**
   * A row's choices prepared ahead: asks the host to prepare `positions` (visible ones first) in the background and returns their
   * states so far (frozen; a new object when they change). `focus` (a hovered or focused choice) goes to the front. Null when the host
   * can't prepare ahead or the catalogue isn't ready.
   */
  prefetch(option: string, positions: readonly number[], focus: number | null = null): CharacterFetchState | null {
    if (!this.port.prefetch || !this.host.ready() || !positions.length) return null;
    // Keyed by the V without the row's own choice, so choosing in the row keeps the states it has.
    const request = this.host.detailRequest();
    const key = JSON.stringify([{ ...request, choices: (request.choices ?? []).filter(choice => `${choice.part}/${choice.option}` !== option) }, option]);
    if (this.fetch?.key !== key) {
      this.fetch?.asking?.abort();
      this.fetch = { key, option, positions: [], focus: null, sent: "", states: new Map(), stopped: null, busy: true, asking: null, again: false,
        view: Object.freeze({ option, states: new Map(), stopped: null, busy: true }) };
    }
    // A hint stays until the next one (the next paint asks without one).
    const fetch = this.fetch, wanted = positions.slice(0, CHOICE_PREFETCH_POSITIONS), hint = focus ?? fetch.focus;
    const sent = JSON.stringify([wanted, hint]);
    if (sent !== fetch.sent) { fetch.sent = sent; fetch.positions = wanted; fetch.focus = hint; this.askPrefetch(fetch); }
    if (focus !== null) this.hintAhead(option, focus);
    return fetch.view;
  }
  /** Whether the row prepared ahead now has `position` of option `option` ready. */
  prepared(option: string, position: number | null): boolean {
    return !!this.fetch && this.fetch.option === option && position !== null && this.fetch.states.get(position) === "r";
  }
  /** A choice under the pointer (or focused): once it has rested there a moment and the host has it prepared, its parts load ahead. */
  private hintAhead(option: string, position: number) {
    if (!this.host.preload) return;
    if (this.ahead?.option === option && this.ahead.position === position) return;
    this.cancelAhead();
    const entry: Ahead = { option, position, timer: null, waiting: false, controller: null };
    this.ahead = entry;
    entry.timer = setTimeout(() => { entry.timer = null; this.startAhead(entry); }, PRELOAD_DWELL_MS);
  }
  private startAhead(entry: Ahead) {
    if (this.ahead !== entry || this.host.disposed() || entry.controller || entry.timer) return;
    // Only a choice the host has prepared: a load ahead never starts a preparation of its own.
    if (this.fetch?.option !== entry.option || this.fetch.states.get(entry.position) !== "r") { entry.waiting = true; return; }
    entry.waiting = false;
    const option = this.host.option(entry.option), choice = this.row(entry.option)?.choices.find(item => item.position === entry.position);
    if (!option || !choice) return;
    const change: CharacterChoice = { part: option.part, option: option.name, choice: choice.key, ...(choice.activates ? { activates: [...choice.activates] } : {}) };
    const request = this.host.aheadRequest(change);
    if (!request) return;
    entry.controller = new AbortController();
    void this.host.preload!(request, entry.controller.signal);
  }
  /** Nothing is loaded ahead any more (another hint, a change, the row closed). */
  cancelAhead(): void {
    if (!this.ahead) return;
    if (this.ahead.timer) clearTimeout(this.ahead.timer);
    this.ahead.controller?.abort();
    this.ahead = null;
  }
  /** A change of the person's own: a load ahead still waiting (its dwell, or its preparation) is dropped. */
  cancelWaitingAhead(): void { if (this.ahead?.timer || this.ahead?.waiting) this.cancelAhead(); }

  /**
   * A shape row's choice pictures (choice-previews-design.md): asks for the pictures of `positions` (view order), the V's chosen one and
   * the one under the pointer first, as preparing ahead makes each ready, and `spin`'s turntable strip. Null when the row has no picture
   * kind or previews are off.
   */
  previews(option: string, positions: readonly number[], selected: number | null, focus: number | null = null, spin: number | null = null): ChoicePreviewRow | null {
    const kind = this.host.option(option)?.preview;
    if (!kind || !this.host.previews || !this.host.ready()) return null;
    this.previewService ??= new ChoicePreviewService(this.host.previews, () => this.host.publish());
    const fetch = this.fetch?.option === option ? this.fetch : null;
    return this.previewService.update({ option, kind, request: this.host.detailRequest(), body: this.host.gender(), catalogue: this.host.panel()?.identity ?? "",
      positions, selected, focus, spin,
      ready: position => fetch?.states.get(position) === "r", busy: this.host.viewing() });
  }
  /** What choice previews have cost so far (measurement and diagnostics). */
  previewStats() { return this.previewService?.stats ?? null; }
  /** The row closed: stop preparing its choices ahead. */
  stopPrefetch(option: string): void {
    if (this.ahead?.option === option) this.cancelAhead();
    if (this.fetch?.option !== option) return;
    this.fetch.asking?.abort();
    this.fetch = null;
    void this.port.stopPrefetch?.().catch(() => {});
  }
  /** Drop the row prepared ahead without telling the host (the prepared files are being cleared). */
  dropPrefetch(): void { this.fetch?.asking?.abort(); this.fetch = null; }
  private askPrefetch(fetch: Fetch) {
    if (fetch.asking) { fetch.again = true; return; }
    const controller = new AbortController();
    fetch.asking = controller;
    const current = () => this.fetch === fetch && !this.host.disposed();
    this.port.prefetch!(this.host.detailRequest(), fetch.option, fetch.positions, fetch.focus, controller.signal).then(reply => {
      if (!current()) return;
      let changed = reply.stopped !== fetch.stopped || reply.busy !== fetch.busy;
      fetch.positions.forEach((position, index) => {
        const state = (reply.states[index] ?? "?") as ChoiceFetch;
        if (fetch.states.get(position) !== state) { fetch.states.set(position, state); changed = true; }
      });
      const wasBusy = fetch.busy;
      fetch.stopped = reply.stopped; fetch.busy = reply.busy;
      // The choice under the pointer became prepared: its parts load ahead now.
      if (this.ahead?.waiting && this.ahead.option === fetch.option && fetch.states.get(this.ahead.position) === "r") this.startAhead(this.ahead);
      if (changed) {
        fetch.view = Object.freeze({ option: fetch.option, states: new Map(fetch.states), stopped: fetch.stopped, busy: fetch.busy });
        this.host.publish();
      }
      // The prepared files grew: their size is read again once the row settles.
      if (wasBusy && !reply.busy) this.host.refreshPrepared();
    }, () => { /* The host is unreachable or the page is older: the states stay as they were. */ }).finally(() => {
      if (fetch.asking === controller) fetch.asking = null;
      if (!current()) return;
      if (fetch.again) { fetch.again = false; this.askPrefetch(fetch); return; }
      // While the host has work, ask again: quickly while the panel is looked at, slowly otherwise.
      if (fetch.busy) void this.port.wait(Date.now() - this.host.watchedAt() < WATCHED_MS ? POLL_MS : POLL_IDLE_MS, controller.signal)
        .then(() => { if (current() && !fetch.asking) this.askPrefetch(fetch); });
    });
  }

  dispose(): void {
    this.cancelAhead();
    this.fetch?.asking?.abort();
    this.fetch = null;
    this.previewService?.dispose();
    this.searching?.controller?.abort();
  }
}
