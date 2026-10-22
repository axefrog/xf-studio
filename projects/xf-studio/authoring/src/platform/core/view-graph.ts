/**
 * The view graph service (research/authoring/view-graph-design.md §3.3): the one owner of every view's camera, light, display,
 * scene and tool state. DOM-free. It validates every edit against the composition's rules, keeps each node alive exactly while
 * a view references it (an edit that leaves a node unreferenced removes it in the same commit), publishes detached reads and
 * tells subscribers what each commit changed, so the devices that draw a node follow it and nothing else redraws.
 *
 * Its edits flow through the View and lighting history (§3.6, revised 27 September; the history service's `view` scope): a session-only Undo history separate from
 * look history. A continuous edit (a slider drag) coalesces into one step until it is sealed (the slider was released, CORE-95).
 * Every structure edit records a step, and a replay that would leave a view naming a missing node is refused (CORE-94). Camera
 * navigation records nothing; a camera jump records a step and leaves a Back/Forward trail on its camera node, so a shared camera
 * shares its trail.
 *
 * Views and nodes this build can't show (a newer build's view, scene, camera or rig kind) are kept as stored and written back
 * unchanged, with the nodes they reference, so a newer build's views survive a round trip through this one.
 */
import { MAIN_VIEW, SLOT_COLLECTIONS, VIEW_GRAPH_1, VIEW_SLOTS, validViewId, viewPanelId, type GraphNode, type KeptView, type SceneKind,
  type StoredNode, type ViewGraphChange, type ViewGraphData, type ViewGraphRules, type ViewGraphSnapshot, type ViewHistoryState,
  type ViewId, type ViewRecord, type ViewSlot } from "../api/view-graph";
import { createHistoryService, VIEW_SCOPE, type HistoryScope, type HistoryService } from "./history-service";

/** At most this many views (design §3.7: four visible, the rest as tabs) and nodes of one slot. */
export const MAX_VIEWS = 16;
/** Steps kept in the View and lighting history, and camera positions in each Back/Forward trail. */
export const VIEW_HISTORY_LIMIT = 50;
export const CAMERA_TRAIL_LIMIT = 20;

export type ViewEditOptions = {
  /** The step's name in the View and lighting history ("Light change"); without it a node edit records nothing. */
  label?: string;
  /** Edits with the same key in a row form one step until `seal()` ends the run (a slider was released). */
  coalesce?: string;
  /** The device already shows the result (it computed it): subscribers must not apply it again. */
  applied?: boolean;
  /** Restore-time state (a fallback the loaded head needs): records nothing and marks no edit. */
  seed?: boolean;
};

type NodeEntry = { id: string; slot: ViewSlot; kind?: string; state: Record<string, unknown> };
/** A node this build can't read (an unknown kind): its stored record, written back unchanged. */
type KeptNode = { slot: ViewSlot; record: StoredNode };
/** A view this build can't show, with its place in the stored list (so a round trip keeps the order). */
type KeptEntry = { at: number; record: KeptView };
type Structure = { views: ViewRecord[] };
/** The View and lighting history's key for the views: outside the node-ID grammar, so no node can take it. */
export const VIEW_HISTORY_STRUCTURE = "@structure";
const STRUCTURE = VIEW_HISTORY_STRUCTURE;
type Trail = { back: Record<string, unknown>[]; forward: Record<string, unknown>[] };
type Parsed = { views: ViewRecord[]; nodes: Map<string, NodeEntry>; legacyFocus: ViewId; keptViews: KeptEntry[]; keptNodes: Map<string, KeptNode> };
const clone = <T>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const validNodeId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);
/** A structure edit's step name when its caller gives none: every structure edit records (CORE-94). */
const SLOT_NAMES: Record<ViewSlot, string> = { scene: "scene", camera: "camera", lights: "lights", display: "display", tools: "tools" };

export class ViewGraphError extends Error {
  constructor(readonly code: "missing_target" | "invalid_value" | "incompatible_mode", message: string) { super(message); }
}

/**
 * Parse stored graph data against the rules: every view references existing nodes of the right slot, IDs are unique and valid,
 * each node's state passes its codec and each view's camera and rig suit its scene. A view or node of a kind this build doesn't know
 * is kept unchanged (see `KeptView`). Unreferenced nodes are dropped. Returns undefined for anything else (damage, or a main view
 * this build can't show), so a damaged graph falls back to the default one.
 */
export function parseViewGraph(value: unknown, rules: ViewGraphRules): ViewGraphData | undefined {
  const parsed = parseGraph(value, rules);
  return parsed && writeData(parsed.views, parsed.nodes, parsed.legacyFocus, parsed.keptViews, parsed.keptNodes);
}

/** Whether a slot's node kind is one this build doesn't know (kept, not refused). */
const unknownKind = (rules: ViewGraphRules, slot: ViewSlot, kind: unknown) => {
  const kinds = rules.codecs[slot].kinds;
  return kinds ? typeof kind === "string" && kind.length > 0 && kind.length <= 40 && !kinds.includes(kind) : kind !== undefined;
};

function parseGraph(value: unknown, rules: ViewGraphRules): Parsed | undefined {
  const input = record(value);
  if (!input || input.schema !== VIEW_GRAPH_1 || !Array.isArray(input.views) || !input.views.length || input.views.length > MAX_VIEWS) return;
  const nodes = new Map<string, NodeEntry>(), keptNodes = new Map<string, KeptNode>();
  for (const slot of VIEW_SLOTS) {
    const list = input[SLOT_COLLECTIONS[slot]];
    if (!Array.isArray(list) || list.length > MAX_VIEWS) return;
    for (const item of list) {
      const stored = record(item);
      if (!stored || !validNodeId(stored.id) || nodes.has(stored.id) || keptNodes.has(stored.id)) return;
      const { id, kind, ...state } = stored;
      if (unknownKind(rules, slot, kind)) { keptNodes.set(id, { slot, record: clone(stored) as StoredNode }); continue; }
      const entry = nodeEntry(rules, slot, id, kind, state);
      if (!entry) return;
      nodes.set(id, entry);
    }
  }
  const slotOf = (ref: unknown) => typeof ref === "string" ? nodes.get(ref)?.slot ?? keptNodes.get(ref)?.slot : undefined;
  const views: ViewRecord[] = [], keptViews: KeptEntry[] = [], ids = new Set<string>();
  for (const [at, item] of input.views.entries()) {
    const view = record(item);
    if (!view || !validViewId(view.id) || ids.has(view.id) || typeof view.kind !== "string") return;
    if (view.title !== undefined && (typeof view.title !== "string" || view.title.length > 60)) return;
    ids.add(view.id);
    // A newer build's view kind: every node it names must exist in that slot; it is kept as stored.
    if (view.kind !== "3d") {
      if (view.kind.length > 40 || VIEW_SLOTS.some(slot => view[slot] !== undefined && slotOf(view[slot]) !== slot)) return;
      keptViews.push({ at, record: clone(view) as KeptView });
      continue;
    }
    if (VIEW_SLOTS.some(slot => slotOf(view[slot]) !== slot)) return;
    const refs = Object.fromEntries(VIEW_SLOTS.map(slot => [slot, view[slot] as string])) as Record<ViewSlot, string>;
    // A 3D view over a kind this build doesn't know (a kept node, an unregistered scene kind) is kept, not drawn.
    const scene = nodes.get(refs.scene);
    if (VIEW_SLOTS.some(slot => keptNodes.has(refs[slot])) || !rules.scenes.some(rule => rule.kind === scene?.kind)) {
      keptViews.push({ at, record: clone(view) as KeptView });
      continue;
    }
    views.push({ id: view.id, kind: "3d", ...(view.title !== undefined ? { title: view.title as string } : {}), ...refs });
  }
  // `focused` is no longer focus (that is the session's, platform/core/focus.ts): it is kept as stored for older builds, which need it.
  if (!views.some(view => view.id === MAIN_VIEW) || (input.focused !== undefined && (typeof input.focused !== "string" || !ids.has(input.focused)))) return;
  for (const view of views) if (fitIssue(rules, view, nodes)) return;
  const legacyFocus = typeof input.focused === "string" && views.some(view => view.id === input.focused) ? input.focused : MAIN_VIEW;
  const used = usedNodes(views, keptViews);
  for (const id of [...nodes.keys()]) if (!used.has(id)) nodes.delete(id);
  for (const id of [...keptNodes.keys()]) if (!used.has(id)) keptNodes.delete(id);
  return { views, nodes, legacyFocus, keptViews, keptNodes };
}

/** Every node a view references: the shown views' slots and whatever the kept views name. */
function usedNodes(views: readonly ViewRecord[], kept: readonly KeptEntry[]): Set<string> {
  return new Set([...views.flatMap(view => VIEW_SLOTS.map(slot => view[slot])),
    ...kept.flatMap(({ record: view }) => VIEW_SLOTS.map(slot => view[slot]).filter((ref): ref is string => typeof ref === "string"))]);
}
function nodeEntry(rules: ViewGraphRules, slot: ViewSlot, id: string, kind: unknown, state: Record<string, unknown>): NodeEntry | undefined {
  const codec = rules.codecs[slot];
  if (codec.kinds ? typeof kind !== "string" || !codec.kinds.includes(kind) : kind !== undefined) return;
  const parsed = codec.parse(state, kind as string | undefined);
  return parsed ? { id, slot, ...(kind === undefined ? {} : { kind: kind as string }), state: parsed } : undefined;
}
/** Why a view's camera or rig does not suit its scene kind, or undefined when it does (design §3.2). */
function fitIssue(rules: ViewGraphRules, view: ViewRecord, nodes: ReadonlyMap<string, NodeEntry>): string | undefined {
  const scene = nodes.get(view.scene)!, rule = rules.scenes.find(item => item.kind === scene.kind);
  if (!rule) return `A ${scene.kind ?? "scene"} scene isn't something this version of XF Studio can show.`;
  const camera = nodes.get(view.camera)!.kind, rig = nodes.get(view.lights)!.kind;
  if (camera === undefined || !rule.cameras.includes(camera)) return `This camera can't look at a ${rule.kind} scene.`;
  if (rig === undefined || !rule.rigs.includes(rig)) return `These lights can't light a ${rule.kind} scene.`;
}
/** `legacyFocus`: the stored `focused`, written back for older builds while it names a shown view (else the main view). */
function writeData(views: readonly ViewRecord[], nodes: ReadonlyMap<string, NodeEntry>, legacyFocus: ViewId,
  keptViews: readonly KeptEntry[] = [], keptNodes: ReadonlyMap<string, KeptNode> = new Map()): ViewGraphData {
  const used = usedNodes(views, keptViews);
  const list = (slot: ViewSlot): StoredNode[] => [
    ...[...nodes.values()].filter(node => node.slot === slot && used.has(node.id))
      .map(node => ({ id: node.id, ...(node.kind === undefined ? {} : { kind: node.kind }), ...clone(node.state) })),
    ...[...keptNodes.entries()].filter(([id, node]) => node.slot === slot && used.has(id)).map(([, node]) => clone(node.record))];
  // Kept views go back where they were stored, among the views this build shows.
  const all: (ViewRecord | KeptView)[] = clone([...views]);
  for (const kept of [...keptViews].sort((a, b) => a.at - b.at)) all.splice(Math.min(kept.at, all.length), 0, clone(kept.record));
  return { schema: VIEW_GRAPH_1, views: all, scenes: list("scene"), cameras: list("camera"), lights: list("lights"),
    display: list("display"), tools: list("tools"), focused: views.some(view => view.id === legacyFocus) ? legacyFocus : MAIN_VIEW };
}

/** The graph service. One per workspace; devices and services act on the views it lists. */
export class ViewGraph {
  private views: ViewRecord[];
  private nodes = new Map<string, NodeEntry>();
  /** The stored `focused`, kept for older builds only: this graph has no focus (the session's focus service does). */
  private readonly legacyFocus: ViewId;
  /** Views and nodes this build keeps unchanged (never drawn or edited); the nodes the kept views name stay alive. */
  private readonly keptViews: readonly KeptEntry[];
  private readonly keptNodes: ReadonlyMap<string, KeptNode>;
  private readonly keptRefs: ReadonlySet<string>;
  private listeners = new Set<(change: ViewGraphChange) => void>();
  /** The View and lighting history: the history service's view scope over this graph (session-only). */
  private readonly scope: HistoryScope;
  private trails = new Map<string, Trail>();
  /** Tools and view settings the presentation no longer offers (UI-102, UI-163): each view keeps its choice, and no device acts on them. */
  private withdrawnIds = new Set<string>();
  private counter = 0;

  /** `history` is the session's history service (default: one of its own); the graph's edits record in its view scope. */
  constructor(data: ViewGraphData, private rules: ViewGraphRules, history: HistoryService = createHistoryService()) {
    const parsed = parseGraph(data, rules);
    if (!parsed) throw new ViewGraphError("invalid_value", "The view graph is not valid.");
    this.views = parsed.views;
    this.nodes = parsed.nodes;
    this.legacyFocus = parsed.legacyFocus;
    this.keptViews = parsed.keptViews;
    this.keptNodes = parsed.keptNodes;
    this.keptRefs = usedNodes([], parsed.keptViews);
    // Values are kept by reference (each step holds detached copies), so a drag costs no serialisation.
    this.scope = history.open(VIEW_SCOPE, { read: key => this.readHistory(key), apply: values => this.applyHistory(values),
      settled: () => this.publishHistory() },
      { limit: VIEW_HISTORY_LIMIT });
  }

  // ----- Reads -----
  /** The stored form (`xfs/view-graph-1`), detached, with every kept view and node as it was stored. */
  data(): ViewGraphData { return writeData(this.views, this.nodes, this.legacyFocus, this.keptViews, this.keptNodes); }
  snapshot(): ViewGraphSnapshot {
    return { views: this.views.map(view => ({ ...clone(view),
      shared: VIEW_SLOTS.filter(slot => this.views.some(other => other !== view && other[slot] === view[slot])),
      sceneKind: this.nodes.get(view.scene)!.kind as SceneKind, panel: viewPanelId(view.id) })) };
  }
  viewIds(): ViewId[] { return this.views.map(view => view.id); }
  has(view: ViewId) { return this.views.some(item => item.id === view); }
  /** The view a command names, checked: throws `missing_target` for a view that does not exist. */
  target(view: ViewId): ViewId {
    if (!this.has(view)) throw new ViewGraphError("missing_target", "That view no longer exists.");
    return view;
  }
  /** The node a view's slot references, detached. */
  node(view: ViewId, slot: ViewSlot): GraphNode {
    const node = this.nodes.get(this.record(view)[slot])!;
    return { id: node.id, ...(node.kind === undefined ? {} : { kind: node.kind }), state: clone(node.state) };
  }
  /** A node's state by the view that references it, detached. */
  state<S extends Record<string, unknown>>(view: ViewId, slot: ViewSlot): S { return this.node(view, slot).state as S; }
  kind(view: ViewId, slot: ViewSlot): string | undefined { return this.nodes.get(this.record(view)[slot])!.kind; }
  /** The views that reference a node (the node's sharers). */
  viewsOf(nodeId: string): ViewId[] { return this.views.filter(view => VIEW_SLOTS.some(slot => view[slot] === nodeId)).map(view => view.id); }
  /** Whether two views share a slot's node. */
  shares(view: ViewId, other: ViewId, slot: ViewSlot) { return this.record(view)[slot] === this.record(other)[slot]; }
  private record(view: ViewId): ViewRecord {
    const found = this.views.find(item => item.id === view);
    if (!found) throw new ViewGraphError("missing_target", "That view no longer exists.");
    return found;
  }
  /** Whether a node is still referenced: by a view shown here, or by a kept view. */
  private referenced(id: string) { return this.keptRefs.has(id) || this.views.some(view => VIEW_SLOTS.some(slot => view[slot] === id)); }

  subscribe(listener: (change: ViewGraphChange) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  // ----- Withdrawn tools -----
  /**
   * Withdraw view tools (UI-102) and view settings (UI-163): the presentation no longer offers them (their module is hidden, or
   * research tools are off), so no device may act on them. Each view's node keeps its choice, saved and in force again once it is
   * offered again; `activeTools` (and `withdrawn`) is what devices apply. Presentation input for this session: it records nothing and marks no edit. Returns
   * whether the withdrawn set changed.
   */
  withdrawTools(tools: readonly string[]): boolean {
    const next = new Set(tools);
    if (next.size === this.withdrawnIds.size && [...next].every(id => this.withdrawnIds.has(id))) return false;
    this.withdrawnIds = next;
    this.emit([...new Set(this.views.map(view => view.tools))], false, "seed", false);
    return true;
  }
  /**
   * Whether the presentation withdrew a tool or a view setting (a research-only Rendering option, UI-163, which devices then apply at its
   * default; the graph's rules say which IDs name settings, `previewFields`).
   */
  withdrawn(id: string): boolean { return this.withdrawnIds.has(id); }
  /** A view's tools as devices apply them: its tools node's choices, with every withdrawn tool off. */
  activeTools(view: ViewId): Record<string, boolean> {
    const on = this.state<{ on: Record<string, boolean> }>(view, "tools").on;
    return Object.fromEntries(Object.entries(on).map(([id, value]) => [id, value && !this.withdrawnIds.has(id)]));
  }

  // ----- Node edits -----
  /**
   * Change the node a view's slot references: its state (merged over the current one, then validated by the slot's codec) and,
   * for slots with kinds, its kind. Every view sharing the node sees the change. Returns whether anything changed.
   */
  edit(view: ViewId, slot: ViewSlot, change: { kind?: string; state?: Readonly<Record<string, unknown>> }, options: ViewEditOptions = {}): boolean {
    const current = this.nodes.get(this.record(view)[slot])!;
    const kind = change.kind ?? current.kind;
    const next = nodeEntry(this.rules, slot, current.id, kind, { ...current.state, ...change.state });
    if (!next) throw new ViewGraphError("invalid_value", "That setting isn't valid for this view.");
    if (change.kind !== undefined && change.kind !== current.kind) {
      for (const sharer of this.views.filter(item => item[slot] === current.id)) {
        const issue = fitIssue(this.rules, sharer, new Map([...this.nodes, [current.id, next]]));
        if (issue) throw new ViewGraphError("incompatible_mode", issue);
      }
    }
    if (next.kind === current.kind && same(next.state, current.state)) return false;
    this.commit([next], undefined, options);
    return true;
  }

  /**
   * A camera jump (Front view, Whole body, a creator framing, a restored camera): the device has already moved the camera
   * (`applied`), so this records the step and leaves the position it jumped from on the camera's Back trail. A jump that left the
   * camera where it was records nothing and leaves no trail entry.
   */
  cameraJump(view: ViewId, before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>, label: string): void {
    const camera = this.nodes.get(this.record(view).camera)!;
    const from = nodeEntry(this.rules, "camera", camera.id, camera.kind, { ...camera.state, ...before });
    const to = nodeEntry(this.rules, "camera", camera.id, camera.kind, { ...camera.state, ...after });
    if (!from || !to) throw new ViewGraphError("invalid_value", "That camera position isn't valid.");
    // Where the camera really was (navigation records nothing, so the node may lag the device): the step undoes to it.
    this.nodes.set(camera.id, from);
    if (same(from.state, to.state)) { this.emit([camera.id], false, "edit", true); return; }
    const trail = this.trail(camera.id);
    trail.back.push(clone(from.state)); trail.forward = [];
    if (trail.back.length > CAMERA_TRAIL_LIMIT) trail.back.shift();
    this.commit([to], undefined, { label, applied: true });
  }
  /** Camera navigation the device did (orbit, zoom, pan, a lens change): kept as the node's state, never recorded (§3.6). */
  cameraMoved(view: ViewId, pose: Readonly<Record<string, unknown>>): void {
    this.edit(view, "camera", { state: pose }, { applied: true });
  }
  /** How far the view's camera can go Back and Forward along its trail. */
  cameraTrail(view: ViewId) {
    const trail = this.trails.get(this.record(view).camera);
    return { back: trail?.back.length ?? 0, forward: trail?.forward.length ?? 0 };
  }
  /**
   * Move the view's camera Back (or Forward) along its trail: to where it was before the last jump. `current` is where the device
   * shows the camera now, kept for the other direction. The change is published for the device to apply; nothing is recorded.
   */
  cameraStep(view: ViewId, direction: "back" | "forward", current: Readonly<Record<string, unknown>>): boolean {
    const camera = this.nodes.get(this.record(view).camera)!, trail = this.trails.get(camera.id);
    const target = direction === "back" ? trail?.back.pop() : trail?.forward.pop();
    if (!trail || !target) return false;
    (direction === "back" ? trail.forward : trail.back).push(clone({ ...camera.state, ...current }));
    const next = nodeEntry(this.rules, "camera", camera.id, camera.kind, target)!;
    this.nodes.set(camera.id, next);
    this.emit([camera.id], false, "history", false);
    return true;
  }
  private trail(id: string): Trail {
    let trail = this.trails.get(id);
    if (!trail) this.trails.set(id, trail = { back: [], forward: [] });
    return trail;
  }

  // ----- Structure edits -----
  /**
   * Add a view (design §3.4): it shares the slots `share` names with `from` and gets a copy of the others (a fork: identical at
   * first). New 3D view shares scene, lights and display; Duplicate view shares everything but tools. Tools always start fresh
   * when not shared. Returns the new view's ID.
   */
  addView(from: ViewId, share: Readonly<Partial<Record<ViewSlot, boolean>>>, options: ViewEditOptions & { title?: string; freshTools?: Record<string, unknown> } = {}): ViewId {
    if (this.views.length >= MAX_VIEWS) throw new ViewGraphError("invalid_value", `At most ${MAX_VIEWS} views can be open.`);
    const source = this.record(from), id = this.freshViewId();
    const created: NodeEntry[] = [], refs = {} as Record<ViewSlot, string>;
    for (const slot of VIEW_SLOTS) {
      if (share[slot]) { refs[slot] = source[slot]; continue; }
      const base = this.nodes.get(source[slot])!;
      const state = slot === "tools" ? clone(options.freshTools ?? { on: {} }) : clone(base.state);
      const node = nodeEntry(this.rules, slot, this.freshNodeId(slot), base.kind, state);
      if (!node) throw new ViewGraphError("invalid_value", "That view can't be copied.");
      created.push(node); refs[slot] = node.id;
    }
    const view: ViewRecord = { id, kind: "3d", ...(options.title ? { title: options.title } : {}), ...refs };
    this.commit(created, { views: [...this.views, view] }, { label: "New view", ...options });
    return id;
  }
  /** Close a view. Its unshared nodes go with it (collected); the main view cannot be closed. */
  closeView(view: ViewId, options: ViewEditOptions = {}): void {
    if (view === MAIN_VIEW) throw new ViewGraphError("invalid_value", "The main view can't be closed.");
    this.record(view);
    const views = this.views.filter(item => item.id !== view);
    this.commit([], { views }, { label: "Close view", ...options });
  }
  /** Point a view's slot at another view's node (design §3.4); its old node is collected if nothing else references it. */
  link(view: ViewId, slot: ViewSlot, to: ViewId, options: ViewEditOptions = {}): boolean {
    const target = this.record(to)[slot], current = this.record(view);
    if (current[slot] === target) return false;
    const relinked = { ...current, [slot]: target };
    const issue = fitIssue(this.rules, relinked, this.nodes);
    if (issue) throw new ViewGraphError("incompatible_mode", issue);
    this.commit([], { views: this.views.map(item => item.id === view ? relinked : item) },
      { label: `Link ${SLOT_NAMES[slot]}`, ...options });
    return true;
  }
  /** Give a view its own copy of a shared node (a fork: both start identical). Returns false when the node was not shared. */
  unlink(view: ViewId, slot: ViewSlot, options: ViewEditOptions = {}): boolean {
    const current = this.record(view), node = this.nodes.get(current[slot])!;
    if (this.viewsOf(node.id).length < 2) return false;
    const copy: NodeEntry = { ...clone(node), id: this.freshNodeId(slot) };
    this.commit([copy], { views: this.views.map(item => item.id === view ? { ...current, [slot]: copy.id } : item) },
      { label: `Unlink ${SLOT_NAMES[slot]}`, ...options });
    return true;
  }
  private takenView(id: string) { return this.has(id) || this.keptViews.some(kept => kept.record.id === id); }
  private freshViewId() { let id: string; do id = `v${++this.counter + 1}`; while (this.takenView(id)); return id; }
  private freshNodeId(slot: ViewSlot) {
    const prefix = slot === "scene" ? "s" : slot === "camera" ? "c" : slot === "lights" ? "l" : slot === "display" ? "d" : "t";
    let id: string; do id = `${prefix}${++this.counter + 1}`; while (this.nodes.has(id) || this.keptNodes.has(id)); return id;
  }

  // ----- History -----
  /** Run `apply` without recording View and lighting steps (restoring a workspace, replaying a saved state). */
  withoutHistory<T>(apply: () => T): T { return this.scope.withoutHistory(apply); }
  history(): ViewHistoryState {
    const state = this.scope.state();
    return { undo: state.undo?.label, redo: state.redo?.label, depth: state.depth, redoDepth: state.redoDepth };
  }
  /** End the current coalescing run: the next edit starts a new step even with the same key (a slider was released, CORE-95). */
  seal() { this.scope.seal(); }
  undo(): boolean { return this.scope.undo(); }
  redo(): boolean { return this.scope.redo(); }
  /** The View and lighting history's value of a node (by ID) or of the views (`structure`), detached. */
  private readHistory(key: string): unknown {
    if (key === STRUCTURE) return { views: clone(this.views) } satisfies Structure;
    const node = this.nodes.get(key);
    return node && clone(node);
  }
  /**
   * Show what an Undo or Redo reached. Before anything changes, the result is checked as a whole (CORE-94): the main view is
   * there, view IDs are unique, every view names existing nodes of the right slot and its camera and rig suit its scene. A step
   * that fails can never apply again, nor can the steps behind it, so the scope drops them and nothing changes.
   */
  private applyHistory(values: Readonly<Record<string, unknown>>): boolean {
    const structure = values[STRUCTURE] as Structure | undefined;
    const ids = Object.keys(values).filter(key => key !== STRUCTURE);
    const views = structure ? structure.views : this.views, nodes = new Map(this.nodes);
    for (const id of ids) { const value = values[id] as NodeEntry | undefined; if (value) nodes.set(id, value); else nodes.delete(id); }
    if (!this.consistent(views, nodes)) { this.emit([], false, "history", false); return false; }
    if (structure) this.views = clone(structure.views);
    for (const id of ids) { const value = values[id] as NodeEntry | undefined; if (value) this.nodes.set(id, clone(value)); else this.nodes.delete(id); }
    const touched = [...ids];
    this.collect(touched);
    // Published once the scope has settled (`publishHistory`), so subscribers read the history as it stands (Redo included).
    this.settling = { touched, structure: !!structure };
    return true;
  }
  /** Publish what the last Undo or Redo changed, now that the View and lighting history has settled. */
  private publishHistory() {
    const settled = this.settling;
    this.settling = undefined;
    if (settled) this.emit(settled.touched, settled.structure, "history", false);
  }
  private settling?: { touched: string[]; structure: boolean };
  /** Whether views over nodes form a graph this service can hold (the replay check, CORE-94). */
  private consistent(views: readonly ViewRecord[], nodes: ReadonlyMap<string, NodeEntry>): boolean {
    const ids = new Set(views.map(view => view.id));
    if (ids.size !== views.length || !ids.has(MAIN_VIEW) || [...ids].some(id => this.keptViews.some(kept => kept.record.id === id))) return false;
    return views.every(view => VIEW_SLOTS.every(slot => nodes.get(view[slot])?.slot === slot) && !fitIssue(this.rules, view, nodes));
  }

  /** Apply nodes and structure as one commit: validate, collect orphans, record the step, publish the change. */
  private commit(nodes: readonly NodeEntry[], structure: Structure | undefined, options: ViewEditOptions) {
    const before = new Map<string, NodeEntry | undefined>();
    for (const node of nodes) before.set(node.id, this.nodes.has(node.id) ? clone(this.nodes.get(node.id)!) : undefined);
    const priorStructure = structure ? { views: clone(this.views) } : undefined;
    for (const node of nodes) this.nodes.set(node.id, clone(node));
    if (structure) this.views = clone(structure.views);
    // Nodes no view references any more go in the same commit (design §3.3): no dangling nodes, no manual clean-up.
    for (const [id, node] of this.nodes) if (!this.referenced(id)) { if (!before.has(id)) before.set(id, clone(node)); this.nodes.delete(id); this.trails.delete(id); }
    const touched = [...before.keys()];
    // The step holds what the commit touched as it was before (the graph already shows the change); a node edit with the same
    // coalescing key as the unsealed top step joins it (CORE-95), a structure edit never does.
    if (options.label && !options.seed && this.scope.recording)
      this.scope.checkpoint(priorStructure ? [...touched, STRUCTURE] : touched, { label: options.label, actionKind: "view.edit" },
        { read: key => key === STRUCTURE ? priorStructure : before.get(key), timed: false, ...(structure ? {} : { coalesce: options.coalesce }) });
    // A structure change the history doesn't hold would leave its steps naming views and nodes that no longer exist (CORE-94).
    else if (structure && !same(priorStructure!.views, this.views)) this.scope.clear();
    this.emit(touched, !!structure, options.seed ? "seed" : "edit", !!options.applied, structure ? this.changedViews(priorStructure!.views) : []);
  }
  private collect(touched: string[]) {
    for (const [id] of this.nodes) if (!this.referenced(id)) { this.nodes.delete(id); this.trails.delete(id); if (!touched.includes(id)) touched.push(id); }
  }
  private changedViews(previous: readonly ViewRecord[]): ViewId[] {
    const ids = new Set([...previous, ...this.views].map(view => view.id));
    return [...ids].filter(id => !same(previous.find(view => view.id === id), this.views.find(view => view.id === id)));
  }
  private emit(nodes: readonly string[], structure: boolean, origin: ViewGraphChange["origin"], applied: boolean, extra: readonly ViewId[] = []) {
    const views = [...new Set([...nodes.flatMap(id => this.viewsOf(id)), ...extra])];
    const change: ViewGraphChange = Object.freeze({ nodes: [...nodes], views, structure, origin, applied });
    for (const listener of [...this.listeners]) listener(change);
  }
}
