import type { DropTarget, Rect, Side } from "./layout";

/**
 * Cursor-position drop resolution. The dragged panel's own rectangle is never an
 * input: a large panel overlapping another does not snap until the *cursor*
 * reaches a guide, tab strip or magnetic edge band. Pure and DOM-free.
 */
export type Point = { x: number; y: number };
export type TargetGroup = {
  id: string;
  floating: boolean;
  rect: Rect;
  tabStrip: Rect;
  /** Tab rectangles in strip order, used only to choose an insertion index. */
  tabs: Rect[];
};
export type DropGeometry = {
  workspace: Rect;
  /** Candidate groups, frontmost first. Callers exclude the groups being dragged. */
  groups: TargetGroup[];
};
export type Guide = { target: DropTarget; rect: Rect; label: string };
export type DropResolution = {
  target: DropTarget;
  /** Guides the view should draw; `active` is the guide under the cursor, if any. */
  guides: Guide[];
  active?: Guide;
  /** The group whose compass is showing (under the cursor). */
  hoverGroup?: string;
};

export const GUIDE_SIZE = 34;
export const GUIDE_GAP = 6;
export const EDGE_GUIDE_INSET = 10;
/** Width of the magnetic band on either side of a floating window edge, measured at the cursor. */
export const MAGNET_BAND = 18;

export const inside = (p: Point, r: Rect) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
const box = (cx: number, cy: number, size = GUIDE_SIZE): Rect => ({ x: cx - size / 2, y: cy - size / 2, w: size, h: size });
const sideLabel: Record<Side, string> = { left: "left", right: "right", top: "top", bottom: "bottom" };

/** Five compass guides centred in a group: tab (centre) and four splits. */
export function compassGuides(group: TargetGroup): Guide[] {
  const cx = group.rect.x + group.rect.w / 2, cy = group.rect.y + group.rect.h / 2, step = GUIDE_SIZE + GUIDE_GAP;
  const verb = group.floating ? "Attach" : "Split";
  return [
    { target: { kind: "tab", groupId: group.id, index: group.tabs.length }, rect: box(cx, cy), label: "Add as tab" },
    { target: { kind: "split", groupId: group.id, side: "left" }, rect: box(cx - step, cy), label: `${verb} left` },
    { target: { kind: "split", groupId: group.id, side: "right" }, rect: box(cx + step, cy), label: `${verb} right` },
    { target: { kind: "split", groupId: group.id, side: "top" }, rect: box(cx, cy - step), label: `${verb} above` },
    { target: { kind: "split", groupId: group.id, side: "bottom" }, rect: box(cx, cy + step), label: `${verb} below` },
  ];
}
export function edgeGuides(workspace: Rect): Guide[] {
  const { x, y, w, h } = workspace, half = GUIDE_SIZE / 2 + EDGE_GUIDE_INSET;
  return (["left", "right", "top", "bottom"] as Side[]).map(side => ({
    target: { kind: "edge", side }, label: `Dock to ${sideLabel[side]} edge`,
    rect: side === "left" ? box(x + half, y + h / 2) : side === "right" ? box(x + w - half, y + h / 2) :
      side === "top" ? box(x + w / 2, y + half) : box(x + w / 2, y + h - half),
  }));
}
function tabIndex(cursor: Point, tabs: Rect[]) {
  let index = 0;
  for (const tab of tabs) if (cursor.x > tab.x + tab.w / 2) index++;
  return index;
}
/** Magnetic join for floating windows: a band straddling each edge, tested with the cursor only. */
function magneticSide(cursor: Point, rect: Rect): Side | undefined {
  const within = (value: number, lo: number, hi: number) => value >= lo && value <= hi;
  const inY = within(cursor.y, rect.y, rect.y + rect.h), inX = within(cursor.x, rect.x, rect.x + rect.w);
  const near = (distance: number) => Math.abs(distance) <= MAGNET_BAND;
  const candidates: { side: Side; distance: number }[] = [];
  if (inY && near(cursor.x - rect.x)) candidates.push({ side: "left", distance: Math.abs(cursor.x - rect.x) });
  if (inY && near(cursor.x - (rect.x + rect.w))) candidates.push({ side: "right", distance: Math.abs(cursor.x - rect.x - rect.w) });
  if (inX && near(cursor.y - rect.y)) candidates.push({ side: "top", distance: Math.abs(cursor.y - rect.y) });
  if (inX && near(cursor.y - (rect.y + rect.h))) candidates.push({ side: "bottom", distance: Math.abs(cursor.y - rect.y - rect.h) });
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]?.side;
}

export function resolveDrop(cursor: Point, geometry: DropGeometry, options: { suppress?: boolean } = {}): DropResolution {
  const float: DropTarget = { kind: "float", x: cursor.x, y: cursor.y };
  const edges = edgeGuides(geometry.workspace);
  if (options.suppress) return { target: float, guides: [] };
  const edge = edges.find(guide => inside(cursor, guide.rect));
  if (edge) return { target: edge.target, guides: edges, active: edge };
  // Frontmost group whose tab strip, body or magnetic band holds the cursor.
  for (const group of geometry.groups) {
    if (inside(cursor, group.tabStrip)) {
      const target: DropTarget = { kind: "tab", groupId: group.id, index: tabIndex(cursor, group.tabs) };
      const guide = { target, rect: group.tabStrip, label: "Add as tab" };
      return { target, guides: edges, active: guide, hoverGroup: group.id };
    }
    if (group.floating) {
      const side = magneticSide(cursor, group.rect);
      if (side) {
        const target: DropTarget = { kind: "split", groupId: group.id, side };
        return { target, guides: edges, active: { target, rect: group.rect, label: `Attach ${sideLabel[side]}` },
          hoverGroup: group.id };
      }
    }
    if (inside(cursor, group.rect)) {
      const compass = compassGuides(group);
      const active = compass.find(guide => inside(cursor, guide.rect));
      return { target: active?.target ?? float, guides: [...edges, ...compass], active, hoverGroup: group.id };
    }
  }
  return { target: float, guides: edges };
}

/** Where a resolved target would place content, for the drop preview. */
export function previewRect(target: DropTarget, geometry: DropGeometry, floatSize: { w: number; h: number }): Rect {
  if (target.kind === "float") return { x: target.x, y: target.y, w: floatSize.w, h: floatSize.h };
  const ws = geometry.workspace;
  if (target.kind === "edge") {
    const w = Math.round(ws.w * .24), h = Math.round(ws.h * .3);
    return target.side === "left" ? { ...ws, w } : target.side === "right" ? { ...ws, x: ws.x + ws.w - w, w } :
      target.side === "top" ? { ...ws, h } : { ...ws, y: ws.y + ws.h - h, h };
  }
  const group = geometry.groups.find(item => item.id === target.groupId);
  if (!group) return { x: 0, y: 0, w: 0, h: 0 };
  const r = group.rect;
  if (target.kind === "tab") return r;
  if (group.floating) {
    const w = Math.min(floatSize.w, 360), h = Math.min(floatSize.h, 300);
    return target.side === "left" ? { x: r.x - w, y: r.y, w, h: r.h } : target.side === "right" ? { x: r.x + r.w, y: r.y, w, h: r.h } :
      target.side === "top" ? { x: r.x, y: r.y - h, w: r.w, h } : { x: r.x, y: r.y + r.h, w: r.w, h };
  }
  return target.side === "left" ? { ...r, w: r.w / 2 } : target.side === "right" ? { ...r, x: r.x + r.w / 2, w: r.w / 2 } :
    target.side === "top" ? { ...r, h: r.h / 2 } : { ...r, y: r.y + r.h / 2, h: r.h / 2 };
}
