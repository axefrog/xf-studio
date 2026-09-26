import type { EyeMakeupAction } from "../../../eye-makeup-model";
import { chordLabel, keyBindingById, shortcutLabel } from "../../../input-bindings";
import type { MenuAnchor, MenuSection } from "../../../studio-ui/menu";
import type { FeatureMenuItem, FeatureTargetMenu } from "../../../studio-ui/views/feature-view";
import { catalogues, type EyeMakeupViewContext } from "./actions";

/** Row reorder chords from the catalogue ("Alt+↑", "Alt+↓"). */
const reorderKey = (index: 0 | 1) => chordLabel(keyBindingById("rows.reorder").chords[index]);

/**
 * A layer's menu: the application-bound entries for the layer (the shell's), then eye makeup's own commands.
 * Every entry is checked against the layer itself, not the selection; the shell renders them and each
 * dispatches through eye makeup's facade. Undefined for a layer that no longer exists.
 */
export function layerMenu(ctx: EyeMakeupViewContext, layerId: string): FeatureTargetMenu<EyeMakeupAction> | undefined {
  const recipe = ctx.facade.view().recipe(), index = recipe.layers.findIndex(layer => layer.id === layerId);
  const layer = recipe.layers[index];
  if (!layer) return undefined;
  const target = { kind: "layer" as const, id: layerId }, { finishes, finishOf } = catalogues(ctx);
  const items: FeatureMenuItem<EyeMakeupAction>[] = [
    { kind: "action", label: "Bring forward", icon: "arrowUp", action: { kind: "layer.edit", command: { kind: "move", id: layerId, to: index + 1 } },
      shortcut: reorderKey(0) },
    { kind: "action", label: "Send backward", icon: "arrowDown", action: { kind: "layer.edit", command: { kind: "move", id: layerId, to: index - 1 } },
      shortcut: reorderKey(1) },
    { kind: "action", label: "Mirror across the face", icon: "mirror", action: { kind: "layer.setSymmetry", layerId, symmetry: !layer.symmetry },
      checked: layer.symmetry },
    { kind: "submenu", label: "Finish", icon: "finish", items: () => ctx.facade.choicesFor(target, "layer.setFinish", "finish")
      // Only the catalogue's finishes are offered; legacy stored names stay accepted but hidden.
      .filter(choice => finishes.some(item => item.id === choice.value))
      .map(choice => {
        const descriptor = finishes.find(item => item.id === choice.value);
        return { kind: "action", label: descriptor?.label ?? String(choice.value), action: choice.action as EyeMakeupAction, capability: choice.capability,
          checked: (finishOf(layer.finish)?.id ?? layer.finish) === choice.value,
          hint: descriptor?.exportAdapter === "none" ? "Preview only · not built into your mod"
            : descriptor?.exportAdapter === "experimental" ? "Experimental export · not yet tested in game" : undefined };
      }) },
    { kind: "action", label: "Reset shape and settings", icon: "reset", action: { kind: "layer.edit", command: { kind: "reset", id: layerId } },
      hint: `Keeps the name; Undo with ${shortcutLabel("shell.undo")}` },
  ];
  return { label: layer.name, detail: `Layer ${recipe.layers.length - index} of ${recipe.layers.length} from front`,
    title: `${layer.name} layer actions`, items };
}
/** The sections of a layer's menu (empty for a layer that no longer exists). */
export function layerSections(ctx: EyeMakeupViewContext, layerId: string, anchor: MenuAnchor): MenuSection[] {
  const menu = layerMenu(ctx, layerId);
  return menu ? ctx.targetSections({ kind: "layer", id: layerId }, menu, anchor) : [];
}
/** Open a layer's menu at `anchor`. */
export function openLayerMenu(ctx: EyeMakeupViewContext, layerId: string, anchor: MenuAnchor, invoker?: Element) {
  const menu = layerMenu(ctx, layerId);
  if (menu) ctx.targetMenu({ kind: "layer", id: layerId }, menu, anchor, invoker);
}
