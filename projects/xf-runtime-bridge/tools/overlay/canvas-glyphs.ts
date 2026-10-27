// Studio's original path data, flattened offline. No browser, rasterizer or render-time path parsing.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// Runtime-only import: this tool consumes path data, never the browser icon() function.
const { iconMarkup, isIconName }: { iconMarkup: (name: string) => string; isIconName: (name: string) => boolean } = require("../../../xf-studio/authoring/src/studio-ui/icons");

type Point = [number, number];
export type Path = { points: Point[]; fill: boolean; closed: boolean; alpha: number };
const TOLERANCE = 0.08; // in Studio's 16-unit icon box; at 24 px this is 0.12 px
const mix = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const distance = (p: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return Math.hypot(dx, dy) < 1e-12 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.hypot(dx, dy);
};
function cubic(a: Point, b: Point, c: Point, d: Point, out: Point[], depth = 0) {
  if (depth >= 16 || Math.max(distance(b, a, d), distance(c, a, d)) <= TOLERANCE) { out.push(d); return; }
  const ab = mix(a, b, .5), bc = mix(b, c, .5), cd = mix(c, d, .5), abc = mix(ab, bc, .5), bcd = mix(bc, cd, .5), mid = mix(abc, bcd, .5);
  cubic(a, ab, abc, mid, out, depth + 1); cubic(mid, bcd, cd, d, out, depth + 1);
}
/** SVG 2 Appendix B.2 endpoint arcs: https://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes */
function arc(a: Point, rx: number, ry: number, rotation: number, large: number, sweep: number, b: Point, out: Point[]) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry || (a[0] === b[0] && a[1] === b[1])) { out.push(b); return; }
  const phi = rotation * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const xp = cos * (a[0] - b[0]) / 2 + sin * (a[1] - b[1]) / 2, yp = -sin * (a[0] - b[0]) / 2 + cos * (a[1] - b[1]) / 2;
  const scale = Math.sqrt(xp * xp / (rx * rx) + yp * yp / (ry * ry)); if (scale > 1) { rx *= scale; ry *= scale; }
  const numerator = Math.max(0, rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp);
  const k = (large === sweep ? -1 : 1) * Math.sqrt(numerator / Math.max(1e-30, rx * rx * yp * yp + ry * ry * xp * xp));
  const cxp = k * rx * yp / ry, cyp = -k * ry * xp / rx;
  const cx = cos * cxp - sin * cyp + (a[0] + b[0]) / 2, cy = sin * cxp + cos * cyp + (a[1] + b[1]) / 2;
  const theta = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx);
  let delta = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx) - theta;
  if (sweep && delta < 0) delta += Math.PI * 2; if (!sweep && delta > 0) delta -= Math.PI * 2;
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / (2 * Math.acos(Math.max(-1, 1 - TOLERANCE / Math.max(rx, ry))))));
  if (steps > 4096) throw new Error("SVG arc exceeds bounded flattening work");
  for (let i = 1; i <= steps; i++) { const t = theta + delta * i / steps; out.push([cx + cos * rx * Math.cos(t) - sin * ry * Math.sin(t), cy + sin * rx * Math.cos(t) + cos * ry * Math.sin(t)]); }
  out[out.length - 1] = b;
}
export function flatten(d: string): { points: Point[]; closed: boolean }[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/g) ?? [];
  let at = 0, command = "", previous = "", point: Point = [0, 0], start: Point = [0, 0], control: Point = [0, 0];
  let path: { points: Point[]; closed: boolean } = { points: [], closed: false }; const paths: typeof path[] = [];
  const number = () => { const token = tokens[at++]; if (!token || /^[a-df-z]$/i.test(token)) throw new Error(`Bad SVG path ${d}`); const n = Number(token); if (!Number.isFinite(n)) throw new Error("Nonfinite SVG"); return n; };
  while (at < tokens.length) {
    if (/^[a-z]$/i.test(tokens[at]!)) command = tokens[at++]!;
    if (!command) throw new Error("Missing SVG command");
    const upper = command.toUpperCase(), relative = command !== upper;
    const read = (): Point => { const p: Point = [number(), number()]; return relative ? [p[0] + point[0], p[1] + point[1]] : p; };
    if (upper === "Z") { path.closed = true; point = start; command = ""; previous = "Z"; continue; }
    if (upper === "M") { point = read(); start = point; path = { points: [point], closed: false }; paths.push(path); command = relative ? "l" : "L"; }
    else if (upper === "L" || upper === "H" || upper === "V") {
      point = upper === "L" ? read() : upper === "H" ? [number() + (relative ? point[0] : 0), point[1]] : [point[0], number() + (relative ? point[1] : 0)]; path.points.push(point);
    } else if (upper === "C" || upper === "S") {
      const b: Point = upper === "C" ? read() : [point[0] * 2 - (previous === "C" || previous === "S" ? control[0] : point[0]), point[1] * 2 - (previous === "C" || previous === "S" ? control[1] : point[1])];
      const c = read(), end = read(); cubic(point, b, c, end, path.points); control = c; point = end;
    } else if (upper === "Q" || upper === "T") {
      const c: Point = upper === "Q" ? read() : [point[0] * 2 - (previous === "Q" || previous === "T" ? control[0] : point[0]), point[1] * 2 - (previous === "Q" || previous === "T" ? control[1] : point[1])];
      const end = read(); cubic(point, mix(point, c, 2 / 3), mix(end, c, 2 / 3), end, path.points); control = c; point = end;
    } else if (upper === "A") { const rx = number(), ry = number(), rotation = number(), large = number(), sweep = number(), end = read(); arc(point, rx, ry, rotation, large, sweep, end, path.points); point = end; }
    else throw new Error(`Unsupported SVG command ${command}`);
    previous = upper;
    if (path.points.length > 4096) throw new Error("SVG flattening exceeded bound");
  }
  return paths;
}
function dashPath(points: Point[], dash: number[], closed: boolean): Point[][] {
  if (!dash.length || dash.some(x => !Number.isFinite(x) || x <= 0)) throw new Error("Bad icon dash");
  let phase = 0, remaining = dash[0]!; const out: Point[][] = [];
  const ps = closed ? [...points, points[0]!] : points;
  for (let i = 1; i < ps.length; i++) { let a = ps[i - 1]!; const b = ps[i]!; let length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (length > 1e-8) { const step = Math.min(length, remaining), end = mix(a, b, step / length); if (phase % 2 === 0) out.push([a, end]); a = end; length -= step; remaining -= step;
      if (remaining < 1e-8) { phase = (phase + 1) % dash.length; remaining = dash[phase]!; } }
  } return out;
}
export function glyphPaths(name: string): Path[] | null {
  if (!isIconName(name)) return null;
  return [...iconMarkup(name).matchAll(/<path\b([^>]*)\/>/g)].flatMap(match => {
    const attrs = new Map([...match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1]!, m[2]!]));
    const fill = attrs.get("fill") === "currentColor", alpha = Number(attrs.get("stroke-opacity") ?? 1);
    return flatten(attrs.get("d")!).flatMap(path => attrs.has("stroke-dasharray") && !fill
      ? dashPath(path.points, attrs.get("stroke-dasharray")!.split(/[ ,]+/).map(Number), path.closed).map(points => ({ points, closed: false, fill, alpha }))
      : [{ ...path, fill, alpha }]);
  });
}
export function vocabulary(text = readFileSync(resolve(import.meta.dir, "../../../../research/live-world-view/glyphs.md"), "utf8")): string[] {
  const section = text.split("## The vocabulary (version 1)")[1]?.split("## Design rules")[0] ?? "";
  return [...new Set([...section.slice(section.indexOf("| Family")).matchAll(/`([a-z][a-z0-9-]*)`/g)].map(m => m[1]!))].sort();
}
export function glyphTable(): string {
  const lines = ["// GENERATED by tools/overlay/theme.ts from Studio icons.ts and Holotable's glyph vocabulary. Do not edit."];
  for (const name of vocabulary()) {
    const paths = glyphPaths(name);
    if (!paths) { lines.push(`XF_CANVAS_MISSING("${name}")`); continue; }
    const count = paths.reduce((n, p) => n + p.points.length, 0); if (count > 256) throw new Error(`Canvas glyph ${name}: ${count} vertices exceeds 256`);
    const num = (x: number) => Number(x.toFixed(5)).toString();
    const data = paths.map(p => `{${p.fill}, ${p.closed}, ${num(p.alpha)}, {${p.points.map(q => `{${q.map(num).join(", ")}}`).join(", ")}}}`).join(", ");
    lines.push(`XF_CANVAS_GLYPH("${name}", ${count}, {${data}})`);
  }
  return lines.join("\n") + "\n";
}
