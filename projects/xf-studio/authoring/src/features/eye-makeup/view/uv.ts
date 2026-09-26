import { keyBinding, shortcutLabel } from "../../../input-bindings";
import { applyCapability, button, Segmented } from "../../../studio-ui/controls";
import { h } from "../../../studio-ui/dom";
import { ViewportInputHints } from "../../../studio-ui/input-hints";
import type { PanelController } from "../../../studio-ui/panels/collection";
import { contextMenuGate, keyDescription } from "../../../studio-ui/panels/viewports";
import type { StudioRuntime } from "../../../studio-ui/runtime";
import { viewportMenu } from "../../../studio-ui/target-menus";
import { EYE_MAKEUP_PANEL_META } from "./contribution";

/** Eye makeup's flat UV editor: the UV viewport device hosted in its panel, with its view modes and hints. */
export function uvPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const slot = h("div", { class: "viewport-slot uv-slot" });
  const modes = new Segmented<"both" | "single">({ label: "UV view", showLabel: false, compact: true, options: [
    { value: "both", label: "Both eyes" }, { value: "single", label: "Single eye" }], onSelect: mode => { port.viewport.uvCommand(mode); } });
  const other = button({ label: "Other eye", small: true, variant: "ghost", onClick: () => { port.viewport.uvCommand("other"); } });
  const fit = button({ label: "Fit shape", icon: "target", small: true, variant: "ghost", onClick: () => { port.viewport.uvCommand("fit"); } });
  const warning = h("div", { class: "uv-warning", hidden: true },
    `Selected point is outside this view · ${shortcutLabel("uv.fit")}: fit shape · ${shortcutLabel("uv.other")}: other eye`);
  const element = h("div", { class: "viewport-panel uv", tabindex: "0", "aria-label": `UV map editor. ${keyDescription("uv")}` });
  const hints = new ViewportInputHints(rt, "uv", slot, element);
  // The canvas fills the stage. Warning and hints are overlays: they never take layout space, so a
  // hint change can never resize the canvas (the stage's --uv-safe-* insets keep Fit clear of them).
  const stage = h("div", { class: "uv-stage" }, slot,
    h("div", { class: "viewport-top" }, warning), h("div", { class: "viewport-bottom" }, hints.strip));
  element.append(h("div", { class: "uv-toolbar" }, modes.element, other, fit), stage, hints.tip);
  port.viewport.attach("uv", slot);
  rt.anchors.register("uv.canvas", stage);
  let hintsShown: boolean | undefined;
  contextMenuGate("uv", slot, event => viewportMenu(rt, "uv", { x: event.clientX, y: event.clientY }, { x: event.clientX, y: event.clientY }, element));
  element.addEventListener("keydown", event => {
    if (event.target !== element) return;
    const binding = keyBinding("uv", event);
    if (binding?.id === "uv.menu") { event.preventDefault(); viewportMenu(rt, "uv", element, undefined, element); }
    else if (binding?.action.kind === "view") port.viewport.uvCommand(binding.action.id.slice(3) as "both" | "single" | "other" | "fit");
  });
  return {
    spec: { id: "uv", ...EYE_MAKEUP_PANEL_META.uv, element,
      visibility: visible => { if (visible) requestAnimationFrame(() => port.viewport.resize("uv")); } },
    update(frame) {
      const view = frame.viewport.uv.view;
      modes.update(view?.mode, value => port.viewport.uvCommandCapability(value));
      applyCapability(other, port.viewport.uvCommandCapability("other"));
      applyCapability(fit, port.viewport.uvCommandCapability("fit"));
      const selection = frame.viewport.uv.selection;
      warning.hidden = !(selection?.point && !selection.point.visible);
      hints.update(frame);
      // Hidden hints free their reserved band; the editor reads the new insets on the next draw.
      if (frame.preferences.inputHints !== hintsShown) {
        hintsShown = frame.preferences.inputHints;
        stage.dataset.hints = hintsShown ? "on" : "off";
        port.viewport.resize("uv");
      }
    },
  };
}
