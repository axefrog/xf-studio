import type { Layer } from "./recipe";
import type { SoftnessCommand } from "./softness-edit";

/** Presentation only; the application owns history, persistence and rendering. */
export function setupSoftness(elements: {
  variable: HTMLInputElement; width: HTMLInputElement; label: HTMLElement;
  value: HTMLElement; note: HTMLElement;
}, hooks: { layer(): Layer | undefined; selected(): number; begin(): void; edit(command: SoftnessCommand): void }) {
  elements.width.min = ".0005"; elements.width.max = ".06"; elements.width.step = ".0005";
  elements.variable.onchange = () => {
    if (!hooks.layer()) return;
    hooks.begin(); hooks.edit({ kind: "variable-softness", enabled: elements.variable.checked });
  };
  elements.width.addEventListener("pointerdown", () => { if (!elements.width.disabled) hooks.begin(); });
  elements.width.addEventListener("keydown", event => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) hooks.begin();
  });
  elements.width.oninput = () => {
    const layer = hooks.layer(); if (!layer) return;
    hooks.edit(layer.softness.mode === "boundary"
      ? { kind: "point-softness", index: hooks.selected(), value: Number(elements.width.value) }
      : { kind: "uniform-softness", value: Number(elements.width.value) });
  };
  return () => {
    const layer = hooks.layer(), variable = layer?.softness.mode === "boundary";
    const width = layer ? variable ? layer.points[hooks.selected()]?.feather ?? layer.feather : layer.feather : .012;
    elements.variable.checked = variable; elements.variable.disabled = !layer;
    elements.width.disabled = !layer; elements.width.value = String(width);
    elements.label.textContent = variable ? "Selected point softness" : "Edge softness";
    elements.value.textContent = `${(width * 100).toFixed(2)}% UV`;
    elements.note.textContent = variable
      ? "Select a contour point to soften or sharpen that part of the edge. Widths blend between points; very soft edges can influence nearby sharp edges in narrow shapes. Turning this off keeps your point settings."
      : "One fade width around the whole shape. Enable per-point softness to vary the edge independently of pigment strength.";
  };
}
