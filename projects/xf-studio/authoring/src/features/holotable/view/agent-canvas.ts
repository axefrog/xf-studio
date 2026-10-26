/** Canvas interpreter of the service's versioned projection table. Geometry and picking share a draw list. */
import type { AgentAnswer, AgentAnchor, AgentItem } from "../agent-types";
import type { Vec3 } from "../types";
import type { camera } from "./projection";
import { actorCaption, labelContext, labelPriority, placeLabels, type AgentLabel, type LabelBounds, type PlacedLabel } from "./agent-labels";

import { agentInRange } from "./agent-bounds";

type Camera = ReturnType<typeof camera>;
type XY = readonly [number, number];
export function agentCanvas(canvas: HTMLCanvasElement, changed: () => void) {
  const context = canvas.getContext("2d"); if (!context) throw Error("Canvas 2D is unavailable for Agent layers.");
  const ctx = context;
  const labels = document.createElement("canvas"); labels.style.cssText = canvas.style.cssText; labels.setAttribute("aria-hidden", "true"); canvas.after(labels);
  const text = labels.getContext("2d")!;
  let candidates: AgentLabel[] = [], labelsPainted = false, previousHover: string | null = null;
  let overlayLabels: PlacedLabel[] = [], previousOverlay = "";
  let badges: LabelBounds[] = [];
  const swatches = new Map<string, HTMLElement>();
  let palette: Record<string, string> = {}, hits: { key: string; points: XY[]; fill: boolean; priority: number }[] = [];
  const invalidate = () => { palette = {}; previous = undefined; changed(); }, theme = new MutationObserver(invalidate);
  for (const root of [document.documentElement, document.body]) theme.observe(root, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
  const media = matchMedia("(prefers-color-scheme: dark)"); media.addEventListener("change", invalidate);
  let previous: AgentAnswer | undefined, previousEnabled: Readonly<Record<string, boolean>> | undefined, previousCamera = "", previousSelection: string | null = null, cursor = 0, fieldCell = 0;
  const path = (ps: readonly XY[], closed = false) => { if (!ps.length) return; ctx.moveTo(...ps[0]); for (let i = 1; i < ps.length; i++) ctx.lineTo(...ps[i]); if (closed) ctx.closePath(); };
  function clear(width: number, height: number) {
    previous = undefined; cursor = 0; fieldCell = 0; candidates = []; labelsPainted = false; badges = []; overlayLabels = [];
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    labels.width = Math.round(width * dpr); labels.height = Math.round(height * dpr);
    text.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height); hits = [];
    if (!palette.signal) palette = Object.fromEntries([...swatches].map(([t, e]) => [t, getComputedStyle(e).color]));
  }
  return {
    clear,
    overlayLabels: () => overlayLabels,
    draw(answer: AgentAnswer, enabled: Readonly<Record<string, boolean>>, C: Camera, selected: string | null, budgetMs = 8, hovered: string | null = null, overlays: readonly AgentLabel[] = [], radius = 350) {
      for (const [tone, token] of Object.entries(answer.specs.tones ?? {})) if (!swatches.has(tone) && /^[a-z-]+$/.test(token)) {
        const span = document.createElement("span"); span.style.cssText = `position:absolute;visibility:hidden;color:var(--${token})`;
        canvas.parentElement!.append(span); swatches.set(tone, span); palette = {};
      }
      const cameraKey = JSON.stringify([C.position, C.ray(C.width / 2, C.height / 2).direction, C.width, C.height, radius]);
      const overlayKey = JSON.stringify(overlays);
      const fresh = previous !== answer || previousEnabled !== enabled || previousCamera !== cameraKey || previousSelection !== selected || previousHover !== hovered || previousOverlay !== overlayKey;
      if (fresh) { clear(C.width, C.height); previous = answer; previousEnabled = enabled; previousCamera = cameraKey; previousSelection = selected; previousHover = hovered; previousOverlay = overlayKey; }
      if (answer.specs.schema !== "xfh/projections-1") return;
      const deadline = performance.now() + budgetMs;
      const far = Math.max(1500, Math.hypot(...C.position.map((n, axis) => n - C.target[axis])) + radius), fade = Math.max(1800, far * 1.2);
      ctx.font = "11px " + getComputedStyle(canvas).getPropertyValue("--font-mono"); ctx.lineJoin = "round";
      const items = answer.layers.filter(l => enabled[l.id] !== false).flatMap(l => l.items.filter(i => i.place && !l.notPlaced.includes(i.id)));
      const important = labelContext(items, selected, hovered);
      const positions = new Map<string, XY>(), clusters = new Map<string, AgentItem[]>();
      const positionItems = [...items, ...items.filter(i => i.kind !== "relation" && i.to).map(i => ({ ...i, key: i.key + ":to", region: i.toRegion, place: i.to }))];
      for (const i of positionItems) {
        if (["point", "target", "label", "actor", "influence"].includes(i.kind)) { const key = JSON.stringify(i.place), group = clusters.get(key) ?? []; group.push(i); clusters.set(key, group); }
        const p = C.point(i.place!); if (p) positions.set(i.key, p);
      }
      const collapsed = new Set<string>();
      for (const group of clusters.values()) {
        group.sort((a, b) => a.key.localeCompare(b.key)); const center = positions.get(group[0].key); if (!center) continue;
        if (group.length > 12) {
          for (const i of group) collapsed.add(i.key);
          const key = `cluster:${JSON.stringify(group[0].place)}`;
          ctx.fillStyle = palette.signal; ctx.globalAlpha = 1; if (fresh) ctx.fillText(`+${group.length}`, center[0] + 3, center[1] - 3);
          if (fresh) badges.push({ x: center[0] + 3, y: center[1] - 3, width: ctx.measureText(`+${group.length}`).width });
          if (fresh) hits.push({ key, points: [[center[0] - 4, center[1] - 18], [center[0] + 38, center[1] - 18], [center[0] + 38, center[1] + 4], [center[0] - 4, center[1] + 4]], fill: true, priority: 3 });
        } else if (group.length > 1) group.forEach((i, n) => { const a = n / group.length * 2 * Math.PI; positions.set(i.key, [center[0] + Math.cos(a) * 12, center[1] + Math.sin(a) * 12]); });
      }
      let drawn = 0;
      for (; cursor < items.length; cursor++) {
        const item = items[cursor];
        if (performance.now() > deadline) break;
        if (collapsed.has(item.key)) continue;
        const p = item.place!; if (!agentInRange(item, C.target, radius)) continue;
        const rule = answer.specs.kinds[item.kind]; if (!rule) continue;
        const area = item.resolvedAnchor ?? item.anchor;
        const extended = ["polyline", "volume", "grid", "curve", "arrow"].includes(rule.draw) || "box" in area || "zone" in area || "sphere" in area;
        const clipped = item.to ? C.line([p,item.to]) : [];
        const markerXY = positions.get(item.links?.from ?? item.key);
        const xy = markerXY ?? clipped[0]?.points[0] ?? (extended ? C.point(C.target) : null); if (!xy) continue;
        if (Math.hypot(...p.map((n, j) => n - C.position[j])) > far || xy[0] < -64 || xy[0] > C.width + 64 || xy[1] < -64 || xy[1] > C.height + 64) {
          if (!extended) continue;
        }
        const weight = item.weight ?? 0.7, size = 4 + weight * 4, alpha = (0.35 + weight * 0.65) * Math.max(0.12, 1 - Math.hypot(...p.map((n, j) => n - C.position[j])) / fade);
        const colour = palette[rule.style === "tone" ? item.tone ?? "signal" : rule.style] ?? palette.signal;
        ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = 1 + weight * 2; ctx.globalAlpha = alpha; ctx.setLineDash([]);
        const hit = (ps: XY[], fill = false, priority = fill ? 1 : 2) => hits.push({ key: item.key, points: ps, fill, priority });
        const stroke = (ps: readonly Vec3[], opacity = 1, closed = false) => { for (const run of C.line(ps, closed)) { ctx.beginPath(); path(run.points); ctx.globalAlpha = alpha * opacity; ctx.stroke(); hit(run.points); } ctx.globalAlpha = alpha; };
        const polygon = (ps: Vec3[], opacity: number) => { const projected = C.polygon(ps); ctx.beginPath(); path(projected, true); ctx.globalAlpha = alpha * opacity; ctx.fill(); hit(projected, true); ctx.globalAlpha = alpha; };
        const volume = (a: AgentAnchor, fill: boolean) => {
          let poly: readonly (readonly [number, number])[] = [], lo = p[2], hi = p[2];
          if ("zone" in a) { poly = a.zone.poly; lo = a.zone.zlo; hi = a.zone.zhi; }
          else if ("box" in a) { const b = a.box; poly = [[b.min[0], b.min[1]], [b.max[0], b.min[1]], [b.max[0], b.max[1]], [b.min[0], b.max[1]]]; lo = b.min[2]; hi = b.max[2]; }
          else if ("sphere" in a) { const s = a.sphere; poly = Array.from({ length: 32 }, (_, n) => [s.at[0] + Math.cos(n * Math.PI / 16) * s.r, s.at[1] + Math.sin(n * Math.PI / 16) * s.r] as const); lo = s.at[2] - s.r * 0.6; hi = s.at[2] + s.r * 0.6; }
          if (!poly.length) return;
          const bottom = poly.map(([x, y]): Vec3 => [x, y, lo]), top = poly.map(([x, y]): Vec3 => [x, y, hi]);
          if (fill) polygon(bottom, weight * 0.1);
          stroke(bottom, fill ? 0.7 : 0.2, true); stroke(top, 0.12, true);
        };
        const arrow = (a: XY, b: XY) => { const angle = Math.atan2(b[1] - a[1], b[0] - a[0]); ctx.beginPath(); ctx.moveTo(...b); ctx.lineTo(b[0] - 7 * Math.cos(angle - 0.45), b[1] - 7 * Math.sin(angle - 0.45)); ctx.moveTo(...b); ctx.lineTo(b[0] - 7 * Math.cos(angle + 0.45), b[1] - 7 * Math.sin(angle + 0.45)); ctx.stroke(); };
        const addLabel = (value: string, at: XY, caption = false) => { if (value) candidates.push({ key: item.key, text: value, x: at[0], y: at[1], priority: caption ? 1.5 : item.key === hovered ? -2 : item.key === selected ? -1 : labelPriority(item, important), colour: caption ? palette.muted ?? colour : colour, alpha: caption ? 0.85 : alpha, caption }); };
        let label = rule.label.replace("{label}", item.label ?? "").replace("{name}", item.value?.name ?? "actor").replace("{type}", item.value?.type ?? "");
        const a = item.resolvedAnchor ?? item.anchor;
        if (item.region && selected === item.key && !["actor", "zone"].includes(item.kind)) volume(a, false);
        if (item.toRegion && item.toResolvedAnchor && selected === item.key) volume(item.toResolvedAnchor, false);
        if (rule.draw === "polyline" && "path" in a) stroke(a.path);
        else if (rule.draw === "volume") volume(a, true);
        else if (rule.draw === "grid" && "grid" in a) {
          const g = a.grid; if (Math.max(C.scale(g.origin), C.scale(C.target)) * g.cell < 2) continue;
          const scalars = item.value?.scalars, vectors = item.value?.vectors;
          const max = scalars ? Math.max(1e-9, ...scalars.map(Math.abs)) : 1;
          for (; fieldCell < g.rows * g.cols; fieldCell++) {
            if (fieldCell % 16 === 0 && performance.now() > deadline) return { pending: true, drawn, total: items.length };
            const row = Math.floor(fieldCell / g.cols), col = fieldCell % g.cols, n = fieldCell;
            const x = g.origin[0] + col * g.cell, y = g.origin[1] + row * g.cell, z = g.origin[2];
            if (scalars) polygon([[x, y, z], [x + g.cell, y, z], [x + g.cell, y + g.cell, z], [x, y + g.cell, z]], 0.05 + Math.abs(scalars[n]) / max * 0.4);
            else if (vectors) { const v = vectors[n], start: Vec3 = [x + g.cell / 2, y + g.cell / 2, z], end: Vec3 = [start[0] + v[0], start[1] + v[1], z]; stroke([start, end]); const pa = C.point(start), pb = C.point(end); if (pa && pb) arrow(pa, pb); }
          }
          fieldCell = 0;
        } else if ((rule.draw === "curve" || rule.draw === "arrow") && item.to) {
          const to = positions.get(item.links?.to ?? item.key + ":to") ?? C.point(item.to) ?? clipped.at(-1)?.points.at(-1); if (!to) continue;
          if (rule.draw === "curve") {
            ctx.lineWidth = 1 + (item.value?.strength ?? weight) * 3;
            const dx = to[0] - xy[0], dy = to[1] - xy[1], len = Math.hypot(dx, dy) || 1;
            const bend = Math.min(24, len * 0.16), mid: XY = [(xy[0] + to[0]) / 2 - dy / len * bend, (xy[1] + to[1]) / 2 + dx / len * bend];
            const points = Array.from({ length: 17 }, (_, n): XY => { const k = n / 16; return [(1-k)**2*xy[0]+2*(1-k)*k*mid[0]+k*k*to[0], (1-k)**2*xy[1]+2*(1-k)*k*mid[1]+k*k*to[1]]; });
            ctx.beginPath(); path(points); ctx.stroke(); hit(points);
            if (!item.value?.mutual) arrow(points[15], to);
            if (label) addLabel(label, [points[8][0] + 4, points[8][1] - 4]); label = "";
          } else { ctx.beginPath(); path([xy, to]); ctx.stroke(); hit([xy, to]); arrow(xy, to); }
        } else {
          if (!markerXY) { if (rule.draw === "diamond") volume(area, false); continue; }
          if (rule.draw === "diamond") { volume(a, false); ctx.beginPath(); path([[xy[0], xy[1]-size], [xy[0]+size,xy[1]], [xy[0],xy[1]+size], [xy[0]-size,xy[1]]], true); ctx.stroke(); }
          else if (rule.draw === "ring") { ctx.beginPath(); ctx.arc(...xy, size, 0, Math.PI*2); ctx.stroke(); }
          else if (rule.draw === "crosshair") {
            if (item.to) { ctx.setLineDash([4, 4]); stroke([p, item.to], 0.7); ctx.setLineDash([]); }
            ctx.beginPath(); ctx.moveTo(xy[0]-size,xy[1]); ctx.lineTo(xy[0]+size,xy[1]); ctx.moveTo(xy[0],xy[1]-size); ctx.lineTo(xy[0],xy[1]+size); ctx.stroke();
          }
          hit([[xy[0]-size-3,xy[1]-size-3], [xy[0]+Math.max(size+3, rule.draw === "text" ? label.length*7 : size+3),xy[1]-size-3], [xy[0]+size+3,xy[1]+size+3], [xy[0]-size-3,xy[1]+size+3]], true, 3);
        }
        if (label && xy[0] >= -32 && xy[0] <= C.width+32 && xy[1] >= -32 && xy[1] <= C.height+32) addLabel(label, [xy[0]+size+4, xy[1]-4]);
        const facet = Object.entries(item.facets ?? item.value?.facets ?? {})[0];
        if (facet && rule.draw === "diamond") addLabel(actorCaption(facet[1]), [xy[0]+size+4, xy[1]+13], true);
        if (selected === item.key) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(...xy, size+5, 0, Math.PI*2); ctx.stroke(); }
        drawn++;
      }
      if (cursor >= items.length && !labelsPainted) {
        text.font = ctx.font;
        text.strokeStyle = getComputedStyle(canvas.parentElement!).backgroundColor; text.lineWidth = 3; text.lineJoin = "round";
        const placed = placeLabels([...candidates, ...overlays], value => text.measureText(value).width, C.width, C.height, 40, badges);
        overlayLabels = placed.filter(label => label.overlay);
        for (const label of placed.filter(label => !label.overlay)) {
          text.globalAlpha = label.alpha; text.fillStyle = label.colour;
          text.strokeText(label.text, label.x, label.y);
          text.fillText(label.text, label.x, label.y);
        }
        labelsPainted = true;
      }
      ctx.globalAlpha = 1; return { pending: cursor < items.length, drawn, total: items.length };
    },
    pick(x: number, y: number): string | null {
      for (const priority of [3, 2, 1]) for (let n = hits.length - 1; n >= 0; n--) {
        const h = hits[n]; if (h.priority !== priority) continue;
        if (h.fill) { let inside = false; for (let i = 0, j = h.points.length - 1; i < h.points.length; j = i++) { const a = h.points[i], b = h.points[j]; if ((a[1]>y)!==(b[1]>y) && x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) inside = !inside; } if (inside) return h.key; }
        for (let i = 1; i < h.points.length; i++) { const a = h.points[i-1], b = h.points[i], dx=b[0]-a[0], dy=b[1]-a[1], k=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1))); if (Math.hypot(x-a[0]-k*dx,y-a[1]-k*dy) < 6) return h.key; }
      }
      return null;
    },
    dispose() { labels.remove(); theme.disconnect(); media.removeEventListener("change", invalidate); for (const e of swatches.values()) e.remove(); },
  };
}
