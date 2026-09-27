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
  anchor?: { panel: PanelId; side: Side; share: number } } | { closed: true };
export type DockTree = {
  root: DockNode | null;
  /** Painted in array order; the last window is frontmost. */
  floating: FloatingWindow[];
  closed: PanelId[];
  maximized?: string;
  /** Panels withdrawn with a hidden module, and where each was: per size class, like the rest of the tree. */
  parked?: Record<PanelId, ParkedPlace>;
};
export type SizeClass = "wide" | "compact";
export type DockState = { wide: DockTree; compact: DockTree };
export const DOCK_FORMAT = "xfs/dock";
export const DOCK_VERSION = 1;

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
    ...tree.floating.flatMap(window => [...groups(window.node)].map(item => ({ group: item, windowId: window.id })))];
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
  const floating = tree.floating.map(window => ({ ...window, node: visit(window.node) }))
    .filter((window): window is FloatingWindow => !!window.node);
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
  after.floating = after.floating.map(window => {
    const old = before.floating.find(item => item.id === window.id);
    if (!old || old.node.kind !== "split") return window;
    // An old top-level member counts as removed only when none of its groups survive
    // (a nested split that collapses into its survivor keeps the window size).
    const surviving = new Set([...groups(window.node)].map(item => item.id));
    const removed = old.node.children.reduce((sum, child, i) =>
      sum + ([...groups(child)].some(item => surviving.has(item.id)) ? 0 : old.node.kind === "split" ? old.node.sizes[i] : 0), 0);
    if (removed <= 0 || removed >= 1) return window;
    return old.node.axis === "row"
      ? { ...window, w: Math.max(MIN_WINDOW.w, Math.round(window.w * (1 - removed))) }
      : { ...window, h: Math.max(MIN_WINDOW.h, Math.round(window.h * (1 - removed))) };
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
  if (next.maximized && !findGroup(next, next.maximized)) delete next.maximized;
  return next;
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
  else for (const window of next.floating) {
    node = find(window.node);
    if (node) { window.node = removeNode(window.node, id) as DockNode; break; }
  }
  next.floating = next.floating.filter(window => window.node);
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
function insertNode(tree: DockTree, node: DockNode, target: DropTarget, defaultRect?: Rect, share = .5): DockTree {
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
          if (grow && item === subtree) { sizes = sizes.map(size => size * (1 - share)); incoming = share; }
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
        before ? [share, rest(share)] : [rest(share), share]));
    };
    if (found.windowId) {
      // A magnetic composite grows by the incoming panel instead of squeezing its current content.
      next.floating = next.floating.map(window => {
        if (window.id !== found.windowId) return window;
        // Matches previewRect(): an attached panel adds at most 360 px across or 300 px down.
        const extra = axis === "row" ? Math.min(defaultRect?.w ?? 320, 360) : Math.min(defaultRect?.h ?? 260, 300);
        const current = axis === "row" ? window.w : window.h;
        const node = place(window.node, extra / (current + extra), true);
        return axis === "row"
          ? { ...window, node, w: window.w + extra, x: before ? window.x - extra : window.x }
          : { ...window, node, h: window.h + extra, y: before ? window.y - extra : window.y };
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
  const window = tree.floating.find(item => item.id === source.windowId);
  if (!window) return tree;
  if (target.kind === "float") {
    return { ...clone(tree), floating: tree.floating.map(item => item.id === window.id
      ? { ...clone(item), x: target.x, y: target.y } : clone(item)) };
  }
  if (target.kind !== "edge" && containsNode(window.node, target.groupId)) return tree;
  const rest = { ...clone(tree), floating: tree.floating.filter(item => item.id !== window.id).map(clone) };
  return insertNode(rest, clone(window.node), target, sourceRect);
}

export function activate(tree: DockTree, panel: PanelId): DockTree {
  return mapGroups(clone(tree), item => item.panels.includes(panel) ? { ...item, active: panel } : item);
}
export function closePanel(tree: DockTree, panel: PanelId): DockTree {
  if (!locate(tree, panel)) return tree;
  const next = detachPanel(tree, panel);
  next.closed = [...next.closed, panel];
  return next;
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

/** Where a panel is now, as a parked place (undefined when the tree doesn't hold it). `leaving` are the panels parked with it. */
function placeOf(tree: DockTree, panel: PanelId, leaving: ReadonlySet<PanelId>): ParkedPlace | undefined {
  if (tree.closed.includes(panel)) return { closed: true };
  const at = locate(tree, panel);
  if (!at) return undefined;
  const window = at.windowId ? tree.floating.find(item => item.id === at.windowId) : undefined;
  // A docked group that leaves whole remembers a neighbour to come back beside, on the same side and at the same share.
  const anchor = !at.windowId && at.group.panels.every(id => leaving.has(id)) ? anchorFor(tree.root, at.group.id, leaving) : undefined;
  return { group: [...at.group.panels], index: at.index, active: at.group.active === panel, ...(at.group.collapsed ? { collapsed: true } : {}),
    ...(window && window.node.kind === "group" ? { window: { x: window.x, y: window.y, w: window.w, h: window.h } } : {}),
    ...(anchor ? { anchor } : {}) };
}
/** The nearest surviving neighbour of a node that leaves: a panel beside it in the closest split that keeps something, and its side. */
function anchorFor(root: DockNode | null, id: string, leaving: ReadonlySet<PanelId>): { panel: PanelId; side: Side; share: number } | undefined {
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
        return { panel, side, share: parent.sizes[index] };
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
    const actives = new Map(allGroups(next).map(entry => [entry.group.id, entry.group.active]));
    const keepActive = (groupId: string | undefined) => {
      const keep = groupId && actives.get(groupId);
      if (keep && !place?.active) next = activate(next, keep);
    };
    const member = place?.group.filter(id => id !== panel).map(id => locate(next, id)).find(Boolean);
    if (place && member) {
      // After the nearest earlier member that is back, else before the nearest later one: the tab order it had.
      const at = place.group.indexOf(panel), members = member.group.panels;
      const before = place.group.slice(0, at).reverse().find(id => members.includes(id));
      const after = place.group.slice(at + 1).find(id => members.includes(id));
      const index = before !== undefined ? members.indexOf(before) + 1 : after !== undefined ? members.indexOf(after) : members.length;
      next = insertNode(next, group([panel]), { kind: "tab", groupId: member.group.id, index });
      keepActive(member.group.id);
      continue;
    }
    const anchor = place?.anchor && locate(next, place.anchor.panel);
    if (place?.anchor && anchor && !anchor.windowId) {
      const created = group([panel], panel);
      next = insertNode(next, place.collapsed ? { ...created, collapsed: true } : created, { kind: "split", groupId: anchor.group.id, side: place.anchor.side },
        undefined, place.anchor.share);
      continue;
    }
    if (place?.window) { next = insertNode(next, group([panel]), { kind: "float", ...place.window }); continue; }
    if (fallback.closed.includes(panel)) { next = { ...next, closed: [...next.closed, panel] }; continue; }
    const home = locate(fallback, panel);
    next = openPanel(next, panel, home ? home.group.panels.filter(id => id !== panel) : [], area);
    keepActive(locate(next, panel)?.group.id);
  }
  next.parked = parked;
  if (!Object.keys(parked).length) delete next.parked;
  return next;
}

export function setSizes(tree: DockTree, splitId: string, sizes: number[]): DockTree {
  const next = clone(tree);
  const visit = (node: DockNode | null): DockNode | null => {
    if (!node || node.kind === "group") return node;
    if (node.id === splitId) return { ...node, sizes: normalizeSizes(sizes, node.children.length) };
    return { ...node, children: node.children.map(child => visit(child)!) };
  };
  next.root = visit(next.root);
  next.floating = next.floating.map(window => ({ ...window, node: visit(window.node)! }));
  return next;
}
export function setWindowRect(tree: DockTree, windowId: string, rect: Partial<Rect>): DockTree {
  return { ...clone(tree), floating: tree.floating.map(window => window.id === windowId ? { ...clone(window), ...rect } : clone(window)) };
}
export function raiseWindow(tree: DockTree, windowId: string): DockTree {
  const window = tree.floating.find(item => item.id === windowId);
  if (!window || tree.floating[tree.floating.length - 1] === window) return tree;
  return { ...clone(tree), floating: [...tree.floating.filter(item => item !== window), window].map(clone) };
}
/** Only docked groups can be maximized; floating windows already sit above the dock. */
export function setMaximized(tree: DockTree, groupId?: string): DockTree {
  const next = clone(tree), found = groupId ? findGroup(next, groupId) : undefined;
  if (found && !found.windowId) next.maximized = groupId; else delete next.maximized;
  return next;
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
  next.floating = next.floating.map(window => {
    const w = Math.max(MIN_WINDOW.w, Math.min(window.w, area.w));
    const h = Math.max(MIN_WINDOW.h, Math.min(window.h, area.h));
    const x = Math.max(area.x - w + WINDOW_GRIP * 2, Math.min(window.x, area.x + area.w - WINDOW_GRIP * 2));
    const y = Math.max(area.y, Math.min(window.y, area.y + area.h - WINDOW_GRIP));
    return { ...window, x, y, w, h };
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
    const window = entry as Record<string, unknown>;
    if (!validId(window.id) || ids.has(window.id) || ![window.x, window.y, window.w, window.h].every(finite)) return undefined;
    ids.add(window.id);
    const child = node(window.node, 0);
    if (child === undefined) return undefined;
    if (child) floating.push({ id: window.id, x: window.x as number, y: window.y as number,
      w: window.w as number, h: window.h as number, node: child });
  }
  const closed = input.closed.filter((id): id is string => validId(id) && (known.includes(id) || parked.includes(id)) && !seen.has(id));
  closed.forEach(id => seen.add(id));
  let tree: DockTree = { root, floating, closed };
  // Remembered places of the parked panels: the saved ones, then where the saved tree still held them (withdrawn here).
  const saved = input.parked && typeof input.parked === "object" && !Array.isArray(input.parked) ? input.parked as Record<string, unknown> : {};
  const places: Record<PanelId, ParkedPlace> = {};
  for (const id of parked) { const place = parsePlace(saved[id], validId, finite); if (place) places[id] = place; }
  if (Object.keys(places).length) tree.parked = places;
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
  const window = place.window as Record<string, unknown> | undefined;
  const rect = window && [window.x, window.y, window.w, window.h].every(finite)
    ? { x: window.x as number, y: window.y as number, w: window.w as number, h: window.h as number } : undefined;
  const anchor = place.anchor as Record<string, unknown> | undefined;
  const beside = anchor && validId(anchor.panel) && ["left", "right", "top", "bottom"].includes(anchor.side as string) && finite(anchor.share) &&
    (anchor.share as number) > 0 && (anchor.share as number) < 1 ? { panel: anchor.panel, side: anchor.side as Side, share: anchor.share as number } : undefined;
  return { group: [...place.group] as string[], index: place.index as number, active: place.active,
    ...(place.collapsed === true ? { collapsed: true } : {}), ...(rect ? { window: rect } : {}), ...(beside ? { anchor: beside } : {}) };
}
