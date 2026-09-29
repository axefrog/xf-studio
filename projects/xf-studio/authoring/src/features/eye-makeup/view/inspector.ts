import type { DirectGlintFlakes } from "../../../engines/layered-makeup/direct-glint-settings";
import { editingReference } from "../../../input-bindings";
// Conditional flake-size limits are not expressible in the static action descriptor yet (audit A-7).
import type { IrregularFlakes } from "../../../engines/layered-makeup/flake-field";
import type { LegacyFlakes } from "../../../engines/layered-makeup/finish";
import type { GlitterModel } from "../../../engines/layered-makeup/glitter-model";
import type { Layer } from "../../../engines/layered-makeup/recipe";
import type { Mottle, MottlePresetId } from "../../../engines/layered-makeup/mottle";
import type { MottleKey, RecipeAction } from "../../../engines/layered-makeup/recipe-actions";
import type { ReadonlyDeep } from "../../../read-only";
import { applyCapability, badge, button, ColorField, emptyState, note, section, Segmented, SelectField, Slider, Toggle, type Transaction } from "../../../studio-ui/controls";
import { h, nameWithAliases, pct, scaleText, setAttr, setText } from "../../../studio-ui/dom";
import { ChoiceList, propertyList, setHelp } from "../../../studio-ui/components";
import { icon } from "../../../studio-ui/icons";
import type { Frame } from "../../../studio-ui/runtime";
import type { PanelController } from "../../../studio-ui/panels/collection";
import { addLayer, addLayerCapability, catalogues, finenessState, finishOffered, type EyeMakeupViewContext } from "./actions";
import { EYE_MAKEUP_PANEL_META } from "./contribution";

type RLayer = ReadonlyDeep<Layer>;

/** One Undo step per continuous edit; refused or failed edits are reported, never swallowed. */
function recipeTransaction<T>(ctx: EyeMakeupViewContext, id: string, make: (layer: RLayer, value: T) => RecipeAction | undefined,
  title = "Colour & finish"): Transaction<T> {
  return {
    begin: () => { const layer = ctx.facade.view().layer(); if (layer) ctx.facade.controlBegin(id, layer.id); },
    edit: value => {
      const layer = ctx.facade.view().layer(); if (!layer) return;
      const action = make(layer, value); if (!action) return;
      const outcome = ctx.facade.controlEdit(id, action);
      if (!outcome.ok) { ctx.feedback.toast("warning", title, outcome.message); ctx.changed(); }
    },
    commit: () => ctx.facade.controlCommit(id),
    cancel: () => ctx.facade.controlCancel(id),
  };
}
/** Header strip telling a floating inspector which layer it edits. */
function layerStrip(ctx: EyeMakeupViewContext) {
  const swatch = h("span", { class: "swatch", "aria-hidden": "true" }), name = h("strong"), meta = h("span", { class: "muted small" });
  const element = h("div", { class: "layer-strip", role: "status", "aria-live": "off" }, swatch, h("div", {}, name, meta));
  return { element, update(frame: Frame) {
    const layer = frame.layer, recipe = frame.recipe;
    element.hidden = !layer;
    if (!layer) return;
    swatch.style.setProperty("--swatch", layer.color); swatch.dataset.finish = catalogues(ctx).finishOf(layer.finish)?.id ?? layer.finish;
    setText(name, layer.name);
    const index = recipe.layers.findIndex(item => item.id === layer.id);
    setText(meta, `${recipe.layers.length - index} of ${recipe.layers.length} from front${layer.enabled ? "" : " · hidden"}`);
  } };
}
function noLayer(ctx: EyeMakeupViewContext) {
  const add = button({ label: "Add layer", icon: "plus", onClick: () => ctx.dispatch(addLayer()) });
  const element = emptyState("No layer selected", "Select a layer in the Layers panel, or add one to this preset.", add);
  return { element, update(hasLayer: boolean) { element.hidden = hasLayer; if (!hasLayer) applyCapability(add, addLayerCapability(ctx)); } };
}

export function finishPanel(ctx: EyeMakeupViewContext): PanelController {
  const strip = layerStrip(ctx), empty = noLayer(ctx);
  const color = new ColorField({ label: "Colour", transaction: recipeTransaction<string>(ctx, "color", (layer, value) => ({ kind: "layer.setColor", layerId: layer.id, color: value })) });
  const opacityRange = ctx.range("layer.setOpacity", "opacity");
  const opacity = new Slider({ label: "Opacity", ...opacityRange, step: .01, format: pct,
    transaction: recipeTransaction<number>(ctx, "opacity", (layer, value) => ({ kind: "layer.setOpacity", layerId: layer.id, opacity: value })) });
  // Finishes are grouped by export status, so each row's length is intentional and every group
  // heading is the one status line its cards share. Cards show the finish's one name; synonyms are
  // in the tooltip and the description line.
  const statusText = { "flat-provisional": "Can be built", experimental: "Experimental", none: "Preview only" } as const;
  const finishButtons = catalogues(ctx).finishes.map(finish => {
    const element = h("button", { class: "finish-option", type: "button", "aria-pressed": "false", "data-finish": finish.id,
      "aria-label": `${finish.shortLabel}, ${statusText[finish.exportAdapter].toLowerCase()}` },
      h("span", { class: "finish-chip", "aria-hidden": "true" }), h("span", { class: "finish-name", text: finish.shortLabel }));
    element.addEventListener("click", () => {
      const layer = ctx.facade.view().layer(); if (layer) ctx.dispatch({ kind: "layer.setFinish", layerId: layer.id, finish: finish.id });
    });
    return { finish, element };
  });
  const statusGroups = (["flat-provisional", "experimental", "none"] as const).filter(status => finishButtons.some(item => item.finish.exportAdapter === status))
    .map(status => ({ status, element: h("div", { class: "finish-group", "data-status": status },
      h("span", { class: `finish-tag ${status === "flat-provisional" ? "ok" : "warn"}`, "aria-hidden": "true", text: statusText[status] }),
      h("div", { class: "finish-grid" }, finishButtons.filter(item => item.finish.exportAdapter === status).map(item => item.element))) }));
  const finishGroup = h("div", { class: "finish-groups", role: "group", "aria-label": "Finish family" }, statusGroups.map(group => group.element));
  finishGroup.addEventListener("keydown", event => {
    // Arrow keys follow the visual order (grouped by status), not catalogue order; finishes behind research tools are skipped.
    const buttons = [...finishGroup.querySelectorAll<HTMLButtonElement>(".finish-option:not([hidden])")], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step && index >= 0) { event.preventDefault(); buttons[(index + step + buttons.length) % buttons.length].focus(); }
  });
  const description = h("p", { class: "finish-description" });
  const exportLine = h("div", { class: "export-line" });
  const openPackage = button({ label: "Open mod package", icon: "package", small: true, variant: "quiet", onClick: () => ctx.reveal("package") });
  const useGame = button({ label: "Use game-matched model", icon: "finish", small: true, onClick: () => {
    const layer = ctx.facade.view().layer(); if (layer) ctx.dispatch({ kind: "layer.useGameOptics", layerId: layer.id });
  } });
  // Colour-shifting (game-matched): one shift colour added toward grazing view angles.
  const shift = {
    color: new ColorField({ label: "Shift colour", transaction: recipeTransaction<string>(ctx, "shift-color", (layer, value) => ({ kind: "layer.setShift", layerId: layer.id, key: "color", value })) }),
    strength: new Slider({ label: "Shift strength", ...ctx.range("layer.setShift", "value", "strength"), step: .01, format: pct,
      transaction: recipeTransaction<number>(ctx, "shift-strength", (layer, value) => ({ kind: "layer.setShift", layerId: layer.id, key: "strength", value })) }),
  };
  // What the shift is, in the heading's help tip (help-tip.ts).
  const shiftSection = section({ title: "Colour shift", help: ["The shift colour shows toward the lid's edges as the view angle grows.",
    "One shift colour per preset is built into your mod."] }, h("div", { class: "row gap-m align-end" }, shift.color.element, shift.strength.element));

  // Glitter styles: the three sparkle models, all shown (ChoiceList `rows`); the classic and irregular flake studies join them
  // only with research tools on (or on a layer already using one). The chosen style's description goes in the Glitter
  // heading's one help tip (UI-131), so the list has no tip of its own.
  const model = new ChoiceList<GlitterModel>({ label: "Glitter style", layout: "rows", onSelect: value => {
    const layer = ctx.facade.view().layer(); if (layer) ctx.dispatch({ kind: "glitter.selectModel", layerId: layer.id, model: value });
  } });
  const classic = {
    cells: new Slider({ label: "Flake fineness", ...ctx.range("glitter.setClassic", "value", "cells"), step: 8, format: value => String(Math.round(value)),
      transaction: recipeTransaction<number>(ctx, "flake-cells", (layer, value) => ({ kind: "glitter.setClassic", layerId: layer.id, key: "cells", value: Math.round(value) })) }),
    density: new Slider({ label: "Flake density", ...ctx.range("glitter.setClassic", "value", "density"), step: .05, format: pct,
      transaction: recipeTransaction<number>(ctx, "flake-density", (layer, value) => ({ kind: "glitter.setClassic", layerId: layer.id, key: "density", value })) }),
    tilt: new Slider({ label: "Orientation spread", ...ctx.range("glitter.setClassic", "value", "tilt"), step: .05, format: pct,
      transaction: recipeTransaction<number>(ctx, "flake-tilt", (layer, value) => ({ kind: "glitter.setClassic", layerId: layer.id, key: "tilt", value })) }),
  };
  // Field density shows as a percentage of the largest field the action takes (its registered range); when density and
  // flake size don't go together, the application says why.
  const flakesPerPercent = ctx.range("glitter.setIrregular", "value", "count").max / 100;
  const irregular = {
    count: new Slider({ label: "Flake field density", min: 0, max: 100, step: 1, format: value => `${Math.round(value)}%`, reserveNote: true,
      transaction: recipeTransaction<number>(ctx, "irregular-count", (layer, value) => ({ kind: "glitter.setIrregular", layerId: layer.id, key: "count", value: Math.round(Math.round(value) * flakesPerPercent) })) }),
    radius: new Slider({ label: "Flake size", ...ctx.range("glitter.setIrregular", "value", "radius"), step: .00005, format: value => `${(value * 100).toFixed(3)}% UV`, reserveNote: true,
      transaction: recipeTransaction<number>(ctx, "irregular-radius", (layer, value) => ({ kind: "glitter.setIrregular", layerId: layer.id, key: "radius", value })) }),
    spread: new Slider({ label: "Size variation", ...ctx.range("glitter.setIrregular", "value", "spread"), step: .05, format: pct,
      transaction: recipeTransaction<number>(ctx, "irregular-spread", (layer, value) => ({ kind: "glitter.setIrregular", layerId: layer.id, key: "spread", value })) }),
    tilt: new Slider({ label: "Orientation spread", ...ctx.range("glitter.setIrregular", "value", "tilt"), step: .05, format: pct,
      transaction: recipeTransaction<number>(ctx, "irregular-tilt", (layer, value) => ({ kind: "glitter.setIrregular", layerId: layer.id, key: "tilt", value })) }),
    color: new ColorField({ label: "Flake colour", transaction: recipeTransaction<string>(ctx, "irregular-color", (layer, value) => ({ kind: "glitter.setIrregular", layerId: layer.id, key: "color", value })) }),
  };
  // The flake measurement as a compact property list (UI-131): the same rows whether counted or counting, so nothing moves (UI-90).
  const measured = { centres: h("span", {}), field: h("span", {}), pixels: h("span", {}) };
  const fieldTerm = h("span", {});
  const measurement = propertyList([{ term: "Flake centres", value: measured.centres, mono: true }, { term: fieldTerm, value: measured.field, mono: true },
    { term: "Covered pixels", value: measured.pixels, mono: true }], { label: "Flake measurement", className: "flake-measurement" });
  // The glint-strength control's usable top comes from the Glitter model catalogue (UI-93).
  const glintMax = catalogues(ctx).glitterModels.find(item => item.controlMax?.strength)?.controlMax?.strength;
  // Shown as a percentage of the control's top, beside the other percentage sliders.
  const strengthMax = Math.min(glintMax ?? Infinity, ctx.range("glitter.setDirect", "value", "strength").max);
  const direct = {
    density: new Slider({ label: "Flake density", ...ctx.range("glitter.setDirect", "value", "density"), step: .01, format: pct,
      transaction: recipeTransaction<number>(ctx, "direct-density", (layer, value) => ({ kind: "glitter.setDirect", layerId: layer.id, key: "density", value })) }),
    fineShare: new Slider({ label: "Small-flake share", ...ctx.range("glitter.setDirect", "value", "fineShare"), step: .01, format: pct,
      transaction: recipeTransaction<number>(ctx, "direct-fineShare", (layer, value) => ({ kind: "glitter.setDirect", layerId: layer.id, key: "fineShare", value })) }),
    strength: new Slider({ label: "Sparkle strength", min: 0, max: strengthMax, step: .5, format: value => `${Math.round(value / strengthMax * 100)}%`,
      transaction: recipeTransaction<number>(ctx, "direct-strength", (layer, value) => ({ kind: "glitter.setDirect", layerId: layer.id, key: "strength", value })) }),
    color: new ColorField({ label: "Flake colour", transaction: recipeTransaction<string>(ctx, "direct-color", (layer, value) => ({ kind: "glitter.setDirect", layerId: layer.id, key: "color", value })) }),
  };
  // Everyone chooses among the glint models; the classic and irregular studies are research tools (UI-85).
  const modelChoice = h("div", {}, model.element);
  // That Glitter isn't built into mods is said once, by the finish's export line; the section says only how its colours work.
  const GLITTER_BASE = "Layer colour is the base; the flakes have their own colour.";
  const glitterSection = section({ title: "Glitter", help: GLITTER_BASE }, modelChoice);
  const classicSection = section({ title: "Flakes", help: ["Turn the head to see the flakes catch the light.", "Experimental: may look different in game."] },
    classic.cells.element, classic.density.element, classic.tilt.element);
  const irregularSection = section({ title: "Irregular flakes", help: ["Field density is not a visible flake count.",
    "The counts measure the painted shape's texture: flake centres in the shape, the field they come from, and texture pixels with flake coverage. They are not glints seen on screen."] },
  irregular.count.element, measurement, irregular.radius.element, irregular.spread.element, irregular.tilt.element, irregular.color.element);
  const directSection = section({ title: "Glitter flakes", help: "Turn the head or move the light to see the flakes sparkle." },
    direct.density.element, direct.fineShare.element, direct.strength.element, direct.color.element);
  const body = h("div", { class: "stack" },
    section("Pigment", h("div", { class: "row gap-m align-end" }, color.element, opacity.element)),
    section("Finish", finishGroup, description, exportLine),
    shiftSection, glitterSection, classicSection, irregularSection, directSection);
  const element = h("div", { class: "panel-content" }, strip.element, empty.element, body);
  ctx.anchors.register("finish.picker", finishGroup);
  ctx.anchors.register("finish.color", color.element);
  return {
    spec: { id: "finish", ...EYE_MAKEUP_PANEL_META.finish, element },
    update(frame) {
      strip.update(frame);
      const layer = frame.layer;
      empty.update(!!layer); body.hidden = !layer;
      if (!layer) return;
      color.update(layer.color); opacity.update(layer.opacity);
      const current = catalogues(ctx).finishOf(layer.finish)?.id ?? layer.finish, target = { kind: "layer" as const, id: layer.id };
      const choices = ctx.facade.choicesFor(target, "layer.setFinish", "finish");
      for (const { finish, element } of finishButtons) {
        // Exportable first: a finish that hasn't passed in game shows only with research tools, or while this layer uses it.
        element.hidden = !finishOffered(ctx, finish, current);
        setAttr(element, "aria-pressed", String(finish.id === current));
        const choice = choices.find(item => item.value === finish.id);
        element.disabled = !!choice && !choice.capability.available && finish.id !== current;
        element.title = `${nameWithAliases(finish)}. ${finish.description}${element.disabled ? `\n${choice?.capability.reason ?? ""}` : ""}`;
      }
      // A status group with nothing offered (Preview only, while Glitter is behind research tools) takes its heading with it.
      for (const group of statusGroups) group.element.hidden = finishButtons.every(item => item.finish.exportAdapter !== group.status || item.element.hidden);
      const descriptor = catalogues(ctx).finishes.find(finish => finish.id === current);
      setText(description, descriptor ? `${descriptor.aliases.length ? `${nameWithAliases(descriptor)}. ` : ""}${descriptor.description}` : "");
      // Per-layer status: an experimental finish still in its earlier preview model is left out until switched.
      const status = ctx.facade.layerExport(layer.id), key = `${current}:${status?.exportable ? status.experimental : status?.reason}`;
      if (exportLine.dataset.finish !== key) {
        exportLine.dataset.finish = key;
        const earlier = !!status && !status.exportable && status.blockedBy === "layer" && descriptor?.exportAdapter === "experimental";
        const byPreset = !!status && !status.exportable && status.blockedBy === "preset";
        // The finish's group heading already says Can be built, Experimental or Preview only: a badge shows only a state that differs from it.
        exportLine.replaceChildren(...(earlier || byPreset ? [badge(earlier ? "Earlier preview model" : "Left out of this preset", "warning")] : []),
          h("span", { class: "small", text: status ? (status.exportable ? status.note : status.reason) : descriptor?.exportNote ?? "" }),
          ...(earlier ? [useGame] : []), openPackage);
      }
      const optics = layer.optics as ReadonlyDeep<Layer["optics"]>;
      shiftSection.hidden = !(current === "iridescent" && optics?.shift);
      if (!shiftSection.hidden) { shift.color.update(optics!.shift!.color); shift.strength.update(optics!.shift!.strength); }
      const flakes = layer.flakes as ReadonlyDeep<LegacyFlakes | IrregularFlakes | DirectGlintFlakes> | undefined;
      const glitter = current === "glitter", shimmer = current === "shimmer";
      // The layer's Glitter model, by the catalogue's stored names (UI-10).
      const glitterModel = catalogues(ctx).glitterModelOf(flakes), modelId: GlitterModel = glitterModel.id;
      glitterSection.hidden = !glitter;
      const research = !!frame.preferences?.researchTools;
      classicSection.hidden = !(shimmer || (glitter && modelId === "classic"));
      irregularSection.hidden = !(glitter && modelId === "irregular");
      directSection.hidden = !(glitter && ["direct", "clustered", "fine"].includes(modelId));
      if (glitter) {
        const modelChoices = ctx.facade.choicesFor(target, "glitter.selectModel", "model");
        model.setOptions(catalogues(ctx).glitterModels.filter(item => !item.research || research || item.id === modelId)
          .map(item => ({ value: item.id, label: item.label })));
        model.update(modelId, value => modelChoices.find(choice => choice.value === value)?.capability ?? { available: true });
        // One tip for the section: what the chosen style looks like, then how its colours work.
        const summary = catalogues(ctx).glitterModels.find(item => item.id === modelId)?.summary;
        setHelp(glitterSection.querySelector<HTMLElement>(".help-tip")!, summary ? [summary, GLITTER_BASE] : GLITTER_BASE);
      }
      if (!classicSection.hidden) {
        const flakesTitle = glitter ? "Classic dots" : "Shimmer sparkles";
        setText(classicSection.querySelector(".section-title")!, flakesTitle);
        setAttr(classicSection.querySelector(".help-tip")!, "aria-label", `About ${flakesTitle}`);
        // Shimmer is an experimental export; classic Glitter is preview only, so its tip doesn't call it experimental.
        setHelp(classicSection.querySelector<HTMLElement>(".help-tip")!, glitter ? "Turn the head to see the flakes catch the light."
          : layer.optics ? ["Close up, tiny sparkles catch the light as the head turns; further away they blend into the sheen.", "Experimental: may look different in game."]
          : ["Turn the head to see the flakes catch the light.", "Experimental: may look different in game."]);
        // A layer without stored flakes shows the classic model's defaults from the catalogue (UI-93).
        const legacy = flakes && !("model" in flakes) ? flakes as ReadonlyDeep<LegacyFlakes> : glitterModel.defaults as { cells: number; density: number; tilt: number };
        // Fineness shows only where it applies: game-matched Shimmer's grain has one size (the application refuses it as a mode);
        // any other refusal disables it with its reason (CORE-121).
        const fineness = finenessState(ctx.facade.capability({ kind: "glitter.setClassic", layerId: layer.id, key: "cells", value: legacy.cells }));
        classic.cells.update(legacy.cells, { disabled: fineness.disabled, reason: fineness.reason }); classic.density.update(legacy.density); classic.tilt.update(legacy.tilt);
        classic.cells.element.hidden = fineness.hidden;
      }
      if (!irregularSection.hidden && flakes && "model" in flakes && flakes.model === "irregular-planar-1") {
        const f = flakes as ReadonlyDeep<IrregularFlakes>, target = { kind: "layer" as const, id: layer.id };
        // Flake size and density bound each other; the application publishes the current limits.
        const count = ctx.facade.limitsFor(target, "glitter.setIrregular", "count").value;
        const radius = ctx.facade.limitsFor(target, "glitter.setIrregular", "radius").value;
        irregular.count.update(Math.round(f.count / flakesPerPercent), { note: count?.note });
        irregular.radius.update(f.radius, { min: radius?.min, max: radius?.max, note: radius?.note });
        irregular.spread.update(f.spread); irregular.tilt.update(f.tilt); irregular.color.update(f.color);
        const counted = frame.status.glitter.find(item => item.layerId === layer.id), ready = !!counted?.current;
        setText(fieldTerm, counted?.dense === false ? "Field across the atlas" : "Field in the eye regions");
        setText(measured.centres, ready ? `≈ ${counted!.maskCentres.toLocaleString()}` : "…");
        setText(measured.field, ready ? counted!.regionRetained.toLocaleString() : "…");
        setText(measured.pixels, ready ? `${counted!.coveredPixels.toLocaleString()} at ${counted!.size}²` : "…");
      }
      if (!directSection.hidden && flakes && "model" in flakes && flakes.model !== "irregular-planar-1") {
        const f = flakes as ReadonlyDeep<DirectGlintFlakes>;
        setText(direct.density.element.querySelector(".control-label-text > span")!, f.model === "uv-cell-direct-1" ? "Flake density" : "Maximum flake density");
        direct.density.update(f.density); direct.fineShare.update(f.fineShare); direct.strength.update(f.strength); direct.color.update(f.color);
      }
    },
  };
}

export function shapePanel(ctx: EyeMakeupViewContext): PanelController {
  const strip = layerStrip(ctx), empty = noLayer(ctx);
  const pointLabel = h("strong", { class: "point-label" });
  const selectPoint = (delta: number) => {
    const layer = ctx.facade.view().layer(); if (!layer) return;
    const index = (ctx.facade.view().selected() + delta + layer.points.length) % layer.points.length;
    ctx.dispatch({ kind: "point.select", layerId: layer.id, index });
  };
  const prev = button({ label: "Previous point", icon: "chevronLeft", iconOnly: true, small: true, onClick: () => selectPoint(-1) });
  const next = button({ label: "Next point", icon: "chevronRight", iconOnly: true, small: true, onClick: () => selectPoint(1) });
  const remove = button({ label: "Remove point", icon: "trash", small: true, variant: "quiet", onClick: () => {
    const layer = ctx.facade.view().layer(); if (layer) ctx.dispatch({ kind: "point.remove", layerId: layer.id, index: ctx.facade.view().selected() });
  } });
  const enable = button({ label: "Enable Bézier handles", icon: "shape", small: true, onClick: () => {
    const layer = ctx.facade.view().layer(); if (layer) ctx.dispatch({ kind: "path.edit", layerId: layer.id, command: { kind: "enable-bezier" } });
  } });
  const modes = new Segmented<"aligned" | "symmetric" | "corner">({ label: "Selected point handles", options: [
    { value: "aligned", label: "Smooth", title: "Handles in line, lengths free" },
    { value: "symmetric", label: "Symmetric", title: "Handles in line, same length" },
    { value: "corner", label: "Corner", title: "Each handle free" }],
  onSelect: mode => { const layer = ctx.facade.view().layer(); if (layer) ctx.dispatch({ kind: "path.edit", layerId: layer.id, command: { kind: "point-mode", index: ctx.facade.view().selected(), mode } }); } });
  const pathNote = note("");
  const mirror = new Toggle({ label: "Mirror across the face", onChange: checked => {
    const layer = ctx.facade.view().layer(); if (layer) ctx.dispatch({ kind: "layer.setSymmetry", layerId: layer.id, symmetry: checked });
  } });
  // Generated from the input binding catalogue; the full list is in the ? Keyboard & mouse dialog.
  const gestures = h("details", { class: "help-block" }, h("summary", { text: "Editing gestures" }),
    h("dl", { class: "shortcut-list" }, ...editingReference().flatMap(row => [h("dt", { text: row.input }),
      h("dd", { text: `${row.label}${row.where ? ` · ${row.where}` : ""}` })])),
    h("p", { class: "muted small", text: "The same gestures work in the UV map and on the head. Press ? for every binding." }));
  const body = h("div", { class: "stack" },
    section("Contour point", h("div", { class: "row between" }, h("div", { class: "row gap-xs" }, prev, pointLabel, next), remove)),
    section({ title: "Curve", help: ["Smooth keeps a point's two handles in line. Symmetric also keeps them the same length. Corner moves each on its own.",
      "Drag the gold handles in the UV map or on the head. They are guides, so they may cross the eye opening."] }, enable, modes.element, pathNote),
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
      setText(pointLabel, `Point ${index + 1} of ${layer.points.length}`);
      const target = { kind: "point" as const, layerId: layer.id, index };
      applyCapability(remove, ctx.facade.contextCapability(target, { kind: "point.remove", layerId: layer.id, index }));
      const bezier = layer.pathMode === "bezier";
      enable.hidden = bezier; modes.element.hidden = !bezier;
      modes.update(point?.handles?.mode);
      // How the handles work is the Curve heading's help tip; the line says only what to do with an automatic curve.
      setText(pathNote, bezier ? "" : "This shape uses automatic curves. Choose Enable Bézier handles to edit them; Undo takes it back.");
      pathNote.hidden = bezier;
      mirror.update(layer.symmetry);
    },
  };
}

export function edgePanel(ctx: EyeMakeupViewContext): PanelController {
  const strip = layerStrip(ctx), empty = noLayer(ctx);
  const weight = new Slider({ label: "Selected point pigment", ...ctx.range("pigment.edit", "value", "point-strength"), step: .01, format: pct,
    transaction: recipeTransaction<number>(ctx, "weight", (layer, value) => ({ kind: "pigment.edit", layerId: layer.id, command: { kind: "point-strength", index: ctx.facade.view().selected(), value } })) });
  const smooth = new Toggle({ label: "Smooth point gradients", help: "Blends pigment smoothly between points. Off keeps this layer's original blending.", onChange: enabled => {
    const layer = ctx.facade.view().layer(); if (!layer) return;
    ctx.facade.controlBegin("smooth-strength", layer.id);
    const outcome = ctx.facade.controlEdit("smooth-strength", { kind: "pigment.edit", layerId: layer.id, command: { kind: "smooth-strength", enabled } });
    if (!outcome.ok) ctx.feedback.toast("warning", "Pigment & edge", outcome.message);
    ctx.facade.controlCommit("smooth-strength");
  } });
  // Its reason line is reserved (UI-90), so the one thing to do shows while it is unavailable.
  const blendRange = ctx.range("pigment.edit", "value", "strength-blend");
  const blend = new Slider({ label: "Point blend", ...blendRange, step: blendRange.min, format: scaleText(blendRange.min, blendRange.max),
    reserveNote: true, help: "How far pigment blends between neighbouring points. More blend softens the differences; a point at 0% may keep a little pigment.",
    transaction: recipeTransaction<number>(ctx, "strength-blend", (layer, value) => layer.strength.mode === "smooth-boundary"
      ? { kind: "pigment.edit", layerId: layer.id, command: { kind: "strength-blend", value } } : undefined) });
  const variable = new Toggle({ label: "Per-point edge softness", help: "Give each point its own edge width; widths blend between points. Turning this off keeps your point settings.", onChange: enabled => {
    const layer = ctx.facade.view().layer(); if (!layer) return;
    ctx.facade.controlBegin("variable-softness", layer.id);
    const outcome = ctx.facade.controlEdit("variable-softness", { kind: "softness.edit", layerId: layer.id, command: { kind: "variable-softness", enabled } });
    if (!outcome.ok) ctx.feedback.toast("warning", "Pigment & edge", outcome.message);
    ctx.facade.controlCommit("variable-softness");
  } });
  const widthRange = ctx.range("softness.edit", "value", "uniform-softness");
  const width = new Slider({ label: "Edge softness", ...widthRange, step: .0005, format: scaleText(widthRange.min, widthRange.max),
    help: "How far the edge fades out. Very soft edges can reach nearby sharp edges in narrow shapes.",
    transaction: recipeTransaction<number>(ctx, "feather", (layer, value) => ({ kind: "softness.edit", layerId: layer.id,
      command: layer.softness.mode === "boundary" ? { kind: "point-softness", index: ctx.facade.view().selected(), value } : { kind: "uniform-softness", value } })) });
  const pointLabel = h("span", { class: "muted small" });
  const mottle = mottleSection(ctx);
  const body = h("div", { class: "stack" },
    section({ title: "Pigment strength", help: "Select points in the UV map or on the head to set each one's pigment." }, pointLabel, weight.element, smooth.element, blend.element),
    section("Edge softness", variable.element, width.element), mottle.element);
  const element = h("div", { class: "panel-content" }, strip.element, empty.element, body);
  return {
    spec: { id: "edge", ...EYE_MAKEUP_PANEL_META.edge, element },
    update(frame) {
      strip.update(frame);
      const layer = frame.layer; empty.update(!!layer); body.hidden = !layer;
      if (!layer) return;
      const point = layer.points[frame.selected];
      setText(pointLabel, `Point ${frame.selected + 1} of ${layer.points.length}`);
      weight.update(point?.weight);
      const smoothMode = layer.strength.mode === "smooth-boundary";
      smooth.update(smoothMode);
      blend.update(smoothMode ? (layer.strength as { blend: number }).blend : undefined,
        { disabled: !smoothMode, reason: "Turn on Smooth point gradients to blend points." });
      const perPoint = layer.softness.mode === "boundary";
      variable.update(perPoint);
      setText(width.element.querySelector(".control-label-text > span")!, perPoint ? "Selected point softness" : "Edge softness");
      width.update(perPoint ? point?.feather ?? layer.feather : layer.feather);
      mottle.update(layer);
    },
  };
}

/**
 * Mottle (vector engine extensions §7): skin-scale breakup of the layer's coverage, baked into the exported texture.
 * Sliders are one Undo step per drag; the switch, presets, placement, streaks and Shuffle are one step each.
 */
function mottleSection(ctx: EyeMakeupViewContext) {
  const set = (key: MottleKey, value: number | string) => {
    const layer = ctx.facade.view().layer(); if (layer) ctx.dispatch({ kind: "effect.mottle.set", layerId: layer.id, key, value });
  };
  const slider = (key: "amount" | "grain" | "clumping" | "angle" | "length", label: string, step: number, format: (value: number) => string, help?: string) =>
    new Slider({ label, ...ctx.range("effect.mottle.set", "value", key), step, format, help, reserveNote: key === "grain",
      transaction: recipeTransaction<number>(ctx, `mottle-${key}`, (layer, value) => layer.effects?.mottle
        ? { kind: "effect.mottle.set", layerId: layer.id, key, value } : undefined, "Pigment & edge") });
  // The switch says what it does, so it never repeats its section's Mottle heading (release-readiness-audit.md C-24).
  const enabled = new Toggle({ label: "Break up the coverage", onChange: checked => {
    const layer = ctx.facade.view().layer(); if (layer) ctx.dispatch({ kind: "effect.mottle.enable", layerId: layer.id, enabled: checked });
  } });
  // The presets come from the facade's catalogue; the pressed one is the preset the layer's settings equal (seed aside).
  const catalogue = ctx.facade.mottleCatalogue();
  const same = (a: unknown, b: unknown) => JSON.stringify(a, Object.keys(a as object).sort()) === JSON.stringify(b, Object.keys(b as object).sort());
  const matching = (m: ReadonlyDeep<Mottle>) => catalogue.find(({ look }) => look.amount === m.amount && look.grain === m.grain &&
    look.clumping === m.clumping && look.where === m.where && (look.streaks && m.streaks ? same(look.streaks, m.streaks) : !look.streaks && !m.streaks))?.id;
  const presets = new Segmented<MottlePresetId>({ label: "Preset", options: catalogue.map(({ id, label }) => ({ value: id, label })),
    onSelect: preset => { const layer = ctx.facade.view().layer(); if (layer) ctx.dispatch({ kind: "effect.mottle.preset", layerId: layer.id, preset }); } });
  const amount = slider("amount", "Amount", .01, pct);
  const grain = slider("grain", "Grain size", .01, value => `${value.toFixed(2)} mm`, "Measured on the skin, so pores are the same size wherever the layer sits.");
  const clumping = slider("clumping", "Clumping", .01, value => value < .34 ? `${pct(value)} · pores` : value > .66 ? `${pct(value)} · clumps` : pct(value),
    "Low values give small pits where product skips; high values give a patchy build-up.");
  const where = new Segmented<Mottle["where"]>({ label: "Where", options: [
    { value: "edges", label: "Edges", title: "Break up only the soft edge; the centre stays solid" },
    { value: "everywhere", label: "Everywhere", title: "An uneven film across the whole shape" }], onSelect: value => set("where", value) });
  const streaks = new Segmented<"off" | "angle" | "edge">({ label: "Streaks", options: [
    { value: "off", label: "Off" }, { value: "angle", label: "Angle", title: "Strands at a fixed angle on the skin" },
    { value: "edge", label: "Across edge", title: "Strands running out from the shape's edge, like mascara off the lash line" }],
  onSelect: value => set("streaks", value) });
  const angle = slider("angle", "Streak angle", 1, value => `${Math.round(value)}°`);
  const length = slider("length", "Streak length", .1, value => `${value.toFixed(1)} × grain`);
  const shuffle = button({ label: "Shuffle pattern", icon: "refresh", small: true, variant: "quiet", onClick: () => {
    const layer = ctx.facade.view().layer(); if (layer) ctx.dispatch({ kind: "effect.mottle.shuffle", layerId: layer.id });
  } });
  const details = h("div", { class: "stack" }, presets.element, amount.element, grain.element, clumping.element, where.element,
    streaks.element, angle.element, length.element, h("div", { class: "row" }, shuffle));
  const element = section({ title: "Mottle", help: ["Breaks the layer up the way powder, cream and mascara sit on skin close up: pores and clumps at skin scale.",
    "It is part of the layer's texture, so your mod shows exactly what the 3D view shows, at no cost in game. A higher Preview quality shows finer grain."] },
  enabled.element, details);
  return { element, update(layer: RLayer) {
    const m = layer.effects?.mottle as ReadonlyDeep<Mottle> | undefined;
    enabled.update(!!m);
    details.hidden = !m;
    if (!m) return;
    presets.update(matching(m));
    amount.update(m.amount); clumping.update(m.clumping);
    // The grain is floored at two export texels; say so only when the floor applies.
    grain.update(m.grain, { note: m.grain < .26 ? "Drawn at 0.26 mm: anything finer would vanish in the exported texture." : undefined });
    where.update(m.where); streaks.update(m.streaks?.mode ?? "off");
    angle.element.hidden = m.streaks?.mode !== "angle"; length.element.hidden = !m.streaks;
    if (m.streaks?.mode === "angle") angle.update(m.streaks.angle);
    if (m.streaks) length.update(m.streaks.length);
  } };
}

export function warpPanel(ctx: EyeMakeupViewContext): PanelController {
  const strip = layerStrip(ctx), empty = noLayer(ctx);
  const add = button({ label: "Add warp", icon: "plus", small: true, onClick: () => {
    const layer = ctx.facade.view().layer(); if (layer) ctx.dispatch({ kind: "field.add", layerId: layer.id });
  } });
  const chips = h("div", { class: "chip-row", role: "group", "aria-label": "Warps" });
  const reachRange = ctx.range("field.setReach", "radius");
  const reach = new Slider({ label: "Reach", ...reachRange, step: .001, format: scaleText(reachRange.min, reachRange.max),
    transaction: {
      begin: () => { const layer = ctx.facade.view().layer(); if (layer && ctx.facade.view().selectedField()) ctx.facade.controlBegin("radius", layer.id); },
      edit: value => { const layer = ctx.facade.view().layer(), field = ctx.facade.view().selectedField(); if (!layer || !field) return;
        const outcome = ctx.facade.controlEdit("radius", { kind: "field.setReach", layerId: layer.id, fieldId: field.id, radius: value });
        if (!outcome.ok) { ctx.feedback.toast("warning", "Warp", outcome.message); ctx.changed(); } },
      commit: () => ctx.facade.controlCommit("radius"), cancel: () => ctx.facade.controlCancel("radius"),
    } });
  const clear = button({ label: "Reset warp pull", icon: "reset", small: true, variant: "quiet", onClick: () => {
    const layer = ctx.facade.view().layer(), field = ctx.facade.view().selectedField(); if (layer && field) ctx.dispatch({ kind: "field.clear", layerId: layer.id, fieldId: field.id });
  } });
  const remove = button({ label: "Remove warp", icon: "trash", small: true, variant: "quiet", onClick: () => {
    const layer = ctx.facade.view().layer(), field = ctx.facade.view().selectedField(); if (layer && field) ctx.dispatch({ kind: "field.remove", layerId: layer.id, fieldId: field.id });
  } });
  const fieldNote = note("");
  let signature = "";
  const selected = section("Selected warp", reach.element, h("div", { class: "row wrap gap-s" }, clear, remove));
  const body = h("div", { class: "stack" },
    section({ title: "Warps", help: ["A warp bends the makeup, not the face. Overlapping warps add together.",
      "On the map: the circle is its position, the square its pull and the dashed ring its reach."] },
      h("div", { class: "row between" }, chips, add), fieldNote), selected);
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
          chip.addEventListener("click", () => { const current = ctx.facade.view().layer(); if (current) ctx.dispatch({ kind: "field.select", layerId: current.id, fieldId: item.id }); });
          return chip;
        }));
      }
      for (const chip of chips.querySelectorAll<HTMLElement>("[data-field]")) setAttr(chip, "aria-pressed", String(chip.dataset.field === field?.id));
      applyCapability(add, ctx.facade.contextCapability({ kind: "layer", id: layer.id }, { kind: "field.add", layerId: layer.id }));
      selected.hidden = !field;
      if (field) {
        reach.update(field.radius);
        const target = { kind: "field" as const, layerId: layer.id, id: field.id };
        applyCapability(clear, ctx.facade.contextCapability(target, { kind: "field.clear", layerId: layer.id, fieldId: field.id }));
        applyCapability(remove, ctx.facade.contextCapability(target, { kind: "field.remove", layerId: layer.id, fieldId: field.id }));
      }
      // The legend lives in the Warps help tip and the chips show the count; the line only helps with the first warp.
      setText(fieldNote, layer.fields.length ? "" : "No warps yet. Add one, then drag its square to pull the makeup.");
      fieldNote.hidden = layer.fields.length > 0;
    },
  };
}
