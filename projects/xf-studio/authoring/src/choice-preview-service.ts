/**
 * Application service for choice previews (choice-previews-design.md §6.2–6.3): turns the choices a row shows into pictures, in the
 * maintainer's priority order, without ever holding up a person's own change. DOM-free: the host, the worker and the store are ports.
 *
 * - **Driven by readiness.** Every choice shown is looked up in the host's source index at once (a later session shows its pictures
 *   before preparing ahead has checked the choices again); a choice without one gets its source derived once the row's preparing ahead
 *   marks it ready (choice-prefetch.ts `r`). With a source, its key is computed (choice-preview.ts) and the stored image used, or drawn
 *   by the worker and stored. A choice whose detail draws nothing is `none` (the tile keeps its glyph).
 * - **Priorities** (the scheduling rule, research/backlog/performance.md): the V's chosen choice, then the one under the pointer or
 *   focus, then the row's choices in view order (in view first, then nearest), then the other rows of the same kind shown this session
 *   (their choices whose sources are known). Only waiting work is reordered: a job once started always finishes and is kept.
 * - **The person first.** While the V is being prepared with a person's change (`busy`), nothing new starts; the host also runs source
 *   derivations only in its background lane, answering `busy` when it didn't get it within a few seconds (asked again shortly, not
 *   counted as a try).
 * - **Three lanes, one job each** (PREV-153): lookups, one derivation and one drawing run side by side, so a derivation waiting for the
 *   host's lane never holds up another row's stored pictures. A derivation is abandoned when its choice leaves the row or the V changes.
 * - **Rows belong to a body and a catalogue** (PREV-154): positions are indices into the installed catalogue for one body, so a row
 *   shown for another body or after a catalogue change starts again (its object URLs released), and other rows of the same kind are
 *   drawn from only while they belong to the same ones.
 * - **Turntables on request** (phase 2): the one choice a row wants spinning (`spin`: the hovered tile in the grid, the choice shown
 *   large in details) gets its turntable strip drawn from the same source, right after the chosen and hovered stills, and stored under its
 *   own key; nothing else ever draws one, so a row costs no more until someone looks. A strip once started is finished and kept.
 * - **Live turns** (PREV-152): each row owns its wish for a live turn, and only that row changes or withdraws it. The worker keeps one
 *   source uploaded, so the newest wish holds that one slot; an older wish waits (a details row's large picture while another row's
 *   tile is hovered) and gets the slot back when the newer one is withdrawn. A superseded start isn't a failure (PREV-151).
 * - **Failures stay quiet, and never loop** (PREV-150): a drawing that fails leaves the choice without a picture for the session (its
 *   tile keeps the glyph); a host question that fails counts a try on the choice being derived (failed at `DERIVE_TRIES`) and backs off
 *   exponentially before the next question; a host of another version (409 `unsupported_version`) stops previews until the page
 *   reloads, and the rows say so in place (`notice`). A subject head that couldn't load is asked again later, and never fails the
 *   choices waiting for it (PREV-155).
 * - **Notifications are deferred**: `update()` never calls `changed` synchronously; changes are coalesced into one microtask.
 */
import type { CharacterRequest } from "./character-detail-request";
import { type ChoicePreviewSource, type PreviewKind, previewKey, TURNTABLE } from "./choice-preview";

export type PreviewSourceReply = { position: number; state: "ready" | "none" | "unprepared"; source?: ChoicePreviewSource;
  /** Unprepared because the host's background lane stayed busy (a derivation asked again later, not counted as a try). */
  busy?: boolean };
/** The host refused or failed a question (`code` from its answer, when it gave one). */
export class PreviewHostError extends Error {
  constructor(readonly code: string | null, readonly status: number) { super(`Choice previews aren't available (${status}${code ? ` ${code}` : ""}).`); }
}
/** A live turn's start that a newer start or a stop replaced before it finished: not a failure of its source (PREV-151). */
export class PreviewSuperseded extends Error {
  readonly code = "superseded";
  constructor() { super("A newer turn replaced this one."); }
}
export type ChoicePreviewPort = {
  /** Each position's source (host `previewSources`); `derive` asks for one ready choice's source to be derived now. Throws `PreviewHostError` on a refusal. */
  sources(request: CharacterRequest, option: string, kind: PreviewKind, positions: readonly number[], derive: number | null, signal: AbortSignal): Promise<PreviewSourceReply[]>;
  /** Load the subject head for a body in the worker, answering its identity (part of every key). */
  subject(body: "female" | "male"): Promise<string>;
  /** The stored image's URL for a key, or null when there is none yet. */
  stored(key: string): Promise<string | null>;
  /** Draw a source (in the worker; its turntable strip with `frames`), store it under its key and answer a URL to show it now, with the drawing's timings. */
  render(source: ChoicePreviewSource, key: string, frames?: number): Promise<{ url: string; timings?: unknown }>;
  /** A URL this service no longer shows (a row started again): an object URL behind it can be revoked. */
  release?(url: string): void;
  /** The service is gone: revoke what is held and stop the worker. */
  dispose?(): void;
  /**
   * The live turn (optional): keep one source uploaded in the worker (`start`, replacing any other; a replaced start rejects with
   * `PreviewSuperseded`), draw it at any angle (`frame`: an ImageBitmap and the worker's time, with the GPU waited for when `measure`),
   * and drop it (`stop`).
   */
  live?: {
    start(source: ChoicePreviewSource): Promise<void>;
    frame(turn: number, measure: boolean): Promise<{ bitmap: ImageBitmap; ms?: number; gpuMs?: number }>;
    stop(): void;
  };
};
/**
 * A row's pictures as the panel reads them: URLs by position, the turntable strips drawn so far (`frames` pictures side by side), the
 * positions with no picture possible, whether work remains, and a plain line when pictures can't be made now (null otherwise).
 */
export type ChoicePreviewRow = { readonly kind: PreviewKind; readonly urls: ReadonlyMap<number, string>; readonly spins: ReadonlyMap<number, string>;
  readonly frames: number; readonly none: ReadonlySet<number>; readonly busy: boolean;
  /** The live turn of the wanted choice once its source is uploaded (null while none, or while a person's change is prepared). */
  readonly live: PreviewLive | null;
  readonly notice: string | null };
/** A live turn: the choice it draws and a frame at any angle (null when the worker couldn't draw it). */
export type PreviewLive = { readonly position: number; frame(turn: number): Promise<ImageBitmap | null> };
export type PreviewAsk = { option: string; kind: PreviewKind; request: CharacterRequest; body: "female" | "male";
  /** The installed catalogue the positions index (its identity); a row shown for another one starts again. */
  catalogue?: string;
  /** The row's positions in view order (in view first, then nearest). */
  positions: readonly number[];
  selected: number | null; focus: number | null;
  /** The choice whose turntable is wanted now (hovered in the grid, or shown large in details), or null. */
  spin?: number | null;
  /** Preparing-ahead states by position (`r`: ready). */
  ready: (position: number) => boolean;
  /** A person's change is being prepared: nothing new starts. */
  busy: boolean };

type Item = { position: number; state: "unknown" | "unprepared" | "source" | "drawing" | "done" | "none" | "failed"; source?: ChoicePreviewSource;
  /** The V the source was looked up for (a source is shared, but a lookup answers one request). */
  request: string;
  /** Derivations that didn't give a source (one stopped for a person's change, or a failed question), up to `DERIVE_TRIES`. */
  tries: number;
  /** Its turntable strip: being drawn (or looked up), there, or impossible. */
  turn?: "drawing" | "done" | "failed" };
type Row = { option: string; kind: PreviewKind; scope: string; items: Map<number, Item>; urls: Map<number, string>; spins: Map<number, string>;
  none: Set<number>; view: ChoicePreviewRow; order: number;
  /** The choice this row last asked to spin, and its wish for a live turn (the newest wish holds the worker's one slot). */
  spin: number | null; want: { position: number; since: number } | null };
export type PreviewStats = { looked: number; derived: number; stored: number; drawn: number; failed: number; drawMs: number[]; timings: unknown[];
  /** Turntables: found stored, drawn, the time each drawing took end to end, and the wait from being wanted to being there. */
  spinStored: number; spun: number; spinMs: number[]; spinWaitMs: number[]; spinTimings: unknown[];
  /** Host questions that failed, and the waits they caused. */
  hostFailures: number };

const LOOKUP = 48, DERIVE_TRIES = 3;
/** Backoff after a failed host question or subject head: doubling from the first, at most the last. */
export const PREVIEW_RETRY = { firstMs: 1000, maxMs: 60_000 } as const;
/** After the host's lane stayed busy for a derivation, the next derivation waits this long. */
const BUSY_PAUSE_MS = 1000;
/** Consecutive host failures before the rows say pictures are waiting. */
const NOTICE_AFTER = 2;
export const PREVIEW_NOTICES = {
  version: "Pictures of choices need a fresh start: reload XF Studio (Ctrl+R) to show them again.",
  retrying: "Pictures of choices can't be made just now. XF Studio tries again shortly.",
} as const;

const isSuperseded = (error: unknown) => (error as { code?: unknown } | null)?.code === "superseded";
/** A drawing waited on a subject head that couldn't load: the choice keeps its source and is drawn later. */
class SubjectUnavailable extends Error {}

export class ChoicePreviewService {
  private rows = new Map<string, Row>();
  private ask: PreviewAsk | null = null;
  private looking = false;
  private deriving: { row: Row; position: number; request: string; controller: AbortController } | null = null;
  private drawing = false;
  private subject: { body: string; identity: Promise<string> } | null = null;
  private serial = 0;
  private controller = new AbortController();
  private disposed = false;
  /** Host questions: consecutive failures, when the next may be asked, and a stop until reload (another host version). */
  private hostFailures = 0;
  private askAfter = 0;
  private deriveAfter = 0;
  private halted = false;
  /** Subject heads that couldn't load: consecutive failures and when drawing may try again. */
  private subjectFailures = 0;
  private drawAfter = 0;
  private wake: { at: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private notifying = false;
  readonly stats: PreviewStats = { looked: 0, derived: 0, stored: 0, drawn: 0, failed: 0, drawMs: [], timings: [], spinStored: 0, spun: 0, spinMs: [],
    spinWaitMs: [], spinTimings: [], hostFailures: 0 };
  /** The turntable wanted last and since when (the wait is measured from then). */
  private wanted: { option: string; position: number; at: number } | null = null;
  /** The worker's one live slot: the row and choice it draws, and whether its source is uploaded. */
  private slot: { row: Row; position: number; ready: boolean; view?: PreviewLive } | null = null;
  /** Choices whose live turn failed (never retried this session). */
  private liveFailed = new Set<string>();
  private lastBusy = false;
  /** Verification only (`?verify=1` capture tools set it from the page): hold each strip drawing back this long, so its wait shows. */
  stripDelayMs = 0;
  /** Live-turn costs: frames drawn, the worker's time per frame, and every 15th frame with the GPU waited for. */
  readonly liveStats = { starts: 0, startMs: [] as number[], frames: 0, frameMs: [] as number[], gpuMs: [] as number[], failed: 0 };

  constructor(private readonly port: ChoicePreviewPort, private readonly changed: () => void, private readonly now: () => number = () => performance.now(),
    private readonly retry: { readonly firstMs: number; readonly maxMs: number } = PREVIEW_RETRY) {
    // Measurement hook (tools and `?verify=1` sessions read the costs from the page).
    (globalThis as { xfsChoicePreviews?: unknown }).xfsChoicePreviews = this;
  }
  /** The service's state for measurement: its rows' item states and its stats. */
  debug() {
    return { ask: this.ask && { option: this.ask.option, busy: this.ask.busy, positions: this.ask.positions.length, ready: this.ask.positions.filter(p => this.ask!.ready(p)).length },
      looking: this.looking, deriving: this.deriving?.position ?? null, drawing: this.drawing, halted: this.halted, hostFailures: this.hostFailures,
      rows: [...this.rows.values()].map(row => ({ option: row.option,
        states: [...row.items.values()].reduce<Record<string, number>>((counts, item) => { counts[item.state] = (counts[item.state] ?? 0) + 1; return counts; }, {}) })),
      stats: this.stats };
  }

  /** The panel shows a row: remember what it shows and start work. Answers the row's pictures so far (frozen; a new object on change). */
  update(ask: PreviewAsk): ChoicePreviewRow {
    this.ask = ask;
    const spin = ask.spin ?? null;
    if (spin !== null && (this.wanted?.option !== ask.option || this.wanted.position !== spin)) this.wanted = { option: ask.option, position: spin, at: this.now() };
    const scope = `${ask.body}|${ask.catalogue ?? ""}`;
    let row = this.rows.get(ask.option);
    if (!row || row.kind !== ask.kind || row.scope !== scope) {
      if (row) this.drop(row);
      const view: ChoicePreviewRow = Object.freeze({ kind: ask.kind, urls: new Map<number, string>(), spins: new Map<number, string>(), frames: TURNTABLE.frames,
        none: new Set<number>(), busy: true, live: null, notice: this.notice() });
      row = { option: ask.option, kind: ask.kind, scope, items: new Map(), urls: new Map(), spins: new Map(), none: new Set(), view, order: 0, spin: null, want: null };
      this.rows.set(ask.option, row);
    }
    row.order = ++this.serial;
    row.spin = spin;
    const request = JSON.stringify(ask.request);
    for (const position of ask.positions) {
      const item = row.items.get(position);
      // Another V: a choice not drawn yet is looked up again (its prepared request changed).
      if (!item) row.items.set(position, { position, state: "unknown", request, tries: 0 });
      else if (item.request !== request && (item.state === "unprepared" || item.state === "unknown")) { item.state = "unknown"; item.request = request; }
    }
    // A derivation for this row whose choice left it, or for another V, is abandoned (the host stops waiting for its lane).
    const deriving = this.deriving;
    if (deriving?.row === row && (deriving.request !== request || !ask.positions.includes(deriving.position))) deriving.controller.abort();
    this.wish(row);
    // A person's change pauses the live turn and resumes it after: the slot's row says so.
    if (ask.busy !== this.lastBusy) { this.lastBusy = ask.busy; if (this.slot) this.publish(this.slot.row); }
    this.pump();
    return row.view;
  }
  /** A row's pictures without asking for work (null before it was shown). */
  row(option: string): ChoicePreviewRow | null { return this.rows.get(option)?.view ?? null; }
  dispose(): void {
    this.disposed = true;
    this.controller.abort();
    if (this.wake) clearTimeout(this.wake.timer);
    if (this.slot) { this.slot = null; this.port.live?.stop(); }
    this.port.dispose?.();
  }

  // ---- The live turn ----

  /** The row's wish for a live turn, from the choice it last asked to spin: the strip must be there and its live turn not have failed. */
  private wish(row: Row) {
    if (!this.port.live) return;
    const position = row.spin, item = position === null ? undefined : row.items.get(position);
    const wanted = item?.source && item.turn === "done" && !this.liveFailed.has(`${row.option}/${position}`) ? position : null;
    if (wanted === null) row.want = null;
    else if (row.want?.position !== wanted) row.want = { position: wanted, since: ++this.serial };
    this.arbitrate();
  }
  /** Give the worker's one slot to the newest wish: stop what it draws if that changed, and start the newest (its row is told once uploaded). */
  private arbitrate() {
    const live = this.port.live;
    if (!live || this.disposed) return;
    let winner: Row | null = null;
    for (const row of this.rows.values()) if (row.want && (!winner || row.want.since > winner.want!.since)) winner = row;
    const slot = this.slot;
    if (slot && (slot.row !== winner || slot.position !== winner.want!.position)) {
      this.slot = null;
      live.stop();
      this.publish(slot.row);
    }
    if (!winner || this.slot) return;
    const position = winner.want!.position, item = winner.items.get(position)!;
    const current: NonNullable<ChoicePreviewService["slot"]> = { row: winner, position, ready: false };
    this.slot = current;
    this.liveStats.starts++;
    const began = this.now();
    live.start(item.source!).then(() => {
      if (this.slot !== current) return;
      current.ready = true;
      this.liveStats.startMs.push(this.now() - began);
      this.publish(current.row);
    }, error => {
      // Only superseded (another start or a stop came first): nothing failed, and the slot has moved on already.
      if (isSuperseded(error) && this.slot !== current) return;
      this.liveFailed.add(`${current.row.option}/${current.position}`);
      this.liveStats.failed++;
      if (this.slot === current) { this.slot = null; current.row.want = null; this.publish(current.row); this.arbitrate(); }
    });
  }
  /** The row's live turn as the panel reads it (paused while a person's change is prepared). */
  private liveView(row: Row): PreviewLive | null {
    const current = this.slot, live = this.port.live;
    if (!current?.ready || current.row !== row || !live || this.ask?.busy) return null;
    const stats = this.liveStats;
    // The same object while the turn lasts, so a tile keeps showing it across the row's other updates.
    return current.view ??= Object.freeze({ position: current.position, frame: (turn: number) => {
      if (this.slot !== current || this.ask?.busy) return Promise.resolve(null);
      const measure = stats.frames % 15 === 0;
      return live.frame(turn, measure).then(reply => {
        stats.frames++;
        if (reply.ms !== undefined && stats.frameMs.length < 2000) stats.frameMs.push(reply.ms);
        if (reply.gpuMs !== undefined && stats.gpuMs.length < 200) stats.gpuMs.push(reply.gpuMs);
        if (this.slot !== current) { reply.bitmap.close(); return null; }
        return reply.bitmap;
      }, () => null);
    } });
  }

  // ---- Rows and notifications ----

  /** A row that starts again (another body or catalogue): its work stops and its URLs are released. */
  private drop(row: Row) {
    this.rows.delete(row.option);
    if (this.deriving?.row === row) this.deriving.controller.abort();
    for (const url of [...row.urls.values(), ...row.spins.values()]) this.port.release?.(url);
    for (const key of [...this.liveFailed]) if (key.startsWith(`${row.option}/`)) this.liveFailed.delete(key);
    row.want = null;
    if (this.slot?.row === row) { this.slot = null; this.port.live?.stop(); }
  }
  private notice(): string | null {
    return this.halted ? PREVIEW_NOTICES.version : this.hostFailures >= NOTICE_AFTER ? PREVIEW_NOTICES.retrying : null;
  }
  /** The current row object for an option (a row dropped meanwhile gets nothing more). */
  private alive(row: Row) { return !this.disposed && this.rows.get(row.option) === row; }
  private publish(row: Row) {
    if (!this.alive(row)) return;
    const busy = !this.halted && [...row.items.values()].some(item => item.state === "unknown" || item.state === "source" || item.state === "drawing" || item.state === "unprepared");
    row.view = Object.freeze({ kind: row.kind, urls: new Map(row.urls), spins: new Map(row.spins), frames: TURNTABLE.frames, none: new Set(row.none), busy,
      live: this.liveView(row), notice: this.notice() });
    this.notify();
  }
  /** Tell the panel once, after the current call (never inside `update`, PREV-152). */
  private notify() {
    if (this.notifying || this.disposed) return;
    this.notifying = true;
    queueMicrotask(() => { this.notifying = false; if (!this.disposed) this.changed(); });
  }

  // ---- Scheduling ----

  private pump(): void {
    if (this.disposed || !this.ask || this.ask.busy) return;
    const now = this.now();
    if (!this.halted && now >= this.askAfter) {
      if (!this.looking) this.nextLookup();
      if (!this.deriving && now >= this.deriveAfter) this.nextDerive();
    }
    if (!this.drawing && now >= this.drawAfter) this.nextDrawing();
    // Something waits for its backoff: pump again then.
    const waiting = [this.askAfter, this.deriveAfter, this.drawAfter].filter(at => at > now);
    if (waiting.length) this.wakeAt(Math.min(...waiting));
  }
  private wakeAt(at: number) {
    if (this.wake && this.wake.at <= at) return;
    if (this.wake) clearTimeout(this.wake.timer);
    this.wake = { at, timer: setTimeout(() => { this.wake = null; this.pump(); }, Math.max(0, at - this.now())) };
  }
  /** A host question answered: the backoff ends, and the rows stop saying pictures are waiting. */
  private hostAnswered() {
    if (!this.hostFailures) return;
    const noticed = this.hostFailures >= NOTICE_AFTER;
    this.hostFailures = 0;
    this.askAfter = 0;
    if (noticed) for (const row of this.rows.values()) this.publish(row);
  }
  /** A host question failed: back off (doubling), or stop until reload when the host is another version. */
  private hostFailed(error: unknown) {
    if (this.disposed) return;
    this.stats.hostFailures++;
    if (error instanceof PreviewHostError && error.status === 409 && error.code === "unsupported_version") {
      this.halted = true;
      if (this.deriving) this.deriving.controller.abort();
    } else {
      this.hostFailures++;
      this.askAfter = this.now() + Math.min(this.retry.firstMs * 2 ** (this.hostFailures - 1), this.retry.maxMs);
    }
    for (const row of this.rows.values()) this.publish(row);
  }

  /** The current row's positions in priority order: chosen, pointer or focus, then view order. */
  private ordered(ask: PreviewAsk): number[] {
    const first = [ask.selected, ask.focus].filter((position): position is number => position !== null);
    return [...new Set([...first, ...ask.positions])];
  }

  /** Look up the choices shown whose sources aren't known yet (the host's index; nothing is derived). */
  private nextLookup(): void {
    const ask = this.ask!, row = this.rows.get(ask.option)!;
    const positions = this.ordered(ask).filter(position => row.items.get(position)?.state === "unknown").slice(0, LOOKUP);
    if (!positions.length) return;
    this.looking = true;
    const request = JSON.stringify(ask.request);
    this.port.sources(ask.request, ask.option, ask.kind, positions, null, this.controller.signal).then(replies => {
      this.hostAnswered();
      this.stats.looked += replies.length;
      for (const reply of replies) {
        const item = row.items.get(reply.position);
        if (!item || item.request !== request || item.state !== "unknown") continue;
        if (reply.state === "ready" && reply.source) { item.state = "source"; item.source = reply.source; }
        else if (reply.state === "none") { item.state = "none"; row.none.add(item.position); }
        else item.state = "unprepared";
      }
      this.publish(row);
    }, error => this.hostFailed(error)) // The choices stay unknown and are looked up again after the backoff.
      .finally(() => { this.looking = false; this.pump(); });
  }

  /** Derive the first ready choice without a source (one at a time, beside lookups and drawings). */
  private nextDerive(): void {
    const ask = this.ask!, row = this.rows.get(ask.option)!;
    const position = this.ordered(ask).find(position => ask.ready(position) && row.items.get(position)?.state === "unprepared");
    if (position === undefined) return;
    const item = row.items.get(position)!, request = JSON.stringify(ask.request), controller = new AbortController();
    const stop = () => controller.abort();
    this.controller.signal.addEventListener("abort", stop);
    const current = { row, position, request, controller };
    this.deriving = current;
    const counts = () => this.alive(row) && item.request === request && item.state === "unprepared";
    const tried = () => { if (++item.tries >= DERIVE_TRIES) item.state = "failed"; };
    this.port.sources(ask.request, ask.option, ask.kind, [position], position, controller.signal).then(replies => {
      this.hostAnswered();
      this.stats.derived++;
      const reply = replies.find(entry => entry.position === position);
      if (!reply || !counts()) return;
      if (reply.state === "ready" && reply.source) { item.state = "source"; item.source = reply.source; }
      else if (reply.state === "none") { item.state = "none"; row.none.add(item.position); }
      // The host's lane stayed busy: asked again shortly, not a try.
      else if (reply.busy) this.deriveAfter = this.now() + Math.min(BUSY_PAUSE_MS, this.retry.maxMs);
      // Asked to derive and still unprepared: the host couldn't this time (stopped for a person, or the choice is no longer ready).
      else tried();
      this.publish(row);
    }, error => {
      // Abandoned (the choice left the row, another V, or the service is gone): nothing failed.
      if (controller.signal.aborted) return;
      if (counts()) tried();
      this.hostFailed(error);
      this.publish(row);
    }).finally(() => {
      this.controller.signal.removeEventListener("abort", stop);
      if (this.deriving === current) this.deriving = null;
      this.pump();
    });
  }

  /** The subject head for a body, loaded once; one that couldn't load is forgotten, so the next drawing asks again (PREV-155). */
  private subjectFor(body: "female" | "male"): Promise<string> {
    if (this.subject?.body !== body) {
      const entry = { body, identity: this.port.subject(body) };
      entry.identity.catch(() => { if (this.subject === entry) this.subject = null; });
      this.subject = entry;
    }
    return this.subject.identity.then(identity => { this.subjectFailures = 0; return identity; }, error => { throw new SubjectUnavailable(String(error)); });
  }
  /** The subject head couldn't load: drawing waits (doubling) and the choice keeps its source. */
  private subjectFailed() {
    this.subjectFailures++;
    this.drawAfter = this.now() + Math.min(this.retry.firstMs * 2 ** (this.subjectFailures - 1), this.retry.maxMs);
  }

  /**
   * One drawing in the worker: the chosen and hovered choices' stills, then the wanted turntable, then the current row's first choice with
   * a source, else another row of the same kind, body and catalogue (most recent first).
   */
  private nextDrawing(): void {
    const ask = this.ask!, current = this.rows.get(ask.option)!;
    let pick: { row: Row; item: Item } | null = null;
    const order = this.ordered(ask), lead = new Set([ask.selected, ask.focus].filter(position => position !== null)).size;
    for (const [index, position] of order.entries()) {
      if (index === lead && this.nextTurn(ask, current)) return;
      const item = current.items.get(position);
      if (item?.state === "source") { pick = { row: current, item }; break; }
    }
    if (!pick && this.nextTurn(ask, current)) return;
    if (!pick) {
      for (const row of [...this.rows.values()].filter(row => row !== current && row.kind === ask.kind && row.scope === current.scope).sort((a, b) => b.order - a.order)) {
        const item = [...row.items.values()].find(entry => entry.state === "source");
        if (item) { pick = { row, item }; break; }
      }
    }
    if (!pick) return;
    const { row, item } = pick;
    item.state = "drawing";
    this.drawing = true;
    const began = this.now();
    this.subjectFor(ask.body).then(async identity => {
      const key = await previewKey(item.source!, identity);
      const stored = await this.port.stored(key);
      if (stored) { this.stats.stored++; return stored; }
      const drawn = await this.port.render(item.source!, key);
      this.stats.drawn++;
      this.stats.drawMs.push(this.now() - began);
      if (drawn.timings && this.stats.timings.length < 400) this.stats.timings.push(drawn.timings);
      return drawn.url;
    }).then(url => {
      item.state = "done";
      if (this.alive(row)) row.urls.set(item.position, url); else this.port.release?.(url);
    }, error => {
      if (error instanceof SubjectUnavailable) { item.state = "source"; this.subjectFailed(); return; }
      item.state = "failed"; this.stats.failed++;
    }).finally(() => { this.drawing = false; this.publish(row); this.pump(); });
  }

  /** Start the wanted choice's turntable when it has a source and no strip yet; answers whether it started. */
  private nextTurn(ask: PreviewAsk, row: Row): boolean {
    const position = ask.spin ?? null, item = position === null ? undefined : row.items.get(position);
    if (!item?.source || item.turn || (item.state !== "done" && item.state !== "source")) return false;
    item.turn = "drawing";
    this.drawing = true;
    const began = this.now();
    this.subjectFor(ask.body).then(async identity => {
      const key = await previewKey(item.source!, identity, "turntable");
      const stored = await this.port.stored(key);
      if (stored) { this.stats.spinStored++; return stored; }
      if (this.stripDelayMs > 0) await new Promise(resolve => setTimeout(resolve, Math.min(this.stripDelayMs, 10_000)));
      const drawn = await this.port.render(item.source!, key, TURNTABLE.frames);
      this.stats.spun++;
      this.stats.spinMs.push(this.now() - began);
      if (drawn.timings && this.stats.spinTimings.length < 100) this.stats.spinTimings.push(drawn.timings);
      return drawn.url;
    }).then(url => {
      item.turn = "done";
      if (!this.alive(row)) { this.port.release?.(url); return; }
      row.spins.set(item.position, url);
      // The strip is there: the row's live turn can start if it still wants this choice.
      this.wish(row);
      if (this.wanted?.option === row.option && this.wanted.position === item.position) this.stats.spinWaitMs.push(this.now() - this.wanted.at);
    }, error => {
      if (error instanceof SubjectUnavailable) { item.turn = undefined; this.subjectFailed(); return; }
      item.turn = "failed";
    }).finally(() => { this.drawing = false; this.publish(row); this.pump(); });
    return true;
  }
}
