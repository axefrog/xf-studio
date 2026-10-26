/**
 * A 3D view panel per view (experiment 044 P2-iii-b; profiles design §5, view-graph-design.md §3.5): each view of the shown tab has its own
 * dock panel, `head` for the main view and `view.<id>` for the others (the graph names it: its snapshot's `panel`), made and withdrawn as the
 * tab's views change. One view is drawn at a time (phase 4b brings more), so the one canvas goes to the pane of the view whose picture it
 * holds; every other view's pane shows the not-drawn state (U7) and never the canvas.
 *
 * Presentation only: it reads the shown tab's views and the drawn view (`viewport.snapshot().head`) and asks the dock and the viewport to
 * place things. Drawing a view is the person's focus (`focus.view`), which the composition root follows; nothing here holds view state.
 */
import type { ViewId } from "../../platform/api/view-graph";
import type { DrawnViews } from "../../app/viewport-attachment";
import { serializeDockState } from "../dock/persist";
import type { DockView, PanelSpec } from "../dock/dock-view";
import type { DockState, PanelId } from "../dock/layout";
import type { PanelContribution } from "../views/contribution";
import type { PanelController } from "./collection";
import type { ViewOpening } from "../../app/profiles/profile-sessions";

/** What a 3D view's pane shows: the picture (the canvas is in it), its own progress while it is made ready, or that it isn't drawn (U7). */
export type ViewPaneState = "canvas" | "preparing" | "not-drawn";
/** A view of the shown tab and the dock panel that shows it. */
export type ShownView = { readonly view: ViewId; readonly panel: PanelId };

/**
 * The pane state of `view`: the view whose picture the canvas holds has the canvas (the drawn one when no picture is on it yet: its pane
 * shows the loading or setup state); the drawn view while another keeps its picture is being made ready; any other view isn't drawn.
 */
export function viewPaneState(view: ViewId | undefined, head: DrawnViews): ViewPaneState {
  if (view === undefined) return "not-drawn";
  if (view === canvasView(head)) return "canvas";
  return view === head.drawn ? "preparing" : "not-drawn";
}
/** The view whose pane holds the canvas: the one whose picture is on it, else the drawn one (undefined: nothing is drawn). */
export const canvasView = (head: DrawnViews): ViewId | undefined => head.onCanvas ?? head.drawn;

/** The views of `tab` in graph order, with their panels (a view with no tab is the shown tab's: phase 1's graphs). */
export function tabViews(views: readonly { readonly id: ViewId; readonly tab?: string; readonly panel: string }[], tab: string | undefined): ShownView[] {
  return views.filter(view => (view.tab ?? tab) === tab).map(view => ({ view: view.id, panel: view.panel }));
}

/** Every live or retained view's panel, including other tabs' and newer builds' views. Missing views have no place to restore. */
export function viewPanelIds(graph: { readonly views: readonly { readonly panel: string }[]; readonly retained?: readonly { readonly panel: string }[] } | null): string[] {
  return graph ? [...graph.views, ...(graph.retained ?? [])].map(view => view.panel) : [];
}

/**
 * The catalogue entries of the shown tab's view panels, from the shell's 3D view entry (`head`): the same title, icon, purpose, context and
 * home (the stage), one per view in graph order, so the factory arrangement puts a new view's panel beside the others.
 */
export function viewPanelEntries<E extends PanelContribution>(base: E, panels: readonly PanelId[]): E[] {
  return panels.map(id => ({ ...base, id }));
}

/** A 3D view pane's controller: a panel, with the slot the canvas goes into while the pane holds the picture. */
export type ViewPaneController = PanelController & { readonly slot: HTMLElement; readonly runtime?: import("../runtime").StudioRuntime };

export type ViewPanelsDeps = {
  /** Bind the other reusable panel controllers before the destination dock can show or update them. */
  instances?: { controllers(): readonly PanelController[]; instance(panel: PanelId, tab?: string): string };
  /** Registration changes wait for this owner's destination transaction. Cleanup runs after the dock swaps all specs. */
  contributions?: { pending(): boolean; reconcile(tab: string | undefined): (() => void) | void };
  /** The shown tab and its saved arrangement. A tab switch or an external arrangement restore is one dock load, never incremental saves. */
  arrangement(): { readonly tab?: string; readonly layout: unknown };
  /** The session's initial/replayed opening intent, consumed once after its pane exists. */
  opening?(): ViewOpening | undefined;
  openView?(panel: PanelId, arrangement: unknown, focus: boolean): void;
  /** Load the captured destination arrangement with the reconciled controllers and catalogue. Saves once, after the whole load. */
  restore(layout: unknown, tab?: string): void;
  /** Persist to the tab the dock actually renders, which can lag behind the shown tab until the next paint. */
  save(tab: string | undefined, state: DockState): void;
  /** The shown tab's 3D views and their panels, in graph order. */
  views(): readonly ShownView[];
  /** Which view is drawn and whose picture the canvas holds. */
  drawn(): DrawnViews;
  /** Make a view's pane. */
  make(panel: PanelId): ViewPaneController;
  /** The panel catalogue now knows these view panels (before the dock places them, so its factory home includes them). */
  catalogue(panels: readonly PanelId[]): void;
  /** The dock: an added pane goes where the arrangement parked it, else to the 3D view's home; a withdrawn one leaves no place behind. */
  dock: Pick<DockView, "addPanels" | "removePanels" | "dockState"> & Partial<Pick<DockView, "cancelDrag">>;
  /** A pane as the dock holds it. */
  spec(controller: ViewPaneController): PanelSpec;
  /** Put the canvas into a pane's slot (`viewport.attach("head", slot)`). */
  attach(slot: HTMLElement): void;
  /** Panes made and withdrawn, so the shell keeps them with its other panels (paints, focus, anchors). */
  added?(controller: ViewPaneController): void;
  removed?(controller: ViewPaneController): void;
};

/** The view panes of the shown tab: one controller per view panel ID, kept in step with the tab's views, and the canvas placed. */
export class ViewPanels {
  private readonly panes = new Map<PanelId, ViewPaneController>();
  /** The slot the canvas was put in last. */
  private placed: HTMLElement | undefined;
  private tab: string | undefined;
  private layout: string | undefined;
  private reconciling = false;
  private pendingSave: DockState | undefined;
  private openingRevision: number | undefined;
  constructor(private readonly deps: ViewPanelsDeps) {}
  /** The explicit destination owned by the dock, including while a reconciliation holds its saves. */
  tabId(): string | undefined { return this.tab; }
  private bind(tab: string | undefined) {
    const instances = this.deps.instances;
    for (const panel of instances?.controllers() ?? []) if (panel.bind)
      panel.bind(tab === undefined ? undefined : instances!.instance(panel.spec.id, tab));
  }

  /** The panel IDs the shown tab's views need, in graph order. */
  wanted(): PanelId[] { return this.deps.views().map(entry => entry.panel); }
  /** The panes made now. */
  controllers(): ViewPaneController[] { return [...this.panes.values()]; }
  pane(panel: PanelId): ViewPaneController | undefined { return this.panes.get(panel); }
  /** The panel holding the canvas now (undefined: no view of the shown tab is drawn). */
  canvasPanel(): PanelId | undefined {
    const view = canvasView(this.deps.drawn());
    return view === undefined ? undefined : this.deps.views().find(entry => entry.view === view)?.panel;
  }

  /**
   * The panes the views need at mount, made but not placed (the dock is made with them, from the arrangement the catalogue now knows).
   * Call once, before the dock exists.
   */
  start(): ViewPaneController[] {
    this.rememberArrangement();
    this.bind(this.tab);
    const wanted = this.wanted();
    this.deps.catalogue(wanted);
    for (const panel of wanted) this.make(panel);
    return this.controllers();
  }
  /** Dock saves belong to its rendered tab; reconciliation publishes only its final state, after the destination takes ownership. */
  save(state: DockState) {
    if (this.reconciling) this.pendingSave = state;
    else this.deps.save(this.tab, state);
  }
  /**
   * Bring the panes in line with the shown tab's views: a new view's pane is made and placed; a closed view's is withdrawn (only that one,
   * leaving no place behind). Then the canvas goes to the pane that holds the picture. Returns whether a pane came or went.
   */
  sync(): boolean {
    if (this.reconciling) return false;
    const destination = this.deps.arrangement(), layout = JSON.stringify(destination.layout);
    const contributions = this.deps.contributions?.pending() ?? false;
    // A dock drag has already placed and saved this tree; only an external restore needs loading again. Compare the tree only when the
    // preference changed, rather than cloning the dock on every paint. Capture the destination before any dock operation can save.
    const externalRestore = destination.tab !== this.tab || (layout !== this.layout && layout !== JSON.stringify(serializeDockState(this.deps.dock.dockState)));
    const restore = contributions || externalRestore;
    const wanted = this.wanted(), want = new Set(wanted);
    const gone = [...this.panes.keys()].filter(panel => !want.has(panel)), fresh = wanted.filter(panel => !this.panes.has(panel));
    // A pending drag belongs to the previously rendered tab and specs. End it before changing either identity.
    if (restore || gone.length || fresh.length) this.deps.dock.cancelDrag?.();
    // Registration alone changes availability, not arrangement. Read-only windows can have a newer local arrangement than storage.
    const arrangement = contributions && !externalRestore ? serializeDockState(this.deps.dock.dockState) : destination.layout;
    this.reconciling = true;
    let releaseContributions: (() => void) | void = undefined;
    try {
      // Resolve queued navigation first. The captured destination owns every reconciliation below; its saves stay held until load.
      this.tab = destination.tab;
      if (contributions) releaseContributions = this.deps.contributions!.reconcile(destination.tab);
      this.bind(destination.tab);
      if (gone.length || fresh.length || restore) {
        this.deps.catalogue(wanted);
        const leaving = gone.map(panel => this.panes.get(panel)!);
        if (gone.length) {
          // The canvas never leaves with a withdrawn pane for good: it waits for the pane that holds the picture next (placed below).
          if (leaving.some(pane => pane.slot === this.placed)) this.placed = undefined;
          // Only a closed view is forgotten incrementally. On a tab switch the whole destination tree replaces this one: the leaving
          // tab's own arrangement stays untouched, and no intermediate tree is saved into the destination tab.
          if (!restore) this.deps.dock.removePanels(gone, { forget: true });
          for (const pane of leaving) { this.panes.delete(pane.spec.id); this.deps.removed?.(pane); }
        }
        const specs = fresh.map(panel => this.deps.spec(this.make(panel)));
        if (restore) this.deps.restore(arrangement, destination.tab);
        else if (specs.length) this.deps.dock.addPanels(specs);
        for (const pane of leaving) { pane.spec.visibility?.(false); pane.dispose(); }
      }
      releaseContributions?.(); releaseContributions = undefined;
      const opening = this.deps.opening?.();
      if (opening && opening.revision !== this.openingRevision) {
        this.openingRevision = opening.revision;
        const pane = opening.tab === this.tab && this.deps.views().find(view => view.view === opening.view);
        if (pane) this.deps.openView?.(pane.panel, opening.arrangement, opening.focus);
      }
      if (this.pendingSave) this.deps.save(destination.tab, this.pendingSave);
      const settled = this.deps.arrangement();
      this.layout = JSON.stringify(settled.tab === this.tab ? settled.layout : destination.layout);
      this.place();
      return contributions || gone.length > 0 || fresh.length > 0;
    } finally {
      releaseContributions?.();
      this.pendingSave = undefined;
      this.reconciling = false;
    }
  }
  dispose() {
    for (const pane of this.panes.values()) { this.deps.removed?.(pane); pane.spec.visibility?.(false); pane.dispose(); }
    this.panes.clear(); this.placed = undefined;
  }
  private rememberArrangement() {
    const { tab, layout } = this.deps.arrangement();
    this.tab = tab; this.layout = JSON.stringify(layout);
  }
  /** Put the canvas in the pane that holds the picture (no move when it is there already; none while no pane does). */
  place() {
    const panel = this.canvasPanel(), pane = panel === undefined ? undefined : this.panes.get(panel);
    if (!pane || pane.slot === this.placed) return;
    this.placed = pane.slot;
    this.deps.attach(pane.slot);
  }
  private make(panel: PanelId): ViewPaneController {
    const pane = this.deps.make(panel);
    this.panes.set(panel, pane);
    this.deps.added?.(pane);
    return pane;
  }
}
