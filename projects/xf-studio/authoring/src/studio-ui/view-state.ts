import { parseScrollAnchor, type ScrollAnchor, type UIPreferenceAction } from "../ui-preferences";

/**
 * View state (style guide "Remembered view state"): what a person folded or opened, and where each scroll container was, remembered
 * across reloads. Presentation state, never Undo, never part of a saved layout: it is the workspace's (the `expanded` and `scroll` UI
 * preferences, so a verification workspace keeps its own), per panel, whichever layout is showing.
 *
 * Every foldable control and remembered scroll container has a stable **view key**: a namespace (a panel or feature id), a colon or
 * dot, then its own path (`character:row:head/hair`, `expressions.mouth`, `panel:character`). The library's components read and write
 * through the bound store (`viewState()`), so a feature only names its keys:
 *
 * - `GroupSection` remembers its open state under its `key`; the Character panel's headings, rows and maker groups under `character:…`;
 *   a `TreeView`'s owner keeps its groups with a `RememberedSet`.
 * - A key that isn't shown yet (a mod not loaded) keeps its state until it shows again; the least recently set go first once a namespace
 *   or the whole store is over its bound.
 * - With no stored state a control opens as its own default says.
 *
 * The shell binds the preference-backed store once at mount (`bindViewState`); until then (tests, the style guide) state lasts the
 * session only.
 */
export interface ViewStateStore {
  /** The remembered open state; undefined: none (the control's default applies). */
  expanded(key: string): boolean | undefined;
  setExpanded(keys: readonly string[], open: boolean): void;
  /** The keys starting with `prefix` remembered folded. */
  folded(prefix: string): string[];
  anchor(key: string): ScrollAnchor | undefined;
  setAnchor(key: string, anchor: ScrollAnchor | undefined): void;
}

/** Session memory only (tests, the style guide, or before the shell binds the workspace's store). */
export class MemoryViewState implements ViewStateStore {
  private readonly open = new Map<string, boolean>();
  private readonly anchors = new Map<string, ScrollAnchor>();
  expanded(key: string) { return this.open.get(key); }
  setExpanded(keys: readonly string[], open: boolean) { for (const key of keys) this.open.set(key, open); }
  folded(prefix: string) { return [...this.open].filter(([key, open]) => !open && key.startsWith(prefix)).map(([key]) => key); }
  anchor(key: string) { return this.anchors.get(key); }
  setAnchor(key: string, anchor: ScrollAnchor | undefined) { if (anchor) this.anchors.set(key, anchor); else this.anchors.delete(key); }
}

type PreferencePort = {
  snapshot(): { readonly expanded?: { readonly [key: string]: boolean }; readonly scroll?: { readonly [key: string]: unknown } };
  capability(action: UIPreferenceAction): { available: boolean };
  dispatch(action: UIPreferenceAction): void;
};

/**
 * The workspace's store over the UI preferences: read once, then kept in memory (reads are free, so a panel may ask on every paint);
 * each change shows at once and is remembered best effort (a refused write still holds for the session).
 */
export class PreferenceViewState extends MemoryViewState {
  constructor(private readonly preferences: PreferencePort) {
    super();
    const stored = preferences.snapshot();
    for (const [key, open] of Object.entries(stored.expanded ?? {})) super.setExpanded([key], open);
    for (const [key, anchor] of Object.entries(stored.scroll ?? {})) super.setAnchor(key, parseScrollAnchor(anchor));
  }
  override setExpanded(keys: readonly string[], open: boolean) {
    const changed = keys.filter(key => this.expanded(key) !== open);
    if (!changed.length) return;
    super.setExpanded(changed, open);
    this.write({ kind: "expanded.set", keys: changed, expanded: open });
  }
  override setAnchor(key: string, anchor: ScrollAnchor | undefined) {
    if (JSON.stringify(this.anchor(key)) === JSON.stringify(anchor)) return;
    super.setAnchor(key, anchor);
    this.write({ kind: "scroll.set", key, ...(anchor ? { anchor } : {}) });
  }
  private write(action: UIPreferenceAction) {
    try { if (this.preferences.capability(action).available) this.preferences.dispatch(action); } catch { /* View state is best effort. */ }
  }
}

let bound: ViewStateStore = new MemoryViewState();
/** The store the library's components remember view state in. */
export const viewState = (): ViewStateStore => bound;
/** Bind the workspace's store (the shell, once at mount); `undefined` goes back to session memory (tests). */
export function bindViewState(store?: ViewStateStore) { bound = store ?? new MemoryViewState(); }

/**
 * A set of open IDs remembered under `prefix` (a tree's groups, for example): `has` is the remembered state, else `byDefault`.
 * Works as the `expanded` set a `TreeView` owner hands its tree.
 */
export class RememberedSet {
  constructor(private readonly prefix: string, private readonly byDefault: (id: string) => boolean = () => false) {}
  has(id: string) { return viewState().expanded(this.prefix + id) ?? this.byDefault(id); }
  set(id: string, open: boolean) { viewState().setExpanded([this.prefix + id], open); }
  /** The open ones among `ids` (the set a tree's `update` takes). */
  of(ids: Iterable<string>): Set<string> { return new Set([...ids].filter(id => this.has(id))); }
}
