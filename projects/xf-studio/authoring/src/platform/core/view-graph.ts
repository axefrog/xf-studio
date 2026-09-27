/**
 * The view graph service (research/authoring/view-graph-design.md §3.3): the one owner of every view's camera, light, display,
 * scene and tool state. DOM-free. It validates every edit against the composition's rules, keeps each node alive exactly while
 * a view references it (an edit that leaves a node unreferenced removes it in the same commit), publishes detached reads and
 * tells subscribers what each commit changed, so the devices that draw a node follow it and nothing else redraws.
 *
 * Its edits flow through the View and lighting history (§3.6, revised 27 September): a session-only Undo history separate from
 * look history, where continuous edits coalesce into one step. Camera navigation records nothing; a camera jump records a step
 * and leaves a Back/Forward trail on its camera node, so a shared camera shares its trail.
 */
import { MAIN_VIEW, SLOT_COLLECTIONS, VIEW_GRAPH_1, VIEW_SLOTS, validViewId, viewPanelId, type GraphNode, type SceneKind, type StoredNode,
  type ViewGraphChange, type ViewGraphData, type ViewGraphRules, type ViewGraphSnapshot, type ViewHistoryState, type ViewId,
  type ViewRecord, type ViewSlot } from "../api/view-graph";

/** At most this many views (design §3.7: four visible, the rest as tabs) and nodes of one slot. */
export const MAX_VIEWS = 16;
/** Steps kept in the View and lighting history, and camera positions in each Back/Forward trail. */
export const VIEW_HISTORY_LIMIT = 50;
export const CAMERA_TRAIL_LIMIT = 20;
/** Edits with the same coalescing key this close together form one step (a slider drag). */
export const COALESCE_MS = 1000;

export type ViewEditOptions = {
  /** The step's name in the View and lighting history ("Light change"); without it the edit records nothing. */
  label?: string;
  /** Edits with the same key in a row, each within `COALESCE_MS` of the last, form one step. */
  coalesce?: string;
  /** The device already shows the result (it computed it): subscribers must not apply it again. */
  applied?: boolean;
  /** Restore-time state (a fallback the loaded head needs): records nothing and marks no edit. */
  seed?: boolean;
};

type NodeEntry = { id: string; slot: ViewSlot; kind?: string; state: Record<string, unknown> };
type Step = {
  label: string; coalesce?: string; at: number;
  /** Each node the step touched, as it was before and after (undefined: it did not exist). */
  nodes: Map<string, { before?: NodeEntry; after?: NodeEntry }>;
  /** The views and focus before and after, when the step changed them. */
  structure?: { before: { views: ViewRecord[]; focused: ViewId }; after: { views: ViewRecord[]; focused: ViewId } };
};
type Trail = { back: Record<string, unknown>[]; forward: Record<string, unknown>[] };
const clone = <T>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const validNodeId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);

export class ViewGraphError extends Error {
  constructor(readonly code: "missing_target" | "invalid_value" | "incompatible_mode", message: string) { super(message); }
}

/**
 * Parse stored graph data against the rules: every view references existing nodes of the right slot, IDs are unique and valid,
 * each node's state passes its codec, every scene kind is registered and each view's camera and rig suit its scene. Unreferenced
 * nodes are dropped. Returns undefined for anything else, so a damaged graph falls back to the default one.
 */
export function parseViewGraph(value: unknown, rules: ViewGraphRules): ViewGraphData | undefined {
  const input = record(value);
  if (!input || input.schema !== VIEW_GRAPH_1 || !Array.isArray(input.views) || !input.views.length || input.views.length > MAX_VIEWS) return;
  const nodes = new Map<string, NodeEntry>();
  for (const slot of VIEW_SLOTS) {
    const list = input[SLOT_COLLECTIONS[slot]];
    if (!Array.isArray(list) || list.length > MAX_VIEWS) return;
    for (const item of list) {
      const stored = record(item);
      if (!stored || !validNodeId(stored.id) || nodes.has(stored.id)) return;
      const { id, kind, ...state } = stored;
      const entry = nodeEntry(rules, slot, id, kind, state);
      if (!entry) return;
      nodes.set(id, entry);
    }
  }
  const views: ViewRecord[] = [], ids = new Set<string>();
  for (const item of input.views) {
    const view = record(item);
    if (!view || !validViewId(view.id) || ids.has(view.id) || view.kind !== "3d") return;
    if (view.title !== undefined && (typeof view.title !== "string" || view.title.length > 60)) return;
    const refs = {} as Record<ViewSlot, string>;
    for (const slot of VIEW_SLOTS) {
      const ref = view[slot];
      if (typeof ref !== "string" || nodes.get(ref)?.slot !== slot) return;
      refs[slot] = ref;
    }
    ids.add(view.id);
    views.push({ id: view.id, kind: "3d", ...(view.title !== undefined ? { title: view.title as string } : {}), ...refs });
  }
  if (!ids.has(MAIN_VIEW) || typeof input.focused !== "string" || !ids.has(input.focused)) return;
  for (const view of views) if (fitIssue(rules, view, nodes)) return;
  return writeData(views, nodes, input.focused);
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
function writeData(views: readonly ViewRecord[], nodes: ReadonlyMap<string, NodeEntry>, focused: ViewId): ViewGraphData {
  const used = new Set(views.flatMap(view => VIEW_SLOTS.map(slot => view[slot])));
  const list = (slot: ViewSlot): StoredNode[] => [...nodes.values()].filter(node => node.slot === slot && used.has(node.id))
    .map(node => ({ id: node.id, ...(node.kind === undefined ? {} : { kind: node.kind }), ...clone(node.state) }));
  return { schema: VIEW_GRAPH_1, views: clone([...views]), scenes: list("scene"), cameras: list("camera"), lights: list("lights"),
    display: list("display"), tools: list("tools"), focused };
}

/** The graph service. One per workspace; devices and services act on the views it lists. */
export class ViewGraph {
  private views: ViewRecord[];
  private nodes = new Map<string, NodeEntry>();
  private focus: ViewId;
  private listeners = new Set<(change: ViewGraphChange) => void>();
  private undoSteps: Step[] = [];
  private redoSteps: Step[] = [];
  private trails = new Map<string, Trail>();
  private recording = true;
  private counter = 0;

  constructor(data: ViewGraphData, private rules: ViewGraphRules, private options: { now?: () => number } = {}) {
    const parsed = parseViewGraph(data, rules);
    if (!parsed) throw new ViewGraphError("invalid_value", "The view graph is not valid.");
    this.views = clone([...parsed.views]);
    for (const slot of VIEW_SLOTS) for (const { id, kind, ...state } of parsed[SLOT_COLLECTIONS[slot]])
      this.nodes.set(id, { id, slot, ...(kind === undefined ? {} : { kind }), state });
    this.focus = parsed.focused;
  }
  private now() { return this.options.now?.() ?? Date.now(); }

  // ----- Reads -----
  /** The stored form (`xfs/view-graph-1`), detached. */
  data(): ViewGraphData { return writeData(this.views, this.nodes, this.focus); }
  snapshot(): ViewGraphSnapshot {
    return { focused: this.focus, views: this.views.map(view => ({ ...clone(view),
      shared: VIEW_SLOTS.filter(slot => this.views.some(other => other !== view && other[slot] === view[slot])),
      sceneKind: this.nodes.get(view.scene)!.kind as SceneKind, panel: viewPanelId(view.id) })) };
  }
  viewIds(): ViewId[] { return this.views.map(view => view.id); }
  has(view: ViewId) { return this.views.some(item => item.id === view); }
  /** The focused view: the one a view-scoped command acts on when it names none (design §3.8). */
  focused(): ViewId { return this.focus; }
  /** The view a command means: the one it names, else the focused one. Throws for a view that does not exist. */
  target(view?: ViewId): ViewId {
    const id = view ?? this.focus;
    if (!this.has(id)) throw new ViewGraphError("missing_target", "That view no longer exists.");
    return id;
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

  subscribe(listener: (change: ViewGraphChange) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

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
   * (`applied`), so this records the step and leaves the position it jumped from on the camera's Back trail.
   */
  cameraJump(view: ViewId, before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>, label: string): void {
    const camera = this.nodes.get(this.record(view).camera)!;
    const from = nodeEntry(this.rules, "camera", camera.id, camera.kind, { ...camera.state, ...before });
    const to = nodeEntry(this.rules, "camera", camera.id, camera.kind, { ...camera.state, ...after });
    if (!from || !to) throw new ViewGraphError("invalid_value", "That camera position isn't valid.");
    // Where the camera really was (navigation records nothing, so the node may lag the device): the step undoes to it.
    this.nodes.set(camera.id, from);
    const trail = this.trail(camera.id);
    trail.back.push(clone(from.state)); trail.forward = [];
    if (trail.back.length > CAMERA_TRAIL_LIMIT) trail.back.shift();
    if (same(from.state, to.state)) { this.emit([camera.id], false, "edit", true); return; }
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
    this.commit(created, { views: [...this.views, view], focused: this.focus }, options);
    return id;
  }
  /** Close a view. Its unshared nodes go with it (collected); the main view cannot be closed. */
  closeView(view: ViewId, options: ViewEditOptions = {}): void {
    if (view === MAIN_VIEW) throw new ViewGraphError("invalid_value", "The main view can't be closed.");
    this.record(view);
    const views = this.views.filter(item => item.id !== view);
    this.commit([], { views, focused: this.focus === view ? MAIN_VIEW : this.focus }, options);
  }
  /** Point a view's slot at another view's node (design §3.4); its old node is collected if nothing else references it. */
  link(view: ViewId, slot: ViewSlot, to: ViewId, options: ViewEditOptions = {}): boolean {
    const target = this.record(to)[slot], current = this.record(view);
    if (current[slot] === target) return false;
    const relinked = { ...current, [slot]: target };
    const issue = fitIssue(this.rules, relinked, this.nodes);
    if (issue) throw new ViewGraphError("incompatible_mode", issue);
    this.commit([], { views: this.views.map(item => item.id === view ? relinked : item), focused: this.focus }, options);
    return true;
  }
  /** Give a view its own copy of a shared node (a fork: both start identical). Returns false when the node was not shared. */
  unlink(view: ViewId, slot: ViewSlot, options: ViewEditOptions = {}): boolean {
    const current = this.record(view), node = this.nodes.get(current[slot])!;
    if (this.viewsOf(node.id).length < 2) return false;
    const copy: NodeEntry = { ...clone(node), id: this.freshNodeId(slot) };
    this.commit([copy], { views: this.views.map(item => item.id === view ? { ...current, [slot]: copy.id } : item), focused: this.focus }, options);
    return true;
  }
  /** Move the focus (the last view pressed or focused); records nothing. */
  focusView(view: ViewId): void {
    this.record(view);
    if (this.focus === view) return;
    this.focus = view;
    this.emit([], true, "edit", false, [view]);
  }
  private freshViewId() { let id: string; do id = `v${++this.counter + 1}`; while (this.has(id)); return id; }
  private freshNodeId(slot: ViewSlot) {
    const prefix = slot === "scene" ? "s" : slot === "camera" ? "c" : slot === "lights" ? "l" : slot === "display" ? "d" : "t";
    let id: string; do id = `${prefix}${++this.counter + 1}`; while (this.nodes.has(id)); return id;
  }

  // ----- History -----
  /** Run `apply` without recording View and lighting steps (restoring a workspace, replaying a saved state). */
  withoutHistory<T>(apply: () => T): T {
    const was = this.recording; this.recording = false;
    try { return apply(); } finally { this.recording = was; }
  }
  history(): ViewHistoryState {
    return { undo: this.undoSteps.at(-1)?.label, redo: this.redoSteps.at(-1)?.label, depth: this.undoSteps.length, redoDepth: this.redoSteps.length };
  }
  /** End the current coalescing run: the next edit starts a new step even with the same key (a slider was released). */
  seal() { const top = this.undoSteps.at(-1); if (top) delete top.coalesce; }
  undo(): boolean { return this.replay(this.undoSteps, this.redoSteps, "before"); }
  redo(): boolean { return this.replay(this.redoSteps, this.undoSteps, "after"); }
  private replay(from: Step[], to: Step[], side: "before" | "after"): boolean {
    const step = from.pop();
    if (!step) return false;
    const structure = step.structure?.[side];
    if (structure) { this.views = clone(structure.views); this.focus = this.has(structure.focused) ? structure.focused : MAIN_VIEW; }
    const touched: string[] = [];
    for (const [id, entry] of step.nodes) {
      const value = entry[side];
      if (value) this.nodes.set(id, clone(value)); else this.nodes.delete(id);
      touched.push(id);
    }
    delete step.coalesce;
    to.push(step);
    this.collect(touched);
    this.emit(touched, !!structure, "history", false);
    return true;
  }

  /** Apply nodes and structure as one commit: validate, collect orphans, record the step, publish the change. */
  private commit(nodes: readonly NodeEntry[], structure: { views: ViewRecord[]; focused: ViewId } | undefined, options: ViewEditOptions) {
    const before = new Map<string, NodeEntry | undefined>();
    for (const node of nodes) before.set(node.id, this.nodes.has(node.id) ? clone(this.nodes.get(node.id)!) : undefined);
    const priorStructure = structure ? { views: clone(this.views), focused: this.focus } : undefined;
    for (const node of nodes) this.nodes.set(node.id, clone(node));
    if (structure) { this.views = clone(structure.views); this.focus = structure.focused; }
    // Nodes no view references any more go in the same commit (design §3.3): no dangling nodes, no manual clean-up.
    for (const [id, node] of this.nodes) if (!this.viewsOf(id).length) { if (!before.has(id)) before.set(id, clone(node)); this.nodes.delete(id); this.trails.delete(id); }
    const touched = [...before.keys()];
    if (options.label && this.recording && !options.seed) this.pushStep({ label: options.label, coalesce: options.coalesce, at: this.now(),
      nodes: new Map(touched.map(id => [id, { before: before.get(id), after: this.nodes.has(id) ? clone(this.nodes.get(id)!) : undefined }])),
      ...(priorStructure ? { structure: { before: priorStructure, after: { views: clone(this.views), focused: this.focus } } } : {}) });
    this.emit(touched, !!structure, options.seed ? "seed" : "edit", !!options.applied, structure ? this.changedViews(priorStructure!.views) : []);
  }
  private pushStep(step: Step) {
    const top = this.undoSteps.at(-1);
    if (top && step.coalesce && top.coalesce === step.coalesce && !step.structure && !top.structure && !this.redoSteps.length &&
      step.at - top.at <= COALESCE_MS) {
      for (const [id, entry] of step.nodes) {
        const kept = top.nodes.get(id);
        top.nodes.set(id, { before: kept ? kept.before : entry.before, after: entry.after });
      }
      top.at = step.at; top.label = step.label;
      return;
    }
    this.undoSteps.push(step);
    if (this.undoSteps.length > VIEW_HISTORY_LIMIT) this.undoSteps.shift();
    this.redoSteps = [];
  }
  private collect(touched: string[]) {
    for (const [id] of this.nodes) if (!this.viewsOf(id).length) { this.nodes.delete(id); this.trails.delete(id); if (!touched.includes(id)) touched.push(id); }
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
