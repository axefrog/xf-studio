/**
 * The Holotable panel (research/live-world-view/proposal.md §4): the recordings, the replay drawn as a wireframe from the projection,
 * playback and the moment, what to show, story content behind a confirmation, and an inspector that says where a mark came from.
 * Controls come from the component library; the drawing is the projection's primitives written as SVG, coloured only by Studio tokens.
 * It acts only through its context's facade.
 */
import { applyCapability, button, emptyState, GroupSection, note, openConfirmPopover, propertyList, RecordList, Segmented,
  setButtonLabel, SliderWithValue, Toggle, type RecordRow } from "../../../studio-ui/components";
import { h, setText } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import type { ModuleViewContext } from "../../../studio-ui/views/feature-view";
import type { HolotableFacade } from "../facade";
import { HOLO_LAYERS, type HoloLayer, type HoloState } from "../service";
import { ORBITS, project, type Orbit, type Primitive, type Style } from "./projection";
import { HOLOTABLE_PANEL_META } from "./contribution";

type Ctx = ModuleViewContext<HolotableFacade>;
const NS = "http://www.w3.org/2000/svg";

const LAYER_LABELS: Readonly<Record<HoloLayer, string>> = { v: "V and trail", camera: "Camera", events: "Events with a place", gaps: "Recorder gaps",
  areas: "Districts", cells: "Streaming cells" };
/** Every colour is a Studio token: cyan for live data and selection, the stage's strongest neutral for V, warning for gaps. */
const STROKES: Readonly<Record<Style, string>> = {
  grid: "var(--line-strong)", area: "var(--text-muted)", venue: "var(--line-strong)", cell: "var(--line-strong)", trail: "var(--stage-strong)",
  v: "var(--stage-strong)", cone: "var(--stage-strong)", camera: "var(--signal)", event: "var(--signal)", "event-selected": "var(--signal)",
  gap: "var(--warning)", label: "var(--text)", "label-muted": "var(--text-muted)",
};
const DASH: Partial<Record<Style, string>> = { gap: "2 5", area: "10 4 2 4", camera: "4 3" };
const f1 = (n: number) => n.toFixed(1);
const heading = (yaw: number) => `${String(Math.round(((-yaw % 360) + 360) % 360)).padStart(3, "0")}°`;

export function holotablePanel(ctx: Ctx): PanelController {
  const facade = ctx.facade;
  let orbit: Orbit = { ...ORBITS.tilt };
  let drawnKey = "", runsKey = "", inspectKey = "";

  // Recordings
  const runs = new RecordList({ label: "Recordings" });
  const refresh = button({ label: "Refresh", icon: "refresh", small: true, variant: "quiet", onClick: () => { void ctx.dispatch({ kind: "holo.refresh" }, { quiet: true }); } });
  const recordings = new GroupSection({ title: "Recordings", key: "holotable:recordings", expanded: true, actions: [refresh] });
  recordings.body.append(runs.element);
  const status = h("p", { class: "note muted", role: "status" });

  // The drawing
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("role", "img"); svg.setAttribute("tabindex", "0");
  svg.setAttribute("aria-label", "Replay drawn from above: drag to orbit, scroll to zoom, arrow keys turn and tilt");
  svg.setAttribute("style", "display:block;width:100%;height:clamp(320px,52vh,720px);background:var(--stage);border:1px solid var(--line);cursor:grab;touch-action:none");
  const view = new Segmented<keyof typeof ORBITS>({ label: "View", showLabel: false, compact: true, options: [{ value: "top", label: "Top" }, { value: "tilt", label: "Tilt" }, { value: "low", label: "Low" }],
    onSelect: value => { orbit = { ...ORBITS[value] }; drawnKey = ""; ctx.changed(); } });
  const play = button({ label: "Play", icon: "play", small: true, onClick: () => { void ctx.dispatch({ kind: "holo.play", on: !facade.snapshot().playing }, { quiet: true }); } });
  const time = new SliderWithValue({ label: "Moment", min: 0, max: 1, step: 0.1, format: v => `${f1(v)} s`,
    transaction: { edit: v => { const s = facade.snapshot().open?.session; if (s) void ctx.dispatch({ kind: "holo.seek", t: s.meta.start + v }, { quiet: true }); } } });
  const readout = h("p", { class: "note muted mono", role: "status" });

  // What to show
  const toggles = HOLO_LAYERS.map(id => ({ id, toggle: new Toggle({ label: LAYER_LABELS[id], onChange: on => { void ctx.dispatch({ kind: "holo.layer", id, on }, { quiet: true }); } }) }));
  const layers = new GroupSection({ title: "Show", key: "holotable:layers", expanded: true });
  layers.body.append(...toggles.map(t => t.toggle.element));
  const story = button({ label: "Show story content…", icon: "eye", small: true, variant: "quiet", onClick: event => {
    const level = facade.snapshot().level;
    if (level === "full") { void ctx.dispatch({ kind: "holo.level", level: "structure" }); return; }
    openConfirmPopover(event.currentTarget as Element, { title: "Show story content?", confirm: "Show story",
      message: "Spoken lines and names appear in the replay and the inspector. Hiding them again takes one click.",
      onConfirm: () => { void ctx.dispatch({ kind: "holo.level", level: "full" }); } });
  } });
  const storyNote = note("", "muted");

  // Inspector
  const inspect = h("div", {});
  const inspector = new GroupSection({ title: "Selected", key: "holotable:inspector", expanded: true });
  inspector.body.append(inspect);
  const limits = note("", "muted");

  const element = h("div", { class: "panel-content holotable-panel" }, recordings.element, status,
    h("div", { class: "control-line" }, play, view.element), svg, time.element, readout, layers.element,
    h("div", { class: "control-line" }, story, storyNote), inspector.element, limits);

  // Gestures: orbit, zoom, pick. The viewpoint is this view's own; the selection is the service's.
  let drag: { id: number; x: number; y: number; yaw: number; pitch: number; moved: boolean } | null = null;
  svg.addEventListener("pointerdown", event => { drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: orbit.yaw, pitch: orbit.pitch, moved: false }; svg.setPointerCapture(event.pointerId); });
  svg.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    orbit = { ...orbit, yaw: drag.yaw - dx * 0.006, pitch: Math.max(0.12, Math.min(1.52, drag.pitch + dy * 0.005)) };
    drawnKey = ""; ctx.changed();
  });
  const endDrag = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const picked = !drag.moved ? (event.target as Element | null)?.getAttribute?.("data-id") : null;
    drag = null;
    if (picked !== undefined && picked !== null) void ctx.dispatch({ kind: "holo.select", id: picked }, { quiet: true });
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

  function draw(state: HoloState) {
    const open = state.open; if (!open) { svg.replaceChildren(); return; }
    const width = svg.clientWidth || 800, height = svg.clientHeight || 480;
    const scene = project(open.session, open.world, state.t, state.layers, orbit, width, height, state.selected);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const nodes: Element[] = scene.primitives.map(p => node(p));
    // Instrument chrome: edge ticks and a true scale bar.
    for (let x = 0; x < width; x += 40) nodes.push(line([[x, 0], [x, x % 200 ? 4 : 9]], "grid", 0.8), line([[x, height], [x, height - (x % 200 ? 4 : 9)]], "grid", 0.8));
    for (let y = 0; y < height; y += 40) nodes.push(line([[0, y], [y % 200 ? 4 : 9, y]], "grid", 0.8), line([[width, y], [width - (y % 200 ? 4 : 9), y]], "grid", 0.8));
    const bx = width - 24 - scene.barPx, by = height - 22;
    nodes.push(line([[bx, by - 4], [bx, by], [bx + scene.barPx, by], [bx + scene.barPx, by - 4]], "label-muted", 1));
    nodes.push(text([bx + scene.barPx, by - 8], `${scene.metresPerBar} m`, "label-muted", "end"));
    if (scene.inGap) nodes.push(text([16, 24], "No samples at this moment: nothing here proves what happened", "label-muted"));
    svg.replaceChildren(...nodes);
  }

  function node(p: Primitive): Element {
    if (p.kind === "line") return line(p.points, p.style, p.opacity);
    if (p.kind === "text") return text(p.at, p.text, p.style);
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
  function line(points: readonly (readonly [number, number])[], style: Style, opacity: number): Element {
    const e = document.createElementNS(NS, "polyline");
    e.setAttribute("points", points.map(q => `${f1(q[0])},${f1(q[1])}`).join(" "));
    e.setAttribute("style", `fill:none;stroke:${STROKES[style]};stroke-width:${style === "trail" ? 2 : style === "gap" ? 3 : 1};opacity:${opacity.toFixed(2)}${DASH[style] ? `;stroke-dasharray:${DASH[style]}` : ""}`);
    return e;
  }
  function text(at: readonly [number, number], value: string, style: Style, anchor: "start" | "end" = "start"): Element {
    const e = document.createElementNS(NS, "text");
    e.setAttribute("x", f1(at[0])); e.setAttribute("y", f1(at[1])); e.setAttribute("text-anchor", anchor);
    e.setAttribute("style", `fill:${STROKES[style]};font:11px var(--font-mono);paint-order:stroke;stroke:var(--bg-app);stroke-width:3px;stroke-linejoin:round`);
    e.textContent = value;
    return e;
  }

  function inspectorRows(state: HoloState): HTMLElement {
    const open = state.open; if (!open) return note("Open a recording to inspect what it holds.");
    const s = open.session, m = s.meta;
    if (state.selected && state.selected !== "v") {
      const e = s.events.find(x => x.id === state.selected);
      if (!e) return note("That mark isn't in this recording.");
      return propertyList([["What", e.summary], ...(e.detail ? [["Said", e.detail] as [string, string]] : []),
        { term: "When", value: `${f1(e.t - m.start)} s`, mono: true },
        ...(e.at ? [{ term: "Where", value: e.at.map(f1).join(", "), mono: true }] : []),
        { term: "Why", value: e.cite, mono: true }], { label: "Selected mark" });
    }
    const v = projectV(state);
    if (!v) return note("V has no sample yet at this moment.");
    return propertyList([
      { term: "Position", value: v.position.map(f1).join(", "), mono: true },
      { term: "Heading", value: heading(v.yaw), mono: true },
      { term: "Speed", value: `${f1(v.speed)} m/s`, mono: true },
      { term: "Health", value: `${v.health} of ${v.healthMax}`, mono: true },
      ["State", [v.inCombat ? "in combat" : "", v.vehicle ? "in a vehicle" : "", v.busy].filter(Boolean).join(", ") || "on foot"],
      { term: "Why", value: `recorder:${m.session}:${m.run}:${v.seq}`, mono: true },
    ], { label: "V" });
  }
  const projectV = (state: HoloState) => { const s = state.open?.session; if (!s) return undefined; let best; for (const v of s.v) { if (v.t > state.t) break; best = v; } return best; };

  return {
    spec: { id: "holotable.view", ...HOLOTABLE_PANEL_META["holotable.view"], element },
    update() {
      const state = facade.snapshot();
      const rk = JSON.stringify([state.runs.map(r => r.dir), state.open?.dir]);
      if (rk !== runsKey) {
        runsKey = rk;
        runs.update(state.runs.map((r): RecordRow => ({
          id: r.dir, name: `Session ${r.session.slice(0, 8)} · run ${r.run}`, current: state.open?.dir === r.dir,
          meta: [`${Math.round(r.end - r.start)} s`, `${(r.bytes / 1e6).toFixed(1)} MB`],
          action: state.open?.dir === r.dir ? undefined : button({ label: "Open", small: true, onClick: () => { void ctx.dispatch({ kind: "holo.open", dir: r.dir }); } }),
        })));
      }
      setText(status, state.phase === "ready" ? "" : state.message);
      status.hidden = !status.textContent;
      if (state.phase === "unavailable" || state.phase === "failed") {
        recordings.body.replaceChildren(emptyState(state.phase === "unavailable" ? "Holotable isn't available here" : "The recordings couldn't be read", state.message,
          button({ label: "Try again", icon: "refresh", onClick: () => { void ctx.dispatch({ kind: "holo.refresh" }); } })));
      } else if (!recordings.body.contains(runs.element)) recordings.body.replaceChildren(runs.element);
      const s = state.open?.session;
      applyCapability(play, facade.capability({ kind: "holo.play", on: true }));
      setButtonLabel(play, state.playing ? "Pause" : "Play");
      time.update(s ? state.t - s.meta.start : 0, { min: 0, max: s ? Math.max(0.1, s.meta.end - s.meta.start) : 1, disabled: !s, reason: s ? undefined : "Open a recording first." });
      for (const { id, toggle } of toggles) toggle.update(state.layers[id], {});
      setButtonLabel(story, state.level === "full" ? "Hide story content" : "Show story content…");
      applyCapability(story, facade.capability({ kind: "holo.level", level: "full" }));
      setText(storyNote, state.level === "full" ? "Story shown" : "Story hidden");
      if (s) {
        const v = projectV(state);
        setText(readout, `${f1(state.t - s.meta.start)} s of ${f1(s.meta.end - s.meta.start)} s${v ? ` · V ${heading(v.yaw)} · ${f1(v.speed)} m/s` : ""}`);
        setText(limits, `This recording: ${s.meta.dropped} dropped, ${s.meta.missedDeadlines} missed, largest gap ${f1(s.meta.largestGapS)} s. Districts and cells come from offline game data, an estimate of the live world.`);
      } else { setText(readout, ""); setText(limits, ""); }
      const dk = JSON.stringify([state.revision, orbit, svg.clientWidth, svg.clientHeight]);
      if (dk !== drawnKey) { drawnKey = dk; draw(state); }
      const ik = JSON.stringify([state.open?.dir, state.selected, state.level, Math.round(state.t * 10)]);
      if (ik !== inspectKey) { inspectKey = ik; inspect.replaceChildren(inspectorRows(state)); }
    },
  };
}
