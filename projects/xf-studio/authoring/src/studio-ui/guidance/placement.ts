import type { AnchorRect } from "./anchors";
import type { Side } from "./types";

/**
 * Where the tour callout goes, as a pure function of the lit rectangle, the callout's size and
 * the window. It sits beside the target when a side has room, otherwise inside the target's
 * corner, and at narrow widths as a sheet above or below it. It is always inside the window
 * and never moves anything else (the callout is a fixed overlay).
 */
export type CalloutPlacement = Readonly<{ x: number; y: number; side: Side | "center" | "inside" | "sheet" }>;
export const NARROW_WIDTH = 560;
const clampTo = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function placeCallout(target: AnchorRect | undefined, size: { w: number; h: number }, viewport: { w: number; h: number },
  preferred: "auto" | Side = "auto", gap = 12, margin = 12): CalloutPlacement {
  const maxX = Math.max(margin, viewport.w - size.w - margin), maxY = Math.max(margin, viewport.h - size.h - margin);
  if (!target) return { x: clampTo((viewport.w - size.w) / 2, margin, maxX), y: clampTo((viewport.h - size.h) / 2, margin, maxY), side: "center" };
  if (viewport.w < NARROW_WIDTH) {
    // A sheet on whichever side of the target has more room.
    const above = target.y, below = viewport.h - (target.y + target.h);
    return { x: clampTo((viewport.w - size.w) / 2, margin, maxX), y: below >= above ? maxY : margin, side: "sheet" };
  }
  const room: Record<Side, boolean> = {
    right: viewport.w - (target.x + target.w) - gap >= size.w + margin,
    left: target.x - gap >= size.w + margin,
    bottom: viewport.h - (target.y + target.h) - gap >= size.h + margin,
    top: target.y - gap >= size.h + margin,
  };
  const order: Side[] = ["right", "left", "bottom", "top"];
  const side = preferred !== "auto" && room[preferred] ? preferred : order.find(item => room[item]);
  const cx = target.x + target.w / 2 - size.w / 2, cy = target.y + target.h / 2 - size.h / 2;
  switch (side) {
    case "right": return { x: target.x + target.w + gap, y: clampTo(cy, margin, maxY), side };
    case "left": return { x: target.x - gap - size.w, y: clampTo(cy, margin, maxY), side };
    case "bottom": return { x: clampTo(cx, margin, maxX), y: target.y + target.h + gap, side };
    case "top": return { x: clampTo(cx, margin, maxX), y: target.y - gap - size.h, side };
    default:
      // The target fills most of the window (a large viewport panel): sit in its lower-right corner.
      return { x: clampTo(target.x + target.w - size.w - gap, margin, maxX), y: clampTo(target.y + target.h - size.h - gap, margin, maxY), side: "inside" };
  }
}
