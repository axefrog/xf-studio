import { keyBinding, shortcutLabel } from "../../../input-bindings";
import { applyCapability, button, Segmented } from "../../../studio-ui/controls";
import { h } from "../../../studio-ui/dom";
import type { PanelController } from "../../../studio-ui/panels/collection";
import { contextMenuGate, keyDescription } from "../../../studio-ui/panels/viewports";
import type { EyeMakeupViewContext } from "./actions";
import { EYE_MAKEUP_PANEL_META } from "./contribution";

/** Eye makeup's flat UV editor: the UV viewport device hosted in its panel, with its view modes and hints. */
export function uvPanel(ctx: EyeMakeupViewContext): PanelController {
  const uv = ctx.uv;
  const slot = h("div", { class: "viewport-slot uv-slot" });
  const modes = new Segmented<"both" | "single">({ label: "UV view", showLabel: false, compact: true, options: [
    { value: "both", label: "Both eyes" }, { value: "single", label: "Single eye" }], onSelect: mode => { uv.command(mode); } });
  const other = button({ label: "Other eye", small: true, variant: "ghost", onClick: () => { uv.command("other"); } });
  const fit = button({ label: "Fit shape", icon: "target", small: true, variant: "ghost", onClick: () => { uv.command("fit"); } });
  const warning = h("div", { class: "uv-warning", hidden: true },
    `Selected point is outside this view · ${shortcutLabel("uv.fit")}: fit shape · ${shortcutLabel("uv.other")}: other eye`);
  const element = h("div", { class: "viewport-panel uv", tabindex: "0", "aria-label": `UV map editor. ${keyDescription("uv")}` });
  const hints = uv.hints(slot, element);
  // The canvas fills the stage. Warning and hints are overlays: they never take layout space, so a
  // hint change can never resize the canvas (the stage's --uv-safe-* insets keep Fit clear of them).
  const stage = h("div", { class: "uv-stage" }, slot,
    h("div", { class: "viewport-top" }, warning), h("div", { class: "viewport-bottom" }, hints.strip));
  element.append(h("div", { class: "uv-toolbar" }, modes.element, other, fit), stage, hints.tip);
  uv.attach(slot);
  ctx.anchors.register("uv.canvas", stage);
  let hintsShown: boolean | undefined;
  contextMenuGate("uv", slot, event => uv.menu({ x: event.clientX, y: event.clientY }, { x: event.clientX, y: event.clientY }, element));
  element.addEventListener("keydown", event => {
    if (event.target !== element) return;
    const binding = keyBinding("uv", event);
    if (binding?.id === "uv.menu") { event.preventDefault(); uv.menu(element, undefined, element); }
    else if (binding?.action.kind === "view") uv.command(binding.action.id.slice(3) as "both" | "single" | "other" | "fit");
  });
  return {
    spec: { id: "uv", ...EYE_MAKEUP_PANEL_META.uv, element,
      visibility: visible => { if (visible) requestAnimationFrame(() => uv.resize()); } },
    update(frame) {
      const view = frame.viewport.uv.view;
      modes.update(view?.mode, value => uv.commandCapability(value));
      applyCapability(other, uv.commandCapability("other"));
      applyCapability(fit, uv.commandCapability("fit"));
      const selection = frame.viewport.uv.selection;
      warning.hidden = !(selection?.point && !selection.point.visible);
      hints.update(frame);
      // Hidden hints free their reserved band; the editor reads the new insets on the next draw.
      if (frame.preferences.inputHints !== hintsShown) {
        hintsShown = frame.preferences.inputHints;
        stage.dataset.hints = hintsShown ? "on" : "off";
        uv.resize();
      }
    },
  };
}
