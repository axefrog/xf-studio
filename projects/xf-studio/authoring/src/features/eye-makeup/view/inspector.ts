import type { DirectGlintFlakes } from "../../../engines/layered-makeup/direct-glint-settings";
import { editingReference } from "../../../input-bindings";
// Conditional flake-size limits are not expressible in the static action descriptor yet (audit A-7).
import type { IrregularFlakes } from "../../../engines/layered-makeup/flake-field";
import type { LegacyFlakes } from "../../../engines/layered-makeup/finish";
import type { GlitterModel } from "../../../engines/layered-makeup/glitter-model";
import type { Layer } from "../../../engines/layered-makeup/recipe";
import type { RecipeAction } from "../../../engines/layered-makeup/recipe-actions";
import type { ReadonlyDeep } from "../../../read-only";
import { applyCapability, badge, button, ColorField, emptyState, note, section, Segmented, SelectField, Slider, Toggle, type Transaction } from "../../../studio-ui/controls";
import { h, pct, setAttr, setText } from "../../../studio-ui/dom";
import { icon } from "../../../studio-ui/icons";
import type { Frame, StudioRuntime } from "../../../studio-ui/runtime";
import type { PanelController } from "../../../studio-ui/panels/collection";
import { eyeMakeupActions } from "./actions";
import { EYE_MAKEUP_PANEL_META } from "./contribution";

type RLayer = ReadonlyDeep<Layer>;
const uvPct = (value: number) => `${(value * 100).toFixed(2)}% UV`;

/** One Undo step per continuous edit; refused or failed edits are reported, never swallowed. */
function recipeTransaction<T>(rt: StudioRuntime, id: string, make: (layer: RLayer, value: T) => RecipeAction | undefined): Transaction<T> {
  return {
    begin: () => { const layer = rt.editor.layer(); if (layer) rt.eyeMakeup.controlBegin(id, layer.id); },
    edit: value => {
      const layer = rt.editor.layer(); if (!layer) return;
      const action = make(layer, value); if (!action) return;
      const outcome = rt.eyeMakeup.controlEdit(id, action);
      if (!outcome.ok) { rt.feedback.toast("warning", "Colour & finish", outcome.message); rt.changed(); }
    },
    commit: () => rt.eyeMakeup.controlCommit(id),
    cancel: () => rt.eyeMakeup.controlCancel(id),
  };
}
/** Header strip telling a floating inspector which layer it edits. */
function layerStrip(rt: StudioRuntime) {
  const swatch = h("span", { class: "swatch", "aria-hidden": "true" }), name = h("strong"), meta = h("span", { class: "muted small" });
  const element = h("div", { class: "layer-strip", role: "status", "aria-live": "off" }, swatch, h("div", {}, name, meta));
  return { element, update(frame: Frame) {
    const layer = frame.layer, recipe = frame.recipe;
    element.hidden = !layer;
    if (!layer) return;
    swatch.style.setProperty("--swatch", layer.color); swatch.dataset.finish = rt.finishOf(layer.finish)?.id ?? layer.finish;
    setText(name, layer.name);
    const index = recipe.layers.findIndex(item => item.id === layer.id);
    setText(meta, `${recipe.layers.length - index} of ${recipe.layers.length} from front${layer.enabled ? "" : " · hidden"}`);
  } };
}
function noLayer(rt: StudioRuntime) {
  const add = button({ label: "Add layer", icon: "plus", onClick: () => eyeMakeupActions(rt).dispatch({ kind: "layer.edit", command: { kind: "add" } }) });
  const element = emptyState("No layer selected", "Select a layer in the Layers panel, or add one to this preset.", add);
  return { element, update(hasLayer: boolean) { element.hidden = hasLayer; if (!hasLayer) applyCapability(add, eyeMakeupActions(rt).addLayerCapability()); } };
}

export function finishPanel(rt: StudioRuntime): PanelController {
  const strip = layerStrip(rt), empty = noLayer(rt);
  const color = new ColorField({ label: "Colour", transaction: recipeTransaction<string>(rt, "color", (layer, value) => ({ kind: "layer.setColor", layerId: layer.id, color: value })) });
  const opacityRange = rt.range("layer.setOpacity", "opacity");
  const opacity = new Slider({ label: "Opacity", ...opacityRange, step: .01, format: pct,
    transaction: recipeTransaction<number>(rt, "opacity", (layer, value) => ({ kind: "layer.setOpacity", layerId: layer.id, opacity: value })) });
  // Finishes are grouped by export status, so each row's length is intentional and every group
  // heading is the one status line its cards share. Cards show the short name only; synonyms and
  // the full name are in the tooltip and the description line.
  const statusText = { "flat-provisional": "Exports", experimental: "Experimental", none: "Preview only" } as const;
  const finishButtons = rt.finishes.map(finish => {
    const element = h("button", { class: "finish-option", type: "button", "aria-pressed": "false", "data-finish": finish.id,
      "aria-label": `${finish.shortLabel}, ${statusText[finish.exportAdapter].toLowerCase()}` },
      h("span", { class: "finish-chip", "aria-hidden": "true" }), h("span", { class: "finish-name", text: finish.shortLabel }));
    element.addEventListener("click", () => {
      const layer = rt.editor.layer(); if (layer) eyeMakeupActions(rt).dispatch({ kind: "layer.setFinish", layerId: layer.id, finish: finish.id });
    });
    return { finish, element };
  });
  const finishGroup = h("div", { class: "finish-groups", role: "group", "aria-label": "Finish family" },
    (["flat-provisional", "experimental", "none"] as const).filter(status => finishButtons.some(item => item.finish.exportAdapter === status))
      .map(status => h("div", { class: "finish-group", "data-status": status },
        h("span", { class: `finish-tag ${status === "flat-provisional" ? "ok" : "warn"}`, "aria-hidden": "true", text: statusText[status] }),
        h("div", { class: "finish-grid" }, finishButtons.filter(item => item.finish.exportAdapter === status).map(item => item.element)))));
  finishGroup.addEventListener("keydown", event => {
    // Arrow keys follow the visual order (grouped by status), not catalogue order.
    const buttons = [...finishGroup.querySelectorAll<HTMLButtonElement>(".finish-option")], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step && index >= 0) { event.preventDefault(); buttons[(index + step + buttons.length) % buttons.length].focus(); }
  });
  const description = h("p", { class: "finish-description" });
  const exportLine = h("div", { class: "export-line" });
  const openPackage = button({ label: "Open mod package", icon: "package", small: true, variant: "quiet", onClick: () => rt.dock.reveal("package") });
  const useGame = button({ label: "Use game-matched model", icon: "finish", small: true, onClick: () => {
    const layer = rt.editor.layer(); if (layer) eyeMakeupActions(rt).dispatch({ kind: "layer.useGameOptics", layerId: layer.id });
  } });
  // Colour-shifting (game-matched): one shift colour added toward grazing view angles.
  const shift = {
    color: new ColorField({ label: "Shift colour", transaction: recipeTransaction<string>(rt, "shift-color", (layer, value) => ({ kind: "layer.setShift", layerId: layer.id, key: "color", value })) }),
    strength: new Slider({ label: "Shift strength", ...rt.range("layer.setShift", "value", "strength"), step: .01, format: pct,
      transaction: recipeTransaction<number>(rt, "shift-strength", (layer, value) => ({ kind: "layer.setShift", layerId: layer.id, key: "strength", value })) }),
  };
  const shiftSection = section("Colour shift", h("div", { class: "row gap-m align-end" }, shift.color.element, shift.strength.element),
    note("The shift colour is added toward the edges of the lid as the view angle grows, the way the game's gradient-recolour decal adds its Fresnel colour. One shift colour per preset exports; it is not thin-film or multichrome."));

  // Glitter preview suite and flake studies.
  const model = new SelectField<GlitterModel>({ label: "Glitter preview model", onChange: value => {
    const layer = rt.editor.layer(); if (layer) eyeMakeupActions(rt).dispatch({ kind: "glitter.selectModel", layerId: layer.id, model: value });
  } });
  const modelSummary = note("");
  const classic = {
    cells: new Slider({ label: "Flake fineness", ...rt.range("glitter.setClassic", "value", "cells"), step: 8, format: value => String(Math.round(value)),
      transaction: recipeTransaction<number>(rt, "flake-cells", (layer, value) => ({ kind: "glitter.setClassic", layerId: layer.id, key: "cells", value: Math.round(value) })) }),
    density: new Slider({ label: "Flake density", ...rt.range("glitter.setClassic", "value", "density"), step: .05, format: pct,
      transaction: recipeTransaction<number>(rt, "flake-density", (layer, value) => ({ kind: "glitter.setClassic", layerId: layer.id, key: "density", value })) }),
    tilt: new Slider({ label: "Orientation spread", ...rt.range("glitter.setClassic", "value", "tilt"), step: .05, format: pct,
      transaction: recipeTransaction<number>(rt, "flake-tilt", (layer, value) => ({ kind: "glitter.setClassic", layerId: layer.id, key: "tilt", value })) }),
  };
  // Field density shows as a percentage of the largest field the action takes (its registered range); when density and
  // flake size don't go together, the application says why.
  const flakesPerPercent = rt.range("glitter.setIrregular", "value", "count").max / 100;
  const irregular = {
    count: new Slider({ label: "Flake field density", min: 0, max: 100, step: 1, format: value => `${Math.round(value)}%`,
      transaction: recipeTransaction<number>(rt, "irregular-count", (layer, value) => ({ kind: "glitter.setIrregular", layerId: layer.id, key: "count", value: Math.round(Math.round(value) * flakesPerPercent) })) }),
    radius: new Slider({ label: "Flake size", ...rt.range("glitter.setIrregular", "value", "radius"), step: .00005, format: value => `${(value * 100).toFixed(3)}% UV`,
      transaction: recipeTransaction<number>(rt, "irregular-radius", (layer, value) => ({ kind: "glitter.setIrregular", layerId: layer.id, key: "radius", value })) }),
    spread: new Slider({ label: "Size variation", ...rt.range("glitter.setIrregular", "value", "spread"), step: .05, format: pct,
      transaction: recipeTransaction<number>(rt, "irregular-spread", (layer, value) => ({ kind: "glitter.setIrregular", layerId: layer.id, key: "spread", value })) }),
    tilt: new Slider({ label: "Orientation spread", ...rt.range("glitter.setIrregular", "value", "tilt"), step: .05, format: pct,
      transaction: recipeTransaction<number>(rt, "irregular-tilt", (layer, value) => ({ kind: "glitter.setIrregular", layerId: layer.id, key: "tilt", value })) }),
    color: new ColorField({ label: "Flake colour", transaction: recipeTransaction<string>(rt, "irregular-color", (layer, value) => ({ kind: "glitter.setIrregular", layerId: layer.id, key: "color", value })) }),
  };
  const measurement = note("", "info");
  // The legacy control capped glint strength at 16 of the parser's 32 for usable slider resolution.
  const direct = {
    density: new Slider({ label: "Facet density", ...rt.range("glitter.setDirect", "value", "density"), step: .01, format: pct,
      transaction: recipeTransaction<number>(rt, "direct-density", (layer, value) => ({ kind: "glitter.setDirect", layerId: layer.id, key: "density", value })) }),
    fineShare: new Slider({ label: "Fine-facet share", ...rt.range("glitter.setDirect", "value", "fineShare"), step: .01, format: pct,
      transaction: recipeTransaction<number>(rt, "direct-fineShare", (layer, value) => ({ kind: "glitter.setDirect", layerId: layer.id, key: "fineShare", value })) }),
    strength: new Slider({ label: "Glint strength", min: 0, max: Math.min(16, rt.range("glitter.setDirect", "value", "strength").max), step: .5, format: value => value.toFixed(1),
      transaction: recipeTransaction<number>(rt, "direct-strength", (layer, value) => ({ kind: "glitter.setDirect", layerId: layer.id, key: "strength", value })) }),
    color: new ColorField({ label: "Facet colour", transaction: recipeTransaction<string>(rt, "direct-color", (layer, value) => ({ kind: "glitter.setDirect", layerId: layer.id, key: "color", value })) }),
  };
  const glitterSection = section("Glitter preview suite", model.element, modelSummary,
    note("Layer colour sets the base pigment; facet colour is separate. Density is not a visible sparkle count. Browser previews only; mod packages do not support Glitter yet.", "warning"));
  const classicSection = section("Flake study", classic.cells.element, classic.density.element, classic.tilt.element,
    note("Orbit the head to inspect reflections. A browser material candidate; game matching and distant sparkle filtering are still being studied."));
  const irregularSection = section("Irregular flakes", irregular.count.element, measurement, irregular.radius.element, irregular.spread.element, irregular.tilt.element, irregular.color.element);
  const directSection = section("Glint facets", direct.density.element, direct.fineShare.element, direct.strength.element, direct.color.element);
  const body = h("div", { class: "stack" },
    section("Pigment", h("div", { class: "row gap-m align-end" }, color.element, opacity.element)),
    section("Finish", finishGroup, description, exportLine),
    shiftSection, glitterSection, classicSection, irregularSection, directSection);
  const element = h("div", { class: "panel-content" }, strip.element, empty.element, body);
  rt.anchors.register("finish.picker", finishGroup);
  rt.anchors.register("finish.color", color.element);
  return {
    spec: { id: "finish", ...EYE_MAKEUP_PANEL_META.finish, element },
    update(frame) {
      strip.update(frame);
      const layer = frame.layer;
      empty.update(!!layer); body.hidden = !layer;
      if (!layer) return;
      color.update(layer.color); opacity.update(layer.opacity);
      const current = rt.finishOf(layer.finish)?.id ?? layer.finish, target = { kind: "layer" as const, id: layer.id };
      const choices = rt.eyeMakeup.choicesFor(target, "layer.setFinish", "finish");
      for (const { finish, element } of finishButtons) {
        setAttr(element, "aria-pressed", String(finish.id === current));
        const choice = choices.find(item => item.value === finish.id);
        element.disabled = !!choice && !choice.capability.available && finish.id !== current;
        element.title = `${finish.label} — ${statusText[finish.exportAdapter]}. ${finish.description}${element.disabled ? `\n${choice?.capability.reason ?? ""}` : ""}`;
      }
      const descriptor = rt.finishes.find(finish => finish.id === current);
      setText(description, descriptor ? `${descriptor.aliases.length ? `${descriptor.shortLabel} (also ${descriptor.aliases.join(", ")}). ` : ""}${descriptor.description}` : "");
      // Per-layer status: an experimental finish still in its earlier preview model is left out until switched.
      const status = rt.eyeMakeup.layerExport(layer.id), key = `${current}:${status?.exportable ? status.experimental : status?.reason}`;
      if (exportLine.dataset.finish !== key) {
        exportLine.dataset.finish = key;
        const earlier = !!status && !status.exportable && status.blockedBy === "layer" && descriptor?.exportAdapter === "experimental";
        const byPreset = !!status && !status.exportable && status.blockedBy === "preset";
        exportLine.replaceChildren(!status?.exportable ? badge(earlier ? "Earlier preview model" : byPreset ? "Left out of this preset" : "Preview only", "warning")
          : status.experimental ? badge("Experimental", "warning") : badge("Can be built", "success"),
          h("span", { class: "small", text: status ? (status.exportable ? status.note : status.reason) : descriptor?.exportNote ?? "" }),
          ...(earlier ? [useGame] : []), openPackage);
      }
      const optics = layer.optics as ReadonlyDeep<Layer["optics"]>;
      shiftSection.hidden = !(current === "iridescent" && optics?.shift);
      if (!shiftSection.hidden) { shift.color.update(optics!.shift!.color); shift.strength.update(optics!.shift!.strength); }
      const flakes = layer.flakes as ReadonlyDeep<LegacyFlakes | IrregularFlakes | DirectGlintFlakes> | undefined;
      const glitter = current === "glitter", shimmer = current === "shimmer";
      const modelId: GlitterModel = flakes && "model" in flakes ? flakes.model === "irregular-planar-1" ? "irregular"
        : flakes.model === "uv-cell-direct-1" ? "direct" : flakes.model === "uv-cell-direct-2" ? "clustered" : "fine" : "classic";
      glitterSection.hidden = !glitter;
      classicSection.hidden = !(shimmer || (glitter && modelId === "classic"));
      irregularSection.hidden = !(glitter && modelId === "irregular");
      directSection.hidden = !(glitter && ["direct", "clustered", "fine"].includes(modelId));
      if (glitter) {
        const modelChoices = rt.eyeMakeup.choicesFor(target, "glitter.selectModel", "model");
        model.update(rt.glitterModels.map(item => ({ value: item.id, label: item.label,
          disabled: modelChoices.find(choice => choice.value === item.id)?.capability.available === false && item.id !== modelId })), modelId);
        setText(modelSummary, rt.glitterModels.find(item => item.id === modelId)?.summary ?? "");
      }
      if (!classicSection.hidden) {
        setText(classicSection.querySelector(".section-title")!, glitter ? "Classic reflective flakes" : "Shimmer flakes");
        const legacy = flakes && !("model" in flakes) ? flakes as ReadonlyDeep<LegacyFlakes> : { cells: 128, density: .65, tilt: .65 };
        classic.cells.update(legacy.cells); classic.density.update(legacy.density); classic.tilt.update(legacy.tilt);
      }
      if (!irregularSection.hidden && flakes && "model" in flakes && flakes.model === "irregular-planar-1") {
        const f = flakes as ReadonlyDeep<IrregularFlakes>, target = { kind: "layer" as const, id: layer.id };
        // Flake size and density bound each other; the application publishes the current limits.
        const count = rt.eyeMakeup.limitsFor(target, "glitter.setIrregular", "count").value;
        const radius = rt.eyeMakeup.limitsFor(target, "glitter.setIrregular", "radius").value;
        irregular.count.update(Math.round(f.count / flakesPerPercent), { note: count?.note });
        irregular.radius.update(f.radius, { min: radius?.min, max: radius?.max, note: radius?.note });
        irregular.spread.update(f.spread); irregular.tilt.update(f.tilt); irregular.color.update(f.color);
        const measured = frame.status.glitter.find(item => item.layerId === layer.id);
        setText(measurement, measured?.current
          ? `${measured.maskCentres.toLocaleString()} approximate flake centres in this painted shape from ${measured.regionRetained.toLocaleString()} ${measured.dense ? "retained in the eye UV regions" : "generated across the UV atlas"}. ${measured.coveredPixels.toLocaleString()} painted texture pixels contain flake coverage at ${measured.size}² — not visible screen glints.`
          : "Calculating flakes in this painted shape. Field density is not a visible flake count.");
      }
      if (!directSection.hidden && flakes && "model" in flakes && flakes.model !== "irregular-planar-1") {
        const f = flakes as ReadonlyDeep<DirectGlintFlakes>;
        setText(direct.density.element.querySelector(".control-label span")!, f.model === "uv-cell-direct-1" ? "Facet density" : "Maximum facet density");
        direct.density.update(f.density); direct.fineShare.update(f.fineShare); direct.strength.update(f.strength); direct.color.update(f.color);
      }
    },
  };
}

export function shapePanel(rt: StudioRuntime): PanelController {
  const strip = layerStrip(rt), empty = noLayer(rt);
  const pointLabel = h("strong", { class: "point-label" });
  const selectPoint = (delta: number) => {
    const layer = rt.editor.layer(); if (!layer) return;
    const index = (rt.editor.selected() + delta + layer.points.length) % layer.points.length;
    eyeMakeupActions(rt).dispatch({ kind: "point.select", layerId: layer.id, index });
  };
  const prev = button({ label: "Previous point", icon: "chevronLeft", iconOnly: true, small: true, onClick: () => selectPoint(-1) });
  const next = button({ label: "Next point", icon: "chevronRight", iconOnly: true, small: true, onClick: () => selectPoint(1) });
  const remove = button({ label: "Remove point", icon: "trash", small: true, variant: "quiet", onClick: () => {
    const layer = rt.editor.layer(); if (layer) eyeMakeupActions(rt).dispatch({ kind: "point.remove", layerId: layer.id, index: rt.editor.selected() });
  } });
  const enable = button({ label: "Enable Bézier handles", icon: "shape", small: true, onClick: () => {
    const layer = rt.editor.layer(); if (layer) eyeMakeupActions(rt).dispatch({ kind: "path.edit", layerId: layer.id, command: { kind: "enable-bezier" } });
  } });
  const modes = new Segmented<"aligned" | "symmetric" | "corner">({ label: "Selected point handles", options: [
    { value: "aligned", label: "Smooth", title: "Aligned arms with independent lengths" },
    { value: "symmetric", label: "Symmetric", title: "Opposite arms with equal lengths" },
    { value: "corner", label: "Corner", title: "Independent arms" }],
  onSelect: mode => { const layer = rt.editor.layer(); if (layer) eyeMakeupActions(rt).dispatch({ kind: "path.edit", layerId: layer.id, command: { kind: "point-mode", index: rt.editor.selected(), mode } }); } });
  const pathNote = note("");
  const mirror = new Toggle({ label: "Mirror across the face", onChange: checked => {
    const layer = rt.editor.layer(); if (layer) eyeMakeupActions(rt).dispatch({ kind: "layer.setSymmetry", layerId: layer.id, symmetry: checked });
  } });
  // Generated from the input binding catalogue; the full list is in the ? Keyboard & mouse dialog.
  const gestures = h("details", { class: "help-block" }, h("summary", { text: "Editing gestures" }),
    h("dl", { class: "shortcut-list" }, ...editingReference().flatMap(row => [h("dt", { text: row.input }),
      h("dd", { text: `${row.label}${row.where ? ` · ${row.where}` : ""}` })])),
    h("p", { class: "muted small", text: "The same gestures work in the UV map and on the head. Press ? for every binding." }));
  const body = h("div", { class: "stack" },
    section("Contour point", h("div", { class: "row between" }, h("div", { class: "row gap-xs" }, prev, pointLabel, next), remove)),
    section("Curve", enable, modes.element, pathNote),
    section("Symmetry", mirror.element),
    gestures);
  const element = h("div", { class: "panel-content" }, strip.element, empty.element, body);
  return {
    spec: { id: "shape", ...EYE_MAKEUP_PANEL_META.shape, element },
    update(frame) {
      strip.update(frame);
      const layer = frame.layer; empty.update(!!layer); body.hidden = !layer;
      if (!layer) return;
      const index = frame.selected, point = layer.points[index];
      setText(pointLabel, `Point ${index + 1} / ${layer.points.length}`);
      const target = { kind: "point" as const, layerId: layer.id, index };
      applyCapability(remove, eyeMakeupActions(rt).contextCapability(target, { kind: "point.remove", layerId: layer.id, index }));
      const bezier = layer.pathMode === "bezier";
      enable.hidden = bezier; modes.element.hidden = !bezier;
      modes.update(point?.handles?.mode);
      setText(pathNote, bezier
        ? "Drag the gold tangent handles in the UV map or on the head. Smooth keeps arms aligned; Symmetric also matches lengths; Corner moves each independently. Handles may cross the eye opening — they are guides, not surface anchors."
        : "This saved shape uses automatic curves. Enable Bézier handles to edit tangents; the curve is preserved, though finer sampling can change edge pixels slightly. Undo restores it.");
      mirror.update(layer.symmetry);
    },
  };
}

export function edgePanel(rt: StudioRuntime): PanelController {
  const strip = layerStrip(rt), empty = noLayer(rt);
  const weight = new Slider({ label: "Selected point pigment", ...rt.range("pigment.edit", "value", "point-strength"), step: .01, format: pct,
    transaction: recipeTransaction<number>(rt, "weight", (layer, value) => ({ kind: "pigment.edit", layerId: layer.id, command: { kind: "point-strength", index: rt.editor.selected(), value } })) });
  const smooth = new Toggle({ label: "Smooth point gradients", onChange: enabled => {
    const layer = rt.editor.layer(); if (!layer) return;
    rt.eyeMakeup.controlBegin("smooth-strength", layer.id);
    const outcome = rt.eyeMakeup.controlEdit("smooth-strength", { kind: "pigment.edit", layerId: layer.id, command: { kind: "smooth-strength", enabled } });
    if (!outcome.ok) rt.feedback.toast("warning", "Pigment", outcome.message);
    rt.eyeMakeup.controlCommit("smooth-strength");
  } });
  const blend = new Slider({ label: "Point blend", ...rt.range("pigment.edit", "value", "strength-blend"), step: rt.range("pigment.edit", "value", "strength-blend").min, format: uvPct,
    transaction: recipeTransaction<number>(rt, "strength-blend", (layer, value) => layer.strength.mode === "smooth-boundary"
      ? { kind: "pigment.edit", layerId: layer.id, command: { kind: "strength-blend", value } } : undefined) });
  const pigmentNote = note("");
  const variable = new Toggle({ label: "Per-point edge softness", onChange: enabled => {
    const layer = rt.editor.layer(); if (!layer) return;
    rt.eyeMakeup.controlBegin("variable-softness", layer.id);
    const outcome = rt.eyeMakeup.controlEdit("variable-softness", { kind: "softness.edit", layerId: layer.id, command: { kind: "variable-softness", enabled } });
    if (!outcome.ok) rt.feedback.toast("warning", "Edge", outcome.message);
    rt.eyeMakeup.controlCommit("variable-softness");
  } });
  const width = new Slider({ label: "Edge softness", ...rt.range("softness.edit", "value", "uniform-softness"), step: .0005, format: uvPct,
    transaction: recipeTransaction<number>(rt, "feather", (layer, value) => ({ kind: "softness.edit", layerId: layer.id,
      command: layer.softness.mode === "boundary" ? { kind: "point-softness", index: rt.editor.selected(), value } : { kind: "uniform-softness", value } })) });
  const softnessNote = note("");
  const pointLabel = h("span", { class: "muted small" });
  const body = h("div", { class: "stack" },
    section("Pigment strength", pointLabel, weight.element, smooth.element, blend.element, pigmentNote),
    section("Edge softness", variable.element, width.element, softnessNote));
  const element = h("div", { class: "panel-content" }, strip.element, empty.element, body);
  return {
    spec: { id: "edge", ...EYE_MAKEUP_PANEL_META.edge, element },
    update(frame) {
      strip.update(frame);
      const layer = frame.layer; empty.update(!!layer); body.hidden = !layer;
      if (!layer) return;
      const point = layer.points[frame.selected];
      setText(pointLabel, `Editing point ${frame.selected + 1} of ${layer.points.length} · select points in the UV map or on the head`);
      weight.update(point?.weight);
      const smoothMode = layer.strength.mode === "smooth-boundary";
      smooth.update(smoothMode);
      blend.update(smoothMode ? (layer.strength as { blend: number }).blend : undefined,
        { disabled: !smoothMode, reason: "Enable smooth point gradients to adjust blending." });
      setText(pigmentNote, smoothMode
        ? "Point strength blends pigment across the shape. More blend softens differences between nearby points; a zero point may retain some pigment. Edge softness controls the outline separately."
        : "Original point blending is preserved for this layer. Enable smooth gradients to remove internal strength seams; Undo restores the previous look.");
      const perPoint = layer.softness.mode === "boundary";
      variable.update(perPoint);
      setText(width.element.querySelector(".control-label span")!, perPoint ? "Selected point softness" : "Edge softness");
      width.update(perPoint ? point?.feather ?? layer.feather : layer.feather);
      setText(softnessNote, perPoint
        ? "Widths blend between points; very soft edges can influence nearby sharp edges in narrow shapes. Turning this off keeps your point settings."
        : "One fade width around the whole shape. Enable per-point softness to vary the edge independently of pigment strength.");
    },
  };
}

export function warpPanel(rt: StudioRuntime): PanelController {
  const strip = layerStrip(rt), empty = noLayer(rt);
  const add = button({ label: "Add warp", icon: "plus", small: true, onClick: () => {
    const layer = rt.editor.layer(); if (layer) eyeMakeupActions(rt).dispatch({ kind: "field.add", layerId: layer.id });
  } });
  const chips = h("div", { class: "chip-row", role: "group", "aria-label": "Warp controls" });
  const reach = new Slider({ label: "Reach", ...rt.range("field.setReach", "radius"), step: .001, format: uvPct,
    transaction: {
      begin: () => { const layer = rt.editor.layer(); if (layer && rt.editor.selectedField()) rt.eyeMakeup.controlBegin("radius", layer.id); },
      edit: value => { const layer = rt.editor.layer(), field = rt.editor.selectedField(); if (!layer || !field) return;
        const outcome = rt.eyeMakeup.controlEdit("radius", { kind: "field.setReach", layerId: layer.id, fieldId: field.id, radius: value });
        if (!outcome.ok) { rt.feedback.toast("warning", "Warp", outcome.message); rt.changed(); } },
      commit: () => rt.eyeMakeup.controlCommit("radius"), cancel: () => rt.eyeMakeup.controlCancel("radius"),
    } });
  const clear = button({ label: "Reset pull", icon: "reset", small: true, variant: "quiet", onClick: () => {
    const layer = rt.editor.layer(), field = rt.editor.selectedField(); if (layer && field) eyeMakeupActions(rt).dispatch({ kind: "field.clear", layerId: layer.id, fieldId: field.id });
  } });
  const remove = button({ label: "Remove warp", icon: "trash", small: true, variant: "quiet", onClick: () => {
    const layer = rt.editor.layer(), field = rt.editor.selectedField(); if (layer && field) eyeMakeupActions(rt).dispatch({ kind: "field.remove", layerId: layer.id, fieldId: field.id });
  } });
  const fieldNote = note("");
  let signature = "";
  const selected = section("Selected warp", reach.element, h("div", { class: "row wrap gap-s" }, clear, remove));
  const body = h("div", { class: "stack" },
    section("Warp controls", h("div", { class: "row between" }, chips, add), fieldNote), selected,
    note("A warp bends the makeup mask, not the face. Its pull fades smoothly beyond the reach ring; overlapping warps add together."));
  const element = h("div", { class: "panel-content" }, strip.element, empty.element, body);
  return {
    spec: { id: "warp", ...EYE_MAKEUP_PANEL_META.warp, element },
    update(frame) {
      strip.update(frame);
      const layer = frame.layer; empty.update(!!layer); body.hidden = !layer;
      if (!layer) return;
      const field = frame.field;
      const key = JSON.stringify([layer.id, layer.fields.map(item => item.id)]);
      if (key !== signature) {
        signature = key;
        chips.replaceChildren(...layer.fields.map((item, index) => {
          const chip = h("button", { class: "chip-button", type: "button", "aria-pressed": "false", "data-field": item.id }, icon("warp"), h("span", { text: `Warp ${index + 1}` }));
          chip.addEventListener("click", () => { const current = rt.editor.layer(); if (current) eyeMakeupActions(rt).dispatch({ kind: "field.select", layerId: current.id, fieldId: item.id }); });
          return chip;
        }));
      }
      for (const chip of chips.querySelectorAll<HTMLElement>("[data-field]")) setAttr(chip, "aria-pressed", String(chip.dataset.field === field?.id));
      applyCapability(add, eyeMakeupActions(rt).contextCapability({ kind: "layer", id: layer.id }, { kind: "field.add", layerId: layer.id }));
      selected.hidden = !field;
      if (field) {
        reach.update(field.radius);
        const target = { kind: "field" as const, layerId: layer.id, id: field.id };
        applyCapability(clear, !field.du && !field.dv ? { available: false, reason: "This warp has no pull to reset." } :
          eyeMakeupActions(rt).contextCapability(target, { kind: "field.clear", layerId: layer.id, fieldId: field.id }));
        applyCapability(remove, eyeMakeupActions(rt).contextCapability(target, { kind: "field.remove", layerId: layer.id, fieldId: field.id }));
      }
      setText(fieldNote, field
        ? `Circle: position · square: pull · dashed ring: reach. ${layer.fields.length} warp control${layer.fields.length === 1 ? "" : "s"} on this layer.`
        : "No warping. Add a control, then drag its square in the UV map or on the head to pull the makeup.");
    },
  };
}
