/**
 * Focus (profiles design §3.3, §3.7): the one owner of where the person is working in a session, as plain data with a few operations.
 * DOM-free and deterministic; it decides nothing about what an action acts on. The input layer reads it to resolve a target, and names
 * that target in the action it dispatches; no application service reads it.
 *
 * - **View order.** Each pointer press or keyboard focus inside a view gives it the next number of the session's sequence (`seq`). The
 *   sequence never resets and is never truncated, so there are no ties: the most recently focused of any set of views is the one with
 *   the highest number.
 * - **The focused panel** is the panel instance holding keyboard focus, if any.
 * - **The shown tab** is the layout tab on screen (profiles design §3.3, decision D1 of experiment 044): switching tabs is
 *   navigation, stored with the session and never an Undo step.
 * - **The editing context** is the history scope of the last *editing* interaction (an edit, a gesture or a control commit), newest first
 *   with a few before it: the scope Ctrl+Z, the header's Undo and the History panel act on. Focusing History, the header, a menu or
 *   another tab doesn't change it. The history service records into it (`HistoryService.focus`), and the session stores the newest.
 * - **Focus never enters Undo**: nothing here is recorded in any history.
 */
import type { ViewId } from "../api/view-graph";
import { notifyAll } from "./listeners";

/** A history scope ID (`look:<collection>/<look>`, `character:<id>`, `view:<profile>`, `doc:<id>`). */
export type EditingScope = string;
/** Focus as plain data: what a session stores (`seq` is the session's). */
export type FocusData = {
  readonly seq: number;
  readonly views: Readonly<Record<ViewId, number>>;
  readonly panel?: string;
  /** The layout tab shown. */
  readonly tab?: string;
  /** The editing context (the newest of `recent`). */
  readonly editing?: EditingScope;
};
/** How many editing contexts are remembered, newest first. */
export const RECENT_EDITING_LIMIT = 8;

/** The most recently focused of `candidates` (by focus number); undefined when none of them was ever focused. */
export function topView(views: Readonly<Record<ViewId, number>>, candidates: Iterable<ViewId>): ViewId | undefined {
  let best: ViewId | undefined, at = 0;
  for (const view of candidates) { const seq = views[view]; if (seq !== undefined && seq > at) { at = seq; best = view; } }
  return best;
}

const sequence = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
/** Stored focus, validated: view numbers are positive safe integers, unique, and no higher than `seq` (raised to the highest when lower). */
export function focusDataOf(value: unknown, seq: unknown): FocusData {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const views: Record<ViewId, number> = {}, taken = new Set<number>();
  if (object.views && typeof object.views === "object" && !Array.isArray(object.views))
    for (const [view, number] of Object.entries(object.views as Record<string, unknown>)) {
      const at = sequence(number);
      if (at !== undefined && !taken.has(at)) { views[view] = at; taken.add(at); }
    }
  const top = Math.max(0, sequence(seq) ?? 0, ...Object.values(views));
  return { seq: top, views, ...(typeof object.panel === "string" ? { panel: object.panel } : {}),
    ...(typeof object.tab === "string" && object.tab ? { tab: object.tab } : {}),
    ...(typeof object.editing === "string" && object.editing ? { editing: object.editing } : {}) };
}

export class FocusService {
  private seq: number;
  private views: Record<ViewId, number>;
  private panel: string | undefined;
  private tab: string | undefined;
  private recentScopes: EditingScope[];
  private readonly listeners = new Set<() => void>();
  /** Open holds (`hold`), and whether anything changed under them. */
  private held = 0;
  private pending = false;

  constructor(data: FocusData = { seq: 0, views: {} }) {
    const valid = focusDataOf(data, data.seq);
    this.seq = valid.seq; this.views = { ...valid.views }; this.panel = valid.panel; this.tab = valid.tab;
    this.recentScopes = valid.editing ? [valid.editing] : [];
  }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  /**
   * Hold notifications until the returned release (an owner's operation that changes focus among other things settles first): listeners
   * hear once, after the last release, and only if something changed. Releasing twice does nothing.
   */
  hold(): () => void {
    this.held++;
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      if (--this.held === 0 && this.pending) { this.pending = false; notifyAll(this.listeners); }
    };
  }
  private changed() {
    if (this.held) { this.pending = true; return; }
    notifyAll(this.listeners);
  }

  /** Focus as plain data, detached. */
  snapshot(): FocusData {
    return { seq: this.seq, views: { ...this.views }, ...(this.panel ? { panel: this.panel } : {}), ...(this.tab ? { tab: this.tab } : {}),
      ...(this.recentScopes[0] ? { editing: this.recentScopes[0] } : {}) };
  }
  /** Replace everything with stored focus (a session opened again): the sequence only ever moves on. */
  restore(data: FocusData) {
    const valid = focusDataOf(data, data.seq);
    this.seq = Math.max(this.seq, valid.seq); this.views = { ...valid.views }; this.panel = valid.panel; this.tab = valid.tab;
    this.recentScopes = valid.editing ? [valid.editing] : [];
    this.changed();
  }

  // ----- Views and panels -----
  /** A pointer press or keyboard focus inside `view`: it becomes the most recently focused (already so: nothing changes). */
  focusView(view: ViewId) {
    if (this.views[view] !== undefined && this.views[view] === this.seq) return;
    this.views = { ...this.views, [view]: ++this.seq };
    this.changed();
  }
  /** A view was closed: it leaves the order (the others keep their numbers). */
  forgetView(view: ViewId) {
    if (this.views[view] === undefined) return;
    const { [view]: _gone, ...rest } = this.views;
    this.views = rest;
    this.changed();
  }
  /**
   * Views brought back with the focus numbers they had (a closed tab reopened, decision D13 of experiment 044): a number is restored only
   * where no other view holds it and it is no higher than the sequence, so numbers stay unique and the order stays as it was.
   */
  placeViews(numbers: Readonly<Record<ViewId, number>>) {
    const taken = new Set(Object.values(this.views)), placed: Record<ViewId, number> = {};
    for (const [view, at] of Object.entries(numbers))
      if (Number.isSafeInteger(at) && at > 0 && at <= this.seq && !taken.has(at) && this.views[view] === undefined) { placed[view] = at; taken.add(at); }
    if (!Object.keys(placed).length) return;
    this.views = { ...this.views, ...placed };
    this.changed();
  }
  /** Each view's focus number (higher: more recent). */
  viewOrder(): Readonly<Record<ViewId, number>> { return { ...this.views }; }
  /** The most recently focused of `candidates`. */
  topView(candidates: Iterable<ViewId>): ViewId | undefined { return topView(this.views, candidates); }
  /** The panel instance holding keyboard focus (undefined: none). */
  focusPanel(panel: string | undefined) {
    if (this.panel === panel) return;
    this.panel = panel;
    this.changed();
  }
  focusedPanel(): string | undefined { return this.panel; }
  /** Show a layout tab (undefined: none, an empty session). */
  showTab(tab: string | undefined) {
    if (this.tab === tab) return;
    this.tab = tab;
    this.changed();
  }
  shownTab(): string | undefined { return this.tab; }

  // ----- The editing context -----
  /** The last editing interaction was in `scope`: it becomes the editing context. */
  edited(scope: EditingScope) {
    if (this.recentScopes[0] === scope) return;
    this.recentScopes = [scope, ...this.recentScopes.filter(item => item !== scope)].slice(0, RECENT_EDITING_LIMIT);
    this.changed();
  }
  /** Scopes that can no longer be edited here leave the list (a document no experiment offers, a look that went away). */
  withdraw(match: (scope: EditingScope) => boolean) {
    const kept = this.recentScopes.filter(scope => !match(scope));
    if (kept.length === this.recentScopes.length) return;
    this.recentScopes = kept;
    this.changed();
  }
  /** The editing context, if any. */
  editing(): EditingScope | undefined { return this.recentScopes[0]; }
  /** The recent editing contexts, newest first. */
  recent(): readonly EditingScope[] { return [...this.recentScopes]; }
}
