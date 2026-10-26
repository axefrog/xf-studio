/**
 * A profile's session as a window holds it (profiles design §1.1, §4.1; experiment 044 chunk P2-i): the one owner of its layout tabs, its
 * view graph and its focus. Tabs, the graph and focus change only through its operations; each operation is one commit and, focus apart,
 * one step of the session's View and lighting history (`view:<profile>`, §3.7), so Undo can never put a view into a missing tab.
 *
 * - **One history.** The session holds the `view:<profile>` scope over a target that is the graph's plus its own (`@tabs`: the order, the
 *   closed-tab fragments and the shown tab; `@tab:<id>`: a tab's header; `@content:<id>`: whole-tab content; `@panel:` and `@binding:`:
 *   individual membership and binding fields). The graph records through it (`ViewGraphOwner`): its own edits (a light, a camera jump) are steps as before, and the graph
 *   edits inside a session operation join that operation's one step. An Undo or Redo is checked as a whole before anything changes: every
 *   tab in the order exists, nothing else does, and every view is in one of them (CORE-94's rule, extended to tabs).
 * - **What is never an Undo step** (decisions D1 and D15 of experiment 044): focus (the shown tab, view order, the focused panel, the editing
 *   context), the arrangement the dock saves, the temporary phase-2 input adapter's first instance, and what
 *   a scene shows (`scene.setLook`, `scene.setSubject`). A step holds a tab's arrangement and instances only when it makes, closes or
 *   resets the tab, so undoing a rename never moves a panel. After an Undo or Redo the shown tab stays, unless the step took it away (the
 *   tab the step's state showed is shown, else its neighbour) or brought back the tab its state showed.
 * - **Operations:** new tab (from content a default's fragment makes, `layout-fragment.ts`), close (a closed-tab fragment holding the
 *   tab, its views, a value copy of every node they named and their focus numbers; the last 5 are kept), reopen (under its own IDs, in its place, with its views' focus
 *   numbers: byte-identical to before the close), reset (the content before it becomes a fragment, then the new content fills the tab),
 *   rename, move, duplicate (fresh IDs everywhere, scenes included: it shares nothing), the origin Save as default gives a tab, show
 *   (navigation), adding/parking/showing panels, changing their binding, and adding and closing views. Defaults go through `TabDefaults`.
 *   Tabs holding a view this build can't show (a newer build's) can't be closed or reset; a duplicate leaves those views out.
 * - **Settled before anyone hears.** An operation validates whole before it changes anything (a refusal changes nothing), and the graph's,
 *   focus's and the session's notifications are held until it has settled (tabs, views, focus and its step); an Undo or Redo too. Each
 *   listener is isolated from the others, so one that throws can't leave the session half changed.
 * - **Replays keep what Undo doesn't hold.** A step holds a tab's arrangement and instances, its scenes' targets and its views' focus
 *   numbers as they were when it was recorded; a tab or fragment an Undo or Redo brings in takes them from what it takes away instead,
 *   matched by its content's identity (`@content`, session-only: never stored or read out, given afresh when the session opens).
 * - **Committed changes are always heard.** The session's change is pending before a step is published, so a history listener that
 *   throws can't keep it from its listeners; a replay that starts while another settles nests in its hold (the history service runs
 *   one move at a time anyway).
 * - **IDs are never used twice** (§1.4): new tabs, views and nodes get IDs with over 128 bits of randomness (instances 62, the stored
 *   format's most), so no record of retired IDs is needed across a restart; within a run the session also never gives out one it holds,
 *   keeps in a closed fragment or gave out before.
 * - **The editing context.** A recorded operation makes `view:<profile>` the editing context (§3.7), so global Undo reaches it; showing a
 *   tab and arranging one are navigation.
 * - **Scenes** name the subject and look they show (`subject`, `look`) and count their changes (`gen`); the graph holds their display
 *   state. A scene the session hasn't seen yet shows what the first scene showing anything shows.
 * - **The dock** uses instance IDs, as stored. Named phase-2 input/output adapters retain the existing one-controller UI until P3-iii/viii.
 */
import type { Capability } from "../../platform/api/capability";
import { refusal } from "../../platform/api/capability";
import type { HistoryTarget, HistoryEntryId } from "../../platform/api/history";
import type { SubjectRef } from "../../platform/api/subjects";
import { MAIN_VIEW, SLOT_COLLECTIONS, VIEW_SLOTS, type StoredNode, type ViewGraphData, type ViewId, type ViewRecord,
  type ViewSlot } from "../../platform/api/view-graph";
import type { FocusService } from "../../platform/core/focus";
import { viewScope, type HistoryScope, type HistoryService } from "../../platform/core/history-service";
import { notifyAll } from "../../platform/core/listeners";
import { hostRandom } from "../../platform/core/random";
import { ViewGraphError, type AddedNode, type ViewGraph, type ViewGraphOwner, type ViewHistoryScope } from "../../platform/core/view-graph";
import type { LookRef } from "../../library/collection-documents";
import type { DockLayout } from "../ui-preferences";
import { FIRST_TAB_NAME, rewriteDock, viewOfPanel } from "./profiles-migration-data";
import { CLOSED_TAB_LIMIT, PROFILE_SESSION_SCHEMA, panelBindingOf, type PanelBinding, type ClosedTab, type LayoutTab, type PanelInstance, type ProfileSessionData, type SessionScene, type SessionView,
  type TabId, WORKSPACE_PROFILES_SCHEMA, type WorkspaceProfiles } from "./profile-session";
import { addPanelDock, changePanelDock, dockWith, openIn, panelDock, removePanelsDock, replayPanelsDock } from "./panel-dock";
import { panelPlace, type ParkedPlace } from "../../platform/core/dock-layout";

/** What a scene shows. */
export type SceneTarget = { readonly subject?: SubjectRef; readonly look?: LookRef; readonly gen: number };
/** A first view's intended slot; its structural history step keeps it across Undo and Redo. */
type ViewPlacement = { readonly view: ViewId; readonly tab: TabId; readonly arrangement: DockLayout | null };
/** One application request to present a just-opened view, on initial execution or replay. */
export type ViewOpening = ViewPlacement & { readonly revision: number };
/**
 * A new tab's content, its IDs fresh (`ProfileSessions.freshId`): its name, origin, arrangement and instances, its views (the session sets
 * their tab) and the nodes made with them (a scene may name what it shows). A view may name an existing node instead: a shared scene.
 */
export type TabContent = {
  readonly name: string; readonly origin?: string; readonly dock: DockLayout | null; readonly panels: readonly PanelInstance[];
  readonly views: readonly ViewRecord[];
  readonly nodes: readonly { readonly slot: ViewSlot; readonly node: StoredNode | SessionScene }[];
};
/** The `tabs.*` actions (experiment 044 §2.1): each names the tab it acts on (the input layer names the shown tab). */
export type TabAction =
  | { kind: "tabs.show"; tab: TabId }
  | { kind: "tabs.rename"; tab: TabId; name: string }
  | { kind: "tabs.move"; tab: TabId; to: number }
  | { kind: "tabs.close"; tab: TabId }
  | { kind: "tabs.reopen"; closed?: TabId }
  | { kind: "tabs.duplicate"; tab: TabId }
  | { kind: "tabs.arrange"; tab: TabId; layout: DockLayout | null };
/** A tab name's longest length. */
export const TAB_NAME_LIMIT = 60;
/** The dock's panel ID of a view (`head` for the main view). */
export const viewPanel = (view: string) => view === MAIN_VIEW ? "head" : `view.${view}`;

/** A refused operation, with the reason a person reads. */
export class TabRefusal extends Error {
  constructor(readonly code: "missing_target" | "invalid_value" | "incompatible_mode" | "unavailable", message: string) { super(message); }
}
/**
 * A tab as the session holds it: with its content's identity (`@content`), which goes with the arrangement and instances when the tab
 * closes, reopens or is reset, and through every history step. Session-only: never stored or read out (`bare`), and given afresh on open.
 */
type HeldTab = LayoutTab & { readonly [CONTENT_ID]: number };
type HeldClosed = Omit<ClosedTab, "tab"> & { readonly tab: HeldTab };
type Header = Omit<LayoutTab, "dock" | "panels">;
type Content = Pick<HeldTab, "dock" | "panels" | typeof CONTENT_ID>;
type Tabs = { readonly order: readonly TabId[]; readonly closed: readonly HeldClosed[]; readonly shown?: TabId };
export type PanelTabTarget = { readonly profile: string; readonly tab: TabId; readonly tabVersion: number };
export type PanelTarget = PanelTabTarget & { readonly instance: string; readonly version: number };
type PanelMembership = { panel: PanelInstance; placementVersion: number; open: Record<"wide" | "compact", boolean>; closed: Record<"wide" | "compact", boolean>; closedIndex: Record<"wide" | "compact", number>;
  parked: Partial<Record<"wide" | "compact", ParkedPlace>>; places: Partial<Record<"wide" | "compact", ParkedPlace>> } | undefined;
const PANEL = "@panel:", BINDING = "@binding:";
const panelKey = (prefix: string, tab: HeldTab, instance: string) => prefix + JSON.stringify([tab[CONTENT_ID], instance]);
const TABS = "@tabs", HEADER = "@tab:", CONTENT = "@content:", CONTENT_ID = "@content", VIEW_PLACEMENT = "@viewPlacement:";
const sessionKey = (key: string) => key === TABS || [HEADER, CONTENT, VIEW_PLACEMENT, PANEL, BINDING].some(prefix => key.startsWith(prefix));
const STRUCTURE = "@structure";
const clone = <T>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const PREFIX: Record<"tab" | "view" | ViewSlot, string> = { tab: "t-", view: "v-", scene: "s-", camera: "c-", lights: "l-", display: "d-", tools: "x-" };
const control = /[\u0000-\u001f\u007f]/;
/** A scene node as the graph holds it: without what it shows. */
const graphScene = (node: StoredNode | SessionScene): StoredNode => { const { subject: _s, look: _l, gen: _g, ...rest } = node as SessionScene; return rest; };
/** A scene node as the session stores it: naming what it shows. */
const withTarget = (node: StoredNode, target: SceneTarget): SessionScene =>
  ({ ...node, ...(target.subject ? { subject: target.subject } : {}), ...(target.look ? { look: target.look } : {}), gen: target.gen }) as SessionScene;
const targetOf = (node: StoredNode | SessionScene): SceneTarget => {
  const { subject, look, gen } = node as SessionScene;
  return { ...(subject ? { subject: { ...subject } } : {}), ...(look ? { look: { ...look } } : {}), gen: Number.isSafeInteger(gen) && gen >= 0 ? gen : 0 };
};
const headerOf = (tab: HeldTab): Header => { const { dock: _d, panels: _p, [CONTENT_ID]: _c, ...header } = tab; return header; };
const contentOf = (tab: HeldTab): Content => ({ dock: tab.dock, panels: tab.panels, [CONTENT_ID]: tab[CONTENT_ID] });
/** A tab or fragment as read out and stored: without its content's identity. */
const bare = (tab: HeldTab): LayoutTab => { const { [CONTENT_ID]: _c, ...rest } = tab; return rest; };
const bareClosed = (item: HeldClosed): ClosedTab => ({ ...item, tab: bare(item.tab) });
/**
 * Characters of randomness in a new ID, base 36: over 128 bits for a tab, view or node, so one is never drawn twice in practice and no
 * record of retired IDs is needed (a restart keeps none); a panel instance's takes the stored format's most, 12 (over 60 bits).
 */
const ID_LENGTH = 25, INSTANCE_ID_LENGTH = 12;

export type ProfileSessionsDeps = {
  readonly profile: string;
  readonly data: ProfileSessionData;
  /** The window's history service: the session's View and lighting scope is one of its scopes; its focus is the session's. */
  readonly history: HistoryService;
  /** The view graph over the session's views (the composition's rules and recovery), recording through `owner`. */
  graph(data: ViewGraphData, owner: ViewGraphOwner): ViewGraph;
  /** The graph as the session stores it (default: its data). */
  stored?(graph: ViewGraph): ViewGraphData;
  /** Default: the platform's cryptographic source. Tests pass a seeded one. */
  readonly random?: () => number;
};

export class ProfileSessions {
  readonly profile: string;
  readonly focus: FocusService;
  readonly graph: ViewGraph;
  private tabs: HeldTab[];
  private closed: HeldClosed[];
  /** The last content identity given (`@content`). */
  private contents = 0;
  /** Latest state of each content identity, even while only history retains it. Tab slots and closed fragments reference this owner. */
  private contentStates = new Map<number, Content>();
  private readonly retainedContents = new Map<HistoryEntryId, Set<number>>();
  private readonly placementVersions = new Map<number, number>();
  private readonly latestPlaces = new Map<number, Map<string, Partial<Record<"wide" | "compact", ParkedPlace>>>>();
  private readonly targets = new Map<string, SceneTarget>();
  /** Every ID the session holds, keeps in a closed fragment or gave out in this run: never given out again. */
  private readonly used = new Set<string>();
  /** The session's fields this build doesn't know, kept as stored. */
  private readonly extra: Record<string, unknown>;
  private readonly listeners = new Set<() => void>();
  /** Open holds of every notification (`holdAll`), and whether the session changed under them. */
  private holding = 0;
  private pending = false;
  /** Releases the notifications held while an Undo or Redo settles (from `apply` to `settled`). */
  private releaseReplay?: () => void;
  private readonly random: () => number;
  private readonly storedGraph: (graph: ViewGraph) => ViewGraphData;
  private scope!: HistoryScope;
  private graphTarget!: HistoryTarget;
  /** The tabs of views this build keeps unchanged (a newer build's): they can't be closed or reset. */
  private readonly keptTabs = new Set<TabId>();
  private opening?: ViewOpening;
  private openingRevision = 0;
  /** While an operation runs: graph and placement values before it (their checkpoints join the operation's one step). */
  private collecting?: Map<string, unknown>;
  private structuralVersion = 0;
  private readonly tabVersions = new Map<string, number>();
  private readonly panelVersions = new Map<string, number>();

  constructor(deps: ProfileSessionsDeps) {
    const { data } = deps;
    this.profile = deps.profile;
    this.random = deps.random ?? hostRandom().next;
    this.focus = deps.history.focus;
    this.storedGraph = deps.stored ?? (graph => graph.data());
    const { schema: _schema, tabs: _tabs, views: _views, focus: _focus, closed: _closed, seq: _seq, ...extra } = data as ProfileSessionData & Record<string, unknown>;
    this.extra = extra;
    this.tabs = clone([...data.tabs]).map(tab => this.held(tab));
    this.closed = clone([...data.closed]).map(item => ({ ...item, tab: this.held(item.tab) }));
    for (const scene of data.views.scenes) this.targets.set(scene.id, targetOf(scene));
    for (const id of this.idsOf(data)) this.used.add(id);
    this.closed = this.closed.map(fragment => fragment.id ? fragment : { ...fragment, id: this.fresh(undefined, "closed-") });
    this.focus.restore({ ...data.focus, seq: data.seq });
    if (!this.focus.shownTab() || !this.tab(this.focus.shownTab()!)) this.focus.showTab(this.tabs[0]?.id);
    this.focus.subscribe(() => this.changed());
    const owner: ViewGraphOwner = {
      history: (target, options) => { this.graphTarget = target; this.scope = deps.history.open(viewScope(this.profile), this.historyTarget(), {
        ...options }); return this.graphScope(); },
      freshId: kind => this.freshId(kind),
    };
    // The graph holds each scene's display state; the session holds what it shows.
    this.graph = deps.graph({ ...data.views, scenes: data.views.scenes.map(graphScene) } as ViewGraphData, owner);
    if (!this.scope) throw Error("The session's view graph didn't record through the session.");
    // A graph whose views name no tab (the default stand-in for one that couldn't be read) joins the shown tab.
    if (this.graph.viewIds().some(view => !this.graph.tabOf(view))) {
      if (!this.tabs.length) { this.tabs.push(this.held({ id: this.fresh("tab"), name: FIRST_TAB_NAME, dock: null, panels: [] })); this.focus.showTab(this.tabs[0]!.id); }
      this.graph.adoptViews(this.tabId());
    }
    for (const view of this.graph.data().views) if (!this.graph.has(view.id) && typeof view.tab === "string") this.keptTabs.add(view.tab);
  }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() {
    if (this.holding) { this.pending = true; return; }
    notifyAll(this.listeners);
  }
  /**
   * Hold every notification (the graph's, focus's and the session's) until the returned release: an operation or a replay settles whole
   * (tabs, views, focus and its history step) before anyone hears of it, and then each listener hears, isolated from the others.
   */
  private holdAll(): () => void {
    const graph = this.graph.hold(), focus = this.focus.hold();
    this.holding++;
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      // Focus's listeners include the session's own (`changed`), which only marks the session changed while it holds.
      try { notifyAll([graph, focus]); }
      finally { if (--this.holding === 0 && this.pending) { this.pending = false; notifyAll(this.listeners); } }
    };
  }

  // ----- Reads -----
  /** The shown tab (empty: an empty session). */
  tabId(): TabId { return this.focus.shownTab() ?? ""; }
  /** The tabs in order, detached. */
  tabList(): readonly LayoutTab[] { return clone(this.tabs.map(bare)); }
  tab(id: TabId): LayoutTab | undefined { const found = this.tabs.find(tab => tab.id === id); return found && clone(bare(found)); }
  /** The closed tabs, newest last, detached. */
  closedTabs(): readonly ClosedTab[] { return clone(this.closed.map(bareClosed)); }
  /** The last view-opening request; presentation consumes each revision once during normal pane reconciliation. */
  viewOpening(): ViewOpening | undefined { return this.opening && clone(this.opening); }
  /** The tab a view is in: the graph's (each view names its tab), else the shown tab. */
  viewTab(view: ViewId): TabId { return this.graph.tabOf(view) ?? this.tabId(); }
  /** A panel instance of any tab, detached. Reads never allocate an identity or mutate the session. */
  panel(id: string): (PanelInstance & { readonly tab: TabId }) | undefined {
    for (const tab of this.tabs) { const found = tab.panels.find(panel => panel.id === id); if (found) return clone({ ...found, tab: tab.id }); }
    return undefined;
  }
  instances(type: string, tab: TabId = this.tabId()): readonly PanelInstance[] { return clone(this.tabs.find(item => item.id === tab)?.panels.filter(panel => panel.type === type) ?? []); }
  panelTabTarget(tab: TabId): PanelTabTarget { this.existing(tab); return { profile: this.profile, tab, tabVersion: this.tabVersions.get(tab) ?? 0 }; }
  panelTarget(instance: string): PanelTarget {
    const panel = this.panel(instance);
    if (!panel) throw new TabRefusal("missing_target", "That panel is no longer in this tab.");
    return { ...this.panelTabTarget(panel.tab), instance, version: this.panelVersions.get(instance) ?? 0 };
  }
  checkPanelTarget(target: PanelTabTarget | PanelTarget) {
    if (!target || typeof target !== "object") throw new TabRefusal("missing_target", "Name the destination panel or tab.");
    if (target.profile !== this.profile || !this.tab(target.tab) || target.tabVersion !== (this.tabVersions.get(target.tab) ?? 0))
      throw new TabRefusal("missing_target", "That layout tab changed. Open the command again.");
    if ("instance" in target && (this.panel(target.instance)?.tab !== target.tab || target.version !== (this.panelVersions.get(target.instance) ?? 0)))
      throw new TabRefusal("missing_target", "That panel changed. Open the command again.");
  }

  /** What a scene shows. A scene the session hasn't seen yet (a view's scene forked meanwhile) shows what the first scene showing anything shows. */
  scene(id: string): SceneTarget {
    const known = this.targets.get(id);
    if (known) return known;
    const first = [...this.targets.values()].find(target => target.subject || target.look);
    const inherited: SceneTarget = { ...(first?.subject ? { subject: { ...first.subject } } : {}), ...(first?.look ? { look: { ...first.look } } : {}), gen: 0 };
    this.targets.set(id, inherited);
    return inherited;
  }
  /** What a scene shows, when the session knows it (never made here). */
  knownScene(id: string): SceneTarget | undefined { const known = this.targets.get(id); return known && { ...known }; }
  /** `scene.setLook`: the scene shows `look` (undefined: none); its `gen` rises. Never an Undo step. */
  setLook(scene: string, look: LookRef | undefined) {
    const current = this.scene(scene);
    if (look ? current.look?.collection === look.collection && current.look.look === look.look : !current.look) return;
    const { look: _old, ...rest } = current;
    this.setSceneTarget(scene, { ...rest, ...(look ? { look: { collection: look.collection, look: look.look } } : {}), gen: current.gen + 1 });
    this.changed();
  }
  /** `scene.setSubject`: the scene shows `subject`; its `gen` rises. Never an Undo step. */
  setSubject(scene: string, subject: SubjectRef | undefined) {
    const current = this.scene(scene);
    if (subject ? current.subject?.kind === subject.kind && current.subject.id === subject.id : !current.subject) return;
    const { subject: _old, ...rest } = current;
    this.setSceneTarget(scene, { ...rest, ...(subject ? { subject: { kind: subject.kind, id: subject.id } } : {}), gen: current.gen + 1 });
    this.changed();
  }

  /** Closed tabs may still name a live shared scene. Their stored copies follow its unrecorded target edits immediately. */
  private setSceneTarget(scene: string, target: SceneTarget) {
    this.targets.set(scene, target);
    this.closed = this.closed.map(fragment => ({ ...fragment, nodes: fragment.nodes.map(item => item.slot === "scene" && item.node.id === scene
      ? { ...item, node: withTarget(graphScene(item.node), target) } : item) }));
  }

  // ----- The dock -----
  /** The instance-ID arrangement, detached (null: empty). Types are only catalogue/factory keys. */
  dock(tab: TabId = this.tabId()): DockLayout | null {
    return clone(this.tabs.find(item => item.id === tab)?.dock ?? null);
  }
  /** Temporary phase-2 output adapter for the one-controller-per-type UI. Remove in P3-viii. */
  legacyDock(tab: TabId = this.tabId()): DockLayout | null {
    const found = this.tabs.find(item => item.id === tab);
    if (!found?.dock) return null;
    const byInstance = new Map(found.panels.map(panel => [panel.id, panel]));
    const aliases = new Map<string, string>();
    return rewriteDock(found.dock, id => {
      const panel = byInstance.get(id);
      if (!panel) return id;
      const target = panel.binding?.policy === "pinned" ? panel.binding.target : undefined;
      const alias = panel.type === "view" && target && "view" in target ? viewPanel(target.view) : panel.type;
      if (aliases.has(alias) && aliases.get(alias) !== id) throw new TabRefusal("incompatible_mode", "This legacy layout is ambiguous. Use panel instance IDs.");
      aliases.set(alias, id); return alias;
    });
  }
  /** Temporary type-level input adapter, removed in P3-viii. This lookup never creates an instance. */
  instance(panel: string, tab: TabId = this.tabId()): string {
    const view = viewOfPanel(panel), matches = this.tabs.find(item => item.id === tab)?.panels.filter(item => item.id === panel || (view
      ? item.type === "view" && item.binding?.policy === "pinned" && "view" in item.binding.target && item.binding.target.view === view
      : item.type === panel)) ?? [];
    if (matches.length > 1) throw new TabRefusal("incompatible_mode", "This panel type is ambiguous. Use a panel instance ID.");
    return matches[0]?.id ?? "";
  }
  /** Temporary phase-2 mounting/input adapter only: explicitly creates the one instance a legacy controller requests. Remove in P3-viii. */
  inputInstance(panel: string, tab: TabId = this.tabId()): string { return this.instanceOf(panel, tab).id; }
  private instanceOf(panel: string, tab: TabId): PanelInstance {
    const index = this.tabs.findIndex(item => item.id === tab);
    if (index < 0) throw new TabRefusal("missing_target", "That tab is closed.");
    const exact = this.tabs[index]!.panels.find(item => item.id === panel);
    if (exact) return exact;
    const view = viewOfPanel(panel), id = this.instance(panel, tab), found = this.tabs[index]!.panels.find(item => item.id === id);
    if (found) return found;
    const made: PanelInstance = view ? { id: this.freshInstance("view"), type: "view", binding: { policy: "pinned", target: { view } } }
      : { id: this.freshInstance(panel), type: panel };
    this.tabs[index] = { ...this.tabs[index]!, panels: [...this.tabs[index]!.panels, made] };
    this.rememberContent(this.tabs[index]!);
    return made;
  }
  /**
   * The arrangement the dock saved for a tab (its panel IDs; null: the default arrangement), stored with the tab's instance IDs: a panel
   * shown in the tab for the first time gets its instance. The arrangement is the tab's own state, never an Undo step (decision D15).
   */
  arrange(tab: TabId, layout: DockLayout | null) {
    const index = this.tabs.findIndex(item => item.id === tab);
    if (index < 0) throw new TabRefusal("missing_target", "That tab is closed.");
    // Validate every alias before the adapter may allocate even the first missing instance.
    if (layout) rewriteDock(layout, panel => { this.instance(panel, tab); return panel; });
    const panels = this.tabs[index]!.panels.length, dock = layout ? rewriteDock(layout, panel => this.instanceOf(panel, tab).id) : null;
    if (same(dock, this.tabs[index]!.dock) && this.tabs[index]!.panels.length === panels) return;
    this.tabs[index] = { ...this.tabs[index]!, dock };
    this.arranged(this.tabs[index]!);
    this.changed();
  }
  /** Instance-only arrangement input; unlike the temporary `arrange` adapter this cannot invent panels. */
  arrangeInstances(tab: TabId, layout: DockLayout | null) {
    const at = this.index(tab), known = new Set(this.tabs[at]!.panels.map(panel => panel.id));
    if (layout) rewriteDock(layout, id => { if (!known.has(id)) throw new TabRefusal("missing_target", "That arrangement names a missing panel."); return id; });
    if (same(this.tabs[at]!.dock, layout)) return;
    this.tabs[at] = { ...this.tabs[at]!, dock: clone(layout) };
    this.arranged(this.tabs[at]!); this.changed();
  }
  /** Fresh semantic addition; factory already projects type keys to this instance and its siblings. */
  addPanel(tab: TabId, type: string, options: { binding?: PanelBinding; factory?: (id: string) => DockLayout | null } = {}): string {
    const at = this.index(tab);
    if (!/^[a-z0-9.-]{1,64}$/i.test(type) || type === "view") throw new TabRefusal("invalid_value", "Use the new-view operation for a 3D pane.");
    if (options.binding && !panelBindingOf(options.binding)) throw new TabRefusal("invalid_value", "That binding can't be read.");
    const id = this.freshInstance(type), panel: PanelInstance = { id, type, ...(options.binding ? { binding: clone(options.binding) } : {}) };
    const factory = options.factory?.(id) ?? null;
    this.operate("Add panel", "panels.add", () => {
      this.collecting!.set(panelKey(PANEL, this.tabs[at]!, id), undefined);
      this.collecting!.set(panelKey(BINDING, this.tabs[at]!, id), undefined);
      this.tabs[at] = { ...this.tabs[at]!, panels: [...this.tabs[at]!.panels, panel],
        dock: addPanelDock(this.tabs[at]!.dock, id, this.tabs[at]!.panels.filter(panel => panel.type === type).map(panel => panel.id), factory) };
      this.placed([id]);
    });
    return id;
  }
  /** Park/show exact retained identities in one step, in both size classes. */
  setPanelsOpen(tab: TabId, instances: readonly string[], open: boolean, factory: DockLayout | null | ((panel: PanelInstance) => DockLayout | null) = null) {
    const at = this.index(tab), ids = [...new Set(instances)];
    if (ids.some(id => !this.tabs[at]!.panels.some(panel => panel.id === id))) throw new TabRefusal("missing_target", "That panel is no longer in this tab.");
    const changing = ids.filter(id => (["wide", "compact"] as const).some(size => openIn(this.tabs[at]!.dock, id, size) !== open));
    if (!changing.length) return;
    const fallbacks = new Map(changing.map(id => [id, typeof factory === "function" ? factory(this.panel(id)!) : factory]));
    this.operate(open ? "Show panel" : "Remove panel", open ? "panels.show" : "panels.remove", () => {
      // All keys are captured from the same pre-operation tree, before any member leaves its group.
      const removed = panelDock(removePanelsDock(this.tabs[at]!.dock, changing));
      for (const id of changing) {
        const key = panelKey(PANEL, this.tabs[at]!, id), value = this.readKey(key) as NonNullable<PanelMembership>;
        if (!open) value.places = Object.fromEntries((["wide", "compact"] as const).flatMap(size => removed[size].lastPlace?.[id] ? [[size, removed[size].lastPlace[id]]] : []));
        this.collecting!.set(key, value);
      }
      if (!open) { this.tabs[at] = { ...this.tabs[at]!, dock: removePanelsDock(this.tabs[at]!.dock, changing) }; return; }
      for (const id of changing) {
        this.tabs[at] = { ...this.tabs[at]!, dock: changePanelDock(this.tabs[at]!.dock, id, "show", fallbacks.get(id)) };
      }
    });
  }
  setPanelBinding(tab: TabId, instance: string, binding: PanelBinding) {
    const at = this.index(tab), panel = this.tabs[at]!.panels.find(panel => panel.id === instance);
    if (!panel) throw new TabRefusal("missing_target", "That panel is no longer in this tab.");
    if (panel.type === "view") throw new TabRefusal("incompatible_mode", "A 3D pane keeps its view identity.");
    if (!panelBindingOf(binding)) throw new TabRefusal("invalid_value", "That binding can't be read.");
    if (same(panel.binding, binding)) return;
    this.operate("Change panel binding", "panels.setBinding", () => {
      this.collecting!.set(panelKey(BINDING, this.tabs[at]!, instance), clone(panel.binding));
      this.tabs[at] = { ...this.tabs[at]!, panels: this.tabs[at]!.panels.map(item => item.id === instance ? { ...item, binding: clone(binding) } : item) };
    });
  }
  revealPanel(tab: TabId, instance: string) {
    const at = this.index(tab);
    if (!(["wide", "compact"] as const).some(size => openIn(this.tabs[at]!.dock, instance, size))) throw new TabRefusal("missing_target", "Show this panel first.");
    const release = this.holdAll();
    try { this.tabs[at] = { ...this.tabs[at]!, dock: changePanelDock(this.tabs[at]!.dock, instance, "reveal") }; this.arranged(this.tabs[at]!); this.focus.showTab(tab); this.focus.focusPanel(instance); this.changed(); }
    finally { release(); }
  }

  // ----- Operations -----
  /** Show a tab (navigation: never an Undo step). */
  show(tab: TabId) {
    this.existing(tab);
    this.focus.showTab(tab);
  }
  lastDefault(): string | undefined { return typeof this.extra.lastDefault === "string" ? this.extra.lastDefault : undefined; }
  usedDefault(id: string) { this.extra.lastDefault = id; this.changed(); }
  rename(tab: TabId, name: string) {
    const at = this.index(tab), next = name.trim(), issue = nameIssue(next);
    if (issue) throw new TabRefusal("invalid_value", issue);
    if (this.tabs[at]!.name === next) return;
    this.operate("Rename tab", "tabs.rename", () => { this.tabs[at] = { ...this.tabs[at]!, name: next }; });
  }
  /** Move a tab to place `to` in the order (clamped). */
  move(tab: TabId, to: number) {
    const from = this.index(tab), place = Math.max(0, Math.min(this.tabs.length - 1, Math.trunc(to)));
    if (place === from) return;
    this.operate("Move tab", "tabs.move", () => { const [moved] = this.tabs.splice(from, 1); this.tabs.splice(place, 0, moved!); });
  }
  /** The default a tab is made from becomes `origin` (Save as default names the default it made). One step, like a rename. */
  setOrigin(tab: TabId, origin: string) {
    const at = this.index(tab);
    if (this.tabs[at]!.origin === origin) return;
    this.operate("Save as default", "tabs.saveAsDefault", () => {
      const { id, name, origin: _before, ...rest } = this.tabs[at]!;
      this.tabs[at] = { id, name, origin, ...rest };
    });
  }
  /**
   * Close a tab: its views go, with the nodes only they used, and a closed-tab fragment holding all of it joins `closed` (the last 5).
   * Closing the shown tab shows its neighbour.
   */
  close(tab: TabId) {
    const at = this.index(tab);
    this.checkClosable(tab);
    const fragment = this.fragment(this.tabs[at]!, at);
    this.operate("Close tab", "tabs.close", () => {
      if (fragment.views.length) this.graph.restructure({ remove: fragment.views.map(item => item.view.id) }, { label: "Close tab" });
      this.tabs.splice(at, 1);
      this.closed = [...this.closed, fragment].slice(-CLOSED_TAB_LIMIT);
      if (this.focus.shownTab() === tab) this.focus.showTab(this.neighbour(at));
    });
  }
  /**
   * Reopen a closed tab (default: the most recently closed) under its own IDs, in its place, with its views' focus numbers, and show it.
   * Nodes still in the graph (shared with another tab) are linked again; the others come back from their copies. A reset's fragment
   * comes back as a tab of its own beside the tab it was reset from. `closed` names the fragment's own ID; older callers can still name
   * a tab's ID to reopen its newest fragment.
   */
  reopen(closed?: TabId): TabId {
    const fragment = this.closedFragment(closed);
    if (!fragment) throw new TabRefusal("missing_target", closed === undefined ? "There is no closed tab to reopen." : "That closed tab is no longer kept.");
    const nodes = this.reopenedNodes(fragment), id = this.tab(fragment.tab.id) ? this.fresh("tab") : fragment.tab.id;
    this.operate("Reopen tab", "tabs.reopen", () => {
      this.graph.restructure({ add: fragment.views.map(({ view, at }) => ({ view: { ...view, tab: id }, at })),
        nodes: nodes.map(({ slot, node, at }) => ({ slot, node: slot === "scene" ? graphScene(node) : node, at })) }, { label: "Reopen tab" });
      // What a scene shows is the session's, never a step's: the fragment's copy counts only for a scene the session no longer knows (after
      // a restart).
      for (const { slot, node } of nodes) if (slot === "scene" && !this.targets.has(node.id)) this.targets.set(node.id, targetOf(node));
      this.tabs.splice(Math.min(fragment.at, this.tabs.length), 0, { ...clone(fragment.tab), id });
      this.closed = this.closed.filter(item => item !== fragment);
      this.focus.placeViews(fragment.focus);
      this.focus.showTab(id);
    });
    return id;
  }
  /** A new tab with `content` (fresh IDs throughout; views may share existing nodes), at `at` (default: last), shown. */
  newTab(content: TabContent, at: number = this.tabs.length): TabId {
    const id = this.fresh("tab"), added = this.contentNodes(content);
    this.checkContent(content);
    this.operate("New tab", "tabs.new", () => {
      this.insert(id, content, added, at);
      if (content.views[0]) this.focus.focusView(content.views[0].id);
    });
    return id;
  }
  /** A copy of a tab beside it, with fresh IDs everywhere (scenes included: the copy shares nothing with it), shown. */
  duplicate(tab: TabId): TabId {
    const at = this.index(tab), content = this.copyOf(this.tabs[at]!), id = this.fresh("tab");
    this.operate("Duplicate tab", "tabs.duplicate", () => this.insert(id, content, this.contentNodes(content), at + 1));
    return id;
  }
  /** Reset a tab to `content` (a default's, instantiated): what it held becomes a closed fragment ("before reset"), and it shows the content. */
  reset(tab: TabId, content: TabContent) {
    const at = this.index(tab);
    this.checkClosable(tab);
    this.checkContent(content);
    const fragment = { ...this.fragment(this.tabs[at]!, at), reset: true as const }, added = this.contentNodes(content);
    this.operate("Reset tab", "tabs.reset", () => {
      this.graph.restructure({ remove: fragment.views.map(item => item.view.id), add: content.views.map(view => ({ view: { ...view, tab } })),
        nodes: added.map(({ slot, node }) => ({ slot, node: slot === "scene" ? graphScene(node) : node })) }, { label: "Reset tab" });
      for (const { slot, node } of added) if (slot === "scene") this.targets.set(node.id, targetOf(node));
      const { origin: _origin, ...header } = headerOf(this.tabs[at]!);
      this.tabs[at] = this.held({ ...header, ...(content.origin ? { origin: content.origin } : {}), dock: clone(content.dock), panels: clone([...content.panels]) });
      this.placed([...content.views.map(view => view.id), ...added.map(item => item.node.id), ...content.panels.map(panel => panel.id)]);
      this.closed = [...this.closed, fragment].slice(-CLOSED_TAB_LIMIT);
    });
  }
  /** A new view in `tab` (default: the source view's), sharing `share`'s slots with `from` (view graph §3.4). */
  addView(from: ViewId, share: Readonly<Partial<Record<ViewSlot, boolean>>>, options: { tab?: TabId; title?: string } = {}): ViewId {
    const tab = options.tab ?? this.viewTab(from);
    this.existing(tab);
    return this.operate("New view", "tabs.addView", () => {
      const view = this.graph.addView(from, share, { tab, label: "New view", ...(options.title ? { title: options.title } : {}) });
      if (!share.scene) this.targets.set(this.graph.node(view, "scene").id, { ...clone(this.scene(this.graph.node(from, "scene").id)), gen: 0 });
      return view;
    });
  }
  /** D13: the graph view and its fixed-identity pane are one structural action. */
  addViewPane(tab: TabId, from: ViewId, share: Readonly<Partial<Record<ViewSlot, boolean>>>): ViewId {
    this.existing(tab);
    if (!this.graph.has(from)) throw new TabRefusal("missing_target", "That source view is closed.");
    return this.operate("Add 3D view", "panels.add", () => {
      const view = this.addView(from, share, { tab }), at = this.index(tab), id = this.freshInstance("view");
      this.collecting!.set(panelKey(PANEL, this.tabs[at]!, id), undefined);
      this.tabs[at] = { ...this.tabs[at]!, panels: [...this.tabs[at]!.panels, { id, type: "view", binding: { policy: "pinned", target: { view } } }],
        dock: addPanelDock(this.tabs[at]!.dock, id, this.instances("view", tab).map(panel => panel.id), null) };
      this.placed([id]); return view;
    });
  }
  /** A first view in an existing tab, from a contributed baseline, with fresh identities throughout (U6). */
  openView(tab: TabId, baseline: ViewGraphData, subject: SubjectRef): ViewId {
    this.existing(tab);
    const arrangement = this.dock(tab);
    const source = baseline.views[0] as ViewRecord | undefined;
    if (!source || source.kind !== "3d") throw new TabRefusal("invalid_value", "A 3D view isn't available here.");
    const id = this.fresh("view"), refs = {} as Record<ViewSlot, string>;
    const nodes = VIEW_SLOTS.map(slot => {
      const node = baseline[SLOT_COLLECTIONS[slot]].find(node => node.id === source[slot]);
      if (!node) throw new TabRefusal("invalid_value", "That 3D view's settings are missing.");
      refs[slot] = this.fresh(slot);
      return { slot, node: { ...clone(node), id: refs[slot], ...(slot === "scene" ? { subject: clone(subject), gen: 0 } : {}) } };
    });
    const view: ViewRecord = { id, kind: "3d", tab, ...refs };
    // Validate whole before recording any change; the session remains the sole structural owner.
    this.checkContent({ name: "3D view", dock: null, panels: [], views: [view], nodes });
    return this.operate("Open a 3D view", "empty.choose", () => {
      this.graph.restructure({ add: [{ view }], nodes: nodes.map(({ slot, node }) => ({ slot, node: slot === "scene" ? graphScene(node) : node })) }, { label: "Open a 3D view" });
      this.targets.set(refs.scene, { subject: clone(subject), gen: 0 });
      this.placed([id, ...nodes.map(item => item.node.id)]);
      this.collecting!.set(VIEW_PLACEMENT + id, undefined);
      this.presentView({ view: id, tab, arrangement });
      return id;
    });
  }
  private presentView(placement: ViewPlacement) {
    this.opening = { ...clone(placement), revision: ++this.openingRevision };
    this.focus.showTab(placement.tab);
    this.focus.focusView(placement.view);
    const instance = this.instanceOf(viewPanel(placement.view), placement.tab).id, at = this.index(placement.tab);
    this.tabs[at] = { ...this.tabs[at]!, dock: changePanelDock(this.tabs[at]!.dock, instance, "show") };
    this.focus.focusPanel(instance);
  }
  closeView(view: ViewId) {
    if (!this.graph.has(view)) throw new TabRefusal("missing_target", "That view is closed.");
    this.operate("Close view", "tabs.closeView", () => this.graph.closeView(view, { label: "Close view" }));
  }

  /** A fresh ID of a kind: a tab, a view or a node of a slot (over 128 bits of randomness; never one this run holds, keeps or gave out). */
  freshId(kind: "tab" | "view" | ViewSlot): string { return this.fresh(kind); }
  /** A fresh panel instance ID for a panel type. */
  freshInstance(type: string): string { return this.fresh(undefined, `${type}--`, INSTANCE_ID_LENGTH); }

  // ----- The tabs.* actions -----
  capability(action: TabAction): Capability {
    try { this.check(action); return { available: true }; }
    catch (error) {
      if (error instanceof TabRefusal || error instanceof ViewGraphError) return refusal(error.code, error.message);
      throw error;
    }
  }
  dispatch(action: TabAction): undefined {
    switch (action.kind) {
      case "tabs.show": this.show(action.tab); break;
      case "tabs.rename": this.rename(action.tab, action.name); break;
      case "tabs.move": this.move(action.tab, action.to); break;
      case "tabs.close": this.close(action.tab); break;
      case "tabs.reopen": this.reopen(action.closed); break;
      case "tabs.duplicate": this.duplicate(action.tab); break;
      case "tabs.arrange": this.arrange(action.tab, action.layout); break;
    }
    return undefined;
  }
  private check(action: TabAction) {
    if (action.kind === "tabs.reopen") {
      const fragment = this.closedFragment(action.closed);
      if (!fragment) throw new TabRefusal("missing_target", action.closed === undefined ? "There is no closed tab to reopen." : "That closed tab is no longer kept.");
      this.reopenedNodes(fragment);
      return;
    }
    if (typeof action.tab !== "string") throw new TabRefusal("missing_target", "Open a layout tab first.");
    this.existing(action.tab);
    if (action.kind === "tabs.rename") {
      const issue = typeof action.name === "string" ? nameIssue(action.name.trim()) : "Name the tab.";
      if (issue) throw new TabRefusal("invalid_value", issue);
    } else if (action.kind === "tabs.move" && !Number.isSafeInteger(action.to)) throw new TabRefusal("invalid_value", "Choose a place for the tab.");
    else if (action.kind === "tabs.close") this.checkClosable(action.tab);
    else if (action.kind === "tabs.arrange") {
      if (action.layout !== null && (typeof action.layout !== "object" || !action.layout)) throw new TabRefusal("invalid_value", "That arrangement can't be read.");
      if (action.layout) rewriteDock(action.layout, panel => { this.instance(panel, action.tab); return panel; });
    }
  }

  // ----- Storing -----
  /** The workspace's `profiles` with this session as it is now (each scene naming what it shows), beside `others`' sessions. */
  stored(others?: WorkspaceProfiles): WorkspaceProfiles {
    return { schema: WORKSPACE_PROFILES_SCHEMA, sessions: { ...(others?.sessions ?? {}), [this.profile]: this.session() } };
  }
  /**
   * The session as stored. The graph's `focused` is left out: only an older build's workspace `views` need it (they stay as they were),
   * and in a session it would depend on which views closed and came back, not on what the session holds.
   */
  session(): ProfileSessionData {
    const { focused: _legacy, ...graph } = this.storedGraph(this.graph);
    const scenes: SessionScene[] = graph.scenes.map(scene => withTarget(scene, this.scene(scene.id)));
    const ids = new Set(graph.views.map(view => view.id)), { seq, views: order, ...rest } = this.focus.snapshot();
    const focus = { views: Object.fromEntries(Object.entries(order).filter(([view]) => ids.has(view))), ...rest };
    return clone({ ...this.extra, schema: PROFILE_SESSION_SCHEMA, tabs: this.tabs.map(bare), views: { ...graph, views: graph.views as SessionView[], scenes }, focus,
      closed: this.closed.map(bareClosed), seq } as ProfileSessionData);
  }

  // ----- The operation step -----
  /**
   * Run an operation as one commit and one step (§4.1): the session's values it changed and the graph's (its checkpoints, collected while
   * it runs) are recorded together. Every operation validates before it changes anything, so a refusal changes nothing.
   */
  private operate<T>(label: string, actionKind: string, work: () => T): T {
    if (this.collecting) return work();
    const release = this.holdAll();
    try {
      const previous = clone(this.tabs), before = this.sessionValues(), collected = new Map<string, unknown>();
      this.collecting = collected;
      let result: T;
      try { result = work(); }
      finally { this.collecting = undefined; }
      for (const tab of [...this.tabs, ...this.closed.map(fragment => fragment.tab)]) this.rememberContent(tab);
      const after = this.sessionValues();
      const panelContents = new Set([...collected.keys()].filter(key => key.startsWith(PANEL) || key.startsWith(BINDING))
        .map(key => (JSON.parse(key.slice(key.startsWith(PANEL) ? PANEL.length : BINDING.length)) as [number, string])[0]));
      const keys = [...new Set([...before.keys(), ...after.keys()])].filter(key => !same(before.get(key), after.get(key))
        && !(key.startsWith(CONTENT) && panelContents.has((after.get(key) as Content | undefined)?.[CONTENT_ID] ?? (before.get(key) as Content | undefined)?.[CONTENT_ID] ?? -1)));
      const all = [...keys, ...collected.keys()];
      this.updatePanelVersions(previous);
      // Pending before the step is published: whatever a history listener throws, the session's listeners hear (on release).
      this.changed();
      if (all.length) {
        if (this.scope.recording) {
          // A recorded operation is an edit (§3.7): its history becomes the editing context, so global Undo reaches it.
          this.focus.edited(this.scope.id);
          try {
            this.scope.checkpoint(all, { label, actionKind },
              { read: key => before.has(key) ? before.get(key) : collected.get(key), timed: false, distinct: true });
          } finally {
            const step = this.scope.top();
            if (step !== undefined) this.retainedContents.set(step, new Set([...previous, ...(before.get(TABS) as Tabs).closed.map(fragment => fragment.tab), ...this.tabs, ...this.closed.map(fragment => fragment.tab)]
              .map(tab => tab[CONTENT_ID])));
          }
        }
        // A change the history doesn't hold would leave its steps naming tabs and views that no longer exist (CORE-94).
        else this.scope.clear();
      }
      return result;
    } finally { this.pruneReplayState(); release(); }
  }
  /** Every session value a step can hold, by key, detached. */
  private sessionValues(): Map<string, unknown> {
    const values = new Map<string, unknown>([[TABS, this.readKey(TABS)]]);
    for (const tab of this.tabs) { values.set(HEADER + tab.id, this.readKey(HEADER + tab.id)); values.set(CONTENT + tab.id, this.readKey(CONTENT + tab.id)); }
    return values;
  }
  private readKey(key: string): unknown {
    if (key.startsWith(PANEL) || key.startsWith(BINDING)) {
      const binding = key.startsWith(BINDING), [identity, instance] = JSON.parse(key.slice(binding ? BINDING.length : PANEL.length)) as [number, string];
      const content = this.contentStates.get(identity), panel = content?.panels.find(item => item.id === instance);
      if (binding) return clone(panel?.binding);
      if (!panel) return undefined;
      const dock = panelDock(content!.dock);
      const { binding: _binding, ...identityData } = panel;
      return clone({ panel: panel.type === "view" ? panel : identityData, placementVersion: this.placementVersions.get(identity) ?? 0, open: { wide: openIn(content!.dock, instance, "wide"), compact: openIn(content!.dock, instance, "compact") },
        closed: { wide: dock.wide.closed.includes(instance), compact: dock.compact.closed.includes(instance) },
        closedIndex: { wide: dock.wide.closed.indexOf(instance), compact: dock.compact.closed.indexOf(instance) },
        parked: Object.fromEntries((["wide", "compact"] as const).flatMap(size => dock[size].parked?.[instance] ? [[size, dock[size].parked[instance]]] : [])),
        places: Object.fromEntries((["wide", "compact"] as const).flatMap(size => {
          const place = panelPlace(dock[size], instance);
          if (!place) return [];
          // A later park must not erase the ordering reference of an earlier Add's Redo snapshot.
          const group = [...place.group];
          for (const [id, peer] of Object.entries(dock[size].closed.includes(instance) ? {} : dock[size].lastPlace ?? {})) {
            if (peer.groupId !== place.groupId || (!place.groupId && !peer.group.includes(instance)) || group.includes(id)) continue;
            const at = peer.group.indexOf(id), after = peer.group.slice(at + 1).find(id => group.includes(id));
            const before = peer.group.slice(0, at).reverse().find(id => group.includes(id));
            group.splice(after ? group.indexOf(after) : before ? group.indexOf(before) + 1 : group.length, 0, id);
          }
          return [[size, { ...place, group, index: group.indexOf(instance) }]];
        })) } satisfies PanelMembership);
    }
    if (key.startsWith(VIEW_PLACEMENT)) {
      const view = key.slice(VIEW_PLACEMENT.length);
      if (!this.graph.has(view)) return undefined;
      const tab = this.viewTab(view);
      // Undo captures the slot actually used, including any arrangement saved since the view opened.
      return { view, tab, arrangement: this.dock(tab) } satisfies ViewPlacement;
    }
    if (key === TABS) {
      const shown = this.focus.shownTab();
      return clone({ order: this.tabs.map(tab => tab.id), closed: this.closed, ...(shown ? { shown } : {}) } satisfies Tabs);
    }
    const id = key.startsWith(HEADER) ? key.slice(HEADER.length) : key.slice(CONTENT.length), tab = this.tabs.find(item => item.id === id);
    if (!tab) return undefined;
    return clone(key.startsWith(HEADER) ? headerOf(tab) : contentOf(tab));
  }
  /** The scope the graph records into: its checkpoints join a running operation's step, and go to the session's scope otherwise. */
  private graphScope(): ViewHistoryScope {
    const scope = () => this.scope;
    return {
      checkpoint: (keys, label, options) => {
        const collecting = this.collecting;
        if (!collecting) return scope().checkpoint(keys, label, options);
        for (const key of keys) if (!collecting.has(key)) collecting.set(key, options?.read ? options.read(key) : this.graphTarget.read(key));
        return undefined;
      },
      clear: () => scope().clear(), seal: () => scope().seal(), undo: () => scope().undo(), redo: () => scope().redo(), state: () => scope().state(),
      withoutHistory: apply => scope().withoutHistory(apply),
      get recording() { return scope().recording; },
    };
  }
  /**
   * The session's history target: the graph's values and its own. An Undo or Redo is checked as a whole before anything changes: the tab
   * order names each tab once, every tab in it exists and no other does, and every view is in one of them.
   */
  private historyTarget(): HistoryTarget {
    return {
      read: key => sessionKey(key) ? this.readKey(key) : this.graphTarget.read(key),
      apply: (values, cause) => {
        const keys = Object.keys(values), graphValues = Object.fromEntries(keys.filter(key => !sessionKey(key)).map(key => [key, values[key]]));
        const tabs = values[TABS] as Tabs | undefined, order = tabs ? tabs.order : this.tabs.map(tab => tab.id);
        const headers = new Map(this.tabs.map(tab => [tab.id, headerOf(tab)])), contents = new Map(this.tabs.map(tab => [tab.id, contentOf(tab)]));
        for (const key of keys) {
          const value = values[key];
          if (key.startsWith(HEADER)) { const id = key.slice(HEADER.length); if (value) headers.set(id, value as Header); else headers.delete(id); }
          else if (key.startsWith(CONTENT)) { const id = key.slice(CONTENT.length); if (value) contents.set(id, value as Content); else contents.delete(id); }
        }
        const live = new Set(order);
        if (live.size !== order.length || headers.size !== live.size || contents.size !== live.size || [...headers.keys()].some(id => !live.has(id))
          || [...contents.keys()].some(id => !live.has(id))) return false;
        const structure = graphValues[STRUCTURE] as { views: readonly ViewRecord[] } | undefined;
        const views = structure ? structure.views : (this.graphTarget.read(STRUCTURE) as { views: readonly ViewRecord[] }).views;
        if (views.some(view => !view.tab || !live.has(view.tab)) || [...this.keptTabs].some(tab => !live.has(tab))) return false;
        const placements = keys.filter(key => key.startsWith(VIEW_PLACEMENT) && values[key] !== undefined)
          .map(key => ({ key, placement: values[key] as ViewPlacement }));
        if (placements.some(({ key, placement }) => key !== VIEW_PLACEMENT + placement.view
          || !views.some(view => view.id === placement.view && view.tab === placement.tab))) return false;
        // What the step holds of the state outside Undo (arrangements and instances, what scenes show, focus numbers) is as it was when it
        // was recorded: a tab or fragment it brings in takes that state from what it takes away, so nothing done since is lost.
        const states = new Map(this.contentStates);
        for (const content of [...contents.values(), ...(tabs?.closed ?? this.closed).map(fragment => fragment.tab)])
          if (!states.has(content[CONTENT_ID])) states.set(content[CONTENT_ID], contentOf(content as HeldTab));
        // Replay only the named fields and this instance's membership/place; never restore a whole pre-drag dock.
        const fields: { key: string; identity: number; instance: string; binding: boolean }[] = [];
        for (const key of keys) if (key.startsWith(PANEL) || key.startsWith(BINDING)) {
          const binding = key.startsWith(BINDING), [identity, instance] = JSON.parse(key.slice(binding ? BINDING.length : PANEL.length)) as [number, string];
          if (!states.has(identity)) return false;
          fields.push({ key, identity, instance, binding });
        }
        for (const identity of new Set(fields.filter(field => !field.binding).map(field => field.identity))) {
          const content = states.get(identity)!, members: Parameters<typeof replayPanelsDock>[1][number][] = [];
          let dock = content.dock, panels = [...content.panels];
          for (const field of fields.filter(field => field.identity === identity && !field.binding)) {
            const wanted = values[field.key] as PanelMembership;
            if (wanted && wanted.panel.id !== field.instance) return false;
            if (!wanted) { dock = changePanelDock(dock, field.instance, "erase"); panels = panels.filter(panel => panel.id !== field.instance); }
            else { if (!panels.some(panel => panel.id === field.instance)) panels.push(wanted.panel);
              members.push({ instance: field.instance, recordedPlace: wanted.placementVersion === (this.placementVersions.get(identity) ?? 0),
                open: wanted.open, closed: wanted.closed, closedIndex: wanted.closedIndex, parked: wanted.parked, places: wanted.places,
                latest: this.latestPlaces.get(identity)?.get(field.instance) }); }
          }
          if (members.length) dock = replayPanelsDock(dock, members);
          // Absent members can shift every window index; restore the order of the latest external arrangement as a set.
          const latest = this.latestPlaces.get(identity);
          if (dock && latest) {
            const state = panelDock(dock);
            for (const size of ["wide", "compact"] as const) {
              const order = new Map([...latest.values()].flatMap(places => {
                const place = places[size];
                return place && !("closed" in place) && place.windowId !== undefined && place.windowIndex !== undefined
                  ? [[place.windowId, place.windowIndex] as const] : [];
              }));
              state[size].floating.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
            }
            dock = dockWith(dock, state);
          }
          states.set(identity, { ...content, panels, dock });
        }
        for (const { key, identity, instance, binding } of fields) if (binding) {
          const content = states.get(identity)!;
          const current = content.panels.find(panel => panel.id === instance);
          if (!current && fields.some(field => !field.binding && field.identity === identity && field.instance === instance && values[field.key] === undefined)) continue;
          if (!current || current.type === "view" || values[key] !== undefined && !panelBindingOf(values[key])) return false;
          const { binding: _old, ...rest } = current;
          states.set(identity, { ...content, panels: content.panels.map(panel => panel.id === instance
            ? { ...rest, ...(values[key] ? { binding: clone(values[key]) as PanelBinding } : {}) } : panel) });
        }
        for (const [tab, content] of contents) contents.set(tab, states.get(content[CONTENT_ID])!);
        const closed = this.replayedFragments(tabs ? tabs.closed : this.closed, states);
        const identities = [...contents.values()].flatMap(content => content.panels.map(panel => panel.id));
        if (new Set(identities).size !== identities.length) return false;
        this.releaseReplay ??= this.holdAll();
        if (Object.keys(graphValues).length && !this.graphTarget.apply(graphValues, cause)) {
          const release = this.releaseReplay; this.releaseReplay = undefined;
          release(); return false;
        }
        // Settled whole (tabs, fragments and the shown tab) before anyone hears; listeners hear once the move has settled (`settled`).
        this.releaseReplay ??= this.holdAll();
        const removed = new Map(this.tabs.map((tab, at) => [tab.id, at] as const).filter(([id]) => !live.has(id)));
        const back = order.filter(id => !this.tabs.some(tab => tab.id === id));
        const previous = this.tabs;
        this.contentStates = states;
        this.tabs = order.map(id => clone({ ...headers.get(id)!, ...contents.get(id)! }) as HeldTab);
        this.closed = clone(closed);
        this.updatePanelVersions(previous);
        this.settleShown({ ...(tabs?.shown ? { shown: tabs.shown } : {}), back, removed });
        for (const { placement } of placements) this.opening = { ...clone(placement), revision: ++this.openingRevision };
        // Navigation belongs to the live session, never to a history position. settleShown above
        // handles D15's tab lifetime exception; updatePanelVersions clears only an unavailable focus.
        this.changed();
        return true;
      },
      settled: () => {
        const release = this.releaseReplay;
        this.releaseReplay = undefined;
        try { this.graphTarget.settled?.(); } finally { try { release?.(); } finally { this.pruneReplayState(); } }
      },
    };
  }
  /**
   * The closed fragments a replay leaves (`next`), and the contents of the tabs it brings in or replaces (changed in place), with the state
   * outside Undo as it is now. What the replay brings in and what it takes away (a tab it closes, a fragment it reopens or replaces) are
   * the same content when their identities (`@content`) match, empty ones too: the arrangement and instances come from the one taken away.
   * Fragments brought in also show what their scenes show now and keep their views' focus numbers as they are now.
   */
  private replayedFragments(next: readonly HeldClosed[], states: ReadonlyMap<number, Content>): HeldClosed[] {
    const focus = this.focus.viewOrder();
    return next.map(fragment => {
      const from = states.get(fragment.tab[CONTENT_ID]);
      return { ...fragment, tab: from ? { ...fragment.tab, dock: from.dock, panels: from.panels } : fragment.tab,
        nodes: fragment.nodes.map(item => {
          const target = item.slot === "scene" ? this.targets.get(item.node.id) : undefined;
          return target ? { ...item, node: withTarget(graphScene(item.node), target) } : item;
        }),
        focus: Object.fromEntries(fragment.views.flatMap(({ view }) => {
          const at = focus[view.id] ?? fragment.focus[view.id];
          return at !== undefined ? [[view.id, at]] : [];
        })) };
    });
  }
  /**
   * The shown tab after an Undo or Redo: it stays, unless the step brought back the tab its state showed (shown again) or took the shown
   * tab away (the tab its state showed, else the neighbour).
   */
  private settleShown({ shown, back, removed }: { shown?: TabId; back: TabId[]; removed: Map<TabId, number> }) {
    const live = (id: TabId | undefined) => id !== undefined && this.tabs.some(tab => tab.id === id), now = this.focus.shownTab();
    if (shown && back.includes(shown)) this.focus.showTab(shown);
    else if (!live(now)) this.focus.showTab(live(shown) ? shown : this.neighbour(now !== undefined ? removed.get(now) ?? 0 : 0));
  }

  // ----- Helpers -----
  /** Structural captures are monotonic even across Undo/back-to-equal bindings and close/reopen. Arrangement/focus never stale them. */
  private updatePanelVersions(previous: readonly HeldTab[]) {
    for (const id of new Set([...previous.map(tab => tab.id), ...this.tabs.map(tab => tab.id)])) {
      const before = previous.find(tab => tab.id === id), after = this.tabs.find(tab => tab.id === id);
      if (before?.[CONTENT_ID] !== after?.[CONTENT_ID]) this.tabVersions.set(id, ++this.structuralVersion);
      for (const instance of new Set([...(before?.panels ?? []).map(panel => panel.id), ...(after?.panels ?? []).map(panel => panel.id)])) {
        const a = before?.panels.find(panel => panel.id === instance), b = after?.panels.find(panel => panel.id === instance);
        if (!a || !b || !same(a.binding, b.binding) || (["wide", "compact"] as const).some(size => openIn(before?.dock ?? null, instance, size) !== openIn(after?.dock ?? null, instance, size)))
          this.panelVersions.set(instance, ++this.structuralVersion);
      }
    }
    const focused = this.focus.focusedPanel();
    if (focused) { const panel = this.panel(focused); if (!panel || !(["wide", "compact"] as const).some(size => openIn(this.dock(panel.tab), focused, size))) this.focus.focusPanel(undefined); }
  }
  private index(tab: TabId): number {
    const at = this.tabs.findIndex(item => item.id === tab);
    if (at < 0) throw new TabRefusal("missing_target", "That tab is closed.");
    return at;
  }
  private existing(tab: TabId) { this.index(tab); }
  /** An exact fragment, with the tab-ID route kept for older callers (default: the most recently closed). */
  private closedFragment(closed: TabId | undefined): HeldClosed | undefined {
    return closed === undefined ? this.closed.at(-1) : this.closed.find(item => item.id === closed) ?? [...this.closed].reverse().find(item => item.tab.id === closed);
  }
  /**
   * Throws a refusal (with the reason) when the tab's views can't go: one is a newer build's. The view the window draws may go: the window
   * then draws another view of the shown tab, or none (experiment 044 P2-iii).
   */
  checkClosable(tab: TabId) {
    if (this.keptTabs.has(tab)) throw new TabRefusal("incompatible_mode", "This tab holds a view from a newer version of XF Studio. Close or reset it there.");
  }
  /** A tab with a new content identity (a new, duplicated or reset tab's, or one read from storage). */
  private held(tab: LayoutTab): HeldTab { const held = { ...tab, [CONTENT_ID]: ++this.contents }; this.rememberContent(held); return held; }
  private rememberContent(tab: HeldTab) { this.contentStates.set(tab[CONTENT_ID], contentOf(tab)); }
  private arranged(tab: HeldTab) {
    const identity = tab[CONTENT_ID], dock = panelDock(tab.dock), latest = this.latestPlaces.get(identity) ?? new Map();
    this.placementVersions.set(identity, (this.placementVersions.get(identity) ?? 0) + 1);
    for (const panel of tab.panels) latest.set(panel.id, Object.fromEntries((["wide", "compact"] as const).flatMap(size => {
      const place = panelPlace(dock[size], panel.id); return place ? [[size, place]] : [];
    })));
    this.latestPlaces.set(identity, latest); this.rememberContent(tab);
  }
  private pruneReplayState() {
    const held = this.scope.held(), contents = new Set([...this.tabs, ...this.closed.map(fragment => fragment.tab)].map(tab => tab[CONTENT_ID]));
    for (const [step, identities] of this.retainedContents) {
      if (!held.has(step)) { this.retainedContents.delete(step); continue; }
      for (const identity of identities) contents.add(identity);
    }
    for (const identity of this.contentStates.keys()) if (!contents.has(identity)) { this.contentStates.delete(identity); this.placementVersions.delete(identity); this.latestPlaces.delete(identity); }
  }
  /** The tab beside place `at` once the tab there went: the next, else the last (undefined: none). */
  private neighbour(at: number): TabId | undefined { return (this.tabs[Math.min(at, this.tabs.length - 1)] ?? this.tabs.at(-1))?.id; }
  /** A tab as a closed fragment: it, its views and a value copy of every node they name (each with its place), and their focus numbers. */
  private fragment(tab: HeldTab, at: number): HeldClosed {
    const graph = this.storedGraph(this.graph), ids = this.graph.viewIds(), order = this.focus.viewOrder();
    const views = (graph.views as ViewRecord[]).filter(view => view.tab === tab.id && this.graph.has(view.id)).map(view => ({ view: view as SessionView & ViewRecord, at: ids.indexOf(view.id) }));
    const nodes: ClosedTab["nodes"][number][] = [], seen = new Set<string>();
    for (const { view } of views) for (const slot of VIEW_SLOTS) {
      if (seen.has(view[slot])) continue;
      seen.add(view[slot]);
      const list = graph[SLOT_COLLECTIONS[slot]], index = list.findIndex(node => node.id === view[slot]), node = list[index]!;
      const target = slot === "scene" ? this.scene(node.id) : undefined;
      nodes.push({ slot, node: target ? withTarget(node, target) : node, at: index });
    }
    const focus = Object.fromEntries(views.flatMap(({ view }) => order[view.id] !== undefined ? [[view.id, order[view.id]!]] : []));
    return clone({ id: this.fresh(undefined, "closed-"), tab, at, views, nodes, focus });
  }
  /** The nodes a fragment brings back (those not in the graph); refused when its views or nodes collide with the session's. */
  private reopenedNodes(fragment: ClosedTab): ClosedTab["nodes"] {
    if (fragment.views.some(({ view }) => this.graph.has(view.id))) throw new TabRefusal("invalid_value", "That tab's views are open already.");
    const graph = this.graph.data(), slotOf = new Map(VIEW_SLOTS.flatMap(slot => graph[SLOT_COLLECTIONS[slot]].map(node => [node.id, slot] as const)));
    if (fragment.nodes.some(({ slot, node }) => slotOf.has(node.id) && slotOf.get(node.id) !== slot)) throw new TabRefusal("invalid_value", "That tab can't be reopened.");
    return fragment.nodes.filter(({ node }) => !slotOf.has(node.id));
  }
  /** A tab's content copied with fresh IDs everywhere (views, every node they name, instances), pins and the arrangement following. */
  private copyOf(tab: HeldTab): TabContent {
    const graph = this.storedGraph(this.graph), ids = new Map<string, string>(), nodes: TabContent["nodes"][number][] = [];
    const views = (graph.views as ViewRecord[]).filter(view => view.tab === tab.id && this.graph.has(view.id));
    for (const view of views) {
      ids.set(view.id, this.fresh("view"));
      for (const slot of VIEW_SLOTS) {
        if (ids.has(view[slot])) continue;
        const node = graph[SLOT_COLLECTIONS[slot]].find(item => item.id === view[slot])!, id = this.fresh(slot), target = slot === "scene" ? this.scene(node.id) : undefined;
        ids.set(view[slot], id);
        nodes.push({ slot, node: { ...clone(node), id, ...(target ? { ...(target.subject ? { subject: target.subject } : {}), ...(target.look ? { look: target.look } : {}), gen: 0 } : {}) } });
      }
    }
    const remap = (id: string) => ids.get(id) ?? id;
    const panels = tab.panels.map(panel => {
      const target = panel.binding?.policy === "pinned" ? panel.binding.target : undefined;
      const binding = target && "view" in target ? { policy: "pinned" as const, target: { view: remap(target.view) } }
        : target && "scene" in target ? { policy: "pinned" as const, target: { scene: remap(target.scene) } } : panel.binding;
      const id = this.freshInstance(panel.type);
      ids.set(panel.id, id);
      return { ...clone(panel), id, ...(binding ? { binding } : {}) };
    });
    const { id: _id, dock, panels: _panels, [CONTENT_ID]: _content, ...header } = tab;
    return { ...clone(header), dock: dock ? rewriteDock(dock, remap) : null, panels,
      views: views.map(view => ({ ...view, id: remap(view.id), ...Object.fromEntries(VIEW_SLOTS.map(slot => [slot, remap(view[slot])])) }) as ViewRecord), nodes };
  }
  /** Content's IDs, checked fresh, and marked used. */
  private checkContent(content: TabContent) {
    const ids = [...content.views.map(view => view.id), ...content.nodes.map(item => item.node.id), ...content.panels.map(panel => panel.id)];
    if (new Set(ids).size !== ids.length || ids.some(id => this.used.has(id) && !this.freshlyMade.has(id)))
      throw new TabRefusal("invalid_value", "That layout can't be added: its IDs are taken.");
    if (typeof content.name !== "string" || nameIssue(content.name.trim())) throw new TabRefusal("invalid_value", "That layout's name can't be used.");
  }
  private contentNodes(content: TabContent): ClosedTab["nodes"] { return content.nodes.map(({ slot, node }) => ({ slot, node, at: Number.MAX_SAFE_INTEGER })); }
  /** Insert a new tab with content at `at` and show it (inside an operation). */
  private insert(id: TabId, content: TabContent, nodes: ClosedTab["nodes"], at: number) {
    this.graph.restructure({ add: content.views.map(view => ({ view: { ...view, tab: id } })),
      nodes: nodes.map(({ slot, node }) => ({ slot, node: slot === "scene" ? graphScene(node) : node })) satisfies AddedNode[] }, { label: "New tab" });
    for (const { slot, node } of nodes) if (slot === "scene") this.targets.set(node.id, targetOf(node));
    const { views: _views, nodes: _nodes, dock, panels, ...header } = content;
    this.tabs.splice(Math.max(0, Math.min(at, this.tabs.length)), 0, this.held({ id, ...clone(header), dock: clone(dock), panels: clone([...panels]) }));
    this.placed([id, ...content.views.map(view => view.id), ...nodes.map(item => item.node.id), ...panels.map(panel => panel.id)]);
    this.focus.showTab(id);
  }
  /** IDs now in the session: used for good, and no longer fresh. */
  private placed(ids: readonly string[]) {
    for (const id of ids) { this.used.add(id); this.freshlyMade.delete(id); }
  }
  /** IDs given out by `freshId` and not yet placed in the session (content built from them is fresh). */
  private readonly freshlyMade = new Set<string>();
  private fresh(kind: "tab" | "view" | ViewSlot | undefined, prefix = PREFIX[kind!], length = ID_LENGTH): string {
    for (let tries = 0; tries < 64; tries++) {
      const id = prefix + Array.from({ length }, () => Math.floor(this.random() * 36).toString(36)).join("");
      if (this.used.has(id)) continue;
      this.used.add(id); this.freshlyMade.add(id);
      return id;
    }
    throw Error("A new ID couldn't be made: the source of randomness keeps repeating itself.");
  }
  /** Every ID a stored session names: tabs, instances, views and nodes, its closed fragments' included. */
  private idsOf(data: ProfileSessionData): string[] {
    const graph = data.views as unknown as Record<string, { id: string }[]>;
    return [...data.tabs.flatMap(tab => [tab.id, ...tab.panels.map(panel => panel.id)]),
      ...[...VIEW_SLOTS.map(slot => SLOT_COLLECTIONS[slot]), "views"].flatMap(list => (graph[list] ?? []).map(item => item.id)),
      ...data.closed.flatMap(item => [...(item.id ? [item.id] : []), item.tab.id, ...item.tab.panels.map(panel => panel.id), ...item.views.map(view => view.view.id), ...item.nodes.map(node => node.node.id)])];
  }
}

/** Why a tab name can't be used (undefined: it can). */
export function nameIssue(name: string): string | undefined {
  if (!name) return "Name the tab.";
  if (name.length > TAB_NAME_LIMIT) return `Keep the name to ${TAB_NAME_LIMIT} characters.`;
  if (control.test(name)) return "Use letters, numbers and punctuation in the name.";
  return undefined;
}
