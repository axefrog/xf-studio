import type { Recipe } from "./recipe";
import type { LayerCommand } from "./layer-stack";
import { finishLabel } from "./finish";

export function layerList(host: HTMLElement, hooks: {
  select(index: number): void; toggle(index: number, enabled: boolean): void; edit(command: LayerCommand): void;
}) {
  return (recipe: Recipe, active: number) => {
    host.replaceChildren();
    if (!recipe.layers.length) {
      const empty = document.createElement("p"); empty.className = "help";
      empty.textContent = "No makeup layers. Add a layer to begin."; host.append(empty);
    }
    recipe.layers.map((layer, index) => ({ layer, index })).reverse().forEach(({ layer, index }) => {
      const row = document.createElement("div"); row.className = "layer" + (index === active ? " selected" : "");
      row.dataset.layerId = layer.id;
      const button = document.createElement("button"); button.setAttribute("aria-label", `Select ${layer.name}`);
      button.setAttribute("aria-pressed", String(index === active));
      const swatch = document.createElement("span"); swatch.className = "swatch"; swatch.style.background = layer.color;
      const label = document.createElement("span"); label.className = "layer-name"; label.append(document.createTextNode(layer.name));
      const small = document.createElement("small"); small.textContent = `${String(index + 1).padStart(2, "0")} / ${finishLabel(layer.finish)}`;
      label.append(small); button.append(swatch, label); button.onclick = () => hooks.select(index);
      const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = layer.enabled;
      toggle.setAttribute("aria-label", `Show ${layer.name}`); toggle.onchange = () => hooks.toggle(index, toggle.checked);
      const actions = document.createElement("div"); actions.className = "layer-actions";
      const action = (text: string, title: string, click: () => void, disabled = false) => {
        const control = document.createElement("button"); control.textContent = text; control.title = title;
        control.setAttribute("aria-label", title); control.disabled = disabled; control.onclick = click;
        actions.append(control); return control;
      };
      const handle = action("↕", `Drag ${layer.name} to reorder`, () => {});
      let drag: { pointer: number; y: number; target?: HTMLElement } | undefined;
      const clearDrag = () => {
        if (!drag) return;
        const pointer = drag.pointer; drag.target?.classList.remove("drop-target"); drag = undefined;
        row.classList.remove("dragging");
        if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
      };
      handle.onpointerdown = e => {
        if (e.button !== 0) return;
        e.preventDefault(); handle.focus(); handle.setPointerCapture(e.pointerId);
        drag = { pointer: e.pointerId, y: e.clientY }; row.classList.add("dragging");
      };
      handle.onpointermove = e => {
        if (!drag || drag.pointer !== e.pointerId || Math.abs(e.clientY - drag.y) < 4) return;
        drag.target?.classList.remove("drop-target"); drag.target = undefined;
        const pane = host.closest("aside")!; const bounds = pane.getBoundingClientRect();
        if (e.clientY < bounds.top + 32) pane.scrollTop -= 20;
        else if (e.clientY > bounds.bottom - 32) pane.scrollTop += 20;
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".layer");
        if (target && host.contains(target) && target !== row) {
          drag.target = target; target.classList.add("drop-target");
        }
      };
      handle.onpointerup = () => {
        const id = drag?.target?.dataset.layerId; clearDrag();
        const to = recipe.layers.findIndex(l => l.id === id);
        if (to >= 0) hooks.edit({ kind: "move", id: layer.id, to });
      };
      handle.onpointercancel = handle.onlostpointercapture = clearDrag;
      handle.onkeydown = e => { if (e.key === "Escape") { e.preventDefault(); clearDrag(); } };
      action("↑", `Move ${layer.name} up`, () => hooks.edit({ kind: "move", id: layer.id, to: index + 1 }), index === recipe.layers.length - 1);
      action("↓", `Move ${layer.name} down`, () => hooks.edit({ kind: "move", id: layer.id, to: index - 1 }), index === 0);
      action("Remove", `Remove ${layer.name}`, () => hooks.edit({ kind: "remove", id: layer.id }));
      row.append(button, toggle, actions); host.append(row);
    });
  };
}
