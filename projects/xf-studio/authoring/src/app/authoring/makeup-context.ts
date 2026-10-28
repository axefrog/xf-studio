/** Eye makeup's context policy and plain presentation facts, contributed on its existing registration. */
import type { FeatureContext, ContextCandidate, StudioContextHit, ContextInput } from "../studio-context-targets";
import type { StudioApplicationServices, StudioAction } from "../studio-application";
import type { Unnamed } from "../action-targets";
import type { Recipe } from "../../engines/layered-makeup/recipe";
export const MAKEUP_CONTEXT_LABELS: Readonly<Record<string, [string, string?]>> = {
  "layer.select": ["Select layer", "target"], "layer.duplicate": ["Duplicate layer", "duplicate"],
  "layer.remove": ["Remove layer", "trash"], "layer.toggle": ["Show or hide layer", "eye"], "layer.rename": ["Rename…", "rename"], "layer.move": ["Move to position…", "arrowDown"],
  "shape.selectLayer": ["Select this layer", "target"], "shape.addWarp": ["Add warp", "warp"],
  "shape.enableBezier": ["Enable Bézier handles", "shape"],
  "point.select": ["Select point", "target"], "point.remove": ["Remove point", "trash"],
  "point.mode.aligned": ["Smooth handles", "shape"], "point.mode.symmetric": ["Symmetric handles", "shape"],
  "point.mode.corner": ["Corner handles", "shape"], "point.strength": ["Set point pigment…", "edge"],
  "point.softness": ["Set point edge softness…", "edge"],
  "field.select": ["Select warp", "target"], "field.clear": ["Reset warp pull", "reset"],
  "field.remove": ["Remove warp", "trash"], "field.reach": ["Set warp reach…", "warp"],
};

export function makeupContextCandidates(hit: StudioContextHit, recipe: Recipe): ContextCandidate[] {
  const ready = (id: string, action: Unnamed<StudioAction>): ContextCandidate => ({ id, action });
  const input = (id: string, actionKind: StudioAction["kind"], variant?: string): ContextCandidate => ({ id, actionKind, variant, requiresInput: true });
  if (hit.kind === "layer") {
    const layer = recipe.layers.find(item => item.id === hit.id);
    return [
      ready("layer.select", { kind: "layer.select", layerId: hit.id }),
      ready("layer.duplicate", { kind: "layer.edit", command: { kind: "duplicate", id: hit.id } }),
      ready("layer.remove", { kind: "layer.edit", command: { kind: "remove", id: hit.id } }),
      ready("layer.toggle", { kind: "layer.setEnabled", id: hit.id, enabled: !layer?.enabled }),
      input("layer.rename", "layer.edit", "rename"),
      input("layer.move", "layer.edit", "move")];
  }
  if (hit.kind === "shape") return [
    ready("shape.selectLayer", { kind: "layer.select", layerId: hit.layerId }),
    ready("shape.addWarp", { kind: "field.add", layerId: hit.layerId }),
    ...(recipe.layers.find(layer => layer.id === hit.layerId)?.pathMode === "bezier" ? [] : [
      ready("shape.enableBezier", { kind: "path.edit", layerId: hit.layerId,
        command: { kind: "enable-bezier" } })])];
  if (hit.kind === "point" || hit.kind === "tangent") {
    const options: ContextCandidate[] = [
      ready("point.select", { kind: "point.select", layerId: hit.layerId, index: hit.index }),
      ready("point.remove", { kind: "point.remove", layerId: hit.layerId, index: hit.index })];
    if (recipe.layers.find(layer => layer.id === hit.layerId)?.pathMode === "bezier")
      for (const mode of ["aligned", "symmetric", "corner"] as const)
        options.push(ready(`point.mode.${mode}`, { kind: "path.edit", layerId: hit.layerId,
          command: { kind: "point-mode", index: hit.index, mode } }));
    options.push(input("point.strength", "pigment.edit", "point-strength"),
      input("point.softness", "softness.edit", "point-softness"));
    return options;
  }
  if (hit.kind === "field") return [
    ready("field.select", { kind: "field.select", layerId: hit.layerId, fieldId: hit.id }),
    ready("field.clear", { kind: "field.clear", layerId: hit.layerId, fieldId: hit.id }),
    ready("field.remove", { kind: "field.remove", layerId: hit.layerId, fieldId: hit.id }),
    input("field.reach", "field.setReach")];
  // Pan, zoom and insertion need adapter coordinates; no current standalone action
  // has those inputs. Do not suggest an edit at the wrong place on bare skin or empty
  // canvas: those hits offer no target section, only the viewport's own view actions.
  return [];
}

export function makeupContext(s: StudioApplicationServices): FeatureContext {
  const state = () => s.eyeMakeup!.state(), recipe = () => state().part;
  const missing = (reason: string) => ({ available: false as const, code: "missing_target" as const, reason });
  const target: FeatureContext["target"] = hit => {
    const layers = recipe().layers;
    if (hit.kind === "layer") return layers.some(layer => layer.id === hit.id) ? { available: true } : missing("That layer no longer exists.");
    if (hit.kind === "point") return layers.find(layer => layer.id === hit.layerId)?.points[hit.index] ? { available: true } : missing("That control point no longer exists.");
    if (hit.kind === "field") return layers.find(layer => layer.id === hit.layerId)?.fields.some(field => field.id === hit.id) ? { available: true } : missing("That warp no longer exists.");
  };
  return {
    handles: hit => hit.kind !== "collection" && hit.kind !== "preset",
    revision: () => "geometryVersion" in s.document ? s.document.geometryVersion.revision : s.document.version,
    target,
    validate(hit) {
      if (hit.kind !== "tangent") return;
      const layer = recipe().layers.find(layer => layer.id === hit.layerId);
      if (layer?.pathMode !== "bezier" || !layer.points[hit.index]?.handles) return missing("That Bézier tangent no longer exists.");
    },
    candidates(hit) {
      return makeupContextCandidates(hit, recipe()).map(item => {
        const [label, icon] = MAKEUP_CONTEXT_LABELS[item.id] ?? [item.id];
        const layerId = "layerId" in hit ? hit.layerId : hit.kind === "layer" ? hit.id : undefined;
        const layer = recipe().layers.find(layer => layer.id === layerId);
        let checked: boolean | undefined, text = label, image = icon;
        if (item.id === "layer.toggle" && "action" in item && item.action.kind === "layer.setEnabled") {
          text = item.action.enabled ? "Show layer" : "Hide layer"; image = item.action.enabled ? "eye" : "eyeOff";
        }
        if (item.id.startsWith("point.mode.") && (hit.kind === "point" || hit.kind === "tangent"))
          checked = layer?.points[hit.index]?.handles?.mode === item.id.slice(11);
        const capability = item.id === "point.softness" && layer?.softness.mode !== "boundary"
          ? { available: false as const, code: "incompatible_mode" as const, reason: "Turn on Per-point edge softness before editing one point's edge." } : undefined;
        let input: ContextCandidate["input"];
        const make = (action: (value: string | number) => Unnamed<StudioAction>, data: ContextInput) => ({ ...data, make: action });
        if ((hit.kind === "point" || hit.kind === "tangent") && item.id === "point.strength")
          input = make(value => ({ kind: "pigment.edit", layerId: hit.layerId, command: { kind: "point-strength", index: hit.index, value: Number(value) } }),
            { kind: "range", label: "Pigment strength", value: layer?.points[hit.index]?.weight ?? 1, step: .01, format: "percent", title: `Point ${hit.index + 1} pigment`, apply: "Apply" });
        if ((hit.kind === "point" || hit.kind === "tangent") && item.id === "point.softness")
          input = make(value => ({ kind: "softness.edit", layerId: hit.layerId, command: { kind: "point-softness", index: hit.index, value: Number(value) } }),
            { kind: "range", label: "Edge softness", value: layer?.points[hit.index]?.feather ?? layer?.feather ?? .012, step: .0005, format: "scale", title: `Point ${hit.index + 1} edge softness`, apply: "Apply" });
        if (hit.kind === "field" && item.id === "field.reach")
          input = make(value => ({ kind: "field.setReach", layerId: hit.layerId, fieldId: hit.id, radius: Number(value) }),
            { kind: "range", field: "radius", label: "Reach", value: layer?.fields.find(field => field.id === hit.id)?.radius ?? .03, step: .001, format: "scale", title: "Warp reach", apply: "Apply" });
        if (hit.kind === "layer" && item.id === "layer.rename")
          input = make(value => ({ kind: "layer.edit", command: { kind: "rename", id: hit.id, name: String(value) } }),
            { kind: "text", label: "Layer name", value: layer?.name ?? "", maxLength: 80, title: "Rename layer", apply: "Rename" });
        if (hit.kind === "layer" && item.id === "layer.move") {
          const count = recipe().layers.length, index = recipe().layers.findIndex(layer => layer.id === hit.id);
          input = make(value => ({ kind: "layer.edit", command: { kind: "move", id: hit.id, to: count - Number(value) } }),
            { kind: "integer", label: `Position from front (1–${count})`, value: count - index, min: 1, max: count, title: "Move layer", apply: "Move" });
        }
        return { ...item, label: text, icon: image, checked, capability, input };
      });
    },
    detail(hit) { return "layerId" in hit ? recipe().layers.find(layer => layer.id === hit.layerId)?.name : undefined; },
    selected() { const value = state(), layer = value.part.layers[value.editor.active]; return layer ? {
      hit: { kind: "point", layerId: layer.id, index: value.editor.selected }, label: `Selected point ${value.editor.selected + 1}`, detail: layer.name } : undefined; },
    inputFacts() { const value = state(), layer = value.part.layers[value.editor.active], owner = s.collection?.selectedPreset(); return {
      hasTarget: !!layer, enabled: !!layer?.enabled, locked: !(owner?.loaded && !owner.id) && !!s.document.locked }; },
  };
}
