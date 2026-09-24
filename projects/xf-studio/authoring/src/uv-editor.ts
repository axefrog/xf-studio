import { clamp, curve, type Layer, type Recipe } from "./recipe";
import { cancelsGesture } from "./gesture-cancel";
import { insertPathPoint, nearestPathSection } from "./path-edit";
import { moveTangent, tangentEndpoint } from "./bezier-path";
import { shapeHit, shapeWheelScaleFactor, transformLayer, wheelScaleFactor } from "./shape-transform";
import { canvasResolution } from "./canvas-resolution";
import { fitUVView, panUVView, parseUVView, pixelToUV, reflectUV, uvAspect, uvRegion, uvToPixel, zoomUVView, type UV, type UVView } from "./uv-view";
import type { StudioGestureProposal } from "./studio-application";
import type { ViewportHit } from "./viewport-attachment";
import type { UVViewCommand } from "./viewport-attachment";

type Hooks = {
  recipe(): Recipe; layer(): Layer | undefined; selected(): number;
  canvases(): HTMLCanvasElement[]; albedo(): HTMLImageElement | undefined;
  select(index: number): void; selectedField(): string | undefined; selectField(id: string): void;
  begin(): void; apply(action: StudioGestureProposal): boolean; cancel(): void; finish?(): void;
  persist(): void; message(text: string): void;
};
type Handle = { kind: "point" | "origin" | "field" | "tangent"; index: number; fieldId?: string;
  side?: "in" | "out"; mirror: boolean; uv: UV; endpoint?: UV; collapsed?: boolean };
const isKnotHandle = (h: Handle) => h.kind === "point" || h.kind === "tangent";

/** Canvas presentation and gestures. View state never enters portable recipes. */
export function createUVEditor(canvas: HTMLCanvasElement, elements: {
  both: HTMLButtonElement; single: HTMLButtonElement; other: HTMLButtonElement;
  fit: HTMLButtonElement; note: HTMLElement;
} | undefined, hooks: Hooks, initial: UVView) {
  const ctx = canvas.getContext("2d")!, tinted = document.createElement("canvas");
  const listeners = new AbortController();
  let view = parseUVView(initial);
  // Establish layout before observing it; the initial observer callback must not
  // itself change the canvas aspect and trigger a resize-observer feedback pass.
  if (canvas.style) canvas.style.aspectRatio = String(uvAspect(view.mode));
  type HandleDrag = { kind: "handle"; handle: Handle; layer: Layer; recipe: Recipe;
    target: Layer["points"][number] | Layer["fields"][number]; start: UV; endpoint?: UV };
  type ShapeDrag = { kind: "translate" | "rotate"; layer: Layer; recipe: Recipe; original: Layer;
    expected: Layer["points"]; start: UV; pivot: UV; mirror: boolean; screen: { x: number; y: number }; limited: boolean };
  type PanDrag = { kind: "pan"; original: UVView; screen: { x: number; y: number } };
  let drag: ((HandleDrag | ShapeDrag | PanDrag) & { pointer: number; changed: boolean }) | undefined;
  let wheel: { layer: Layer; recipe: Recipe; expected: Layer["points"]; state: string; selected: number; timer?: ReturnType<typeof setTimeout> } | undefined;
  const bounds = () => {
    const r = canvas.getBoundingClientRect();
    // #uv has equal borders and no padding. Pointer/drawing coordinates describe
    // its content box, not the extra border pixels returned by the DOM rectangle.
    const borderX = canvas.clientLeft || 0, borderY = canvas.clientTop || 0;
    return { left: r.left + borderX, top: r.top + borderY,
      width: Math.max(1, r.width - 2 * borderX), height: Math.max(1, r.height - 2 * borderY) };
  };
  const region = () => { const b = bounds(); return uvRegion(view, b.width / b.height); };
  const coordinate = (e: PointerEvent | MouseEvent) => {
    const b = bounds();
    return pixelToUV({ x: e.clientX - b.left, y: e.clientY - b.top }, region(), b.width, b.height);
  };
  function handles(): Handle[] {
    const l = hooks.layer();
    if (!l) return [];
    const selected = l.points[hooks.selected()];
    const tangents = l.pathMode === "bezier" && selected?.handles ? (["in", "out"] as const).map(side => {
      const endpoint = tangentEndpoint(selected, side);
      const collapsed = Math.hypot(endpoint.u - selected.u, endpoint.v - selected.v) < 1e-10;
      // A collapsed vector still needs a distinct grab target. Dragging this proxy
      // applies pointer displacement to the real endpoint, without a shape jump.
      const uv = collapsed ? { u: selected.u + (side === "in" ? -1 : 1) * 16 * region().w / (bounds().width || 720), v: selected.v } : endpoint;
      return { side, uv, endpoint, collapsed };
    }) : [];
    return (l.symmetry ? [false, true] : [false]).flatMap(mirror => [
      ...l.points.map((p, index) => ({ kind: "point" as const, index, mirror, uv: reflectUV(p, mirror) })),
      ...l.fields.flatMap((f, index) => [
        { kind: "field" as const, index, fieldId: f.id, mirror, uv: reflectUV({ u: f.u + f.du, v: f.v + f.dv }, mirror) },
        { kind: "origin" as const, index, fieldId: f.id, mirror, uv: reflectUV(f, mirror) },
      ]),
      ...tangents.map(t => ({ ...t, kind: "tangent" as const, index: hooks.selected(), mirror,
        uv: reflectUV(t.uv, mirror), endpoint: reflectUV(t.endpoint, mirror) })),
    ]);
  }
  function draw() {
    // Explicit CSS aspect breaks the intrinsic-size feedback cycle: resizing the
    // backing buffer must never change layout and trigger another resize.
    const aspect = String(uvAspect(view.mode));
    if (canvas.style && canvas.style.aspectRatio !== aspect) canvas.style.aspectRatio = aspect;
    const b = bounds(), resolution = canvasResolution(b.width, b.height, window.devicePixelRatio);
    if (canvas.width !== resolution.pixelWidth) canvas.width = resolution.pixelWidth;
    if (canvas.height !== resolution.pixelHeight) canvas.height = resolution.pixelHeight;
    ctx.setTransform(resolution.scaleX, 0, 0, resolution.scaleY, 0, 0);
    ctx.globalAlpha = 1;
    const width = b.width, height = b.height;
    elements?.both.setAttribute("aria-pressed", String(view.mode === "both"));
    elements?.single.setAttribute("aria-pressed", String(view.mode === "single"));
    if (elements) elements.other.disabled = view.mode !== "single";
    const r = uvRegion(view, width / height), unit = 1;
    const pixel = (p: UV) => uvToPixel(p, r, width, height);
    ctx.fillStyle = "#253132"; ctx.fillRect(0, 0, width, height);
    const image = hooks.albedo();
    if (image) {
      ctx.globalAlpha = .55;
      ctx.drawImage(image, r.u * image.width, r.v * image.height, r.w * image.width, r.h * image.height, 0, 0, width, height);
      ctx.globalAlpha = 1;
    }
    // The tint scratch follows display pixels, never an intermediate 1K atlas.
    if (tinted.width !== resolution.pixelWidth) tinted.width = resolution.pixelWidth;
    if (tinted.height !== resolution.pixelHeight) tinted.height = resolution.pixelHeight;
    const layers = hooks.recipe().layers, masks = hooks.canvases();
    for (let i = 0; i < layers.length; i++) if (layers[i].enabled && masks[i]) {
      const t = tinted.getContext("2d")!;
      const mask = masks[i];
      t.clearRect(0, 0, tinted.width, tinted.height); t.globalCompositeOperation = "source-over";
      t.drawImage(mask, r.u * mask.width, r.v * mask.height, r.w * mask.width, r.h * mask.height,
        0, 0, tinted.width, tinted.height);
      t.globalCompositeOperation = "source-in";
      t.fillStyle = layers[i].color; t.fillRect(0, 0, tinted.width, tinted.height); t.globalCompositeOperation = "source-over";
      ctx.drawImage(tinted, 0, 0, tinted.width, tinted.height, 0, 0, width, height);
    }
    const centre = pixel({ u: .5, v: r.v });
    ctx.setLineDash([3 * unit, 4 * unit]); ctx.strokeStyle = "#c4ddca55";
    ctx.beginPath(); ctx.moveTo(centre.x, 0); ctx.lineTo(centre.x, height); ctx.stroke(); ctx.setLineDash([]);
    const l = hooks.layer();
    if (!l) { if (elements) elements.note.textContent = "Add a layer to edit its shape."; return; }
    for (const mirror of l.symmetry ? [false, true] : [false]) {
      const path = curve(l.points);
      ctx.strokeStyle = "#f1dbee"; ctx.lineWidth = 1.25 * unit; ctx.beginPath();
      path.forEach((p, i) => { const q = pixel(reflectUV(p, mirror)); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
      ctx.closePath(); ctx.stroke();
      for (const f of l.fields) {
        const a = pixel(reflectUV(f, mirror)), b = pixel(reflectUV({ u: f.u + f.du, v: f.v + f.dv }, mirror));
        const selected = f.id === hooks.selectedField();
        ctx.strokeStyle = selected ? "#b1ebc9" : "#7f9c8a"; ctx.lineWidth = 1.25 * unit;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        if (selected) {
          ctx.setLineDash([4 * unit, 4 * unit]); ctx.strokeStyle = "#b1ebc966";
          ctx.beginPath(); ctx.arc(a.x, a.y, f.radius / r.w * width, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }
    let selectedVisible = false;
    for (const h of handles()) {
      const p = pixel(h.uv), selected = isKnotHandle(h) ? h.index === hooks.selected() : h.fieldId === hooks.selectedField();
      if (h.kind === "point" && selected && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height) selectedVisible = true;
      if (h.kind === "tangent") {
        const knot = pixel(reflectUV(l.points[h.index], h.mirror));
        ctx.strokeStyle = "#f4ca8a"; ctx.lineWidth = unit;
        ctx.setLineDash(h.collapsed ? [2 * unit, 3 * unit] : []);
        ctx.beginPath(); ctx.moveTo(knot.x, knot.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.lineWidth = unit;
      if (h.kind === "field") ctx.rect(p.x - 4 * unit, p.y - 4 * unit, 8 * unit, 8 * unit);
      else if (h.kind === "tangent") {
        ctx.moveTo(p.x, p.y - 5 * unit); ctx.lineTo(p.x + 5 * unit, p.y);
        ctx.lineTo(p.x, p.y + 5 * unit); ctx.lineTo(p.x - 5 * unit, p.y); ctx.closePath();
      }
      else ctx.arc(p.x, p.y, (h.kind === "point" ? selected ? 5 : 3.5 : 4) * unit, 0, Math.PI * 2);
      ctx.fillStyle = h.kind === "tangent" ? "#f4ca8a" : h.kind === "point" ? selected ? "#fff4fb" : "#c49ab8" : selected ? "#c9ffe2" : "#7f9c8a";
      ctx.strokeStyle = h.kind === "origin" ? "#b1ebc9" : "#2b2a34";
      if (h.kind !== "origin") ctx.fill();
      ctx.stroke();
    }
    if (elements) elements.note.textContent = selectedVisible
      ? l.pathMode === "bezier" ? "Gold diamonds shape the curve · dotted handles extend a collapsed tangent." : "View only · Fit shape recentres the controls."
      : "Selected point outside this view · use Fit shape or Other eye.";
  }
  function validDrag() {
    if (!drag) return false;
    if (drag.kind === "pan") return true;
    if (hooks.recipe() !== drag.recipe || hooks.layer() !== drag.layer) return false;
    if (drag.kind !== "handle") return drag.layer.points === drag.expected;
    const { handle: h, target, layer } = drag;
    return isKnotHandle(h) ? layer.points[h.index] === target && (h.kind !== "tangent" || (layer.pathMode === "bezier" && !!layer.points[h.index].handles))
      : layer.fields.some(f => f.id === h.fieldId && f === target);
  }
  function validWheel() {
    return !!wheel && hooks.recipe() === wheel.recipe && hooks.layer() === wheel.layer &&
      wheel.layer.points === wheel.expected && hooks.selected() === wheel.selected && JSON.stringify(hooks.recipe()) === wheel.state;
  }
  function finishWheel(cancel = false) {
    if (!wheel) return;
    const valid = validWheel(); clearTimeout(wheel.timer); wheel = undefined;
    if (cancel && valid) hooks.cancel(); else hooks.finish?.();
  }
  function stop(cancel = false) {
    if (!drag) return;
    const old = drag, mayCancel = validDrag(); drag = undefined;
    if (canvas.hasPointerCapture(old.pointer)) canvas.releasePointerCapture(old.pointer);
    if (cancel && old.changed && mayCancel) {
      if (old.kind === "pan") { view = old.original; hooks.persist(); }
      else hooks.cancel();
    } else if (old.changed && old.kind !== "pan") hooks.finish?.();
    draw();
  }
  function updateView(next: UVView) {
    stop(); finishWheel(); view = next; draw(); hooks.persist();
  }
  function viewCommand(command: UVViewCommand): boolean {
    if (command === "other" && view.mode !== "single") return false;
    const next = command === "both" ? fitUVView({ ...view, mode: "both" }, hooks.layer()) :
      command === "single" ? fitUVView({ ...view, mode: "single" }, hooks.layer()) :
      command === "other" ? { ...view, side: view.side === "low" ? "high" as const : "low" as const, u: 1 - view.u } :
      fitUVView(view, hooks.layer());
    updateView(next); return true;
  }
  if (elements) {
    elements.both.onclick = () => { viewCommand("both"); };
    elements.single.onclick = () => { viewCommand("single"); };
    elements.other.onclick = () => { viewCommand("other"); };
    elements.fit.onclick = () => { viewCommand("fit"); };
  }
  function pickHandle(p: UV): Handle | undefined {
    const b = bounds(), r = region();
    let closest: Handle | undefined, best = 11;
    const priority = (h: Handle) => h.kind === "tangent" ? 2 : h.fieldId === hooks.selectedField() && !isKnotHandle(h) ? 1 : 0;
    for (const h of handles().sort((a, b) => priority(b) - priority(a))) {
      const d = Math.hypot((h.uv.u - p.u) * b.width / r.w, (h.uv.v - p.v) * b.height / r.h);
      if (d < best - .1) { best = d; closest = h; }
    }
    return closest;
  }
  function hitAt(clientX: number, clientY: number): ViewportHit | undefined {
    if (drag || wheel) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || clientX < rect.left || clientY < rect.top ||
      clientX >= rect.left + rect.width || clientY >= rect.top + rect.height) return;
    const layer = hooks.layer();
    if (!layer) return { hit: { kind: "uv-empty" }, affordance: "empty" };
    const p = coordinate({ clientX, clientY } as MouseEvent), handle = pickHandle(p);
    if (handle) {
      const hit = handle.kind === "point" ? { kind: "point" as const, layerId: layer.id, index: handle.index }
        : handle.kind === "tangent" ? { kind: "tangent" as const, layerId: layer.id,
          index: handle.index, side: handle.side === "in" ? "incoming" as const : "outgoing" as const }
        : { kind: "field" as const, layerId: layer.id, id: handle.fieldId! };
      return { hit, mirror: handle.mirror,
        affordance: handle.kind === "origin" ? "warp-origin" : handle.kind === "field" ? "warp-vector" : handle.kind };
    }
    const shape = shapeHit(layer, p);
    return shape ? { hit: { kind: "shape", layerId: layer.id }, mirror: shape.mirror, affordance: "shape" }
      : { hit: { kind: "uv-empty" }, affordance: "empty" };
  }
  canvas.onpointerdown = e => {
    if ((e.button !== 0 && e.button !== 2) || drag) return;
    finishWheel();
    if (e.button === 2) {
      e.preventDefault();
      drag = { kind: "pan", pointer: e.pointerId, changed: false, original: { ...view }, screen: { x: e.clientX, y: e.clientY } };
      canvas.setPointerCapture(e.pointerId); return;
    }
    const l = hooks.layer(); if (!l) return;
    const p = coordinate(e), closest = pickHandle(p);
    const hit = closest ? { mirror: closest.mirror } : shapeHit(l, p);
    if (!hit) return;
    e.preventDefault();
    const pivot = l.points[hooks.selected()] ?? l.points[0];
    if (e.shiftKey || !closest) {
      // Selection is the transform pivot; Shift never changes it by picking the
      // control beneath the pointer. Use the visible mirrored instance's space.
      drag = { kind: e.shiftKey ? "rotate" : "translate", pointer: e.pointerId, changed: false,
        layer: l, recipe: hooks.recipe(), original: structuredClone(l), expected: l.points,
        start: reflectUV(p, hit.mirror), pivot: { u: pivot.u, v: pivot.v }, mirror: hit.mirror,
        screen: { x: e.clientX, y: e.clientY }, limited: false };
    } else {
      if (isKnotHandle(closest)) hooks.select(closest.index);
      else hooks.selectField(closest.fieldId!);
      drag = { kind: "handle", handle: closest, pointer: e.pointerId, layer: l, recipe: hooks.recipe(), changed: false,
        start: reflectUV(p, closest.mirror), endpoint: closest.endpoint ? reflectUV(closest.endpoint, closest.mirror) : undefined,
        target: isKnotHandle(closest) ? l.points[closest.index] : l.fields.find(f => f.id === closest.fieldId)! };
    }
    view.side = p.u <= .5 ? "low" : "high";
    canvas.setPointerCapture(e.pointerId); draw(); hooks.persist();
  };
  canvas.onpointermove = e => {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (!validDrag()) { stop(); return; }
    if (drag.kind === "pan") {
      const b = bounds(), r = uvRegion(drag.original, b.width / b.height);
      const next = panUVView(drag.original, -(e.clientX - drag.screen.x) / b.width * r.w, -(e.clientY - drag.screen.y) / b.height * r.h);
      if (next.u === view.u && next.v === view.v) return;
      view = next; drag.changed = true; draw(); hooks.persist(); return;
    }
    if (drag.kind !== "handle") {
      if (!drag.changed && Math.hypot(e.clientX - drag.screen.x, e.clientY - drag.screen.y) < 4) return;
      const p = reflectUV(coordinate(e), drag.mirror), start = drag.start, pivot = drag.pivot;
      const a = { u: start.u - pivot.u, v: start.v - pivot.v }, b = { u: p.u - pivot.u, v: p.v - pivot.v };
      if (drag.kind === "rotate" && Math.hypot(a.u, a.v) < 1e-8) { drag.start = p; return; }
      if (drag.kind === "rotate" && Math.hypot(b.u, b.v) < 1e-8) return;
      const operation = drag.kind === "translate" ? { kind: "translate" as const, du: p.u - start.u, dv: p.v - start.v }
        : { kind: "rotate" as const, pivot, radians: Math.atan2(a.u * b.v - a.v * b.u, a.u * b.u + a.v * b.v) };
      if (!drag.changed && operation.kind === "rotate" && Math.abs(operation.radians) < 1e-12) return;
      const next = transformLayer(drag.original, operation);
      if (!next) {
        if (!drag.limited) hooks.message("This move reaches the layer's limits. Reduce the movement to continue.");
        drag.limited = true; return;
      }
      drag.limited = false;
      if (JSON.stringify(next) === JSON.stringify(drag.layer)) return;
      if (!drag.changed) { hooks.begin(); drag.changed = true; }
      if (hooks.apply({ kind: "shape.replace", next }))
        drag.expected = drag.layer.points;
      return;
    }
    const l = drag.layer, h = drag.handle, p = reflectUV(coordinate(e), h.mirror);
    if (h.kind === "tangent") {
      const point = l.points[h.index], endpoint = drag.endpoint!;
      const next = moveTangent(point, h.side!, { u: endpoint.u + p.u - drag.start.u, v: endpoint.v + p.v - drag.start.v });
      if ((["in", "out"] as const).every(side => Math.hypot(next.handles![side].u - point.handles![side].u,
        next.handles![side].v - point.handles![side].v) < 1e-10)) return;
      if (!drag.changed) { hooks.begin(); drag.changed = true; }
      hooks.apply({ kind: "point.replace", index: h.index, next }); return;
    }
    const f = l.fields.find(f => f.id === h.fieldId);
    if (h.kind !== "point" && !f) { stop(); return; }
    const next = h.kind === "point" || h.kind === "origin" ? { u: clamp(p.u), v: clamp(p.v) }
      : { du: clamp(p.u - f!.u, -.1, .1), dv: clamp(p.v - f!.v, -.1, .1) };
    const target = h.kind === "point" ? l.points[h.index] : f!;
    if (Object.entries(next).every(([key, value]) => Math.abs((target as unknown as Record<string, number>)[key] - value) < 1e-7)) return;
    if (!drag.changed) { hooks.begin(); drag.changed = true; }
    if (h.kind === "point") hooks.apply({ kind: "point.replace", index: h.index, next });
    else hooks.apply({ kind: "field.replace", fieldId: h.fieldId!, next });
  };
  canvas.onpointerup = e => { if (drag?.pointer === e.pointerId) stop(); };
  canvas.onpointercancel = e => { if (drag?.pointer === e.pointerId) stop(true); };
  canvas.onlostpointercapture = e => { if (drag?.pointer === e.pointerId) stop(true); };
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    // Captured gestures own their coordinate frame and Undo entry until release.
    if (drag) return;
    if (!e.shiftKey) { finishWheel(); updateView(zoomUVView(view, coordinate(e), wheelScaleFactor(e.deltaY, e.deltaMode))); return; }
    const l = hooks.layer(); if (!l) { finishWheel(); return; }
    if (wheel && !validWheel()) finishWheel();
    if (wheel) { clearTimeout(wheel.timer); wheel.timer = setTimeout(() => finishWheel(), 250); }
    const pivot = l.points[hooks.selected()] ?? l.points[0];
    const factor = shapeWheelScaleFactor(e.deltaY, e.deltaMode);
    if (factor === 1) return;
    const next = transformLayer(l, { kind: "scale", pivot: { u: pivot.u, v: pivot.v }, factor });
    if (!next) { hooks.message("This scale reaches the layer's limits. Scroll back to continue."); return; }
    if (JSON.stringify(next) === JSON.stringify(l)) return;
    if (!wheel) {
      hooks.begin();
      wheel = { layer: l, recipe: hooks.recipe(), expected: l.points, state: "", selected: hooks.selected() };
    } else clearTimeout(wheel.timer);
    if (hooks.apply({ kind: "shape.replace", next })) {
      wheel.expected = l.points; wheel.state = JSON.stringify(hooks.recipe());
    }
    wheel.timer = setTimeout(() => finishWheel(), 250);
  }, { passive: false, signal: listeners.signal });
  canvas.oncontextmenu = e => e.preventDefault();
  window.addEventListener("pointerdown", e => { if (e.target !== canvas) finishWheel(); },
    { capture: true, signal: listeners.signal });
  window.addEventListener("blur", () => { stop(true); finishWheel(true); }, { signal: listeners.signal });
  window.addEventListener("keydown", e => {
    if ((drag || wheel) && cancelsGesture(e)) {
      // If another context replaced this one, leave its keyboard action alone.
      const valid = drag ? validDrag() : validWheel();
      if (valid) { e.preventDefault(); e.stopImmediatePropagation(); }
      stop(true); finishWheel(true);
    }
  }, { capture: true, signal: listeners.signal });
  canvas.ondblclick = e => {
    stop(); finishWheel();
    if (e.shiftKey || e.button !== 0) return;
    const l = hooks.layer(); if (!l) return;
    const p = coordinate(e), b = bounds(), r = region(), scale = { u: b.width / r.w, v: b.height / r.h };
    // Compare both displayed instances, not a hardcoded u<.5 folding rule.
    const candidates = (l.symmetry ? [false, true] : [false]).map(mirror => ({ mirror,
      click: reflectUV(p, mirror), section: nearestPathSection(l.points, reflectUV(p, mirror), scale) }));
    candidates.sort((a, b) => (a.section?.distancePx ?? Infinity) - (b.section?.distancePx ?? Infinity));
    const chosen = candidates[0], result = chosen && insertPathPoint(l.points, chosen.click, scale);
    if (!result) { hooks.message(l.points.length >= 24 ? "A shape supports up to 24 points." : "Choose a curve section inside the texture area and away from existing points."); return; }
    hooks.begin(); hooks.apply({ kind: "path.replacePoints", points: result.points });
    hooks.finish?.();
    hooks.select(result.index);
    view.side = p.u <= .5 ? "low" : "high";
  };
  const resize = new ResizeObserver(draw); resize.observe(canvas);
  // Browser zoom / moving between screens can change DPR without a CSS resize.
  window.addEventListener("resize", draw, { signal: listeners.signal });
  let dprQuery: MediaQueryList | undefined;
  function trackDPR() {
    dprQuery?.removeEventListener("change", changedDPR);
    if (typeof window.matchMedia === "function") {
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dprQuery.addEventListener("change", changedDPR, { once: true });
    }
  }
  function changedDPR() { trackDPR(); draw(); }
  trackDPR();
  const cancelInput = () => { stop(true); finishWheel(true); };
  function dispose() {
    cancelInput(); listeners.abort();
    resize.disconnect?.(); dprQuery?.removeEventListener("change", changedDPR);
    canvas.onpointerdown = canvas.onpointermove = canvas.onpointerup = canvas.onpointercancel = null;
    canvas.onlostpointercapture = canvas.oncontextmenu = canvas.ondblclick = null;
    if (elements) elements.both.onclick = elements.single.onclick = elements.other.onclick = elements.fit.onclick = null;
  }
  return { draw, resize: draw, cancelInput, dispose, hitAt, viewCommand,
    inputCapture: () => !!drag || !!wheel,
    snapshot: () => ({ ...view }), diagnostics: () => {
    const b = bounds();
    return { view: { ...view }, region: region(), aspect: b.width / b.height,
      resolution: { ...canvasResolution(b.width, b.height, window.devicePixelRatio),
        actualWidth: canvas.width, actualHeight: canvas.height,
        tintWidth: tinted.width, tintHeight: tinted.height }, dragging: !!drag, gesture: drag?.kind ?? (wheel ? "scale" : null),
      handles: handles().map(h => ({ ...h, screen: (() => { const p = uvToPixel(h.uv, region(), b.width, b.height);
        return { x: b.left + p.x, y: b.top + p.y }; })() })) };
  } };
}
