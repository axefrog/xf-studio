import { clamp, curve, type Layer } from "./recipe";
import { tangentEndpoint } from "./bezier-path";

export type UV = { u: number; v: number };
export type UVView = { mode: "both" | "single"; side: "low" | "high"; u: number; v: number; span: number };
export type UVRegion = { u: number; v: number; w: number; h: number };
// Knots remain in [0,1], while relative Bézier arms may reach [-1,2].
// Ten UV units span the full legal height with padding at the widest pane aspect.
export const MAX_UV_VIEW_SPAN = 10;
export const defaultUVView = (): UVView => ({ mode: "both", side: "low", u: .5, v: .2775, span: .5 });
export function parseUVView(value: unknown): UVView {
  const v = value as UVView;
  if (!v || !["both", "single"].includes(v.mode) || !["low", "high"].includes(v.side) ||
      ![v.u, v.v, v.span].every(Number.isFinite) || v.u < -1 || v.u > 2 || v.v < -1 || v.v > 2 || v.span < .02 || v.span > MAX_UV_VIEW_SPAN)
    return defaultUVView();
  return { mode: v.mode, side: v.side, u: v.u, v: v.v, span: v.span };
}
export const uvAspect = (mode: UVView["mode"]) => mode === "both" ? 720 / 310 : 720 / 520;
export function uvRegion(view: UVView, aspect = uvAspect(view.mode)): UVRegion {
  const h = view.span / aspect;
  return { u: view.u - view.span / 2, v: view.v - h / 2, w: view.span, h };
}
export const reflectUV = (p: UV, mirror: boolean): UV => ({ u: mirror ? 1 - p.u : p.u, v: p.v });
export const uvToPixel = (p: UV, region: UVRegion, width: number, height: number) =>
  ({ x: (p.u - region.u) / region.w * width, y: (p.v - region.v) / region.h * height });
export const pixelToUV = (p: { x: number; y: number }, region: UVRegion, width: number, height: number): UV =>
  ({ u: region.u + p.x / width * region.w, v: region.v + p.y / height * region.h });

/** Positive factor >1 zooms in around the supplied atlas coordinate. */
export function zoomUVView(view: UVView, anchor: UV, factor: number): UVView {
  if (![anchor.u, anchor.v, factor].every(Number.isFinite) || factor <= 0) return { ...view };
  const span = clamp(view.span / factor, .02, MAX_UV_VIEW_SPAN), ratio = span / view.span;
  return { ...view, span, u: clamp(anchor.u + (view.u - anchor.u) * ratio, -1, 2),
    v: clamp(anchor.v + (view.v - anchor.v) * ratio, -1, 2) };
}
/** View offsets are atlas units; no authored geometry or aspect is changed. */
export function panUVView(view: UVView, du: number, dv: number): UVView {
  if (![du, dv].every(Number.isFinite)) return { ...view };
  return { ...view, u: clamp(view.u + du, -1, 2), v: clamp(view.v + dv, -1, 2) };
}

/** View fitting never mutates the authored shape. Keep this crop fixed during a drag. */
export function fitUVView(view: UVView, layer?: Layer): UVView {
  const fallback = { ...view, u: view.mode === "both" ? .5 : view.side === "low" ? .375 : .625, v: .2775,
    span: view.mode === "both" ? .5 : .25 };
  if (!layer) return fallback;
  const path: { p: UV; owner: UV }[] = [...curve(layer.points), ...layer.points].map(p => ({ p, owner: p }));
  if (layer.pathMode === "bezier") for (const p of layer.points) if (p.handles)
    path.push({ p: tangentEndpoint(p, "in"), owner: p }, { p: tangentEndpoint(p, "out"), owner: p });
  for (const f of layer.fields) path.push({ p: f, owner: f }, { p: { u: f.u + f.du, v: f.v + f.dv }, owner: f });
  // Classify controls by their knot/origin, never by the far endpoint: an arm
  // that crosses the atlas centre must still be reachable in its owner's view.
  const positions = (layer.symmetry ? [false, true] : [false]).flatMap(mirror => path
    .filter(({ owner }) => view.mode === "both" || (view.side === "low" ? reflectUV(owner, mirror).u <= .5 : reflectUV(owner, mirror).u >= .5))
    .map(({ p }) => reflectUV(p, mirror)));
  if (!positions.length) return fallback;
  const minU = Math.min(...positions.map(p => p.u)), maxU = Math.max(...positions.map(p => p.u)),
    minV = Math.min(...positions.map(p => p.v)), maxV = Math.max(...positions.map(p => p.v));
  // Fields and spline overshoot can legitimately extend beyond the atlas edges.
  return { ...view, u: clamp((minU + maxU) / 2, -1, 2), v: clamp((minV + maxV) / 2, -1, 2),
    span: clamp(Math.max(maxU - minU, (maxV - minV) * uvAspect(view.mode)) * 1.25, .04, MAX_UV_VIEW_SPAN) };
}

/** Whether the selected point and warp origin are inside the visible UV region (audit A-13). */
export type UVSelectionVisibility = { point?: { index: number; visible: boolean }; field?: { id: string; visible: boolean } };
export function selectionVisibility(view: UVView, aspect: number, layer: {
  symmetry: boolean; points: readonly UV[]; fields: readonly (UV & { id: string })[] },
  selected: number, fieldId?: string): UVSelectionVisibility {
  const r = uvRegion(view, Number.isFinite(aspect) && aspect > 0 ? aspect : uvAspect(view.mode));
  // A mirrored layer is visible when either drawn instance is inside the view.
  const visible = (p: UV) => (layer.symmetry ? [false, true] : [false]).some(mirror => {
    const q = reflectUV(p, mirror);
    return q.u >= r.u && q.u <= r.u + r.w && q.v >= r.v && q.v <= r.v + r.h;
  });
  const point = layer.points[selected], field = layer.fields.find(item => item.id === fieldId);
  return { ...(point ? { point: { index: selected, visible: visible(point) } } : {}),
    ...(field ? { field: { id: field.id, visible: visible(field) } } : {}) };
}
