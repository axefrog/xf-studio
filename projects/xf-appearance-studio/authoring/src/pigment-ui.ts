import { DEFAULT_STRENGTH_BLEND, MIN_STRENGTH_BLEND, MAX_STRENGTH_BLEND, type Layer } from "./recipe";
import type { PigmentCommand } from "./pigment-edit";
import { bindControlEdit } from "./control-edit-ui";

/** Presentation only; the application owns commands, Undo, persistence and rendering. */
export function setupPigment(elements: {
  smooth: HTMLInputElement; blend: HTMLInputElement; value: HTMLElement; note: HTMLElement;
}, hooks: { layer(): Layer | undefined; begin(id: string): void; commit(id: string): void;
  cancel(id: string): void; edit(command: PigmentCommand): void }) {
  elements.blend.min = String(MIN_STRENGTH_BLEND);
  elements.blend.max = String(MAX_STRENGTH_BLEND);
  elements.blend.step = String(MIN_STRENGTH_BLEND);
  elements.smooth.onchange = () => {
    if (!hooks.layer()) return;
    hooks.begin("smooth-strength"); hooks.edit({ kind: "smooth-strength", enabled: elements.smooth.checked });
    hooks.commit("smooth-strength");
  };
  bindControlEdit(elements.blend, { begin: () => hooks.begin("strength-blend"),
    commit: () => hooks.commit("strength-blend"), cancel: () => hooks.cancel("strength-blend") });
  elements.blend.oninput = () => {
    if (hooks.layer()?.strength.mode === "smooth-boundary")
      hooks.edit({ kind: "strength-blend", value: Number(elements.blend.value) });
  };
  return () => {
    const layer = hooks.layer(), strength = layer?.strength;
    const smooth = strength?.mode === "smooth-boundary";
    elements.smooth.checked = smooth; elements.smooth.disabled = !layer;
    elements.blend.disabled = !smooth;
    elements.blend.value = String(smooth ? strength.blend : DEFAULT_STRENGTH_BLEND);
    elements.value.textContent = smooth ? `${(strength.blend * 100).toFixed(3)}% UV` : "—";
    elements.note.textContent = smooth
      ? "Point strength blends pigment across the shape. More blend softens differences between nearby points; a zero point may retain some pigment. Edge softness controls the outline separately."
      : "Original point blending is preserved for this layer. Enable smooth gradients to remove internal strength seams; Undo restores the previous look.";
  };
}
