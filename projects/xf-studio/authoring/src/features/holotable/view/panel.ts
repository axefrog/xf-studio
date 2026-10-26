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
import { ORBITS, project, type Orbit, type Primitive, type Style } from "./projection";
import { HOLOTABLE_PANEL_META } from "./contribution";
import { f1, heading, vAt } from "./shared";

type Ctx = ModuleViewContext<HolotableFacade>;
const NS = "http://www.w3.org/2000/svg";

/** Every colour is a Studio token: cyan for live data and selection, the stage's strongest neutral for V, warning for gaps. */
const STROKES: Readonly<Record<Style, string>> = {
  grid: "var(--line-strong)", area: "var(--text-muted)", venue: "var(--line-strong)", cell: "var(--line-strong)", trail: "var(--stage-strong)",
  v: "var(--stage-strong)", cone: "var(--stage-strong)", camera: "var(--signal)", event: "var(--signal)", "event-selected": "var(--signal)",
  gap: "var(--warning)", label: "var(--text)", "label-muted": "var(--text-muted)",
};
const DASH: Partial<Record<Style, string>> = { gap: "2 5", area: "10 4 2 4", camera: "4 3" };
/** Each dash pattern's length (an odd-length list repeats twice), so a line cut at the edge continues its pattern in phase. */
const DASH_PERIOD = Object.fromEntries(Object.entries(DASH).map(([style, d]) => { const xs = d!.split(" ").map(Number), sum = xs.reduce((a, b) => a + b, 0); return [style, xs.length % 2 ? sum * 2 : sum]; })) as Partial<Record<Style, number>>;

export function holotablePanel(ctx: Ctx): PanelController {
  const facade = ctx.facade;
  let orbit: Orbit = { ...ORBITS.tilt };
  let drawnKey = "", emptyKey = "";

  // The drawing takes all the height the panel has: no scrollbar, the controls in one line under it.
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("role", "img"); svg.setAttribute("tabindex", "0");
  svg.setAttribute("aria-label", "Replay drawn from above: drag to orbit, scroll to zoom, arrow keys turn and tilt");
  // The drawing gives way first in a short panel (it may shrink to nothing), so the controls under it stay in reach.
  svg.setAttribute("style", "display:block;flex:1 1 auto;min-height:0;width:100%;background:var(--stage);border:1px solid var(--line);cursor:grab;touch-action:none");
  const empty = h("div", { style: "flex:1 1 auto;min-height:0" });
  // The panel can be resized, docked or floated at any time: redraw at the new size.
  // A press orbits or picks without taking keyboard focus, so the focus ring shows only when someone tabs in to turn the view by keys.
  svg.addEventListener("mousedown", event => event.preventDefault());
  const resized = new ResizeObserver(() => ctx.changed());
  resized.observe(svg);
  const view = new Segmented<keyof typeof ORBITS>({ label: "View", showLabel: false, compact: true, options: [{ value: "top", label: "Top" }, { value: "tilt", label: "Tilt" }, { value: "low", label: "Low" }],
    onSelect: value => { orbit = { ...ORBITS[value] }; drawnKey = ""; ctx.changed(); } });
  const play = button({ label: "Play", icon: "play", small: true, onClick: () => { void ctx.dispatch({ kind: "holo.play", on: !facade.snapshot().playing }, { quiet: true }); } });
  const time = new SliderWithValue({ label: "Moment", min: 0, max: 1, step: 0.1, format: v => `${f1(v)} s`,
    transaction: { edit: v => { const s = facade.snapshot().open?.session; if (s) void ctx.dispatch({ kind: "holo.seek", t: s.meta.from + v }, { quiet: true }); } } });
  const readout = h("span", { class: "note muted mono", role: "status" });

  const controls = h("div", { class: "control-line", style: "flex:0 0 auto" }, play, view.element, readout);
  time.element.style.flex = "0 0 auto"; // the drawing takes the room; the controls keep their own height
  const element = h("div", { class: "panel-content holotable-panel", style: "display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;overflow:auto" },
    empty, svg, time.element, controls);

  // Gestures: orbit, zoom, pick. The viewpoint is this view's own; the selection is the service's.
  // The mark under the pointer is read on press: pointer capture retargets the release to the drawing itself.
  let drag: { id: number; x: number; y: number; yaw: number; pitch: number; moved: boolean; mark: string | null } | null = null;
  svg.addEventListener("pointerdown", event => {
    const mark = (event.target as Element | null)?.closest?.("[data-id]")?.getAttribute("data-id") ?? null;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: orbit.yaw, pitch: orbit.pitch, moved: false, mark };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    orbit = { ...orbit, yaw: drag.yaw - dx * 0.006, pitch: Math.max(0.12, Math.min(1.52, drag.pitch + dy * 0.005)) };
    drawnKey = ""; ctx.changed();
  });
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const picked = !drag.moved ? drag.mark : null;
    drag = null;
    if (picked) void ctx.dispatch({ kind: "holo.select", id: picked }, { quiet: true });
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", () => { drag = null; });
  svg.addEventListener("wheel", event => { event.preventDefault(); orbit = { ...orbit, distance: Math.max(40, Math.min(1500, orbit.distance * (event.deltaY > 0 ? 1.12 : 1 / 1.12))) }; drawnKey = ""; ctx.changed(); }, { passive: false });
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
  svg.append(chrome, linesLayer, marksLayer, textLayer);
  let chromeSize = "";
  const pooled = (layer: SVGGElement, tag: "polyline" | "text", index: number): SVGElement => {
    let e = layer.children[index] as SVGElement | undefined;
    if (!e) { e = document.createElementNS(NS, tag); layer.append(e); }
    return e;
  };
  const set = (e: Element, name: string, value: string) => { if (e.getAttribute(name) !== value) e.setAttribute(name, value); };
  const trim = (layer: SVGGElement, used: number) => { while (layer.children.length > used) layer.lastElementChild!.remove(); };

  function draw(state: HoloState) {
    const open = state.open;
    if (!open) { trim(linesLayer, 0); trim(marksLayer, 0); trim(textLayer, 0); trim(chrome, 0); chromeSize = ""; return; }
    const width = svg.clientWidth || 800, height = svg.clientHeight || 480;
    const scene = project(open.session, open.world, state.t, state.layers, orbit, width, height, state.selected);
    set(svg, "viewBox", `0 0 ${width} ${height}`);
    if (chromeSize !== `${width}x${height}`) {
      chromeSize = `${width}x${height}`;
      const ticks: Element[] = [];
      for (let x = 0; x < width; x += 40) ticks.push(line([[x, 0], [x, x % 200 ? 4 : 9]], "grid", 0.8), line([[x, height], [x, height - (x % 200 ? 4 : 9)]], "grid", 0.8));
      for (let y = 0; y < height; y += 40) ticks.push(line([[0, y], [y % 200 ? 4 : 9, y]], "grid", 0.8), line([[width, y], [width - (y % 200 ? 4 : 9), y]], "grid", 0.8));
      chrome.replaceChildren(...ticks);
    }
    const bx = width - 24 - scene.barPx, by = height - 22;
    const lineList = scene.primitives.filter((p): p is Extract<Primitive, { kind: "line" }> => p.kind === "line");
    lineList.push({ kind: "line", points: [[bx, by - 4], [bx, by], [bx + scene.barPx, by], [bx + scene.barPx, by - 4]], style: "label-muted", opacity: 1 });
    lineList.forEach((p, i) => paintLine(pooled(linesLayer, "polyline", i), p.points, p.style, p.opacity, p.dashOffset));
    trim(linesLayer, lineList.length);
    const textList: { at: readonly [number, number]; text: string; style: Style; anchor?: "end" }[] =
      scene.primitives.filter((p): p is Extract<Primitive, { kind: "text" }> => p.kind === "text").map(p => ({ at: p.at, text: p.text, style: p.style }));
    textList.push({ at: [bx + scene.barPx, by - 8], text: `${scene.metresPerBar} m`, style: "label-muted", anchor: "end" });
    if (scene.inGap) textList.push({ at: [16, 24], text: "No samples at this moment: nothing here proves what happened", style: "label-muted" });
    else if (scene.camStale && state.layers.camera) textList.push({ at: [16, 24], text: "No fresh camera sample at this moment", style: "label-muted" });
    textList.forEach((p, i) => paintText(pooled(textLayer, "text", i), p.at, p.text, p.style, p.anchor));
    trim(textLayer, textList.length);
    // Markers are few (V and the placed events): rebuilt each frame.
    marksLayer.replaceChildren(...scene.primitives.filter(p => p.kind === "marker").map(p => marker(p as Extract<Primitive, { kind: "marker" }>)));
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
    shape.setAttribute("style", `fill:${p.style === "event" ? "var(--signal-bg)" : colour};stroke:${p.style === "v" ? "var(--bg-app)" : colour};stroke-width:1.5`);
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

  return {
    spec: { id: "holotable.view", ...HOLOTABLE_PANEL_META["holotable.view"], element },
    update() {
      const state = facade.snapshot(), s = state.open?.session;
      // Nothing open: one plain line where the drawing goes, pointing at Recordings.
      const ek = JSON.stringify([!!s, state.phase, state.runs.length]);
      if (ek !== emptyKey) {
        emptyKey = ek;
        empty.replaceChildren(...(s ? [] : [emptyState("No recording open", state.runs.length ? "Open one in Recordings to replay it here." : "Recordings appear here after a test session with the recorder on.")]));
        empty.hidden = !!s; svg.style.display = s ? "block" : "none";
      }
      applyCapability(play, facade.capability({ kind: "holo.play", on: true }));
      setButtonLabel(play, state.playing ? "Pause" : "Play");
      time.update(s ? state.t - s.meta.from : 0, { min: 0, max: s ? Math.max(0.1, s.meta.to - s.meta.from) : 1, disabled: !s, reason: s ? undefined : "Open a recording first." });
      if (s) {
        const v = vAt(state);
        setText(readout, `${f1(state.t - s.meta.from)} s of ${f1(s.meta.to - s.meta.from)} s${v ? ` · V ${heading(v.yaw)} · ${f1(v.speed)} m/s` : ""}`);
      } else setText(readout, "");
      const dk = JSON.stringify([state.revision, orbit, svg.clientWidth, svg.clientHeight]);
      if (dk !== drawnKey) { drawnKey = dk; draw(state); }
    },
    dispose() { resized.disconnect(); },
  };
}

