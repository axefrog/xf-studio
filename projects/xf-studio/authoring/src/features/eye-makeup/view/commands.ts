import type { EyeMakeupAction } from "../../../eye-makeup-model";
import { shortcutLabel } from "../../../input-bindings";
import type { FeatureCommand } from "../../../studio-ui/views/feature-view";
import { addLayer, catalogues, type EyeMakeupViewContext } from "./actions";

/**
 * Eye makeup's command-palette entries (a view contribution the shell renders after its own Edit commands):
 * each is one of its actions on the selected layer, point or warp, available by its facade's capability.
 */
export function eyeMakeupCommands(ctx: EyeMakeupViewContext): FeatureCommand<EyeMakeupAction>[] {
  const view = ctx.facade.view(), layer = view.layer(), field = view.selectedField(), { finishes } = catalogues(ctx);
  const act = (id: string, title: string, group: string, action: EyeMakeupAction | undefined,
    extra: Pick<FeatureCommand<EyeMakeupAction>, "icon" | "shortcut" | "keywords"> = {}, unavailable = "Select a layer first."): FeatureCommand<EyeMakeupAction> =>
    ({ id, title, group, ...extra, action, unavailable });
  return [
    { id: "layer.add", title: "Add layer", group: "Edit", icon: "plus", action: addLayer() },
    act("layer.duplicate", "Duplicate selected layer", "Edit", layer && { kind: "layer.edit", command: { kind: "duplicate", id: layer.id } }, { icon: "duplicate", shortcut: `${shortcutLabel("rows.duplicate")} in Layers` }),
    act("layer.remove", "Remove selected layer", "Edit", layer && { kind: "layer.edit", command: { kind: "remove", id: layer.id } }, { icon: "trash", shortcut: `${shortcutLabel("rows.remove")} in Layers` }),
    act("layer.reset", "Reset selected layer", "Edit", layer && { kind: "layer.edit", command: { kind: "reset", id: layer.id } }, { icon: "reset" }),
    act("layer.toggle", layer?.enabled === false ? "Show selected layer" : "Hide selected layer", "Edit", layer && { kind: "layer.setEnabled", id: layer.id, enabled: !layer.enabled }, { icon: "eye" }),
    act("point.remove", "Remove selected point", "Shape", layer && { kind: "point.remove", layerId: layer.id, index: view.selected() }, { icon: "trash" }),
    act("path.bezier", "Enable Bézier handles", "Shape", layer && { kind: "path.edit", layerId: layer.id, command: { kind: "enable-bezier" } }, { icon: "shape" }),
    act("layer.mirror", layer?.symmetry ? "Stop mirroring across the face" : "Mirror across the face", "Shape", layer && { kind: "layer.setSymmetry", layerId: layer.id, symmetry: !layer.symmetry }, { icon: "mirror" }),
    act("field.add", "Add warp control", "Shape", layer && { kind: "field.add", layerId: layer.id }, { icon: "warp" }),
    act("field.remove", "Remove selected warp", "Shape", layer && field && { kind: "field.remove", layerId: layer.id, fieldId: field.id }, { icon: "trash" },
      layer ? "Select a warp control first." : "Select a layer first."),
    ...finishes.map(finish => act(`finish.${finish.id}`, `Finish: ${finish.label}${finish.exportAdapter === "none" ? " (preview only)" : finish.exportAdapter === "experimental" ? " (experimental export)" : ""}`, "Colour & finish", layer && { kind: "layer.setFinish", layerId: layer.id, finish: finish.id },
      { icon: "finish", keywords: finish.exportAdapter === "none" ? "preview only study" : "exports" })),
  ];
}
