import { h } from "../dom";
import type { TabStrip } from "./tab-strip";

/**
 * Panel header (style guide "Panel header"): a tab group's bar. From its start: the tab strip, a drag area that fills the rest, and
 * the header's actions (restore, collapse or expand, layout options). The actions never shrink and never scroll: however narrow the
 * group, and on a folded group's vertical strip too, they stay whole and in reach; the tab strip gives up space first, condensing
 * through its stages (TabStrip). The drag area keeps a minimum so the group can always be grabbed.
 *
 * The header owns no layout decisions: its owner wires the drag area and the actions, and calls `fit` after layout. `observe` fits the
 * header again whenever its size changes (one ResizeObserver per owner, `HeaderFitter`).
 */
export const DRAG_MIN = 24;
export type PanelHeaderOptions = {
  strip: TabStrip;
  /** `vertical`: the header of a group folded along a row (a full-height strip). */
  orientation?: "horizontal" | "vertical";
  /** The drag area's tooltip and pointer handling (moving the group or window); omit for a header that doesn't move. */
  drag?: { title: string; onPointerDown(event: PointerEvent, handle: HTMLElement): void; onDoubleClick?(): void };
  /** The header's action buttons, in order (icon buttons: components/icon-button.ts). */
  actions: readonly (HTMLElement | null | undefined | false)[];
};

export class PanelHeader {
  readonly element: HTMLElement;
  readonly strip: TabStrip;
  readonly fill: HTMLElement;
  readonly actions: HTMLElement;
  private readonly vertical: boolean;
  constructor(options: PanelHeaderOptions) {
    this.strip = options.strip;
    this.vertical = options.orientation === "vertical";
    this.fill = h("div", { class: "dock-tabbar-fill", title: options.drag?.title });
    if (options.drag) {
      const drag = options.drag;
      this.fill.addEventListener("pointerdown", event => drag.onPointerDown(event, this.fill));
      if (drag.onDoubleClick) this.fill.addEventListener("dblclick", () => drag.onDoubleClick!());
    }
    this.actions = h("div", { class: "panel-header-actions" }, ...options.actions.filter((action): action is HTMLElement => !!action));
    this.element = h("div", { class: "dock-tabbar panel-header", "data-orientation": this.vertical ? "vertical" : "horizontal" },
      this.strip.element, this.fill, this.actions);
  }
  /** The length the tab strip may take: the header's inner length less its actions and the drag area's minimum. */
  available(): number {
    const box = this.element.getBoundingClientRect();
    return Math.max(0, (this.vertical ? box.height : box.width) - this.fixedLength());
  }
  /**
   * The header's length with every tab label whole: its padding, actions and drag minimum plus the tab strip's full length (as the
   * last `fit` measured it). A stack of vertical strips sizes each strip by this, so the room each gets never depends on how far it
   * has condensed (UI-120).
   */
  naturalLength(): number { return this.fixedLength() + this.strip.fullLength; }
  /** Padding, actions and the drag area's minimum: the part of the header's length the tab strip never gets. */
  private fixedLength(): number {
    const actions = this.actions.getBoundingClientRect();
    const style = typeof getComputedStyle === "function" ? getComputedStyle(this.element) : undefined;
    const pad = (a?: string, b?: string) => (parseFloat(a ?? "") || 0) + (parseFloat(b ?? "") || 0);
    const padding = this.vertical ? pad(style?.paddingTop, style?.paddingBottom) : pad(style?.paddingLeft, style?.paddingRight);
    return padding + (this.vertical ? actions.height : actions.width) + DRAG_MIN;
  }
  /** Condense the tab strip to what fits now. */
  fit() { if (this.element.isConnected) this.strip.fit(this.available()); }
}

/**
 * Fits a set of headers after layout and again whenever one of them changes size: one ResizeObserver for all of them (none where the
 * page has no ResizeObserver, as in tests). `track` replaces the set (the dock renders its groups afresh on each layout).
 */
export class HeaderFitter {
  private headers = new Map<Element, PanelHeader>();
  private readonly observer = typeof ResizeObserver === "function"
    ? new ResizeObserver(entries => { for (const entry of entries) { const header = this.headers.get(entry.target); if (header) this.fit(header); } }) : undefined;
  /** `fitted` hears each header after it fits (the dock sizes a stack of vertical strips by their natural lengths). */
  constructor(private readonly fitted?: (header: PanelHeader) => void) {}
  track(headers: readonly PanelHeader[]) {
    this.observer?.disconnect();
    this.headers = new Map(headers.map(header => [header.element, header]));
    for (const header of headers) { this.fit(header); this.observer?.observe(header.element); }
  }
  /** Fit every tracked header now (a window resize the observer may report late). */
  fitAll() { for (const header of this.headers.values()) this.fit(header); }
  private fit(header: PanelHeader) { header.fit(); this.fitted?.(header); }
  disconnect() { this.observer?.disconnect(); this.headers.clear(); }
}
