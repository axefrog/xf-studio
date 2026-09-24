import { applyCapability, button, emptyState, note } from "../controls";
import { h, pct, setAttr, setText } from "../dom";
import { icon } from "../icons";
import { ItemList } from "../item-list";
import type { StudioRuntime } from "../runtime";
import { layerMenu } from "../target-menus";
import type { PanelController } from "./collection";
import { PANEL_META } from "../panel-meta";

export function layersPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const count = h("span", { class: "count" });
  const add = button({ label: "Add layer", icon: "plus", small: true,
    onClick: () => { if (rt.dispatch({ kind: "layer.edit", command: { kind: "add" } })) rt.feedback.announce("Layer added at the front and selected"); } });
  const duplicate = button({ label: "Duplicate selected layer", icon: "duplicate", iconOnly: true, small: true, variant: "ghost", onClick: () => {
    const layer = port.editor.layer(); if (layer) rt.dispatch({ kind: "layer.edit", command: { kind: "duplicate", id: layer.id } });
  } });
  const more = button({ label: "Selected layer actions", icon: "more", iconOnly: true, small: true, variant: "ghost", onClick: event => {
    const layer = port.editor.layer(); if (layer) layerMenu(rt, layer.id, event.currentTarget as Element, event.currentTarget as Element);
  } });
  const toVisual = (index: number) => port.editor.recipe().layers.length - 1 - index;
  const list = new ItemList<{ id: string; name: string; meta: string }>({
    label: "Layers, front first", noun: "layer", maxLength: 80,
    onSelect: id => rt.dispatch({ kind: "layer.select", layerId: id }),
    onMove: (id, visual) => rt.dispatch({ kind: "layer.edit", command: { kind: "move", id, to: toVisual(visual) } }),
    onRename: (id, name) => rt.dispatch({ kind: "layer.edit", command: { kind: "rename", id, name } }),
    onDelete: id => removeLayer(id),
    onDuplicate: id => rt.dispatch({ kind: "layer.edit", command: { kind: "duplicate", id } }),
    onMenu: (id, anchor, invoker) => layerMenu(rt, id, anchor, invoker),
    decorate: (item, row, selected) => {
      const layer = port.editor.recipe().layers.find(entry => entry.id === item.id);
      if (!layer) return;
      if (!row.lead.childElementCount) {
        const eye = h("button", { class: "icon-btn small visibility", type: "button" });
        eye.addEventListener("click", () => {
          const current = port.editor.recipe().layers.find(entry => entry.id === item.id);
          if (current) rt.dispatch({ kind: "layer.setEnabled", id: item.id, enabled: !current.enabled });
        });
        row.lead.append(eye, h("span", { class: "swatch", "aria-hidden": "true" }));
        row.trailing.append(h("span", { class: "finish-flag", "aria-hidden": "true" }),
          button({ label: "Layer actions", icon: "more", iconOnly: true, variant: "ghost", small: true,
            onClick: event => layerMenu(rt, item.id, event.currentTarget as Element, event.currentTarget as Element) }));
      }
      const eye = row.lead.querySelector<HTMLButtonElement>(".visibility")!;
      if (eye.dataset.state !== String(layer.enabled)) {
        eye.dataset.state = String(layer.enabled);
        eye.replaceChildren(icon(layer.enabled ? "eye" : "eyeOff"));
      }
      setAttr(eye, "aria-pressed", String(layer.enabled));
      setAttr(eye, "aria-label", `${layer.enabled ? "Hide" : "Show"} ${layer.name}`);
      eye.title = layer.enabled ? "Visible — hidden layers stay authored but are not packaged" : "Hidden — click to show";
      eye.tabIndex = selected ? 0 : -1;
      const swatch = row.lead.querySelector<HTMLElement>(".swatch")!;
      swatch.style.setProperty("--swatch", layer.color);
      swatch.style.opacity = String(.35 + .65 * layer.opacity);
      swatch.dataset.finish = layer.finish === "satin" ? "regular" : layer.finish;
      const descriptor = rt.finishes.find(finish => finish.id === (layer.finish === "satin" ? "regular" : layer.finish));
      const flag = row.trailing.querySelector<HTMLElement>(".finish-flag")!;
      flag.hidden = descriptor?.exportAdapter !== "none";
      flag.title = "Preview-study finish: omitted from mod packages";
      if (!flag.childElementCount) flag.append(icon("warning"));
      row.element.classList.toggle("hidden-layer", !layer.enabled);
      const menu = row.trailing.querySelector<HTMLButtonElement>("button")!;
      menu.tabIndex = selected ? 0 : -1;
      setAttr(menu, "aria-label", `Actions for ${layer.name}`);
    },
  });
  function removeLayer(id: string) {
    const name = port.editor.recipe().layers.find(layer => layer.id === id)?.name ?? "Layer";
    if (rt.dispatch({ kind: "layer.edit", command: { kind: "remove", id } }))
      rt.feedback.toast("info", "Layers", `Removed “${name}”.`, [rt.undoAction()]);
  }
  const empty = emptyState("No layers in this preset", "Layers stack like makeup: the top of the list is applied last and appears in front.",
    button({ label: "Add layer", icon: "plus", variant: "primary", onClick: () => rt.dispatch({ kind: "layer.edit", command: { kind: "add" } }) }));
  const noPreset = emptyState("No preset selected", "Add or select a preset to edit its layers.");
  const element = h("div", { class: "panel-content" },
    h("div", { class: "list-head" }, h("span", { class: "eyebrow" }, "Stack ", count), h("div", { class: "row gap-xs" }, add, duplicate, more)),
    noPreset, empty, list.element,
    note("Top = front. Drag the grip or use Alt+↑/↓ to reorder · F2 renames · Del removes (Ctrl+Z undoes)."));
  return {
    spec: { id: "layers", ...PANEL_META["layers"], element },
    update(frame) {
      const recipe = frame.recipe, layers = recipe.layers, active = frame.layer;
      const hasPreset = !!frame.library.draft?.selected;
      noPreset.hidden = hasPreset;
      empty.hidden = !hasPreset || layers.length > 0;
      setText(count, String(layers.length));
      count.title = "The current preview budget is 32 layers per preset.";
      list.update([...layers].reverse().map(layer => {
        const descriptor = rt.finishes.find(finish => finish.id === (layer.finish === "satin" ? "regular" : layer.finish));
        return { id: layer.id, name: layer.name, meta: `${descriptor?.label.split(" /")[0] ?? layer.finish} · ${pct(layer.opacity)}${layer.symmetry ? "" : " · one side"}` };
      }), active?.id);
      applyCapability(add, port.authoring.capability({ kind: "layer.edit", command: { kind: "add" } }));
      applyCapability(duplicate, active ? port.authoring.contextCapability({ kind: "layer", id: active.id },
        { kind: "layer.edit", command: { kind: "duplicate", id: active.id } }) : { available: false, reason: "Select a layer first." });
      applyCapability(more, active ? { available: true } : { available: false, reason: "Select a layer first." });
    },
  };
}
