import type { Layer } from "./recipe";
import type { ReadonlyDeep } from "./read-only";
import type { PathCommand } from "./bezier-path";

/** Presentation adapter; pure curve operations and application history stay outside. */
export function setupPathControls(elements: {
  enable: HTMLButtonElement; modes: HTMLElement; note: HTMLElement;
  aligned: HTMLButtonElement; symmetric: HTMLButtonElement; corner: HTMLButtonElement;
}, hooks: { layer(): ReadonlyDeep<Layer> | undefined; selected(): number; edit(command: PathCommand): void }) {
  elements.enable.onclick = () => hooks.edit({ kind: "enable-bezier" });
  for (const mode of ["aligned", "symmetric", "corner"] as const)
    elements[mode].onclick = () => hooks.edit({ kind: "point-mode", index: hooks.selected(), mode });
  return () => {
    const layer = hooks.layer(), bezier = layer?.pathMode === "bezier";
    const point = layer?.points[hooks.selected()];
    elements.enable.hidden = bezier; elements.enable.disabled = !layer;
    elements.modes.hidden = !bezier;
    for (const mode of ["aligned", "symmetric", "corner"] as const) {
      elements[mode].disabled = !bezier || !point;
      elements[mode].setAttribute("aria-pressed", String(point?.handles?.mode === mode));
    }
    elements.note.textContent = bezier
      ? "Drag the selected point’s tangent handles (diamonds in the UV view). Smooth keeps handles aligned; Symmetric also matches their lengths; Corner lets each move independently. Double-click the path to split it without reshaping it. Handles outside the plate remain editable in the UV view."
      : "This saved shape uses automatic curves. Enable Bézier handles to edit its tangents; the curve is preserved, but finer sampling may slightly change edge pixels. Undo restores the original.";
  };
}
