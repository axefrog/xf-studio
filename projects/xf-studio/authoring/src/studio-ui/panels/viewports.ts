import { chordsLabel, KEY_BINDINGS, keyBinding, modifierKey, modifiersOf, pointerBinding, shortcutLabel, type ViewportScope } from "../../input-bindings";
import { ViewportInputHints } from "../input-hints";
import { button, applyCapability } from "../controls";
import { h, setAttr, setText, isTextInput } from "../dom";
import { icon, isIconName, type IconName } from "../icons";
import type { Frame, StudioRuntime } from "../runtime";
import type { ViewToolEntry } from "../../studio-application";
import type { ViewContext } from "../views/panels";
import { viewportMenu } from "../target-menus";
import type { PanelController } from "./collection";
import { PANEL_META } from "../panel-meta";
import { DETAIL_NOTICE_TEXT } from "./preview";
import { wolvenKitStepButton } from "../wolvenkit-step";

/** Right-drag pans both viewports; only a stationary right-click opens the menu (catalogued `right-click`). */
export function contextMenuGate(kind: ViewportScope, target: HTMLElement, open: (event: MouseEvent) => void) {
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
export const keyDescription = (scope: ViewportScope) => `Keys: ${KEY_BINDINGS.filter(binding => binding.scope === scope)
  .map(binding => `${chordsLabel(binding)} ${binding.label.toLowerCase()}`).join(", ")}. ${shortcutLabel("shell.shortcuts")} lists every mouse and keyboard binding.`;

/** A view's readiness badge: what the shown modules contribute (eye makeup: its layer textures), absent when none does. */
function readinessBadge(view: ViewContext["view"]) {
  // Not a live region: it changes on every raster and would flood assistive technology (audit B-25).
  const element = h("span", { class: "ready-badge" });
  return { element, update() {
    // The same wording as the status bar and Preview quality (UI-92).
    const readiness = view.badge();
    element.hidden = !readiness;
    if (!readiness) return;
    element.dataset.phase = readiness.phase;
    setText(element, readiness.label);
    element.title = readiness.detail;
  } };
}

/** An icon name the shell knows; a module's unknown one falls back to a generic mark. */
const toolIcon = (name: string): IconName => isIconName(name) ? name : "dot";

/**
 * A view's toolbar, derived from its tools (view-graph-design.md §3.9): the platform's and the shown modules' tools placed on the
 * toolbar (research tools only with research tools on), in order. Buttons are kept per tool, so a repaint never recreates them.
 */
function viewToolbar(rt: StudioRuntime) {
  const element = h("div", { class: "viewport-tools" });
  const buttons = new Map<string, HTMLButtonElement>();
  const make = (tool: ViewToolEntry): HTMLButtonElement => {
    const title = tool.title ?? tool.label;
    const control = tool.kind === "action"
      ? button({ label: tool.label, icon: toolIcon(tool.icon), iconOnly: true, small: true, variant: "ghost", onClick: () => {} })
      : h("button", { class: "btn icon-only small ghost", type: "button", "aria-label": tool.label, title, "data-title": title }, icon(toolIcon(tool.icon)));
    if (tool.state === "tools") control.setAttribute("aria-pressed", "false");
    // The tool's current action, read at click time (a toggle's next state, Play or Pause).
    control.addEventListener("click", () => { const entry = rt.port.views.tools(undefined, rt.toolFilter()).find(item => item.id === tool.id); if (entry) rt.dispatch(entry.action); });
    control.dataset.tool = tool.id;
    return control;
  };
  return { element, update(frame: Frame) {
    const tools = frame.viewTools.filter(tool => tool.placement !== "menu");
    const wanted = tools.map(tool => buttons.get(tool.id) ?? buttons.set(tool.id, make(tool)).get(tool.id)!);
    if (wanted.length !== element.children.length || wanted.some((control, index) => element.children[index] !== control)) element.replaceChildren(...wanted);
    for (const tool of tools) {
      const control = buttons.get(tool.id)!;
      control.hidden = !tool.shown;
      if (tool.state === "tools") setAttr(control, "aria-pressed", String(!!tool.on));
      if (control.dataset.icon !== tool.icon) { control.dataset.icon = tool.icon; control.querySelector("svg")?.replaceWith(icon(toolIcon(tool.icon))); }
      if (tool.kind !== "action") setAttr(control, "aria-label", tool.label);
      // Each control shows its own application reason (for example, no 3D preview yet).
      applyCapability(control, tool.capability);
    }
  } };
}

export function headPanel(rt: StudioRuntime, view: ViewContext): PanelController {
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
  const badge = readinessBadge(view.view);
  const context = h("span", { class: "viewport-context" });
  const toolbar = viewToolbar(rt);
  const element = h("div", { class: "viewport-panel", tabindex: "0", "aria-label": `Head preview. ${keyDescription("head")}` });
  const hints = new ViewportInputHints(port.viewport, "head", slot, element);
  // Quiet, overlaid status for the V's skin, face details, eyes, brows, lashes, hair, piercings and body: progress while they prepare, one plain line
  // when something can't be shown, with its one next step when it waits for WolvenKit (NATIVE-47). Absolutely placed, so it never moves the
  // viewport's other overlays.
  const detailText = h("span", { class: "viewport-detail-text", role: "status" });
  const detailStep = wolvenKitStepButton(rt);
  const detailStatus = h("div", { class: "viewport-detail-status", hidden: true }, detailText, detailStep.element);
  element.append(slot, loading, detailStatus,
    h("div", { class: "viewport-top" }, context, toolbar.element),
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
      badge.update(); hints.update(frame); toolbar.update(frame);
      const details = frame.status.assets.characterDetails;
      const unavailable = details?.slots.find(entry => entry.state === "unavailable" && entry.message);
      const line = state.phase !== "ready" || !details ? ""
        : details.phase === "preparing" ? "Preparing your V's skin, face details, eyes, brows, lashes, hair, piercings and body…"
        : details.phase === "failed" ? (details.notice ? DETAIL_NOTICE_TEXT[details.notice] : details.message)
        : details.need ? details.updateError ?? ""
        : unavailable?.message ?? "";
      detailStatus.hidden = !line;
      detailStatus.dataset.tone = details?.phase === "preparing" ? "progress" : "notice";
      setText(detailText, line);
      detailStep.update(frame, !!line && details?.need === "wolvenkit");
      // The crumb: the preset, then what each shown module contributes for this scene (eye makeup: the selected layer).
      const draft = frame.library.draft, presetName = draft?.presets.find(preset => preset.id === draft.selected)?.name;
      const summaries = view.view.summaries();
      setText(context, [presetName, ...summaries.map(summary => summary.text)].filter(Boolean).join(" › ") || summaries[0]?.empty || "");
    },
  };
}
