// Canvas mechanics. Policy selects significant instances; immutable world geometry is prepared once.
import { solidDrawing, solidGeometry, type SolidInstance } from "./solid-projection";
import { clipSegment, type camera } from "./projection";

type Camera = ReturnType<typeof camera>;
const EDGES = [0,1,0,2,0,4,1,3,1,5,2,3,2,6,3,7,4,5,4,6,5,7,6,7];
const TOPS = [false, true];
const TRAILS = [[0,1,3,2,0,4,5,1],[2,6,4],[3,7,5],[6,7]];
/** Outlines stay a step behind the recorded data: the trail and V lead, the city is context (design review, round 2). */
const EDGE_OPACITY = 0.6;
export function solidCanvas(canvas: HTMLCanvasElement, changed: () => void) {
  const ctx = canvas.getContext("2d"); if (!ctx) throw Error("Canvas 2D is unavailable for Solid shapes.");
  // CSS resolves light-dark()/color-mix() before Canvas's independent colour parser sees the values.
  canvas.style.color = "var(--line-strong)"; canvas.style.borderColor = "var(--text)";
  let palette: { edge: string; face: string } | null = null;
  let last: readonly SolidInstance[] | undefined, lastDpr = 0;
  const invalidate = () => { palette = null; changed(); }, theme = new MutationObserver(invalidate);
  for (const root of [document.documentElement, document.body]) theme.observe(root, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
  const media = matchMedia("(prefers-color-scheme: dark)"); media.addEventListener("change", invalidate);
  const xy = new Float64Array(16), depths = new Float64Array(8), front = new Uint8Array(6);
  const segment = (ax: number, ay: number, bx: number, by: number) => { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); };
  const path = (points: readonly (readonly number[])[], close: boolean) => {
    if (!points.length) return; ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]); if (close) ctx.closePath();
  };
  function clear(width: number, height: number) {
    last = undefined;
    const dpr = window.devicePixelRatio || 1, w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (!palette) { const style = getComputedStyle(canvas); palette = { edge: style.color, face: style.borderTopColor }; }
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0); ctx!.clearRect(0, 0, width, height);
  }
  return {
    clear,
    draw(solids: readonly SolidInstance[], C: Camera) {
      const dpr = window.devicePixelRatio || 1;
      if (palette && last === solids && lastDpr === dpr && canvas.width === Math.round(C.width * dpr) && canvas.height === Math.round(C.height * dpr)) return;
      clear(C.width, C.height); ctx.lineWidth = 1; ctx.strokeStyle = palette!.edge; ctx.fillStyle = palette!.face; ctx.setLineDash([]);
      last = solids; lastDpr = dpr;
      for (const instance of solids) {
        const s = instance.source, fillFaces = instance.extentPx >= 12;
        if (s.kind !== "box") {
          const drawing = solidDrawing(s, C, instance.opacity, fillFaces, instance.extentPx < 64 ? 16 : 24);
          if (fillFaces) { ctx.beginPath(); for (const f of drawing.faces) path(f.points, true); ctx.globalAlpha = instance.opacity * 0.04; ctx.fill(); }
          ctx.beginPath(); for (const line of drawing.lines) path(line.points, false); ctx.globalAlpha = instance.opacity * EDGE_OPACITY; ctx.stroke(); continue;
        }
        const g = solidGeometry(s), wholeInside = C.projectInto(g.corners, xy, depths);
        if (fillFaces) for (let i = 0; i < g.faces.length; i++) {
          const f = g.faces[i], n = f.normal;
          front[i] = n[0] * (C.position[0] - f.center[0]) + n[1] * (C.position[1] - f.center[1]) + n[2] * (C.position[2] - f.center[2]) > 0 ? 1 : 0;
        }
        if (fillFaces) for (const top of TOPS) {
          ctx.beginPath(); let any = false;
          for (let i = 0; i < g.faces.length; i++) {
            const f = g.faces[i]; if (!front[i] || f.top !== top) continue; any = true;
            let inside = wholeInside;
            if (!inside) { inside = true; for (const j of f.ids) if (depths[j] < 1 || xy[j * 2] < -32 || xy[j * 2] > C.width + 32 || xy[j * 2 + 1] < -32 || xy[j * 2 + 1] > C.height + 32) { inside = false; break; } }
            if (inside) {
              ctx.moveTo(xy[f.ids[0] * 2], xy[f.ids[0] * 2 + 1]);
              for (let j = 1; j < f.ids.length; j++) ctx.lineTo(xy[f.ids[j] * 2], xy[f.ids[j] * 2 + 1]); ctx.closePath();
            } else if (f.ids.every(j => depths[j] >= 1)) path(C.clipPolygon(f.ids.map(j => [xy[j * 2], xy[j * 2 + 1]])), true);
            else path(C.polygon(f.ids.map(j => g.corners[j])), true);
          }
          if (any) { ctx.globalAlpha = instance.opacity * (top ? 0.06 : 0.04); ctx.fill(); }
        }
        ctx.beginPath();
        if (wholeInside) for (const trail of TRAILS) {
          ctx.moveTo(xy[trail[0] * 2], xy[trail[0] * 2 + 1]);
          for (let j = 1; j < trail.length; j++) ctx.lineTo(xy[trail[j] * 2], xy[trail[j] * 2 + 1]);
        }
        else for (let e = 0; e < EDGES.length; e += 2) {
          const i = EDGES[e], j = EDGES[e + 1];
          if (depths[i] >= 1 && depths[j] >= 1) clipSegment(xy[i * 2], xy[i * 2 + 1], xy[j * 2], xy[j * 2 + 1], -32, -32, C.width + 32, C.height + 32, segment);
          else for (const line of C.line([g.corners[i], g.corners[j]])) path(line.points, false);
        }
        ctx.globalAlpha = instance.opacity * EDGE_OPACITY; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    dispose() { theme.disconnect(); media.removeEventListener("change", invalidate); },
  };
}
