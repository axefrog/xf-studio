import { chordsLabel, keyBindingById, shortcutLabel } from "../../../input-bindings";
import { applyCapability, button, emptyState, note } from "../../../studio-ui/controls";
import { h, pct, setAttr, setText } from "../../../studio-ui/dom";
import { icon } from "../../../studio-ui/icons";
import { ItemList } from "../../../studio-ui/item-list";
import type { StudioRuntime } from "../../../studio-ui/runtime";
import { layerMenu } from "../../../studio-ui/target-menus";
import type { PanelController } from "../../../studio-ui/panels/collection";
import { eyeMakeupActions } from "./actions";
import { EYE_MAKEUP_PANEL_META } from "./contribution";

export function layersPanel(rt: StudioRuntime): PanelController {
  const port = rt.port;
  const count = h("span", { class: "count" });
  const add = button({ label: "Add layer", icon: "plus", small: true,
    onClick: () => { if (eyeMakeupActions(rt).dispatch({ kind: "layer.edit", command: { kind: "add" } })) rt.feedback.announce("Layer added at the front and selected"); } });
  const duplicate = button({ label: "Duplicate selected layer", icon: "duplicate", iconOnly: true, small: true, variant: "ghost", onClick: () => {
    const layer = rt.editor.layer(); if (layer) eyeMakeupActions(rt).dispatch({ kind: "layer.edit", command: { kind: "duplicate", id: layer.id } });
  } });
  const more = button({ label: "Selected layer actions", icon: "more", iconOnly: true, small: true, variant: "ghost", onClick: event => {
    const layer = rt.editor.layer(); if (layer) layerMenu(rt, layer.id, event.currentTarget as Element, event.currentTarget as Element);
  } });
  const toVisual = (index: number) => rt.editor.recipe().layers.length - 1 - index;
  const list = new ItemList<{ id: string; name: string; meta: string }>({
    label: "Layers, front first", noun: "layer", maxLength: 80,
    onSelect: id => eyeMakeupActions(rt).dispatch({ kind: "layer.select", layerId: id }),
    onMove: (id, visual) => eyeMakeupActions(rt).dispatch({ kind: "layer.edit", command: { kind: "move", id, to: toVisual(visual) } }),
    onRename: (id, name) => eyeMakeupActions(rt).dispatch({ kind: "layer.edit", command: { kind: "rename", id, name } }),
    onDelete: id => removeLayer(id),
    onDuplicate: id => eyeMakeupActions(rt).dispatch({ kind: "layer.edit", command: { kind: "duplicate", id } }),
    onMenu: (id, anchor, invoker) => layerMenu(rt, id, anchor, invoker),
    decorate: (item, row, selected) => {
      const layer = rt.editor.recipe().layers.find(entry => entry.id === item.id);
      if (!layer) return;
      if (!row.lead.childElementCount) {
        const eye = h("button", { class: "icon-btn small visibility", type: "button" });
        eye.addEventListener("click", () => {
          const current = rt.editor.recipe().layers.find(entry => entry.id === item.id);
          if (current) eyeMakeupActions(rt).dispatch({ kind: "layer.setEnabled", id: item.id, enabled: !current.enabled });
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
      const descriptor = rt.finishOf(layer.finish);
      swatch.dataset.finish = descriptor?.id ?? layer.finish;
      const flag = row.trailing.querySelector<HTMLElement>(".finish-flag")!;
      const status = rt.eyeMakeup.layerExport(layer.id);
      flag.hidden = status ? status.exportable : descriptor?.exportAdapter !== "none";
      flag.title = status && !status.exportable ? `Omitted from mod packages: ${status.reason}` : "Preview-study finish: omitted from mod packages";
      if (!flag.childElementCount) flag.append(icon("warning"));
      row.element.classList.toggle("hidden-layer", !layer.enabled);
      const menu = row.trailing.querySelector<HTMLButtonElement>("button")!;
      menu.tabIndex = selected ? 0 : -1;
      setAttr(menu, "aria-label", `Actions for ${layer.name}`);
    },
  });
  function removeLayer(id: string) {
    const name = rt.editor.recipe().layers.find(layer => layer.id === id)?.name ?? "Layer";
    if (eyeMakeupActions(rt).dispatch({ kind: "layer.edit", command: { kind: "remove", id } }))
      rt.feedback.toast("info", "Layers", `Removed “${name}”.`, [rt.undoAction()]);
  }
  const empty = emptyState("No layers in this preset", "Layers stack like makeup: the top of the list is applied last and appears in front.",
    button({ label: "Add layer", icon: "plus", variant: "primary", onClick: () => eyeMakeupActions(rt).dispatch({ kind: "layer.edit", command: { kind: "add" } }) }));
  const noPreset = emptyState("No preset selected", "Layers belong to a preset. Add or select one to edit its layers.",
    button({ label: "Add preset", icon: "plus", variant: "primary", onClick: () => rt.dispatch({ kind: "preset.edit", command: { kind: "add" } }) }));
  // A look made with a newer XF Studio: say what happened, that it is safe, and the one next step.
  const newerBody = h("p", { class: "empty-body" });
  const newer = h("div", { class: "empty", role: "status" }, h("p", { class: "empty-title", text: "This look needs a newer XF Studio" }), newerBody,
    h("div", { class: "empty-actions" }, button({ label: "Get the latest version", icon: "export", variant: "primary", onClick: () => {
      void port.links.open("project-releases").then(result => { if (!result.ok) rt.feedback.toast("info", "Layers", result.message); });
    } })));
  const element = h("div", { class: "panel-content" },
    h("div", { class: "list-head" }, h("span", { class: "eyebrow" }, "Stack ", count), h("div", { class: "row gap-xs" }, add, duplicate, more)),
    noPreset, newer, empty, list.element,
    note(`Top = front. Drag the grip or use ${chordsLabel(keyBindingById("rows.reorder"))} to reorder · ${shortcutLabel("rows.rename")} renames · ${shortcutLabel("rows.remove")} removes (${shortcutLabel("shell.undo")} undoes).`));
  rt.anchors.register("layers.add", add);
  rt.anchors.register("layers.list", list.element);
  return {
    spec: { id: "layers", ...EYE_MAKEUP_PANEL_META.layers, element },
    update(frame) {
      const recipe = frame.recipe, layers = recipe.layers, active = frame.layer;
      // Without a loaded library the document's layers remain editable; only a loaded, empty collection has no preset.
      const draft = frame.library.draft, hasPreset = !draft || !!draft.selected;
      const reason = hasPreset ? frame.locked : undefined, locked = reason !== undefined;
      noPreset.hidden = hasPreset;
      newer.hidden = !locked;
      if (locked) setText(newerBody, reason);
      empty.hidden = !hasPreset || locked || layers.length > 0;
      setText(count, String(layers.length));
      count.title = "The current preview budget is 32 layers per preset.";
      list.update([...layers].reverse().map(layer => {
        const descriptor = rt.finishOf(layer.finish);
        return { id: layer.id, name: layer.name, meta: `${descriptor?.label.split(" /")[0] ?? layer.finish} · ${pct(layer.opacity)}${layer.symmetry ? "" : " · one side"}` };
      }), active?.id);
      applyCapability(add, eyeMakeupActions(rt).addLayerCapability());
      applyCapability(duplicate, active ? eyeMakeupActions(rt).contextCapability({ kind: "layer", id: active.id },
        { kind: "layer.edit", command: { kind: "duplicate", id: active.id } }) : { available: false, reason: "Select a layer first." });
      applyCapability(more, active ? { available: true } : { available: false, reason: "Select a layer first." });
    },
  };
}
