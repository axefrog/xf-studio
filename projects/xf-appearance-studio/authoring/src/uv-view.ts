import { clamp, curve, type Layer } from "./recipe";

export type UV = { u: number; v: number };
export type UVView = { mode: "both" | "single"; side: "low" | "high"; u: number; v: number; span: number };
export type UVRegion = { u: number; v: number; w: number; h: number };
export const defaultUVView = (): UVView => ({ mode: "both", side: "low", u: .5, v: .2775, span: .5 });
export function parseUVView(value: unknown): UVView {
  const v = value as UVView;
  if (!v || !["both", "single"].includes(v.mode) || !["low", "high"].includes(v.side) ||
      ![v.u, v.v, v.span].every(Number.isFinite) || v.u < -.25 || v.u > 1.25 || v.v < -.25 || v.v > 1.25 || v.span < .02 || v.span > 2)
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

/** View fitting never mutates the authored shape. Keep this crop fixed during a drag. */
export function fitUVView(view: UVView, layer?: Layer): UVView {
  const fallback = { ...view, u: view.mode === "both" ? .5 : view.side === "low" ? .375 : .625, v: .2775,
    span: view.mode === "both" ? .5 : .25 };
  if (!layer) return fallback;
  const path = [...curve(layer.points), ...layer.points,
    ...layer.fields.flatMap(f => [f, { u: f.u + f.du, v: f.v + f.dv }])];
  let positions = (layer.symmetry ? [false, true] : [false]).flatMap(mirror => path.map(p => reflectUV(p, mirror)));
  if (view.mode === "single") positions = positions.filter(p => view.side === "low" ? p.u <= .5 : p.u >= .5);
  if (!positions.length) return fallback;
  const minU = Math.min(...positions.map(p => p.u)), maxU = Math.max(...positions.map(p => p.u)),
    minV = Math.min(...positions.map(p => p.v)), maxV = Math.max(...positions.map(p => p.v));
  // Fields and spline overshoot can legitimately extend beyond the atlas edges.
  return { ...view, u: clamp((minU + maxU) / 2, -.25, 1.25), v: clamp((minV + maxV) / 2, -.25, 1.25),
    span: clamp(Math.max(maxU - minU, (maxV - minV) * uvAspect(view.mode)) * 1.25, .04, 2) };
}
