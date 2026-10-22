/**
 * A profile's session as a window holds it (profiles design §1.1, §4.1; phase 1, before `ProfileSessions` and the tab UI of phase 2): the
 * workspace's `profiles.sessions[profile]` is the source of tab 1, the views, the scenes and the panel instances, and this is what the
 * window reads them from and stores them back to.
 *
 * - **Scenes** name the subject and look they show (`subject`, `look`) and count their changes (`gen`). The view graph (the core's) holds
 *   each scene's display state; this holds what it shows. `setLook` and `setSubject` raise `gen`.
 * - **Tab 1's arrangement** is stored with panel instance IDs (`<type>--<base36>`, a view's panel pinned to its view); the dock works with
 *   panel IDs (`head` for the main view, `view.<id>` for another, a panel contribution's ID otherwise). With one instance of each panel in
 *   a tab (phase 1) the two convert both ways losslessly; a panel the person opens for the first time gets a new instance.
 * - **Focus** is the focus service's (platform/core/focus.ts), restored from the session when it opens and stored with it: each view's
 *   focus number, the session's sequence, the focused panel and the editing context (§3.7). A focus change is a session change (it is
 *   written), never an Undo step.
 */
import type { DockLayout } from "../ui-preferences";
import type { SubjectRef } from "../../platform/api/subjects";
import type { LookRef } from "../../library/collection-documents";
import { MAIN_VIEW, type ViewGraphData, type ViewRecord, type KeptView, type StoredNode } from "../../platform/api/view-graph";
import { rewriteDock, viewOfPanel } from "./profiles-migration-data";
import { FocusService, focusDataOf } from "../../platform/core/focus";
import { type LayoutTab, type PanelInstance, type ProfileSessionData, type SessionScene, type SessionView, WORKSPACE_PROFILES_SCHEMA,
  type WorkspaceProfiles } from "./profile-session";

/** What a scene shows. */
export type SceneTarget = { readonly subject?: SubjectRef; readonly look?: LookRef; readonly gen: number };

const base36 = (random: () => number, length = 8) => Array.from({ length }, () => Math.floor(random() * 36).toString(36)).join("");
/** The dock's panel ID of a view (`head` for the main view). */
export const viewPanel = (view: string) => view === MAIN_VIEW ? "head" : `view.${view}`;

export class ProfileSessionState {
  private readonly targets = new Map<string, SceneTarget>();
  private readonly listeners = new Set<() => void>();
  private tab: LayoutTab;
  /** The session's focus (its one owner); restored from the stored session. */
  readonly focus: FocusService;

  /** `focus`: the window's focus service (the one the history service records the editing context into); default: one of its own. */
  constructor(readonly profile: string, private readonly data: ProfileSessionData, private readonly random: () => number = Math.random,
    focus: FocusService = new FocusService()) {
    for (const scene of data.views.scenes) this.targets.set(scene.id, { ...(scene.subject ? { subject: { ...scene.subject } } : {}),
      ...(scene.look ? { look: { ...scene.look } } : {}), gen: Number.isSafeInteger(scene.gen) ? scene.gen : 0 });
    // Phase 1 shows one tab: the session's first (its views are all in it).
    this.tab = data.tabs[0] ?? { id: `t-${base36(random)}`, name: "Layout 1", dock: null, panels: [] };
    this.focus = focus;
    focus.restore(focusDataOf(data.focus, data.seq));
    focus.subscribe(() => this.changed());
  }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of [...this.listeners]) listener(); }

  /** The view graph the session holds, in the core's form (views without their tab, scenes without what they show). */
  graph(): ViewGraphData {
    const { views, scenes } = this.data.views;
    return { ...this.data.views,
      views: views.map(view => { const { tab: _tab, ...rest } = view as SessionView & Record<string, unknown>; return rest as unknown as ViewRecord | KeptView; }),
      scenes: scenes.map(scene => { const { subject: _s, look: _l, gen: _g, ...rest } = scene as SessionScene & Record<string, unknown>; return rest as StoredNode; }) };
  }
  /** The session's tab (phase 1 shows one: its first). */
  tabId(): string { return this.tab.id; }
  /** The tab a view is in: the one the session stored it in, else the shown tab (a view opened in this window). */
  viewTab(view: string): string { return this.data.views.views.find(item => item.id === view)?.tab ?? this.tab.id; }
  /** A panel instance of the tab: its type and binding. */
  panel(id: string): PanelInstance | undefined { return this.tab.panels.find(panel => panel.id === id); }

  /** What a scene shows. A scene the session hasn't seen yet (a view's scene forked meanwhile) shows what the main view's showed. */
  scene(id: string): SceneTarget {
    const known = this.targets.get(id);
    if (known) return known;
    const inherited = this.inherited();
    this.targets.set(id, inherited);
    return inherited;
  }
  private inherited(): SceneTarget {
    const first = [...this.targets.values()].find(target => target.subject || target.look);
    return { ...(first?.subject ? { subject: { ...first.subject } } : {}), ...(first?.look ? { look: { ...first.look } } : {}), gen: 0 };
  }
  /** What a scene shows, when the session knows it (never made here). */
  knownScene(id: string): SceneTarget | undefined { const known = this.targets.get(id); return known && { ...known }; }
  /** `scene.setLook`: the scene shows `look` (undefined: none); its `gen` rises. */
  setLook(scene: string, look: LookRef | undefined) {
    const current = this.scene(scene);
    if (look ? current.look?.collection === look.collection && current.look.look === look.look : !current.look) return;
    const { look: _old, ...rest } = current;
    this.targets.set(scene, { ...rest, ...(look ? { look: { collection: look.collection, look: look.look } } : {}), gen: current.gen + 1 });
    this.changed();
  }
  /** `scene.setSubject`: the scene shows `subject`; its `gen` rises. */
  setSubject(scene: string, subject: SubjectRef | undefined) {
    const current = this.scene(scene);
    if (subject ? current.subject?.kind === subject.kind && current.subject.id === subject.id : !current.subject) return;
    const { subject: _old, ...rest } = current;
    this.targets.set(scene, { ...rest, ...(subject ? { subject: { kind: subject.kind, id: subject.id } } : {}), gen: current.gen + 1 });
    this.changed();
  }

  /** Tab 1's arrangement with the dock's panel IDs (null: the default arrangement). */
  dock(): DockLayout | null {
    if (!this.tab.dock) return null;
    const byInstance = new Map(this.tab.panels.map(panel => [panel.id, panel]));
    return rewriteDock(this.tab.dock, id => {
      const panel = byInstance.get(id);
      if (!panel) return id;
      const target = panel.binding?.policy === "pinned" ? panel.binding.target : undefined;
      return panel.type === "view" && target && "view" in target ? viewPanel(target.view) : panel.type;
    });
  }
  /** The instance of a panel type (or a view's panel) in tab 1, made the first time a type is opened. */
  instance(panel: string): string { return this.instanceOf(panel).id; }
  private instanceOf(panel: string): PanelInstance {
    const view = viewOfPanel(panel);
    const found = this.tab.panels.find(item => view
      ? item.type === "view" && item.binding?.policy === "pinned" && "view" in item.binding.target && item.binding.target.view === view
      : item.type === panel);
    if (found) return found;
    const made: PanelInstance = view ? { id: `view--${base36(this.random)}`, type: "view", binding: { policy: "pinned", target: { view } } }
      : { id: `${panel}--${base36(this.random)}`, type: panel };
    this.tab = { ...this.tab, panels: [...this.tab.panels, made] };
    return made;
  }

  /**
   * The workspace's `profiles` with this session as it is now: `graph` (the core's view graph), `dock` (the dock's arrangement, with panel
   * IDs) and focus. Each view stays in the tab it was stored in, and a view opened here is in the shown tab; each scene names what it shows.
   */
  stored(input: { graph: ViewGraphData; dock: DockLayout | undefined | null }, others?: WorkspaceProfiles): WorkspaceProfiles {
    const dock = input.dock ? rewriteDock(input.dock, panel => this.instanceOf(panel).id) : null;
    if (dock || input.dock === null) this.tab = { ...this.tab, dock };
    const views: SessionView[] = input.graph.views.map(view => ({ ...(view as ViewRecord | KeptView), tab: this.viewTab(view.id) }));
    const scenes: SessionScene[] = input.graph.scenes.map(scene => {
      const target = this.scene(scene.id);
      return { ...scene, ...(target.subject ? { subject: target.subject } : {}), ...(target.look ? { look: target.look } : {}), gen: target.gen };
    });
    const ids = new Set(input.graph.views.map(view => view.id)), { seq, views: order, ...rest } = this.focus.snapshot();
    const focus = { views: Object.fromEntries(Object.entries(order).filter(([view]) => ids.has(view))), ...rest };
    const session: ProfileSessionData = { ...this.data, tabs: [this.tab, ...this.data.tabs.slice(1)], views: { ...input.graph, views, scenes }, focus, seq };
    return { schema: WORKSPACE_PROFILES_SCHEMA, sessions: { ...(others?.sessions ?? {}), [this.profile]: session } };
  }
}
