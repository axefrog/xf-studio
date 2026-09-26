/**
 * Feature views get a narrow context (UI-73): the feature's facade and the shell's presentation services,
 * never the runtime or the port. Eye makeup's layer menu and palette entries are its view's contributions,
 * rendered by the shell with the same entries, labels, order, icons, checked states and availability.
 */
import { expect, test } from "bun:test";
import type { EyeMakeupAction } from "../src/eye-makeup-model";
import { EYE_MAKEUP_VIEW_BINDING } from "../src/features/eye-makeup/view";
import { layerSections } from "../src/features/eye-makeup/view/layer-menu";
import { chordLabel, keyBindingById, shortcutLabel } from "../src/input-bindings";
import type { StudioTarget } from "../src/studio-application";
import type { Feedback } from "../src/studio-ui/feedback";
import type { MenuItem } from "../src/studio-ui/menu";
import { StudioRuntime, type Port } from "../src/studio-ui/runtime";
import { contextItems } from "../src/studio-ui/target-menus";
import { featureCommands, featureViewContext } from "../src/studio-ui/views/feature-context";
import type { FeatureViewContext } from "../src/studio-ui/views/feature-view";
import { STUDIO_CATALOGUE } from "../src/compose/views";
import { trustedFixture } from "./studio-presentation-fixture";

function fixture() {
  const { shell } = trustedFixture();
  const toasts: string[] = [];
  const feedback = { toast: (tone: string, source: string, message: string) => { toasts.push(`${tone}|${source}|${message}`); },
    record: () => {}, announce: () => {} } as unknown as Feedback;
  const rt = new StudioRuntime(shell as unknown as Port, feedback, STUDIO_CATALOGUE);
  return { shell, rt, toasts, ctx: featureViewContext(rt, "eye-makeup") };
}
/** A menu entry as the person sees it: kind, label, icon, shortcut, hint, checked state and availability. */
const shown = (item: MenuItem): unknown => item.kind === "action"
  ? { label: item.label, icon: item.icon, shortcut: item.shortcut, hint: item.hint, checked: item.checked, capability: item.capability }
  : item.kind === "submenu" ? { submenu: item.label, icon: item.icon, items: item.items().map(shown) } : item;

test("a feature view's context is its facade and the shell's services: no port, runtime or other facade", () => {
  const { shell, ctx, toasts } = fixture();
  expect(ctx.facade).toBe(shell.feature("eye-makeup"));
  expect(Object.keys(ctx).sort()).toEqual(["anchors", "changed", "dispatch", "facade", "feedback", "links", "platform", "range",
    "reveal", "targetMenu", "targetSections", "undoAction", "uv"]);
  expect(Object.isFrozen(ctx)).toBe(true);
  expect(Object.keys(ctx.uv).sort()).toEqual(["attach", "command", "commandCapability", "hints", "menu", "resize"]);
  // A feature's own kind through the platform dispatch is refused at run time too (a cast gets past the type).
  const layers = ctx.facade.view().recipe().layers.length;
  expect(ctx.platform({ kind: "layer.edit", command: { kind: "add" } } as never)).toBe(false);
  expect(ctx.facade.view().recipe().layers.length).toBe(layers);
  expect(toasts).toEqual(["error|Layers|That command belongs to a feature's own controls."]);
  // Its own kinds go through the facade, with the shell's feedback.
  const layer = ctx.facade.view().layer()!;
  expect(ctx.dispatch({ kind: "layer.setOpacity", layerId: layer.id, opacity: .3 })).toBe(true);
  expect(ctx.facade.view().layer()!.opacity).toBe(.3);
  expect(ctx.range("layer.setOpacity", "opacity")).toEqual({ min: 0, max: 1 });
  expect(() => featureViewContext({ port: { feature: () => undefined } } as unknown as StudioRuntime, "hair")).toThrow("no registered feature");
});

test("eye makeup's layer menu: the layer's context entries, then its view's commands, as before", () => {
  const { shell, rt, ctx } = fixture();
  const recipe = ctx.facade.view().recipe(), layer = recipe.layers[0], index = 0, anchor = { x: 0, y: 0 };
  const target: StudioTarget = { kind: "layer", id: layer.id };
  const [context, own] = layerSections(ctx, layer.id, anchor);
  expect(context.label).toBe(layer.name);
  expect(context.detail).toBe(`Layer ${recipe.layers.length - index} of ${recipe.layers.length} from front`);
  expect(context.items.map(shown)).toEqual(contextItems(rt, shell.authoring.contextQuery({ kind: "layer", id: layer.id }), anchor).map(shown));
  const at = (action: EyeMakeupAction) => shell.authoring.contextCapability(target, action);
  const finishes = shell.feature("eye-makeup").finishCatalogue();
  expect(own.label).toBeUndefined();
  expect(own.items.map(shown)).toEqual([
    { label: "Bring forward", icon: "arrowUp", shortcut: chordLabel(keyBindingById("rows.reorder").chords[0]), hint: undefined, checked: undefined,
      capability: at({ kind: "layer.edit", command: { kind: "move", id: layer.id, to: index + 1 } }) },
    { label: "Send backward", icon: "arrowDown", shortcut: chordLabel(keyBindingById("rows.reorder").chords[1]), hint: undefined, checked: undefined,
      capability: at({ kind: "layer.edit", command: { kind: "move", id: layer.id, to: index - 1 } }) },
    { label: "Mirror across the face", icon: "mirror", shortcut: undefined, hint: undefined, checked: layer.symmetry,
      capability: at({ kind: "layer.setSymmetry", layerId: layer.id, symmetry: !layer.symmetry }) },
    { submenu: "Finish", icon: "finish", items: shell.authoring.choicesFor(target, "layer.setFinish", "finish")
      .filter(choice => finishes.some(item => item.id === choice.value)).map(choice => {
        const descriptor = finishes.find(item => item.id === choice.value)!;
        return { label: descriptor.label, icon: undefined, shortcut: undefined, capability: choice.capability,
          checked: (finishes.find(item => item.id === layer.finish || item.stored.includes(layer.finish))?.id ?? layer.finish) === choice.value,
          hint: descriptor.exportAdapter === "none" ? "Preview only · not built into your mod"
            : descriptor.exportAdapter === "experimental" ? "Experimental export · not yet tested in game" : undefined };
      }) },
    { label: "Reset shape and settings", icon: "reset", shortcut: undefined, hint: `Keeps the name; Undo with ${shortcutLabel("shell.undo")}`, checked: undefined,
      capability: at({ kind: "layer.edit", command: { kind: "reset", id: layer.id } }) },
  ]);
  // Choosing an entry dispatches through the facade.
  const mirror = own.items.find(item => item.kind === "action" && item.label === "Mirror across the face") as Extract<MenuItem, { kind: "action" }>;
  mirror.run();
  expect(ctx.facade.view().recipe().layers[0].symmetry).toBe(!layer.symmetry);
  expect(layerSections(ctx, "no-such-layer", anchor)).toEqual([]);
});

test("eye makeup's palette entries come from its view, with the facade's capability", () => {
  const { shell, ctx } = fixture();
  const commands = featureCommands(EYE_MAKEUP_VIEW_BINDING, ctx as FeatureViewContext);
  const finishes = shell.feature("eye-makeup").finishCatalogue();
  expect(commands.map(command => [command.id, command.group])).toEqual([
    ["layer.add", "Edit"], ["layer.duplicate", "Edit"], ["layer.remove", "Edit"], ["layer.reset", "Edit"], ["layer.toggle", "Edit"],
    ["point.remove", "Shape"], ["path.bezier", "Shape"], ["layer.mirror", "Shape"], ["field.add", "Shape"], ["field.remove", "Shape"],
    ...finishes.map(finish => [`finish.${finish.id}`, "Colour & finish"])]);
  const layer = ctx.facade.view().layer()!;
  const byId = new Map(commands.map(command => [command.id, command]));
  expect(byId.get("layer.add")!.capability()).toEqual(shell.authoring.capability({ kind: "layer.edit", command: { kind: "add" } }));
  expect(byId.get("layer.duplicate")!.title).toBe("Duplicate selected layer");
  expect(byId.get("layer.duplicate")!.shortcut).toBe(`${shortcutLabel("rows.duplicate")} in Layers`);
  expect(byId.get("layer.toggle")!.title).toBe(layer.enabled ? "Hide selected layer" : "Show selected layer");
  expect(byId.get("layer.mirror")!.capability()).toEqual(shell.authoring.capability({ kind: "layer.setSymmetry", layerId: layer.id, symmetry: !layer.symmetry }));
  expect(Object.keys(byId.get("layer.add")!).sort()).toEqual(["capability", "group", "icon", "id", "run", "title"]);
  const before = ctx.facade.view().recipe().layers.length;
  byId.get("layer.add")!.run();
  expect(ctx.facade.view().recipe().layers.length).toBe(before + 1);
});
