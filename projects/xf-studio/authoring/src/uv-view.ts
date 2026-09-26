import { clamp, curve, type Layer } from "./engines/layered-makeup/recipe";
import { tangentEndpoint } from "./engines/layered-makeup/bezier-path";
import { mirrored as mirrorPoint, type Mirror } from "./engines/layered-makeup/region";

export type UV = { u: number; v: number };
/**
 * Persistent UV view: a frame `span` UV units wide and `span / frameAspect(view)` tall, centred at
 * (u, v), that is always fully visible. The viewport scales the frame uniformly to fit the pane's
 * safe area and shows whatever else of the atlas fits around it, so the canvas can fill any panel.
 * `aspect` is optional: views saved before it existed use the mode's historical box proportions,
 * which keeps every stored view showing the same content it did when the canvas was that box.
 */
export type UVView = { mode: "both" | "single"; side: "low" | "high"; u: number; v: number; span: number; aspect?: number };
export type UVRegion = { u: number; v: number; w: number; h: number };
/** CSS-pixel margins the frame keeps clear of (for example the hint overlay); the canvas still draws there. */
export type UVInsets = { top: number; right: number; bottom: number; left: number };
export const NO_UV_INSETS: UVInsets = { top: 0, right: 0, bottom: 0, left: 0 };
// Knots remain in [0,1], while relative Bézier arms may reach [-1,2].
// Ten UV units span the full legal range with padding at any pane shape.
export const MAX_UV_VIEW_SPAN = 10;
export const MIN_UV_VIEW_SPAN = .02;
/** Frame proportions stay within 1:10 either way, so a line-shaped fit still has context. */
export const MIN_UV_FRAME_ASPECT = .1, MAX_UV_FRAME_ASPECT = 10;
export const defaultUVView = (): UVView => ({ mode: "both", side: "low", u: .5, v: .2775, span: .5 });
/** Historical canvas box proportions per mode; now only the default frame shape. */
export const uvAspect = (mode: UVView["mode"]) => mode === "both" ? 720 / 310 : 720 / 520;
export const frameAspect = (view: UVView) => view.aspect ?? uvAspect(view.mode);
/** The larger side of the frame; zoom limits apply to it. */
const frameExtent = (view: UVView) => Math.max(view.span, view.span / frameAspect(view));
export function parseUVView(value: unknown): UVView {
  const v = value as UVView;
  const aspectOk = v?.aspect === undefined || (Number.isFinite(v.aspect) && v.aspect >= MIN_UV_FRAME_ASPECT && v.aspect <= MAX_UV_FRAME_ASPECT);
  if (!v || !["both", "single"].includes(v.mode) || !["low", "high"].includes(v.side) || !aspectOk ||
      ![v.u, v.v, v.span].every(Number.isFinite) || v.u < -1 || v.u > 2 || v.v < -1 || v.v > 2 || v.span <= 0 ||
      frameExtent(v) < MIN_UV_VIEW_SPAN - 1e-12 || frameExtent(v) > MAX_UV_VIEW_SPAN + 1e-9)
    return defaultUVView();
  return { mode: v.mode, side: v.side, u: v.u, v: v.v, span: v.span, ...(v.aspect === undefined ? {} : { aspect: v.aspect }) };
}
/** Pane geometry in CSS pixels. Insets are clamped so the safe area never drops below half the pane. */
export function uvViewScale(view: UVView, width: number, height: number, insets: UVInsets = NO_UV_INSETS) {
  const w = Number.isFinite(width) && width > 0 ? width : 1, h = Number.isFinite(height) && height > 0 ? height : 1;
  const fit = (a: number, b: number, size: number) => {
    const x = Math.max(0, Number.isFinite(a) ? a : 0), y = Math.max(0, Number.isFinite(b) ? b : 0);
    const k = x + y > size / 2 ? size / 2 / (x + y) : 1;
    return [x * k, y * k];
  };
  const [left, right] = fit(insets.left, insets.right, w), [top, bottom] = fit(insets.top, insets.bottom, h);
  const safeW = w - left - right, safeH = h - top - bottom;
  // Pixels per UV unit: the whole frame fits the safe area.
  const scale = Math.min(safeW / view.span, safeH * frameAspect(view) / view.span);
  return { width: w, height: h, scale, cx: left + safeW / 2, cy: top + safeH / 2 };
}
/** The UV rectangle the whole pane shows. Uniform scale: one UV unit is the same length both ways. */
export function uvViewRegion(view: UVView, width: number, height: number, insets: UVInsets = NO_UV_INSETS): UVRegion {
  const s = uvViewScale(view, width, height, insets);
  return { u: view.u - s.cx / s.scale, v: view.v - s.cy / s.scale, w: s.width / s.scale, h: s.height / s.scale };
}
/** Region for a pane of the given aspect with no insets; the frame itself when the aspects match. */
export const uvRegion = (view: UVView, aspect = frameAspect(view)): UVRegion =>
  uvViewRegion(view, Number.isFinite(aspect) && aspect > 0 ? aspect : frameAspect(view), 1);
/** `p`, or its mirrored instance across the region's mirror line (a symmetric layer draws both; CORE-82). */
export const reflectUV = (p: UV, mirrored: boolean, across: Mirror): UV => {
  if (!mirrored) return p;
  const [u, v] = mirrorPoint(across)(p.u, p.v);
  return { u, v };
};
/** Which side of the mirror line a point is on: its coordinate across the line, measured from the line. */
const acrossLine = (p: UV, mirror: Mirror) => (mirror.axis === "u" ? p.u : p.v) - mirror.centre;
export const uvToPixel = (p: UV, region: UVRegion, width: number, height: number) =>
  ({ x: (p.u - region.u) / region.w * width, y: (p.v - region.v) / region.h * height });
export const pixelToUV = (p: { x: number; y: number }, region: UVRegion, width: number, height: number): UV =>
  ({ u: region.u + p.x / width * region.w, v: region.v + p.y / height * region.h });

/** Positive factor >1 zooms in around the supplied atlas coordinate. */
export function zoomUVView(view: UVView, anchor: UV, factor: number): UVView {
  if (![anchor.u, anchor.v, factor].every(Number.isFinite) || factor <= 0) return { ...view };
  const extent = frameExtent(view), ratio = clamp(extent / factor, MIN_UV_VIEW_SPAN, MAX_UV_VIEW_SPAN) / extent;
  return { ...view, span: view.span * ratio, u: clamp(anchor.u + (view.u - anchor.u) * ratio, -1, 2),
    v: clamp(anchor.v + (view.v - anchor.v) * ratio, -1, 2) };
}
/** View offsets are atlas units; no authored geometry or aspect is changed. */
export function panUVView(view: UVView, du: number, dv: number): UVView {
  if (![du, dv].every(Number.isFinite)) return { ...view };
  return { ...view, u: clamp(view.u + du, -1, 2), v: clamp(view.v + dv, -1, 2) };
}

/** Fit margin: the fitted content fills 80% of the frame's limiting side. */
const FIT_MARGIN = 1.25, FIT_MIN_SIZE = .04;
/** Frame of the given size, widened or heightened to stay within the aspect limits. */
function frameView(view: UVView, u: number, v: number, width: number, height: number): UVView {
  let w = Math.max(width, FIT_MIN_SIZE), h = Math.max(height, FIT_MIN_SIZE);
  if (w / h > MAX_UV_FRAME_ASPECT) h = w / MAX_UV_FRAME_ASPECT;
  if (w / h < MIN_UV_FRAME_ASPECT) w = h * MIN_UV_FRAME_ASPECT;
  const k = Math.max(w, h) > MAX_UV_VIEW_SPAN ? MAX_UV_VIEW_SPAN / Math.max(w, h) : 1;
  return { ...view, u: clamp(u, -1, 2), v: clamp(v, -1, 2), span: w * k, aspect: w / h };
}

/**
 * View fitting never mutates the authored shape. Keep this crop fixed during a drag. The frame is
 * the content's bounds plus a margin, so the content fills the pane (minus its safe insets) whatever
 * the pane's shape: a single eye fills the pane, and both eyes fill it side by side.
 */
export function fitUVView(view: UVView, layer: Layer | undefined, mirror: Mirror): UVView {
  const fallback = view.mode === "both" ? frameView(view, .5, .2775, .5, .5 / uvAspect("both"))
    : frameView(view, view.side === "low" ? .375 : .625, .2775, .25, .25 / uvAspect("single"));
  if (!layer) return fallback;
  const path: { p: UV; owner: UV }[] = [...curve(layer.points), ...layer.points].map(p => ({ p, owner: p }));
  if (layer.pathMode === "bezier") for (const p of layer.points) if (p.handles)
    path.push({ p: tangentEndpoint(p, "in"), owner: p }, { p: tangentEndpoint(p, "out"), owner: p });
  for (const f of layer.fields) path.push({ p: f, owner: f }, { p: { u: f.u + f.du, v: f.v + f.dv }, owner: f });
  // Classify controls by their knot/origin, never by the far endpoint: an arm
  // that crosses the atlas centre must still be reachable in its owner's view.
  // One side is the region's mirror line's low or high side (eye makeup's: u = ½, one eye each).
  const positions = (layer.symmetry ? [false, true] : [false]).flatMap(mirrored => path
    .filter(({ owner }) => view.mode === "both" || (view.side === "low" ? acrossLine(reflectUV(owner, mirrored, mirror), mirror) <= 0
      : acrossLine(reflectUV(owner, mirrored, mirror), mirror) >= 0))
    .map(({ p }) => reflectUV(p, mirrored, mirror)));
  if (!positions.length) return fallback;
  const minU = Math.min(...positions.map(p => p.u)), maxU = Math.max(...positions.map(p => p.u)),
    minV = Math.min(...positions.map(p => p.v)), maxV = Math.max(...positions.map(p => p.v));
  // Fields and spline overshoot can legitimately extend beyond the atlas edges.
  return frameView(view, (minU + maxU) / 2, (minV + maxV) / 2, (maxU - minU) * FIT_MARGIN, (maxV - minV) * FIT_MARGIN);
}

/** Whether the selected point and warp origin are inside the visible UV region (audit A-13). */
export type UVSelectionVisibility = { point?: { index: number; visible: boolean }; field?: { id: string; visible: boolean } };
/** `shown` is the region the pane displays (`uvViewRegion`), or a pane aspect for an inset-free pane. */
export function selectionVisibility(view: UVView, shown: UVRegion | number, layer: {
  symmetry: boolean; points: readonly UV[]; fields: readonly (UV & { id: string })[] },
  selected: number, fieldId: string | undefined, mirror: Mirror): UVSelectionVisibility {
  const r = typeof shown === "number" ? uvRegion(view, shown) : shown;
  // A mirrored layer is visible when either drawn instance is inside the view.
  const visible = (p: UV) => (layer.symmetry ? [false, true] : [false]).some(mirrored => {
    const q = reflectUV(p, mirrored, mirror);
    return q.u >= r.u && q.u <= r.u + r.w && q.v >= r.v && q.v <= r.v + r.h;
  });
  const point = layer.points[selected], field = layer.fields.find(item => item.id === fieldId);
  return { ...(point ? { point: { index: selected, visible: visible(point) } } : {}),
    ...(field ? { field: { id: field.id, visible: visible(field) } } : {}) };
}
