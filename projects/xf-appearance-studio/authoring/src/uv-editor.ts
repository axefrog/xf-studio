import { clamp, curve, type Layer, type Recipe } from "./recipe";
import { insertPathPoint, nearestPathSection } from "./path-edit";
import { fitUVView, parseUVView, pixelToUV, reflectUV, uvAspect, uvRegion, uvToPixel, type UV, type UVView } from "./uv-view";

type Hooks = {
  recipe(): Recipe; layer(): Layer | undefined; selected(): number;
  canvases(): HTMLCanvasElement[]; albedo(): HTMLImageElement | undefined;
  select(index: number): void; begin(): void; change(): void; cancel(): void;
  persist(): void; message(text: string): void;
};
type Handle = { kind: "point" | "origin" | "field"; index: number; mirror: boolean; uv: UV };

/** Canvas presentation and gestures. View state never enters portable recipes. */
export function createUVEditor(canvas: HTMLCanvasElement, elements: {
  both: HTMLButtonElement; single: HTMLButtonElement; other: HTMLButtonElement;
  fit: HTMLButtonElement; note: HTMLElement;
}, hooks: Hooks, initial: UVView) {
  const ctx = canvas.getContext("2d")!, tinted = document.createElement("canvas");
  tinted.width = tinted.height = 1024;
  let view = parseUVView(initial);
  let drag: { handle: Handle; pointer: number; layer: Layer; changed: boolean } | undefined;
  const bounds = () => canvas.getBoundingClientRect();
  const region = () => uvRegion(view);
  const pixel = (p: UV) => uvToPixel(p, region(), canvas.width, canvas.height);
  const coordinate = (e: PointerEvent | MouseEvent) => {
    const b = bounds();
    return pixelToUV({ x: e.clientX - b.left, y: e.clientY - b.top }, region(), b.width, b.height);
  };
  function handles(): Handle[] {
    const l = hooks.layer();
    if (!l) return [];
    return (l.symmetry ? [false, true] : [false]).flatMap(mirror => [
      ...l.points.map((p, index) => ({ kind: "point" as const, index, mirror, uv: reflectUV(p, mirror) })),
      { kind: "field" as const, index: -1, mirror, uv: reflectUV({ u: l.field.u + l.field.du, v: l.field.v + l.field.dv }, mirror) },
      { kind: "origin" as const, index: -1, mirror, uv: reflectUV(l.field, mirror) },
    ]);
  }
  function draw() {
    canvas.width = 720; canvas.height = view.mode === "both" ? 310 : 520;
    elements.both.setAttribute("aria-pressed", String(view.mode === "both"));
    elements.single.setAttribute("aria-pressed", String(view.mode === "single"));
    elements.other.disabled = view.mode !== "single";
    const r = region(), unit = canvas.width / (bounds().width || canvas.width);
    ctx.fillStyle = "#253132"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const image = hooks.albedo();
    if (image) {
      ctx.globalAlpha = .55;
      ctx.drawImage(image, r.u * image.width, r.v * image.height, r.w * image.width, r.h * image.height, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
    const layers = hooks.recipe().layers, masks = hooks.canvases();
    for (let i = 0; i < layers.length; i++) if (layers[i].enabled && masks[i]) {
      const t = tinted.getContext("2d")!;
      t.clearRect(0, 0, 1024, 1024); t.globalCompositeOperation = "source-over";
      t.drawImage(masks[i], 0, 0); t.globalCompositeOperation = "source-in";
      t.fillStyle = layers[i].color; t.fillRect(0, 0, 1024, 1024); t.globalCompositeOperation = "source-over";
      ctx.drawImage(tinted, r.u * 1024, r.v * 1024, r.w * 1024, r.h * 1024, 0, 0, canvas.width, canvas.height);
    }
    const centre = pixel({ u: .5, v: r.v });
    ctx.setLineDash([3 * unit, 4 * unit]); ctx.strokeStyle = "#c4ddca55";
    ctx.beginPath(); ctx.moveTo(centre.x, 0); ctx.lineTo(centre.x, canvas.height); ctx.stroke(); ctx.setLineDash([]);
    const l = hooks.layer();
    if (!l) { elements.note.textContent = "Add a layer to edit its shape."; return; }
    for (const mirror of l.symmetry ? [false, true] : [false]) {
      const path = curve(l.points);
      ctx.strokeStyle = "#f1dbee"; ctx.lineWidth = 1.25 * unit; ctx.beginPath();
      path.forEach((p, i) => { const q = pixel(reflectUV(p, mirror)); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
      ctx.closePath(); ctx.stroke();
      const f = l.field, a = pixel(reflectUV(f, mirror)), b = pixel(reflectUV({ u: f.u + f.du, v: f.v + f.dv }, mirror));
      ctx.strokeStyle = "#b1ebc9"; ctx.lineWidth = 1.25 * unit;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    let selectedVisible = false;
    for (const h of handles()) {
      const p = pixel(h.uv), selected = h.kind === "point" && h.index === hooks.selected();
      if (selected && p.x >= 0 && p.x <= canvas.width && p.y >= 0 && p.y <= canvas.height) selectedVisible = true;
      ctx.beginPath(); ctx.lineWidth = unit;
      if (h.kind === "field") ctx.rect(p.x - 4 * unit, p.y - 4 * unit, 8 * unit, 8 * unit);
      else ctx.arc(p.x, p.y, (h.kind === "point" ? selected ? 5 : 3.5 : 4) * unit, 0, Math.PI * 2);
      ctx.fillStyle = h.kind === "point" ? selected ? "#fff4fb" : "#c49ab8" : "#b1ebc9";
      ctx.strokeStyle = h.kind === "origin" ? "#b1ebc9" : "#2b2a34";
      if (h.kind !== "origin") ctx.fill();
      ctx.stroke();
    }
    elements.note.textContent = selectedVisible ? "View only · Fit shape recentres the controls." : "Selected point outside this view · use Fit shape or Other eye.";
  }
  function stop(cancel = false) {
    if (!drag) return;
    const old = drag; drag = undefined;
    if (canvas.hasPointerCapture(old.pointer)) canvas.releasePointerCapture(old.pointer);
    if (cancel && old.changed && hooks.layer() === old.layer) hooks.cancel();
    draw();
  }
  function updateView(next: UVView) {
    stop(); view = next; draw(); hooks.persist();
  }
  elements.both.onclick = () => updateView(fitUVView({ ...view, mode: "both" }, hooks.layer()));
  elements.single.onclick = () => updateView(fitUVView({ ...view, mode: "single" }, hooks.layer()));
  elements.other.onclick = () => updateView({ ...view, side: view.side === "low" ? "high" : "low", u: 1 - view.u });
  elements.fit.onclick = () => updateView(fitUVView(view, hooks.layer()));
  canvas.onpointerdown = e => {
    if (e.button !== 0 || drag) return;
    const l = hooks.layer(); if (!l) return;
    const b = bounds(), p = coordinate(e), r = region();
    let closest: Handle | undefined, best = 11;
    for (const h of handles()) {
      const d = Math.hypot((h.uv.u - p.u) * b.width / r.w, (h.uv.v - p.v) * b.height / r.h);
      if (d < best - .1) { best = d; closest = h; }
    }
    if (!closest) return;
    e.preventDefault();
    view.side = closest.uv.u <= .5 ? "low" : "high";
    if (closest.kind === "point") hooks.select(closest.index);
    drag = { handle: closest, pointer: e.pointerId, layer: l, changed: false };
    canvas.setPointerCapture(e.pointerId); draw(); hooks.persist();
  };
  canvas.onpointermove = e => {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (hooks.layer() !== drag.layer) { stop(); return; }
    const l = drag.layer, h = drag.handle, p = reflectUV(coordinate(e), h.mirror);
    const next = h.kind === "point" || h.kind === "origin" ? { u: clamp(p.u), v: clamp(p.v) }
      : { du: clamp(p.u - l.field.u, -.1, .1), dv: clamp(p.v - l.field.v, -.1, .1) };
    const target = h.kind === "point" ? l.points[h.index] : l.field;
    if (Object.entries(next).every(([key, value]) => Math.abs((target as unknown as Record<string, number>)[key] - value) < 1e-7)) return;
    if (!drag.changed) { hooks.begin(); drag.changed = true; }
    Object.assign(target, next); hooks.change();
  };
  canvas.onpointerup = e => { if (drag?.pointer === e.pointerId) stop(); };
  canvas.onpointercancel = e => { if (drag?.pointer === e.pointerId) stop(true); };
  canvas.onlostpointercapture = e => { if (drag?.pointer === e.pointerId) stop(true); };
  window.addEventListener("blur", () => stop(true));
  window.addEventListener("keydown", e => {
    if (drag && (e.key === "Escape" || ((e.ctrlKey || e.metaKey) && e.key === "z"))) {
      e.preventDefault(); e.stopImmediatePropagation(); stop(true);
    }
  }, true);
  canvas.ondblclick = e => {
    stop();
    const l = hooks.layer(); if (!l) return;
    const p = coordinate(e), b = bounds(), r = region(), scale = { u: b.width / r.w, v: b.height / r.h };
    // Compare both displayed instances, not a hardcoded u<.5 folding rule.
    const candidates = (l.symmetry ? [false, true] : [false]).map(mirror => ({ mirror,
      click: reflectUV(p, mirror), section: nearestPathSection(l.points, reflectUV(p, mirror), scale) }));
    candidates.sort((a, b) => (a.section?.distancePx ?? Infinity) - (b.section?.distancePx ?? Infinity));
    const chosen = candidates[0], result = chosen && insertPathPoint(l.points, chosen.click, scale);
    if (!result) { hooks.message("A shape supports up to 24 points."); return; }
    hooks.begin(); l.points = result.points; hooks.select(result.index);
    view.side = p.u <= .5 ? "low" : "high";
    hooks.change();
  };
  const resize = new ResizeObserver(draw); resize.observe(canvas);
  return { draw, snapshot: () => ({ ...view }), diagnostics: () => {
    const b = bounds();
    return { view: { ...view }, region: region(), aspect: uvAspect(view.mode), dragging: !!drag,
      handles: handles().map(h => ({ ...h, screen: (() => { const p = uvToPixel(h.uv, region(), b.width, b.height);
        return { x: b.left + p.x, y: b.top + p.y }; })() })) };
  } };
}
