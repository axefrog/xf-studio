/**
 * Pure dock layout model. No DOM, no Studio state: a layout is a tree of split
 * nodes and tab groups anchored to the workspace, plus floating windows whose
 * own trees form magnetic composites. Every operation returns a new layout.
 */
export type PanelId = string;
export type Side = "left" | "right" | "top" | "bottom";
/** A tab group. `collapsed`: only its tab bar shows and its neighbours take the space (saved with the layout). */
export type GroupNode = { kind: "group"; id: string; panels: PanelId[]; active: PanelId; collapsed?: boolean };
export type SplitNode = { kind: "split"; id: string; axis: "row" | "column"; children: DockNode[]; sizes: number[] };
export type DockNode = GroupNode | SplitNode;
export type FloatingWindow = { id: string; x: number; y: number; w: number; h: number; node: DockNode };
/**
 * Where a withdrawn panel was (view-graph-design.md §4.3): a hidden module's panels leave the dock and come back to the same place.
 * `group` is its tab group's panels in order (it returns into the group once a member is back), `index` its tab position and
 * `active` whether it was the shown tab; `anchor` a surviving neighbour to come back beside (side and share) when its whole group
 * left; `window` the floating window it filled alone; `closed` that it was closed.
 */
export type ParkedPlace = { group: PanelId[]; index: number; active: boolean; collapsed?: boolean; window?: Rect;
  groupId?: string; windowId?: string; windowIndex?: number; docked?: true;
  anchor?: { panel: PanelId; side: Side; share: number; splitId?: string; shares?: Record<string, number> } } | { closed: true };
export type DockTree = {
  root: DockNode | null;
  /** Painted in array order; the last window is frontmost. */
  floating: FloatingWindow[];
  closed: PanelId[];
  maximized?: string;
  /** Panels withdrawn with a hidden module, and where each was: per size class, like the rest of the tree. */
  parked?: Record<PanelId, ParkedPlace>;
  /**
   * Where each closed panel was when it was closed (its group, tab position, neighbour or floating window), so summoning it again puts
   * it back there (`summonPanel`). Only closed panels have one; opening a panel by any route forgets it.
   */
  lastPlace?: Record<PanelId, Exclude<ParkedPlace, { closed: true }>>;
};
export type SizeClass = "wide" | "compact";
export type DockState = { wide: DockTree; compact: DockTree };
export const DOCK_FORMAT = "xfs/dock";
export const DOCK_VERSION = 1;
export const MIN_GROUP = { w: 150, h: 96 };

export type DropTarget =
  | { kind: "tab"; groupId: string; index: number }
  | { kind: "split"; groupId: string; side: Side }
  | { kind: "edge"; side: Side }
  | { kind: "float"; x: number; y: number; w?: number; h?: number };
export type DragSource =
  | { kind: "panel"; panelId: PanelId }
  | { kind: "group"; groupId: string }
  | { kind: "window"; windowId: string };
export type Rect = { x: number; y: number; w: number; h: number };

let counter = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
export const group = (panels: PanelId[], active = panels[0], id = newId("g")): GroupNode =>
  ({ kind: "group", id, panels: [...panels], active });
export const split = (axis: SplitNode["axis"], children: DockNode[], sizes?: number[], id = newId("s")): SplitNode =>
  ({ kind: "split", id, axis, children, sizes: normalizeSizes(sizes ?? children.map(() => 1), children.length) });

export function normalizeSizes(sizes: number[], length: number): number[] {
  const values = Array.from({ length }, (_, i) => Number.isFinite(sizes[i]) && sizes[i] > 0 ? sizes[i] : 1);
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map(value => value / total);
}

const clone = <T>(value: T): T => structuredClone(value);

export function* groups(node: DockNode | null): Generator<GroupNode> {
  if (!node) return;
  if (node.kind === "group") yield node;
  else for (const child of node.children) yield* groups(child);
}
export function allGroups(tree: DockTree): { group: GroupNode; windowId?: string }[] {
  return [...[...groups(tree.root)].map(item => ({ group: item })),
    ...tree.floating.flatMap(floatingWindow => [...groups(floatingWindow.node)].map(item => ({ group: item, windowId: floatingWindow.id })))];
}
export function panelsIn(tree: DockTree): PanelId[] {
  return [...allGroups(tree).flatMap(entry => entry.group.panels), ...tree.closed];
}
export function locate(tree: DockTree, panel: PanelId) {
  for (const entry of allGroups(tree)) {
    const index = entry.group.panels.indexOf(panel);
    if (index >= 0) return { ...entry, index };
  }
  return undefined;
}
export function findGroup(tree: DockTree, id: string) {
  return allGroups(tree).find(entry => entry.group.id === id);
}

/** Remove a node by id from a subtree, collapsing splits that keep one child. */
function removeNode(node: DockNode | null, id: string): DockNode | null {
  if (!node) return null;
  if (node.id === id) return null;
  if (node.kind === "group") return node;
  const children: DockNode[] = [], sizes: number[] = [];
  node.children.forEach((child, i) => {
    const next = removeNode(child, id);
    if (next) { children.push(next); sizes.push(node.sizes[i]); }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: normalizeSizes(sizes, children.length) };
}
/** Replace one node (by id) with another inside a subtree. */
function replaceNode(node: DockNode, id: string, next: DockNode): DockNode {
  if (node.id === id) return next;
  if (node.kind === "group") return node;
  return { ...node, children: node.children.map(child => replaceNode(child, id, next)) };
}
function mapGroups(tree: DockTree, map: (group: GroupNode) => GroupNode | null): DockTree {
  const visit = (node: DockNode | null): DockNode | null => {
    if (!node) return null;
    if (node.kind === "group") return map(node);
    const children: DockNode[] = [], sizes: number[] = [];
    node.children.forEach((child, i) => { const next = visit(child); if (next) { children.push(next); sizes.push(node.sizes[i]); } });
    if (!children.length) return null;
    if (children.length === 1) return children[0];
    return { ...node, children, sizes: normalizeSizes(sizes, children.length) };
  };
  const floating = tree.floating.map(floatingWindow => ({ ...floatingWindow, node: visit(floatingWindow.node) }))
    .filter((floatingWindow): floatingWindow is FloatingWindow => !!floatingWindow.node);
  return { ...tree, root: visit(tree.root), floating };
}
function containsNode(node: DockNode | null, id: string): boolean {
  if (!node) return false;
  if (node.id === id) return true;
  return node.kind === "split" && node.children.some(child => containsNode(child, id));
}

/**
 * When a member leaves a floating composite, the window gives back that member's share
 * along the composite's axis instead of stretching the remaining panels.
 */
function shrinkWindows(before: DockTree, after: DockTree): DockTree {
  after.floating = after.floating.map(floatingWindow => {
    const old = before.floating.find(item => item.id === floatingWindow.id);
    if (!old || old.node.kind !== "split") return floatingWindow;
    // An old top-level member counts as removed only when none of its groups survive
    // (a nested split that collapses into its survivor keeps the window size).
    const surviving = new Set([...groups(floatingWindow.node)].map(item => item.id));
    const removed = old.node.children.reduce((sum, child, i) =>
      sum + ([...groups(child)].some(item => surviving.has(item.id)) ? 0 : old.node.kind === "split" ? old.node.sizes[i] : 0), 0);
    if (removed <= 0 || removed >= 1) return floatingWindow;
    return old.node.axis === "row"
      ? { ...floatingWindow, w: Math.max(MIN_WINDOW.w, Math.round(floatingWindow.w * (1 - removed))) }
      : { ...floatingWindow, h: Math.max(MIN_WINDOW.h, Math.round(floatingWindow.h * (1 - removed))) };
  });
  return after;
}

/** Detach a panel from wherever it is. Empty groups/windows disappear; closed entries are removed. */
export function detachPanel(tree: DockTree, panel: PanelId): DockTree {
  return shrinkWindows(tree, detachPanelOnly(tree, panel));
}
function detachPanelOnly(tree: DockTree, panel: PanelId): DockTree {
  const next = mapGroups(clone(tree), item => {
    if (!item.panels.includes(panel)) return item;
    const panels = item.panels.filter(id => id !== panel);
    if (!panels.length) return null;
    const index = item.panels.indexOf(panel);
    return { ...item, panels, active: item.active === panel ? panels[Math.min(index, panels.length - 1)] : item.active };
  });
  next.closed = next.closed.filter(id => id !== panel);
  forget(next, panel);
  if (next.maximized && !findGroup(next, next.maximized)) delete next.maximized;
  return next;
}
/** Drop a panel's remembered closed place (it is open again, or placed by a drop). Mutates `tree`, a fresh clone. */
function forget(tree: DockTree, panel: PanelId) {
  if (!tree.lastPlace?.[panel]) return;
  const { [panel]: _gone, ...rest } = tree.lastPlace;
  if (Object.keys(rest).length) tree.lastPlace = rest; else delete tree.lastPlace;
}
function detachNode(tree: DockTree, id: string): { tree: DockTree; node?: DockNode } {
  const next = clone(tree);
  const find = (node: DockNode | null): DockNode | undefined => {
    if (!node) return;
    if (node.id === id) return node;
    if (node.kind === "split") for (const child of node.children) { const hit = find(child); if (hit) return hit; }
  };
  let node = find(next.root);
  if (node) next.root = removeNode(next.root, id);
  else for (const floatingWindow of next.floating) {
    node = find(floatingWindow.node);
    if (node) { floatingWindow.node = removeNode(floatingWindow.node, id) as DockNode; break; }
  }
  next.floating = next.floating.filter(floatingWindow => floatingWindow.node);
  if (next.maximized && !findGroup(next, next.maximized)) delete next.maximized;
  return { tree: shrinkWindows(tree, next), node: node && clone(node) };
}

function flattenPanels(node: DockNode): PanelId[] { return [...groups(node)].flatMap(item => item.panels); }
function activeOf(node: DockNode): PanelId | undefined {
  const first = [...groups(node)][0];
  return first?.active;
}

/** The other share of a two-way split, without binary noise (1 - .42 is .58, not .5800000000000001), so a restored layout is exact. */
const rest = (share: number) => Number((1 - share).toPrecision(12));
/** Insert an arbitrary node at a drop target. Tab targets merge its panels. */
/**
 * `whole`: `share` is the node's share of the split it joins (a parked group coming back, UI-104), so every sibling gives up its part;
 * otherwise it is a share of the target group, which alone gives it up.
 */
function insertNode(tree: DockTree, node: DockNode, target: DropTarget, defaultRect?: Rect, share = .5, whole = false, splitId?: string): DockTree {
  const next = clone(tree);
  if (target.kind === "tab") {
    const found = findGroup(next, target.groupId);
    if (!found) return insertNode(next, node, { kind: "float", x: 80, y: 80 }, defaultRect);
    const panels = flattenPanels(node).filter(id => !found.group.panels.includes(id));
    const index = Math.max(0, Math.min(target.index, found.group.panels.length));
    const merged = [...found.group.panels.slice(0, index), ...panels, ...found.group.panels.slice(index)];
    return mapGroups(next, item => item.id === target.groupId
      ? { ...item, panels: merged, active: activeOf(node) ?? panels[0] ?? item.active } : item);
  }
  if (target.kind === "split") {
    const found = findGroup(next, target.groupId);
    if (!found) return insertNode(next, node, { kind: "float", x: 80, y: 80 }, defaultRect);
    const axis = target.side === "left" || target.side === "right" ? "row" : "column";
    const before = target.side === "left" || target.side === "top";
    const place = (subtree: DockNode, share: number, grow = false): DockNode => {
      // Prefer inserting as a sibling when the parent already splits on this axis.
      let inserted = false;
      const visit = (item: DockNode): DockNode => {
        if (item.kind === "group" || inserted) return item;
        const index = item.children.findIndex(child => child.id === target.groupId);
        if (index >= 0 && item.axis === axis) {
          inserted = true;
          let sizes = [...item.sizes];
          const children = [...item.children];
          let incoming: number;
          // A growing composite root keeps every member's pixels: siblings scale by (1 - share).
          if ((grow && item === subtree) || whole) { sizes = sizes.map(size => size * (1 - share)); incoming = share; }
          else { incoming = sizes[index] * share; sizes[index] -= incoming; }
          children.splice(before ? index : index + 1, 0, node);
          sizes.splice(before ? index : index + 1, 0, incoming);
          return { ...item, children, sizes: normalizeSizes(sizes, children.length) };
        }
        return { ...item, children: item.children.map(visit) };
      };
      const visited = visit(subtree);
      if (inserted) return visited;
      const targetNode = [...groups(subtree)].find(item => item.id === target.groupId)!;
      return replaceNode(subtree, target.groupId, split(axis, before ? [node, targetNode] : [targetNode, node],
        before ? [share, rest(share)] : [rest(share), share], splitId));
    };
    if (found.windowId) {
      // A magnetic composite grows by the incoming panel instead of squeezing its current content.
      next.floating = next.floating.map(floatingWindow => {
        if (floatingWindow.id !== found.windowId) return floatingWindow;
        // Matches previewRect(): an attached panel adds at most 360 px across or 300 px down.
        const current = axis === "row" ? floatingWindow.w : floatingWindow.h;
        const restoring = whole && splitId !== undefined;
        const extra = restoring ? current * share / (1 - share)
          : axis === "row" ? Math.min(defaultRect?.w ?? 320, 360) : Math.min(defaultRect?.h ?? 260, 300);
        const node = place(floatingWindow.node, restoring ? share : extra / (current + extra), true);
        return axis === "row"
          ? { ...floatingWindow, node, w: floatingWindow.w + extra, x: before ? floatingWindow.x - extra : floatingWindow.x }
          : { ...floatingWindow, node, h: floatingWindow.h + extra, y: before ? floatingWindow.y - extra : floatingWindow.y };
      });
    } else next.root = place(next.root!, share);
    return next;
  }
  if (target.kind === "edge") {
    const axis = target.side === "left" || target.side === "right" ? "row" : "column";
    const before = target.side === "left" || target.side === "top";
    if (!next.root) { next.root = node; return next; }
    const share = axis === "row" ? .24 : .3;
    if (next.root.kind === "split" && next.root.axis === axis) {
      const children = before ? [node, ...next.root.children] : [...next.root.children, node];
      const rest = next.root.sizes.map(size => size * (1 - share));
      next.root = { ...next.root, children, sizes: normalizeSizes(before ? [share, ...rest] : [...rest, share], children.length) };
    } else {
      next.root = split(axis, before ? [node, next.root] : [next.root, node], before ? [share, 1 - share] : [1 - share, share]);
    }
    return next;
  }
  const rect = { x: target.x, y: target.y, w: target.w ?? defaultRect?.w ?? 340, h: target.h ?? defaultRect?.h ?? 420 };
  next.floating = [...next.floating, { id: newId("w"), ...rect, node }];
  return next;
}

/** Move a panel, group or whole floating window to a drop target. No-ops return the same tree. */
export function applyDrop(tree: DockTree, source: DragSource, target: DropTarget, sourceRect?: Rect): DockTree {
  if (source.kind === "panel") {
    const at = locate(tree, source.panelId);
    if (at && at.group.panels.length === 1 && target.kind !== "float" && target.kind !== "edge" &&
      target.groupId === at.group.id) return tree;
    if (at && target.kind === "tab" && target.groupId === at.group.id) {
      // Reorder within the same strip.
      const panels = at.group.panels.filter(id => id !== source.panelId);
      const index = Math.max(0, Math.min(target.index > at.index ? target.index - 1 : target.index, panels.length));
      panels.splice(index, 0, source.panelId);
      return mapGroups(clone(tree), item => item.id === at.group.id ? { ...item, panels, active: source.panelId } : item);
    }
    const detached = detachPanel(tree, source.panelId);
    return insertNode(detached, group([source.panelId]), target, sourceRect);
  }
  if (source.kind === "group") {
    if (target.kind !== "float" && target.kind !== "edge" && target.groupId === source.groupId) return tree;
    const { tree: detached, node } = detachNode(tree, source.groupId);
    if (!node) return tree;
    return insertNode(detached, node, target, sourceRect);
  }
  const floatingWindow = tree.floating.find(item => item.id === source.windowId);
  if (!floatingWindow) return tree;
  if (target.kind === "float") {
    return { ...clone(tree), floating: tree.floating.map(item => item.id === floatingWindow.id
      ? { ...clone(item), x: target.x, y: target.y } : clone(item)) };
  }
  if (target.kind !== "edge" && containsNode(floatingWindow.node, target.groupId)) return tree;
  const rest = { ...clone(tree), floating: tree.floating.filter(item => item.id !== floatingWindow.id).map(clone) };
  return insertNode(rest, clone(floatingWindow.node), target, sourceRect);
}

export function activate(tree: DockTree, panel: PanelId): DockTree {
  return mapGroups(clone(tree), item => item.panels.includes(panel) ? { ...item, active: panel } : item);
}
/** Close a panel, remembering where it was (`lastPlace`) so summoning it again puts it back there. */
export function closePanel(tree: DockTree, panel: PanelId): DockTree {
  return closePanels(tree, [panel]);
}
/** Close a set atomically: every remembered place sees the same departing set and surviving anchors. */
export function closePanels(tree: DockTree, panels: readonly PanelId[]): DockTree {
  const leaving = new Set(panels.filter(panel => locate(tree, panel)));
  if (!leaving.size) return tree;
  const places = [...leaving].map(panel => [panel, placeOf(tree, panel, leaving)] as const);
  let next = tree;
  for (const panel of leaving) { next = detachPanel(next, panel); next.closed = [...next.closed, panel]; }
  for (const [panel, place] of places) if (place && !("closed" in place)) next.lastPlace = { ...next.lastPlace, [panel]: place };
  return next;
}
/**
 * Summon a panel (the palette, a menu, Help, a reveal or a tour), so that it is shown wherever it ends up:
 *
 * - **in an expanded group:** its tab becomes the active one;
 * - **in a collapsed group:** the group expands with its tab active (never left folded where nobody can see it);
 * - **not in the layout:** it goes back to an obvious home: where it was when it was closed (its group, beside its neighbour, or
 *   its floating window), or the group it belongs to in the factory layout (`fallback`) when one of that group's panels is open.
 *   Without an obvious home it opens in a floating window (`floatRect`), never dropped into an arbitrary group.
 *
 * A maximized group is restored when the panel lands docked elsewhere. `floatRect` is where a homeless panel floats.
 */
export function summonPanel(tree: DockTree, panel: PanelId, fallback: DockTree, floatRect: Rect): DockTree {
  if (!locate(tree, panel)) {
    const remembered = tree.lastPlace?.[panel];
    const base = detachPanel(tree, panel);
    const home = locate(fallback, panel);
    const sibling = home?.group.panels.filter(id => id !== panel).map(id => locate(base, id)).find(Boolean);
    tree = (remembered && restorePlace(base, panel, remembered))
      ?? (sibling ? insertNode(base, group([panel]), { kind: "tab", groupId: sibling.group.id, index: sibling.group.panels.length }) : undefined)
      ?? insertNode(base, group([panel]), { kind: "float", ...floatRect });
  }
  return showPanelDocked(revealPanel(tree, panel), panel);
}
/** Fraction of the dock width a group receives when expanded. Floating groups use their window width. */
function viewSlotWidth(tree: DockTree, id: string, width: number): number {
  const visit = (node: DockNode | null, available: number): number | undefined => {
    if (!node) return;
    if (node.kind === "group") return node.id === id ? available : undefined;
    for (let i = 0; i < node.children.length; i++) {
      const found = visit(node.children[i], available * (node.axis === "row" ? node.sizes[i] : 1));
      if (found !== undefined) return found;
    }
  };
  return visit(tree.root, width) ?? tree.floating.map(floatingWindow => visit(floatingWindow.node, floatingWindow.w)).find(value => value !== undefined) ?? width;
}
/** Keep the slot, but restore its factory width proportion when its remembered size cannot hold a head pane. */
function fitViewSlot(tree: DockTree, panel: string, fallback: DockTree, width: number, collapsed: boolean): DockTree {
  const at = locate(tree, panel)!, factory = allGroups(fallback).find(({ group }) => group.panels.some(id => id === "head" || id.startsWith("view.")));
  if (!factory || (!collapsed && viewSlotWidth(tree, at.group.id, width) >= 320)) return tree;
  if (at.windowId) return { ...tree, floating: tree.floating.map(floatingWindow => floatingWindow.id === at.windowId
    ? { ...floatingWindow, w: Math.max(320, viewSlotWidth(fallback, factory.group.id, width)) } : floatingWindow) };
  const desired = viewSlotWidth(fallback, factory.group.id, width);
  const visit = (node: DockNode | null, available: number): DockNode | null => {
    if (!node || node.kind === "group") return node;
    const index = node.children.findIndex(child => [...groups(child)].some(group => group.id === at.group.id));
    if (index < 0) return node;
    // The nearest row split controls this slot's width. Preserve all other siblings' relative proportions.
    const child = node.children[index];
    const deeperRow = (value: DockNode): boolean => value.kind === "split" &&
      (value.axis === "row" || value.children.filter(child => [...groups(child)].some(group => group.id === at.group.id)).some(deeperRow));
    if (node.axis === "row" && !deeperRow(child)) {
      const share = Math.min(.95, desired / available), rest = 1 - node.sizes[index];
      return { ...node, sizes: node.sizes.map((size, i) => i === index ? share : size * (1 - share) / rest) };
    }
    return { ...node, children: node.children.map((child, i) => i === index
      ? visit(child, available * (node.axis === "row" ? node.sizes[i] : 1))! : child) };
  };
  return { ...tree, root: visit(tree.root, width) };
}
/** Insert a missing head beside the factory slot's neighbouring subtrees, never inside its nearest panel. */
function createFactoryViewSlot(tree: DockTree, panel: PanelId, fallback: DockTree): DockTree {
  const home = allGroups(fallback).find(({ group }) => group.panels.some(id => id === "head" || id.startsWith("view.")))?.group;
  if (!home) return tree;
  const parentOf = (node: DockNode | null): SplitNode | undefined => {
    if (!node || node.kind === "group") return;
    if (node.children.some(child => child.id === home.id)) return node;
    return node.children.map(parentOf).find(Boolean);
  };
  const parent = parentOf(fallback.root), created = group([panel], panel, home.id);
  if (!tree.root) return { ...tree, root: created };
  if (!parent) return { ...tree, root: split("row", [tree.root, created], [.63, .37]) };
  const index = parent.children.findIndex(child => child.id === home.id);
  const members = (nodes: DockNode[]) => new Set(nodes.flatMap(node => [...groups(node)].flatMap(group => group.panels)));
  const left = members(parent.children.slice(0, index)), right = members(parent.children.slice(index + 1));
  const contains = (node: DockNode, panels: Set<string>) => [...groups(node)].some(group => group.panels.some(id => panels.has(id)));
  const relevant = new Set([...left, ...right]);
  // Descend only while all surviving factory neighbours share one child; the insertion belongs beside their common subtree.
  const insert = (node: DockNode): DockNode => {
    if (node.kind === "split") {
      const hits = node.children.map((child, i) => contains(child, relevant) ? i : -1).filter(i => i >= 0);
      if (hits.length === 1 && node.id !== parent.id) return { ...node, children: node.children.map((child, i) => i === hits[0] ? insert(child) : child) };
      if (node.axis === parent.axis) {
        const before = node.children.findIndex(child => contains(child, right));
        const at = before >= 0 ? before : node.children.length, share = parent.sizes[index];
        const children = [...node.children], sizes = node.sizes.map(size => size * (1 - share));
        children.splice(at, 0, created); sizes.splice(at, 0, share);
        return { ...node, children, sizes };
      }
    }
    const before = contains(node, right) && !contains(node, left), share = parent.sizes[index];
    return split(parent.axis, before ? [created, node] : [node, created], before ? [share, 1 - share] : [1 - share, share]);
  };
  return { ...tree, root: insert(tree.root) };
}
/** Allocate widths with lower bounds for every subtree, preserving requested proportions wherever they fit. */
function keepViewSiblingsUsable(tree: DockTree, panel: string, width: number): DockTree {
  const minimum = (node: DockNode): number => node.kind === "group" ? node.panels.includes(panel) ? 320 : MIN_GROUP.w
    : node.axis === "row" ? node.children.reduce((sum, child) => sum + minimum(child), 0) + (node.children.length - 1) * 8
    : Math.max(...node.children.map(minimum));
  const fit = (node: DockNode, available: number): DockNode => {
    if (node.kind === "group") return node;
    if (node.axis === "column") return { ...node, children: node.children.map(child => fit(child, available)) };
    const usable = Math.max(1, available - (node.children.length - 1) * 8), sizes = [...node.sizes];
    const lower = node.children.map(minimum), head = node.children.findIndex(child => [...groups(child)].some(group => group.panels.includes(panel)));
    if (head >= 0) lower[head] = Math.max(lower[head], Math.min(usable * node.sizes[head], usable - lower.reduce((sum, value, i) => sum + (i === head ? 0 : value), 0)));
    const pending = new Set(node.children.map((_, i) => i));
    let remaining = usable;
    while (pending.size) {
      const total = [...pending].reduce((sum, i) => sum + node.sizes[i], 0);
      const small = [...pending].filter(i => remaining * node.sizes[i] / total < lower[i]);
      if (!small.length) { for (const i of pending) sizes[i] = remaining * node.sizes[i] / total / usable; break; }
      for (const i of small) { sizes[i] = lower[i] / usable; remaining -= lower[i]; pending.delete(i); }
    }
    return { ...node, sizes, children: node.children.map((child, i) => fit(child, sizes[i] * usable)) };
  };
  return { ...tree, root: tree.root && fit(tree.root, width) };
}
/** U6's first view fills the tab's former 3D slot, else the factory slot, and becomes visible there. */
export function openViewPanel(tree: DockTree, panel: PanelId, fallback: DockTree, arrangement?: DockTree, width = 1600): DockTree {
  const base = detachPanel(tree, panel);
  const isView = (id: string) => id === "head" || id.startsWith("view.");
  for (const source of [arrangement]) {
    if (!source) continue;
    const home = allGroups(source).find(({ group }) => group.panels.some(isView));
    if (!home) continue;
    const old = home.group.panels.find(isView)!, current = findGroup(base, home.group.id);
    let placed: DockTree | undefined;
    if (current) placed = insertNode(base, group([panel]), { kind: "tab", groupId: current.group.id, index: current.group.panels.length });
    else if (!home.windowId) placed = createFactoryViewSlot(base, panel, source);
    else {
      const place = placeOf(source, old, new Set(home.group.panels.filter(isView)));
      if (place && !("closed" in place)) placed = restorePlace(base, panel, { ...place,
        group: place.group.map(id => id === old ? panel : id), active: true, collapsed: false });
    }
    if (placed) {
      if (!current) placed = mapGroups(placed, item => item.panels.includes(panel) ? { ...item, id: home.group.id } : item);
      return keepViewSiblingsUsable(fitViewSlot(showPanelDocked(revealPanel(placed, panel), panel), panel, fallback, width, !!home.group.collapsed), panel, width);
    }
  }
  const placed = createFactoryViewSlot(base, panel, fallback);
  return keepViewSiblingsUsable(showPanelDocked(revealPanel(placed, panel), panel), panel, width);
}
/** Reopen a closed panel as a tab beside a preferred sibling, else floating. */
export function openPanel(tree: DockTree, panel: PanelId, preferredSiblings: PanelId[], area: Rect): DockTree {
  if (locate(tree, panel)) return activate(tree, panel);
  const base = detachPanel(tree, panel);
  for (const sibling of preferredSiblings) {
    const at = locate(base, sibling);
    if (at) return insertNode(base, group([panel]), { kind: "tab", groupId: at.group.id, index: at.group.panels.length });
  }
  const first = [...groups(base.root)][0];
  if (first) return insertNode(base, group([panel]), { kind: "tab", groupId: first.id, index: first.panels.length });
  return insertNode(base, group([panel]), { kind: "float", x: area.x + area.w / 2 - 170, y: area.y + 60 });
}
/**
 * Each split child's flex-grow: its share among the children that aren't collapsed (a collapsed group takes none). The shares are
 * scaled to sum to 1, because flex children whose grow factors sum to less than 1 leave the rest of the split empty.
 */
export function openShares(sizes: readonly number[], collapsed: readonly boolean[]): number[] {
  const open = sizes.reduce((sum, size, index) => collapsed[index] ? sum : sum + size, 0);
  return sizes.map((size, index) => collapsed[index] ? 0 : open > 0 ? size / open : size);
}
/** Collapse or expand a tab group: its tab bar stays, its neighbours take the space. */
export function setCollapsed(tree: DockTree, groupId: string, collapsed: boolean): DockTree {
  return mapGroups(clone(tree), item => {
    if (item.id !== groupId) return item;
    const { collapsed: _was, ...rest } = item;
    return collapsed ? { ...rest, collapsed: true } : rest;
  });
}

/** Whether every group in a subtree is collapsed (a split whose groups are all collapsed folds away as one). */
export function allCollapsed(node: DockNode): boolean {
  return node.kind === "group" ? !!node.collapsed : node.children.every(allCollapsed);
}
/**
 * The folding rule (view-graph-design.md §4.4): a collapsed group folds along the axis of the nearest split that still has
 * something expanded, and a split whose groups are all collapsed folds as one along its parent's axis. Folded along a column
 * (in a vertical stack) a group is a full-width header row; folded along a row it is a full-height vertical strip. A tree whose
 * groups are all collapsed (a floating window, a saved layout) folds along a column: its window shrinks to its header rows.
 * Returns each folded node's axis by ID; a node that isn't folded is absent. The sizes are never changed, so expanding restores them.
 */
export function foldAxes(root: DockNode | null): Map<string, SplitNode["axis"]> {
  const folds = new Map<string, SplitNode["axis"]>();
  const visit = (node: DockNode, fold?: SplitNode["axis"]) => {
    if (fold) folds.set(node.id, fold);
    if (node.kind === "group") return;
    for (const child of node.children) visit(child, fold ?? (allCollapsed(child) ? node.axis : undefined));
  };
  if (root) visit(root, allCollapsed(root) ? "column" : undefined);
  return folds;
}
/**
 * How a split lays out its children under the folding rule: `folded[i]` when child i gave up its space along this split's axis
 * (its cell is only as big as its bars), `shares` the flex-grow of the others (summing to 1, so they fill the split).
 */
export function splitShares(node: SplitNode, folds: ReadonlyMap<string, SplitNode["axis"]>): { folded: boolean[]; shares: number[] } {
  const folded = node.children.map(child => folds.get(child.id) === node.axis);
  return { folded, shares: openShares(node.sizes, folded) };
}
/**
 * Whether a split is a stack of vertical strips (a column folded along a row): each strip is as long as its tabs need and they share
 * what is left, since a strip's labels run along its length. Its stored sizes wait for a group to expand.
 */
export function isStripStack(node: SplitNode, folds: ReadonlyMap<string, SplitNode["axis"]>): boolean {
  return node.axis === "column" && folds.get(node.id) === "row";
}
/**
 * The two children a splitter between children `index - 1` and `index` resizes: the nearest on each side that isn't folded along
 * the split's axis (a folded cell has no size to give). Undefined when either side has none: that splitter is inert.
 */
export function splitterPair(folded: readonly boolean[], index: number): [number, number] | undefined {
  let before = index - 1, after = index;
  while (before >= 0 && folded[before]) before--;
  while (after < folded.length && folded[after]) after++;
  return before >= 0 && after < folded.length ? [before, after] : undefined;
}
/**
 * Never a blank dock (UI-105): when every docked group is collapsed (a layout saved before collapsing the last one was refused, or
 * one whose expanded groups all left with a hidden module), the docked group with the largest share of the workspace expands.
 */
export function keepDockExpanded(tree: DockTree): DockTree {
  if (!tree.root || !allCollapsed(tree.root)) return tree;
  let best: { id: string; area: number } | undefined;
  const visit = (node: DockNode, area: number) => {
    if (node.kind === "group") { if (!best || area > best.area) best = { id: node.id, area }; return; }
    node.children.forEach((child, index) => visit(child, area * node.sizes[index]!));
  };
  visit(tree.root, 1);
  return setCollapsed(tree, best!.id, false);
}
/** Whether collapsing a docked group would leave nothing docked expanded to take its space. */
export function lastExpandedDocked(tree: DockTree, groupId: string): boolean {
  const docked = [...groups(tree.root)];
  return docked.some(item => item.id === groupId && !item.collapsed) && docked.every(item => item.id === groupId || item.collapsed);
}

/** Where a panel is now, as a parked place (undefined when the tree doesn't hold it). `leaving` are the panels parked with it. */
function placeOf(tree: DockTree, panel: PanelId, leaving: ReadonlySet<PanelId>): ParkedPlace | undefined {
  if (tree.closed.includes(panel)) return { closed: true };
  const at = locate(tree, panel);
  if (!at) return undefined;
  const floatingWindow = at.windowId ? tree.floating.find(item => item.id === at.windowId) : undefined;
  // A departing group remembers a neighbour in its dock or floating composite, on the same side and at the same share.
  const anchor = anchorFor(floatingWindow?.node ?? tree.root, at.group.id, new Set([...leaving, ...at.group.panels]));
  return { group: [...at.group.panels], index: at.index, active: at.group.active === panel, groupId: at.group.id, ...(at.group.collapsed ? { collapsed: true } : {}),
    ...(!floatingWindow ? { docked: true as const } : {}),
    ...(floatingWindow ? { window: { x: floatingWindow.x, y: floatingWindow.y, w: floatingWindow.w, h: floatingWindow.h }, windowId: floatingWindow.id, windowIndex: tree.floating.indexOf(floatingWindow) } : {}),
    ...(anchor ? { anchor: floatingWindow ? anchor : { panel: anchor.panel, side: anchor.side, share: anchor.share, splitId: anchor.splitId } } : {}) };
}
/** Read a panel's current or remembered closed place without closing it or cloning its whole tree. */
export function panelPlace(tree: DockTree, panel: PanelId): Exclude<ParkedPlace, { closed: true }> | undefined {
  const place = placeOf(tree, panel, new Set([panel]));
  return place && !("closed" in place) ? place : tree.lastPlace?.[panel];
}
/** The nearest surviving neighbour of a node that leaves: a panel beside it in the closest split that keeps something, and its side. */
function anchorFor(root: DockNode | null, id: string, leaving: ReadonlySet<PanelId>): { panel: PanelId; side: Side; share: number; splitId: string; shares: Record<string, number> } | undefined {
  const survivor = (node: DockNode, last: boolean) => {
    const found = [...groups(node)].map(item => item.panels.find(panel => !leaving.has(panel))).filter((panel): panel is string => !!panel);
    return last ? found.at(-1) : found[0];
  };
  const path: SplitNode[] = [];
  const find = (node: DockNode | null): boolean => {
    if (!node) return false;
    if (node.id === id) return true;
    if (node.kind === "split") for (const child of node.children) { if (find(child)) { path.unshift(node); return true; } }
    return false;
  };
  if (!find(root)) return undefined;
  let target = id;
  for (const parent of [...path].reverse()) {
    const index = parent.children.findIndex(child => child.id === target);
    for (let distance = 1; distance < parent.children.length; distance++) {
      for (const j of [index - distance, index + distance]) {
        const neighbour = parent.children[j];
        const panel = neighbour && survivor(neighbour, j < index);
        if (!panel) continue;
        const side: Side = parent.axis === "row" ? (j < index ? "right" : "left") : (j < index ? "bottom" : "top");
        return { panel, side, share: parent.sizes[index], splitId: parent.id, shares: Object.fromEntries(parent.children.map((child, at) => [child.id, parent.sizes[at]!])) };
      }
    }
    target = parent.id;
  }
  return undefined;
}
/**
 * Withdraw panels (a module was hidden, view-graph-design.md §4.3): each leaves the tree and its place is remembered, so showing
 * the module again puts it back. A group emptied by it collapses away. Panels already parked keep their first place.
 */
export function parkPanels(tree: DockTree, panels: readonly PanelId[]): DockTree {
  const leaving = new Set(panels), parked = { ...tree.parked };
  // Every place is read from the tree as it is, before any panel leaves, so a group that leaves whole keeps its members' order.
  for (const panel of panels) { const place = placeOf(tree, panel, leaving); if (place && !parked[panel]) parked[panel] = place; }
  let next = clone(tree);
  for (const panel of panels) next = detachPanel(next, panel);
  // A closed panel parked with its module keeps where it was before it was closed.
  for (const panel of panels) { const place = tree.lastPlace?.[panel]; if (place) next.lastPlace = { ...next.lastPlace, [panel]: place }; }
  next.parked = parked;
  if (!Object.keys(parked).length) delete next.parked;
  return next;
}
/**
 * Bring parked panels back where they were (a module was shown again): into the group they shared with a member already back, at
 * their tab position; as a new group beside the remembered neighbour when their whole group left; alone in their floating window;
 * or closed. A panel with no remembered place opens at its home in `fallback` (the factory layout), as a newly added panel does.
 */
export function unparkPanels(tree: DockTree, panels: readonly PanelId[], fallback: DockTree, area: Rect): DockTree {
  let next = clone(tree);
  const parked = { ...next.parked };
  for (const panel of panels) {
    const place = parked[panel];
    delete parked[panel];
    if (locate(next, panel) || next.closed.includes(panel)) continue;
    if (place && "closed" in place) { next = { ...next, closed: [...next.closed, panel] }; continue; }
    const restored = place && restorePlace(next, panel, place);
    if (restored) { next = restored; continue; }
    if (fallback.closed.includes(panel)) { next = { ...next, closed: [...next.closed, panel] }; continue; }
    const actives = new Map(allGroups(next).map(entry => [entry.group.id, entry.group.active]));
    const home = locate(fallback, panel);
    next = openPanel(next, panel, home ? home.group.panels.filter(id => id !== panel) : [], area);
    const host = locate(next, panel)?.group.id, keep = host && actives.get(host);
    if (keep && !place?.active) next = activate(next, keep);
  }
  next.parked = parked;
  if (!Object.keys(parked).length) delete next.parked;
  return next;
}
/**
 * Put a panel back at a remembered place: into the group it shared with a member that is open, at its tab position; as a new group
 * beside the remembered neighbour when its whole group left; or alone in its floating window. Undefined when none of that is open
 * any more. The group it joins keeps showing its tab unless the panel was the shown one.
 */
function restorePlace(tree: DockTree, panel: PanelId, place: Exclude<ParkedPlace, { closed: true }>): DockTree | undefined {
  const member = (place.groupId ? allGroups(tree).find(entry => entry.group.id === place.groupId) : undefined)
    ?? place.group.filter(id => id !== panel).map(id => locate(tree, id)).find(Boolean);
  if (member) {
    // After the nearest earlier member that is back, else before the nearest later one: the tab order it had.
    const at = place.group.indexOf(panel), members = member.group.panels;
    const before = place.group.slice(0, at).reverse().find(id => members.includes(id));
    const after = place.group.slice(at + 1).find(id => members.includes(id));
    const index = before !== undefined ? members.indexOf(before) + 1 : after !== undefined ? members.indexOf(after)
      : member.group.id === place.groupId ? Math.min(place.index, members.length) : members.length;
    const next = insertNode(tree, group([panel]), { kind: "tab", groupId: member.group.id, index });
    return place.active ? next : activate(next, member.group.active);
  }
  let remembered = place.anchor;
  let anchor = remembered && locate(tree, remembered.panel);
  // Several departing groups can refer to a neighbour that has not returned yet. Any surviving
  // sibling in that split is an equally good anchor; its original order determines the side.
  const siblings = remembered?.shares, order = Object.keys(siblings ?? {}), index = order.indexOf(place.groupId ?? "");
  if ((!anchor || anchor.windowId !== place.windowId) && siblings && index >= 0) {
    const peer = allGroups(tree).find(item => item.windowId === place.windowId && order.includes(item.group.id));
    if (peer) {
      const row = remembered!.side === "left" || remembered!.side === "right", before = index < order.indexOf(peer.group.id);
      remembered = { ...remembered!, panel: peer.group.panels[0]!, side: row ? before ? "left" : "right" : before ? "top" : "bottom" };
      anchor = locate(tree, remembered.panel);
    }
  }
  if (remembered && anchor && (!anchor.windowId || anchor.windowId === place.windowId)) {
    const created = group([panel], panel, place.groupId), beside = remembered;
    const restoreShares = (tree: DockTree) => {
      const visit = (node: DockNode | null): DockNode | null => {
        if (!node || node.kind === "group") return node;
        const children = node.children.map(child => visit(child)!);
        const shares = beside.shares;
        const sizes = node.id === beside.splitId && shares && children.every(child => shares[child.id] !== undefined)
          ? children.map(child => shares[child.id]!) : undefined;
        return { ...node, children, ...(sizes ? { sizes: Object.keys(shares!).length === children.length ? sizes : normalizeSizes(sizes, children.length) } : {}) };
      };
      return { ...tree, root: visit(tree.root), floating: tree.floating.map(floatingWindow => ({ ...floatingWindow, node: visit(floatingWindow.node)! })) };
    };
    if (!anchor.windowId) return restoreShares(insertNode(tree, place.collapsed ? { ...created, collapsed: true } : created,
      { kind: "split", groupId: anchor.group.id, side: beside.side }, undefined, beside.share, true, beside.splitId));
    const floatingWindow = tree.floating.find(item => item.id === anchor!.windowId)!;
    const row = beside.side === "left" || beside.side === "right";
    const children = floatingWindow.node.kind === "split" && floatingWindow.node.id === beside.splitId ? floatingWindow.node.children : [floatingWindow.node];
    const known = siblings && index >= 0 && children.every(child => siblings[child.id] !== undefined);
    const fraction = known ? children.reduce((sum, child) => sum + siblings![child.id]!, 0) : 1 - beside.share;
    const incoming = known ? siblings![place.groupId!]! : beside.share;
    const share = known ? incoming / (fraction + incoming) : beside.share;
    const next = restoreShares(insertNode(tree, place.collapsed ? { ...created, collapsed: true } : created,
      { kind: "split", groupId: anchor.group.id, side: beside.side }, undefined, share, true, beside.splitId));
    const restored = next.floating.find(item => item.id === anchor!.windowId)!;
    // A minimum-size clamp can hide the departing group's exact pixel share. Use the saved
    // rectangle when the survivor still matches that projection, including the clamp.
    if (place.window && place.window.x === floatingWindow.x && place.window.y === floatingWindow.y
      && Math.abs(Math.max(row ? MIN_WINDOW.w : MIN_WINDOW.h, Math.round((row ? place.window.w : place.window.h) * fraction)) - (row ? floatingWindow.w : floatingWindow.h)) < 1) {
      const after = known ? fraction + incoming : 1;
      Object.assign(restored, place.window);
      if (after < 1 - 1e-12) { if (row) restored.w = Math.max(MIN_WINDOW.w, Math.round(place.window.w * after)); else restored.h = Math.max(MIN_WINDOW.h, Math.round(place.window.h * after)); }
    }
    return next;
  }
  if (place.window) {
    const created = group([panel], panel, place.groupId), next = clone(tree);
    next.floating.splice(Math.min(place.windowIndex ?? next.floating.length, next.floating.length), 0,
      { id: place.windowId ?? newId("w"), ...place.window,
        ...(place.anchor ? place.anchor.side === "left" || place.anchor.side === "right"
          ? { w: Math.max(MIN_WINDOW.w, Math.round(place.window.w * place.anchor.share)) }
          : { h: Math.max(MIN_WINDOW.h, Math.round(place.window.h * place.anchor.share)) } : {}),
        node: place.collapsed ? { ...created, collapsed: true } : created });
    return next;
  }
  if (place.docked && !tree.root) { const created = group([panel], panel, place.groupId); return { ...clone(tree), root: place.collapsed ? { ...created, collapsed: true } : created }; }
  return undefined;
}

export function setSizes(tree: DockTree, splitId: string, sizes: number[]): DockTree {
  const next = clone(tree);
  const visit = (node: DockNode | null): DockNode | null => {
    if (!node || node.kind === "group") return node;
    if (node.id === splitId) return { ...node, sizes: normalizeSizes(sizes, node.children.length) };
    return { ...node, children: node.children.map(child => visit(child)!) };
  };
  next.root = visit(next.root);
  next.floating = next.floating.map(floatingWindow => ({ ...floatingWindow, node: visit(floatingWindow.node)! }));
  return next;
}
export function setWindowRect(tree: DockTree, windowId: string, rect: Partial<Rect>): DockTree {
  return { ...clone(tree), floating: tree.floating.map(floatingWindow => floatingWindow.id === windowId ? { ...clone(floatingWindow), ...rect } : clone(floatingWindow)) };
}
export function raiseWindow(tree: DockTree, windowId: string): DockTree {
  const floatingWindow = tree.floating.find(item => item.id === windowId);
  if (!floatingWindow || tree.floating[tree.floating.length - 1] === floatingWindow) return tree;
  return { ...clone(tree), floating: [...tree.floating.filter(item => item !== floatingWindow), floatingWindow].map(clone) };
}
/** Only docked groups can be maximized; floating windows already sit above the dock. */
export function setMaximized(tree: DockTree, groupId?: string): DockTree {
  const found = groupId ? findGroup(tree, groupId) : undefined;
  // A collapsed group expands to fill the workspace: maximized, it shows its panel (UI-105).
  const next = found?.group.collapsed && !found.windowId ? setCollapsed(tree, found.group.id, false) : clone(tree);
  if (found && !found.windowId) next.maximized = groupId; else delete next.maximized;
  return next;
}
/**
 * Show a panel: its tab becomes the active one and a collapsed group holding it expands (UI-103), so every reveal (the palette,
 * the Panels flyout, Help, guidance) shows the panel.
 */
export function revealPanel(tree: DockTree, panel: PanelId): DockTree {
  const next = activate(tree, panel), at = locate(next, panel);
  return at?.group.collapsed ? setCollapsed(next, at.group.id, false) : next;
}
/** Leave maximize mode when a panel that must become visible is docked elsewhere. */
export function showPanelDocked(tree: DockTree, panel: PanelId): DockTree {
  if (!tree.maximized) return tree;
  const at = locate(tree, panel);
  return at && !at.windowId && at.group.id !== tree.maximized ? setMaximized(tree) : tree;
}

export const MIN_WINDOW = { w: 220, h: 160 };
export const WINDOW_GRIP = 44;
/** Keep every floating window reachable: its bar must stay inside the work area. */
export function recoverWindows(tree: DockTree, area: Rect): DockTree {
  const next = clone(tree);
  next.floating = next.floating.map(floatingWindow => {
    const w = Math.max(MIN_WINDOW.w, Math.min(floatingWindow.w, area.w));
    const h = Math.max(MIN_WINDOW.h, Math.min(floatingWindow.h, area.h));
    const x = Math.max(area.x - w + WINDOW_GRIP * 2, Math.min(floatingWindow.x, area.x + area.w - WINDOW_GRIP * 2));
    const y = Math.max(area.y, Math.min(floatingWindow.y, area.y + area.h - WINDOW_GRIP));
    return { ...floatingWindow, x, y, w, h };
  });
  return next;
}

/**
 * Strict parser: rejects malformed structure, removes unknown/duplicate panels, and appends missing known panels next to their
 * default siblings. `parked` are the panels of hidden modules (view-graph-design.md §4.3): known but withdrawn, so they are never
 * re-added; their remembered places are kept, and one still found in the tree is withdrawn with its place remembered.
 */
export function parseTree(value: unknown, known: readonly PanelId[], fallback: DockTree, parked: readonly PanelId[] = []): DockTree | undefined {
  const seen = new Set<string>(), ids = new Set<string>();
  // Panel IDs of feature views are `<feature>.<panel>`, so a dot is allowed (feature-module platform §4).
  const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 80 && /^[a-z0-9.-]+$/i.test(id);
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  const node = (input: unknown, depth: number): DockNode | null | undefined => {
    if (!input || typeof input !== "object" || depth > 12) return undefined;
    const item = input as Record<string, unknown>;
    if (!validId(item.id) || ids.has(item.id)) return undefined;
    ids.add(item.id);
    if (item.kind === "group") {
      if (!Array.isArray(item.panels) || item.panels.length > 64) return undefined;
      // A hidden module's panel still in a group is read too, then withdrawn below with its place remembered.
      const panels = item.panels.filter((id): id is string => validId(id) && (known.includes(id) || parked.includes(id)) && !seen.has(id));
      panels.forEach(id => seen.add(id));
      if (!panels.length) return null;
      const active = typeof item.active === "string" && panels.includes(item.active) ? item.active : panels[0];
      return { kind: "group", id: item.id, panels, active, ...(item.collapsed === true ? { collapsed: true } : {}) };
    }
    if (item.kind === "split") {
      if ((item.axis !== "row" && item.axis !== "column") || !Array.isArray(item.children) ||
        !Array.isArray(item.sizes) || item.children.length > 16 || item.sizes.length !== item.children.length) return undefined;
      const children: DockNode[] = [], sizes: number[] = [];
      for (let i = 0; i < item.children.length; i++) {
        const child = node(item.children[i], depth + 1);
        if (child === undefined) return undefined;
        const size = item.sizes[i];
        if (!finite(size) || size <= 0) return undefined;
        if (child) { children.push(child); sizes.push(size); }
      }
      if (!children.length) return null;
      if (children.length === 1) return children[0];
      return { kind: "split", id: item.id, axis: item.axis, children, sizes: normalizeSizes(sizes, children.length) };
    }
    return undefined;
  };
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const root = input.root === null ? null : node(input.root, 0);
  if (root === undefined || !Array.isArray(input.floating) || input.floating.length > 32 || !Array.isArray(input.closed)) return undefined;
  const floating: FloatingWindow[] = [];
  for (const entry of input.floating) {
    if (!entry || typeof entry !== "object") return undefined;
    const floatingWindow = entry as Record<string, unknown>;
    if (!validId(floatingWindow.id) || ids.has(floatingWindow.id) || ![floatingWindow.x, floatingWindow.y, floatingWindow.w, floatingWindow.h].every(finite)) return undefined;
    ids.add(floatingWindow.id);
    const child = node(floatingWindow.node, 0);
    if (child === undefined) return undefined;
    if (child) floating.push({ id: floatingWindow.id, x: floatingWindow.x as number, y: floatingWindow.y as number,
      w: floatingWindow.w as number, h: floatingWindow.h as number, node: child });
  }
  const closed = input.closed.filter((id): id is string => validId(id) && (known.includes(id) || parked.includes(id)) && !seen.has(id));
  closed.forEach(id => seen.add(id));
  let tree: DockTree = { root, floating, closed };
  // Remembered places of the parked panels: the saved ones, then where the saved tree still held them (withdrawn here).
  const saved = input.parked && typeof input.parked === "object" && !Array.isArray(input.parked) ? input.parked as Record<string, unknown> : {};
  const places: Record<PanelId, ParkedPlace> = {};
  for (const id of parked) { const place = parsePlace(saved[id], validId, finite); if (place) places[id] = place; }
  if (Object.keys(places).length) tree.parked = places;
  // Where each closed (or parked) panel was when it was closed.
  const last = input.lastPlace && typeof input.lastPlace === "object" && !Array.isArray(input.lastPlace) ? input.lastPlace as Record<string, unknown> : {};
  for (const id of [...closed, ...parked.filter(id => !seen.has(id))]) {
    const place = parsePlace(last[id], validId, finite);
    if (place && !("closed" in place)) tree.lastPlace = { ...tree.lastPlace, [id]: place };
  }
  const held = parked.filter(id => seen.has(id));
  if (held.length) tree = parkPanels(tree, held);
  if (typeof input.maximized === "string" && findGroup(tree, input.maximized)) tree.maximized = input.maximized;
  for (const missing of known.filter(id => !seen.has(id))) {
    // A newly added panel that is closed by default (Help) stays closed until someone opens it.
    if (fallback.closed.includes(missing)) { tree.closed = [...tree.closed, missing]; continue; }
    const home = locate(fallback, missing);
    const siblings = home ? home.group.panels.filter(id => id !== missing) : [];
    // A newly added panel joins as a background tab: the group keeps showing what the user left open.
    const actives = new Map(allGroups(tree).map(entry => [entry.group.id, entry.group.active]));
    tree = openPanel(tree, missing, siblings, { x: 0, y: 0, w: 1280, h: 800 });
    const host = locate(tree, missing), keep = host && actives.get(host.group.id);
    if (keep) tree = activate(tree, keep);
  }
  return tree;
}

/** A saved parked place, validated; undefined for anything malformed. */
function parsePlace(value: unknown, validId: (id: unknown) => id is string, finite: (n: unknown) => n is number): ParkedPlace | undefined {
  if (!value || typeof value !== "object") return undefined;
  const place = value as Record<string, unknown>;
  if (place.closed === true) return { closed: true };
  if (!Array.isArray(place.group) || place.group.length > 64 || !place.group.every(validId) || !Number.isInteger(place.index) ||
    (place.index as number) < 0 || typeof place.active !== "boolean") return undefined;
  const floatingWindow = place.window as Record<string, unknown> | undefined;
  const rect = floatingWindow && [floatingWindow.x, floatingWindow.y, floatingWindow.w, floatingWindow.h].every(finite)
    ? { x: floatingWindow.x as number, y: floatingWindow.y as number, w: floatingWindow.w as number, h: floatingWindow.h as number } : undefined;
  const anchor = place.anchor as Record<string, unknown> | undefined;
  const beside = anchor && validId(anchor.panel) && ["left", "right", "top", "bottom"].includes(anchor.side as string) && finite(anchor.share) &&
    (anchor.share as number) > 0 && (anchor.share as number) < 1 ? { panel: anchor.panel, side: anchor.side as Side, share: anchor.share as number,
      ...(validId(anchor.splitId) ? { splitId: anchor.splitId } : {}),
      ...(anchor.shares && typeof anchor.shares === "object" && !Array.isArray(anchor.shares)
        && Object.entries(anchor.shares).length <= 64 && Object.entries(anchor.shares).every(([id, share]) => validId(id) && finite(share) && share > 0 && share < 1)
        ? { shares: { ...anchor.shares } as Record<string, number> } : {}) } : undefined;
  return { group: [...place.group] as string[], index: place.index as number, active: place.active,
    ...(validId(place.groupId) ? { groupId: place.groupId } : {}), ...(place.docked === true ? { docked: true as const } : {}),
    ...(place.collapsed === true ? { collapsed: true } : {}), ...(rect ? { window: rect,
      ...(validId(place.windowId) ? { windowId: place.windowId } : {}), ...(Number.isSafeInteger(place.windowIndex) && (place.windowIndex as number) >= 0 ? { windowIndex: place.windowIndex as number } : {}) } : {}),
    ...(beside ? { anchor: beside } : {}) };
}
