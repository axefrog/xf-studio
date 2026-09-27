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
 *   derivations only in its background lane.
 * - **One job of each kind at a time:** one question to the host and one drawing in the worker, side by side.
 * - **Failures stay quiet.** A drawing that fails leaves the choice without a picture for the session (its tile keeps the glyph); a lost
 *   worker context is recreated once by the worker itself.
 */
import type { CharacterRequest } from "./character-detail-request";
import { type ChoicePreviewSource, type PreviewKind, previewKey } from "./choice-preview";

export type PreviewSourceReply = { position: number; state: "ready" | "none" | "unprepared"; source?: ChoicePreviewSource };
export type ChoicePreviewPort = {
  /** Each position's source (host `previewSources`); `derive` asks for one ready choice's source to be derived now. */
  sources(request: CharacterRequest, option: string, kind: PreviewKind, positions: readonly number[], derive: number | null, signal: AbortSignal): Promise<PreviewSourceReply[]>;
  /** Load the subject head for a body in the worker, answering its identity (part of every key). */
  subject(body: "female" | "male"): Promise<string>;
  /** The stored image's URL for a key, or null when there is none yet. */
  stored(key: string): Promise<string | null>;
  /** Draw a source (in the worker), store it under its key and answer a URL to show it now, with the drawing's timings. */
  render(source: ChoicePreviewSource, key: string): Promise<{ url: string; timings?: unknown }>;
};
/** A row's pictures as the panel reads them: URLs by position, the positions with no picture possible, and whether work remains. */
export type ChoicePreviewRow = { readonly kind: PreviewKind; readonly urls: ReadonlyMap<number, string>; readonly none: ReadonlySet<number>; readonly busy: boolean };
export type PreviewAsk = { option: string; kind: PreviewKind; request: CharacterRequest; body: "female" | "male";
  /** The row's positions in view order (in view first, then nearest). */
  positions: readonly number[];
  selected: number | null; focus: number | null;
  /** Preparing-ahead states by position (`r`: ready). */
  ready: (position: number) => boolean;
  /** A person's change is being prepared: nothing new starts. */
  busy: boolean };

type Item = { position: number; state: "unknown" | "unprepared" | "source" | "drawing" | "done" | "none" | "failed"; source?: ChoicePreviewSource;
  /** The V the source was looked up for (a source is shared, but a lookup answers one request). */
  request: string;
  /** Derivations asked for (one stopped for a person's change is asked again, up to `DERIVE_TRIES`). */
  tries: number };
type Row = { option: string; kind: PreviewKind; items: Map<number, Item>; urls: Map<number, string>; none: Set<number>; view: ChoicePreviewRow; order: number };
export type PreviewStats = { looked: number; derived: number; stored: number; drawn: number; failed: number; drawMs: number[]; timings: unknown[] };

const LOOKUP = 48, DERIVE_TRIES = 3;

export class ChoicePreviewService {
  private rows = new Map<string, Row>();
  private ask: PreviewAsk | null = null;
  private asking = false;
  private drawing = false;
  private subject: { body: string; identity: Promise<string> } | null = null;
  private serial = 0;
  private controller = new AbortController();
  private disposed = false;
  readonly stats: PreviewStats = { looked: 0, derived: 0, stored: 0, drawn: 0, failed: 0, drawMs: [], timings: [] };

  constructor(private readonly port: ChoicePreviewPort, private readonly changed: () => void, private readonly now: () => number = () => performance.now()) {
    // Measurement hook (tools and `?verify=1` sessions read the costs from the page).
    (globalThis as { xfsChoicePreviews?: unknown }).xfsChoicePreviews = this;
  }
  /** The service's state for measurement: its rows' item states and its stats. */
  debug() {
    return { ask: this.ask && { option: this.ask.option, busy: this.ask.busy, positions: this.ask.positions.length, ready: this.ask.positions.filter(p => this.ask!.ready(p)).length },
      asking: this.asking, drawing: this.drawing, rows: [...this.rows.values()].map(row => ({ option: row.option,
        states: [...row.items.values()].reduce<Record<string, number>>((counts, item) => { counts[item.state] = (counts[item.state] ?? 0) + 1; return counts; }, {}) })),
      stats: this.stats };
  }

  /** The panel shows a row: remember what it shows and start work. Answers the row's pictures so far (frozen; a new object on change). */
  update(ask: PreviewAsk): ChoicePreviewRow {
    this.ask = ask;
    let row = this.rows.get(ask.option);
    if (!row || row.kind !== ask.kind) {
      const view: ChoicePreviewRow = Object.freeze({ kind: ask.kind, urls: new Map<number, string>(), none: new Set<number>(), busy: true });
      row = { option: ask.option, kind: ask.kind, items: new Map(), urls: new Map(), none: new Set(), view, order: 0 };
      this.rows.set(ask.option, row);
    }
    row.order = ++this.serial;
    const request = JSON.stringify(ask.request);
    for (const position of ask.positions) {
      const item = row.items.get(position);
      // Another V: a choice not drawn yet is looked up again (its prepared request changed).
      if (!item) row.items.set(position, { position, state: "unknown", request, tries: 0 });
      else if (item.request !== request && (item.state === "unprepared" || item.state === "unknown")) { item.state = "unknown"; item.request = request; }
    }
    this.pump();
    return row.view;
  }
  /** A row's pictures without asking for work (null before it was shown). */
  row(option: string): ChoicePreviewRow | null { return this.rows.get(option)?.view ?? null; }
  dispose(): void { this.disposed = true; this.controller.abort(); }

  /** The current row's positions in priority order: chosen, pointer or focus, then view order. */
  private ordered(ask: PreviewAsk): number[] {
    const first = [ask.selected, ask.focus].filter((position): position is number => position !== null);
    return [...new Set([...first, ...ask.positions])];
  }
  private publish(row: Row) {
    const busy = [...row.items.values()].some(item => item.state === "unknown" || item.state === "source" || item.state === "drawing" || item.state === "unprepared");
    row.view = Object.freeze({ kind: row.kind, urls: new Map(row.urls), none: new Set(row.none), busy });
    if (!this.disposed) this.changed();
  }

  private pump(): void {
    if (this.disposed || !this.ask || this.ask.busy) return;
    if (!this.asking) this.nextQuestion();
    if (!this.drawing) this.nextDrawing();
  }

  /** One question to the host: look up the ready choices not known yet; else derive the first ready one without a source. */
  private nextQuestion(): void {
    const ask = this.ask!, row = this.rows.get(ask.option)!;
    // Stored sources are looked up for every choice shown (a restart shows the row's pictures at once, before preparing ahead has checked
    // each choice again: a picture of the same choice, kept until a new one replaces it); only a ready choice's source is derived.
    const order = this.ordered(ask);
    const unknown = order.filter(position => row.items.get(position)?.state === "unknown").slice(0, LOOKUP);
    const derive = unknown.length ? null : order.find(position => ask.ready(position) && row.items.get(position)?.state === "unprepared") ?? null;
    if (!unknown.length && derive === null) return;
    const positions = unknown.length ? unknown : [derive!];
    this.asking = true;
    const request = JSON.stringify(ask.request);
    this.port.sources(ask.request, ask.option, ask.kind, positions, derive, this.controller.signal).then(replies => {
      this.stats.looked += replies.length;
      if (derive !== null) this.stats.derived++;
      for (const reply of replies) {
        const item = row.items.get(reply.position);
        if (!item || item.request !== request || (item.state !== "unknown" && item.state !== "unprepared")) continue;
        if (reply.state === "ready" && reply.source) { item.state = "source"; item.source = reply.source; }
        else if (reply.state === "none") { item.state = "none"; row.none.add(item.position); }
        // Asked to derive and still unprepared: the host couldn't this time (stopped for a person, or the choice is no longer ready).
        else item.state = derive === item.position && ++item.tries >= DERIVE_TRIES ? "failed" : "unprepared";
      }
      this.publish(row);
    }, () => {
      for (const position of positions) { const item = row.items.get(position); if (item?.state === "unknown") item.state = "unprepared"; }
    }).finally(() => { this.asking = false; this.pump(); });
  }

  /** One drawing in the worker: the current row's first choice with a source, else another row of the same kind (most recent first). */
  private nextDrawing(): void {
    const ask = this.ask!, current = this.rows.get(ask.option)!;
    let pick: { row: Row; item: Item } | null = null;
    for (const position of this.ordered(ask)) {
      const item = current.items.get(position);
      if (item?.state === "source") { pick = { row: current, item }; break; }
    }
    if (!pick) {
      for (const row of [...this.rows.values()].filter(row => row !== current && row.kind === ask.kind).sort((a, b) => b.order - a.order)) {
        const item = [...row.items.values()].find(entry => entry.state === "source");
        if (item) { pick = { row, item }; break; }
      }
    }
    if (!pick) return;
    const { row, item } = pick;
    item.state = "drawing";
    this.drawing = true;
    if (this.subject?.body !== ask.body) this.subject = { body: ask.body, identity: this.port.subject(ask.body) };
    const began = this.now();
    this.subject.identity.then(async identity => {
      const key = await previewKey(item.source!, identity);
      const stored = await this.port.stored(key);
      if (stored) { this.stats.stored++; return stored; }
      const drawn = await this.port.render(item.source!, key);
      this.stats.drawn++;
      this.stats.drawMs.push(this.now() - began);
      if (drawn.timings && this.stats.timings.length < 400) this.stats.timings.push(drawn.timings);
      return drawn.url;
    }).then(url => { item.state = "done"; row.urls.set(item.position, url); },
      () => { item.state = "failed"; this.stats.failed++; })
      .finally(() => { this.drawing = false; this.publish(row); this.pump(); });
  }
}
