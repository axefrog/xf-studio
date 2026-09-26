import { chordsLabel, KEY_BINDINGS, keyBinding, modifierKey, modifiersOf, pointerBinding, shortcutLabel } from "../../input-bindings";
import { ViewportInputHints } from "../input-hints";
import type { ViewportHostKind } from "../../viewport-attachment";
import { button, applyCapability } from "../controls";
import { h, setAttr, setText, isTextInput } from "../dom";
import { icon } from "../icons";
import type { Frame, StudioRuntime } from "../runtime";
import { viewportMenu } from "../target-menus";
import type { PanelController } from "./collection";
import { PANEL_META } from "../panel-meta";
import { DETAIL_NOTICE_TEXT } from "./preview";

/** Right-drag pans both viewports; only a stationary right-click opens the menu (catalogued `right-click`). */
export function contextMenuGate(kind: ViewportHostKind, target: HTMLElement, open: (event: MouseEvent) => void) {
  let down: { x: number; y: number } | undefined;
  target.addEventListener("pointerdown", event => { if (event.button === 2) down = { x: event.clientX, y: event.clientY }; }, true);
  target.addEventListener("contextmenu", event => {
    event.preventDefault();
    const moved = down ? Math.hypot(event.clientX - down.x, event.clientY - down.y) : 0;
    down = undefined;
    if (moved > 4) return;
    // Every target shares the right-click binding, so the empty target resolves it.
    if (pointerBinding(kind, "right-click", "empty", modifierKey(modifiersOf(event)))?.effect === "context-menu") open(event);
  });
}
/** Accessible viewport description generated from its key bindings. */
export const keyDescription = (scope: "head" | "uv") => `Keys: ${KEY_BINDINGS.filter(binding => binding.scope === scope)
  .map(binding => `${chordsLabel(binding)} ${binding.label.toLowerCase()}`).join(", ")}. ${shortcutLabel("shell.shortcuts")} lists every mouse and keyboard binding.`;

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
      : "UV masks are ready. The 3D head preview isn't available."
      : "Showing the last complete textures while new ones compute.");
  } };
}

export function headPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const slot = h("div", { class: "viewport-slot" });
  // What the head pane shows until the head is interactive: progress, a neutral "still needed" note or a
  // failure, always with the one next step from the preview setup (unless the setup card shows it).
  const stateIcon = h("span", { class: "viewport-state-icon" });
  const stateBar = h("div", { class: "progress" }), stateFill = h("span", { class: "progress-fill" });
  stateBar.append(stateFill);
  const stateText = h("p", { text: "Checking the 3D preview…" });
  const stateNote = h("p", { class: "muted small", text: "You can keep working in the UV map.", hidden: true });
  let nextAction: Parameters<typeof port.previewSetup.dispatch>[0] | undefined;
  const next = button({ label: "Set up 3D preview", variant: "primary", small: true, onClick: () => {
    if (!nextAction) return;
    void port.previewSetup.dispatch(nextAction).then(outcome => {
      if (!outcome.ok) rt.feedback.toast("warning", "3D preview", outcome.message);
    });
  } });
  next.hidden = true;
  const loading = h("div", { class: "viewport-state", role: "status", "data-phase": "loading" }, stateIcon, stateBar, stateText, stateNote, next);
  const badge = readinessBadge();
  const context = h("span", { class: "viewport-context" });
  const front = button({ label: "Front view", icon: "front", iconOnly: true, small: true, variant: "ghost", onClick: () => rt.dispatch({ kind: "camera.front" }) });
  const surface = h("button", { class: "btn icon-only small ghost", type: "button", "aria-label": "Surface controls", "aria-pressed": "false", title: "Show editable controls on the head", "data-title": "Show editable controls on the head" }, icon("handles"));
  surface.addEventListener("click", () => { const p = port.authoring.previewState().preview; rt.dispatch({ kind: "preview.setSurfaceControls", enabled: !p?.surface }); });
  const wire = h("button", { class: "btn icon-only small ghost", type: "button", "aria-label": "Plate wireframe", "aria-pressed": "false", title: "Plate wireframe", "data-title": "Plate wireframe" }, icon("wire"));
  wire.addEventListener("click", () => { const p = port.authoring.previewState().preview; rt.dispatch({ kind: "preview.setWire", enabled: !p?.wire }); });
  const idle = h("button", { class: "btn icon-only small ghost", type: "button", "aria-label": "Play idle", title: "Character-creator idle", "data-title": "Character-creator idle" }, icon("play"));
  idle.addEventListener("click", () => {
    const motion = port.authoring.previewState().motion;
    if (!motion?.idle) rt.dispatch({ kind: "motion.setIdle", enabled: true });
    else rt.dispatch({ kind: "motion.setPaused", paused: !motion.idlePaused });
  });
  const element = h("div", { class: "viewport-panel", tabindex: "0", "aria-label": `Head preview. ${keyDescription("head")}` });
  const hints = new ViewportInputHints(port.viewport, "head", slot, element);
  // Quiet, overlaid status for the V's skin, face details, eyes, brows, lashes, hair and piercings: progress while they prepare, one plain line
  // when something can't be shown. Absolutely placed, so it never moves the viewport's other overlays.
  const detailStatus = h("p", { class: "viewport-detail-status", role: "status", hidden: true });
  element.append(slot, loading, detailStatus,
    h("div", { class: "viewport-top" }, context, h("div", { class: "viewport-tools" }, front, surface, wire, idle)),
    h("div", { class: "viewport-bottom" }, hints.strip, badge.element), hints.tip);
  port.viewport.attach("head", slot);
  rt.anchors.register("head.view", element);
  contextMenuGate("head", slot, event => viewportMenu(rt, "head", { x: event.clientX, y: event.clientY }, { x: event.clientX, y: event.clientY }, element));
  element.addEventListener("keydown", event => {
    if (event.target !== element || isTextInput(event.target)) return;
    const binding = keyBinding("head", event);
    if (binding?.id === "head.menu") { event.preventDefault(); viewportMenu(rt, "head", element, undefined, element); }
    else if (binding?.id === "head.front") { event.preventDefault(); rt.dispatch({ kind: "camera.front" }); }
  });
  let shownPhase = "";
  function paintState(state: Frame["viewport"]["head"], step: Frame["previewSetup"]["head"]["next"]) {
    // Progress while loading or preparing, neutral while something is still needed, an error only for failures.
    const tone = state.phase === "error" ? "error" : state.phase === "unavailable" ? "neutral" : "progress";
    loading.dataset.phase = state.phase;
    if (loading.dataset.tone !== tone) loading.dataset.tone = tone;
    if (shownPhase !== tone) {
      shownPhase = tone;
      stateIcon.replaceChildren(...(tone === "error" ? [icon("error")] : tone === "neutral" ? [icon("head")] : []));
    }
    stateIcon.hidden = tone === "progress";
    stateBar.hidden = tone !== "progress";
    const progress = state.phase === "preparing" && typeof state.progress === "number" ? state.progress : null;
    stateBar.classList.toggle("indeterminate", progress === null);
    stateFill.style.width = progress === null ? "" : `${Math.round(progress * 100)}%`;
    const text = state.error ?? state.message ?? (tone === "error" ? "The 3D preview could not load." : "Checking the 3D preview…");
    setText(stateText, text);
    // Say what still works unless the message already does.
    stateNote.hidden = tone === "progress" || /UV/.test(text);
    nextAction = step?.action as typeof nextAction;
    next.hidden = !step;
    if (step) {
      setText(next.querySelector("span")!, step.label);
      // The step's own capability: disabled with its reason while the last step is still running (UI-35).
      applyCapability(next, port.previewSetup.capability(nextAction!));
    }
  }
  return {
    spec: { id: "head", ...PANEL_META["head"], element,
      visibility: visible => { if (visible) requestAnimationFrame(() => port.viewport.resize("head")); } },
    update(frame) {
      const state = frame.viewport.head;
      loading.hidden = state.phase === "ready";
      if (state.phase !== "ready") paintState(state, frame.previewSetup.head.next);
      // Hints hide themselves while the head isn't interactive (their own state), so they never cover this.
      badge.update(frame); hints.update(frame);
      const preview = frame.preview.preview, motion = frame.preview.motion;
      setAttr(surface, "aria-pressed", String(!!preview?.surface)); setAttr(wire, "aria-pressed", String(!!preview?.wire));
      const playing = !!motion?.idle && !motion.idlePaused;
      if (idle.dataset.playing !== String(playing)) { idle.dataset.playing = String(playing); idle.replaceChildren(icon(playing ? "pause" : "play")); }
      setAttr(idle, "aria-label", !motion?.idle ? "Play character-creator idle" : motion.idlePaused ? "Resume idle" : "Pause idle");
      idle.hidden = !motion?.available;
      // Each control shows its own application reason (for example, no 3D preview yet).
      applyCapability(front, port.authoring.capability({ kind: "camera.front" }));
      applyCapability(surface, port.authoring.capability({ kind: "preview.setSurfaceControls", enabled: !preview?.surface }));
      applyCapability(wire, port.authoring.capability({ kind: "preview.setWire", enabled: !preview?.wire }));
      applyCapability(idle, port.authoring.capability(!motion?.idle ? { kind: "motion.setIdle", enabled: true } :
        { kind: "motion.setPaused", paused: !motion.idlePaused }));
      const details = frame.status.assets.characterDetails;
      const unavailable = details?.slots.find(entry => entry.state === "unavailable" && entry.message);
      const detailText = state.phase !== "ready" || !details ? ""
        : details.phase === "preparing" ? "Preparing your V's skin, face details, eyes, brows, lashes, hair and piercings…"
        : details.phase === "failed" ? (details.notice ? DETAIL_NOTICE_TEXT[details.notice] : details.message)
        : unavailable?.message ?? "";
      detailStatus.hidden = !detailText;
      detailStatus.dataset.tone = details?.phase === "preparing" ? "progress" : "notice";
      setText(detailStatus, detailText);
      const draft = frame.library.draft, presetName = draft?.presets.find(preset => preset.id === draft.selected)?.name;
      setText(context, [presetName, frame.layer?.name].filter(Boolean).join(" › ") || "No layer selected");
    },
  };
}
