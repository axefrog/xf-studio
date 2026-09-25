import type { StudioAction, StudioCapability, StudioTarget } from "../studio-application";
import type { StudioBoundContext } from "../studio-context-targets";
import { chordLabel, keyBindingById, shortcutLabel, TARGET_LABELS } from "../input-bindings";
import type { ViewportHostKind } from "../viewport-attachment";
import type { IconName } from "./icons";
import { menuFromSections, openMenu, openValuePopover, type MenuAnchor, type MenuItem, type MenuSection } from "./menu";
import type { StudioRuntime } from "./runtime";

type Query = ReturnType<StudioRuntime["port"]["authoring"]["contextQuery"]>;
type Option = Query["options"][number];
export const CONTEXT_LABELS: Readonly<Record<string, [string, IconName?]>> = {
  "preset.add": ["Add preset", "plus"], "preset.restore": ["Restore last removed preset", "reset"],
  "collection.undoOpen": ["Recover previous collection draft", "undo"], "collection.rename": ["Rename collection…", "rename"],
  "preset.select": ["Edit this preset", "target"], "preset.copy": ["Duplicate preset", "duplicate"],
  "preset.remove": ["Remove preset", "trash"], "preset.rename": ["Rename…", "rename"], "preset.move": ["Move to position…", "arrowDown"],
  "layer.select": ["Select layer", "target"], "layer.duplicate": ["Duplicate layer", "duplicate"],
  "layer.remove": ["Remove layer", "trash"], "layer.toggle": ["Show or hide layer", "eye"], "layer.rename": ["Rename…", "rename"], "layer.move": ["Move to position…", "arrowDown"],
  "shape.selectLayer": ["Select this layer", "target"], "shape.addWarp": ["Add warp control", "warp"],
  "shape.enableBezier": ["Enable Bézier handles", "shape"],
  "point.select": ["Select point", "target"], "point.remove": ["Remove point", "trash"],
  "point.mode.aligned": ["Smooth handles", "shape"], "point.mode.symmetric": ["Symmetric handles", "shape"],
  "point.mode.corner": ["Corner handles", "shape"], "point.strength": ["Set point pigment…", "edge"],
  "point.softness": ["Set point edge softness…", "edge"],
  "field.select": ["Select warp", "target"], "field.clear": ["Reset warp direction", "reset"],
  "field.remove": ["Remove warp", "trash"], "field.reach": ["Set warp reach…", "warp"],
};
const labels = CONTEXT_LABELS;
/** Recovery wording for destructive menu entries, from the action's Undo policy. */
export const undoHint = (undo: string, id: string) => id.endsWith(".remove") || id === "preset.remove"
  ? undo === "recovery" ? "Restorable from the Presets panel" : `Undo with ${shortcutLabel("shell.undo")}` : undefined;
/** Row reorder chords from the catalogue ("Alt+↑", "Alt+↓"). */
const reorderKey = (index: 0 | 1) => chordLabel(keyBindingById("rows.reorder").chords[index]);

/** Menu items for an application-bound context. Every dispatch rechecks the binding. */
export function contextItems(rt: StudioRuntime, query: Query, anchor: MenuAnchor): MenuItem[] {
  const port = rt.port, recipe = port.editor.recipe(), hit = query.context.hit;
  // A stale or missing target needs no heading of its own: each entry is disabled with that reason.
  const items: MenuItem[] = [];
  for (const option of query.options) {
    const [label, iconName] = labels[option.id] ?? [option.id];
    if (!option.requiresInput) {
      const action = option.action;
      let text = label;
      if (option.id === "layer.toggle" && action.kind === "layer.setEnabled") text = action.enabled ? "Show layer" : "Hide layer";
      const checked = option.id.startsWith("point.mode.") && (hit.kind === "point" || hit.kind === "tangent")
        ? recipe.layers.find(layer => layer.id === hit.layerId)?.points[hit.index]?.handles?.mode === option.id.slice(11) : undefined;
      items.push({ kind: "action", label: text, icon: option.id === "layer.toggle" ? (text === "Show layer" ? "eye" : "eyeOff") : iconName,
        capability: option.capability, checked, danger: option.id.endsWith(".remove"), hint: undoHint(option.undo, option.id),
        run: () => dispatchBound(rt, query.context, action) });
      continue;
    }
    items.push({ kind: "action", label, icon: iconName, capability: option.capability,
      run: () => openInput(rt, query.context, option, anchor) });
  }
  return items;
}
function dispatchBound(rt: StudioRuntime, context: StudioBoundContext, action: StudioAction) {
  const result = rt.port.authoring.dispatchContext(context, action);
  if (!result.ok) rt.feedback.toast("warning", "Context menu", result.message);
}

function openInput(rt: StudioRuntime, context: StudioBoundContext, option: Extract<Option, { requiresInput: true }>, anchor: MenuAnchor) {
  const port = rt.port, hit = context.hit, recipe = port.editor.recipe();
  const bound = (action: StudioAction) => port.authoring.boundActionCapability(context, action);
  const commit = (action: StudioAction) => dispatchBound(rt, context, action);
  const percent = (value: number) => `${Math.round(value * 100)}%`, uv = (value: number) => `${(value * 100).toFixed(2)}% UV`;
  if (option.id === "point.strength" && (hit.kind === "point" || hit.kind === "tangent")) {
    const layer = recipe.layers.find(item => item.id === hit.layerId), range = rt.range("pigment.edit", "value", "point-strength");
    const make = (value: number): StudioAction => ({ kind: "pigment.edit", layerId: hit.layerId, command: { kind: "point-strength", index: hit.index, value } });
    openValuePopover({ kind: "range", label: "Pigment strength", value: layer?.points[hit.index]?.weight ?? 1, ...range, step: .01, format: percent },
      anchor, { title: `Point ${hit.index + 1} pigment`, apply: "Apply", validate: value => bound(make(Number(value))), commit: value => commit(make(Number(value))) });
  } else if (option.id === "point.softness" && (hit.kind === "point" || hit.kind === "tangent")) {
    const layer = recipe.layers.find(item => item.id === hit.layerId), range = rt.range("softness.edit", "value", "point-softness");
    const make = (value: number): StudioAction => ({ kind: "softness.edit", layerId: hit.layerId, command: { kind: "point-softness", index: hit.index, value } });
    openValuePopover({ kind: "range", label: "Edge softness", value: layer?.points[hit.index]?.feather ?? layer?.feather ?? .012, ...range, step: .0005, format: uv },
      anchor, { title: `Point ${hit.index + 1} edge softness`, apply: "Apply", validate: value => bound(make(Number(value))), commit: value => commit(make(Number(value))) });
  } else if (option.id === "field.reach" && hit.kind === "field") {
    const field = recipe.layers.find(item => item.id === hit.layerId)?.fields.find(item => item.id === hit.id);
    const range = rt.range("field.setReach", "radius");
    const make = (radius: number): StudioAction => ({ kind: "field.setReach", layerId: hit.layerId, fieldId: hit.id, radius });
    openValuePopover({ kind: "range", label: "Reach", value: field?.radius ?? .03, ...range, step: .001, format: uv },
      anchor, { title: "Warp reach", apply: "Apply", validate: value => bound(make(Number(value))), commit: value => commit(make(Number(value))) });
  } else if (option.id === "layer.rename" && hit.kind === "layer") {
    const layer = recipe.layers.find(item => item.id === hit.id);
    const make = (name: string): StudioAction => ({ kind: "layer.edit", command: { kind: "rename", id: hit.id, name } });
    openValuePopover({ kind: "text", label: "Layer name", value: layer?.name ?? "", maxLength: 80 }, anchor,
      { title: "Rename layer", apply: "Rename", validate: value => bound(make(String(value))), commit: value => commit(make(String(value))) });
  } else if (option.id === "layer.move" && hit.kind === "layer") {
    const count = recipe.layers.length, index = recipe.layers.findIndex(item => item.id === hit.id);
    const make = (position: number): StudioAction => ({ kind: "layer.edit", command: { kind: "move", id: hit.id, to: count - position } });
    openValuePopover({ kind: "integer", label: `Position from front (1–${count})`, value: count - index, min: 1, max: count }, anchor,
      { title: "Move layer", apply: "Move", validate: value => bound(make(Number(value))), commit: value => commit(make(Number(value))) });
  } else if (option.id === "preset.rename" && hit.kind === "preset") {
    const preset = port.library.summary().draft?.presets.find(item => item.id === hit.id);
    const make = (name: string): StudioAction => ({ kind: "preset.edit", command: { kind: "rename", id: hit.id, name } });
    openValuePopover({ kind: "text", label: "Preset name", value: preset?.name ?? "", maxLength: 120 }, anchor,
      { title: "Rename preset", apply: "Rename", validate: value => bound(make(String(value))), commit: value => commit(make(String(value))) });
  } else if (option.id === "preset.move" && hit.kind === "preset") {
    const presets = port.library.summary().draft?.presets ?? [], index = presets.findIndex(item => item.id === hit.id);
    const make = (position: number): StudioAction => ({ kind: "preset.edit", command: { kind: "move", id: hit.id, to: position - 1 } });
    openValuePopover({ kind: "integer", label: `Position (1–${presets.length})`, value: index + 1, min: 1, max: presets.length }, anchor,
      { title: "Move preset", apply: "Move", validate: value => bound(make(Number(value))), commit: value => commit(make(Number(value))) });
  } else if (option.id === "collection.rename") {
    const name = port.library.summary().draft?.name ?? "";
    const make = (value: string): StudioAction => ({ kind: "collection.rename", name: value });
    openValuePopover({ kind: "text", label: "Collection name", value: name, maxLength: 120 }, anchor,
      { title: "Rename collection", apply: "Rename", validate: value => bound(make(String(value))), commit: value => commit(make(String(value))) });
  }
}

/** Extra commands for a known target, checked with the hit target's identity, not the selection. */
export function targetAction(rt: StudioRuntime, target: StudioTarget, action: StudioAction, label: string,
  iconName?: IconName, extra: Partial<Extract<MenuItem, { kind: "action" }>> = {}): MenuItem {
  const capability: StudioCapability = rt.port.authoring.contextCapability(target, action);
  return { kind: "action", label, icon: iconName, capability, ...extra, run: () => { rt.dispatch(action); } };
}

/*
 * Context menus are actionable, not informational: every menu below is built from sections, and
 * `menuFromSections` drops any section with no action. Target-specific actions come first, then
 * view actions. Nothing here decides availability; each entry carries the application's capability.
 */
export function layerSections(rt: StudioRuntime, layerId: string, anchor: MenuAnchor): MenuSection[] {
  const port = rt.port, recipe = port.editor.recipe(), index = recipe.layers.findIndex(layer => layer.id === layerId);
  const layer = recipe.layers[index];
  if (!layer) return [];
  const query = port.authoring.contextQuery({ kind: "layer", id: layerId });
  const target: StudioTarget = { kind: "layer", id: layerId };
  return [{ label: layer.name, detail: `Layer ${recipe.layers.length - index} of ${recipe.layers.length} from front`, items: contextItems(rt, query, anchor) },
    { items: [
      targetAction(rt, target, { kind: "layer.edit", command: { kind: "move", id: layerId, to: index + 1 } }, "Bring forward", "arrowUp",
        { shortcut: reorderKey(0) }),
      targetAction(rt, target, { kind: "layer.edit", command: { kind: "move", id: layerId, to: index - 1 } }, "Send backward", "arrowDown",
        { shortcut: reorderKey(1) }),
      targetAction(rt, target, { kind: "layer.setSymmetry", layerId, symmetry: !layer.symmetry }, "Mirror across the face", "mirror",
        { checked: layer.symmetry }),
      { kind: "submenu", label: "Finish", icon: "finish", items: () => port.authoring.choicesFor(target, "layer.setFinish", "finish")
        .filter(choice => choice.value !== "satin")
        .map(choice => {
          const descriptor = rt.finishes.find(item => item.id === choice.value);
          return { kind: "action", label: descriptor?.label ?? String(choice.value), capability: choice.capability,
            checked: layer.finish === choice.value || (layer.finish === "satin" && choice.value === "regular"),
            hint: descriptor?.exportAdapter === "none" ? "Preview only · not built into your mod" : undefined,
            run: () => { rt.dispatch(choice.action); } };
        }) },
      targetAction(rt, target, { kind: "layer.edit", command: { kind: "reset", id: layerId } }, "Reset shape and settings", "reset",
        { hint: `Keeps the name; Undo with ${shortcutLabel("shell.undo")}` }),
    ] }];
}
export function layerMenu(rt: StudioRuntime, layerId: string, anchor: MenuAnchor, invoker?: Element) {
  const layer = rt.port.editor.recipe().layers.find(item => item.id === layerId);
  if (!layer) return;
  openMenu(menuFromSections(layerSections(rt, layerId, anchor)), anchor, { label: `${layer.name} layer actions`, invoker });
}

export function presetSections(rt: StudioRuntime, presetId: string, anchor: MenuAnchor): MenuSection[] {
  const port = rt.port, draft = port.library.summary().draft;
  const presets = draft?.presets ?? [], index = presets.findIndex(preset => preset.id === presetId);
  const preset = presets[index];
  if (!preset) return [];
  const target: StudioTarget = { kind: "preset", id: presetId };
  const query = port.authoring.contextQuery({ kind: "preset", id: presetId });
  return [{ label: preset.name, detail: `${preset.layers} ${preset.layers === 1 ? "layer" : "layers"} · preset ${index + 1} of ${presets.length}`,
    items: contextItems(rt, query, anchor) },
  { items: [
    targetAction(rt, target, { kind: "preset.edit", command: { kind: "move", id: presetId, to: index - 1 } }, "Move up", "arrowUp", { shortcut: reorderKey(0) }),
    targetAction(rt, target, { kind: "preset.edit", command: { kind: "move", id: presetId, to: index + 1 } }, "Move down", "arrowDown", { shortcut: reorderKey(1) }),
  ] }];
}
export function presetMenu(rt: StudioRuntime, presetId: string, anchor: MenuAnchor, invoker?: Element) {
  const preset = rt.port.library.summary().draft?.presets.find(item => item.id === presetId);
  if (!preset) return;
  openMenu(menuFromSections(presetSections(rt, presetId, anchor)), anchor, { label: `${preset.name} preset actions`, invoker });
}

export function collectionSections(rt: StudioRuntime, anchor: MenuAnchor): MenuSection[] {
  const query = rt.port.authoring.contextQuery({ kind: "collection" });
  return [{ label: rt.port.library.summary().draft?.name ?? "Collection", items: contextItems(rt, query, anchor) }];
}
export function collectionMenu(rt: StudioRuntime, anchor: MenuAnchor, invoker?: Element) {
  openMenu(menuFromSections(collectionSections(rt, anchor)), anchor, { label: "Collection actions", invoker });
}

/** View commands never edit, so they follow any target section. */
function viewSection(rt: StudioRuntime, kind: ViewportHostKind): MenuSection {
  const port = rt.port;
  if (kind === "uv") {
    const view = port.viewport.snapshot().uv.view;
    const command = (id: "both" | "single" | "other" | "fit", label: string): MenuItem => ({ kind: "action", label, shortcut: shortcutLabel(`uv.${id}`),
      capability: port.viewport.uvCommandCapability(id), checked: id === "both" ? view?.mode === "both" : id === "single" ? view?.mode === "single" : undefined,
      run: () => { port.viewport.uvCommand(id); } });
    return { label: "UV view", items: [command("both", "Both eyes"), command("single", "Single eye"), command("other", "Other eye"), command("fit", "Fit shape")] };
  }
  const preview = port.authoring.previewState().preview;
  return { label: "Head view", items: [
    { kind: "action", label: "Front view", icon: "front", shortcut: shortcutLabel("head.front"), capability: port.authoring.capability({ kind: "camera.front" }), run: () => { rt.dispatch({ kind: "camera.front" }); } },
    { kind: "action", label: "Surface controls", icon: "handles", checked: !!preview?.surface,
      capability: port.authoring.capability({ kind: "preview.setSurfaceControls", enabled: !preview?.surface }),
      run: () => { rt.dispatch({ kind: "preview.setSurfaceControls", enabled: !preview?.surface }); } },
    { kind: "action", label: "Plate wireframe", icon: "wire", checked: !!preview?.wire,
      capability: port.authoring.capability({ kind: "preview.setWire", enabled: !preview?.wire }),
      run: () => { rt.dispatch({ kind: "preview.setWire", enabled: !preview?.wire }); } }] };
}

/**
 * Sections for a viewport position (pointer) or the selected point (keyboard). The hit section
 * comes first; bare skin, empty UV space and background have no target actions, so their menu
 * is the view section alone.
 */
export function viewportSections(rt: StudioRuntime, kind: ViewportHostKind, anchor: MenuAnchor, at?: { x: number; y: number }): MenuSection[] {
  const port = rt.port, sections: MenuSection[] = [];
  const query = at ? port.viewport.contextAt(kind, at.x, at.y) : undefined;
  if (query) {
    const hit = query.context.hit, layerId = "layerId" in hit ? hit.layerId : undefined;
    const layer = layerId ? port.editor.recipe().layers.find(item => item.id === layerId) : undefined;
    const detail = [layer?.name, query.mirror ? "mirrored copy" : undefined].filter(Boolean).join(" · ") || undefined;
    sections.push({ label: TARGET_LABELS[kind][query.affordance], detail, items: contextItems(rt, query, anchor) });
  } else if (!at) {
    const layer = port.editor.layer();
    if (layer) sections.push({ label: `Selected point ${port.editor.selected() + 1}`, detail: layer.name,
      items: contextItems(rt, port.authoring.contextQuery({ kind: "point", layerId: layer.id, index: port.editor.selected() }), anchor) });
  }
  sections.push(viewSection(rt, kind));
  return sections;
}
export function viewportMenu(rt: StudioRuntime, kind: ViewportHostKind, anchor: MenuAnchor, at?: { x: number; y: number }, invoker?: Element) {
  openMenu(menuFromSections(viewportSections(rt, kind, anchor, at)), anchor, { label: `${kind === "head" ? "Head" : "UV map"} commands`, invoker });
}
