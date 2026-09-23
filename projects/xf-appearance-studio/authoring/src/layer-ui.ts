import type { Recipe } from "./recipe";
import type { LayerCommand } from "./layer-stack";
import { finishLabel } from "./finish";
import { reorderHandle } from "./reorder-ui";

export function layerList(host: HTMLElement, hooks: {
  select(index: number): void; rename(index: number): void; toggle(index: number, enabled: boolean): void; edit(command: LayerCommand): void;
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
      const menu = document.createElement("details"); menu.className = "layer-menu";
      const summary = document.createElement("summary"); summary.textContent = "⋯"; summary.setAttribute("aria-label", `Actions for ${layer.name}`);
      menu.append(summary);
      const actions = document.createElement("div"); actions.className = "layer-actions"; menu.append(actions);
      const action = (text: string, title: string, click: () => void, disabled = false) => {
        const control = document.createElement("button"); control.textContent = text; control.title = title;
        control.setAttribute("aria-label", title); control.disabled = disabled; control.onclick = click;
        actions.append(control); return control;
      };
      const handle = document.createElement("button"); handle.textContent = "↕"; handle.className = "layer-drag";
      handle.title = `Drag ${layer.name} to reorder`; handle.setAttribute("aria-label", handle.title);
      reorderHandle(handle, row, host, ".layer", layer.name, target => {
        const to = recipe.layers.findIndex(l => l.id === target.dataset.layerId);
        if (to >= 0) hooks.edit({ kind: "move", id: layer.id, to });
      });
      action("Rename", `Rename ${layer.name}`, () => hooks.rename(index));
      action("Duplicate", `Duplicate ${layer.name}`, () => hooks.edit({ kind: "duplicate", id: layer.id }));
      action("↑", `Move ${layer.name} up`, () => hooks.edit({ kind: "move", id: layer.id, to: index + 1 }), index === recipe.layers.length - 1);
      action("↓", `Move ${layer.name} down`, () => hooks.edit({ kind: "move", id: layer.id, to: index - 1 }), index === 0);
      action("Remove", `Remove ${layer.name}`, () => hooks.edit({ kind: "remove", id: layer.id }));
      row.append(handle, button, toggle, menu); host.append(row);
    });
  };
}
