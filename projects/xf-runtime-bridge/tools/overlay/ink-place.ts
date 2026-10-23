// Where the ink panel goes (0.8.3): the arithmetic of redscript/XFRuntimeBridgeInk.reds (XFInkStyle.ModelVisible, Plausible,
// Floor, AnchorPoint, PanelEdge and XFInkOverlay.Place), mirrored here so the tests can check it for every anchor at 16:9,
// 21:9 and 32:9 without the game. tools/test/batch17.test.ts checks that the redscript still says the same.
//
// The mapping (session 10, 3840 x 1600): the HUD layer's root is 3840 x 2160 units; its top-left corner is the screen's
// top-left corner and its width the screen's width, so the screen shows the canvas's top 3840 / aspect units and the rest
// hangs below it. 0.8 assumed the middle (280 units cut off at the top and the bottom at 21:9) and every anchor sat about
// 280 units too low. In the game the overlay measures the visible part from the game's own layout (WidgetUtils.GlobalToLocal
// of the window's corners) and falls back to this model.

export type Rect = { x: number; y: number; w: number; h: number };
export type Vec2 = { x: number; y: number };

export const ANCHORS = ["top_left", "top_center", "top_right", "center_left", "center", "center_right", "bottom_left", "bottom_center", "bottom_right"] as const;
export type Anchor = (typeof ANCHORS)[number];

/** The visible screen in the root's units until it is measured: the canvas's top rootWidth / aspect units. */
export function modelVisible(rootWidth: number, rootHeight: number, screen: Vec2): Rect {
  if (screen.x < 100 || screen.y < 100 || rootWidth < 100) return { x: 0, y: 0, w: rootWidth, h: rootHeight };
  return { x: 0, y: 0, w: rootWidth, h: (screen.y * rootWidth) / screen.x };
}

/** A measurement (the screen's corners in the root's units) accepted only when plausible; null otherwise. */
export function plausible(a: Vec2, b: Vec2, screen: Vec2, rootWidth: number, rootHeight: number): Rect | null {
  const w = b.x - a.x, h = b.y - a.y;
  if (screen.x < 100 || screen.y < 100 || !(w > 100) || !(h > 100) || w > rootWidth * 8 || h > rootHeight * 8) return null;
  if (!(Math.abs(a.x) < rootWidth * 4) || !(Math.abs(a.y) < rootHeight * 4) || Math.abs(w / h - screen.x / screen.y) > (0.02 * screen.x) / screen.y) return null;
  return { x: a.x, y: a.y, w, h };
}

/**
 * Each anchor's floor (x from a left or right edge, y from a top or bottom edge) in the HUD's design units (2160 per screen
 * height), so the panel clears the game's own HUD blocks (session 10's capture at 3840 x 1600).
 */
export const FLOORS: Readonly<Record<Anchor, readonly [number, number]>> = {
  top_left: [0, 300],
  top_center: [0, 140],
  top_right: [860, 0],
  center_left: [0, 0],
  center: [0, 0],
  center_right: [860, 0],
  bottom_left: [0, 520],
  bottom_center: [0, 480],
  bottom_right: [860, 480],
};

export function anchorPoint(name: string): Vec2 {
  return { x: name.endsWith("_right") ? 1 : name.endsWith("_center") || name === "center" ? 0.5 : 0, y: name.startsWith("bottom_") ? 1 : name.startsWith("center") ? 0.5 : 0 };
}

export const panelEdge = (start: number, length: number, fraction: number, offset: number, size: number) => start + fraction * length + offset - fraction * size;

/**
 * The panel's top-left corner in the root's units: the anchor's point of the visible screen, moved in by the offset (in the
 * root's units; units converts ui.hud's x and y) but at least the anchor's floor, less the same fractions of the panel's size,
 * then kept whole inside the visible screen with an 8-unit margin.
 */
export function place(anchor: Anchor, offset: Vec2, panel: Vec2, visible: Rect, units = 1): Vec2 {
  const point = anchorPoint(anchor);
  const [fx, fy] = FLOORS[anchor];
  const hud = visible.h / 2160;
  const ox = fx > 0 ? Math.max(offset.x * units, fx * hud) : offset.x * units;
  const oy = fy > 0 ? Math.max(offset.y * units, fy * hud) : offset.y * units;
  const dx = point.x > 0.9 ? -ox : ox, dy = point.y > 0.9 ? -oy : oy;
  let left = panelEdge(visible.x, visible.w, point.x, dx, panel.x);
  let top = panelEdge(visible.y, visible.h, point.y, dy, panel.y);
  const margin = 8 * units;
  left = Math.min(Math.max(left, visible.x + margin), Math.max(visible.x + margin, visible.x + visible.w - margin - panel.x));
  top = Math.min(Math.max(top, visible.y + margin), Math.max(visible.y + margin, visible.y + visible.h - margin - panel.y));
  return { x: left, y: top };
}

export type ZoneHow = "kept" | "nudged" | `corner:${"top_left" | "top_right" | "bottom_left" | "bottom_right"}` | "overlapping";

const zoneHit = (r: Rect, z: Rect, gap: number) => r.x < z.x + z.w + gap && r.x + r.w + gap > z.x && r.y < z.y + z.h + gap && r.y + r.h + gap > z.y;
const keepInside = (r: Rect, v: Rect, gap: number): Rect => ({
  x: Math.min(Math.max(r.x, v.x + gap), Math.max(v.x + gap, v.x + v.w - gap - r.w)),
  y: Math.min(Math.max(r.y, v.y + gap), Math.max(v.y + gap, v.y + v.h - gap - r.h)),
  w: r.w,
  h: r.h,
});

/** One zone's way out: along the anchor's own edge first (sideways for a top or bottom anchor), then the other axis, the nearer side first. */
function slideOut(r: Rect, z: Rect, v: Rect, gap: number, sidewaysFirst: boolean): Rect | null {
  const across = [{ ...r, x: z.x - gap - r.w }, { ...r, x: z.x + z.w + gap }].sort((a, b) => Math.abs(a.x - r.x) - Math.abs(b.x - r.x));
  const along = [{ ...r, y: z.y - gap - r.h }, { ...r, y: z.y + z.h + gap }].sort((a, b) => Math.abs(a.y - r.y) - Math.abs(b.y - r.y));
  for (const c of sidewaysFirst ? [...across, ...along] : [...along, ...across]) {
    const kept = keepInside(c, v, gap);
    if (!zoneHit(kept, z, gap)) return kept;
  }
  return null;
}

function nudge(r: Rect, zones: readonly Rect[], v: Rect, gap: number, sidewaysFirst: boolean): Rect {
  let out = keepInside(r, v, gap);
  for (let pass = 0; pass < 4; pass++) {
    const z = zones.find((zone) => zoneHit(out, zone, gap));
    if (!z) break;
    const moved = slideOut(out, z, v, gap, sidewaysFirst);
    if (!moved) break;
    out = moved;
  }
  return out;
}

/**
 * 0.8.9 (session 15's A5): the photo-menu panel's rectangle kept out of photo mode's own zones (its menu, its top bar, the
 * title row with its icon, its hint strips, measured in the game from the controller's widgets), as XFInkStyle.Avoid does:
 * the asked place when it is clear; else the panel slides out of each zone it meets along its anchor's own edge first
 * (sideways for a top or bottom anchor, so bottom_right goes left of the menu, not up over it), then the other way, up to
 * four zones; if it still meets one, the first free corner, the anchor's own side first; then kept inside the visible
 * screen, gap apart. `how` says which.
 */
export function avoidZones(panel: Rect, zones: readonly Rect[], visible: Rect, gap: number, anchor: string = "bottom_right"): Rect & { how: ZoneHow } {
  const asked = keepInside(panel, visible, gap);
  if (!zones.some((z) => zoneHit(asked, z, gap))) return { ...asked, how: "kept" };
  const sidewaysFirst = !anchor.startsWith("center");
  const nudged = nudge(asked, zones, visible, gap, sidewaysFirst);
  if (!zones.some((z) => zoneHit(nudged, z, gap))) return { ...nudged, how: "nudged" };
  const bottom = !anchor.startsWith("top"), right = !anchor.endsWith("left");
  const corners: { name: "top_left" | "top_right" | "bottom_left" | "bottom_right"; bottom: boolean; right: boolean }[] = [
    { name: `${bottom ? "bottom" : "top"}_${right ? "left" : "right"}`, bottom, right: !right },
    { name: `${bottom ? "top" : "bottom"}_${right ? "right" : "left"}`, bottom: !bottom, right },
    { name: `${bottom ? "top" : "bottom"}_${right ? "left" : "right"}`, bottom: !bottom, right: !right },
    { name: `${bottom ? "bottom" : "top"}_${right ? "right" : "left"}`, bottom, right },
  ];
  for (const c of corners) {
    const at: Rect = { x: c.right ? visible.x + visible.w - gap - panel.w : visible.x + gap, y: c.bottom ? visible.y + visible.h - gap - panel.h : visible.y + gap, w: panel.w, h: panel.h };
    const r = nudge(at, zones, visible, gap, true);
    if (!zones.some((z) => zoneHit(r, z, gap))) return { ...r, how: `corner:${c.name}` };
  }
  return { ...nudged, how: "overlapping" };
}
