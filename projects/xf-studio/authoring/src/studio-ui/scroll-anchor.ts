import type { ScrollAnchor } from "../ui-preferences";
import { viewState, type ViewStateStore } from "./view-state";

/**
 * Remembered scroll positions (style guide "Remembered view state"). What matters is what the person was looking at, not a pixel count:
 * a container remembers the element at its top edge (its **anchor**, by view key) and how far it was scrolled past that edge (its
 * **clip offset**), and a restore puts that element's top at minus the offset, so the same rows are at the top even when content above
 * them loads later or is a different height.
 *
 * - **Recording:** on scroll (debounced), when the container is torn down, and before the page is hidden (`flushScrollMemories`). The
 *   anchor is the deepest keyed element crossing the top edge (else the first below it), with up to four keyed elements before it (nearest
 *   first: one around the anchor, such as its section, with how far it is scrolled past; one wholly above it, at the top edge) and the
 *   plain scroll position.
 * - **Restoring:** once the content is there. Content that arrives later (a catalogue, a virtualised tree's rows) is waited for: each
 *   change to the container tries again until the anchor sits exactly where it was, or the patience runs out. A missing anchor falls back
 *   to the nearest element before it that is still there, then to the plain scroll position.
 * - **Never fights the person:** a wheel, touch, key or pointer press in the container drops a pending restore, and nothing is recorded
 *   while a restore is pending. Any other scrolling while it is pending (a focus, a reveal, content clamping) is corrected at once.
 * - **A choice never moves the view** (`holdScroll`): when the person chooses something in a list, what is at the top edge stays there
 *   for a moment, whatever the choice rebuilds, focuses or moves above it, until they scroll or press something.
 * - **Reveals go through it** (`revealInView`): bringing an element into view scrolls only its own container, minimally, and never while
 *   a restore or a hold is pending.
 *
 * Keys: `data-view-key` on the elements (GroupSection, `section()`, the Character panel's groups, sections and rows set it); a source
 * of its own (`AnchorSource`) where the elements aren't all in the page (a virtualised `TreeView`).
 */
export const VIEW_KEY = "data-view-key";
const NEAR = 4;
/** "exact": the anchor is where it was; "near": a fallback, or the anchor short of its place (more may come); "wait": nothing to go by yet. */
export type RestoreResult = "exact" | "near" | "wait";
export interface AnchorSource {
  /** Where the container is now; undefined when it can't tell (hidden): the remembered anchor stays. */
  capture(): ScrollAnchor | undefined;
  restore(anchor: ScrollAnchor): RestoreResult;
}

/** The container's top edge (inside its border) in the viewport. */
const edge = (container: HTMLElement) => container.getBoundingClientRect().top + (container.clientTop || 0);
type Keyed = { element: HTMLElement; key: string; top: number; height: number };
function keyed(container: HTMLElement): Keyed[] {
  const result: Keyed[] = [];
  for (const element of container.querySelectorAll<HTMLElement>(`[${VIEW_KEY}]`)) {
    const key = element.getAttribute(VIEW_KEY), rect = element.getBoundingClientRect();
    // A folded or hidden element has no box: it can't anchor anything.
    if (key && rect.height > 0) result.push({ element, key, top: rect.top, height: rect.height });
  }
  return result;
}

/** Capture the anchor of a container whose elements carry `data-view-key` (document order: an ancestor before its descendants). */
export function captureAnchor(container: HTMLElement): ScrollAnchor | undefined {
  if (!container.clientHeight) return undefined;
  const scrollTop = Math.round(container.scrollTop || 0);
  if (scrollTop <= 0) return { top: 0 };
  const line = edge(container), shown = keyed(container);
  // The deepest element crossing the top edge (the last one in document order), else the first below it.
  let index = -1;
  shown.forEach((entry, at) => { if (entry.top <= line && entry.top + entry.height > line) index = at; });
  if (index < 0) index = shown.findIndex(entry => entry.top >= line);
  if (index < 0) return { top: scrollTop };
  const anchor = shown[index]!, near: { key: string; offset: number }[] = [], seen = new Set([anchor.key]);
  for (let at = index - 1; at >= 0 && near.length < NEAR; at--) {
    const entry = shown[at]!;
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    // An element around the anchor (its section) keeps how far it is scrolled past; one wholly above goes to the top edge.
    const past = line - entry.top;
    near.push({ key: entry.key, offset: past < entry.height ? Math.round(past) : 0 });
  }
  return { key: anchor.key, offset: Math.round(line - anchor.top), ...(near.length ? { near } : {}), top: scrollTop };
}

/** Scroll so the element's top sits `offset` px above the top edge; true when it got there (the content was tall enough). */
function place(container: HTMLElement, element: HTMLElement, offset: number): boolean {
  const line = edge(container);
  container.scrollTop = (container.scrollTop || 0) + (element.getBoundingClientRect().top - line) + offset;
  return Math.abs(element.getBoundingClientRect().top - line + offset) < 1;
}

/** Restore a captured anchor in a container whose elements carry `data-view-key`. */
export function restoreAnchor(container: HTMLElement, anchor: ScrollAnchor): RestoreResult {
  if (!container.clientHeight) return "wait";
  const shown = keyed(container), find = (key: string) => shown.find(entry => entry.key === key);
  if (anchor.key) {
    const entry = find(anchor.key);
    if (entry) return place(container, entry.element, anchor.offset ?? 0) ? "exact" : "near";
    for (const near of anchor.near ?? []) {
      const other = find(near.key);
      // Scrolled past as far as it was, but never beyond its own bottom (it may be shorter now).
      if (other) { place(container, other.element, Math.min(near.offset, Math.max(0, other.height - 1))); return "near"; }
    }
  }
  container.scrollTop = anchor.top;
  if (anchor.key) return "wait";
  return Math.abs((container.scrollTop || 0) - anchor.top) < 1 ? "exact" : "near";
}

export const domAnchorSource = (container: HTMLElement): AnchorSource =>
  ({ capture: () => captureAnchor(container), restore: anchor => restoreAnchor(container, anchor) });

const memories = new Set<ScrollMemory>();
/** Record every remembered container now (before the page is hidden or unloaded; the shell calls it ahead of the workspace save). */
export function flushScrollMemories() { for (const memory of memories) memory.flush(); }

export type ScrollMemoryOptions = {
  /** How the container's elements are found and scrolled to (default: `data-view-key` elements). */
  source?: AnchorSource;
  /** Where anchors are remembered (default: the bound view-state store). */
  store?: () => ViewStateStore;
  /** Debounce of recording after a scroll, in ms (default 200). */
  delayMs?: number;
  /** How long a restore waits for its content, in ms (default 30 s). */
  patienceMs?: number;
  /** Watch the container's content for changes (default true where MutationObserver exists); else the owner calls `contentChanged`. */
  observe?: boolean;
};

/** One remembered scroll container: records its anchor under `key` and restores it once its content is there. */
export class ScrollMemory {
  private readonly source: AnchorSource;
  private readonly store: () => ViewStateStore;
  private pending: ScrollAnchor | undefined;
  private deadline = 0;
  /** A hold (`hold`): keeps its anchor until the deadline even once exact (later changes may still move it). */
  private sticky = false;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private mutations?: MutationObserver;
  private sizes?: ResizeObserver;
  private disposed = false;
  constructor(readonly container: HTMLElement, readonly key: string, private readonly options: ScrollMemoryOptions = {}) {
    this.source = options.source ?? domAnchorSource(container);
    this.store = options.store ?? viewState;
    container.addEventListener("scroll", this.scrolled, { passive: true });
    for (const type of USER_INPUT) container.addEventListener(type, this.userInput, { passive: true });
    memories.add(this);
    const stored = this.store().anchor(key);
    if (stored && (stored.top > 0 || stored.key)) {
      this.pending = stored;
      this.deadline = Date.now() + (options.patienceMs ?? 30_000);
      this.watch();
      this.contentChanged();
    }
  }
  /** Whether a restore (or a hold) is still pending. */
  get restoring() { return !!this.pending; }
  /** The content changed (a virtualised list's owner calls this; observed containers need not): try the pending restore again. */
  contentChanged() {
    if (!this.pending) return;
    if (Date.now() > this.deadline) { this.settle(); return; }
    if (this.source.restore(this.pending) === "exact" && !this.sticky) this.settle();
  }
  /**
   * Keep what is at the top edge where it is for `ms` (the person just chose something): whatever the choice rebuilds, focuses, reveals
   * or moves above it, their view stays, until they scroll or press something here.
   */
  hold(ms = 1500) {
    if (this.disposed) return;
    const anchor = this.source.capture();
    if (!anchor) return;
    this.settle();
    this.pending = anchor;
    this.sticky = true;
    this.deadline = Date.now() + ms;
    this.holdTimer = setTimeout(() => this.settle(), ms);
    this.watch();
  }
  /** Record now if a scroll is waiting to be recorded. */
  flush() {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.record();
  }
  /** Record where it is (the content still in place) and stop. */
  dispose() {
    if (this.disposed) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.record();
    this.disposed = true;
    this.settle();
    this.container.removeEventListener("scroll", this.scrolled);
    for (const type of USER_INPUT) this.container.removeEventListener(type, this.userInput);
    memories.delete(this);
  }
  private record() {
    if (this.pending || this.disposed || !this.container.isConnected) return;
    const anchor = this.source.capture();
    // At the very top nothing needs remembering.
    if (anchor) this.store().setAnchor(this.key, anchor.top === 0 && !anchor.key ? undefined : anchor);
  }
  private readonly scrolled = () => {
    // While a restore or a hold is pending, scrolling is never the person's (their input settles it first): put the anchor back.
    if (this.pending) { this.contentChanged(); return; }
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; this.record(); }, this.options.delayMs ?? 200);
  };
  /** The person scrolled, pressed or typed here: their position wins over a restore still waiting. */
  private readonly userInput = () => { if (this.pending) this.settle(); };
  private watch() {
    if (this.options.observe === false) return;
    const retry = () => this.contentChanged();
    if (typeof MutationObserver === "function") {
      this.mutations = new MutationObserver(retry);
      this.mutations.observe(this.container, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "style"] });
    }
    if (typeof ResizeObserver === "function") {
      this.sizes = new ResizeObserver(retry);
      this.sizes.observe(this.container);
      for (const child of this.container.children) this.sizes.observe(child);
    }
  }
  private settle() {
    this.pending = undefined;
    this.sticky = false;
    if (this.holdTimer !== undefined) clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    this.mutations?.disconnect(); this.sizes?.disconnect();
    this.mutations = this.sizes = undefined;
  }
}
/** The innermost remembered container holding `element`. */
function memoryOf(element: HTMLElement): ScrollMemory | undefined {
  let found: ScrollMemory | undefined;
  for (const memory of memories) if (memory.container.contains(element) && (!found || found.container.contains(memory.container))) found = memory;
  return found;
}
/** The person chose something in `element` (a choice list): keep their view where it is for a moment (`ScrollMemory.hold`). */
export function holdScroll(element: HTMLElement, ms?: number) { memoryOf(element)?.hold(ms); }
/**
 * Bring `element` into view within its own scroll container only, as little as needed (its top edge first when it is taller than the
 * view); nothing while that container's restore or hold is pending. Outside a remembered container, the browser's nearest scroll.
 */
export function revealInView(element: HTMLElement) {
  if (!element.isConnected) return;
  const memory = memoryOf(element);
  if (!memory) { if (typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "nearest" }); return; }
  if (memory.restoring) return;
  const container = memory.container, line = edge(container), bottom = line + container.clientHeight, rect = element.getBoundingClientRect();
  if (rect.top < line) container.scrollTop -= line - rect.top;
  else if (rect.bottom > bottom) container.scrollTop += Math.min(rect.bottom - bottom, rect.top - line);
}
/** What the person does to a container that means their position wins. */
const USER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
