/** Original 16px line icons for XF Studio. Stroked with currentColor; decorative unless labelled. */
type Shape = { d: string; fill?: boolean; dash?: string };
const s = (d: string): Shape => ({ d });
const f = (d: string): Shape => ({ d, fill: true });

const ICONS = {
  plus: [s("M8 3v10M3 8h10")],
  minus: [s("M3 8h10")],
  close: [s("M4 4l8 8M12 4l-8 8")],
  more: [f("M2.5 7h2v2h-2zM7 7h2v2H7zM11.5 7h2v2h-2z")],
  chevronDown: [s("M4 6l4 4 4-4")],
  chevronRight: [s("M6 4l4 4-4 4")],
  chevronLeft: [s("M10 4L6 8l4 4")],
  chevronUp: [s("M4 10l4-4 4 4")],
  arrowUp: [s("M8 13V3M4 7l4-4 4 4")],
  arrowDown: [s("M8 3v10M4 9l4 4 4-4")],
  undo: [s("M5.5 3.5l-3 3 3 3M2.5 6.5H9.5a3.5 3.5 0 0 1 0 7H6")],
  redo: [s("M10.5 3.5l3 3-3 3M13.5 6.5H6.5a3.5 3.5 0 0 0 0 7H10")],
  eye: [s("M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"), s("M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z")],
  eyeOff: [s("M1.5 8S4 3.5 8 3.5c1.3 0 2.4.4 3.4 1M14.5 8s-2.5 4.5-6.5 4.5c-1.3 0-2.4-.4-3.4-1"), s("M2.5 13.5l11-11")],
  duplicate: [s("M5.5 5.5h8v8h-8z"), s("M10.5 5.5v-3h-8v8h3")],
  trash: [s("M2.5 4.5h11M6 4.5v-2h4v2M4 4.5l.7 9h6.6l.7-9M6.5 7v4M9.5 7v4")],
  grip: [f("M5 3h2v2H5zM9 3h2v2H9zM5 7h2v2H5zM9 7h2v2H9zM5 11h2v2H5zM9 11h2v2H9z")],
  library: [s("M3 4.5c0-1 2.2-1.8 5-1.8s5 .8 5 1.8v7c0 1-2.2 1.8-5 1.8s-5-.8-5-1.8z"), s("M3 4.5c0 1 2.2 1.8 5 1.8s5-.8 5-1.8M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8")],
  save: [s("M2.5 2.5h8.5l2.5 2.5v8.5h-11z"), s("M5 2.5v3.5h5.5V2.5M5 13.5v-4h6v4")],
  package: [s("M2.5 5L8 2.5 13.5 5v6L8 13.5 2.5 11z"), s("M2.5 5L8 7.5 13.5 5M8 7.5v6")],
  check: [s("M3 8.5l3 3 7-7")],
  warning: [s("M8 2.5l6 11H2z"), s("M8 6.5v3.5M8 11.6v.5")],
  error: [s("M5.2 2h5.6L14 5.2v5.6L10.8 14H5.2L2 10.8V5.2z"), s("M6 6l4 4M10 6l-4 4")],
  info: [s("M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z"), s("M8 7v4.5M8 4.6v.6")],
  float: [s("M6.5 3.5h-4v10h10v-4"), s("M9 2.5h4.5V7M13.5 2.5L8 8")],
  dock: [s("M2.5 3h11v10h-11z"), s("M6.5 3v10")],
  maximize: [s("M3 3h10v10H3z")],
  restore: [s("M3 5.5h7.5V13H3z"), s("M5.5 5.5V3H13v7.5h-2.5")],
  sun: [s("M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"), s("M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4")],
  moon: [s("M12.5 10A5.5 5.5 0 0 1 6 3.5 5.5 5.5 0 1 0 12.5 10z")],
  monitor: [s("M2 3h12v8H2z"), s("M6 14h4M8 11v3")],
  layers: [s("M8 2.5l5.5 3L8 8.5 2.5 5.5z"), s("M2.5 8.5L8 11.5l5.5-3M2.5 11L8 14l5.5-3")],
  search: [s("M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.3 10.3l3.2 3.2")],
  command: [s("M2.5 3.5h11v9h-11z"), s("M5 6.5l2 1.5-2 1.5M8.5 10h2.5")],
  refresh: [s("M13 8a5 5 0 1 1-1.5-3.6"), s("M13 2.5v3h-3")],
  play: [f("M4.5 2.8L13 8l-8.5 5.2z")],
  pause: [f("M4 3h3v10H4zM9 3h3v10H9z")],
  front: [s("M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3z"), s("M8 1v3M8 12v3M1 8h3M12 8h3")],
  wire: [s("M2.5 2.5h11v11h-11z"), s("M2.5 8h11M8 2.5v11M2.5 2.5l11 11")],
  handles: [s("M2.5 12C4 5 12 5 13.5 12"), f("M1.5 11h2.2v2.2H1.5zM12.4 11h2.2v2.2h-2.2zM6.9 4.6h2.2v2.2H6.9z")],
  mirror: [{ d: "M8 1.5v13", dash: "1.5 1.5" }, s("M6 4L2 11h4zM10 4l4 7h-4z")],
  presets: [s("M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z")],
  finish: [s("M8 1.5l1.6 4.9L14.5 8l-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z")],
  shape: [s("M2.5 12.5C4.5 4 11.5 4 13.5 12.5"), s("M5.5 3.5h5"), f("M7 2.5h2v2H7zM1.5 11.5h2v2h-2zM12.5 11.5h2v2h-2z")],
  edge: [s("M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"), { d: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z", dash: "1.6 1.8" }],
  warp: [s("M2.5 12.5c3.5 0 4-8.5 9.5-8.5"), s("M9.5 2l2.5 2-2 2.5"), f("M1.5 11.5h2v2h-2z")],
  character: [s("M8 2.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"), s("M2.5 14c.5-3 2.8-4.5 5.5-4.5s5 1.5 5.5 4.5")],
  lighting: [s("M8 2a4 4 0 0 0-2.5 7.1V11h5V9.1A4 4 0 0 0 8 2z"), s("M6 13h4M6.5 14.8h3")],
  motion: [s("M1.5 8c1.6-3.5 3.2-3.5 4.3 0s2.7 3.5 4.4 0 2.7-3.5 4.3 0")],
  quality: [s("M2.5 2.5h11v11h-11z"), f("M2.5 2.5H8V8H2.5z"), s("M8 2.5v11M2.5 8h11")],
  activity: [s("M6 4h7.5M6 8h7.5M6 12h7.5"), f("M2.5 3h2v2h-2zM2.5 7h2v2h-2zM2.5 11h2v2h-2z")],
  uv: [s("M2.5 2.5h11v11h-11z"), s("M2.5 10.5c3-1 4-5 11-6")],
  head: [s("M8 1.8c-3 0-4.8 2.2-4.8 5.1 0 2 .9 3.3 1.8 4.2V14h6v-2.9c.9-.9 1.8-2.2 1.8-4.2 0-2.9-1.8-5.1-4.8-5.1z"), s("M6 7.3h.2M9.8 7.3h.2")],
  import: [s("M8 2v8M5 7l3 3 3-3"), s("M2.5 10.5v3h11v-3")],
  export: [s("M8 10V2M5 5l3-3 3 3"), s("M2.5 10.5v3h11v-3")],
  keyboard: [s("M1.5 4h13v8h-13z"), s("M4 6.5h.5M7 6.5h.5M10 6.5h.5M12 6.5h.5M4.5 9.5h7")],
  help: [s("M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z"), s("M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4M8 11.5v.5")],
  target: [s("M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"), f("M7 7h2v2H7z")],
  rename: [s("M2.5 13.5h3l7.5-7.5-3-3-7.5 7.5z"), s("M9 4l3 3")],
  reset: [s("M3 8a5 5 0 1 0 1.5-3.6"), s("M3 2.5v3h3")],
  layout: [s("M2 2.5h12v11H2z"), s("M6 2.5v11M6 8h8")],
  category: [s("M2.5 2.5h4.5v11H2.5z"), s("M9 2.5h4.5v4.5H9zM9 9h4.5v4.5H9z")],
  dot: [f("M5.5 5.5h5v5h-5z")],
} satisfies Record<string, Shape[]>;
export type IconName = keyof typeof ICONS;

const NS = "http://www.w3.org/2000/svg";
export function icon(name: IconName, label?: string): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "icon");
  if (label) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", label); }
  else svg.setAttribute("aria-hidden", "true");
  for (const shape of ICONS[name] as Shape[]) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", shape.d);
    if (shape.fill) { path.setAttribute("fill", "currentColor"); path.setAttribute("stroke", "none"); }
    if (shape.dash) path.setAttribute("stroke-dasharray", shape.dash);
    svg.append(path);
  }
  return svg;
}
export const iconNames = Object.keys(ICONS) as IconName[];
/** Static SVG markup for the self-contained style guide. */
export function iconMarkup(name: IconName) {
  return `<svg viewBox="0 0 16 16" class="icon" aria-hidden="true">${(ICONS[name] as Shape[]).map(shape =>
    `<path d="${shape.d}"${shape.fill ? ' fill="currentColor" stroke="none"' : ""}${shape.dash ? ` stroke-dasharray="${shape.dash}"` : ""}/>`).join("")}</svg>`;
}
