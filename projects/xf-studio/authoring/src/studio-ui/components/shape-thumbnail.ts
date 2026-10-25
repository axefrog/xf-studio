/**
 * Shape thumbnail (style guide "Shape thumbnail", feature-specific): a small drawing of a contour: its outline over faint guide lines
 * (for eye makeup, the eye's lash line and crease), so a list of shapes can be told apart at a glance. It draws plain UV geometry it is
 * given and knows nothing of layers or features. Decorative: the row it sits in names the shape.
 */
export type ThumbnailPoint = { readonly u: number; readonly v: number };
export type ShapeThumbnailOptions = {
  /** The shape's outline: a closed polygon, in the same coordinates as the window. */
  outline: readonly ThumbnailPoint[];
  /** Faint guide curves under the outline: open polylines (the lash line, the crease). */
  guides?: readonly (readonly ThumbnailPoint[])[];
  /** The rectangle the thumbnail shows (v grows downward, as in the head UV). */
  window: { readonly u0: number; readonly u1: number; readonly v0: number; readonly v1: number };
  /** Pixel size; default 44 × 24. */
  width?: number; height?: number;
};

const NS = "http://www.w3.org/2000/svg";
export function shapeThumbnail(options: ShapeThumbnailOptions): SVGSVGElement {
  const { window: area, outline, guides = [] } = options, width = options.width ?? 44, height = options.height ?? 24;
  const x = (u: number) => ((u - area.u0) / (area.u1 - area.u0) * width).toFixed(2), y = (v: number) => ((v - area.v0) / (area.v1 - area.v0) * height).toFixed(2);
  const path = (points: readonly ThumbnailPoint[], close: boolean) => `${points.map((p, i) => `${i ? "L" : "M"}${x(p.u)} ${y(p.v)}`).join("")}${close ? "Z" : ""}`;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "shape-thumb"); svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width)); svg.setAttribute("height", String(height));
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false"); svg.setAttribute("overflow", "hidden");
  const draw = (className: string, d: string) => { const element = document.createElementNS(NS, "path"); element.setAttribute("class", className); element.setAttribute("d", d); svg.append(element); };
  for (const guide of guides) if (guide.length > 1) draw("shape-thumb-guide", path(guide, false));
  if (outline.length > 2) draw("shape-thumb-outline", path(outline, true));
  return svg;
}
