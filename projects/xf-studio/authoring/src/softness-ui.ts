import type { Layer } from "./recipe";
import type { SoftnessCommand } from "./softness-edit";
import { bindControlEdit } from "./control-edit-ui";
import type { ReadonlyDeep } from "./read-only";

/** Presentation only; the application owns history, persistence and rendering. */
export function setupSoftness(elements: {
  variable: HTMLInputElement; width: HTMLInputElement; label: HTMLElement;
  value: HTMLElement; note: HTMLElement;
}, hooks: { layer(): ReadonlyDeep<Layer> | undefined; selected(): number; begin(id: string): void;
  commit(id: string): void; cancel(id: string): void; edit(command: SoftnessCommand): void }) {
  elements.width.min = ".0005"; elements.width.max = ".06"; elements.width.step = ".0005";
  elements.variable.onchange = () => {
    if (!hooks.layer()) return;
    hooks.begin("variable-softness"); hooks.edit({ kind: "variable-softness", enabled: elements.variable.checked });
    hooks.commit("variable-softness");
  };
  bindControlEdit(elements.width, { begin: () => hooks.begin("feather"),
    commit: () => hooks.commit("feather"), cancel: () => hooks.cancel("feather") });
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
