import { uvAspect } from "../../uv-view";
import type { ViewportHostKind } from "../../viewport-attachment";
import { Segmented, button, applyCapability } from "../controls";
import { h, setAttr, setText, isTextInput } from "../dom";
import { icon } from "../icons";
import { openMenu, type MenuAnchor, type MenuItem } from "../menu";
import type { Frame, StudioRuntime } from "../runtime";
import { contextItems } from "../target-menus";
import type { PanelController } from "./collection";
import { PANEL_META } from "../panel-meta";

/** Right-drag pans both viewports; only a stationary right-click opens the menu. */
function contextMenuGate(target: HTMLElement, open: (event: MouseEvent) => void) {
  let down: { x: number; y: number } | undefined;
  target.addEventListener("pointerdown", event => { if (event.button === 2) down = { x: event.clientX, y: event.clientY }; }, true);
  target.addEventListener("contextmenu", event => {
    event.preventDefault();
    const moved = down ? Math.hypot(event.clientX - down.x, event.clientY - down.y) : 0;
    down = undefined;
    if (moved > 4) return;
    open(event);
  });
}

function viewItems(rt: StudioRuntime, kind: ViewportHostKind): MenuItem[] {
  const port = rt.port;
  if (kind === "uv") {
    const view = port.viewport.snapshot().uv.view;
    const command = (id: "both" | "single" | "other" | "fit", label: string, key: string): MenuItem => ({ kind: "action", label, shortcut: key,
      capability: port.viewport.uvCommandCapability(id), checked: id === "both" ? view?.mode === "both" : id === "single" ? view?.mode === "single" : undefined,
      run: () => { port.viewport.uvCommand(id); } });
    return [{ kind: "heading", label: "UV view", detail: "View changes are not edits" }, command("both", "Both eyes", "1"),
      command("single", "Single eye", "2"), command("other", "Other eye", "O"), command("fit", "Fit shape", "F")];
  }
  const preview = port.authoring.previewState().preview;
  return [{ kind: "heading", label: "Head view", detail: "View changes are not edits" },
    { kind: "action", label: "Front view", icon: "front", shortcut: "F", capability: port.authoring.capability({ kind: "camera.front" }), run: () => { rt.dispatch({ kind: "camera.front" }); } },
    { kind: "action", label: "Surface controls", icon: "handles", checked: !!preview?.surface,
      capability: port.authoring.capability({ kind: "preview.setSurfaceControls", enabled: !preview?.surface }),
      run: () => { rt.dispatch({ kind: "preview.setSurfaceControls", enabled: !preview?.surface }); } },
    { kind: "action", label: "Plate wireframe", icon: "wire", checked: !!preview?.wire,
      capability: port.authoring.capability({ kind: "preview.setWire", enabled: !preview?.wire }),
      run: () => { rt.dispatch({ kind: "preview.setWire", enabled: !preview?.wire }); } }];
}

/** Menu for a viewport position (pointer) or the selected point (keyboard). */
export function viewportMenu(rt: StudioRuntime, kind: ViewportHostKind, anchor: MenuAnchor, at?: { x: number; y: number }, invoker?: Element) {
  const port = rt.port, items: MenuItem[] = [];
  const query = at ? port.viewport.contextAt(kind, at.x, at.y) : undefined;
  if (at && !query) items.push({ kind: "heading", label: kind === "head" ? "Background" : "Outside the editor", detail: kind === "head" ? "No editable control under the cursor" : undefined });
  else if (query) {
    const hitLabel: Record<string, string> = { point: "Contour point", tangent: "Bézier handle", "warp-origin": "Warp position", "warp-vector": "Warp pull",
      shape: "Shape", empty: "Empty UV space" };
    items.push({ kind: "heading", label: hitLabel[query.affordance] ?? "Target", detail: query.mirror ? "Mirrored copy · edits the authored side" : undefined });
    items.push(...contextItems(rt, query, anchor));
    if (query.affordance === "empty") items.push({ kind: "heading", label: "No shape here", detail: "Double-click near an outline to insert a point" });
  } else {
    const layer = port.editor.layer();
    if (layer) {
      const selectedQuery = port.authoring.contextQuery({ kind: "point", layerId: layer.id, index: port.editor.selected() });
      items.push({ kind: "heading", label: `Selected point ${port.editor.selected() + 1}`, detail: layer.name }, ...contextItems(rt, selectedQuery, anchor));
    }
  }
  items.push({ kind: "separator" }, ...viewItems(rt, kind));
  openMenu(items, anchor, { label: `${kind === "head" ? "Head" : "UV map"} commands`, invoker });
}

function readinessBadge() {
  // Not a live region: it changes on every raster and would flood assistive technology (audit B-25).
  const element = h("span", { class: "ready-badge" });
  return { element, update(frame: Frame) {
    const r = frame.readiness, label = r.size >= 1024 ? `${r.size / 1024}K` : String(r.size);
    const headAvailable = frame.viewport.head.phase === "ready";
    element.dataset.phase = r.phase;
    setText(element, r.phase === "ready" ? `${headAvailable ? "Preview" : "UV masks"} ${label} · ready` : r.phase === "updating"
      ? `Updating ${headAvailable ? "preview" : "UV masks"} ${label}${r.pending ? ` · ${r.pending} queued` : ""}` : `${headAvailable ? "Preview" : "UV masks"} blocked`);
    element.title = r.error ?? (r.phase === "ready" ? headAvailable
      ? "Every enabled layer shows its latest complete texture in the 3D preview."
      : "UV masks are ready. 3D preview assets are unavailable."
      : "Showing the last complete textures while new ones compute.");
  } };
}

export function headPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const slot = h("div", { class: "viewport-slot" });
  const loading = h("div", { class: "viewport-state", role: "status" }, h("div", { class: "progress indeterminate" }), h("p", { text: "Preparing the head and makeup plate…" }));
  const badge = readinessBadge();
  const context = h("span", { class: "viewport-context" });
  const front = button({ label: "Front view", icon: "front", iconOnly: true, small: true, variant: "ghost", onClick: () => rt.dispatch({ kind: "camera.front" }) });
  const surface = h("button", { class: "btn icon-only small ghost", type: "button", "aria-label": "Surface controls", "aria-pressed": "false", title: "Show editable controls on the head" }, icon("handles"));
  surface.addEventListener("click", () => { const p = port.authoring.previewState().preview; rt.dispatch({ kind: "preview.setSurfaceControls", enabled: !p?.surface }); });
  const wire = h("button", { class: "btn icon-only small ghost", type: "button", "aria-label": "Plate wireframe", "aria-pressed": "false", title: "Plate wireframe" }, icon("wire"));
  wire.addEventListener("click", () => { const p = port.authoring.previewState().preview; rt.dispatch({ kind: "preview.setWire", enabled: !p?.wire }); });
  const idle = h("button", { class: "btn icon-only small ghost", type: "button", "aria-label": "Play idle", title: "Character-creator idle" }, icon("play"));
  idle.addEventListener("click", () => {
    const motion = port.authoring.previewState().motion;
    if (!motion?.idle) rt.dispatch({ kind: "motion.setIdle", enabled: true });
    else rt.dispatch({ kind: "motion.setPaused", paused: !motion.idlePaused });
  });
  const hint = h("div", { class: "viewport-hint" }, "Drag background: orbit · Right-drag: pan · Wheel: zoom · Drag makeup: move · Shift-drag: rotate · Esc: cancel");
  const element = h("div", { class: "viewport-panel", tabindex: "0", "aria-label": "Head preview. Shift+F10 for commands on the selected point; F for front view." },
    slot, loading,
    h("div", { class: "viewport-top" }, context, h("div", { class: "viewport-tools" }, front, surface, wire, idle)),
    h("div", { class: "viewport-bottom" }, hint, badge.element));
  port.viewport.attach("head", slot);
  contextMenuGate(slot, event => viewportMenu(rt, "head", { x: event.clientX, y: event.clientY }, { x: event.clientX, y: event.clientY }, element));
  element.addEventListener("keydown", event => {
    if (event.target !== element || isTextInput(event.target)) return;
    if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") { event.preventDefault(); viewportMenu(rt, "head", element, undefined, element); }
    else if (event.key.toLowerCase() === "f") { event.preventDefault(); rt.dispatch({ kind: "camera.front" }); }
  });
  return {
    spec: { id: "head", ...PANEL_META["head"], element,
      visibility: visible => { if (visible) requestAnimationFrame(() => port.viewport.resize("head")); } },
    update(frame) {
      const state = frame.viewport.head;
      loading.hidden = state.phase === "ready";
      if (state.phase === "error") { loading.replaceChildren(icon("error"), h("p", { text: `Preview unavailable: ${state.error}` }),
        h("p", { class: "muted small", text: "Editing in the UV map, the library and packaging still work." })); loading.dataset.tone = "error"; }
      badge.update(frame);
      const preview = frame.preview.preview, motion = frame.preview.motion;
      setAttr(surface, "aria-pressed", String(!!preview?.surface)); setAttr(wire, "aria-pressed", String(!!preview?.wire));
      const playing = !!motion?.idle && !motion.idlePaused;
      if (idle.dataset.playing !== String(playing)) { idle.dataset.playing = String(playing); idle.replaceChildren(icon(playing ? "pause" : "play")); }
      setAttr(idle, "aria-label", !motion?.idle ? "Play character-creator idle" : motion.idlePaused ? "Resume idle" : "Pause idle");
      idle.hidden = !motion?.available;
      for (const control of [front, surface, wire, idle]) control.disabled = state.phase !== "ready";
      const draft = frame.library.draft, presetName = draft?.presets.find(preset => preset.id === draft.selected)?.name;
      setText(context, [presetName, frame.layer?.name].filter(Boolean).join(" › ") || "No layer selected");
    },
  };
}

export function uvPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const slot = h("div", { class: "viewport-slot uv-slot" });
  const modes = new Segmented<"both" | "single">({ label: "UV view", showLabel: false, compact: true, options: [
    { value: "both", label: "Both eyes" }, { value: "single", label: "Single eye" }], onSelect: mode => { port.viewport.uvCommand(mode); } });
  const other = button({ label: "Other eye", small: true, variant: "ghost", onClick: () => { port.viewport.uvCommand("other"); } });
  const fit = button({ label: "Fit shape", icon: "target", small: true, variant: "ghost", onClick: () => { port.viewport.uvCommand("fit"); } });
  const hint = h("div", { class: "uv-hint" }, "Wheel: zoom · Right-drag: pan · Double-click outline: add point · Shift-drag: rotate · Shift-wheel: scale");
  const element = h("div", { class: "viewport-panel uv", tabindex: "0",
    "aria-label": "UV map editor. Keys: 1 both eyes, 2 single eye, O other eye, F fit shape, Shift+F10 commands for the selected point." },
    h("div", { class: "uv-toolbar" }, modes.element, other, fit), slot, hint);
  port.viewport.attach("uv", slot);
  let mode: string | undefined;
  const layout = () => {
    const host = slot.firstElementChild as HTMLElement | null;
    if (!host) return;
    const rect = slot.getBoundingClientRect(), aspect = uvAspect(mode === "single" ? "single" : "both");
    if (rect.width < 2 || rect.height < 2) return;
    const w = Math.min(rect.width, rect.height * aspect), hgt = w / aspect;
    host.style.width = `${Math.floor(w)}px`; host.style.height = `${Math.floor(hgt)}px`;
  };
  new ResizeObserver(layout).observe(slot);
  contextMenuGate(slot, event => viewportMenu(rt, "uv", { x: event.clientX, y: event.clientY }, { x: event.clientX, y: event.clientY }, element));
  element.addEventListener("keydown", event => {
    if (event.target !== element) return;
    const key = event.key.toLowerCase();
    if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") { event.preventDefault(); viewportMenu(rt, "uv", element, undefined, element); }
    else if (key === "1") port.viewport.uvCommand("both");
    else if (key === "2") port.viewport.uvCommand("single");
    else if (key === "o") port.viewport.uvCommand("other");
    else if (key === "f") port.viewport.uvCommand("fit");
  });
  return {
    spec: { id: "uv", ...PANEL_META["uv"], element,
      visibility: visible => { if (visible) requestAnimationFrame(() => { layout(); port.viewport.resize("uv"); }); } },
    update(frame) {
      const view = frame.viewport.uv.view;
      if (view?.mode !== mode) { mode = view?.mode; layout(); }
      modes.update(view?.mode, value => port.viewport.uvCommandCapability(value));
      applyCapability(other, port.viewport.uvCommandCapability("other"));
      applyCapability(fit, port.viewport.uvCommandCapability("fit"));
    },
  };
}
