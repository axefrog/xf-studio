/**
 * The Holotable view panel (research/live-world-view/proposal.md §4): the replay drawn as a wireframe from the projection, filling its
 * panel, with playback, the view presets and the moment under it. The recordings and the details are panels of their own over the same
 * service. Controls come from the component library; the drawing is the projection's primitives written as SVG, coloured only by Studio
 * tokens. It acts only through its context's facade.
 */
import { applyCapability, button, emptyState, Segmented, setButtonLabel, SliderWithValue } from "../../../studio-ui/components";
import { h, setText } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import type { ModuleViewContext } from "../../../studio-ui/views/feature-view";
import type { HolotableFacade } from "../facade";
import type { HoloState } from "../service";
import { ORBITS, fitOrbit, project, type Orbit, type Primitive, type Style } from "./projection";
import { HOLOTABLE_PANEL_META } from "./contribution";
import { f1, heading, vAt } from "./shared";
import { solidCanvas } from "./solid-canvas";
import { agentCanvas } from "./agent-canvas";
import { pickPlace } from "./place-picking";
import { createSolidSelection } from "./solid-selection";
import type { AgentLabel } from "./agent-labels";
import type { Vec3 } from "../types";

type Ctx = ModuleViewContext<HolotableFacade>;
const NS = "http://www.w3.org/2000/svg";

/** Every colour is a Studio token: cyan for live data and selection, the stage's strongest neutral for V, warning for gaps. */
const STROKES: Readonly<Record<Style, string>> = {
  people: "var(--text-muted)", grid: "var(--line-strong)", area: "var(--text-muted)", venue: "var(--line-strong)", cell: "var(--line-strong)", trail: "var(--stage-strong)",
  v: "var(--stage-strong)", cone: "var(--stage-strong)", camera: "var(--signal)", event: "var(--signal)", "event-selected": "var(--signal)",
  gap: "var(--warning)", label: "var(--text)", "label-muted": "var(--text-muted)",
};
const DASH: Partial<Record<Style, string>> = { gap: "2 5", area: "10 4 2 4", camera: "4 3" };
/** Each dash pattern's length (an odd-length list repeats twice), so a line cut at the edge continues its pattern in phase. */
const DASH_PERIOD = Object.fromEntries(Object.entries(DASH).map(([style, d]) => { const xs = d!.split(" ").map(Number), sum = xs.reduce((a, b) => a + b, 0); return [style, xs.length % 2 ? sum * 2 : sum]; })) as Partial<Record<Style, number>>;

export interface HolotableFrame { ms: number; projectMs: number; drawMs: number; width: number; height: number; solids: number; cut: number; pending?: boolean; preparationFrames?: number; preparationMs?: number }
export function holotablePanel(ctx: Ctx, measured?: (frame: HolotableFrame) => void): PanelController {
  const facade = ctx.facade;
  let orbit: Orbit = { ...ORBITS.tilt };
  let fittedDir = "", hovered: string | null = null, zoomLimit = 1500;
  let drawnKey = "", emptyKey = "";

  // The drawing takes all the height the panel has: no scrollbar, the controls in one line under it.
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("role", "img"); svg.setAttribute("tabindex", "0");
  svg.setAttribute("aria-label", "Replay drawn from above: drag to orbit, scroll to zoom, arrow keys turn and tilt");
  // The drawing gives way first in a short panel (it may shrink to nothing), so the controls under it stay in reach.
  svg.setAttribute("style", "position:absolute;inset:0;display:block;height:100%;width:100%;cursor:grab;touch-action:none");
  const canvas = document.createElement("canvas"); canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  const agents = document.createElement("canvas"); agents.setAttribute("aria-hidden", "true"); agents.style.cssText = canvas.style.cssText;
  const stage = h("div", { style: "position:relative;flex:1 1 auto;min-height:0;width:100%;background:var(--stage);border:1px solid var(--line);overflow:hidden" }, canvas, agents, svg);
  const solidsCanvas = solidCanvas(canvas, () => { drawnKey = ""; ctx.changed(); });
  const layersCanvas = agentCanvas(agents, () => { drawnKey = ""; ctx.changed(); });
  let currentScene: ReturnType<typeof project> | undefined;
  const solidSelection = createSolidSelection();
  let resumeFrame: number | undefined, disposed = false, preparationFrames = 0, preparationMs = 0;
  const emptySolids: never[] = [];
  const empty = h("div", { style: "flex:1 1 auto;min-height:0" });
  // The panel can be resized, docked or floated at any time: redraw at the new size.
  // A press orbits or picks without taking keyboard focus, so the focus ring shows only when someone tabs in to turn the view by keys.
  svg.addEventListener("mousedown", event => event.preventDefault());
  const resized = new ResizeObserver(() => ctx.changed());
  resized.observe(svg);
  const view = new Segmented<keyof typeof ORBITS>({ label: "View", showLabel: false, compact: true, options: [{ value: "top", label: "Top" }, { value: "tilt", label: "Tilt" }, { value: "low", label: "Low" }],
    onSelect: value => { orbit = { ...ORBITS[value] }; drawnKey = ""; ctx.changed(); } });
  const play = button({ label: "Play", small: true, onClick: () => { void ctx.dispatch({ kind: "holo.play", on: !facade.snapshot().playing }, { quiet: true }); } });
  const time = new SliderWithValue({ label: "Moment", min: 0, max: 1, step: 0.1, format: v => `${f1(v)} s`,
    transaction: { edit: v => { const s = facade.snapshot().open?.session; if (s) void ctx.dispatch({ kind: "holo.seek", t: s.meta.from + v }, { quiet: true }); } } });
  const readout = h("span", { class: "note muted mono", role: "status", style: "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" });
  const backToLive = button({ label: "Back to live", small: true, variant: "quiet", onClick: () => { void ctx.dispatch({ kind: "holo.follow" }, { quiet: true }); } });
  const branches = new Segmented<string>({ label: "Branch", options: [], onSelect: branch => { void ctx.dispatch({ kind: "holo.branch", branch }); } });
  branches.element.style.flex = "0 0 auto";

  for (const control of [play, view.element, backToLive]) control.style.flex = "0 0 auto";
  const controls = h("div", { class: "control-line", style: "flex:0 0 auto;flex-wrap:nowrap" }, play, view.element, readout, backToLive);
  time.element.style.flex = "0 0 auto"; // the drawing takes the room; the controls keep their own height
  const element = h("div", { class: "panel-content holotable-panel", style: "display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;overflow:auto" },
    empty, stage, branches.element, time.element, controls);

  // Gestures: orbit, zoom, pick. The viewpoint is this view's own; the selection is the service's.
  // The mark under the pointer is read on press: pointer capture retargets the release to the drawing itself.
  let drag: { id: number; x: number; y: number; yaw: number; pitch: number; moved: boolean; mark: string | null } | null = null;
  svg.addEventListener("pointerdown", event => {
    const bounds = svg.getBoundingClientRect();
    const mark = (event.target as Element | null)?.closest?.("[data-id]")?.getAttribute("data-id") ?? layersCanvas.pick(event.clientX - bounds.left, event.clientY - bounds.top);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: orbit.yaw, pitch: orbit.pitch, moved: false, mark };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener("pointermove", event => {
    if (!drag) {
      const bounds = svg.getBoundingClientRect(), key = layersCanvas.pick(event.clientX - bounds.left, event.clientY - bounds.top);
      if (key !== hovered) { hovered = key; drawnKey = ""; ctx.changed(); }
      svg.style.cursor = key ? "pointer" : "grab";
      return;
    }
    if (event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    orbit = { ...orbit, yaw: drag.yaw - dx * 0.006, pitch: Math.max(0.12, Math.min(1.52, drag.pitch + dy * 0.005)) };
    drawnKey = ""; ctx.changed();
  });
  svg.addEventListener("pointerleave", () => { if (hovered) { hovered = null; drawnKey = ""; ctx.changed(); } });
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const clicked = !drag.moved, picked = clicked ? drag.mark : null;
    drag = null;
    if (picked) void ctx.dispatch({ kind: "holo.select", id: picked }, { quiet: true });
    else if (clicked && currentScene) {
      const bounds = svg.getBoundingClientRect(), state = facade.snapshot();
      const place = pickPlace(currentScene.solidCamera, event.clientX-bounds.left, event.clientY-bounds.top, currentScene.solids.map(s=>s.source), currentScene.v?.position[2] ?? focusAt(state)[2]);
      if (place) void ctx.dispatch({ kind: "holo.place", position: place }, { quiet: true });
    }
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", () => { drag = null; });
  svg.addEventListener("wheel", event => { event.preventDefault(); orbit = { ...orbit, distance: Math.max(40, Math.min(zoomLimit, orbit.distance * (event.deltaY > 0 ? 1.12 : 1 / 1.12))) }; drawnKey = ""; ctx.changed(); }, { passive: false });
  svg.addEventListener("keydown", event => {
    const turn = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, 0.08], ArrowDown: [0, -0.08] }[event.key];
    if (!turn) return;
    event.preventDefault();
    orbit = { ...orbit, yaw: orbit.yaw + turn[0], pitch: Math.max(0.12, Math.min(1.52, orbit.pitch + turn[1])) };
    drawnKey = ""; ctx.changed();
  });

  // The drawing reuses its nodes: each frame sets the attributes that changed on pooled lines and labels, instead of building
  // hundreds of elements per playback tick. The edge ticks change only with the drawing's size.
  const chrome = document.createElementNS(NS, "g"), linesLayer = document.createElementNS(NS, "g"), marksLayer = document.createElementNS(NS, "g"), textLayer = document.createElementNS(NS, "g");
  const message = document.createElementNS(NS, "text"); message.setAttribute("role", "status");
  svg.append(chrome, linesLayer, marksLayer, textLayer, message);
  let messageKey = "";
  let chromeSize = "";
  const pooled = (layer: SVGGElement, tag: "polyline" | "text", index: number): SVGElement => {
    let e = layer.children[index] as SVGElement | undefined;
    if (!e) { e = document.createElementNS(NS, tag); layer.append(e); }
    return e;
  };
  const set = (e: Element, name: string, value: string) => { if (e.getAttribute(name) !== value) e.setAttribute(name, value); };
  const trim = (layer: SVGGElement, used: number) => { while (layer.children.length > used) layer.lastElementChild!.remove(); };

  function draw(state: HoloState) {
    if (resumeFrame !== undefined) { cancelAnimationFrame(resumeFrame); resumeFrame = undefined; }
    const open = state.open;
    if (!open || state.phase === "opening") { solidsCanvas.clear(svg.clientWidth, svg.clientHeight); layersCanvas.clear(svg.clientWidth, svg.clientHeight); trim(linesLayer, 0); trim(marksLayer, 0); trim(textLayer, 0); trim(chrome, 0); message.textContent = ""; messageKey = ""; chromeSize = ""; return; }
    const width = svg.clientWidth || 800, height = svg.clientHeight || 480;
    const started = performance.now();
    if (fittedDir !== open.dir) {
      const extent = open.session.meta.standalone?.extent;
      orbit = extent ? fitOrbit(extent, ORBITS.tilt, width, height) : { ...ORBITS.tilt };
      zoomLimit = Math.max(1500, orbit.distance * 4); fittedDir = open.dir;
    }
    const scene = project(open.session, open.world, state.t, state.layers, orbit, width, height, state.selected, open.session.meta.standalone ? focusAt(state) : undefined, { instances: [], cut: 0 });
    currentScene = scene;
    if (open.session.meta.standalone) void ctx.dispatch({ kind: "holo.focus", position: scene.solidCamera.target }, { quiet: true });
    const projectedAt = performance.now();
    set(svg, "viewBox", `0 0 ${width} ${height}`);
    const bx = width - 24 - scene.barPx, by = height - 22;
    const worldText = scene.primitives.filter((p): p is Extract<Primitive, { kind: "text" }> => p.kind === "text");
    const extraLabels: AgentLabel[] = worldText.map((p, i) => ({ key: `world:${i}`, text: p.text, x: p.at[0], y: p.at[1], priority: p.id === state.selected ? -1 : 4, colour: "", alpha: 1, overlay: true }));
    extraLabels.push({ key: "scale", text: `${scene.metresPerBar} m`, x: bx + scene.barPx, y: by - 8, priority: 4, colour: "", alpha: 1, overlay: true, align: "end" });
    const extent = open.session.meta.standalone?.extent;
    const radius = extent ? Math.max(350, Math.hypot(...extent.max.map((n, axis) => n - extent.min[axis]))) : 350;
    const agentProgress = layersCanvas.draw(state.agents, state.agentEnabled, scene.solidCamera, state.selected, Math.max(0, Math.min(4, started + 6 - performance.now())), hovered, extraLabels, radius);
    const target = open.session.meta.standalone ? focusAt(state) : scene.v?.position ?? [0,0,0] as Vec3;
    const solidStarted = performance.now();
    const prepared = solidSelection.step(state.layers.solids ? open.world.solids ?? emptySolids : emptySolids, target, scene.solidCamera, Math.min(started + 3.5, solidStarted + 1.5));
    const solidProgress = solidsCanvas.draw(prepared.instances, scene.solidCamera, started + 5.5);
    scene.solids = prepared.instances.slice(0, solidProgress.drawn); scene.solidsDrawn = solidProgress.drawn; scene.solidsCut = prepared.cut;
    const pending = prepared.pending || solidProgress.pending || !!agentProgress?.pending;
    preparationFrames++; preparationMs += performance.now() - solidStarted;
    const paintedAt = performance.now();
    if (chromeSize !== `${width}x${height}`) {
      chromeSize = `${width}x${height}`;
      const ticks: Element[] = [];
      for (let x = 0; x < width; x += 40) ticks.push(line([[x, 0], [x, x % 200 ? 4 : 9]], "grid", 0.8), line([[x, height], [x, height - (x % 200 ? 4 : 9)]], "grid", 0.8));
      for (let y = 0; y < height; y += 40) ticks.push(line([[0, y], [y % 200 ? 4 : 9, y]], "grid", 0.8), line([[width, y], [width - (y % 200 ? 4 : 9), y]], "grid", 0.8));
      chrome.replaceChildren(...ticks);
    }
    const lineList = scene.primitives.filter((p): p is Extract<Primitive, { kind: "line" }> => p.kind === "line");
    lineList.push({ kind: "line", points: [[bx, by - 4], [bx, by], [bx + scene.barPx, by], [bx + scene.barPx, by - 4]], style: "label-muted", opacity: 1 });
    lineList.forEach((p, i) => paintLine(pooled(linesLayer, "polyline", i), p.points, p.style, p.opacity, p.dashOffset));
    trim(linesLayer, lineList.length);
    const notice = state.live.watching && state.message ? state.message : scene.inGap ? "No samples at this moment: nothing here proves what happened" :
      scene.camStale && state.layers.camera ? "No fresh camera sample at this moment" : "";
    paintMessage(notice, width);
    const textList = layersCanvas.overlayLabels();
    textList.forEach((p, i) => paintText(pooled(textLayer, "text", i), [p.x, p.y], p.text, p.key === "scale" ? "label-muted" : worldText[Number(p.key.slice(6))].style));
    trim(textLayer, textList.length);
    // Markers are few (V and the placed events): rebuilt each frame.
    marksLayer.replaceChildren(...scene.primitives.filter(p => p.kind === "marker").map(p => marker(p as Extract<Primitive, { kind: "marker" }>)));
    measured?.({ ms: performance.now() - started, projectMs: projectedAt - started, drawMs: paintedAt - projectedAt, width, height, solids: scene.solidsDrawn, cut: scene.solidsCut, pending, preparationFrames, preparationMs });
    if (pending && !disposed) resumeFrame = requestAnimationFrame(() => {
      resumeFrame = undefined;
      if (!disposed && element.isConnected && element.getClientRects().length) { drawnKey = ""; draw(facade.snapshot()); }
      else solidSelection.cancel();
    });
    else { preparationFrames = 0; preparationMs = 0; }
  }
  function focusAt(state: HoloState): Vec3 {
    if (state.position) return state.position;
    const items = state.agents.layers.filter(l => state.agentEnabled[l.id] !== false).flatMap(l=>l.items).filter(i=>i.place);
    const selected = items.find(i=>i.key===state.selected); if (selected?.place) return selected.place;
    const extent = state.open?.session.meta.standalone?.extent;
    if (extent) return extent.min.map((n, axis) => (n + extent.max[axis]) / 2) as unknown as Vec3;
    if (!items.length) return [0,0,0];
    return [0,1,2].map(axis => (Math.min(...items.map(i=>i.place![axis]))+Math.max(...items.map(i=>i.place![axis])))/2) as unknown as Vec3;
  }

  function marker(p: Extract<Primitive, { kind: "marker" }>): Element {
    const g = document.createElementNS(NS, "g");
    if (p.id) { g.setAttribute("data-id", p.id); g.setAttribute("style", "cursor:pointer"); }
    const [x, y] = p.at, s = p.size, colour = STROKES[p.style];
    const shape = document.createElementNS(NS, p.shape === "dot" ? "circle" : "polygon");
    if (p.shape === "chevron") {
      const a = p.angle ?? 0, pt = (d: number, t: number) => `${x + d * Math.cos(a + t)},${y + d * Math.sin(a + t)}`;
      shape.setAttribute("points", `${pt(s, 0)} ${pt(s * 0.7, 2.5)} ${pt(s * 0.25, Math.PI)} ${pt(s * 0.7, -2.5)}`);
    } else if (p.shape === "diamond") shape.setAttribute("points", `${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`);
    else { shape.setAttribute("cx", String(x)); shape.setAttribute("cy", String(y)); shape.setAttribute("r", String(s / 2)); }
    shape.setAttribute("style", `fill:${p.style === "event" ? "var(--signal-bg)" : colour};stroke:${p.style === "v" ? "var(--bg-app)" : colour};stroke-width:${p.style === "people" ? 0 : 1.5}`);
    if (p.id) shape.setAttribute("data-id", p.id);
    g.append(shape);
    if (p.style === "event-selected") { const ring = document.createElementNS(NS, "circle"); ring.setAttribute("cx", String(x)); ring.setAttribute("cy", String(y)); ring.setAttribute("r", String(s + 5)); ring.setAttribute("style", "fill:none;stroke:var(--signal);stroke-width:2"); g.append(ring); }
    return g;
  }
  function paintLine(e: Element, points: readonly (readonly [number, number])[], style: Style, opacity: number, dashOffset = 0) {
    set(e, "points", points.map(q => `${f1(q[0])},${f1(q[1])}`).join(" "));
    const dash = DASH[style], phase = dash ? dashOffset % DASH_PERIOD[style]! : 0;
    set(e, "style", `fill:none;stroke:${STROKES[style]};stroke-width:${style === "trail" ? 2 : style === "gap" ? 3 : 1};opacity:${opacity.toFixed(2)}${dash ? `;stroke-dasharray:${dash};stroke-dashoffset:${f1(phase)}` : ""}`);
  }
  function line(points: readonly (readonly [number, number])[], style: Style, opacity: number): Element {
    const e = document.createElementNS(NS, "polyline"); paintLine(e, points, style, opacity); return e;
  }
  function paintText(e: Element, at: readonly [number, number], value: string, style: Style, anchor: "start" | "end" = "start") {
    set(e, "x", f1(at[0])); set(e, "y", f1(at[1])); set(e, "text-anchor", anchor);
    set(e, "style", `fill:${STROKES[style]};font:11px var(--font-mono);paint-order:stroke;stroke:var(--bg-app);stroke-width:3px;stroke-linejoin:round`);
    if (e.textContent !== value) e.textContent = value;
  }
  /** The drawing's top-left notice wraps inside the stage, without changing its height. */
  function paintMessage(value: string, width: number) {
    const key = JSON.stringify([value, width]); if (key === messageKey) return; messageKey = key;
    paintText(message, [16, 24], "", "label-muted");
    message.setAttribute("aria-label", value);
    let span: SVGTSpanElement | undefined, line = "";
    for (const word of value.split(/\s+/).filter(Boolean)) {
      if (!span) { span = document.createElementNS(NS, "tspan"); span.setAttribute("x", "16"); message.append(span); }
      span.textContent = line ? `${line} ${word}` : word;
      if (line && span.getComputedTextLength() > Math.max(1, width - 32)) {
        span.textContent = line;
        span = document.createElementNS(NS, "tspan"); span.setAttribute("x", "16"); span.setAttribute("dy", "16"); message.append(span);
        line = word; span.textContent = word;
      } else line = span.textContent;
    }
  }

  return {
    spec: { id: "holotable.view", ...HOLOTABLE_PANEL_META["holotable.view"], element },
    update() {
      const state = facade.snapshot(), s = state.open?.session;
      const branchNames = s?.meta.standalone?.branches ?? [];
      branches.element.hidden = branchNames.length < 2;
      branches.setOptions(branchNames.map(value => ({ value, label: value }))); if (state.branch) branches.update(state.branch);
      // Nothing open: one plain line where the drawing goes, pointing at Recordings.
      const ek = JSON.stringify([!!s, state.phase, state.message, state.runs.length]);
      if (ek !== emptyKey) {
        emptyKey = ek;
        const opening = state.phase === "opening";
        empty.replaceChildren(...(s && !opening && !state.openError ? [] : [openNotice(state, dir => { void ctx.dispatch({ kind: "holo.open", dir }); })]));
        empty.hidden = !!s && !opening && !state.openError; stage.style.display = s && !opening && !state.openError ? "block" : "none";
      }
      applyCapability(play, facade.capability({ kind: "holo.play", on: true }));
      setButtonLabel(play, state.live.following || state.playing ? "Pause" : "Play");
      play.setAttribute("aria-pressed", String(state.live.following || state.playing));
      backToLive.hidden = !state.live.watching || state.live.following;
      applyCapability(backToLive, facade.capability({ kind: "holo.follow" }));
      time.relabel(s?.meta.standalone?.clock === "game" ? "Game time" : "Moment");
      time.update(s ? state.t - s.meta.from : 0, { min: 0, max: s ? Math.max(0.1, s.meta.to - s.meta.from) : 1, disabled: !s, reason: s ? undefined : "Open a recording first.", text: s?.meta.standalone?.clock === "game" ? gameTime(state.t) : undefined });
      if (s) {
        const v = vAt(state);
        const reconnecting = state.live.watching && state.live.phase === "disconnected";
        setText(readout, s.meta.standalone ? momentItems(state) : `${reconnecting ? "Reconnecting · " : state.live.following ? "Live · " : ""}${f1(state.t - s.meta.from)} s${state.live.following ? "" : ` of ${f1(s.meta.to - s.meta.from)} s`}${v ? ` · V ${heading(v.yaw)} · ${f1(v.speed)} m/s` : ""}${state.live.following && !reconnecting && state.live.behindS > 2 ? ` · ${f1(state.live.behindS)} s behind` : ""}`);
      } else setText(readout, "");
      readout.title = readout.textContent ?? "";
      const dk = JSON.stringify([state.revision, orbit, svg.clientWidth, svg.clientHeight]);
      if (dk !== drawnKey) { drawnKey = dk; draw(state); }
    },
    dispose() { disposed = true; if (resumeFrame !== undefined) cancelAnimationFrame(resumeFrame); solidSelection.cancel(); resized.disconnect(); solidsCanvas.dispose(); layersCanvas.dispose(); },
  };
}
function gameTime(t: number) { const day = Math.floor(t / 86400) + 1, hour = Math.floor(t / 3600) % 24, minute = Math.floor(t / 60) % 60; return `Day ${day} · ${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`; }

export function momentItems(state: HoloState): string {
  const count = state.agents.layers.reduce((n, layer) => n + (state.agentEnabled[layer.id] === false ? 0 : layer.items.length), 0);
  return count ? `${count} ${count === 1 ? "item" : "items"} at this moment` : "";
}

/** Shared empty-state composition also exercised without a canvas in presentation tests. */
export function openNotice(state: HoloState, retry: (dir: string) => void): HTMLElement {
  const error = state.openError;
  if (error) return emptyState(`Couldn't open ${error.title}: ${error.reason}`, "", button({ label: "Try again", onClick: () => retry(error.dir) }));
  const opening = state.phase === "opening";
  return emptyState(state.live.watching ? "Live game" : opening ? "Opening recording" : "No recording open", state.live.watching || opening ? state.message : state.runs.length ? "Open one in Recordings to replay it here." : "Recordings appear here after a test session with the recorder on.");
}
